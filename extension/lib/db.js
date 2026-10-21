// Scores of posts the filter has seen, in IndexedDB local to this browser profile, so scrolling back
// or reloading a page never asks the LLM about the same post twice.

const DB_NAME = 'fb-digest'; // kept from earlier versions so cached scores survive the rename

let opening = null;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 2) db.createObjectStore('scores', { keyPath: 'key' });
      // Posts and run logs collected by the scanner that no longer exists.
      for (const old of ['posts', 'runs']) if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function sha1(text) {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Stable identity of a post across page loads. The raw text changes (relative timestamps, reaction
// counts), so hash only the longest lines with digits removed: those are the post body.
export async function postKey(text) {
  const norm = (s) => s.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  const lines = [...new Set(text.split('\n').map((l) => norm(l).toLowerCase()))];
  const body = lines.filter((l) => l.length >= 20).sort((a, b) => b.length - a.length).slice(0, 3);
  return sha1(body.sort().join('\n') || norm(text));
}

// Cached scores by key -> Map(key -> item). A key is the post key plus a hash of the interests, so
// changing the interests starts scoring afresh.
export async function getScores(keys) {
  const os = await store('scores');
  const found = new Map();
  for (const key of keys) {
    const row = await done(os.get(key));
    if (row) found.set(key, row.item);
  }
  return found;
}

export async function putScores(entries) {
  const os = await store('scores', 'readwrite');
  for (const { key, item } of entries) await done(os.put({ key, item, at: new Date().toISOString() }));
}
