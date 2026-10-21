// Talk to Facebook with the person's own logged-in session, for the friends, pages and groups lists.
// API calls and page fetches run from the service worker, so nothing opens on screen.

import { candidates, markOwn } from './ops.js';

export const FB = 'https://www.facebook.com';
const STALE_HINT = 'Facebook có thể đã đổi doc_id: hãy làm thao tác này một lần bằng tay trên Facebook để extension tự học, '
  + 'hoặc bấm "Cập nhật cấu hình" trong tab Cài đặt.';
const NOT_LOGGED_IN = 'Chưa đăng nhập Facebook trên trình duyệt này, hoặc Facebook yêu cầu xác minh. '
  + 'Mở facebook.com để đăng nhập rồi thử lại.';
// Without a browser-like Accept header Facebook answers page requests with an empty body.
const HTML_HEADERS = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const HEADER_RULE_ID = 1;

export class FacebookError extends Error {}
export class SessionExpired extends FacebookError {}
// A FacebookHalt means "stop talking to Facebook now": callers that otherwise fall back or skip to the
// next item must let it through, or a flagged account keeps getting requests.
export class FacebookHalt extends FacebookError {}
export class FacebookBlocked extends FacebookHalt {} // Facebook pushed back; a cooldown has just started
export class FacebookCooldown extends FacebookHalt {} // a cooldown is already running

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uniform = (a, b) => a + Math.random() * (b - a);

// --- Cooldown ------------------------------------------------------------------------------------
// Once Facebook throttles the account or asks for verification, every further automated request makes
// it worse. The cooldown keeps all Facebook work stopped until it ends or the person clears it.
const COOLDOWN_MS = 24 * 3600e3;
const COOLDOWN_KEY = 'fbCooldown';
// Matched only against the error text of a reply that carries no data (see throttleReason), so a post
// that merely talks about rate limits cannot trip it.
const THROTTLED = /rate.?limit|temporarily (blocked|restricted)|tạm thời bị chặn|bị chặn tạm thời|checkpoint/i;

const untilText = (until) => new Date(until).toLocaleString('vi-VN');

export async function activeCooldown() {
  const { [COOLDOWN_KEY]: c } = await chrome.storage.local.get(COOLDOWN_KEY);
  return c && c.until > Date.now() ? c : null;
}

export const clearCooldown = () => chrome.storage.local.remove(COOLDOWN_KEY);

// Start a cooldown and return the error that reports it; callers `throw await trip(...)`.
export async function trip(reason, ms = COOLDOWN_MS) {
  const until = Date.now() + ms;
  await chrome.storage.local.set({ [COOLDOWN_KEY]: { until, reason } });
  return new FacebookBlocked(`${reason}. Extension tạm nghỉ mọi thao tác Facebook đến ${untilText(until)}. `
    + 'Mở Facebook trên trình duyệt để kiểm tra tài khoản; xử lý xong có thể bỏ thời gian nghỉ ở tab Cài đặt.');
}

// Why an API reply says the account is being throttled ('' when it does not). Only replies without data
// count: an ordinary reply may hold thousands of words of other people's text.
function throttleReason(status, text) {
  if (status === 429) return 'Facebook trả HTTP 429';
  let body;
  try { body = JSON.parse(text.replace(/^for \(;;\);/, '').split('\n', 1)[0]); } catch { return ''; }
  if (!body || body.data) return '';
  const msg = [body.errorSummary, body.errorDescription, body.errors?.[0]?.message, body.errors?.[0]?.summary]
    .filter((m) => typeof m === 'string').join(' ');
  return THROTTLED.test(msg) ? `Facebook báo giới hạn/chặn: ${msg.slice(0, 150)}` : '';
}

// The service worker's requests carry Origin: chrome-extension://…, which Facebook's API rejects.
// A session rule gives this extension's own tab-less requests the site's origin, as the web app has.
export async function ensureHeaderRule() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [HEADER_RULE_ID],
    addRules: [{
      id: HEADER_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: FB },
          { header: 'referer', operation: 'set', value: `${FB}/` },
          { header: 'sec-fetch-site', operation: 'set', value: 'same-origin' },
        ],
      },
      condition: { urlFilter: `|${FB}/`, tabIds: [chrome.tabs.TAB_ID_NONE], initiatorDomains: [chrome.runtime.id] },
    }],
  });
}

// GET a facebook.com page with the person's cookies; returns {url, html} after redirects.
export async function fetchPage(path) {
  const res = await fetch(new URL(path, FB), { credentials: 'include', headers: HTML_HEADERS });
  return { url: res.url, html: await res.text() };
}

