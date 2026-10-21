// Service worker: scores posts for the page filter (content/filter.js), runs the Facebook friends,
// pages and groups lists for the manager page, and learns fresh doc_ids from the requests Facebook's
// own web app sends.

import * as account from './lib/account.js';
import * as db from './lib/db.js';
import { activeCooldown, apiSession, clearCooldown, ensureHeaderRule, sleep, uniform } from './lib/fb.js';
import * as ops from './lib/ops.js';
import { chat, scoreRows } from './lib/scorer.js';
import { getSettings, llmReady, saveSettings } from './lib/settings.js';

const MANAGER = chrome.runtime.getURL('manager.html');
// Facebook flags accounts that unfriend/leave/unfollow in bulk, so actions go slowly and in small daily batches.
const ACTION_DELAY = [30e3, 90e3];
const DAILY_ACTION_LIMIT = 10;
const REMOTE_REFRESH_MIN = 360;

// list kind -> {action: [label, flag]}. An action without a flag removes the item from the list;
// one with a flag keeps it and sets that flag, which survives a refresh.
const ACTIONS = {
  friends: { unfriend: ['Hủy kết bạn', null] },
  pages: { unfollow_page: ['Bỏ theo dõi', null] },
  groups: {
    leave_group: ['Rời nhóm', null],
    unfollow_group: ['Bỏ theo dõi', 'unfollowed'],
    mute_group: ['Tắt thông báo', 'muted'],
  },
};

// Registered synchronously at top level so a request wakes the worker.
chrome.webRequest.onBeforeRequest.addListener(ops.observe, { urls: ['https://*.facebook.com/api/graphql/*'] }, ['requestBody']);
// Session rules are dropped when the browser restarts; reinstall the header rule on every start.
ensureHeaderRule().catch((err) => console.warn('header rule', err));

// --- Cached lists --------------------------------------------------------------------------------

async function loadList(kind) {
  return (await chrome.storage.local.get(`list:${kind}`))[`list:${kind}`] || { updated: null, items: [] };
}

async function saveList(kind, items, updated) {
  const data = { updated: updated || new Date().toISOString(), items };
  await chrome.storage.local.set({ [`list:${kind}`]: data });
  return data;
}

// --- One Facebook task at a time -----------------------------------------------------------------

let busy = false;
let job = { running: false };

const publicJob = () => Object.fromEntries(Object.entries(job).filter(([k]) => k !== 'cancel'));

async function exclusive(fn) {
  if (busy) throw new Error('Đang có một tác vụ chạy; chờ xong hoặc bấm Dừng.');
  busy = true;
  // An extension API call every 20 s keeps the worker alive through long sleeps.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20e3);
  try {
    return await fn();
  } finally {
    clearInterval(keepAlive);
    busy = false;
  }
}

function launch(kind, label, total, fn) {
  if (busy) throw new Error('Đang có một tác vụ chạy; chờ xong hoặc bấm Dừng.');
  const j = { running: true, kind, label, total, done: 0, current: '', error: null, summary: '', cancel: false };
  job = j;
  // done resolves to the job itself, so a caller can read its summary once it finishes.
  const done = exclusive(async () => {
    try {
      await fn(j);
      return j;
    } catch (err) {
      console.error(`Task ${label} failed at ${j.current}`, err);
      j.error = j.current ? `${j.current}: ${err.message}` : err.message;
      throw err;
    } finally {
      j.running = false;
      j.current = '';
    }
  });
  return { job: publicJob(), done };
}

async function refreshList(kind) {
  return exclusive(async () => {
    const items = await account.LISTS[kind](await apiSession());
    // A flag Facebook could not be asked about (the settings query failed) keeps its cached value.
    const old = new Map((await loadList(kind)).items.map((i) => [i.id, i]));
    const flags = Object.values(ACTIONS[kind]).map(([, f]) => f).filter(Boolean);
    for (const i of items) for (const f of flags) if (i[f] === undefined && old.get(i.id)?.[f]) i[f] = true;
    return saveList(kind, items);
  });
}

