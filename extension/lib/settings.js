// User settings, kept in chrome.storage.local only: the LLM key never syncs.

export const DEFAULTS = {
  llmUrl: '',
  llmKey: '',
  llmModel: '',
  interests: '',
  // Scoring with the LLM is shared by both sites; the rules below are per site.
  scoreEnabled: true, // off: rule-based hiding only, no LLM calls
  hideBelow: 4, // posts scored under this are hidden
  showBadges: true,
  holdUntilScored: false, // hide a post until its score arrives instead of showing it meanwhile
  filterModel: '', // empty: use llmModel; a fast model suits live filtering
  fbEnabled: true,
  fbHideAds: true,
  fbHideVideos: true, // videos and reels
  fbHideFriendSuggestions: false, // "People you may know" blocks
  fbHideSuggested: false, // "Suggested for you" posts
  fbHideNotFollowed: false, // posts from pages the person does not follow
  fbHideGroupSuggestions: false, // blocks recommending groups, and posts from groups the person has not joined
  xEnabled: true,
  xHideAds: true,
  xHideVideos: false,
  xHideGrok: true, // posts asking @grok and Grok's own replies
  remoteOpsUrl: 'https://gist.githubusercontent.com/namtao/e88f19c9790479f84d21da4392c896bd/raw/ops.json',
};

// Earlier default config URLs that no longer serve the file; a saved one moves to the current default.
const RETIRED_REMOTE_URLS = ['https://raw.githubusercontent.com/namtao/auto-social-networks/main/extension/ops.json'];

// Settings saved before the rules were split per site: filterEnabled/hideAds/... applied to Facebook
// (and to X where they made sense). Copied once so nobody has to choose again.
const LEGACY = {
  filterEnabled: ['fbEnabled', 'xEnabled'],
  hideAds: ['fbHideAds', 'xHideAds'],
  hideVideos: ['fbHideVideos', 'xHideVideos'],
  hideFriendSuggestions: ['fbHideFriendSuggestions'],
  hideSuggested: ['fbHideSuggested'],
  hideNotFollowed: ['fbHideNotFollowed'],
};

function migrate(saved) {
  const out = { ...saved };
  // "Pages and groups not followed" used to cover groups too; the group half is now its own setting.
  if (saved.fbHideGroupSuggestions === undefined) {
    const old = saved.fbHideNotFollowed ?? saved.hideNotFollowed;
    if (old !== undefined) out.fbHideGroupSuggestions = old;
  }
  for (const [old, keys] of Object.entries(LEGACY)) {
    if (saved[old] === undefined) continue;
    for (const k of keys) if (saved[k] === undefined) out[k] = saved[old];
    delete out[old];
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...migrate(settings || {}) };
  if (RETIRED_REMOTE_URLS.includes(s.remoteOpsUrl)) s.remoteOpsUrl = DEFAULTS.remoteOpsUrl;
  return s;
}

// Saves read the whole object and write it back, so two at once (a number box losing focus as a switch
// is clicked) would overwrite each other. They run one after the other instead.
let saving = Promise.resolve();

export function saveSettings(patch) {
  const run = saving.then(() => write(patch));
  saving = run.catch(() => {});
  return run;
}

async function write(patch) {
  const s = { ...(await getSettings()), ...patch };
  s.llmUrl = String(s.llmUrl || '').trim().replace(/\/+$/, '');
  const below = parseInt(s.hideBelow, 10);
  s.hideBelow = Math.min(10, Math.max(0, Number.isNaN(below) ? DEFAULTS.hideBelow : below));
  // Only known keys are kept, which also drops the settings of features that no longer exist.
  const clean = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, s[k]]));
  await chrome.storage.local.set({ settings: clean });
  return clean;
}

// LLM scoring runs once the person has given an endpoint and a model; a local router often needs no key.
export const llmReady = (s) => !!(s.llmUrl && s.llmModel);
