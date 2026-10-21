// Runs inside Facebook and X while the person browses. It hides what does not suit them and badges
// the rest with the LLM's score. It only reads the page and sets attributes; it sends no request to
// the site. Scoring goes to the extension's service worker, which asks the person's LLM.
(() => {
  'use strict';

  const MIN_TEXT = 20; // shorter is a skeleton or a bare photo: nothing to score yet
  const MAX_TEXT = 3000;
  const MAX_BATCH = 16;
  const FLUSH_MS = 250;
  const SCAN_MS = 40; // a new post is classified within a frame or two, so it does not flash before it is hidden
  const SETTLE_MS = 5000; // Facebook fills a post in after it appears; its flags are re-read only this long
  const PENDING_MS = 25000; // a post is shown unscored if its score has not come back by then

  // FB scrambles its "Sponsored" label; in innerText it collapses to a line holding only a WORD JOINER
  // where an organic post shows its timestamp.
  const SPONSORED = /^[ \t]*⁠[ \t]*$|^\s*(sponsored|được tài trợ)\s*$/im;

  // X marks an ad with a small "Ad" label; a tweet asking Grok contains an @grok mention.
  const X_AD = /^\s*(ad|promoted|quảng cáo|được quảng bá|được tài trợ)\s*$/im;
  const GROK_MENTION = /(^|[\s(])@grok\b/i;

  // Labels Facebook puts on posts it pushes at the person, and on the follow button of a page they do not follow.
  const SUGGESTED = /^\s*(gợi ý cho bạn|suggested for you)\s*$/im;
  const FRIEND_SUGGESTION = /^\s*(những người bạn có thể biết|people you may know)\s*$/im;
  // A follow/join button sits in the post header: found as a button near the top of the post, which is
  // robust to how the header text is laid out, with the first text lines as a fallback.
  // "Follow" belongs to a page the person has not followed; "Join" to a group they are not in.
  const FOLLOW_LABEL = /^(theo dõi|follow)$/i;
  const FOLLOW_LINE = /(^|\n|·\s*)(theo dõi|follow)\s*(\n|$)/i;
  const JOIN_LABEL = /^(tham gia( nhóm)?|join( group)?)$/i;
  const JOIN_LINE = /(^|\n|·\s*)(tham gia|join)\s*(\n|$)/i;
  // The heading of a block that recommends groups ("Gợi ý nhóm" on a Vietnamese account).
  const GROUP_SUGGESTION = /^\s*(gợi ý nhóm|nhóm gợi ý cho bạn|nhóm gợi ý|nhóm bạn có thể (thích|quan tâm|tham gia)|groups you (may|might) (like|be interested in|want to join)|suggested groups|discover groups|khám phá nhóm)\s*$/im;
  const HEADER_PX = 72;
  const HEADER_CHARS = 120;

  // The group carousel puts a join button and a "remove suggestion" button on every card, not in a header.
  const REMOVE_SUGGESTED_GROUP = '[aria-label^="Gỡ nhóm gợi ý"], [aria-label^="Remove suggested group"]';
  const JOIN_BUTTON = '[aria-label="Tham gia nhóm"], [aria-label="Join group"]';

  // Buttons and links in the top of a post, for the follow/join rules and the diagnostic report.
  function headerButtons(el) {
    const top = el.getBoundingClientRect().top;
    const out = [];
    for (const b of el.querySelectorAll('[role="button"], a, button')) {
      const r = b.getBoundingClientRect();
      if (!r.height || r.top - top > HEADER_PX) continue;
      const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
      if (label && label.length <= 40) out.push(label);
    }
    return out;
  }
  // A rule that matches more than this share of the posts on a page (with enough posts to judge) is
  // taken to be misreading the page, not finding that many ads: it is skipped and the pill says so.
  const SUSPECT_MIN_POSTS = 6;
  const SUSPECT_SHARE = 0.6;

  // Keep only the outermost match so comments (also role="article") are not treated as posts.
  const outermost = (selector) => {
    const nodes = [...document.querySelectorAll(selector)];
    const set = new Set(nodes);
    return nodes.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  };

  // A wrapper holding several posts (each marked aria-posinset) is not itself a post: one video in it
  // would hide the whole feed. Use the posts inside it instead.
  function expand(el) {
    const inner = [...el.querySelectorAll('[aria-posinset]')];
    if (inner.length < 3) return [el];
    const set = new Set(inner);
    return inner.filter((n) => {
      for (let p = n.parentElement; p && p !== el; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  const FACEBOOK = {
    active: () => !/^\/(watch|reel|reels|videos|marketplace|messages|stories|gaming|events|photo|photos|settings|notifications|bookmarks|ads)(\/|$)/.test(location.pathname),
    posts: () => outermost('[role="feed"] > div, [aria-posinset], [role="article"]').flatMap(expand),
    isAd: (el, text) => SPONSORED.test(text),
    isVideo: (el) => !!el.querySelector('video, a[href*="/reel/"], a[href*="/reels/"], a[href*="/videos/"], a[href*="/watch/?v="], a[href*="/watch?v="]'),
    isSuggested: (el, text) => SUGGESTED.test(text),
    isFriendSuggestion: (el, text) => FRIEND_SUGGESTION.test(text),
    isNotFollowed: (el, text) => headerButtons(el).some((l) => FOLLOW_LABEL.test(l)) || FOLLOW_LINE.test(text.slice(0, HEADER_CHARS)),
    isGroupSuggestion: (el, text) => GROUP_SUGGESTION.test(text) || !!el.querySelector(REMOVE_SUGGESTED_GROUP)
      || el.querySelectorAll(JOIN_BUTTON).length >= 2 || headerButtons(el).some((l) => JOIN_LABEL.test(l))
      || JOIN_LINE.test(text.slice(0, HEADER_CHARS)),
  };
  // Selectors for X are from its public markup and have not been checked against a logged-in session.
  const X = {
    active: () => !/\/status\/\d+/.test(location.pathname) && !/^\/(i|messages|notifications|settings|compose)(\/|$)/.test(location.pathname),
    posts: () => outermost('article[data-testid="tweet"]'),
    // X's timeline is a virtual list of cells: hiding the cell, not just the tweet, leaves no gap.
    box: (el) => el.closest('[data-testid="cellInnerDiv"]') || el,
    // The list may reuse a cell's element for another tweet; the permalink tells.
    sig: (el) => el.querySelector('a[href*="/status/"]')?.getAttribute('href') || '',
    isAd: (el, text) => !!el.querySelector('[data-testid="placementTracking"]') || X_AD.test(text),
    isVideo: (el) => !!el.querySelector('[data-testid="videoPlayer"], video'),
    isGrok: (el, text) => GROK_MENTION.test(text) || !!el.querySelector('[data-testid="User-Name"] a[href="/grok"]'),
  };
  const SITES = { 'www.facebook.com': FACEBOOK, 'x.com': X, 'twitter.com': X };
  const site = SITES[location.hostname];
  if (!site) return;

  const PLATFORM = site === X ? 'x' : 'fb';
  let cfg = null; // filter settings from the extension; the page does nothing until they arrive
  let seq = 0;
  let dead = false;
  let lastError = '';
  let pill = null;
  const suspect = new Set(); // rule kinds currently skipped because they match too many posts
  const states = new Map(); // post element -> state
  const byId = new Map(); // id sent to the service worker -> state
  const queue = [];
  let flushTimer = null;
  let scanTimer = null;

  // --- Talking to the extension -------------------------------------------------------------------

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (err) {
      // After the extension is reloaded or updated, this copy of the script is orphaned.
      if (/context invalidated/i.test(err.message)) shutdown();
      throw err;
    }
  }

  function shutdown() {
    dead = true;
    observer.disconnect();
    for (const st of states.values()) {
      st.box.removeAttribute('data-loctin');
      st.el.removeAttribute('data-loctin-score');
      st.el.removeAttribute('data-loctin-tone');
    }
    pill?.remove();
  }

  async function loadConfig() {
    const next = await send({ type: 'filter-settings', platform: PLATFORM });
    if (next?.ok) cfg = next.settings;
  }

  // --- Deciding what to show ----------------------------------------------------------------------

  // The score from the LLM, only while scoring is switched on.
  const scoreOf = (st) => (cfg.scoring && cfg.llm ? st.result : null);

  // What the page itself gives away, with no LLM involved.
  function ruleDecision(st) {
    if (!cfg.enabled) return null;
    const r = scoreOf(st);
    const found = (kind, flag) => st[flag] && !suspect.has(kind);
    if (cfg.hideAds && (found('ad', 'ad') || r?.is_ad)) return 'ad';
    if (cfg.hideVideos && found('video', 'video')) return 'video';
    if (cfg.hideGrok && found('grok', 'grok')) return 'grok';
    if (cfg.hideFriendSuggestions && found('friends', 'friendSuggestion')) return 'friends';
    if (cfg.hideSuggested && (found('suggested', 'suggested') || r?.is_suggested)) return 'suggested';
    if (cfg.hideNotFollowed && found('notFollowed', 'notFollowed')) return 'notFollowed';
    if (cfg.hideGroupSuggestions && found('groupSuggestion', 'groupSuggestion')) return 'groupSuggestion';
    return null;
  }

  const FLAG_OF = { ad: 'ad', video: 'video', grok: 'grok', friends: 'friendSuggestion', suggested: 'suggested', notFollowed: 'notFollowed', groupSuggestion: 'groupSuggestion' };

  // Updates `suspect` from the flags found so far; true when it changed.
  function checkSuspect() {
    const all = [...states.values()];
    let changed = false;
    for (const [kind, flag] of Object.entries(FLAG_OF)) {
      const bad = all.length >= SUSPECT_MIN_POSTS && all.filter((s) => s[flag]).length / all.length > SUSPECT_SHARE;
      if (bad === suspect.has(kind)) continue;
      if (bad) suspect.add(kind); else suspect.delete(kind);
      changed = true;
    }
    return changed;
  }

  // Why a post is hidden (a key of HIDDEN_BY), or null to show it. A hidden post leaves no trace in the
  // feed; the pill lists what was hidden.
  function decide(st) {
    if (!cfg.enabled) return null;
    const rule = ruleDecision(st);
    if (rule) return rule;
    const r = scoreOf(st);
    if (r && r.score < cfg.hideBelow) return 'lowScore';
    if (!r && st.status === 'pending' && cfg.scoring && cfg.holdUntilScored) return 'pending';
    return null;
  }

  const HIDDEN_BY = {
    ad: 'quảng cáo', video: 'video/reel', grok: 'bài hỏi Grok', friends: 'gợi ý kết bạn', suggested: 'bài gợi ý',
    notFollowed: 'bài từ trang chưa theo dõi', groupSuggestion: 'gợi ý nhóm', lowScore: 'bài điểm thấp', pending: 'bài đang chấm điểm',
  };

  const tone = (score) => (score >= 7 ? 'good' : score >= cfg.hideBelow ? 'mid' : 'low');

  function apply(st) {
    const d = decide(st);
    st.hidden = d;
    st.box.setAttribute('data-loctin', d ? 'hidden' : '');
    const r = scoreOf(st);
    if (!d && cfg.enabled && cfg.showBadges && r) {
      st.el.setAttribute('data-loctin-score', r.score);
      st.el.setAttribute('data-loctin-tone', tone(r.score));
    } else {
      st.el.removeAttribute('data-loctin-score');
      st.el.removeAttribute('data-loctin-tone');
    }
  }

  // The pill is shown from the moment the script starts, so a person can tell it is running (and why
  // nothing is happening) instead of guessing.
  function showPill(text, title) {
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'loctin-pill';
      pill.addEventListener('click', () => { if (cfg) send({ type: 'filter-set', platform: PLATFORM, enabled: !cfg.enabled }).catch(() => {}); });
      pill.addEventListener('contextmenu', (e) => { e.preventDefault(); copyReport(); });
      document.documentElement.append(pill);
    }
    pill.textContent = text;
    pill.title = title;
  }

  // What the script sees in the first posts, for working out why a rule misses on the real page: each
  // post's flags, the start of its text, and the buttons in its header. Copied to the clipboard.
  async function copyReport() {
    const lines = [`FeedSift ${location.hostname}${location.pathname} · ${states.size} bài · cfg ${JSON.stringify(cfg)}`];
    let n = 0;
    for (const st of states.values()) {
      if (n++ >= 15) break;
      const flags = Object.keys(FLAG_OF).filter((k) => st[FLAG_OF[k]]).join(',') || '-';
      const head = st.text.slice(0, 100).replace(/\n/g, ' ⏎ ');
      lines.push(`#${n} ẩn=${st.hidden || '-'} cờ=${flags} nút=[${headerButtons(st.el).join(' | ')}] chữ="${head}"`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showPill('FeedSift · đã chép báo cáo', 'Dán báo cáo cho Claude. Báo cáo có 100 ký tự đầu của 15 bài đầu: xem lại và xóa tên nếu cần.');
    } catch (err) {
      showPill('FeedSift · ⚠ không chép được', err.message);
    }
    setTimeout(updatePill, 3000);
  }

  function updatePill() {
    if (!cfg) return;
    const counts = {};
    for (const st of states.values()) if (st.hidden) counts[st.hidden] = (counts[st.hidden] || 0) + 1;
    const hidden = Object.values(counts).reduce((a, b) => a + b, 0);
    const summary = Object.entries(counts).map(([k, n]) => `${n} ${HIDDEN_BY[k]}`).join(', ');
    const where = site.active() ? `${states.size} bài` : 'trang này không lọc';
    const skipped = [...suspect].map((k) => `quy tắc “${HIDDEN_BY[k]}” khớp quá nhiều bài nên đã bỏ qua (giao diện có thể đã đổi)`);
    showPill(!cfg.enabled ? 'FeedSift · tắt' : `FeedSift · ẩn ${hidden}/${where}${lastError || skipped.length ? ' · ⚠' : ''}`,
      lastError || (skipped.length ? `${skipped.join('; ')}. ` : '') + (summary ? `Đã ẩn: ${summary}. ` : '') + (cfg.enabled && !cfg.scoring ? 'Chấm điểm đang tắt: chỉ ẩn theo quy tắc. ' : '')
        + (cfg.enabled && cfg.scoring && !cfg.llm ? 'Chưa cấu hình LLM nên chưa chấm điểm. ' : '')
        + (cfg.enabled ? 'Bấm để tắt lọc. ' : 'Bấm để bật lọc. ') + 'Chuột phải để chép báo cáo chẩn đoán.');
  }

  // --- Scoring ------------------------------------------------------------------------------------

  function wantsScore(st) {
    return cfg.enabled && cfg.scoring && cfg.llm && !st.result && st.status === 'idle' && !ruleDecision(st);
  }

  function enqueue(st) {
    st.status = 'pending';
    byId.set(st.id, st);
    queue.push(st);
    setTimeout(() => {
      if (!st.result && st.status === 'pending') { st.status = 'failed'; apply(st); updatePill(); }
    }, PENDING_MS);
    flushTimer ??= setTimeout(flush, FLUSH_MS);
  }

  async function flush() {
    flushTimer = null;
    const batch = queue.splice(0, MAX_BATCH);
    if (queue.length) flushTimer = setTimeout(flush, FLUSH_MS);
    if (!batch.length) return;
    try {
      const res = await send({ type: 'score', posts: batch.map((st) => ({ id: st.id, text: st.text })) });
      if (!res?.ok) throw new Error(res?.error || 'Extension không phản hồi');
      lastError = '';
      for (const item of res.items) {
        const st = byId.get(item.id);
        if (st) { st.result = item; st.status = 'done'; }
      }
    } catch (err) {
      lastError = `Không chấm điểm được: ${err.message}`;
    }
    for (const st of batch) {
      if (!st.result) st.status = 'failed';
      byId.delete(st.id);
      apply(st);
    }
    updatePill();
  }

  // --- Walking the page ---------------------------------------------------------------------------

  function scan() {
    scanTimer = null;
    if (dead || !cfg) return;
    for (const [el, st] of states) {
      if (el.isConnected) continue;
      byId.delete(st.id);
      states.delete(el);
    }
    if (site.active()) {
      // First read every post and its flags, then judge the whole page, then apply: a rule that
      // misreads the page must not flash posts away before it is noticed.
      const touched = new Set();
      for (const el of site.posts()) {
        let st = states.get(el);
        if (st && site.sig && site.sig(el) !== st.sig && site.sig(el)) {
          st.box.removeAttribute('data-loctin'); // the element now shows another post
          byId.delete(st.id);
          states.delete(el);
          st = undefined;
        }
        const text = st ? '' : el.innerText.trim();
        if (!st && text.length < MIN_TEXT) continue;
        if (!st) {
          st = {
            el, box: site.box?.(el) || el, sig: site.sig?.(el) || '', id: ++seq, text: text.slice(0, MAX_TEXT), seen: Date.now(),
            ad: false, video: false, grok: false, suggested: false,
            friendSuggestion: false, notFollowed: false, groupSuggestion: false, result: null, status: 'idle', hidden: null,
          };
          states.set(el, st);
          touched.add(st);
        } else if (Date.now() - st.seen > SETTLE_MS) {
          continue; // settled: reading it again on every scroll would only cost time
        } else {
          // Facebook fills in labels, buttons and video players after the post first appears.
          st.text = el.innerText.trim().slice(0, MAX_TEXT);
        }
        const flags = {
          ad: st.ad || site.isAd(el, st.text),
          video: st.video || site.isVideo(el),
          grok: st.grok || !!site.isGrok?.(el, st.text),
          suggested: st.suggested || !!site.isSuggested?.(el, st.text),
          friendSuggestion: st.friendSuggestion || !!site.isFriendSuggestion?.(el, st.text),
          notFollowed: st.notFollowed || !!site.isNotFollowed?.(el, st.text),
          groupSuggestion: st.groupSuggestion || !!site.isGroupSuggestion?.(el, st.text),
        };
        if (Object.keys(flags).some((k) => flags[k] !== st[k])) touched.add(st);
        Object.assign(st, flags);
      }
      const everything = checkSuspect();
      for (const st of states.values()) {
        if (!everything && !touched.has(st) && st.box.hasAttribute('data-loctin')) continue;
        if (wantsScore(st)) enqueue(st);
        apply(st);
      }
    }
    updatePill();
  }

  const schedule = () => { if (!scanTimer && !dead) scanTimer = setTimeout(scan, SCAN_MS); };
  const observer = new MutationObserver(schedule);

  function reapply() {
    for (const st of states.values()) {
      if (wantsScore(st)) enqueue(st);
      apply(st);
    }
    updatePill();
    schedule();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings && !dead) loadConfig().then(reapply).catch(() => {});
  });

  showPill('FeedSift · đang khởi động…', '');
  loadConfig().then(() => {
    if (!cfg) return showPill('FeedSift · ⚠ không đọc được cài đặt', 'Extension không trả cài đặt: thử tải lại extension rồi tải lại trang.');
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }).catch((err) => {
    if (!dead) showPill('FeedSift · ⚠ không kết nối được extension', `${err.message}. Tải lại extension ở chrome://extensions rồi tải lại trang.`);
  });
})();
