// Score posts with any OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter, a local
// router, Ollama...).

const MAX_POST_CHARS = 3000; // keeps a batch inside the model context
const CONCURRENCY = 4;
const TIMEOUT_MS = 600e3;

const SYSTEM_PROMPT = `You triage a person's Facebook or X feed so they only read what matters.

Each <post> is the raw innerText of one feed item: author name, relative time, body,
reaction counts and button labels are mixed together, and some items are ads
("Sponsored", "Được tài trợ", "Ad"), suggestions ("Suggested for you", "Gợi ý cho bạn",
"Follow"/"Theo dõi" next to the author), "People you may know" blocks or other widgets.

Return one item per post with:
- id: the post id attribute, unchanged
- is_ad: true for sponsored content or obvious selling posts from pages
- is_suggested: true when Facebook recommends it from someone the person does not follow.
  This is informational only: suggested posts can be valuable, score them on content.
- author: the person, page or group that posted it ("" if unclear)
- summary: one or two sentences in Vietnamese describing the actual content
- score: integer 0-10 for how much this person would want to read it, based on their interests below.
  Be strict; being on-topic is not enough, judge how useful the post is to this person:
  9-10: on a listed interest AND concrete, new and actionable (a job that fits, a significant
        news event, an in-depth analysis, a personal announcement from someone close).
        Rare: at most one or two in twenty posts.
  7-8:  clearly on a listed interest with real substance the person would learn from.
  4-6:  loosely related, generic, self-promotion, or little substance.
  0-3:  off-interest, ads, drama, emotional stories unrelated to the interests.
  If the text is too short to tell what the post is about (image-only, a few-word caption),
  score at most 4.
- tags: 1-3 short lowercase topic tags
- reason: one short Vietnamese sentence explaining the score

The person's interests:
{interests}`;

const SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'is_ad', 'is_suggested', 'author', 'summary', 'score', 'tags', 'reason'],
        properties: {
          id: { type: 'integer' }, is_ad: { type: 'boolean' }, is_suggested: { type: 'boolean' },
          author: { type: 'string' }, summary: { type: 'string' }, score: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' },
        },
      },
    },
  },
};

// The schema goes in the prompt instead of response_format: routers that turn response_format
// into a Claude tool call get "items" back as a string with unescaped quotes inside.
const JSON_INSTRUCTION = '\n\nReply with only a JSON object matching this JSON schema, no prose or code fences:\n'
  + JSON.stringify(SCHEMA);

const NO_INTERESTS = '(chưa khai báo: chấm theo mức độ hữu ích và có nội dung thật của bài)';

export async function chat(s, system, user) {
  let res;
  try {
    res = await fetch(`${s.llmUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(s.llmKey ? { Authorization: `Bearer ${s.llmKey}` } : {}) },
      body: JSON.stringify({
        model: s.llmModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false, // some routers stream unless told otherwise
        temperature: 0,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Không gọi được LLM tại ${s.llmUrl}: ${err.message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM trả lỗi HTTP ${res.status}: ${text.slice(0, 300)}`);
  let choice;
  try {
    choice = JSON.parse(text).choices[0];
  } catch {
    throw new Error(`LLM trả về dữ liệu không đúng định dạng OpenAI: ${text.slice(0, 200)}`);
  }
  if (choice.finish_reason === 'length') throw new Error('Câu trả lời của model bị cắt vì quá dài.');
  return choice.message.content;
}

function parseBatch(content) {
  // Tolerate code fences or a sentence around the object.
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Model trả về JSON không hợp lệ: ${err.message}`);
  }
  if (!Array.isArray(data?.items)) throw new Error('Model trả về JSON thiếu "items".');
  return data.items.filter((i) => Number.isInteger(i.id) && Number.isFinite(+i.score)).map((i) => ({
    id: i.id, is_ad: !!i.is_ad, is_suggested: !!i.is_suggested, author: String(i.author || ''),
    summary: String(i.summary || ''), score: Math.round(+i.score), reason: String(i.reason || ''),
    tags: Array.isArray(i.tags) ? i.tags.map(String) : [],
  }));
}

// At most CONCURRENCY LLM calls at once, however many callers there are.
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= CONCURRENCY) await new Promise((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function scoreBatch(s, rows) {
  const posts = rows.map((r) => `<post id="${r.id}">\n${r.text.slice(0, MAX_POST_CHARS)}\n</post>`).join('\n\n');
  const system = SYSTEM_PROMPT.replace('{interests}', s.interests.trim() || NO_INTERESTS) + JSON_INSTRUCTION;
  return parseBatch(await chat(s, system, posts));
}

// Score rows [{id, text}] in small batches, all at once, for the filter on the page, where a person is
// waiting: small batches keep each call short. A failed batch only loses its own rows; the error is
// thrown only when nothing at all came back.
export async function scoreRows(s, rows, batchSize = 4) {
  const batches = [];
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));
  const results = await Promise.allSettled(batches.map((b) => limited(() => scoreBatch(s, b))));
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const failed = results.find((r) => r.status === 'rejected');
  if (!items.length && failed) throw failed.reason;
  return items;
}
