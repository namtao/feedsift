const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const daysText = (d) => d == null ? '' : d < 1 ? 'hôm nay' : `${Math.round(d)} ngày trước`;
const avatar = (r, square) => r.avatar ? `<img class="av${square ? ' square' : ''}" src="${esc(r.avatar)}" loading="lazy" referrerpolicy="no-referrer" alt="">` : '<span class="av"></span>';
const nameLink = (r) => r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name);

const KINDS = {
  friends: {
    label: 'Bạn bè', actions: { unfriend: { label: 'Hủy kết bạn', danger: true } }, search: ['name'],
    columns: [
      { key: 'avatar', label: '', nosort: true, render: (r) => avatar(r) },
      { key: 'name', label: 'Tên', render: nameLink },
      { key: 'locked', label: 'Trạng thái', render: (r) => r.locked ? '<span class="badge">Đã khóa</span>' : '' },
      { key: 'mutual', label: 'Bạn chung', num: true },
      { key: 'gender', label: 'Giới tính' },
      { key: 'id', label: 'ID' },
    ],
    filters: [
      { type: 'check', key: 'locked', label: 'Chỉ tài khoản đã khóa' },
      { type: 'max', key: 'mutual', label: 'Bạn chung ≤' },
      { type: 'select', key: 'gender', label: 'Giới tính' },
    ],
  },
  pages: {
    label: 'Trang', actions: { unfollow_page: { label: 'Bỏ theo dõi', danger: true } }, search: ['name', 'category'],
    columns: [
      { key: 'avatar', label: '', nosort: true, render: (r) => avatar(r) },
      { key: 'name', label: 'Tên', render: nameLink },
      { key: 'category', label: 'Loại trang' },
      { key: 'liked', label: 'Đã thích', render: (r) => r.liked ? '✓' : '' },
      { key: 'verified', label: 'Xác minh', render: (r) => r.verified ? '✓' : '' },
      { key: 'id', label: 'ID' },
    ],
    filters: [
      { type: 'select', key: 'category', label: 'Loại' },
    ],
  },
  groups: {
    label: 'Nhóm', search: ['name'],
    // "flag" is set on a row once the action succeeded; the row then stays in the list.
    actions: {
      leave_group: { label: 'Rời nhóm', danger: true },
      unfollow_group: { label: 'Bỏ theo dõi', flag: 'unfollowed' },
      mute_group: { label: 'Tắt thông báo', flag: 'muted' },
    },
    columns: [
      { key: 'avatar', label: '', nosort: true, render: (r) => avatar(r, true) },
      { key: 'name', label: 'Tên', wrap: true, render: nameLink },
      { key: 'visited_days', label: 'Bạn vào lần cuối', num: true, render: (r) => esc(r.visited) },
      { key: 'last_post_days', label: 'Bài mới nhất', num: true, render: (r) => daysText(r.last_post_days) },
      { key: 'admin', label: 'Quản trị', render: (r) => r.admin ? '✓' : '' },
      { key: 'unfollowed', label: 'Đã bỏ theo dõi', render: (r) => r.unfollowed ? '✓' : '' },
      { key: 'muted', label: 'Đã tắt thông báo', render: (r) => r.muted ? '✓' : '' },
      { key: 'id', label: 'ID' },
    ],
    filters: [
      { type: 'min', key: 'visited_days', label: 'Không vào ≥ (ngày)' },
      { type: 'min', key: 'last_post_days', label: 'Không có bài mới ≥ (ngày)' },
    ],
  },
};