// Actions done today across every list, as {day: 'YYYY-MM-DD' in local time, count}.
async function actionsToday() {
  const day = new Date().toLocaleDateString('sv');
  const { actionQuota } = await chrome.storage.local.get('actionQuota');
  return actionQuota?.day === day ? actionQuota : { day, count: 0 };
}

const LIMIT_REACHED = `Đã đủ ${DAILY_ACTION_LIMIT} thao tác hôm nay. Làm tiếp vào ngày mai để Facebook không coi là hành vi tự động.`;

async function startActions(kind, method, ids) {
  if (!ACTIONS[kind]?.[method]) throw new Error(`Thao tác không hợp lệ: ${method}`);
  const left = DAILY_ACTION_LIMIT - (await actionsToday()).count;
  if (left <= 0) throw new Error(LIMIT_REACHED);
  if (ids.length > left) throw new Error(`Hôm nay chỉ còn ${left}/${DAILY_ACTION_LIMIT} thao tác; hãy chọn tối đa ${left} mục.`);
  const [label, flag] = ACTIONS[kind][method];
  return launch(kind, label, ids.length, async (j) => {
    const names = new Map((await loadList(kind)).items.map((i) => [i.id, i.name]));
    const ctx = await apiSession();
    for (const [n, id] of ids.entries()) {
      if (j.cancel) break;
      if (n) await sleep(uniform(...ACTION_DELAY));
      // Checked again per action: a midnight rollover may have reset it.
      const today = await actionsToday();
      if (today.count >= DAILY_ACTION_LIMIT) throw new Error(LIMIT_REACHED);
      j.current = names.get(id) || id;
      await account.ACTIONS[method](ctx, id); // throws on the first failure: usually Facebook throttling
      await chrome.storage.local.set({ actionQuota: { ...today, count: today.count + 1 } });
      j.done++;
      const cache = await loadList(kind);
      if (flag) {
        await saveList(kind, cache.items.map((i) => (i.id === id ? { ...i, [flag]: true } : i)), cache.updated);
        continue;
      }
      await saveList(kind, cache.items.filter((i) => i.id !== id), cache.updated);
    }
  });
}

async function refreshRemoteOps() {
  try {
    await ops.refreshRemote((await getSettings()).remoteOpsUrl);
  } catch (err) {
    console.warn(err.message);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'remote-ops') refreshRemoteOps();
});

async function setup() {
  await chrome.alarms.create('remote-ops', { periodInMinutes: REMOTE_REFRESH_MIN });
  await refreshRemoteOps();
}

chrome.runtime.onStartup.addListener(setup);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setup();
  if (reason === 'install') await openManager();
});

async function openManager() {
  const [tab] = await chrome.tabs.query({ url: MANAGER });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: MANAGER });
  }
}

chrome.action.onClicked.addListener(openManager);

// --- Messages from the page filter (content/filter.js) -------------------------------------------

const PLATFORMS = ['fb', 'x'];
const platformOf = (msg) => (PLATFORMS.includes(msg.platform) ? msg.platform : 'fb');

// The settings one site's filter needs, without the platform prefix.
async function filterSettings(platform) {
  const s = await getSettings();
  const p = platform === 'x' ? 'x' : 'fb';
  const on = (name) => s[`${p}Hide${name}`];
  return {
    settings: {
      enabled: s[`${p}Enabled`], scoring: s.scoreEnabled, hideBelow: s.hideBelow, showBadges: s.showBadges,
      holdUntilScored: s.holdUntilScored, llm: llmReady(s),
      hideAds: on('Ads'), hideVideos: on('Videos'),
      hideFriendSuggestions: p === 'fb' && on('FriendSuggestions'), hideSuggested: p === 'fb' && on('Suggested'),
      hideNotFollowed: p === 'fb' && on('NotFollowed'), hideGroupSuggestions: p === 'fb' && on('GroupSuggestions'),
      hideGrok: p === 'x' && on('Grok'),
    },
  };
}