// The person's id and the page tokens every API call needs, read from the home page.
export async function apiSession() {
  const cooling = await activeCooldown();
  if (cooling) {
    throw new FacebookCooldown(`Facebook đang tạm nghỉ đến ${untilText(cooling.until)} (${cooling.reason}). `
      + 'Nếu bạn đã xử lý xong trên Facebook, bỏ thời gian nghỉ ở tab Cài đặt.');
  }
  await ensureHeaderRule();
  let page;
  try {
    page = await fetchPage('/');
  } catch (err) {
    throw new FacebookError(`Không kết nối được Facebook: ${err.message}`);
  }
  const { url, html } = page;
  // Facebook asking for verification is the clearest warning there is: stop all automation.
  if (/^\/(checkpoint|two_step_verification)/.test(new URL(url).pathname)) throw await trip('Facebook yêu cầu xác minh tài khoản');
  const user = (html.match(/"USER_ID":"(\d+)"/) || [])[1];
  const dtsg = (html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) || [])[1];
  const lsd = (html.match(/"LSD",\[\],\{"token":"([^"]+)"/) || [])[1] || '';
  if (!user || user === '0' || !dtsg || /^\/(login|checkpoint|two_step_verification)/.test(new URL(url).pathname)) {
    throw new SessionExpired(NOT_LOGGED_IN);
  }
  return { user, dtsg, lsd };
}

// POST a GraphQL request the way the web app does; returns {status, text}.
export async function graphql(ctx, name, docId, variables) {
  markOwn(name, docId, 1);
  try {
    const body = new URLSearchParams({
      av: ctx.user, __user: ctx.user, __a: '1', fb_dtsg: ctx.dtsg, lsd: ctx.lsd,
      fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: name,
      variables: JSON.stringify(variables), server_timestamps: 'true', doc_id: docId,
    });
    const res = await fetch(`${FB}/api/graphql/`, {
      method: 'POST', body, credentials: 'include',
      headers: { 'x-fb-friendly-name': name, 'x-fb-lsd': ctx.lsd },
    });
    const reply = { status: res.status, text: await res.text() };
    const throttled = throttleReason(reply.status, reply.text);
    if (throttled) throw await trip(throttled);
    return reply;
  } catch (err) {
    if (err instanceof FacebookError) throw err;
    throw new FacebookError(`${name}: không gọi được API Facebook: ${err.message}`);
  } finally {
    // The webRequest event for this call has fired by the time the response is read.
    markOwn(name, docId, -1);
  }
}

// Breadth-first search for obj[...][key] passing accept(), not entering shared stories.
export function first(obj, key, accept) {
  const queue = [obj];
  while (queue.length) {
    const o = queue.shift();
    if (Array.isArray(o)) queue.push(...o);
    else if (o && typeof o === 'object') {
      if (key in o && accept(o[key])) return o[key];
      for (const [k, v] of Object.entries(o)) if (k !== 'attached_story') queue.push(v);
    }
  }
  return null;
}

// GraphQL responses stream deferred fragments as extra JSON lines.
export function* jsonLines(text) {
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try { yield JSON.parse(line); } catch { /* partial line */ }
  }
}

// Runs operation `key` with each known doc_id, newest first, until Facebook accepts one.
// accept(data) lets a mutation reject a reply whose payload is empty (a stale doc_id often answers
// with null fields rather than an error).
export async function gql(ctx, key, variables, accept = () => true) {
  const list = await candidates(key);
  if (!list.length) throw new FacebookError(`Không có doc_id cho thao tác ${key}.`);
  const errors = [];
  for (const c of list) {
    const reply = await graphql(ctx, c.name, c.doc_id, variables);
    const first = reply.text.split('\n', 1)[0];
    let body;
    try {
      body = JSON.parse(first);
    } catch {
      errors.push(`[${c.from}] HTTP ${reply.status}, phản hồi không phải JSON: ${first.slice(0, 150)}`);
      continue;
    }
    if (body.errors && !body.data) {
      errors.push(`[${c.from}] ${body.errors[0]?.message || JSON.stringify(body.errors[0]).slice(0, 150)}`);
      continue;
    }
    const data = body.data || {};
    if (accept(data)) return data;
    errors.push(`[${c.from}] ${JSON.stringify(body).slice(0, 200)}`);
  }
  throw new FacebookError(`${list[0].name}: ${errors.join(' | ')}. ${STALE_HINT}`);
}