// Settings pages, grouped by what they apply to: both sites, Facebook only, X only.
const PAGES = {
  common: { label: 'Chung', hint: 'Facebook và X', scope: 'both', mark: '✱', title: 'Cài đặt chung', scopeText: 'Áp dụng cho cả Facebook và X',
            sub: 'Chấm điểm bằng AI, kết nối AI và sở thích. Các quy tắc ẩn bài nằm ở mục Facebook và X.' },
  fb: { label: 'Facebook', hint: 'Lọc khi lướt', scope: 'fb', mark: 'f', title: 'Lọc trên Facebook', scopeText: 'Chỉ áp dụng khi lướt facebook.com',
        sub: 'Chọn loại bài cần ẩn ngay trên feed.' },
  x: { label: 'X (Twitter)', hint: 'Lọc khi lướt', scope: 'x', mark: 'X', title: 'Lọc trên X', scopeText: 'Chỉ áp dụng khi lướt x.com',
       sub: 'Chọn loại bài cần ẩn ngay trên dòng thời gian.' },
  conn: { label: 'Kết nối và an toàn', hint: 'Cho Bạn bè, Trang, Nhóm', scope: 'fb', mark: 'f', title: 'Kết nối và an toàn', scopeText: 'Chỉ áp dụng cho các mục quản lý Facebook',
          sub: 'Thời gian nghỉ khi Facebook phản ứng và mã thao tác doc_id.' },
};
const LIST_META = { friends: 'Hủy kết bạn', pages: 'Bỏ theo dõi trang', groups: 'Rời nhóm, tắt thông báo' };
const isSettings = (k) => k in PAGES;

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
// Open on the first settings page; the filters typed in the lists are remembered per tab.
const state = { kind: 'common', mode: store.get('mode', 'row'), data: {}, selected: {}, sort: {}, filters: {}, search: '' };
for (const [k, v] of Object.entries(KINDS)) {
  state.selected[k] = new Set();
  state.sort[k] = v.sort || { key: 'name', dir: 1 };
  state.filters[k] = Object.fromEntries(v.filters.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
}
try { const saved = JSON.parse(store.get('filters', '{}')); for (const k in saved) if (KINDS[k]) Object.assign(state.filters[k], saved[k]); } catch {}
let jobRunning = false;

// Every Facebook call runs in the service worker (background.js), which answers {ok, data, error}.
async function api(path, body) {
  const res = await chrome.runtime.sendMessage({ path, body });
  if (!res?.ok) throw new Error(res?.error || 'Extension không phản hồi');
  return res.data;
}
function showError(msg) { $('error').hidden = !msg; $('error').textContent = msg || ''; }

function rows() {
  const kind = KINDS[state.kind], f = state.filters[state.kind];
  const q = state.search.trim().toLowerCase();
  const items = (state.data[state.kind]?.items || []).filter((r) => {
    if (q && !kind.search.some((k) => String(r[k] ?? '').toLowerCase().includes(q))) return false;
    for (const flt of kind.filters) {
      const v = f[flt.key ?? flt.type];
      if (v === undefined || v === '' || v === false) continue;
      const x = r[flt.key];
      if (flt.type === 'check' && !x) return false;
      if (flt.type === 'not' && x) return false;
      if (flt.type === 'max' && (x == null || x > +v)) return false;
      if (flt.type === 'min' && (x == null || x < +v)) return false;
      if (flt.type === 'select' && x !== v) return false;
    }
    return true;
  });
  const { key, dir } = state.sort[state.kind];
  const val = (r) => (typeof r[key] === 'boolean' ? +r[key] : r[key]);
  return items.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'vi')) * dir;
  });
}