// Score posts [{id, text}] seen on the page. A score is cached against the post and the interests, so
// scrolling back, reloading or seeing a reshare never asks the LLM twice.
async function scorePosts(posts) {
  const s = await getSettings();
  if (!llmReady(s)) throw new Error('Chưa cấu hình LLM');
  const scope = (await db.sha1(s.interests.trim())).slice(0, 12);
  const rows = await Promise.all(posts.map(async (p) => ({
    id: p.id, text: String(p.text), key: `${await db.postKey(String(p.text))}:${scope}`,
  })));
  const cached = await db.getScores(rows.map((r) => r.key));
  const items = rows.filter((r) => cached.has(r.key)).map((r) => ({ ...cached.get(r.key), id: r.id }));
  const todo = rows.filter((r) => !cached.has(r.key));
  if (todo.length) {
    const fresh = await scoreRows({ ...s, llmModel: s.filterModel || s.llmModel }, todo);
    const keys = new Map(todo.map((r) => [r.id, r.key]));
    await db.putScores(fresh.filter((i) => keys.has(i.id)).map((i) => ({ key: keys.get(i.id), item: i })));
    items.push(...fresh);
  }
  return { items };
}

const FILTER_MESSAGES = {
  'filter-settings': (msg) => filterSettings(platformOf(msg)),
  score: (msg) => scorePosts(msg.posts || []),
  'filter-set': async (msg) => { await saveSettings({ [`${platformOf(msg)}Enabled`]: !!msg.enabled }); return {}; },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = sender.id === chrome.runtime.id && sender.tab && FILTER_MESSAGES[msg?.type];
  if (!run) return false;
  run(msg).then(
    (data) => reply({ ok: true, ...data }),
    (err) => reply({ ok: false, error: err.message || String(err) }),
  );
  return true;
});

// --- Messages from the manager page --------------------------------------------------------------

async function saveAllSettings(patch) {
  const before = await getSettings();
  const s = await saveSettings(patch);
  if (s.remoteOpsUrl !== before.remoteOpsUrl) await refreshRemoteOps();
  return s;
}

async function testLlm(patch) {
  const s = { ...(await getSettings()), ...patch };
  s.llmUrl = String(s.llmUrl || '').trim().replace(/\/+$/, '');
  if (!llmReady(s)) throw new Error('Cần điền URL và chọn model.');
  const reply = await chat(s, 'Reply with the single word OK.', 'ping');
  return { reply: String(reply).slice(0, 200) };
}

async function safety() {
  return { cooldown: await activeCooldown(), actions: (await actionsToday()).count, limit: DAILY_ACTION_LIMIT };
}

async function route(path, body) {
  const [kind, verb] = path.split('/');
  if (ACTIONS[kind]) {
    if (!verb) return loadList(kind);
    if (verb === 'refresh') return refreshList(kind);
    if (verb === 'action') {
      const { job: j, done } = await startActions(kind, String(body.method), (body.ids || []).map(String));
      done.catch(() => {}); // the error is shown through the job
      return j;
    }
  }
  switch (path) {
    case 'job': return publicJob();
    case 'job/cancel': job.cancel = true; return publicJob();
    case 'fb/safety': return safety();
    case 'fb/safety/clear':
      await clearCooldown();
      return safety();
    case 'settings': return body ? saveAllSettings(body) : getSettings();
    case 'llm/test': return testLlm(body || {});
    case 'ops': return ops.status();
    case 'ops/refresh':
      await ops.refreshRemote((await getSettings()).remoteOpsUrl);
      return ops.status();
    default: throw new Error(`Không có API ${path}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(MANAGER)) return false;
  route(msg.path, msg.body).then(
    (data) => reply({ ok: true, data }),
    (err) => reply({ ok: false, error: err.message || String(err) }),
  );
  return true;
});