function renderFilters() {
  if (!KINDS[state.kind]) return;
  const kind = KINDS[state.kind], f = state.filters[state.kind];
  const items = state.data[state.kind]?.items || [];
  $('filters').innerHTML = kind.filters.map((flt) => {
    const key = flt.key ?? flt.type;
    if (['check', 'not'].includes(flt.type)) return `<label class="filter"><input type="checkbox" data-filter="${key}" ${f[key] ? 'checked' : ''}> ${flt.label}</label>`;
    if (flt.type === 'select') {
      const opts = [...new Set(items.map((r) => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
      return `<label class="filter">${flt.label} <select data-filter="${key}"><option value="">Tất cả</option>${opts.map((o) => `<option ${o === f[key] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    }
    return `<label class="filter">${flt.label} <input type="number" min="0" data-filter="${key}" value="${esc(f[key] ?? '')}"></label>`;
  }).join(' ');
}

function renderTabs() {
  const item = (k, label, hint, scope, mark, n) => `<button class="tab" role="tab" data-kind="${k}" aria-selected="${k === state.kind}">`
    + `<span class="mark ${scope}">${mark}</span><span>${label}<small>${hint}</small></span>${n != null ? `<span class="n">${n}</span>` : ''}</button>`;
  const page = (k) => item(k, PAGES[k].label, PAGES[k].hint, PAGES[k].scope, PAGES[k].mark);
  const list = (k) => item(k, KINDS[k].label, LIST_META[k], 'fb', 'f', state.data[k]?.items?.length);
  $('tabs').innerHTML = '<div class="navgroup">Bộ lọc khi lướt</div>' + page('common') + page('fb') + page('x')
    + '<div class="navgroup">Quản lý Facebook</div>' + Object.keys(KINDS).map(list).join('') + page('conn');
}

function renderHead() {
  const p = PAGES[state.kind];
  const [title, scope, mark, sub, text] = p
    ? [p.title, p.scope, p.mark, p.sub, p.scopeText]
    : [KINDS[state.kind].label, 'fb', 'f', LIST_META[state.kind] + '. Tải danh sách từ Facebook rồi lọc và dọn.', 'Chỉ áp dụng cho Facebook'];
  $('pagehead').innerHTML = `<span class="mark ${scope}">${mark}</span><div><h1>${esc(title)}</h1><p class="meta">${esc(sub)}</p><span class="scope ${scope}">${esc(text)}</span></div>`;
}

function render() {
  renderTabs();
  renderHead();
  const settingsView = isSettings(state.kind);
  $('list-view').hidden = settingsView;
  $('settings').hidden = !settingsView;
  for (const el of document.querySelectorAll('[data-page]')) el.hidden = el.dataset.page !== state.kind;
  $('mode').hidden = $('mode-label').hidden = settingsView;
  if (settingsView) return;
  const kind = KINDS[state.kind], list = rows(), sel = state.selected[state.kind];
  const data = state.data[state.kind];
  const bulk = state.mode === 'bulk';
  const rowActions = state.mode === 'row';
  for (const b of $('mode').children) b.setAttribute('aria-pressed', b.dataset.mode === state.mode);
  $('bulk-box').hidden = !bulk;
  $('updated').textContent = data?.updated ? 'Cập nhật: ' + new Date(data.updated).toLocaleString('vi-VN') : '';

  const { key, dir } = state.sort[state.kind];
  const cols = kind.columns;
  const head = [];
  if (bulk) head.push(`<th class="nosort"><input type="checkbox" id="check-all" ${list.length && list.every((r) => sel.has(r.id)) ? 'checked' : ''} aria-label="Chọn tất cả"></th>`);
  head.push(...cols.map((c) => `<th ${c.nosort ? 'class="nosort"' : `data-sort="${c.key}" class="${c.num ? 'num' : ''}"`}>${c.label}${c.key === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`));
  if (rowActions) head.push('<th class="nosort actions"></th>');
  $('thead').innerHTML = `<tr>${head.join('')}</tr>`;

  const span = head.length;
  if (!data?.items?.length) {
    $('tbody').innerHTML = `<tr><td colspan="${span}" class="empty">${data?.updated ? 'Không có mục nào.' : 'Chưa có dữ liệu. Bấm “Làm mới” để tải từ Facebook.'}</td></tr>`;
  } else if (!list.length) {
    $('tbody').innerHTML = `<tr><td colspan="${span}" class="empty">Không có mục nào khớp bộ lọc.</td></tr>`;
  } else {
    $('tbody').innerHTML = list.map((r) => {
      const cells = [];
      if (bulk) cells.push(`<td><input type="checkbox" data-select ${sel.has(r.id) ? 'checked' : ''}></td>`);
      cells.push(...cols.map((c) => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`));
      if (rowActions) cells.push(`<td class="actions">${Object.entries(kind.actions).map(([m, a]) =>
        `<button class="btn small ${a.danger ? 'outline-danger' : ''}" data-act="${m}" ${jobRunning || r[a.flag] ? 'disabled' : ''}>${a.label}</button>`).join(' ')}</td>`);
      return `<tr class="${bulk && sel.has(r.id) ? 'selected' : ''}" data-id="${esc(r.id)}">${cells.join('')}</tr>`;
    }).join('');
  }
  const total = data?.items?.length || 0;
  $('count').textContent = `Hiển thị ${list.length}/${total}` + (bulk ? ` · Đã chọn ${sel.size}` : '');
  $('acts').innerHTML = Object.entries(kind.actions || {}).map(([m, a]) =>
    `<button class="btn ${a.danger ? 'danger' : ''}" data-act="${m}" ${!sel.size || jobRunning ? 'disabled' : ''}>${a.label}${sel.size ? ` (${sel.size})` : ''}</button>`).join(' ');
}

async function pollJob() {
  const job = await api('job');
  jobRunning = job.running;
  $('job').hidden = !job.label;
  if (job.label) {
    $('job-text').textContent = job.running
      ? `${job.label}: ${job.done}/${job.total}${job.current ? ' · ' + job.current : ''}`
      : `${job.label}: xong ${job.done}/${job.total}` + (job.summary ? ` · ${job.summary}` : '') +
        (job.error ? ` · dừng do lỗi: ${job.error}` : job.done < job.total ? ' · đã dừng' : '');
    $('job-bar').style.width = (job.total ? (100 * job.done) / job.total : 0) + '%';
    $('job-cancel').hidden = !job.running;
  }
  if (job.kind && !job.running && pollJob.wasRunning) { await load(job.kind); renderFilters(); }
  pollJob.wasRunning = job.running;
  render();
  if (job.running) setTimeout(pollJob, 1500);
}

async function load(kind) {
  const data = await api(kind);
  state.data[kind] = data;
  const ids = new Set(data.items.map((r) => r.id));
  state.selected[kind] = new Set([...state.selected[kind]].filter((id) => ids.has(id)));
}
async function runAction(method, ids, what) {
  const action = KINDS[state.kind].actions[method];
  const notes = [action.danger && 'Không hoàn tác được.', 'Tối đa 10 thao tác mỗi ngày.',
                 ids.length > 1 && 'Mỗi thao tác cách nhau 30–90 giây; tác vụ tự dừng nếu Facebook báo lỗi.'].filter(Boolean);
  if (!confirm(`${action.label} ${what}?` + (notes.length ? '\n\n' + notes.join(' ') : ''))) return;
  showError('');
  try { await api(`${state.kind}/action`, { method, ids }); state.selected[state.kind].clear(); pollJob(); }
  catch (err) { showError(err.message); }
}

function goTo(k) {
  state.kind = k;
  if (isSettings(k)) loadSettings().catch((err) => showError(err.message));
  else renderFilters();
  render();
}
$('tabs').addEventListener('click', (e) => {
  const k = e.target.closest('[data-kind]')?.dataset.kind;
  if (k) goTo(k);
});
document.addEventListener('click', (e) => {
  const k = e.target.closest('[data-goto]')?.dataset.goto;
  if (k) { e.preventDefault(); goTo(k); }
});
// Avatars from Facebook's CDN expire; hide a broken one instead of showing the browser's icon.
document.addEventListener('error', (e) => { if (e.target.classList?.contains('av')) e.target.style.visibility = 'hidden'; }, true);
$('mode').addEventListener('click', (e) => {
  const m = e.target.closest('[data-mode]')?.dataset.mode;
  if (!m) return;
  state.mode = m; store.set('mode', m); render();
});
$('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('filters').addEventListener('input', (e) => {
  const el = e.target.closest('[data-filter]');
  if (!el) return;
  state.filters[state.kind][el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
  store.set('filters', JSON.stringify(state.filters));
  render();
});
$('thead').addEventListener('click', (e) => {
  if (e.target.id === 'check-all') {
    const sel = state.selected[state.kind];
    for (const r of rows()) e.target.checked ? sel.add(r.id) : sel.delete(r.id);
    return render();
  }
  let key = e.target.closest('[data-sort]')?.dataset.sort;
  if (!key) return;
  const s = state.sort[state.kind];
  state.sort[state.kind] = { key, dir: s.key === key ? -s.dir : 1 };
  render();
});
$('tbody').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.dataset.id, row = state.data[state.kind].items.find((r) => String(r.id) === id);
  const act = e.target.closest('[data-act]');
  if (act) return runAction(act.dataset.act, [id], `“${row.name}”`);
  if (state.mode !== 'bulk') return;
  const sel = state.selected[state.kind];
  sel.has(id) ? sel.delete(id) : sel.add(id);
  render();
});
$('acts').addEventListener('click', (e) => {
  const m = e.target.closest('[data-act]')?.dataset.act;
  if (m) runAction(m, [...state.selected[state.kind]], `${state.selected[state.kind].size} mục`);
});
$('refresh').addEventListener('click', async () => {
  const btn = $('refresh'), kind = state.kind;
  btn.disabled = true; btn.textContent = 'Đang tải từ Facebook…'; showError('');
  try {
    await api(`${kind}/refresh`, {});
    await load(kind); renderFilters();
  } catch (err) { showError('Làm mới lỗi: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Làm mới'; render(); }
});
$('export').addEventListener('click', () => {
  const kind = KINDS[state.kind], sel = state.selected[state.kind];
  const list = state.mode === 'bulk' && sel.size ? rows().filter((r) => sel.has(r.id)) : rows();
  const keys = [...kind.columns.map((c) => c.key).filter((k) => k !== 'avatar'), 'url'].filter((k, i, a) => a.indexOf(k) === i);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [keys.join(','), ...list.map((r) => keys.map((k) => cell(k === 'visited_days' ? r.visited : r[k])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `facebook-${state.kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('job-cancel').addEventListener('click', () => api('job/cancel', {}));

// --- Settings tab --------------------------------------------------------------------------------

const FIELDS = ['llmUrl', 'llmKey', 'llmModel', 'interests', 'filterModel', 'scoreEnabled', 'hideBelow', 'showBadges', 'holdUntilScored',
                'fbEnabled', 'fbHideAds', 'fbHideVideos', 'fbHideFriendSuggestions', 'fbHideSuggested', 'fbHideNotFollowed', 'fbHideGroupSuggestions',
                'xEnabled', 'xHideAds', 'xHideVideos', 'xHideGrok', 'remoteOpsUrl'];
// Hosts the manifest already grants; any other LLM or config host is asked for when saving.
const GRANTED = /(^|\.)facebook\.com$|^gist\.githubusercontent\.com$/;
const FROM = { learned: 'Tự học', remote: 'Từ xa', bundled: 'Kèm extension' };
const when = (t) => (t ? new Date(t).toLocaleString('vi-VN') : '');

function readForm() {
  return Object.fromEntries(FIELDS.map((f) => {
    const el = $('s-' + f);
    return [f, el.type === 'checkbox' ? el.checked : el.value.trim()];
  }));
}

function originsOf(urls) {
  const patterns = [];
  for (const url of urls) {
    try {
      const u = new URL(url);
      if (!GRANTED.test(u.hostname)) patterns.push(`${u.protocol}//${u.hostname}/*`);
    } catch { /* empty or invalid URL: nothing to grant */ }
  }
  return [...new Set(patterns)];
}

const hostPatterns = (s) => originsOf([s.llmUrl, s.remoteOpsUrl]);

// Must run before any other await in a click handler: Chrome asks only during a user gesture.
async function grantOrigins(origins) {
  if (!origins.length || await chrome.permissions.request({ origins })) return;
  throw new Error(`Cần cho phép truy cập ${origins.join(', ')} thì extension mới gọi được địa chỉ này.`);
}

const grantHosts = (s) => grantOrigins(hostPatterns(s));

async function loadSettings() {
  const s = await api('settings');
  for (const f of FIELDS) {
    const el = $('s-' + f);
    if (el.type === 'checkbox') el.checked = !!s[f]; else el.value = s[f] ?? '';
  }
  syncMasters();
  loadModels({ ask: false });
  renderSafety(await api('fb/safety'));
  renderOps(await api('ops'));
}

// A site's rules look inactive while its master switch is off.
function syncMasters() {
  for (const p of ['fb', 'x']) $(`rules-${p}`).classList.toggle('dim', !$(`s-${p}Enabled`).checked);
}

function renderSafety(st) {
  $('safety-status').innerHTML = (st.cooldown
    ? `<span class="err">Đang tạm nghỉ đến ${esc(when(st.cooldown.until))}: ${esc(st.cooldown.reason)}</span><br>`
    : '<span class="ok">Bình thường.</span><br>') + `Hôm nay đã dọn ${st.actions}/${st.limit} mục (hủy kết bạn, rời nhóm, bỏ theo dõi).`;
  $('cooldown-clear').hidden = !st.cooldown;
}

function renderOps(st) {
  const r = st.remote;
  $('ops-meta').innerHTML = r
    ? `Đã tải từ URL lúc ${esc(when(r.fetched_at))}` + (r.updated ? ` · nội dung file sửa lần cuối ${esc(when(r.updated))}` : '') +
      (r.error ? ` · <span class="err">lỗi: ${esc(r.error)}</span>` : '')
    : 'Chưa tải cấu hình từ xa.';
  $('ops-body').innerHTML = st.rows.map(({ key, candidates: [c, ...rest] }) => c
    ? `<tr><td>${esc(key)}</td><td><code>${esc(c.name)}</code></td><td><code>${esc(c.doc_id)}</code></td>` +
      `<td>${FROM[c.from]}${c.from === 'learned' ? ` <span class="meta">${esc(when(c.at))}</span>` : ''}</td>` +
      `<td class="meta">${rest.map((x) => `${FROM[x.from]}: ${esc(x.doc_id)}`).join('<br>')}</td></tr>`
    : `<tr><td>${esc(key)}</td><td colspan="4" class="err">Chưa có doc_id</td></tr>`).join('');
}

// OpenAI-compatible servers list their models at <base>/models; a bare host such as
// http://localhost:20128 usually serves them under /v1, so that is tried first.
const llmBases = (raw) => {
  const u = raw.trim().replace(/\/+$/, '');
  return /\/v1$/.test(u) ? [u] : [`${u}/v1`, u];
};

async function loadModels({ ask }) {
  const raw = $('s-llmUrl').value;
  const status = $('models-status');
  if (!raw.trim()) { status.textContent = ''; return; }
  try {
    if (ask) await grantHosts({ llmUrl: raw });
    else {
      const origins = hostPatterns({ llmUrl: raw });
      if (origins.length && !(await chrome.permissions.contains({ origins }))) {
        status.textContent = 'Bấm “Tải model” để cho phép extension truy cập địa chỉ này và tải danh sách model.';
        return;
      }
    }
    status.textContent = 'Đang tải danh sách model…';
    const key = $('s-llmKey').value.trim();
    const errors = [];
    for (const base of llmBases(raw)) {
      try {
        const res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ids = [...new Set(((await res.json()).data || []).map((m) => m.id).filter(Boolean))].sort();
        if (!ids.length) throw new Error('danh sách model trống');
        $('s-llmUrl').value = base;
        $('model-list').innerHTML = ids.map((id) => `<option value="${esc(id)}"></option>`).join('');
        const model = $('s-llmModel').value.trim();
        status.innerHTML = `<span class="ok">Đã tải ${ids.length} model từ ${esc(base)}.</span>` +
          (model && !ids.includes(model) ? ` <span class="err">Model đang chọn “${esc(model)}” không có trong danh sách.</span>` : '') +
          (model ? '' : ' Gõ vào ô Model để lọc rồi chọn một model.');
        return;
      } catch (err) {
        errors.push(`${base}: ${err.message}`);
      }
    }
    throw new Error(`Không tải được danh sách model (${errors.join('; ')}).`);
  } catch (err) {
    status.innerHTML = `<span class="err">${esc(err.message)}</span>`;
  }
}

$('llm-models').addEventListener('click', () => loadModels({ ask: true }));
$('s-llmUrl').addEventListener('change', () => loadModels({ ask: false }));

const flash = (page) => {
  const el = $(`saved-${page}`);
  el.classList.add('show');
  clearTimeout(flash[page]);
  flash[page] = setTimeout(() => el.classList.remove('show'), 2200);
};

// Switches and numbers save the moment they change; text boxes wait for their Save button.
$('settings').addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.id?.startsWith('s-') || 'text' in el.dataset) return;
  const key = el.id.slice(2);
  try {
    await api('settings', { [key]: el.type === 'checkbox' ? el.checked : el.value.trim() });
    showError('');
  } catch (err) {
    showError(`Không lưu được: ${err.message}`);
  }
  syncMasters();
});

for (const btn of document.querySelectorAll('[data-save]')) {
  btn.addEventListener('click', async () => {
    const page = btn.dataset.save;
    const patch = Object.fromEntries([...document.querySelectorAll(`[data-page="${page}"] [data-text]`)]
      .map((el) => [el.id.slice(2), el.value.trim()]));
    const errorEl = $(`save-error-${page}`);
    errorEl.textContent = '';
    try {
      await grantHosts({ llmUrl: $('s-llmUrl').value, remoteOpsUrl: $('s-remoteOpsUrl').value });
      await api('settings', patch);
      flash(page);
      if (page === 'common') loadModels({ ask: false });
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

$('llm-test').addEventListener('click', async () => {
  const s = readForm();
  const out = $('llm-test-result');
  out.textContent = 'Đang gọi…';
  try {
    await grantHosts(s);
    const { reply } = await api('llm/test', s);
    out.innerHTML = `<span class="ok">Kết nối được. Model trả lời: ${esc(reply)}</span>`;
  } catch (err) {
    out.innerHTML = `<span class="err">${esc(err.message)}</span>`;
  }
});

$('cooldown-clear').addEventListener('click', async () => {
  if (!confirm('Chỉ bỏ thời gian nghỉ khi bạn đã mở Facebook và xử lý xong yêu cầu xác minh hoặc cảnh báo. Tiếp tục?')) return;
  try {
    renderSafety(await api('fb/safety/clear', {}));
  } catch (err) {
    showError(err.message);
  }
});

$('ops-refresh').addEventListener('click', async () => {
  const btn = $('ops-refresh');
  btn.disabled = true;
  try {
    renderOps(await api('ops/refresh', {}));
  } catch (err) {
    showError(err.message);
    renderOps(await api('ops'));
  } finally {
    btn.disabled = false;
  }
});

(async () => {
  const results = await Promise.allSettled(Object.keys(KINDS).map(load));
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (failed.length) showError(failed.join(' · '));
  goTo(state.kind);
  await pollJob();
})();
