/* ══════════════════════════════════════════════════════════════
   VR Homes 追加機能（app.js のあとに読み込む）
   ・内見予約（申し込み／マイページの予約一覧／管理者の予約管理）
   ・一緒に内見（VRビューアとサーバーの橋渡し）
   ・VR内見の閲覧記録と分析
   ・物件の比較 ・共有 ・お知らせ ・初期費用の計算 ・印刷 ・英語表示
══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ───────── 共通 ───────── */
let fxLang = (() => { try { return localStorage.getItem('vr_lang') === 'en' ? 'en' : 'ja'; } catch (e) { return 'ja'; } })();
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = n => '¥' + Math.round(+n || 0).toLocaleString();
const findProp = id => PROPS.find(p => p.id === +id);
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function api(action, opts) {
  opts = opts || {};
  const qs = new URLSearchParams(Object.assign({ action }, opts.query || {})).toString();
  const init = { method: opts.body ? 'POST' : 'GET' };
  if (opts.body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opts.body); }
  const res = await fetch(AWS_API_URL + '?' + qs, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
  return data;
}
function toast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'info'); }
function slotLabel(slot) {
  const d = new Date(slot.replace('T', ' ').replace(/-/g, '/'));
  if (isNaN(d)) return slot;
  if (fxLang === 'en') return `${d.getMonth() + 1}/${d.getDate()} (${WEEK_EN[d.getDay()]}) ${slot.slice(11, 16)}`;
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${slot.slice(11, 16)}`;
}
function canEdit(p) { try { return typeof canEditProp === 'function' && canEditProp(p); } catch (e) { return false; } }

/* ───────── モーダル（共通の入れ物）───────── */
function openModal(id, title, html, opts) {
  closeModal(id);
  const ov = document.createElement('div');
  ov.className = 'fx-overlay'; ov.id = id;
  ov.innerHTML = `<div class="fx-modal" style="max-width:${(opts && opts.width) || 520}px">
    <div class="fx-mhead"><h3>${title}</h3><button class="fx-x" aria-label="閉じる"><i class="ti ti-x"></i></button></div>
    <div class="fx-mbody">${html}</div></div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(id); });
  ov.querySelector('.fx-x').onclick = () => closeModal(id);
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  return ov.querySelector('.fx-mbody');
}
function closeModal(id) {
  const el = $(id); if (el) el.remove();
  if (!document.querySelector('.fx-overlay') && !($('pd-overlay') && $('pd-overlay').classList.contains('show'))) document.body.style.overflow = '';
}
window.fxCloseModal = closeModal;

/* ══════════════ 1. VRビューアとの連携（閲覧記録・一緒に内見）══════════════ */
const live = { code: '', uid: '', propId: null, pose: null, chat: [], timer: null, host: false, busy: false, pendingResv: null };
function newUid() { const c = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 12; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
function viewerWin() { const f = $('vr-viewer-iframe'); return f && f.contentWindow; }
function toViewer(msg) { const w = viewerWin(); if (w) w.postMessage(msg, '*'); }

window.viewInVR = async function (propId, extra) {
  const prop = findProp(propId);
  if (!prop) { alert('物件が見つかりません'); return; }
  if (prop.floorplanData && prop.floorplanData._stub && !(await ensureFull(prop.id))) return;
  if (!prop.floorplanData && !prop.splatURL && !(prop.panoramas && prop.panoramas.length)) { alert('この物件にはVR内見のデータがありません'); return; }
  if (extra && extra.live && !isLoggedIn) { requireLogin('一緒に内見するにはログインしてください', () => window.viewInVR(propId, extra)); return; }
  stopLive(false);
  live.propId = prop.id;
  openVRViewer({
    data: prop.floorplanData || null, propName: prop.name || '',
    splat: prop.splatURL ? { url: prop.splatURL, transform: prop.splatTransform || null, ext: '.spz' } : null,
    propKey: String(prop.id), liveOk: !!isLoggedIn, lang: fxLang,
    panoramas: prop.panoramas || [], geo: { lat: +prop.lat || 35.68, lng: +prop.lng || 139.76 },
    furnStore: isLoggedIn && currentUser ? 'parent' : 'session',
    furniture: isLoggedIn && currentUser ? (((currentUser.myFurniture || {})[prop.id]) || []) : null,
    checks: getChecks(prop.id),
    live: extra && extra.live ? extra.live : null
  });
};
const _closeVR = window.closeVRViewer;
window.closeVRViewer = function () { stopLive(true); return _closeVR.apply(this, arguments); };

function stopLive(endIfHost) {
  if (live.timer) clearInterval(live.timer);
  live.timer = null;
  if (endIfHost && live.host && live.code) api('liveEnd', { body: { code: live.code } }).catch(() => {});
  live.code = ''; live.host = false; live.chat = []; live.pose = null; live.busy = false;
}
function startSync() {
  if (live.timer) clearInterval(live.timer);
  const tick = async () => {
    if (!live.code || live.busy) return;
    live.busy = true;
    try {
      const body = { code: live.code, uid: live.uid, pose: live.pose || {} };
      if (live.chat.length) body.chat = live.chat.shift();
      const st = await api('liveSync', { body });
      toViewer({ type: 'vr-live-state', state: st, uid: live.uid });
    } catch (e) {
      if (e.status === 404 || e.status === 401) { toViewer({ type: 'vr-live-error', error: e.message, fatal: true }); stopLive(false); }
    } finally { live.busy = false; }
  };
  tick();
  live.timer = setInterval(tick, 1000);
}
async function liveStart() {
  try {
    live.uid = newUid();
    const r = await api('liveCreate', { body: { propId: live.propId, uid: live.uid } });
    live.code = r.code; live.host = true;
    startSync();
    if (live.pendingResv) {
      const pr = live.pendingResv; live.pendingResv = null;
      api('updateReservation', { body: { propId: pr.propId, resvId: pr.resvId, status: 'confirmed', liveCode: r.code,
        message: '「一緒にVR内見」を始めました。物件ページの「コードで参加」に参加コードを入れるか、マイページの「内見予約」から参加してください。' } })
        .then(() => toast('予約者に参加コードを送りました', 'success')).catch(() => {});
    }
  } catch (e) { toViewer({ type: 'vr-live-error', error: e.message, fatal: true }); }
}
async function liveJoin(code) {
  try {
    const info = await api('liveInfo', { query: { code } });
    if (+info.propId !== +live.propId) {   // 別の物件の内見だったら、その物件で開き直す
      if (!findProp(info.propId)) throw new Error('物件が見つかりません');
      setTimeout(() => window.viewInVR(info.propId, { live: { code } }), 50);
      return;
    }
    live.uid = live.uid || newUid(); live.code = info.code; live.host = false;
    startSync();
  } catch (e) { toViewer({ type: 'vr-live-error', error: e.message, fatal: true }); }
}
window.addEventListener('message', e => {
  const m = e.data;
  if (!m || typeof m !== 'object' || !m.type) return;
  if (e.source && e.source !== viewerWin()) return;
  switch (m.type) {
    case 'vr-viewer-stats':
      if (m.stats && m.stats.seconds >= 2 && m.propKey)
        api('trackView', { body: Object.assign({ propId: +m.propKey }, m.stats) }).catch(() => {});
      break;
    case 'vr-furn-save': saveFurniture(m.propKey, m.items); break;
    case 'vr-check-save': saveChecks(m.propKey, m.data); break;
    case 'vr-live-start': liveStart(); break;
    case 'vr-live-join': liveJoin(String(m.code || '')); break;
    case 'vr-live-pose': live.pose = m.pose; break;
    case 'vr-live-chat': if (m.text) live.chat.push(String(m.text).slice(0, 200)); break;
    case 'vr-live-leave': stopLive(true); break;
    case 'vr-copy':
      try { navigator.clipboard.writeText(String(m.text || '')); toast('コピーしました', 'success'); } catch (err) { prompt('コピーしてください', m.text); }
      break;
  }
});
/* VR内見で置いた家具は、ログイン中ならアカウントに保存する（別の端末でも同じ家具が出る） */
let furnTimer = null;
function saveFurniture(propKey, items) {
  if (!isLoggedIn || !currentUser || !propKey) return;
  const all = Object.assign({}, currentUser.myFurniture || {});
  const list = (Array.isArray(items) ? items : []).slice(0, 60);
  if (list.length) all[propKey] = list; else delete all[propKey];
  const keys = Object.keys(all);
  if (keys.length > 30) keys.slice(0, keys.length - 30).forEach(k => delete all[k]);
  currentUser.myFurniture = all;
  const s = (typeof userStore !== 'undefined') && userStore.find(u => u.email === currentUser.email);
  if (s) s.myFurniture = all;
  clearTimeout(furnTimer);
  furnTimer = setTimeout(() => { if (isLoggedIn && currentUser) saveUserToAWS(currentUser); }, 1200);
}
// 以前の「端末に保存」の家具は、ほかの人に見えてしまうので消す
try { Object.keys(localStorage).filter(k => k.indexOf('vr_myfurn_') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}

/* 参加コードを入れて一緒に内見する（物件ページ・マイページから） */
window.fxJoinByCode = async function (code) {
  if (!isLoggedIn) { requireLogin('一緒に内見するにはログインしてください', () => window.fxJoinByCode(code)); return; }
  code = String(code || prompt(t('参加コード（6けた）を入力してください')) || '').replace(/\D/g, '');
  if (!code) return;
  if (code.length !== 6) { toast(t('参加コードは6けたの数字です'), 'warn'); return; }
  try {
    const info = await api('liveInfo', { query: { code } });
    if ($('pd-overlay').classList.contains('show')) closePropDetail();
    window.viewInVR(info.propId, { live: { code } });
  } catch (e) { toast(e.message, 'error'); }
};
/* 一緒に内見を始める（物件ページから） */
window.fxStartLive = function (propId) {
  if (!isLoggedIn) { requireLogin('一緒に内見するにはログインしてください', () => window.fxStartLive(propId)); return; }
  window.viewInVR(propId, { live: { start: true } });
};

/* ══════════════ 1.5 一覧は軽く、必要なときだけ1件を全部読む ══════════════ */
// 物件一覧では重い間取りデータを省いて取得する（物件が増えても速く開ける）
const _fxFetch = window.fetch;
window.fetch = function (input, init) {
  if (typeof input === 'string' && input.indexOf(AWS_API_URL) === 0 && /[?&]action=list(&|$)/.test(input) && !/[?&]light=/.test(input)) input += '&light=1';
  return _fxFetch.call(this, input, init);
};
async function ensureFull(id) {
  const p = findProp(id); if (!p) return null;
  if (p.floorplanData && p.floorplanData._stub) {
    try { const full = await api('get', { query: { id: p.id } }); Object.assign(p, full); }
    catch (e) { toast('物件のデータを読み込めませんでした: ' + e.message, 'error'); return null; }
  }
  return p;
}
window.fxEnsureFull = ensureFull;
['openFloorEditor', 'downloadFloorplan'].forEach(fn => {
  const orig = window[fn]; if (typeof orig !== 'function') return;
  window[fn] = async function (id) { if (id != null && !(await ensureFull(id))) return; return orig.apply(this, arguments); };
});

/* ══════════════ 2. URLから開く（?p=物件ID / ?live=参加コード）══════════════ */
const deep = (() => { const q = new URLSearchParams(location.search); return { p: q.get('p'), live: q.get('live') }; })();
if (deep.p || deep.live) {
  const iv = setInterval(() => {
    if (!PROPS.length) return;
    clearInterval(iv);
    try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) {}
    if (deep.live) window.fxJoinByCode(deep.live);
    else if (deep.p && findProp(deep.p)) showPropDetail(+deep.p);
  }, 300);
  setTimeout(() => clearInterval(iv), 60000);
}

/* ══════════════ 3. 物件詳細の追加ボタン・初期費用の計算 ══════════════ */
const _renderPropDetail = window.renderPropDetail;
window.renderPropDetail = function (prop) {
  _renderPropDetail.apply(this, arguments);
  try { decorateDetail(prop); a11yStatic(); } catch (e) { console.error(e); }
};
/* ── 内見チェック（VR内見の「チェック」と物件ページで同じものを使う）── */
const CHECK_ITEMS = [
  ['fridge', '冷蔵庫・洗濯機の置き場', 'Space for fridge & washer'], ['bed', 'ベッド・机を置けるか', 'Room for bed & desk'], ['storage', '収納の広さ', 'Storage space'],
  ['outlet', 'コンセント・照明の位置', 'Outlets & lights'], ['window', '窓の大きさ・向き', 'Window size & direction'], ['sun', '日当たり', 'Sunlight'],
  ['kitchen', 'キッチンの広さ', 'Kitchen size'], ['bath', 'お風呂・トイレ・洗面所', 'Bath, toilet & sink'], ['path', '玄関・廊下（大きい家具が通るか）', 'Entrance & hallway'],
  ['balcony', 'ベランダ', 'Balcony'], ['noise', 'まわりの音（現地で確認）', 'Noise (check on site)']
];
const CHECK_SS = 'yk_checks';
function checksAll() {
  if (isLoggedIn && currentUser) return currentUser.myChecks || {};
  try { return JSON.parse(sessionStorage.getItem(CHECK_SS) || '{}') || {}; } catch (e) { return {}; }
}
function cleanChecks(d) {
  const items = {};
  if (d && d.items && typeof d.items === 'object') CHECK_ITEMS.forEach(([k]) => { const v = d.items[k]; if (v === 'ok' || v === 'meh' || v === 'ng') items[k] = v; });
  return { items, memo: d && typeof d.memo === 'string' ? d.memo.slice(0, 500) : '' };
}
function getChecks(id) { return cleanChecks(checksAll()[id]); }
let chkTimer = null;
function saveChecks(propKey, data) {
  if (!propKey || propKey === 'sample') return;
  const all = Object.assign({}, checksAll());
  const d = cleanChecks(data);
  if (Object.keys(d.items).length || d.memo.trim()) all[propKey] = d; else delete all[propKey];
  const keys = Object.keys(all); if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(k => delete all[k]);
  if (isLoggedIn && currentUser) {
    currentUser.myChecks = all;
    const su = (typeof userStore !== 'undefined') && userStore.find(u => u.email === currentUser.email); if (su) su.myChecks = all;
    clearTimeout(chkTimer); chkTimer = setTimeout(() => { if (isLoggedIn && currentUser) saveUserToAWS(currentUser); }, 1200);
  } else {
    try { sessionStorage.setItem(CHECK_SS, JSON.stringify(all)); } catch (e) {}
  }
  const sec = $('fx-chk-sec'); if (sec && +sec.dataset.id === +propKey && !sec.contains(document.activeElement)) renderCheckSection(findProp(+propKey));
}
function checkSummary(d) {
  const n = { ok: 0, meh: 0, ng: 0 }; Object.values(d.items).forEach(v => n[v]++);
  const total = n.ok + n.meh + n.ng;
  return total ? `◎${n.ok} △${n.meh} ✕${n.ng}` : '';
}
function renderCheckSection(prop) {
  const sec = $('fx-chk-sec'); if (!sec || !prop) return;
  sec.dataset.id = prop.id;
  const d = getChecks(prop.id);
  const vr = !!(prop.floorplanData || prop.splatURL || (prop.panoramas && prop.panoramas.length));
  sec.innerHTML = `<div class="pd-section-title">${t('内見チェック')} <span class="fx-chk-sum">${checkSummary(d)}</span></div>
    <div class="fx-mini">${t(vr ? 'VR内見の「チェック」ボタンからも記録できます。' : '現地で内見したときのメモにも使えます。')}${isLoggedIn ? '' : ' ' + t('ログインすると保存されます（いまはこのタブを閉じると消えます）。')}</div>
    <div class="fx-chk-list"></div>
    <textarea class="finput fx-chk-memo" maxlength="500" rows="3" placeholder="${t('メモ（気づいたこと）')}"></textarea>
    ${vr ? `<button class="btn btn-sm" onclick="viewInVR(${prop.id})"><i class="ti ti-vr"></i> ${t('VRで確かめる')}</button>` : ''}`;
  const list = sec.querySelector('.fx-chk-list');
  CHECK_ITEMS.forEach(([k, ja, en]) => {
    const row = el('div', 'fx-chk-row');
    row.appendChild(el('span', 'fx-chk-l', fxLang === 'en' ? en : ja));
    [['ok', '◎'], ['meh', '△'], ['ng', '✕']].forEach(([v, mark]) => {
      const b = el('button', 'fx-chk-v' + (d.items[k] === v ? ' on' : ''), mark); b.type = 'button'; b.dataset.v = v;
      b.setAttribute('aria-pressed', d.items[k] === v ? 'true' : 'false'); b.setAttribute('aria-label', (fxLang === 'en' ? en : ja) + ' ' + mark);
      b.onclick = () => { const cur = getChecks(prop.id); if (cur.items[k] === v) delete cur.items[k]; else cur.items[k] = v; saveChecks(String(prop.id), cur); renderCheckSection(prop); };
      row.appendChild(b);
    });
    list.appendChild(row);
  });
  const memo = sec.querySelector('.fx-chk-memo'); memo.value = d.memo;
  memo.oninput = () => { const cur = getChecks(prop.id); cur.memo = memo.value; saveChecks(String(prop.id), cur); const sm = sec.querySelector('.fx-chk-sum'); if (sm) sm.textContent = checkSummary(cur); };
}
function addCheckSection(prop) {
  let sec = $('fx-chk-sec');
  if (!sec) {
    sec = document.createElement('div'); sec.id = 'fx-chk-sec';
    const after = $('fx-poi-sec') || $('pd-address'); if (!after) return;
    after.parentNode.insertBefore(sec, after.nextSibling);
  }
  renderCheckSection(prop);
}

function decorateDetail(prop) {
  const side = document.querySelector('#pd-overlay .pd-side');
  if (!side) return;
  let box = $('fx-pd-actions');
  if (!box) {
    box = document.createElement('div'); box.id = 'fx-pd-actions';
    const contact = side.querySelector('button[onclick^="openContactForm"]');
    side.insertBefore(box, contact ? contact.nextSibling : null);
  }
  const hasVR = !!(prop.floorplanData || prop.splatURL || (prop.panoramas && prop.panoramas.length));
  const vrBtn = $('pd-vr-btn'); if (vrBtn) vrBtn.style.display = hasVR ? 'flex' : 'none';
  const st = PSTATUS[prop.status || 'open'] || PSTATUS.open;
  const nameEl = $('pd-name');
  if (nameEl && prop.status && prop.status !== 'open') nameEl.insertAdjacentHTML('beforeend', ` <span class="fx-pst" style="background:${st[1]}">${t(st[0])}</span>`);
  const closed = prop.status === 'closed' || prop.status === 'hidden';
  const inCmp = compareIds().includes(prop.id);
  const vs = prop.viewStats || {};
  box.innerHTML = `
    ${closed ? `<div class="fx-closed-note"><i class="ti ti-info-circle"></i> ${t(prop.status === 'hidden' ? 'この物件は非公開です（編集できる人にだけ表示）' : 'この物件は成約済みです')}</div>` : `<button class="btn btn-p fx-wide" onclick="fxOpenReserve(${prop.id})"><i class="ti ti-calendar-event"></i> ${t('内見を予約する')}</button>`}
    ${hasVR ? `<div class="fx-row"><button class="btn fx-grow" onclick="fxStartLive(${prop.id})" title="${t('担当者や家族と同じ部屋を一緒に見られます')}"><i class="ti ti-users"></i> ${t('一緒に内見')}</button>
      <button class="btn fx-grow" onclick="fxJoinByCode()"><i class="ti ti-key"></i> ${t('コードで参加')}</button></div>` : ''}
    <div class="fx-row">
      <button class="btn fx-grow ${inCmp ? 'fx-on' : ''}" onclick="fxToggleCompare(${prop.id});renderPropDetail(PROPS.find(p=>p.id===${prop.id}))"><i class="ti ti-arrows-left-right"></i> ${inCmp ? t('比較中') : t('比較')}</button>
      <button class="btn fx-grow" onclick="fxShare(${prop.id})"><i class="ti ti-share"></i> ${t('共有')}</button>
      <button class="btn fx-grow" onclick="fxPrint()"><i class="ti ti-printer"></i> ${t('印刷')}</button>
    </div>
    ${canEdit(prop) && vs.views ? `<div class="fx-mini"><i class="ti ti-chart-bar"></i> ${t('VR内見')} ${vs.views}${t('回')}・${t('平均')}${Math.round(vs.seconds / vs.views)}${t('秒')}</div>` : ''}`;
  addPoiSection(prop); addCheckSection(prop);
  addFloorplanImage(prop);
  // 初期費用の計算
  let sim = $('fx-cost-sim');
  if (!sim) {
    sim = document.createElement('details'); sim.id = 'fx-cost-sim'; sim.className = 'fx-sim';
    const costs = $('pd-costs'); costs.parentNode.insertBefore(sim, costs.nextSibling);
  }
  const wasOpen = sim.open;
  const d = new Date(); d.setDate(d.getDate() + 30);
  const def = sim.dataset.pid === String(prop.id) && sim._vals ? sim._vals : { move: d.toISOString().slice(0, 10), agent: '1', fire: 20000, keyx: 16500, guar: '0.5', other: 0 };
  sim.dataset.pid = String(prop.id);
  sim.innerHTML = `<summary><i class="ti ti-calculator"></i> ${t('初期費用・月々の支払いを計算する')}</summary>
    <div class="fx-sim-in">
      <label>${t('入居日')}<input type="date" data-k="move" value="${def.move}"></label>
      <label>${t('仲介手数料')}<select data-k="agent"><option value="0">${t('なし')}</option><option value="0.5">${t('家賃0.5ヶ月')}</option><option value="1">${t('家賃1ヶ月')}</option></select></label>
      <label>${t('保証会社（初回）')}<select data-k="guar"><option value="0">${t('なし')}</option><option value="0.5">${t('月額の50%')}</option><option value="1">${t('月額の100%')}</option></select></label>
      <label>${t('火災保険')}<input type="number" data-k="fire" value="${def.fire}" step="1000" min="0"></label>
      <label>${t('鍵の交換')}<input type="number" data-k="keyx" value="${def.keyx}" step="1000" min="0"></label>
      <label>${t('その他')}<input type="number" data-k="other" value="${def.other}" step="1000" min="0"></label>
    </div><div class="fx-sim-out" id="fx-sim-out"></div>`;
  sim.querySelector('[data-k=agent]').value = def.agent;
  sim.querySelector('[data-k=guar]').value = def.guar;
  sim.open = wasOpen;
  const calc = () => {
    const v = {}; sim.querySelectorAll('[data-k]').forEach(el => { v[el.dataset.k] = el.value; });
    sim._vals = v;
    $('fx-sim-out').innerHTML = costHtml(prop, v);
  };
  sim.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', calc));
  calc();
}
function costBreakdown(prop, v) {
  const rent = +prop.price || 0, mgmt = +prop.mgmt || 0, monthly = rent + mgmt;
  const move = new Date((v.move || '') + 'T00:00:00');
  let prorate = 0, days = 0, dim = 30;
  if (!isNaN(move)) { dim = new Date(move.getFullYear(), move.getMonth() + 1, 0).getDate(); days = dim - move.getDate() + 1; prorate = Math.round(monthly * days / dim); }
  const rows = [
    [t('敷金'), rent * (+prop.deposit || 0)],
    [t('礼金'), rent * (+prop.key || 0)],
    [t('日割り家賃') + (days ? `（${days}/${dim}${t('日')}）` : ''), prorate],
    [t('翌月分の家賃・管理費'), monthly],
    [t('仲介手数料（税込）'), Math.round(rent * (+v.agent || 0) * 1.1)],
    [t('保証会社（初回）'), Math.round(monthly * (+v.guar || 0))],
    [t('火災保険'), +v.fire || 0],
    [t('鍵の交換'), +v.keyx || 0],
    [t('その他'), +v.other || 0]
  ];
  return { rows, total: rows.reduce((s, r) => s + r[1], 0), monthly };
}
function costHtml(prop, v) {
  const b = costBreakdown(prop, v);
  return `<table>${b.rows.filter(r => r[1] > 0).map(r => `<tr><td>${r[0]}</td><td>${yen(r[1])}</td></tr>`).join('')}
    <tr class="fx-total"><td>${t('初期費用の合計（目安）')}</td><td>${yen(b.total)}</td></tr>
    <tr><td>${t('毎月の支払い（家賃＋管理費）')}</td><td>${yen(b.monthly)}</td></tr></table>
    <div class="fx-mini">${t('家賃の目安は手取りの3分の1と言われます。この物件なら手取り')} <b>${yen(b.monthly * 3)}</b> ${t('以上が目安です。')}<br>${t('※ 実際の金額は不動産会社にご確認ください。')}</div>`;
}

/* ───────── 印刷 ───────── */
window.fxPrint = function () {
  const sim = $('fx-cost-sim'); if (sim) sim.open = true;
  const p = findProp(pdCurrentId);
  let head = $('fx-print-head');
  if (!head) { head = document.createElement('div'); head.id = 'fx-print-head'; document.querySelector('#pd-overlay .pd-modal').prepend(head); }
  head.innerHTML = `<b>VR Homes</b> ${t('物件資料')}　<span>${new Date().toLocaleDateString()}</span><span style="float:right">${esc(location.origin + location.pathname)}?p=${p ? p.id : ''}</span>`;
  let fp = $('fx-print-fp');
  if (!fp) { fp = document.createElement('div'); fp.id = 'fx-print-fp'; document.querySelector('#pd-overlay .pd-main').appendChild(fp); }
  fp.innerHTML = p && p.floorplanURL ? `<div class="pd-section-title">${t('間取り図')}</div><img src="${esc(p.floorplanURL)}" alt="">` : '';
  setTimeout(() => window.print(), 100);
};

/* ══════════════ 4. 内見予約 ══════════════ */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
window.fxOpenReserve = function (propId) {
  if (!isLoggedIn) { requireLogin('内見を予約するにはログインしてください', () => window.fxOpenReserve(propId)); return; }
  const prop = findProp(propId); if (!prop) return;
  if (prop.status === 'closed' || prop.status === 'hidden') { toast(t('この物件は現在、内見の予約を受け付けていません'), 'warn'); return; }
  const rule = Object.assign({ days: [0, 1, 2, 3, 4, 5, 6], start: 10, end: 18, closed: [] }, prop.viewingRule || {});
  const dayOk = d => rule.days.includes(d.getDay()) && !(rule.closed || []).includes(ymd(d));
  const hasVR = !!(prop.floorplanData || prop.splatURL);
  const days = [];
  for (let i = 1; i <= 14; i++) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); days.push(d); }
  const body = openModal('fx-resv', `<i class="ti ti-calendar-event"></i> ${t('内見を予約する')}`, `
    <div class="fx-prop-line">${esc(prop.name)}</div>
    <div class="fx-label">${t('内見の方法')}</div>
    <div class="fx-seg" id="fx-kind">
      <button data-k="visit" class="on"><i class="ti ti-walk"></i> ${t('現地で内見')}</button>
      ${hasVR ? `<button data-k="online"><i class="ti ti-users"></i> ${t('オンラインで一緒にVR内見')}</button>` : ''}
    </div>
    <div class="fx-label">${t('日にち')}</div>
    <div class="fx-days" id="fx-days">${days.map(d => `<button data-d="${ymd(d)}" ${dayOk(d) ? '' : 'disabled title="' + t('休み') + '"'} class="${d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''}"><small>${d.getMonth() + 1}/${d.getDate()}</small>${fxLang === 'en' ? WEEK_EN[d.getDay()] : WEEK[d.getDay()]}</button>`).join('')}</div>
    <div class="fx-label">${t('時間')}</div>
    <div class="fx-times" id="fx-times"></div>
    <div class="fx-two">
      <label class="fx-field">${t('電話番号（任意）')}<input id="fx-phone" type="tel" maxlength="20" placeholder="090-xxxx-xxxx"></label>
    </div>
    <label class="fx-field">${t('ご要望など（任意）')}<textarea id="fx-note" rows="3" maxlength="500" placeholder="${t('例: 駐車場を見たいです')}"></textarea></label>
    <button class="btn btn-p fx-wide" id="fx-resv-go" disabled><i class="ti ti-check"></i> ${t('この日時で予約する')}</button>
    <div class="fx-mini">${t('予約は担当者が確認すると「確定」になり、マイページとお知らせに届きます。')}<br>${t('予約すると')} <a href="privacy.html" target="_blank">${t('個人情報の取り扱い')}</a> ${t('に同意したものとします。')}</div>`, { width: 560 });
  const firstOk = days.find(dayOk);
  if (!firstOk) { body.querySelector('#fx-times').innerHTML = `<div class="fx-mini">${t('受け付けている日がありません')}</div>`; }
  let day = firstOk ? ymd(firstOk) : '', time = null, kind = 'visit';
  const dbtn = body.querySelector(`#fx-days button[data-d="${day}"]`); if (dbtn) dbtn.classList.add('on');
  const SLOT_HOURS = []; for (let h = +rule.start; h < +rule.end; h++) SLOT_HOURS.push(h);
  const booked = new Set(prop.bookedSlots || []);
  const renderTimes = () => {
    if (!day) return;
    body.querySelector('#fx-times').innerHTML = SLOT_HOURS.map(h => {
      const s = `${day}T${String(h).padStart(2, '0')}:00`, full = booked.has(s);
      return `<button data-t="${s}" ${full ? 'disabled title="' + t('予約済み') + '"' : ''} class="${time === s ? 'on' : ''}">${h}:00${full ? '<small>' + t('満') + '</small>' : ''}</button>`;
    }).join('');
    body.querySelectorAll('#fx-times button:not([disabled])').forEach(b => b.onclick = () => { time = b.dataset.t; renderTimes(); });
    body.querySelector('#fx-resv-go').disabled = !time;
    body.querySelector('#fx-resv-go').innerHTML = `<i class="ti ti-check"></i> ${time ? slotLabel(time) + ' ' + t('で予約する') : t('時間を選んでください')}`;
  };
  body.querySelectorAll('#fx-days button:not([disabled])').forEach(b => b.onclick = () => { day = b.dataset.d; time = null; body.querySelectorAll('#fx-days button').forEach(x => x.classList.toggle('on', x === b)); renderTimes(); });
  body.querySelectorAll('#fx-kind button').forEach(b => b.onclick = () => { kind = b.dataset.k; body.querySelectorAll('#fx-kind button').forEach(x => x.classList.toggle('on', x === b)); });
  renderTimes();
  body.querySelector('#fx-resv-go').onclick = async () => {
    const btn = body.querySelector('#fx-resv-go'); btn.disabled = true;
    try {
      await api('reserve', { body: { propId: prop.id, slot: time, kind, phone: body.querySelector('#fx-phone').value, note: body.querySelector('#fx-note').value } });
      prop.bookedSlots = (prop.bookedSlots || []).concat([time]);
      closeModal('fx-resv');
      toast(t('予約を申し込みました。確定したらお知らせします'), 'success');
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; if (e.status === 409) { booked.add(time); time = null; renderTimes(); } }
  };
};
const STATUS = { pending: ['確認待ち', '#f59e0b'], confirmed: ['確定', '#16a34a'], declined: ['お断り', '#dc2626'], cancelled: ['キャンセル', '#94a3b8'], done: ['完了', '#64748b'] };
const KIND = { visit: '現地で内見', online: 'オンラインで一緒にVR内見' };
function statusBadge(s) { const v = STATUS[s] || [s, '#64748b']; return `<span class="fx-badge" style="background:${v[1]}">${t(v[0])}</span>`; }
function nowSlot() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

/* マイページ「内見予約」 */
(function addMyPageTab() {
  const nav = document.querySelector('.mp-nav-item[onclick*="\'prof\'"]');
  if (nav && !$('mp-nav-resv')) {
    const it = document.createElement('div');
    it.className = 'mp-nav-item'; it.id = 'mp-nav-resv';
    it.setAttribute('onclick', "switchMp('resv',this)");
    it.innerHTML = '<i class="ti ti-calendar-event"></i>内見予約';
    nav.parentNode.insertBefore(it, nav);
  }
  const prof = $('mp-prof');
  if (prof && !$('mp-resv')) {
    const sec = document.createElement('div');
    sec.id = 'mp-resv'; sec.style.display = 'none';
    sec.innerHTML = '<div class="fx-sec-title"><i class="ti ti-calendar-event"></i> 内見予約</div><div id="mp-resv-list"></div>';
    prof.parentNode.insertBefore(sec, prof);
  }
})();
const _switchMp = window.switchMp;
window.switchMp = function (id, el) {
  const sec = $('mp-resv'); if (sec) sec.style.display = id === 'resv' ? 'block' : 'none';
  if (id === 'resv') {
    ['fav', 'inbox', 'hist', 'prof', 'wish', 'code'].forEach(k => { const e = $('mp-' + k); if (e) e.style.display = 'none'; });
    document.querySelectorAll('.mp-nav-item').forEach(i => i.classList.remove('on'));
    (el || $('mp-nav-resv')).classList.add('on');
    renderMyResv();
    return;
  }
  return _switchMp.apply(this, arguments);
};
async function renderMyResv() {
  const box = $('mp-resv-list'); if (!box) return;
  box.innerHTML = `<div class="fx-empty">${t('読み込み中…')}</div>`;
  try {
    const list = await api('myReservations');
    if (!list.length) { box.innerHTML = `<div class="fx-empty"><i class="ti ti-calendar-off"></i><br>${t('まだ予約はありません。物件ページの「内見を予約する」から申し込めます。')}</div>`; ykEmpties(); return; }
    const now = nowSlot();
    box.innerHTML = list.map(r => {
      const future = r.slot > now, active = r.status === 'pending' || r.status === 'confirmed';
      return `<div class="fx-card ${future ? '' : 'past'}">
        <div class="fx-card-h"><b>${slotLabel(r.slot)}</b>${statusBadge(r.status)}</div>
        <div class="fx-link" onclick="showPropDetail(${r.propId})">${esc(r.propName)}</div>
        <div class="fx-mini">${t(KIND[r.kind] || '')}${r.note ? '・' + esc(r.note) : ''}</div>
        ${r.reply ? `<div class="fx-reply"><i class="ti ti-message"></i> ${esc(r.reply)}</div>` : ''}
        <div class="fx-row">
          ${r.liveCode && active ? `<button class="btn btn-p btn-sm" onclick="fxJoinByCode('${esc(r.liveCode)}')"><i class="ti ti-users"></i> ${t('一緒にVR内見に参加')}（${esc(r.liveCode)}）</button>` : ''}
          ${active && future ? `<button class="btn btn-sm" style="color:var(--red)" onclick="fxCancelResv(${r.propId},'${esc(r.id)}')">${t('キャンセル')}</button>` : ''}
        </div></div>`;
    }).join('');
  } catch (e) { box.innerHTML = `<div class="fx-empty">${esc(e.message)}</div>`; }
}
window.fxCancelResv = async function (propId, resvId) {
  if (!confirm(t('この予約をキャンセルしますか？'))) return;
  try { await api('updateReservation', { body: { propId, resvId, status: 'cancelled' } }); toast(t('キャンセルしました'), 'success'); renderMyResv(); refreshBooked(); }
  catch (e) { toast(e.message, 'error'); }
};
function refreshBooked() { if (typeof fetchAndRenderProps === 'function') fetchAndRenderProps().catch(() => {}); }

/* 管理画面「予約」 */
(function addAdminTab() {
  const statsNav = document.querySelector('#s-admin .admin-nav-item[onclick*="\'stats\'"]');
  if (statsNav && !$('admin-nav-resv')) {
    const it = document.createElement('div');
    it.className = 'admin-nav-item'; it.id = 'admin-nav-resv';
    it.setAttribute('onclick', "switchAdmin('resv',this)");
    it.innerHTML = '<i class="ti ti-calendar-event"></i>予約 <span class="badge" id="admin-resv-badge" style="display:none">0</span>';
    statsNav.parentNode.insertBefore(it, statsNav);
  }
  const stats = $('admin-stats');
  if (stats && !$('admin-resv')) {
    const sec = document.createElement('div');
    sec.id = 'admin-resv'; sec.style.display = 'none';
    sec.innerHTML = `<h2 class="fx-h2">内見予約の管理</h2>
      <div class="fx-tabs" id="fx-resv-filter"><button data-f="todo" class="on">対応が必要</button><button data-f="future">これからの予定</button><button data-f="all">すべて</button></div>
      <div id="admin-resv-list"></div>`;
    stats.parentNode.insertBefore(sec, stats);
    sec.querySelectorAll('#fx-resv-filter button').forEach(b => b.onclick = () => { sec.querySelectorAll('#fx-resv-filter button').forEach(x => x.classList.toggle('on', x === b)); resvFilter = b.dataset.f; renderAdminResv(); });
  }
  if (stats && !$('fx-vr-analytics')) {
    const a = document.createElement('div');
    a.id = 'fx-vr-analytics';
    stats.appendChild(a);
  }
})();
let resvFilter = 'todo', adminResvCache = [];
const _switchAdmin = window.switchAdmin;
window.switchAdmin = function (id, el) {
  const sec = $('admin-resv'); if (sec) sec.style.display = id === 'resv' ? 'block' : 'none';
  if (id === 'resv') {
    ['props', 'group', 'users', 'stats'].forEach(k => { const e = $('admin-' + k); if (e) e.style.display = 'none'; });
    document.querySelectorAll('#s-admin .admin-nav-item').forEach(i => i.classList.remove('on'));
    (el && el.classList ? el : $('admin-nav-resv')).classList.add('on');
    renderAdminResv(true);
    return;
  }
  const r = _switchAdmin.apply(this, arguments);
  if (id === 'stats') renderAnalytics();
  return r;
};
async function loadAdminResv() {
  if (!currentUser || !isAdmin()) return [];
  try { adminResvCache = await api('getReservations'); } catch (e) { adminResvCache = []; }
  const n = adminResvCache.filter(r => r.status === 'pending').length;
  const bd = $('admin-resv-badge'); if (bd) { bd.textContent = n; bd.style.display = n ? 'inline-block' : 'none'; }
  return adminResvCache;
}
async function renderAdminResv(reload) {
  const box = $('admin-resv-list'); if (!box) return;
  if (reload) { box.innerHTML = `<div class="fx-empty">${t('読み込み中…')}</div>`; await loadAdminResv(); }
  const now = nowSlot();
  let list = adminResvCache.slice();
  if (resvFilter === 'todo') list = list.filter(r => r.status === 'pending' || (r.status === 'confirmed' && r.slot > now));
  if (resvFilter === 'future') list = list.filter(r => r.slot > now && r.status !== 'cancelled' && r.status !== 'declined');
  if (resvFilter === 'all') list.reverse();
  if (calDay) list = adminResvCache.filter(r => r.slot.slice(0, 10) === calDay);
  renderResvCalendar();
  if (!list.length) { box.innerHTML = `<div class="fx-empty"><i class="ti ti-calendar-check"></i><br>${t('ここに表示する予約はありません')}</div>`; ykEmpties(); return; }
  box.innerHTML = list.map(r => {
    const future = r.slot > now;
    return `<div class="fx-card ${future ? '' : 'past'}">
      <div class="fx-card-h"><b>${slotLabel(r.slot)}</b>${statusBadge(r.status)}<span class="fx-kind">${r.kind === 'online' ? '<i class="ti ti-users"></i> オンライン' : '<i class="ti ti-walk"></i> 現地'}</span></div>
      <div class="fx-link" onclick="showPropDetail(${r.propId})">${esc(r.propName)}</div>
      <div class="fx-mini"><i class="ti ti-user"></i> ${esc(r.name || '')}${r.email ? ' &lt;' + esc(r.email) + '&gt;' : ''}${r.phone ? ' ・ <i class="ti ti-phone"></i> ' + esc(r.phone) : ''}</div>
      ${r.note ? `<div class="fx-reply"><i class="ti ti-note"></i> ${esc(r.note)}</div>` : ''}
      ${r.reply ? `<div class="fx-mini">返信: ${esc(r.reply)}</div>` : ''}
      <div class="fx-row">
        ${r.status === 'pending' ? `<button class="btn btn-p btn-sm" onclick="fxSetResv(${r.propId},'${r.id}','confirmed')">確定する</button><button class="btn btn-sm" style="color:var(--red)" onclick="fxSetResv(${r.propId},'${r.id}','declined')">お断りする</button>` : ''}
        ${r.status === 'confirmed' && r.kind === 'online' ? `<button class="btn btn-p btn-sm" onclick="fxHostResv(${r.propId},'${r.id}')"><i class="ti ti-users"></i> 一緒にVR内見を始める</button>` : ''}
        ${r.status === 'confirmed' ? `<button class="btn btn-sm" onclick="fxSetResv(${r.propId},'${r.id}','done')">完了にする</button>` : ''}
      </div></div>`;
  }).join('');
}
window.fxSetResv = async function (propId, resvId, status) {
  const label = { confirmed: '確定', declined: 'お断り', done: '完了' }[status];
  const msg = status === 'done' ? '' : prompt(`「${label}」にします。予約者へのメッセージ（任意）`, status === 'confirmed' ? '当日お待ちしております。' : '');
  if (msg === null) return;
  try { await api('updateReservation', { body: { propId, resvId, status, message: msg } }); toast(`「${label}」にしました。予約者にお知らせが届きます`, 'success'); renderAdminResv(true); refreshBooked(); }
  catch (e) { toast(e.message, 'error'); }
};
window.fxHostResv = function (propId, resvId) {
  live.pendingResv = { propId, resvId };
  window.viewInVR(propId, { live: { start: true } });
};

/* ══════════════ 5. VR内見の分析（管理画面）══════════════ */
const _refreshStats = window.refreshStats;
window.refreshStats = function () { const r = _refreshStats.apply(this, arguments); renderAnalytics(); return r; };
async function renderAnalytics() {
  const box = $('fx-vr-analytics'); if (!box || !currentUser) return;
  const mine = PROPS.filter(p => canEdit(p));
  const resv = await loadAdminResv();
  let favMap = {};   // お気に入りの数はサーバーが数える（ほかの人のお気に入りの中身は見ない）
  try { favMap = await api('favCounts'); } catch (e) { favMap = {}; }
  const favCount = id => +favMap[String(id)] || 0;
  const rows = mine.map(p => {
    const v = p.viewStats || {}, views = v.views || 0;
    const rooms = Object.entries(v.rooms || {}).sort((a, b) => b[1] - a[1]);
    const roomMax = rooms.length ? rooms[0][1] : 1;
    return { p, views, avg: views ? Math.round(v.seconds / views) : 0, real: v.seconds ? Math.round(v.realSeconds / v.seconds * 100) : 0,
      tours: v.tours || 0, measures: v.measures || 0, furn: v.furniture || 0, rooms, roomMax,
      resv: resv.filter(r => r.propId === p.id && r.status !== 'cancelled').length, favs: favCount(p.id), last: v.last };
  }).sort((a, b) => b.views - a.views);
  const total = rows.reduce((s, r) => s + r.views, 0);
  const totalResv = rows.reduce((s, r) => s + r.resv, 0);
  box.innerHTML = `<h2 class="fx-h2" style="margin-top:28px">VR内見の分析 <small>（${isMaster() ? 'すべての物件' : '編集できる物件'}）</small></h2>
    <div class="stat-card-grid">
      <div class="stat-card"><div class="stat-card-label">VR内見の回数</div><div class="stat-card-val">${total}</div></div>
      <div class="stat-card"><div class="stat-card-label">内見予約</div><div class="stat-card-val">${totalResv}</div></div>
      <div class="stat-card"><div class="stat-card-label">予約につながった割合</div><div class="stat-card-val">${total ? Math.round(totalResv / total * 100) + '%' : '−'}</div></div>
    </div>
    ${rows.length ? `<div class="fx-an-list">${rows.map(r => `<div class="fx-an">
      <div class="fx-an-h"><span class="fx-link" onclick="showPropDetail(${r.p.id})">${esc(r.p.name)}</span><span>${r.last ? '最終: ' + esc(r.last.replace('T', ' ').slice(0, 16)) : ''}</span></div>
      ${r.p.prImp || r.p.prClick || isPR(r.p) ? `<div class="fx-mini" style="margin:0 0 6px"><span class="fx-pr-tag">PR</span> ${isPR(r.p) ? esc(r.p.featuredUntil) + ' まで掲載中' : '掲載は終了'} ・ 表示 ${r.p.prImp || 0}回 ・ クリック ${r.p.prClick || 0}回${r.p.prImp ? `（${Math.round((r.p.prClick || 0) / r.p.prImp * 100)}%）` : ''}</div>` : ''}
      <div class="fx-an-nums">
        <div><b>${r.views}</b>VR内見（回）</div><div><b>${r.avg}</b>平均（秒）</div><div><b>${r.real}%</b>実写で見た割合</div>
        <div><b>${r.resv}</b>予約（件）</div><div><b>${r.favs}</b>お気に入り（人）</div>
        <div><b>${r.tours}</b>ツアー（回）</div><div><b>${r.measures}</b>計測（回）</div><div><b>${r.furn}</b>家具お試し（個）</div>
      </div>
      ${r.rooms.length ? `<div class="fx-mini" style="margin:6px 0 3px">よく見られている部屋（合計時間）</div>${r.rooms.slice(0, 5).map(([n, s]) => `<div class="fx-bar"><span>${esc(n)}</span><i style="width:${Math.max(4, s / r.roomMax * 100)}%"></i><em>${s >= 60 ? Math.round(s / 60) + '分' : Math.round(s) + '秒'}</em></div>`).join('')}` : '<div class="fx-mini">まだVR内見の記録がありません</div>'}
    </div>`).join('')}</div>` : '<div class="fx-empty">編集できる物件がありません</div>'}`;
}

/* ══════════════ 6. 物件の比較 ══════════════ */
const CMP_KEY = 'vr_compare';
function cmpStore() { return isLoggedIn && currentUser ? localStorage : sessionStorage; }
function cmpKey() { return CMP_KEY + '_' + (isLoggedIn && currentUser ? currentUser.email : 'guest'); }
function compareIds() { try { return (JSON.parse(cmpStore().getItem(cmpKey()) || '[]') || []).filter(id => findProp(id)); } catch (e) { return []; } }
function saveCompare(ids) { try { cmpStore().setItem(cmpKey(), JSON.stringify(ids)); } catch (e) {} renderCompareBar(); decorateCards(); }
try { localStorage.removeItem(CMP_KEY); } catch (e) {}
window.fxToggleCompare = function (id) {
  let ids = compareIds();
  if (ids.includes(id)) ids = ids.filter(x => x !== id);
  else { if (ids.length >= 4) { toast(t('比較できるのは4件までです'), 'warn'); return; } ids.push(id); }
  saveCompare(ids);
};
function renderCompareBar() {
  let bar = $('fx-cmp-bar');
  const ids = compareIds();
  if (!ids.length) { if (bar) bar.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'fx-cmp-bar'; document.body.appendChild(bar); }
  bar.innerHTML = `<span><i class="ti ti-arrows-left-right"></i> ${t('比較リスト')} <b>${ids.length}</b>${t('件')}</span>
    <button class="btn btn-p btn-sm" onclick="fxOpenCompare()">${t('比較する')}</button>
    <button class="btn btn-sm" onclick="fxClearCompare()">${t('クリア')}</button>`;
}
window.fxClearCompare = () => saveCompare([]);
window.fxOpenCompare = function () {
  const ps = compareIds().map(findProp);
  if (!ps.length) return;
  const def = { move: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), agent: '1', fire: 20000, keyx: 16500, guar: '0.5', other: 0 };
  const allFeat = [...new Set(ps.flatMap(p => p.features || []))];
  const best = (vals, low) => { const nums = vals.filter(v => v != null && isFinite(v)); if (nums.length < 2 || nums.every(v => v === nums[0])) return null; return low ? Math.min(...nums) : Math.max(...nums); };
  const row = (label, vals, fmt, lowIsBest) => {
    const b = lowIsBest === undefined ? null : best(vals, lowIsBest);
    return `<tr><th>${label}</th>${vals.map(v => `<td class="${b != null && v === b ? 'fx-best' : ''}">${v == null || v === '' ? '−' : (fmt ? fmt(v) : esc(v))}</td>`).join('')}</tr>`;
  };
  const html = `<div class="fx-cmp-wrap"><table class="fx-cmp">
    <tr><th></th>${ps.map(p => `<td><div class="fx-cmp-img" style="${p.photoURLs && p.photoURLs[0] ? `background-image:url('${esc(p.photoURLs[0])}')` : ''}">${p.photoURLs && p.photoURLs[0] ? '' : '<i class="ti ti-building"></i>'}</div>
      <div class="fx-link" onclick="fxCloseModal('fx-cmp');showPropDetail(${p.id})">${esc(p.name)}</div>
      <button class="btn btn-sm" onclick="fxToggleCompare(${p.id});fxCloseModal('fx-cmp');fxOpenCompare()">${t('外す')}</button></td>`).join('')}</tr>
    ${row(t('家賃'), ps.map(p => +p.price || 0), yen, true)}
    ${row(t('管理費'), ps.map(p => +p.mgmt || 0), yen, true)}
    ${row(t('毎月の支払い'), ps.map(p => (+p.price || 0) + (+p.mgmt || 0)), yen, true)}
    ${row(t('初期費用の目安'), ps.map(p => costBreakdown(p, def).total), yen, true)}
    ${row(t('間取り'), ps.map(p => p.madori))}
    ${row(t('面積'), ps.map(p => +p.size || null), v => v + '㎡', false)}
    ${row(t('1㎡あたりの家賃'), ps.map(p => +p.size ? Math.round(((+p.price || 0) + (+p.mgmt || 0)) / p.size) : null), yen, true)}
    ${row(t('最寄駅'), ps.map(p => (p.station ? p.station + (fxLang === 'en' ? ' Sta.' : '駅') : '') + (p.walkMin != null ? ' ' + t('徒歩') + p.walkMin + t('分') : '')))}
    ${row(t('駅まで'), ps.map(p => p.walkMin != null ? +p.walkMin : null), v => v + t('分'), true)}
    ${row(t('築年数'), ps.map(p => p.age != null ? +p.age : null), v => v + t('年'), true)}
    ${row(t('構造'), ps.map(p => p.structure))}
    ${row(t('物件種別'), ps.map(p => p.type))}
    ${row(t('敷金・礼金'), ps.map(p => `${p.deposit || 0} / ${p.key || 0} ${t('ヶ月')}`))}
    ${row('VR', ps.map(p => [p.floorplanData ? t('間取り') : '', p.splatURL ? t('実写') : ''].filter(Boolean).join('・') || t('なし')))}
    ${ps.some(p => checkSummary(getChecks(p.id))) ? `<tr><th>${t('内見チェック')}</th>${ps.map(p => { const d = getChecks(p.id); return `<td class="fx-chk-cmp">${CHECK_ITEMS.filter(([k]) => d.items[k]).map(([k, ja, en]) => `<span class="${d.items[k]}">${{ ok: '◎', meh: '△', ng: '✕' }[d.items[k]]} ${esc(fxLang === 'en' ? en : ja)}</span>`).join('') || '−'}</td>`; }).join('')}</tr>` : ''}
    ${ps.some(p => getChecks(p.id).memo.trim()) ? row(t('内見メモ'), ps.map(p => getChecks(p.id).memo)) : ''}
    <tr><th>${t('設備・条件')}</th>${ps.map(p => `<td class="fx-feat">${allFeat.map(f => (p.features || []).includes(f) ? `<span class="on">✓ ${esc(f)}</span>` : `<span>− ${esc(f)}</span>`).join('')}</td>`).join('')}</tr>
    <tr><th></th>${ps.map(p => `<td>${p.floorplanData || p.splatURL ? `<button class="btn btn-p btn-sm" onclick="fxCloseModal('fx-cmp');viewInVR(${p.id})"><i class="ti ti-vr"></i> ${t('VRで内見')}</button>` : ''}</td>`).join('')}</tr>
  </table></div><div class="fx-mini">${t('緑の数字は、比べた中でいちばん条件が良いものです。初期費用は仲介手数料1ヶ月・保証会社50%などで計算した目安です。')}</div>`;
  openModal('fx-cmp', `<i class="ti ti-arrows-left-right"></i> ${t('物件を比較')}`, html, { width: 980 });
};
function decorateCards() {
  const ids = compareIds();
  document.querySelectorAll('#card-grid .prop-card').forEach(card => {
    const fb = card.querySelector('.fav-btn'); if (!fb) return;
    const id = +fb.dataset.propId;
    let b = card.querySelector('.fx-cmp-btn');
    if (!b) {
      b = document.createElement('button'); b.className = 'fx-cmp-btn'; b.type = 'button';
      b.onclick = e => { e.stopPropagation(); window.fxToggleCompare(id); };
      card.querySelector('.prop-img').appendChild(b);
    }
    const on = ids.includes(id);
    b.classList.toggle('on', on);
    b.innerHTML = `<i class="ti ti-${on ? 'check' : 'arrows-left-right'}"></i> ${on ? t('比較中') : t('比較')}`;
  });
}
const _renderCards = window.renderCards;
window.renderCards = function () { const r = _renderCards.apply(this, arguments); try { decorateCards(); decorateCardsMore(); renderCompareBar(); } catch (e) { console.error(e); } return r; };

/* ══════════════ 7. 共有 ══════════════ */
window.fxShare = async function (propId) {
  const p = findProp(propId); if (!p) return;
  const url = location.origin + location.pathname + '?p=' + p.id;
  const text = `${p.name}｜${yen(p.price)}/${t('月')} ${p.madori || ''} ${p.station ? p.station + (fxLang === 'en' ? ' Sta.' : '駅') : ''}`;
  const body = openModal('fx-share', `<i class="ti ti-share"></i> ${t('この物件を共有')}`, `
    <div class="fx-prop-line">${esc(p.name)}</div>
    <div class="fx-row"><input class="finput" id="fx-share-url" readonly value="${esc(url)}" style="flex:1"><button class="btn btn-p" id="fx-share-copy"><i class="ti ti-copy"></i> ${t('コピー')}</button></div>
    <div class="fx-share-grid">
      <a class="btn" target="_blank" rel="noopener" href="https://line.me/R/msg/text/?${encodeURIComponent(text + '\n' + url)}"><i class="ti ti-brand-line"></i> LINE</a>
      <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}"><i class="ti ti-brand-x"></i> X</a>
      <a class="btn" href="mailto:?subject=${encodeURIComponent('[VR Homes] ' + p.name)}&body=${encodeURIComponent(text + '\n' + url)}"><i class="ti ti-mail"></i> ${t('メール')}</a>
      ${navigator.share ? `<button class="btn" id="fx-share-native"><i class="ti ti-dots"></i> ${t('その他')}</button>` : ''}
    </div>
    <div class="fx-mini">${t('リンクを開いた人は、ログインするとこの物件のページが開きます。')}</div>`, { width: 460 });
  body.querySelector('#fx-share-copy').onclick = () => {
    const inp = body.querySelector('#fx-share-url'); inp.select();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast(t('リンクをコピーしました'), 'success'), () => { document.execCommand('copy'); toast(t('リンクをコピーしました'), 'success'); });
  };
  const nb = body.querySelector('#fx-share-native');
  if (nb) nb.onclick = () => navigator.share({ title: p.name, text, url }).catch(() => {});
};

/* ══════════════ 8. お知らせ（新着物件・メッセージ）══════════════ */
const NOTIF_ON = 'vr_notify_browser';
function seenKey() { return 'vr_seen_prop_' + (currentUser ? currentUser.email : ''); }
function wishOf() { return (currentUser && currentUser.wishlist) || {}; }
function matchesWish(p) {
  const w = wishOf();
  const has = k => Array.isArray(w[k]) && w[k].length;
  if (has('madori')) {
    const ok = w.madori.some(m => m === '3LDK以上' ? /^([3-9]|\d\d)/.test(p.madori || '') : m === p.madori);
    if (!ok) return false;
  }
  if (has('type') && !w.type.includes(p.type)) return false;
  if (has('priceMax')) {
    const max = Math.max(...w.priceMax.map(v => (+String(v).replace(/[^\d.]/g, '') || 0) * 10000));
    if (max && (+p.price || 0) > max) return false;
  }
  if (has('features') && !w.features.every(f => (p.features || []).includes(f))) return false;
  return true;
}
function newMatches() {
  if (!currentUser) return [];
  let seen;
  try { seen = localStorage.getItem(seenKey()); } catch (e) { seen = null; }
  const maxId = PROPS.reduce((m, p) => Math.max(m, +p.id || 0), 0);
  if (seen === null) { try { localStorage.setItem(seenKey(), String(maxId)); } catch (e) {} return []; }
  return PROPS.filter(p => +p.id > +seen && matchesWish(p) && p.ownerEmail !== currentUser.email).sort((a, b) => b.id - a.id);
}
function addNavButtons() {
  document.querySelectorAll('.screen > nav').forEach(nav => {
    if (nav.querySelector('.fx-nav-tools')) return;
    const right = nav.querySelector('.nav-r') || nav.lastElementChild;
    if (!right) return;
    const wrap = document.createElement('span');
    wrap.className = 'fx-nav-tools';
    wrap.innerHTML = `<button class="btn btn-sm btn-p fx-login-btn" onclick="fxRequireLogin()" aria-label="ログイン"><i class="ti ti-login"></i><span class="fx-lbl"> ${t('ログイン')}</span></button><button class="btn btn-sm fx-lang" onclick="fxToggleLang()" title="English / 日本語">${fxLang === 'en' ? '日本語' : 'EN'}</button>
      <button class="btn btn-sm fx-bell" onclick="fxOpenNotif(event)" title="お知らせ"><i class="ti ti-bell"></i><span class="fx-bell-n" style="display:none">0</span></button>`;
    right.prepend(wrap);
  });
}
let lastNotifyCount = -1;
function updateBell() {
  if (!isLoggedIn) return;
  const n = newMatches().length + (typeof unreadCount === 'function' ? unreadCount() : 0);
  document.querySelectorAll('.fx-bell-n').forEach(b => { b.textContent = n > 99 ? '99+' : n; b.style.display = n ? 'inline-flex' : 'none'; });
  if (lastNotifyCount >= 0 && n > lastNotifyCount && browserNotifyOn()) {
    try { new Notification('VR Homes', { body: t('新しいお知らせがあります'), icon: 'icon-192.png' }); } catch (e) {}
  }
  lastNotifyCount = n;
}
function browserNotifyOn() { try { return localStorage.getItem(NOTIF_ON) === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch (e) { return false; } }
window.fxOpenNotif = async function (ev) {
  if (ev) ev.stopPropagation();
  let pan = $('fx-notif');
  if (pan) { pan.remove(); return; }
  pan = document.createElement('div'); pan.id = 'fx-notif';
  document.body.appendChild(pan);
  const close = e => { if (!pan.contains(e.target)) { pan.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
  pan.innerHTML = `<div class="fx-empty">${t('読み込み中…')}</div>`;
  if (currentUser && typeof fetchMessages === 'function') await fetchMessages(currentUser.email).catch(() => {});
  const props = newMatches(), msgs = (typeof _inboxCache !== 'undefined' ? _inboxCache : []).filter(m => !m.read).slice(0, 6);
  const w = wishOf(), hasWish = Object.values(w).some(v => Array.isArray(v) && v.length);
  pan.innerHTML = `<div class="fx-np-h"><b>${t('お知らせ')}</b><button class="btn btn-sm" id="fx-np-read">${t('すべて既読')}</button></div>
    <div class="fx-np-sec">${hasWish ? t('希望条件に合う新着物件') : t('新着物件')}</div>
    ${props.length ? props.slice(0, 8).map(p => `<div class="fx-np-item" onclick="document.getElementById('fx-notif').remove();showPropDetail(${p.id})"><i class="ti ti-building"></i><div><b>${esc(p.name)}</b><small>${yen(p.price)} ・ ${esc(p.madori || '')} ・ ${esc(p.station || p.area || '')}</small></div></div>`).join('') : `<div class="fx-np-none">${t('新着はありません')}</div>`}
    <div class="fx-np-sec">${t('未読のメッセージ')}</div>
    ${msgs.length ? msgs.map(m => `<div class="fx-np-item" onclick="document.getElementById('fx-notif').remove();guardedScreen('mypage');setTimeout(()=>switchMp('inbox'),100)"><i class="ti ti-mail"></i><div><b>${esc(m.subject || '')}</b><small>${esc(m.fromName || '')} ・ ${esc(m.time || '')}</small></div></div>`).join('') : `<div class="fx-np-none">${t('未読はありません')}</div>`}
    <div class="fx-np-foot">
      ${!hasWish ? `<a onclick="document.getElementById('fx-notif').remove();guardedScreen('mypage');setTimeout(()=>switchMp('wish'),100)">${t('希望条件を登録すると、合う物件だけお知らせします')}</a>` : ''}
      ${'Notification' in window ? `<label><input type="checkbox" id="fx-np-browser" ${browserNotifyOn() ? 'checked' : ''}> ${t('ブラウザの通知も受け取る')}</label>` : ''}
    </div>`;
  pan.querySelector('#fx-np-read').onclick = async () => {
    const maxId = PROPS.reduce((m, p) => Math.max(m, +p.id || 0), 0);
    try { localStorage.setItem(seenKey(), String(maxId)); } catch (e) {}
    if (typeof markMessagesRead === 'function' && currentUser) await markMessagesRead(currentUser.email);
    if (typeof updateInboxBadge === 'function') updateInboxBadge();
    updateBell(); pan.remove();
  };
  const cb = pan.querySelector('#fx-np-browser');
  if (cb) cb.onchange = async () => {
    if (cb.checked) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { cb.checked = false; toast(t('ブラウザの設定で通知が許可されていません'), 'warn'); return; }
    }
    try { localStorage.setItem(NOTIF_ON, cb.checked ? '1' : '0'); } catch (e) {}
  };
};
async function refreshNotif() {
  if (!isLoggedIn || !currentUser) return;
  if (typeof fetchMessages === 'function') await fetchMessages(currentUser.email).catch(() => {});
  updateBell();
  if (isAdmin()) loadAdminResv();
}
setInterval(refreshNotif, 30000);

/* ══════════════ 9. 英語表示 ══════════════ */
window.fxToggleLang = function () {
  fxLang = fxLang === 'en' ? 'ja' : 'en';
  try { localStorage.setItem('vr_lang', fxLang); } catch (e) {}
  document.documentElement.lang = fxLang;
  document.querySelectorAll('.fx-lang').forEach(b => { b.textContent = fxLang === 'en' ? '日本語' : 'EN'; });
  translateAll();
  if (typeof pdCurrentId !== 'undefined' && $('pd-overlay').classList.contains('show')) { const p = findProp(pdCurrentId); if (p) renderPropDetail(p); }
  renderCompareBar(); decorateCards();
  const say = $('fx-yk-say'); if (say) ykSay(say, ykTip);
};
function t(s) { return fxLang === 'en' && EN[s] ? EN[s] : s; }
window.fxT = t;
const EN = {
  // 共通・ナビ
  'トップ': 'Home', 'マップ': 'Map', 'マイページ': 'My page', 'お問い合わせ': 'Contact', '管理者': 'Admin', 'マスター': 'Master',
  '物件を探す': 'Find homes', 'マップで探す': 'Search on map', 'ログアウト': 'Log out', 'ログイン': 'Log in', '新規登録': 'Sign up',
  '← 一覧': '← List', '閉じる': 'Close', '検索': 'Search', 'リセット': 'Reset', '詳細条件': 'More filters', 'この条件で検索': 'Search with these filters',
  'メールアドレス': 'Email', 'パスワード': 'Password', 'パスワードをお忘れですか？': 'Forgot password?', 'アカウントをお持ちでない方は': "Don't have an account?",
  'VR内見不動産サービス': 'Real estate with VR viewing', 'VR対応物件 掲載中': 'VR-ready listings available',
  '自宅から、360°': 'From home, 360°', 'VR内見': 'VR viewing', 'できる': '', '不動産サービス': 'real estate service',
  '物件を選ぶだけ。スマホ・PC・VRゴーグルのブラウザで、移動なしの内見体験を。': 'Just pick a home. View it in your phone, PC or VR headset browser — no travel needed.',
  'エリア・駅名': 'Area / station', '家賃上限（万円）': 'Max rent (×10,000 yen)', '間取り': 'Layout', '渋谷、新宿、池袋など': 'Shibuya, Shinjuku…', '1LDK、2LDKなど': '1LDK, 2LDK…', '例: 10': 'e.g. 10',
  '検索結果': 'Results', '件の物件': 'homes', '条件で絞り込む': 'Filter', '物件を絞り込む': 'Filter homes', 'こだわり条件': 'Features', 'エリア': 'Area', '家賃上限': 'Max rent',
  '物件種別': 'Type', '設備・条件': 'Features', 'VRで内見する': 'View in VR', '問い合わせる': 'Contact agent', '費用': 'Costs', 'アクセス': 'Access', '物件説明': 'Description',
  '詳細情報': 'Details', '周辺情報': 'Neighborhood', '所在地': 'Location', '編集': 'Edit', '削除': 'Delete', '/月': '/mo',
  'お気に入り': 'Favorites', '受信箱': 'Inbox', '閲覧履歴': 'History', 'プロフィール': 'Profile', '希望条件': 'Preferences', 'コード入力': 'Enter code', '内見予約': 'Viewings',
  'お気に入り物件': 'Favorite homes', 'お気に入りはまだありません': 'No favorites yet', '受信メッセージはありません': 'No messages', '閲覧履歴はありません': 'No history yet',
  'プロフィール設定': 'Profile settings', '氏名': 'Name', 'お名前': 'Name', 'メール': 'Email', '変更を保存': 'Save changes', 'パスワードを変更': 'Change password', 'パスワード変更': 'Change password',
  '現在のパスワード': 'Current password', '新しいパスワード（6文字以上）': 'New password (6+ chars)', '新しいパスワード（確認）': 'Confirm new password',
  '希望条件を登録すると、次回の検索に活用できます。': 'Save your preferences to use them in searches and alerts.', '希望間取り': 'Layout', '保存する': 'Save', 'この条件で見る': 'Show matching homes',
  'マンション': 'Apartment (mansion)', 'アパート': 'Apartment', '一戸建て': 'House', 'テラスハウス': 'Terrace house', 'タワーマンション': 'Tower apartment', 'ヴィラ・邸宅': 'Villa',
  'シェアハウス': 'Share house', '学生寮': 'Student dorm', '店舗・事務所': 'Shop / office',
  'オートロック': 'Auto-lock', 'バス・トイレ別': 'Separate bath/toilet', 'エアコン': 'Air conditioner', 'インターネット無料': 'Free internet', '浴室乾燥機': 'Bathroom dryer',
  '宅配ボックス': 'Parcel locker', '南向き': 'South-facing', 'ペット可': 'Pets OK', '独立洗面台': 'Separate vanity', '室内洗濯機置場': 'Indoor washer space', '駐車場': 'Parking',
  '駐輪場': 'Bike parking', '即入居可': 'Move in now', 'ネット無料': 'Free internet',
  '〜6万円': '≤ ¥60k', '〜8万円': '≤ ¥80k', '〜10万円': '≤ ¥100k', '〜15万円': '≤ ¥150k', '3LDK以上': '3LDK+',
  'サイトの使い方': 'How to use', 'VR内見の動作環境': 'VR requirements', '運営へのお問い合わせ': 'Contact us', 'お問い合わせ内容': 'Message', '送信する': 'Send',
  'ご質問・ご要望など': 'Questions or requests', '返信先メールアドレス': 'Reply-to email',
  '面積': 'Size', '最寄駅': 'Station', '徒歩': 'Walk', '構造': 'Structure', '築年数': 'Age', '家賃': 'Rent', '管理費': 'Mgmt fee', '敷金': 'Deposit', '礼金': 'Key money', 'なし': 'None',
  '入居時期': 'Move-in', '取引態様': 'Transaction', '総戸数': 'Units', '契約期間': 'Lease term', '更新料': 'Renewal fee', '保証会社': 'Guarantor', '入居条件': 'Conditions', '損保': 'Insurance', 'その他費用': 'Other fees',
  '地図データなし': 'No map data', '物件が登録されていません': 'No homes listed', '条件に合う物件が見つかりません': 'No homes match your filters',
  '管理者パネル': 'Admin panel', '物件管理': 'Listings', 'グループ': 'Group', 'ユーザー管理': 'Users', '分析': 'Analytics', '予約': 'Viewings', 'アクセス分析': 'Analytics', 'ユーザー数': 'Users',
  '登録物件数': 'Listings', 'VR内見できる物件': 'VR-ready homes', 'あなたが登録した物件': 'Your listings', '平均家賃': 'Average rent', '物件を追加': 'Add listing',
  'VR体験': 'VR', '間取りを確認': 'Floor plan', '物件を選ぶ': 'Pick a home', 'たった3ステップ': 'Just 3 steps', '4つの理由': '4 reasons', '選ばれる': 'Why us',
  '物件一覧を見る': 'Browse homes', 'マップで見る': 'View on map', 'VR内見を今すぐ体験しよう': 'Try VR viewing now', '完全無料': 'Free', '24時間いつでも内見': 'View 24/7',
  '精密な3D間取り': 'Accurate 3D plans', 'スマホ・PC・Quest対応': 'Phone, PC & Quest', '全国の物件に対応': 'Nationwide',
  'スマホ・タブレット': 'Phone / tablet', '掲載物件数': 'Listings', 'いつでも内見可': 'View anytime', 'VR内見開始': 'Start VR',
  'VR Homes をインストール': 'Install VR Homes', 'ホーム画面に追加してアプリとして使えます': 'Add to your home screen to use it like an app', '追加する': 'Add',
  // 追加機能
  '内見を予約する': 'Book a viewing', '一緒に内見': 'View together', 'コードで参加': 'Join with code', '比較': 'Compare', '比較中': 'Comparing', '共有': 'Share', '印刷': 'Print',
  '担当者や家族と同じ部屋を一緒に見られます': 'Walk through with an agent or family', '回': ' views', '平均': 'avg ', '秒': 's',
  '初期費用・月々の支払いを計算する': 'Calculate move-in & monthly costs', '入居日': 'Move-in date', '仲介手数料': 'Agent fee', '家賃0.5ヶ月': '0.5 mo rent', '家賃1ヶ月': '1 mo rent',
  '保証会社（初回）': 'Guarantor (first)', '月額の50%': '50% of monthly', '月額の100%': '100% of monthly', '火災保険': 'Fire insurance', '鍵の交換': 'Lock change', 'その他': 'Other',
  '日割り家賃': 'Prorated rent', '日': 'd', '翌月分の家賃・管理費': "Next month's rent + fee", '仲介手数料（税込）': 'Agent fee (incl. tax)', '初期費用の合計（目安）': 'Estimated move-in total',
  '毎月の支払い（家賃＋管理費）': 'Monthly (rent + fee)', '家賃の目安は手取りの3分の1と言われます。この物件なら手取り': 'Rent is often kept to 1/3 of take-home pay. For this home, aim for a take-home of',
  '以上が目安です。': 'or more.', '※ 実際の金額は不動産会社にご確認ください。': '* Please confirm actual amounts with the agent.',
  '物件資料': 'Property sheet', '間取り図': 'Floor plan',
  '内見の方法': 'How', '現地で内見': 'In person', 'オンラインで一緒にVR内見': 'Online VR with agent', '日にち': 'Date', '時間': 'Time', '電話番号（任意）': 'Phone (optional)',
  'ご要望など（任意）': 'Requests (optional)', '例: 駐車場を見たいです': 'e.g. I want to see the parking', 'この日時で予約する': 'Book this time', 'で予約する': '— book', '時間を選んでください': 'Choose a time',
  '予約済み': 'Booked', '満': 'full', '予約は担当者が確認すると「確定」になり、マイページとお知らせに届きます。': 'The agent will confirm your booking. You will be notified in My page.',
  '予約を申し込みました。確定したらお知らせします': 'Booking sent. We will notify you when confirmed.',
  '確認待ち': 'Pending', '確定': 'Confirmed', 'お断り': 'Declined', 'キャンセル': 'Cancelled', '完了': 'Done', '読み込み中…': 'Loading…',
  'まだ予約はありません。物件ページの「内見を予約する」から申し込めます。': 'No bookings yet. Use "Book a viewing" on a property page.',
  '一緒にVR内見に参加': 'Join VR viewing', 'この予約をキャンセルしますか？': 'Cancel this booking?', 'キャンセルしました': 'Cancelled',
  '参加コード（6けた）を入力してください': 'Enter the 6-digit join code', '参加コードは6けたの数字です': 'The join code is 6 digits',
  '比較できるのは4件までです': 'You can compare up to 4 homes', '比較リスト': 'Compare list', '件': '', '比較する': 'Compare', 'クリア': 'Clear', '外す': 'Remove', '物件を比較': 'Compare homes',
  '毎月の支払い': 'Monthly total', '初期費用の目安': 'Est. move-in cost', '1㎡あたりの家賃': 'Rent per m²', '駅まで': 'To station', '分': ' min', '年': ' yrs', '敷金・礼金': 'Deposit / key', 'ヶ月': 'mo',
  '実写': 'Real photo', 'VRで内見': 'View in VR',
  '緑の数字は、比べた中でいちばん条件が良いものです。初期費用は仲介手数料1ヶ月・保証会社50%などで計算した目安です。': 'Green = best among compared homes. Move-in cost assumes 1 month agent fee, 50% guarantor, etc.',
  'この物件を共有': 'Share this home', 'コピー': 'Copy', 'リンクを開いた人は、ログインするとこの物件のページが開きます。': 'People who open the link will see this home after logging in.',
  'リンクをコピーしました': 'Link copied', '月': 'mo',
  'お知らせ': 'Notifications', 'すべて既読': 'Mark all read', '希望条件に合う新着物件': 'New homes matching your preferences', '新着物件': 'New homes', '新着はありません': 'Nothing new',
  '未読のメッセージ': 'Unread messages', '未読はありません': 'No unread messages', '希望条件を登録すると、合う物件だけお知らせします': 'Set preferences to only get matching homes',
  'ブラウザの通知も受け取る': 'Also get browser notifications', 'ブラウザの設定で通知が許可されていません': 'Notifications are blocked in your browser', '新しいお知らせがあります': 'You have new notifications',
  'ここに表示する予約はありません': 'No bookings to show', 'おすすめの物件': 'Recommended homes',
  'ログイン': 'Log in', '休み': 'Closed', '予約すると': 'By booking you agree to our', '個人情報の取り扱い': 'privacy policy', 'に同意したものとします。': '.',
  '受け付けている日がありません': 'No available days', 'この物件は現在、内見の予約を受け付けていません': 'This home is not accepting bookings now',
  '募集中': 'Available', '申込あり': 'Application received', '成約済み': 'Rented', '非公開': 'Private', '成約済みも表示': 'Show rented',
  'この物件は成約済みです': 'This home has been rented', 'この物件は非公開です（編集できる人にだけ表示）': 'This home is private (visible to editors only)',
  '通勤・通学先（駅名・学校・会社の住所）': 'Commute to (station, school or office)', '分以内': ' min or less', '時間で探す': 'Search by time', '解除': 'Clear',
  '場所を調べています…': 'Looking up…', '場所が見つかりませんでした。駅名や住所で入れてください': 'Place not found. Try a station name or address',
  'まで': 'to', '分以内の物件（電車は時速30km・乗り換え待ちを足した目安です）': 'min or less (estimate: train ~30 km/h plus waiting)', 'まで約': 'to: about ', '分（目安）': ' min (est.)',
  '周辺施設': 'Nearby', '周辺のお店・学校・病院などを表示': 'Show nearby shops, schools, hospitals…', '周辺の施設を調べています…': 'Searching nearby…',
  'コンビニ': 'Convenience store', 'スーパー': 'Supermarket', '駅': 'Station', '病院・クリニック': 'Hospital / clinic', '学校・保育園': 'School / nursery', '公園': 'Park',
  '銀行・郵便局': 'Bank / post office', '飲食店': 'Restaurants', '800m以内にありません': 'None within 800 m',
  '徒歩時間は直線距離から計算した目安です。地図データ © OpenStreetMap': 'Walking times are estimates from straight-line distance. Map data © OpenStreetMap'
};
const EN_RE = [
  [/^徒歩(\d+)分$/, (m, a) => `${a} min walk`],
  [/^築(\d+)年$/, (m, a) => `${a} yrs old`],
  [/^全(\d+)件中 (\d+)〜(\d+)件を表示$/, (m, a, b, c) => `Showing ${b}–${c} of ${a}`],
  [/^(\d+)ヶ月$/, (m, a) => `${a} mo`],
  [/^(.+)駅$/, (m, a) => `${a} Sta.`]
];
const ORIG = new WeakMap(), ORIG_ATTR = new WeakMap();
const SKIP = 'script,style,textarea,input,select,option,.pd-modal #pd-name,#pd-desc,#pd-surroundings,#pd-address,.prop-name,.fx-noi18n,#fe-iframe';
function trText(s) {
  const k = s.trim();
  if (!k) return null;
  if (EN[k] !== undefined) return s.replace(k, EN[k]);
  for (const [re, fn] of EN_RE) if (re.test(k)) return s.replace(k, k.replace(re, fn));
  return null;
}
function translateNode(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) return n.matches && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return /[ぁ-んァ-ン一-龥〜]/.test(n.nodeValue) || ORIG.has(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    if (fxLang === 'en') {
      const orig = ORIG.has(node) ? ORIG.get(node) : node.nodeValue;
      const tr = trText(orig);
      if (tr !== null && node.nodeValue !== tr) { ORIG.set(node, orig); node.nodeValue = tr; }
    } else if (ORIG.has(node)) { node.nodeValue = ORIG.get(node); ORIG.delete(node); }
  });
  const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : [];
  els.forEach(el => {
    ['placeholder', 'title'].forEach(a => {
      if (!el.hasAttribute(a)) return;
      const store = ORIG_ATTR.get(el) || {};
      if (fxLang === 'en') {
        const orig = store[a] !== undefined ? store[a] : el.getAttribute(a);
        const tr = EN[orig.trim()];
        if (tr !== undefined) { store[a] = orig; ORIG_ATTR.set(el, store); el.setAttribute(a, tr); }
      } else if (store[a] !== undefined) { el.setAttribute(a, store[a]); delete store[a]; }
    });
  });
}
let trBusy = false;
function translateAll() { trBusy = true; try { translateNode(document.body); } finally { mo.takeRecords(); trBusy = false; } }
const mo = new MutationObserver(muts => {
  if (fxLang !== 'en' || trBusy) return;
  trBusy = true;
  try {
    muts.forEach(m => {
      if (m.type === 'characterData') { const p = m.target.parentNode; if (p && !(p.closest && p.closest(SKIP))) { ORIG.delete(m.target); translateNode(p); } }
      else m.addedNodes.forEach(nd => {
        if (nd.nodeType === 3) { const p = nd.parentNode; if (p && !(p.closest && p.closest(SKIP))) translateNode(p); }
        else if (nd.nodeType === 1 && !(nd.closest && nd.closest(SKIP))) translateNode(nd);
      });
    });
  } finally { mo.takeRecords(); trBusy = false; }
});

/* ══════════════ 11. ログインしなくても見られる（ゲスト閲覧）══════════════ */
let afterLogin = null;
function showGate(msg) {
  const g = $('login-gate'); if (!g) return;
  g.classList.remove('hidden'); g.style.display = '';
  if (msg && typeof showGateMsg === 'function') setTimeout(() => showGateMsg(msg, false), 0);
}
function hideGate() { const g = $('login-gate'); if (g) { g.style.display = 'none'; g.classList.add('hidden'); } afterLogin = null; }
function requireLogin(reason, fn) {
  if (isLoggedIn) return true;
  afterLogin = fn || null;
  showGate(reason || 'この機能を使うにはログインしてください');
  return false;
}
window.fxRequireLogin = requireLogin;
window.fxHideGate = hideGate;
function setGuestClass() { document.documentElement.classList.toggle('fx-guest', !isLoggedIn); }
const _restoreSession = window.restoreSession;
window.restoreSession = function () {
  const ok = _restoreSession.apply(this, arguments);
  if (!ok) { hideGate(); setGuestClass(); }
  return ok;
};
(function addGateClose() {
  const card = document.querySelector('#login-gate .login-card');
  if (!card || $('fx-gate-skip')) return;
  const b = document.createElement('button');
  b.id = 'fx-gate-skip'; b.type = 'button'; b.className = 'fx-gate-skip';
  b.innerHTML = '<i class="ti ti-arrow-left"></i> ログインせずに物件を見る';
  b.onclick = hideGate;
  card.appendChild(b);
  const links = document.createElement('div');
  links.className = 'fx-gate-links';
  links.innerHTML = '<a href="terms.html" target="_blank">利用規約</a>・<a href="privacy.html" target="_blank">個人情報の取り扱い</a>';
  card.appendChild(links);
})();
const _guarded = window.guardedScreen;
window.guardedScreen = function (id) {
  if (!isLoggedIn) {
    if (['top', 'map', 'help'].includes(id)) { showScreen(id); if (id === 'map') setTimeout(initLeafletMap, 150); return; }
    requireLogin(id === 'mypage' ? 'マイページを使うにはログインしてください' : 'ログインしてください', () => _guarded(id));
    return;
  }
  return _guarded.apply(this, arguments);
};
const _toggleFav = window.toggleFav;
window.toggleFav = function (id, el) {
  if (!isLoggedIn) { requireLogin('お気に入りに追加するにはログインしてください', () => _toggleFav(id, document.querySelector(`.fav-btn[data-prop-id="${id}"]`))); return; }
  return _toggleFav.apply(this, arguments);
};
const _openContact = window.openContactForm;
window.openContactForm = function (propId) {
  if (!isLoggedIn) { requireLogin('問い合わせるにはログインしてください', () => _openContact(propId)); return; }
  return _openContact.apply(this, arguments);
};
/* 新規登録のときは、規約と個人情報の取り扱いへの同意を必須にする */
const _switchGateAuth = window.switchGateAuth;
window.switchGateAuth = function (tab) {
  const r = _switchGateAuth.apply(this, arguments);
  if (tab === 'reg') setTimeout(() => {
    const form = $('gate-form'); if (!form || $('fx-agree')) return;
    const btn = form.querySelector('button.lbtn, button[onclick*="gateRegister"]');
    const lab = document.createElement('label');
    lab.className = 'fx-agree';
    lab.innerHTML = '<input type="checkbox" id="fx-agree"> <span><a href="terms.html" target="_blank">利用規約</a>と<a href="privacy.html" target="_blank">個人情報の取り扱い</a>に同意します</span>';
    if (btn) btn.parentNode.insertBefore(lab, btn); else form.appendChild(lab);
  }, 0);
  return r;
};
const _gateRegister = window.gateRegister;
window.gateRegister = function () {
  const a = $('fx-agree');
  if (a && !a.checked) { if (typeof showGateMsg === 'function') showGateMsg('利用規約と個人情報の取り扱いに同意してください', true); return; }
  return _gateRegister.apply(this, arguments);
};

/* ══════════════ 12. 物件の状態（募集中・申込あり・成約済み・非公開）══════════════ */
const PSTATUS = { open: ['募集中', '#16a34a'], applied: ['申込あり', '#f59e0b'], closed: ['成約済み', '#64748b'], hidden: ['非公開', '#7c3aed'] };
let showClosed = false;
const _getFiltered = window.getFilteredProps;
window.getFilteredProps = function () {
  let list = _getFiltered.apply(this, arguments);
  if (!showClosed) list = list.filter(p => p.status !== 'closed' || canEdit(p));
  if (commute) {
    list = list.filter(p => { const m = commuteMin(p); return m != null && m <= commute.max; });
    list.sort((a, b) => commuteMin(a) - commuteMin(b));
  }
  return list;
};
function addListControls() {
  const cnt = $('results-count');
  if (!cnt || $('fx-list-ctl')) return;
  const host = cnt.parentNode;
  const box = document.createElement('span');
  box.id = 'fx-list-ctl';
  box.innerHTML = `<label class="fx-chk"><input type="checkbox" id="fx-show-closed"> ${t('成約済みも表示')}</label>`;
  host.appendChild(box);
  $('fx-show-closed').onchange = e => { showClosed = e.target.checked; currentPage = 1; renderCards(); updateResultsCount(); };
}

/* ══════════════ 13. 物件フォーム：状態・内見できる日時・360°写真 ══════════════ */
const fxForm = { status: 'open', days: [0, 1, 2, 3, 4, 5, 6], start: 10, end: 18, closed: [], panos: [] };
function addFormExtras() {
  const splat = $('af-splat'); if (!splat || $('fx-af-extra')) return;
  const field = splat.closest('.field');
  const box = document.createElement('div');
  box.className = 'field'; box.style.gridColumn = '1/-1'; box.id = 'fx-af-extra';
  const hours = []; for (let h = 6; h <= 23; h++) hours.push(h);
  box.innerHTML = `
    <div class="fx-af-grid">
      <div><div class="flabel">掲載状態</div>
        <select class="finput" id="af-status">${Object.entries(PSTATUS).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select>
        <div class="fx-mini">「非公開」は自分（とグループ）にだけ見えます。「成約済み」は一覧から外れ、予約もできなくなります。</div></div>
      <div><div class="flabel">内見を受け付ける曜日・時間</div>
        <div class="fx-wdays" id="af-wdays">${WEEK.map((w, i) => `<button type="button" data-d="${i}">${w}</button>`).join('')}</div>
        <div class="fx-row"><select class="finput fx-hsel" id="af-hstart">${hours.map(h => `<option value="${h}">${h}:00</option>`).join('')}</select> 〜
          <select class="finput fx-hsel" id="af-hend">${hours.map(h => `<option value="${h}">${h}:00</option>`).join('')}<option value="24">24:00</option></select></div></div>
    </div>
    <div class="flabel" style="margin-top:10px">休みの日（この日は予約を受け付けない）</div>
    <div class="fx-row"><input type="date" class="finput" id="af-closed-date" style="max-width:180px"><button type="button" class="btn btn-sm" id="af-closed-add">追加</button></div>
    <div class="fx-chips" id="af-closed-list"></div>
    <div class="flabel" style="margin-top:12px">360°写真（任意）<span style="font-size:10px;color:#94a3b8;font-weight:400;margin-left:6px">THETAなどの全天球カメラで撮った写真。部屋ごとに入れるとVR内見で切り替えられます</span></div>
    <input type="file" id="af-pano" accept="image/jpeg,image/png,image/webp" multiple class="finput" style="padding:7px 11px">
    <div id="af-pano-list" class="fx-pano-list"></div>`;
  field.parentNode.insertBefore(box, field.nextSibling);
  box.querySelectorAll('#af-wdays button').forEach(b => b.onclick = () => { const d = +b.dataset.d; fxForm.days = fxForm.days.includes(d) ? fxForm.days.filter(x => x !== d) : fxForm.days.concat([d]).sort(); renderFormExtras(); });
  $('af-status').onchange = e => { fxForm.status = e.target.value; };
  $('af-hstart').onchange = e => { fxForm.start = +e.target.value; if (fxForm.end <= fxForm.start) fxForm.end = fxForm.start + 1; renderFormExtras(); };
  $('af-hend').onchange = e => { fxForm.end = +e.target.value; if (fxForm.end <= fxForm.start) fxForm.start = fxForm.end - 1; renderFormExtras(); };
  $('af-closed-add').onclick = () => { const v = $('af-closed-date').value; if (v && !fxForm.closed.includes(v)) { fxForm.closed.push(v); fxForm.closed.sort(); renderFormExtras(); } };
  $('af-pano').onchange = async e => {
    for (const f of e.target.files) {
      try {
        const dataURL = await resizeImageToDataURL(f, 4096, 0.85);
        fxForm.panos.push({ dataURL, name: f.name.replace(/\.[^.]+$/, '').slice(0, 30) || '360°写真' });
      } catch (err) { toast('画像を読み込めませんでした: ' + f.name, 'error'); }
    }
    e.target.value = '';
    renderFormExtras();
  };
  renderFormExtras();
}
function renderFormExtras() {
  if (!$('fx-af-extra')) return;
  $('af-status').value = fxForm.status;
  $('af-hstart').value = fxForm.start; $('af-hend').value = fxForm.end;
  document.querySelectorAll('#af-wdays button').forEach(b => b.classList.toggle('on', fxForm.days.includes(+b.dataset.d)));
  $('af-closed-list').innerHTML = fxForm.closed.map(d => `<span class="fx-chip">${d}<b data-d="${d}">×</b></span>`).join('');
  $('af-closed-list').querySelectorAll('b').forEach(b => b.onclick = () => { fxForm.closed = fxForm.closed.filter(x => x !== b.dataset.d); renderFormExtras(); });
  $('af-pano-list').innerHTML = fxForm.panos.map((p, i) => `<div class="fx-pano"><div class="fx-pano-img" style="background-image:url('${esc(p.url || p.dataURL)}')"></div>
    <input class="finput" data-i="${i}" value="${esc(p.name)}" maxlength="30" placeholder="部屋の名前"><button type="button" class="btn btn-sm" data-del="${i}" style="color:var(--red)">削除</button></div>`).join('');
  $('af-pano-list').querySelectorAll('input[data-i]').forEach(inp => inp.onchange = () => { fxForm.panos[+inp.dataset.i].name = inp.value.trim(); });
  $('af-pano-list').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { fxForm.panos.splice(+b.dataset.del, 1); renderFormExtras(); });
}
function resetFormExtras(prop) {
  const r = (prop && prop.viewingRule) || {};
  fxForm.status = (prop && prop.status) || 'open';
  fxForm.days = Array.isArray(r.days) ? r.days.slice() : [0, 1, 2, 3, 4, 5, 6];
  fxForm.start = r.start != null ? +r.start : 10; fxForm.end = r.end != null ? +r.end : 18;
  fxForm.closed = Array.isArray(r.closed) ? r.closed.slice() : [];
  fxForm.panos = ((prop && prop.panoramas) || []).map(p => ({ url: p.url, name: p.name || '' }));
  renderFormExtras();
}
const _startEdit = window.startEditProp;
window.startEditProp = async function (id) {
  if (!(await ensureFull(id))) return;
  const r = _startEdit.apply(this, arguments);
  resetFormExtras(findProp(id)); addPhotoBulkDelete();
  return r;
};
const _clearAdd = window.clearAddForm;
window.clearAddForm = function () { const r = _clearAdd.apply(this, arguments); resetFormExtras(null); return r; };
let pendingExtras = null;
const extrasById = {};
const _addProperty = window.addProperty;
window.addProperty = async function () {
  if (!(($('af-name') || {}).value || '').trim()) return _addProperty.apply(this, arguments);
  // 360°写真を先にアップロードする
  const panos = [];
  for (const p of fxForm.panos) {
    if (p.url) { panos.push({ url: p.url, name: p.name }); continue; }
    toast('360°写真をアップロード中…', 'info');
    const url = await uploadPhotoToS3(p.dataURL);
    if (!/^https:\/\//.test(url)) { toast('360°写真をアップロードできませんでした', 'error'); return; }
    p.url = url; delete p.dataURL;
    panos.push({ url, name: p.name });
  }
  pendingExtras = { status: fxForm.status, viewingRule: { days: fxForm.days.slice(), start: fxForm.start, end: fxForm.end, closed: fxForm.closed.slice() }, panoramas: panos,
    features: (fxForm.features || []).slice() };   // 新しく登録するときは保存の前にフォームが閉じて空になるので、ここで覚えておく
  if (typeof isMaster === 'function' && isMaster() && fxForm.featuredUntil) pendingExtras.featuredUntil = fxForm.featuredUntil;
  try { return await _addProperty.apply(this, arguments); } finally { pendingExtras = null; try { renderCards(); renderAdminPropTable(); } catch (e) {} }
};
const _uploadToAWS = window.uploadToAWS;
window.uploadToAWS = async function (prop) {
  const ex = pendingExtras; pendingExtras = null;
  if (ex) Object.assign(prop, ex);
  const sid = await _uploadToAWS.apply(this, arguments);
  if (ex && sid != null) { extrasById[sid] = ex; setTimeout(() => { const p = findProp(sid); if (p) Object.assign(p, ex); renderCards(); }, 0); }
  return sid;
};
const _updateOnAWS = window.updatePropertyOnAWS;
window.updatePropertyOnAWS = function (prop) {
  const ex = pendingExtras; pendingExtras = null;
  if (ex) Object.assign(prop, ex);
  else if (prop && prop.status === undefined && extrasById[prop.id]) Object.assign(prop, extrasById[prop.id]);
  return _updateOnAWS.apply(this, arguments);
};

/* ══════════════ 14. 通勤・通学時間で探す ══════════════ */
let commute = null;   // { name, lat, lng, max }
function kmBetween(a, b, c, d) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLat = r(c - a), dLng = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// 目安: 近ければ徒歩(分速80m)、遠ければ「駅まで徒歩＋待ち時間＋電車(時速約30km)」
function commuteMin(p) {
  if (!commute || !p.lat || !p.lng) return null;
  const km = kmBetween(+p.lat, +p.lng, commute.lat, commute.lng) * 1.25;   // 道のりは直線の約1.25倍
  const walk = km * 1000 / 80;
  const train = (+p.walkMin || 10) + 8 + km / 30 * 60;
  return Math.round(Math.min(walk, train));
}
function addCommuteUI() {
  const sb = document.querySelector('#s-top .search-bar');
  if (!sb || $('fx-commute')) return;
  const box = document.createElement('div');
  box.id = 'fx-commute';
  box.innerHTML = `<div class="fx-cm-row"><i class="ti ti-train"></i>
    <input class="finput" id="fx-cm-place" placeholder="${t('通勤・通学先（駅名・学校・会社の住所）')}">
    <select class="finput" id="fx-cm-max">${[15, 20, 30, 45, 60, 90].map(m => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${m}${t('分以内')}</option>`).join('')}</select>
    <button class="btn btn-sm btn-p" id="fx-cm-go">${t('時間で探す')}</button><button class="btn btn-sm" id="fx-cm-clear" style="display:none">${t('解除')}</button></div>
    <div class="fx-mini" id="fx-cm-msg"></div>`;
  sb.appendChild(box);
  $('fx-cm-go').onclick = async () => {
    const q = $('fx-cm-place').value.trim(); if (!q) return;
    $('fx-cm-msg').textContent = t('場所を調べています…');
    let c = await geocodeAddress(q);
    if (!c && !/駅$/.test(q)) c = await geocodeAddress(q + '駅');
    if (!c) { $('fx-cm-msg').textContent = t('場所が見つかりませんでした。駅名や住所で入れてください'); return; }
    commute = { name: q, lat: c.lat, lng: c.lng, max: +$('fx-cm-max').value };
    $('fx-cm-msg').textContent = `${q} ${t('まで')} ${commute.max}${t('分以内の物件（電車は時速30km・乗り換え待ちを足した目安です）')}`;
    $('fx-cm-clear').style.display = '';
    currentPage = 1; renderCards(); updateResultsCount();
  };
  $('fx-cm-place').onkeydown = e => { if (e.key === 'Enter') $('fx-cm-go').click(); };
  $('fx-cm-max').onchange = () => { if (commute) { commute.max = +$('fx-cm-max').value; renderCards(); updateResultsCount(); } };
  $('fx-cm-clear').onclick = () => { commute = null; $('fx-cm-msg').textContent = ''; $('fx-cm-clear').style.display = 'none'; renderCards(); updateResultsCount(); };
}

/* ══════════════ 15. 周辺施設 ══════════════ */
const POI = [
  ['コンビニ', 'ti-building-store', '#ef4444', '["shop"="convenience"]'],
  ['スーパー', 'ti-shopping-cart', '#f97316', '["shop"="supermarket"]'],
  ['駅', 'ti-train', '#2563eb', '["railway"="station"]'],
  ['病院・クリニック', 'ti-first-aid-kit', '#dc2626', '["amenity"~"hospital|clinic|doctors"]'],
  ['学校・保育園', 'ti-school', '#7c3aed', '["amenity"~"school|kindergarten|childcare"]'],
  ['公園', 'ti-trees', '#16a34a', '["leisure"="park"]'],
  ['銀行・郵便局', 'ti-building-bank', '#0891b2', '["amenity"~"bank|post_office"]'],
  ['飲食店', 'ti-tools-kitchen-2', '#a16207', '["amenity"~"restaurant|cafe|fast_food"]']
];
const poiCache = {};
async function loadPoi(p) {
  const key = (+p.lat).toFixed(4) + ',' + (+p.lng).toFixed(4);
  if (poiCache[key]) return poiCache[key];
  try { const c = JSON.parse(sessionStorage.getItem('vr_poi_' + key) || 'null'); if (c) return (poiCache[key] = c); } catch (e) {}
  const R = 800;
  const q = '[out:json][timeout:20];(' + POI.map(x => `node${x[3]}(around:${R},${p.lat},${p.lng});way${x[3]}(around:${R},${p.lat},${p.lng});`).join('') + ');out center 300;';
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error('周辺情報を取得できませんでした');
  const data = await res.json();
  const out = POI.map(() => []);
  (data.elements || []).forEach(el => {
    const lat = el.lat || (el.center && el.center.lat), lng = el.lon || (el.center && el.center.lon);
    if (!lat) return;
    const tg = el.tags || {};
    const i = POI.findIndex(x => {
      const m = x[3].match(/\["(\w+)"(=|~)"([^"]+)"\]/);
      return m && (m[2] === '=' ? tg[m[1]] === m[3] : new RegExp('^(' + m[3] + ')$').test(tg[m[1]] || ''));
    });
    if (i < 0) return;
    out[i].push({ name: tg.name || POI[i][0], lat, lng, m: Math.round(kmBetween(+p.lat, +p.lng, lat, lng) * 1000) });
  });
  out.forEach(a => a.sort((x, y) => x.m - y.m));
  poiCache[key] = out;
  try { sessionStorage.setItem('vr_poi_' + key, JSON.stringify(out)); } catch (e) {}
  return out;
}
let poiLayer = null;
window.fxShowPoi = async function (propId) {
  const p = findProp(propId); const box = $('fx-poi'); if (!p || !box) return;
  box.innerHTML = `<div class="fx-mini">${t('周辺の施設を調べています…')}</div>`;
  try {
    const list = await loadPoi(p);
    box.innerHTML = `<div class="fx-poi-grid">${POI.map((x, i) => {
      const a = list[i], n = a[0];
      return `<div class="fx-poi-item"><i class="ti ${x[1]}" style="color:${x[2]}"></i><div><b>${t(x[0])}</b> <small>${a.length}${t('件')}</small>
        ${n ? `<span>${esc(n.name)}　${t('徒歩')}${Math.max(1, Math.round(n.m / 80))}${t('分')}（${n.m}m）</span>` : `<span class="none">${t('800m以内にありません')}</span>`}</div></div>`;
    }).join('')}</div><div class="fx-mini">${t('徒歩時間は直線距離から計算した目安です。地図データ © OpenStreetMap')}</div>`;
    if (typeof pdMiniMap !== 'undefined' && pdMiniMap && typeof L !== 'undefined') {
      if (poiLayer) poiLayer.remove();
      poiLayer = L.layerGroup().addTo(pdMiniMap);
      POI.forEach((x, i) => list[i].slice(0, 5).forEach(n => L.circleMarker([n.lat, n.lng], { radius: 5, color: '#fff', weight: 1.5, fillColor: x[2], fillOpacity: .95 }).bindTooltip(esc(n.name)).addTo(poiLayer)));
      pdMiniMap.setZoom(15);
    }
  } catch (e) { box.innerHTML = `<div class="fx-mini">${esc(e.message)}</div>`; }
};
function addPoiSection(prop) {
  let sec = $('fx-poi-sec');
  if (!sec) {
    sec = document.createElement('div'); sec.id = 'fx-poi-sec';
    const addr = $('pd-address'); addr.parentNode.insertBefore(sec, addr.nextSibling);
  }
  if (!prop.lat || !prop.lng) { sec.innerHTML = ''; return; }
  sec.innerHTML = `<div class="pd-section-title">${t('周辺施設')}</div><div id="fx-poi"><button class="btn btn-sm" onclick="fxShowPoi(${prop.id})"><i class="ti ti-map-search"></i> ${t('周辺のお店・学校・病院などを表示')}</button></div>`;
  if (poiLayer) { poiLayer.remove(); poiLayer = null; }
  if (commute) {
    const m = commuteMin(prop);
    if (m != null) sec.insertAdjacentHTML('afterbegin', `<div class="fx-cm-badge"><i class="ti ti-train"></i> ${esc(commute.name)} ${t('まで約')}${m}${t('分（目安）')}</div>`);
  }
}

/* ══════════════ 16. CSVでまとめて登録（管理者）══════════════ */
const CSV_COLS = [['name', '物件名'], ['price', '家賃'], ['mgmt', '管理費'], ['deposit', '敷金'], ['key', '礼金'], ['madori', '間取り'], ['size', '面積'],
  ['type', '物件種別'], ['structure', '構造'], ['age', '築年数'], ['address', '住所'], ['area', 'エリア'], ['station', '最寄駅'], ['walkMin', '徒歩分'],
  ['features', '設備'], ['description', '説明'], ['status', '状態']];
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
window.fxCsvTemplate = function () {
  const head = CSV_COLS.map(c => c[1]).join(',');
  const ex = 'ハイツ渋谷,85000,5000,1,1,1LDK,38,マンション,RC,8,東京都渋谷区道玄坂1-10-8,東京都渋谷区,渋谷,5,オートロック;エアコン;バス・トイレ別,駅近の1LDKです,募集中';
  const blob = new Blob(['﻿' + head + '\n' + ex + '\n'], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vrhomes_物件テンプレート.csv';
  document.body.appendChild(a); a.click(); a.remove();
};
window.fxOpenCsv = function () {
  const body = openModal('fx-csv', '<i class="ti ti-file-spreadsheet"></i> CSVでまとめて登録', `
    <p class="fx-mini" style="margin-top:0">1行目に見出し（物件名・家賃・管理費・敷金・礼金・間取り・面積・物件種別・構造・築年数・住所・エリア・最寄駅・徒歩分・設備・説明・状態）を入れたCSVを選んでください。設備は「;」区切り、状態は「募集中／申込あり／成約済み／非公開」です。Excelで作って「CSV UTF-8」で保存できます。</p>
    <div class="fx-row"><button class="btn btn-sm" onclick="fxCsvTemplate()"><i class="ti ti-download"></i> テンプレートをダウンロード</button>
      <input type="file" id="fx-csv-file" accept=".csv,text/csv" class="finput" style="flex:1;padding:6px 10px"></div>
    <div id="fx-csv-prev"></div>`, { width: 900 });
  let items = [];
  body.querySelector('#fx-csv-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let text = await f.text();
    if (text.includes('�')) {   // Shift_JIS で保存されたCSV
      try { text = new TextDecoder('shift_jis').decode(await f.arrayBuffer()); } catch (er) {}
    }
    const rows = parseCSV(text);
    if (rows.length < 2) { $('fx-csv-prev').innerHTML = '<div class="fx-mini">データがありません</div>'; return; }
    const head = rows[0].map(h => h.trim());
    const idx = CSV_COLS.map(([k, ja]) => { const i = head.findIndex(h => h === ja || h === k); return i; });
    const stMap = { '募集中': 'open', '申込あり': 'applied', '成約済み': 'closed', '非公開': 'hidden' };
    items = rows.slice(1).map(r => {
      const o = {}; CSV_COLS.forEach(([k], i) => { if (idx[i] >= 0) o[k] = (r[idx[i]] || '').trim(); });
      const num = v => { const n = parseFloat(String(v || '').replace(/[,円¥\s]/g, '')); return isFinite(n) ? n : 0; };
      const p = { name: o.name, price: num(o.price), mgmt: num(o.mgmt), deposit: num(o.deposit), key: num(o.key), madori: o.madori || '−', size: num(o.size),
        type: o.type || 'マンション', structure: o.structure || '', age: num(o.age), address: o.address || '', area: o.area || '', station: (o.station || '').replace(/駅$/, ''),
        walkMin: num(o.walkMin), features: (o.features || '').split(/[;；、]/).map(s => s.trim()).filter(Boolean), tags: [], description: o.description || '',
        status: stMap[o.status] || o.status || 'open', photoURLs: [], details: {}, access: '', lat: null, lng: null };
      p._err = !p.name ? '物件名がありません' : !p.price ? '家賃がありません' : '';
      return p;
    });
    const ok = items.filter(p => !p._err).length;
    $('fx-csv-prev').innerHTML = `<div class="fx-cmp-wrap" style="max-height:320px;margin-top:10px"><table class="fx-cmp"><tr><th>#</th><th>物件名</th><th>家賃</th><th>間取り</th><th>面積</th><th>最寄駅</th><th>状態</th><th>確認</th></tr>
      ${items.map((p, i) => `<tr><th>${i + 1}</th><td>${esc(p.name)}</td><td>${yen(p.price)}</td><td>${esc(p.madori)}</td><td>${p.size}㎡</td><td>${esc(p.station)}</td><td>${(PSTATUS[p.status] || ['?'])[0]}</td><td style="color:${p._err ? '#dc2626' : '#16a34a'};font-weight:700">${p._err || 'OK'}</td></tr>`).join('')}</table></div>
      <button class="btn btn-p fx-wide" id="fx-csv-go" ${ok ? '' : 'disabled'}><i class="ti ti-upload"></i> ${ok}件を登録する</button><div class="fx-mini" id="fx-csv-msg">住所があれば、登録後に地図の位置を自動で調べます。</div>`;
    $('fx-csv-go').onclick = async () => {
      const btn = $('fx-csv-go'); btn.disabled = true;
      let done = 0, fail = 0;
      for (const p of items.filter(x => !x._err)) {
        const { _err, ...send } = p;
        send.ownerEmail = currentUser.email; send.ownerName = currentUser.name;
        try { await api('add', { body: send }); done++; } catch (er) { fail++; }
        $('fx-csv-msg').textContent = `登録中… ${done + fail}/${ok}`;
      }
      $('fx-csv-msg').textContent = `${done}件を登録しました${fail ? `（${fail}件は失敗）` : ''}`;
      toast(`${done}件を登録しました`, 'success');
      await fetchAndRenderProps();
      if (typeof scheduleAutoGeocode === 'function') scheduleAutoGeocode();
    };
  };
};
function addCsvButton() {
  const head = document.querySelector('#admin-props button[onclick="toggleAddForm()"]');
  if (!head || $('fx-csv-btn')) return;
  const b = document.createElement('button');
  b.id = 'fx-csv-btn'; b.className = 'btn btn-sm'; b.style.marginRight = '6px';
  b.innerHTML = '<i class="ti ti-file-spreadsheet"></i>CSVで登録';
  b.onclick = window.fxOpenCsv;
  head.parentNode.insertBefore(b, head);
}

/* ══════════════ 17. カードに状態・通勤時間を出す ══════════════ */
function decorateCardsMore() {
  document.querySelectorAll('#card-grid .prop-card').forEach(card => {
    const fb = card.querySelector('.fav-btn'); if (!fb) return;
    const p = findProp(fb.dataset.propId); if (!p) return;
    const img = card.querySelector('.prop-img');
    let b = card.querySelector('.fx-pst-card');
    if (p.status && p.status !== 'open') {
      if (!b) { b = document.createElement('span'); b.className = 'fx-pst fx-pst-card'; img.appendChild(b); }
      b.textContent = t(PSTATUS[p.status][0]); b.style.background = PSTATUS[p.status][1];
    } else if (b) b.remove();
    card.classList.toggle('fx-dim', p.status === 'closed');
    let c = card.querySelector('.fx-cm-card');
    const m = commuteMin(p);
    if (m != null) {
      if (!c) { c = document.createElement('div'); c.className = 'fx-cm-card'; card.querySelector('.prop-body').appendChild(c); }
      c.innerHTML = `<i class="ti ti-train"></i> ${esc(commute.name)} ${t('まで約')}${m}${t('分')}`;
    } else if (c) c.remove();
    if (p.panoramas && p.panoramas.length && !p.floorplanData && !p.splatURL && !card.querySelector('.prop-vr-badge')) {
      img.insertAdjacentHTML('beforeend', '<div class="prop-vr-badge"><i class="ti ti-vr"></i> 360°</div>');
    }
  });
}

/* ══════════════ 18. 写真のサムネイル（一覧を軽くする）══════════════ */
function makeThumb(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = Math.min(480, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.72));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = src + (/^https?:/.test(src) && src.indexOf('?') < 0 ? '?thumb=1' : '');
  });
}
async function ensureThumb(prop) {
  const first = (prop.photoURLs || [])[0];
  if (!first) { delete prop.thumbURL; delete prop.thumbOf; return; }
  if (prop.thumbURL && prop.thumbOf === first) return;
  try {
    const url = await uploadPhotoToS3(await makeThumb(first));
    if (/^https:\/\//.test(url)) { prop.thumbURL = url; prop.thumbOf = first; }
  } catch (e) { console.warn('サムネイルを作れませんでした', e.message); }
}
const _upAWS2 = window.uploadToAWS;
window.uploadToAWS = async function (prop) { await ensureThumb(prop); return _upAWS2.apply(this, arguments); };
const _updAWS2 = window.updatePropertyOnAWS;
window.updatePropertyOnAWS = async function (prop) { await ensureThumb(prop); return _updAWS2.apply(this, arguments); };
// 一覧のカードは小さい写真を使う（詳細ページは元の写真のまま）
const _getFiltered2 = window.getFilteredProps;
window.getFilteredProps = function () {
  return _getFiltered2.apply(this, arguments).map(p => (p.thumbURL && p.photoURLs && p.thumbOf === p.photoURLs[0]) ? Object.assign({}, p, { photoURLs: [p.thumbURL].concat(p.photoURLs.slice(1)) }) : p);
};
window.fxMakeThumbs = async function () {
  const list = PROPS.filter(p => canEdit(p) && (p.photoURLs || [])[0] && !(p.thumbURL && p.thumbOf === p.photoURLs[0]));
  if (!list.length) { toast('サムネイルはすべて作成済みです', 'success'); return; }
  let n = 0;
  for (const p of list) {
    toast(`サムネイルを作成中… ${++n}/${list.length}`, 'info', 1500);
    try { await api('update', { body: await (async () => { await ensureThumb(p); return p; })() }); } catch (e) {}
  }
  toast(`${list.length}件のサムネイルを作りました`, 'success');
  renderCards();
};

/* ══════════════ 19. 退会 ══════════════ */
function addDeleteAccount() {
  const prof = $('mp-prof'); if (!prof || $('fx-delacc')) return;
  const box = document.createElement('div');
  box.id = 'fx-delacc'; box.className = 'fx-danger';
  box.innerHTML = `<div class="fx-sec-title" style="color:#b91c1c"><i class="ti ti-user-x"></i> アカウントの削除（退会）</div>
    <p class="fx-mini" style="margin:0 0 10px">アカウントと、お気に入り・閲覧履歴・受信箱・VRで置いた家具を削除します。これからの内見予約はキャンセルになります。元に戻せません。</p>
    <button class="btn btn-sm" style="color:#b91c1c;border-color:#fecaca" onclick="fxDeleteAccount()">アカウントを削除する</button>`;
  prof.appendChild(box);
}
window.fxDeleteAccount = function () {
  if (!isLoggedIn) return;
  if (isMaster()) { toast('マスターアカウントは削除できません', 'warn'); return; }
  const body = openModal('fx-del', '<i class="ti ti-user-x"></i> アカウントを削除', `
    <p style="margin:0 0 10px;line-height:1.7">本当に削除しますか？ <b>元に戻せません。</b><br>確認のため、パスワードを入力してください。</p>
    <label class="fx-field">パスワード<input type="password" id="fx-del-pass" autocomplete="current-password"></label>
    <button class="btn fx-wide" id="fx-del-go" style="background:#dc2626;color:#fff;border-color:#dc2626">削除する</button>`, { width: 420 });
  body.querySelector('#fx-del-go').onclick = async () => {
    const btn = body.querySelector('#fx-del-go'); btn.disabled = true;
    try {
      await api('deleteMe', { body: { password: body.querySelector('#fx-del-pass').value } });
      const email = currentUser.email;
      closeModal('fx-del');
      try { removeCachedUser(email); localStorage.removeItem('vr_seen_prop_' + email); localStorage.removeItem('vr_compare_' + email); } catch (e) {}
      if (typeof userStore !== 'undefined') { const i = userStore.findIndex(u => u.email === email); if (i >= 0) userStore.splice(i, 1); }
      doLogout(); hideGate();
      toast('アカウントを削除しました。ご利用ありがとうございました', 'success', 5000);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
};

/* ══════════════ 20. 物件の複製・写真の一括削除 ══════════════ */
window.fxDuplicateProp = async function (id) {
  const p = await ensureFull(id); if (!p) return;
  if (!confirm(`「${p.name}」を複製しますか？\n複製は「非公開」で作られるので、直してから公開できます。`)) return;
  const skip = ['id', 'reservations', 'viewStats', 'bookedSlots', 'ownerEmail', 'ownerName', 'lat', 'lng'];
  const copy = {};
  Object.keys(p).forEach(k => { if (!skip.includes(k)) copy[k] = JSON.parse(JSON.stringify(p[k])); });
  copy.name = p.name + '（コピー）'; copy.status = 'hidden';
  copy.lat = p.lat || null; copy.lng = p.lng || null;
  try { const r = await api('add', { body: copy }); toast('複製しました（非公開）', 'success'); await fetchAndRenderProps(); renderAdminPropTable(); if (r && r.id) startEditProp(r.id); }
  catch (e) { toast('複製できませんでした: ' + e.message, 'error'); }
};
const _renderAdminTable = window.renderAdminPropTable;
window.renderAdminPropTable = function () {
  const r = _renderAdminTable.apply(this, arguments);
  document.querySelectorAll('#prop-table-body button[onclick^="startEditProp("]').forEach(b => {
    if (b.nextElementSibling && b.nextElementSibling.classList.contains('fx-dup')) return;
    const id = +(b.getAttribute('onclick').match(/\d+/) || [0])[0];
    const d = document.createElement('button');
    d.className = 'btn btn-sm fx-dup'; d.title = '複製'; d.setAttribute('aria-label', '複製');
    d.style.cssText = 'font-size:10px;padding:3px 8px';
    d.innerHTML = '<i class="ti ti-copy"></i>';
    d.onclick = () => window.fxDuplicateProp(id);
    b.after(d);
  });
  const head = document.querySelector('#admin-props .admin-table-head');
  if (head && !$('fx-thumb-btn') && isAdmin()) {
    const tb = document.createElement('button');
    tb.id = 'fx-thumb-btn'; tb.className = 'btn btn-sm'; tb.style.margin = '0 0 8px';
    tb.innerHTML = '<i class="ti ti-photo-down"></i> 一覧用の小さい写真を作る';
    tb.title = '前に登録した物件の写真から、一覧用の軽いサムネイルを作ります';
    tb.onclick = window.fxMakeThumbs;
    head.parentNode.insertBefore(tb, head);
  }
  return r;
};
function addPhotoBulkDelete() {
  const wrap = $('af-existing-photos'); if (!wrap || $('fx-photo-clear')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'fx-photo-clear'; b.className = 'btn btn-sm';
  b.style.cssText = 'color:var(--red);margin-bottom:6px';
  b.innerHTML = '<i class="ti ti-trash"></i> 写真をすべて外す';
  b.onclick = () => { if (!confirm('この物件の写真をすべて外しますか？（「変更を保存」を押すまでは元に戻せます）')) return; editingExistingPhotos.length = 0; renderExistingPhotosPreview(); };
  wrap.insertBefore(b, wrap.firstChild);
}

/* ══════════════ 21. 予約のカレンダー（管理画面）══════════════ */
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(), calDay = null;
function renderResvCalendar() {
  let box = $('fx-resv-cal');
  const list = $('admin-resv-list'); if (!list) return;
  if (!box) { box = document.createElement('div'); box.id = 'fx-resv-cal'; list.parentNode.insertBefore(box, list); }
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const count = {};
  adminResvCache.filter(r => r.status === 'pending' || r.status === 'confirmed').forEach(r => { const d = r.slot.slice(0, 10); count[d] = count[d] || { p: 0, c: 0 }; count[d][r.status === 'pending' ? 'p' : 'c']++; });
  const today = ymd(new Date());
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, c = count[key];
    cells += `<button type="button" data-d="${key}" class="${key === today ? 'today ' : ''}${key === calDay ? 'on ' : ''}${c ? 'has' : ''}" aria-label="${m + 1}月${d}日 ${c ? (c.p + c.c) + '件の予約' : '予約なし'}"><b>${d}</b>${c ? `<span>${c.c ? `<i class="ok">確定${c.c}</i>` : ''}${c.p ? `<i class="wait">待ち${c.p}</i>` : ''}</span>` : ''}</button>`;
  }
  box.innerHTML = `<div class="fx-cal-h"><button type="button" class="btn btn-sm" id="fx-cal-prev" aria-label="前の月">‹</button><b>${y}年${m + 1}月</b><button type="button" class="btn btn-sm" id="fx-cal-next" aria-label="次の月">›</button>
    ${calDay ? `<button type="button" class="btn btn-sm" id="fx-cal-all">${calDay.slice(5).replace('-', '/')} の絞り込みを解除</button>` : '<span class="fx-mini" style="margin:0">日付を押すと、その日の予約だけ表示します</span>'}</div>
    <div class="fx-cal">${WEEK.map((w, i) => `<div class="wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}${cells}</div>`;
  $('fx-cal-prev').onclick = () => { calMonth = new Date(y, m - 1, 1); renderResvCalendar(); };
  $('fx-cal-next').onclick = () => { calMonth = new Date(y, m + 1, 1); renderResvCalendar(); };
  const all = $('fx-cal-all'); if (all) all.onclick = () => { calDay = null; renderResvCalendar(); renderAdminResv(); };
  box.querySelectorAll('.fx-cal button[data-d]').forEach(b => b.onclick = () => { calDay = calDay === b.dataset.d ? null : b.dataset.d; renderResvCalendar(); renderAdminResv(); });
}

/* ══════════════ 22. 使いやすさ（キーボード・読み上げ・見やすさ）══════════════ */
function a11yCards() {
  document.querySelectorAll('#card-grid .prop-card').forEach(card => {
    if (card.dataset.a11y) return;
    card.dataset.a11y = '1';
    const name = (card.querySelector('.prop-name') || {}).textContent || '';
    const price = (card.querySelector('.prop-price') || {}).textContent || '';
    card.setAttribute('tabindex', '0'); card.setAttribute('role', 'link');
    card.setAttribute('aria-label', `${name} ${price}`.trim());
    card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); card.click(); } });
    const fav = card.querySelector('.fav-btn');
    if (fav) {
      fav.setAttribute('role', 'button'); fav.setAttribute('tabindex', '0'); fav.setAttribute('aria-label', 'お気に入りに追加・解除');
      fav.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fav.click(); } });
    }
  });
}
function a11yStatic() {
  const lab = (sel, text) => document.querySelectorAll(sel).forEach(el => { if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text); });
  lab('.pd-close', '閉じる'); lab('.add-form-close', '閉じる'); lab('.fx-bell', 'お知らせ'); lab('.fx-lang', 'English / 日本語'); lab('.eye-btn', 'パスワードを表示');
  lab('#pd-slider .pd-slide-btn.prev', '前の写真'); lab('#pd-slider .pd-slide-btn.next', '次の写真');
  document.querySelectorAll('#pd-slider img').forEach(img => { const n = ($('pd-name') || {}).textContent || ''; img.alt = n + ' の写真'; });
  document.querySelectorAll('.tab[onclick]').forEach(tb => { tb.setAttribute('role', 'button'); tb.setAttribute('tabindex', '0'); });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const ov = [...document.querySelectorAll('.fx-overlay')].pop();
    if (ov) { closeModal(ov.id); return; }
    const np = $('fx-notif'); if (np) { np.remove(); return; }
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && (e.target.classList.contains('tab') || e.target.classList.contains('mp-nav-item') || e.target.classList.contains('admin-nav-item'))) { e.preventDefault(); e.target.click(); }
});
new MutationObserver(() => { a11yCards(); }).observe(document.getElementById('card-grid') || document.body, { childList: true, subtree: false });
const _openModal = openModal;
openModal = function () { const b = _openModal.apply(this, arguments); setTimeout(() => { const f = b.querySelector('input,select,textarea,button:not(.fx-x)'); if (f) f.focus({ preventScroll: true }); }, 50); return b; };

/* ══════════════ 23. キャラクター「やどかりん」══════════════ */
const YK = window.Yadokarin;
const YK_TIPS = [
  [('ontouchstart' in window ? 'タップすると、この部屋の中に入れるよ！' : 'ドラッグで回して、クリックすると中に入れるよ！'), ('ontouchstart' in window ? 'Tap to step inside this room!' : 'Drag to turn it, click to step inside!')],
  ['ぼく、やどかりん。おうちを背負って、新しいおうちを探してるんだ。', "I'm Yadokarin! I carry my house and I'm looking for a new one."],
  ['VR内見の「測る」で、冷蔵庫が入るか確かめられるよ。', 'Use "Measure" in VR to check if your fridge fits.'],
  ['「日当たり」で、冬の朝に日が入るかも見られるんだ。', '"Sunlight" shows if the sun comes in on winter mornings.'],
  ['気になる物件は「比較」で並べてみよう。', 'Line up homes you like with "Compare".'],
  ['通勤・通学先を入れると、時間で探せるよ。', 'Enter your commute destination to search by travel time.'],
  ['「一緒に内見」なら、家族と同じ部屋を見ながら話せるよ。', '"View together" lets you walk a room with family and chat.'],
  ['「家具」で、ベッドやソファを置いてみよう。はみ出すと赤くなるよ。', 'Try placing a bed or sofa with "Furniture". It turns red if it doesn\'t fit.'],
  ['ぼくの名前は「宿借り」から。おうちを借りる仲間だね。', 'My name comes from "yado-kari" — someone who rents a home. Like you!']
];
let ykTip = 0;
function ykSay(el, i) {
  const tip = YK_TIPS[(i + YK_TIPS.length) % YK_TIPS.length];
  el.textContent = fxLang === 'en' ? tip[1] : tip[0];
}
function addHeroMascot() {
  const hero = $('he-stage') || document.querySelector('#s-top .hero');
  if (!YK || !hero || $('fx-yk-hero')) return;
  const box = document.createElement('div');
  box.id = 'fx-yk-hero';
  box.innerHTML = `<div class="fx-yk-bubble fx-noi18n" id="fx-yk-say" aria-live="polite"></div><button type="button" class="fx-yk-btn" aria-label="やどかりんのひとこと（押すと次のヒント）">${YK.svg({ size: 150, face: 'happy' })}</button>`;
  hero.appendChild(box);
  const say = $('fx-yk-say');
  ykSay(say, 0);
  const next = () => { ykTip++; ykSay(say, ykTip); };
  box.querySelector('.fx-yk-btn').onclick = () => {
    next();
    const s = box.querySelector('svg');
    s.classList.remove('yk-hop'); void s.getBoundingClientRect(); s.classList.add('yk-hop');
  };
  setInterval(() => { if (!document.hidden && $('s-top').classList.contains('active')) next(); }, 9000);
}
function addGateMascot() {
  const card = document.querySelector('#login-gate .login-card');
  if (!YK || !card || $('fx-yk-gate')) return;
  const d = document.createElement('div');
  d.id = 'fx-yk-gate'; d.setAttribute('aria-hidden', 'true');
  d.innerHTML = YK.svg({ size: 78, face: 'wink', title: '' });
  card.appendChild(d);
}
const YK_EMPTY = [
  ['card-grid', 'ti-building-off', 'sad', ['条件を少しゆるめてみてね。', 'Try loosening your filters.']],
  ['mp-fav-list', 'ti-heart', 'wow', ['気になるおうちの♡を押してね。', 'Tap ♡ on homes you like.']],
  ['mp-hist-list', 'ti-history', 'happy', ['見た物件がここに並ぶよ。', 'Homes you view will show up here.']],
  ['mp-inbox-list', 'ti-inbox', 'happy', ['お知らせが届くとここに出るよ。', 'Messages will appear here.']],
  ['mp-resv-list', 'ti-calendar-off', 'happy', ['気になるおうちを予約してみよう。', 'Book a viewing for a home you like.']],
  ['admin-resv-list', 'ti-calendar-check', 'happy', ['いまは対応する予約はないよ。', 'No bookings to handle right now.']]
];
function ykEmpties() {
  if (!YK) return;
  YK_EMPTY.forEach(([id, icon, face, msg]) => {
    const el = $(id); if (!el) return;
    const i = el.querySelector('i.ti.' + icon);
    if (!i || i.closest('.prop-card')) return;
    const holder = document.createElement('div');
    holder.className = 'fx-yk-empty';
    holder.innerHTML = YK.svg({ size: 110, face, wave: face !== 'sad', title: '' });
    i.replaceWith(holder);
    const hint = document.createElement('div');
    hint.className = 'fx-yk-hint';
    hint.textContent = fxLang === 'en' ? msg[1] : msg[0];
    holder.parentNode.appendChild(hint);
  });
}
['renderCards', 'renderFavorites', 'renderHistory'].forEach(fn => {
  const orig = window[fn]; if (typeof orig !== 'function') return;
  window[fn] = function () { const r = orig.apply(this, arguments); try { ykEmpties(); } catch (e) {} return r; };
});
const _renderInbox = window.renderInbox;
if (typeof _renderInbox === 'function') window.renderInbox = async function () { const r = await _renderInbox.apply(this, arguments); try { ykEmpties(); } catch (e) {} return r; };

/* ══════════════ 24. おすすめ掲載（PR）══════════════ */
// 不動産会社（管理者）が物件を一定期間「おすすめ」にできる。一覧の上に「PR」付きで出る。
// 実際のお金のやり取りはしない（掲載料は説明用の目安）。
const PR_PLANS = [[0, 'なし', 0], [7, '1週間', 3000], [14, '2週間', 5000], [28, '4週間', 9000]];
function isPR(p) { return !!(p && p.featuredUntil && p.featuredUntil >= ymd(new Date()) && p.status !== 'closed' && p.status !== 'hidden'); }
function prSeen(id, kind) {
  const key = 'vr_pr_' + kind + '_' + id;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
  fetch(AWS_API_URL + '?action=trackPR', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propId: id, kind }) }).catch(() => {});
}
window.fxPRClick = function (id) { prSeen(id, 'click'); showPropDetail(id); };
function renderPRStrip() {
  const grid = $('card-grid'); if (!grid) return;
  let box = $('fx-pr');
  const list = PROPS.filter(isPR).sort((a, b) => (a.featuredUntil < b.featuredUntil ? 1 : -1)).slice(0, 3);
  if (!list.length || (typeof currentPage !== 'undefined' && currentPage > 1)) { if (box) box.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'fx-pr'; grid.parentNode.insertBefore(box, grid); }
  box.innerHTML = `<div class="fx-pr-h"><span class="fx-pr-tag">PR</span> ${t('おすすめの物件')}</div><div class="fx-pr-list">${list.map(p => {
    const img = p.thumbURL || (p.photoURLs || [])[0];
    return `<button type="button" class="fx-pr-card" onclick="fxPRClick(${p.id})" aria-label="PR ${esc(p.name)}">
      <span class="fx-pr-img" style="${img ? `background-image:url('${esc(img)}')` : ''}">${img ? '' : '<i class="ti ti-building"></i>'}<span class="fx-pr-tag">PR</span></span>
      <span class="fx-pr-body"><b>${yen(p.price)}<small>/${t('月')}</small></b><span>${esc(p.name)}</span><small>${esc(p.madori || '')} ・ ${esc(p.station || p.area || '')}</small></span></button>`;
  }).join('')}</div>`;
  list.forEach(p => prSeen(p.id, 'imp'));
}
const _renderCardsPR = window.renderCards;
window.renderCards = function () { const r = _renderCardsPR.apply(this, arguments); try { renderPRStrip(); decoratePRCards(); } catch (e) { console.error(e); } return r; };
function decoratePRCards() {
  document.querySelectorAll('#card-grid .prop-card').forEach(card => {
    const fb = card.querySelector('.fav-btn'); if (!fb) return;
    const p = findProp(fb.dataset.propId);
    let tag = card.querySelector('.fx-pr-badge');
    if (isPR(p)) { if (!tag) { tag = document.createElement('span'); tag.className = 'fx-pr-tag fx-pr-badge'; tag.textContent = 'PR'; card.querySelector('.prop-img').appendChild(tag); } }
    else if (tag) tag.remove();
  });
}

/* ══════════════ 25. 物件フォーム：設備・条件、おすすめ掲載 ══════════════ */
function addFormExtras2() {
  const box = $('fx-af-extra'); if (!box || $('af-features-box')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="flabel" style="margin-top:12px">設備・条件<span style="font-size:10px;color:#94a3b8;font-weight:400;margin-left:6px">当てはまるものを押して選ぶ（検索の絞り込みに使われます）</span></div>
    <div class="fx-feat-pick" id="af-features-box"></div>
    <div class="flabel" style="margin-top:12px">おすすめ掲載（PR）<span style="font-size:10px;color:#94a3b8;font-weight:400;margin-left:6px">一覧の上の「おすすめの物件」に出ます</span></div>
    <div class="fx-row" id="af-pr-box"></div>
    <div class="fx-mini" id="af-pr-note"></div>`;
  box.insertBefore(wrap, box.firstChild);
  renderFormExtras2();
}
function renderFormExtras2() {
  const fb = $('af-features-box'); if (!fb) return;
  const all = [...new Set([].concat((typeof fieldDefs !== 'undefined' && fieldDefs.features) || [], fxForm.features || []))];
  fb.innerHTML = all.map(f => `<button type="button" class="${(fxForm.features || []).includes(f) ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}</button>`).join('');
  fb.querySelectorAll('button').forEach(b => b.onclick = () => {
    const f = b.dataset.f; fxForm.features = fxForm.features || [];
    fxForm.features = fxForm.features.includes(f) ? fxForm.features.filter(x => x !== f) : fxForm.features.concat([f]);
    b.classList.toggle('on');
  });
  const pb = $('af-pr-box');
  const active = fxForm.featuredUntil && fxForm.featuredUntil >= ymd(new Date());
  if (!(typeof isMaster === 'function' && isMaster())) {   // おすすめ掲載（PR）は運営（マスター）が設定する
    pb.innerHTML = active ? `<span class="fx-pr-tag">PR中</span><span class="fx-mini" style="margin:0 0 0 6px">${esc(fxForm.featuredUntil)} まで</span>` : '';
    $('af-pr-note').textContent = '「おすすめの物件」への掲載は運営が設定します。希望するときは、お問い合わせから運営に連絡してください。';
    return;
  }
  pb.innerHTML = PR_PLANS.map(([d, n]) => `<button type="button" class="btn btn-sm ${(d === 0 && !fxForm.prPlan && !active) || fxForm.prPlan === d ? 'fx-on' : ''}" data-d="${d}">${n}</button>`).join('')
    + (active ? `<span class="fx-pr-tag" style="margin-left:6px">PR中</span><span class="fx-mini" style="margin:0">${fxForm.featuredUntil} まで</span>` : '');
  pb.querySelectorAll('button').forEach(b => b.onclick = () => {
    const d = +b.dataset.d;
    fxForm.prPlan = d;
    if (d === 0) fxForm.featuredUntil = '';
    else { const e = new Date(); e.setDate(e.getDate() + d); fxForm.featuredUntil = ymd(e); }
    renderFormExtras2();
  });
  const plan = PR_PLANS.find(x => x[0] === fxForm.prPlan);
  $('af-pr-note').textContent = plan && plan[0] ? `掲載料の目安：${plan[2].toLocaleString()}円（説明用で、実際には請求されません）。${fxForm.featuredUntil} まで「おすすめ」に出ます。` : '';
}
const _resetFormExtras = resetFormExtras;
resetFormExtras = function (prop) {
  _resetFormExtras(prop);
  fxForm.features = ((prop && prop.features) || []).slice();
  fxForm.featuredUntil = (prop && prop.featuredUntil) || '';
  fxForm.prPlan = null;
  renderFormExtras2();
};
// 保存のときに設備とPRも一緒に送る（status などと同じ仕組み）
const _uploadPR = window.uploadToAWS, _updatePR = window.updatePropertyOnAWS;
function prExtras(prop) {
  if (!$('add-form') || !$('add-form').classList.contains('show')) return;
  prop.features = (fxForm.features || []).slice();
  if (typeof isMaster === 'function' && isMaster()) prop.featuredUntil = fxForm.featuredUntil || '';
}
window.uploadToAWS = function (prop) { if (pendingExtras) prExtras(prop); return _uploadPR.apply(this, arguments); };
window.updatePropertyOnAWS = function (prop) { if (pendingExtras) prExtras(prop); return _updatePR.apply(this, arguments); };

/* ══════════════ 26. 物件条件の項目をサーバーに保存（どの端末でも同じ選択肢に）══════════════ */
const _saveFieldDefs = window.saveFieldDefs;
window.saveFieldDefs = function (defs) {
  _saveFieldDefs.apply(this, arguments);
  if (isLoggedIn && isMaster()) api('saveSettings', { body: { types: defs.types, features: defs.features, madori: defs.madori } }).catch(e => toast('条件項目をサーバーに保存できませんでした: ' + e.message, 'error'));
};
async function loadServerFieldDefs() {
  try {
    const v = await api('getSettings');
    if (!v || !Object.keys(v).length) return;
    ['types', 'features', 'madori'].forEach(k => { if (Array.isArray(v[k]) && v[k].length) fieldDefs[k] = v[k]; });
    _saveFieldDefs(fieldDefs);
    if (typeof refreshAllFilters === 'function') refreshAllFilters();
    if (typeof rebuildTypeSelect === 'function') rebuildTypeSelect();
    renderFormExtras2();
  } catch (e) {}
}

/* ══════════════ 27. 間取り図を物件ページに出す ══════════════ */
function addFloorplanImage(prop) {
  let sec = $('fx-fp-sec');
  if (!sec) { sec = document.createElement('div'); sec.id = 'fx-fp-sec'; const costs = $('pd-costs'); costs.parentNode.insertBefore(sec, costs.previousElementSibling); }
  sec.innerHTML = prop.floorplanURL ? `<div class="pd-section-title">${t('間取り図')}</div>
    <a href="${esc(prop.floorplanURL)}" target="_blank" rel="noopener" class="fx-fp-img"><img src="${esc(prop.floorplanURL)}" alt="${esc(prop.name)} の間取り図" loading="lazy"></a>` : '';
}

/* ══════════════ 28. 受信箱：サイトの中で返信する（文字はそのまま表示して安全に）══════════════ */
window.renderInbox = async function () {
  const box = $('mp-inbox-list'); if (!box || !currentUser) return;
  box.innerHTML = `<div class="fx-empty">${t('読み込み中…')}</div>`;
  const msgs = await fetchMessages(currentUser.email);
  markMessagesRead(currentUser.email); updateInboxBadge();
  if (!msgs.length) {
    box.innerHTML = `<div style="padding:40px 0;text-align:center;color:#94a3b8"><i class="ti ti-inbox" style="font-size:40px;display:block;margin-bottom:12px;opacity:.3"></i><div style="font-size:13px">受信メッセージはありません</div></div>`;
    ykEmpties(); return;
  }
  box.innerHTML = msgs.map((m, i) => `<div class="card fx-msg" style="margin-bottom:10px;padding:16px">
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><b style="font-size:13px;color:var(--navy)">${esc(m.subject || '(件名なし)')}</b><small style="color:#94a3b8;flex-shrink:0">${esc(m.time || '')}</small></div>
    <div class="fx-mini" style="margin:0 0 8px"><i class="ti ti-user"></i> ${esc(m.fromName || '不明')} ${m.from && m.from.indexOf('@') > 0 ? `（${esc(m.from)}）` : ''}${m.propId != null && findProp(m.propId) ? ` ・ <span class="fx-link" onclick="showPropDetail(${+m.propId})">${esc(m.propName || '物件を見る')}</span>` : ''}</div>
    <div style="font-size:13px;color:var(--navy);line-height:1.7;white-space:pre-wrap;background:var(--surface2,#f8fafc);border-radius:8px;padding:12px">${esc(m.body || '')}</div>
    ${m.canReply || (m.from && m.from !== 'system') ? `<div class="fx-row"><button class="btn btn-sm btn-p" onclick="fxReply(${i})"><i class="ti ti-corner-up-left"></i> サイト内で返信</button></div>` : ''}
  </div>`).join('');
};
window.fxReply = function (i) {
  const m = (typeof _inboxCache !== 'undefined' ? _inboxCache : [])[i]; if (!m) return;
  const body = openModal('fx-reply', '<i class="ti ti-corner-up-left"></i> 返信', `
    <div class="fx-prop-line" style="font-size:13px">${esc(m.fromName || '相手')} さんへ</div>
    <label class="fx-field">件名<input id="fx-rp-sub" maxlength="100" value="${esc(/^Re:/.test(m.subject || '') ? m.subject : 'Re: ' + (m.subject || ''))}"></label>
    <label class="fx-field">本文<textarea id="fx-rp-body" rows="6" maxlength="2000"></textarea></label>
    <button class="btn btn-p fx-wide" id="fx-rp-go"><i class="ti ti-send"></i> 送信する</button>`, { width: 480 });
  body.querySelector('#fx-rp-go').onclick = async () => {
    const text = body.querySelector('#fx-rp-body').value.trim(); if (!text) { toast('本文を入れてください', 'warn'); return; }
    const btn = body.querySelector('#fx-rp-go'); btn.disabled = true;
    try {
      await api('sendMessage', { body: { replyTo: m.id, to: m.from, subject: body.querySelector('#fx-rp-sub').value.trim(), body: text, fromName: currentUser.name, time: new Date().toISOString(), propId: m.propId, propName: m.propName } });
      closeModal('fx-reply'); toast('返信しました', 'success');
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
};

/* ══════════════ 29. CSVで書き出す（管理者）══════════════ */
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function downloadCSV(name, rows) {
  const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
window.fxExportProps = function () {
  const list = PROPS.filter(p => canEdit(p));
  const st = { open: '募集中', applied: '申込あり', closed: '成約済み', hidden: '非公開' };
  downloadCSV(`vrhomes_物件_${ymd(new Date())}.csv`, [['物件名', '家賃', '管理費', '敷金', '礼金', '間取り', '面積', '物件種別', '構造', '築年数', '住所', 'エリア', '最寄駅', '徒歩分', '設備', '説明', '状態', 'PR終了日', 'VR内見回数', '予約受付']]
    .concat(list.map(p => [p.name, p.price, p.mgmt, p.deposit, p.key, p.madori, p.size, p.type, p.structure, p.age, p.address, p.area, p.station, p.walkMin, (p.features || []).join(';'), p.description, st[p.status || 'open'], p.featuredUntil || '', (p.viewStats || {}).views || 0, (p.bookedSlots || []).length])));
  toast(`${list.length}件を書き出しました（そのままCSV登録にも使えます）`, 'success');
};
window.fxExportResv = async function () {
  await loadAdminResv();
  const st = { pending: '確認待ち', confirmed: '確定', declined: 'お断り', cancelled: 'キャンセル', done: '完了' };
  downloadCSV(`vrhomes_内見予約_${ymd(new Date())}.csv`, [['日時', '物件', '方法', '状態', 'お名前', '電話', 'ご要望', '申込日時']]
    .concat(adminResvCache.map(r => [r.slot.replace('T', ' '), r.propName, r.kind === 'online' ? 'オンライン' : '現地', st[r.status] || r.status, r.name, r.phone, r.note, (r.created || '').replace('T', ' ')])));
};
function addExportButtons() {
  const csvBtn = $('fx-csv-btn');
  if (csvBtn && !$('fx-exp-btn')) {
    const b = document.createElement('button'); b.id = 'fx-exp-btn'; b.className = 'btn btn-sm'; b.style.marginRight = '6px';
    b.innerHTML = '<i class="ti ti-download"></i>CSVで書き出す'; b.onclick = window.fxExportProps;
    csvBtn.parentNode.insertBefore(b, csvBtn);
  }
  const tabs = $('fx-resv-filter');
  if (tabs && !$('fx-exp-resv')) {
    const b = document.createElement('button'); b.id = 'fx-exp-resv'; b.className = 'btn btn-sm'; b.style.marginLeft = 'auto';
    b.innerHTML = '<i class="ti ti-download"></i> CSV'; b.onclick = window.fxExportResv;
    tabs.appendChild(b);
  }
}

/* ══════════════ 10. 見た目 ══════════════ */
const css = document.createElement('style');
css.textContent = `
.fx-overlay{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:28px 12px;overflow-y:auto}
.fx-modal{width:100%;background:var(--surface,#fff);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.35);overflow:hidden}
.fx-mhead{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:linear-gradient(135deg,var(--blue,#2563eb),var(--blue2,#1d4ed8));color:#fff}
.fx-mhead h3{margin:0;font-size:15px;font-weight:800;display:flex;align-items:center;gap:6px}
.fx-x{width:32px;height:32px;border-radius:50%;border:0;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;font-size:16px}
.fx-mbody{padding:16px 18px 18px;font-size:13px;color:#334155}
.fx-prop-line{font-weight:800;color:var(--navy,#0f172a);font-size:15px;margin-bottom:10px}
.fx-label{font-size:11.5px;font-weight:700;color:#64748b;margin:12px 0 6px}
.fx-seg{display:flex;gap:6px;flex-wrap:wrap}
.fx-seg button,.fx-days button,.fx-times button,.fx-tabs button{border:1.5px solid var(--border,#e2e8f0);background:var(--surface,#fff);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;color:#334155}
.fx-seg button.on,.fx-days button.on,.fx-times button.on,.fx-tabs button.on{border-color:var(--blue,#2563eb);background:#eff6ff;color:#1d4ed8}
.fx-days{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.fx-days button{min-width:54px;display:flex;flex-direction:column;align-items:center;padding:6px 8px;flex-shrink:0}
.fx-days button small{font-size:11px;font-weight:600;color:#64748b}
.fx-days button.sun{color:#dc2626}.fx-days button.sat{color:#2563eb}
.fx-times{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px}
.fx-times button[disabled]{opacity:.45;cursor:not-allowed;text-decoration:line-through}
.fx-times button small{font-size:10px;margin-left:3px}
.fx-field{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:#64748b;margin-top:12px}
.fx-field input,.fx-field textarea{border:1.5px solid var(--border,#e2e8f0);border-radius:10px;padding:9px 11px;font-size:13px;font-family:inherit;color:#0f172a;background:var(--surface,#fff)}
.fx-wide{width:100%;justify-content:center;padding:11px!important;margin-top:12px}
.fx-mini{font-size:11.5px;color:#64748b;line-height:1.7;margin-top:6px}
.fx-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px}
.fx-grow{flex:1;justify-content:center;padding:9px 6px!important;font-size:12px!important;min-width:0}
.fx-on{border-color:var(--blue,#2563eb)!important;color:#1d4ed8!important;background:#eff6ff!important}
#fx-pd-actions{display:flex;flex-direction:column;gap:0}
#fx-pd-actions .fx-wide{margin-top:0}
.fx-sim{margin-top:12px;border:1.5px solid var(--border,#e2e8f0);border-radius:12px;padding:0 12px;background:#f8fafc}
.fx-sim summary{cursor:pointer;padding:11px 0;font-weight:800;color:#1d4ed8;font-size:13px;list-style:none}
.fx-sim summary::-webkit-details-marker{display:none}
.fx-sim-in{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}
.fx-sim-in label{display:flex;flex-direction:column;gap:3px;font-size:11px;font-weight:700;color:#64748b}
.fx-sim-in input,.fx-sim-in select{border:1.5px solid var(--border,#e2e8f0);border-radius:8px;padding:6px 8px;font-size:12.5px;font-family:inherit;background:#fff;min-width:0}
.fx-sim-out table{width:100%;border-collapse:collapse;font-size:12.5px}
.fx-sim-out td{padding:5px 2px;border-bottom:1px dashed #e2e8f0}
.fx-sim-out td:last-child{text-align:right;font-weight:700;color:#0f172a}
.fx-sim-out tr.fx-total td{font-weight:800;color:#1d4ed8;font-size:14px;border-bottom:2px solid #bfdbfe}
.fx-sim-out .fx-mini{padding-bottom:10px}
@media(max-width:640px){.fx-sim-in{grid-template-columns:repeat(2,minmax(0,1fr))}}
body:has(#pd-overlay.show) #fx-cmp-bar,body:has(.fx-overlay) #fx-cmp-bar,body:has(#vr-viewer-overlay) #fx-cmp-bar{display:none}
.fx-sim-in input,.fx-sim-in select{width:100%;box-sizing:border-box}
.fx-badge{display:inline-block;color:#fff;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800}
.fx-card{border:1.5px solid var(--border,#e2e8f0);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--surface,#fff)}
.fx-card.past{opacity:.6}
.fx-card-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;font-size:14px;color:var(--navy,#0f172a)}
.fx-kind{margin-left:auto;font-size:11.5px;color:#64748b;font-weight:700}
.fx-link{color:#1d4ed8;font-weight:700;cursor:pointer;font-size:13px}
.fx-link:hover{text-decoration:underline}
.fx-reply{background:#f8fafc;border-radius:8px;padding:7px 10px;font-size:12px;color:#475569;margin-top:6px;white-space:pre-wrap}
.fx-empty{padding:28px 10px;text-align:center;color:#94a3b8;font-size:13px;line-height:1.8}
.fx-empty i{font-size:30px;opacity:.5}
.fx-sec-title{font-size:15px;font-weight:800;color:var(--navy,#0f172a);margin-bottom:14px;display:flex;align-items:center;gap:6px}
.fx-h2{font-size:18px;font-weight:800;margin-bottom:14px;color:var(--navy,#0f172a)}
.fx-h2 small{font-size:12px;color:#94a3b8;font-weight:600}
.fx-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.fx-an-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-top:14px}
.fx-an{border:1.5px solid var(--border,#e2e8f0);border-radius:12px;padding:12px 14px;background:var(--surface,#fff)}
.fx-an-h{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#94a3b8;margin-bottom:8px}
.fx-an-nums{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.fx-an-nums div{background:#f8fafc;border-radius:8px;padding:6px;font-size:10.5px;color:#64748b;text-align:center;line-height:1.3}
.fx-an-nums b{display:block;font-size:17px;color:var(--navy,#0f172a)}
.fx-bar{display:grid;grid-template-columns:90px 1fr 48px;align-items:center;gap:6px;font-size:11.5px;margin:3px 0}
.fx-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155}
.fx-bar i{display:block;height:10px;border-radius:5px;background:linear-gradient(90deg,#60a5fa,#2563eb)}
.fx-bar em{font-style:normal;color:#64748b;text-align:right}
.fx-cmp-btn{position:absolute;top:8px;left:8px;border:0;border-radius:999px;background:rgba(15,23,42,.62);color:#fff;font-size:10.5px;font-weight:700;padding:4px 9px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:3px;z-index:2}
.fx-cmp-btn.on{background:#2563eb}
.prop-card .prop-vr-badge{top:34px}
#fx-cmp-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:8000;background:#0f172a;color:#fff;border-radius:999px;padding:8px 8px 8px 18px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:13px;white-space:nowrap}
#fx-cmp-bar .btn:not(.btn-p){background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)}
@media(max-width:768px){#fx-cmp-bar{bottom:calc(74px + env(safe-area-inset-bottom))}}
.fx-cmp-wrap{overflow-x:auto}
.fx-cmp{border-collapse:collapse;width:100%;min-width:560px;font-size:12.5px}
.fx-cmp th{text-align:left;color:#64748b;font-weight:700;padding:8px 6px;white-space:nowrap;vertical-align:top;position:sticky;left:0;background:var(--surface,#fff);font-size:11.5px}
.fx-cmp td{padding:8px 6px;border-bottom:1px solid #f1f5f9;vertical-align:top;min-width:140px;color:#0f172a}
.fx-cmp td.fx-best{color:#15803d;font-weight:800}
.fx-cmp-img{height:90px;border-radius:8px;background:#e2e8f0 center/cover;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:28px;margin-bottom:6px}
.fx-feat span{display:block;font-size:11.5px;color:#cbd5e1}
.fx-feat span.on{color:#15803d;font-weight:700}
.fx-share-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.fx-share-grid .btn{justify-content:center;padding:10px}
.fx-nav-tools{display:inline-flex;gap:6px;margin-right:6px;align-items:center}
.fx-bell{position:relative}
.fx-bell-n{position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;align-items:center;justify-content:center;padding:0 4px}
#s-admin .fx-nav-tools .btn,#s-master .fx-nav-tools .btn{border-color:rgba(255,255,255,.15);color:#cbd5e1;background:transparent}
#fx-notif{position:fixed;top:60px;right:12px;z-index:9400;width:min(360px,calc(100vw - 24px));max-height:70vh;overflow-y:auto;background:var(--surface,#fff);border-radius:14px;box-shadow:0 16px 50px rgba(0,0,0,.3);font-size:13px}
.fx-np-h{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #f1f5f9;color:var(--navy,#0f172a)}
.fx-np-sec{font-size:11px;font-weight:800;color:#94a3b8;padding:10px 14px 4px}
.fx-np-item{display:flex;gap:10px;padding:8px 14px;cursor:pointer;align-items:flex-start}
.fx-np-item:hover{background:#f8fafc}
.fx-np-item i{color:#2563eb;font-size:17px;margin-top:2px}
.fx-np-item b{display:block;font-size:13px;color:var(--navy,#0f172a)}
.fx-np-item small{color:#64748b;font-size:11.5px}
.fx-np-none{padding:6px 14px 8px;color:#94a3b8;font-size:12px}
.fx-np-foot{padding:10px 14px;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:8px;font-size:12px;color:#475569}
.fx-np-foot a{color:#1d4ed8;cursor:pointer;font-weight:700}
#fx-print-head,#fx-print-fp{display:none}
.fx-pr-tag{display:inline-block;background:#f59e0b;color:#fff;font-size:10px;font-weight:800;border-radius:4px;padding:1px 6px;letter-spacing:.05em;vertical-align:middle}
.fx-pr-badge{position:absolute;bottom:8px;left:8px;z-index:2}
@media(max-width:640px){#fx-pr{margin:12px 12px 4px!important}}
#fx-pr{margin:16px 24px 6px;padding:12px 14px;border:1.5px solid #fde68a;background:linear-gradient(135deg,#fffbeb,#fff);border-radius:14px}
.fx-pr-h{font-size:13px;font-weight:800;color:#92400e;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.fx-pr-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.fx-pr-card{display:flex;gap:10px;align-items:center;text-align:left;border:1px solid #fde68a;background:#fff;border-radius:12px;padding:8px;cursor:pointer;font-family:inherit}
.fx-pr-card:hover{box-shadow:0 4px 14px rgba(245,158,11,.2)}
.fx-pr-img{position:relative;width:84px;height:64px;border-radius:8px;background:#fef3c7 center/cover;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#d97706;font-size:22px}
.fx-pr-img .fx-pr-tag{position:absolute;top:4px;left:4px}
.fx-pr-body{display:flex;flex-direction:column;min-width:0;gap:1px}
.fx-pr-body b{color:#1d4ed8;font-size:15px}.fx-pr-body b small{font-size:10px;color:#64748b}
.fx-pr-body span{font-size:12.5px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-pr-body>small{font-size:11px;color:#64748b}
.fx-feat-pick{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.fx-feat-pick button{border:1.5px solid var(--border,#e2e8f0);background:var(--surface,#fff);border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;color:#475569}
.fx-feat-pick button.on{border-color:#16a34a;background:#f0fdf4;color:#166534;font-weight:700}
.fx-feat-pick button.on::before{content:'✓ '}
.fx-fp-img{display:block;border:1.5px solid var(--border,#e2e8f0);border-radius:12px;overflow:hidden;background:#fff;max-width:420px}
.fx-fp-img img{display:block;width:100%;height:auto}
.btn.hidden,.mp-nav-item.hidden{display:none!important}
@media(max-width:640px){.nav .nav-r>button[onclick^="guardedScreen"]{display:none!important}.fx-login-btn .fx-lbl{display:none}.fx-nav-tools{gap:4px;margin-right:0}}
#fx-yk-hero{position:absolute;right:0;top:-6px;z-index:2;display:flex;flex-direction:column;align-items:flex-end;gap:2px;pointer-events:none}
.fx-yk-bubble{pointer-events:auto;max-width:250px;background:#fff;color:#0f172a;font-size:12.5px;font-weight:700;line-height:1.6;padding:9px 13px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);position:relative;margin-right:46px}
.fx-yk-bubble::after{content:'';position:absolute;bottom:-8px;right:30px;border:8px solid transparent;border-top-color:#fff;border-bottom:0}
.fx-yk-btn{pointer-events:auto;background:none;border:0;padding:0;cursor:pointer;line-height:0}
@media(max-width:1060px){#fx-yk-hero{position:static;flex-direction:row-reverse;align-items:center;justify-content:flex-end;gap:8px;margin:4px 0 14px}#fx-yk-hero .yadokarin{width:96px;height:96px}.fx-yk-bubble{margin-right:0;max-width:none;flex:1}.fx-yk-bubble::after{bottom:auto;right:-8px;top:50%;margin-top:-8px;border:8px solid transparent;border-left-color:#fff;border-right:0}}
#fx-yk-gate{position:absolute;top:10px;right:12px;pointer-events:none}
@media(max-width:480px){#fx-yk-gate{display:none}}
#login-gate .login-card{position:relative}
.fx-yk-empty{display:flex;justify-content:center;margin-bottom:6px}
.fx-yk-hint{font-size:12px;color:#64748b;margin-top:6px}
:focus-visible{outline:3px solid #2563eb!important;outline-offset:2px}
.prop-card:focus-visible{outline-offset:3px}
.fx-mini{color:#55657a}
.fx-danger{margin-top:28px;border:1.5px solid #fecaca;background:#fff7f7;border-radius:12px;padding:14px 16px}
#fx-resv-cal{margin-bottom:14px;border:1.5px solid var(--border,#e2e8f0);border-radius:12px;padding:10px 12px;background:var(--surface,#fff)}
.fx-cal-h{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.fx-cal-h b{min-width:90px;text-align:center;color:var(--navy,#0f172a)}
.fx-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.fx-cal .wd{font-size:11px;color:#64748b;text-align:center;font-weight:700}
.fx-cal .wd.sun{color:#dc2626}.fx-cal .wd.sat{color:#2563eb}
.fx-cal button{min-height:54px;border:1px solid #eef2f7;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:flex-start;padding:4px 5px;gap:2px;text-align:left}
.fx-cal button b{font-size:12px;color:#334155}
.fx-cal button.today{border-color:#93c5fd}
.fx-cal button.has{background:#f8fbff}
.fx-cal button.on{border:2px solid #2563eb}
.fx-cal i{font-style:normal;font-size:10px;font-weight:700;border-radius:4px;padding:0 4px;display:block}
.fx-cal i.ok{background:#dcfce7;color:#166534}.fx-cal i.wait{background:#fef3c7;color:#92400e}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}#hero-particles{display:none}}
html:not(.fx-guest) .fx-login-btn{display:none}
html.fx-guest .fx-bell{display:none}
.fx-gate-skip{display:block;width:100%;margin-top:14px;background:transparent;border:1.5px solid rgba(255,255,255,.25);color:#e2e8f0;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.fx-gate-skip:hover{background:rgba(255,255,255,.08)}
.fx-gate-links{text-align:center;margin-top:10px;font-size:11px;color:#94a3b8}
.fx-gate-links a,.fx-agree a{color:#93c5fd}
.fx-agree{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#cbd5e1;margin:4px 0 14px;line-height:1.6;cursor:pointer}
.fx-agree input{margin-top:3px}
.fx-pst{display:inline-block;color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:800;vertical-align:middle}
.fx-pst-card{position:absolute;bottom:8px;right:8px;z-index:2}
.prop-card.fx-dim{opacity:.6}
.fx-closed-note{background:#f1f5f9;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#475569;font-weight:700}
.fx-chk{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#64748b;margin-left:12px;cursor:pointer}
.fx-days button[disabled]{opacity:.35;cursor:not-allowed}
.fx-af-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:700px){.fx-af-grid{grid-template-columns:1fr}}
.fx-wdays{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
.fx-wdays button{width:34px;height:32px;border-radius:8px;border:1.5px solid var(--border,#e2e8f0);background:var(--surface,#fff);font-weight:700;cursor:pointer;font-family:inherit;color:#94a3b8}
.fx-wdays button.on{border-color:#2563eb;background:#eff6ff;color:#1d4ed8}
.fx-hsel{width:auto!important;padding:6px 8px!important}
.fx-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.fx-chip{background:#f1f5f9;border-radius:999px;padding:3px 4px 3px 10px;font-size:12px;display:inline-flex;gap:6px;align-items:center}
.fx-chip b{cursor:pointer;color:#dc2626;padding:0 6px}
.fx-pano-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.fx-pano{display:flex;gap:8px;align-items:center}
.fx-pano-img{width:96px;height:48px;border-radius:6px;background:#e2e8f0 center/cover;flex-shrink:0}
.fx-pano input{flex:1}
#fx-commute{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border,#e2e8f0)}
.fx-cm-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.fx-cm-row>i{color:#2563eb;font-size:18px}
.fx-cm-row #fx-cm-place{flex:1;min-width:180px;padding:8px 11px;font-size:13px}
.fx-cm-row select{width:auto;padding:8px;font-size:13px}
.fx-cm-card,.fx-cm-badge{font-size:11.5px;color:#1d4ed8;font-weight:700;margin-top:6px}
.fx-cm-badge{background:#eff6ff;border-radius:8px;padding:6px 10px;margin-bottom:8px}
.fx-poi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:640px){.fx-poi-grid{grid-template-columns:1fr}}
.fx-poi-item{display:flex;gap:8px;align-items:flex-start;background:#f8fafc;border-radius:10px;padding:8px 10px;font-size:12.5px}
.fx-poi-item i{font-size:18px;margin-top:1px}
.fx-poi-item b{color:#0f172a}.fx-poi-item small{color:#94a3b8}
.fx-poi-item span{display:block;color:#475569;font-size:11.5px}
.fx-poi-item span.none{color:#cbd5e1}
@media print{
  body>*:not(#pd-overlay){display:none!important}
  #pd-overlay{position:static!important;display:block!important;background:none!important;padding:0!important;overflow:visible!important;backdrop-filter:none!important}
  #pd-overlay .pd-modal{box-shadow:none!important;max-width:none!important;width:100%!important;margin:0!important;max-height:none!important;overflow:visible!important;border-radius:0!important}
  .pd-close,.pd-slide-btn,.pd-dots,#pd-vr-btn,#fx-pd-actions,#pd-admin-actions,.pd-side>button,.fx-sim-in,.fx-sim summary{display:none!important}
  .pd-body{display:block!important;max-height:none!important}
  .pd-main,.pd-side{max-height:none!important;overflow:visible!important}
  .pd-side{border:0!important;background:none!important}
  .pd-slider{height:260px!important}
  #fx-print-head{display:block!important;font-size:12px;color:#334155;padding:0 0 8px;border-bottom:2px solid #2563eb;margin-bottom:10px}
  #fx-print-fp{display:block!important}#fx-print-fp img{max-width:70%;max-height:320px;display:block;margin-top:6px}
  .fx-sim{border:0!important;background:none!important;padding:0!important}
  .pd-mini-map{height:200px!important;break-inside:avoid}
}
`;
document.head.appendChild(css);


/* ══════════════ 26. トップ「行く前に、住んでみる。」══════════════
   ・右側の模型: vr-viewer.html?hero=1 を透明な背景で重ね、家全体をゆっくり回す
   ・「どんなおうち？」のボタンで、よくある条件をワンタッチで絞り込む
   ・「やどかりんに、聞いてみて。」で、VRでできることを質問と答えの形で見せる */
Object.assign(EN, {
  '行く前に、': 'Before you go,', '住んでみる。': 'live in it.',
  '気になる部屋に、いま入ってみよう。案内するのは、おうちを背負ったヤドカリの「やどかりん」。': 'Step into a room you like, right now. Your guide is Yadokarin, a hermit crab who carries a house.',
  'この部屋に入ってみる': 'Step inside this room', 'サンプルの部屋に入ってみる': 'Step inside the sample room', '物件をさがす': 'Find homes',
  'スマホ・PC・Meta Quest のブラウザで、そのまま歩けます': 'Walk around in your phone, PC or Meta Quest browser',
  'どんなおうち？': 'What kind of home?', 'ひとり暮らし': 'Living alone', 'ふたりで': 'For two', 'ペットと': 'With pets', '駅ちかく': 'Near a station', 'VRで歩ける': 'Walkable in VR',
  'エリア・駅': 'Area / station', '家賃の上限（万円）': 'Max rent (×10,000 yen)', '渋谷、新宿 など': 'Shibuya, Shinjuku…', '1LDK など': '1LDK…', 'さがす': 'Search',
  'いま見られる部屋': 'Homes you can visit now', 'やどかりんに、聞いてみて。': 'Ask Yadokarin.',
  '写真や間取り図だけではわからないことを、部屋の中で確かめられます。': "Check what photos and floor plans can't tell you — from inside the room.",
  '冷蔵庫、入る？': 'Will my fridge fit?', '冬の朝、日は入る？': 'Sun on winter mornings?', 'ソファ、置ける？': 'Room for my sofa?', '家族にも見せたい': 'Show my family',
  '使い方': 'How to use', 'プライバシーポリシー': 'Privacy policy', '利用規約': 'Terms', '卒業研究プロジェクト（CS3B）': 'Graduation project (CS3B)', 'サンプルの部屋': 'Sample room'
});

// ── ロゴ（やどかりん）
function heLogos() {
  if (!YK) return;
  document.querySelectorAll('.logo-yk').forEach(el => { if (!el.firstChild) el.innerHTML = YK.svg({ size: 38, face: 'wink', wave: false, title: '' }); });
}

// ── 質問と答え
const HE_QA = [
  ['「測る」で壁を2か所タップしてみて。壁から壁までの長さが、その場でわかるよ。', 'Tap two spots with "Measure" — you get the wall-to-wall length right away.', 'img/measure.webp', '部屋の中で壁の幅を測っている画面', 'wow'],
  ['「日当たり」で12月の朝にしてみよう。窓から床に光が入るのが見えるよ。', 'Set "Sunlight" to a December morning and watch the light fall on the floor.', 'img/sun.webp', '窓から床に日が差している画面', 'happy'],
  ['「家具」でソファを選んで置いてみて。はみ出したら赤くなるから、すぐわかるよ。', 'Pick a sofa in "Furniture" and place it. It turns red if it does not fit.', 'img/furn.webp', 'ソファを置いて収まるか確かめている画面', 'wink'],
  ['「一緒に」で招待リンクを送ってね。離れていても、同じ部屋を歩きながら話せるよ。', 'Send an invite link with "Together" — walk the same room and chat from anywhere.', 'img/live.webp', '2人で同じ部屋を見ながらチャットしている画面', 'vr']
];
let heQ = 0;
function heShowQ(i) {
  heQ = i;
  const qa = HE_QA[i], txt = $('he-say-text'), img = $('he-answer-img'), yk = $('he-say-yk');
  if (!txt || !img) return;
  document.querySelectorAll('.he-q').forEach(b => { const on = +b.dataset.q === i; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  txt.textContent = fxLang === 'en' ? qa[1] : qa[0];
  img.src = qa[2]; img.alt = qa[3];
  if (yk && YK) yk.innerHTML = YK.svg({ size: 96, face: qa[4], wave: false, title: '' });
}
function initAsk() {
  const txt = $('he-say-text'); if (!txt) return;
  txt.classList.add('fx-noi18n');
  document.querySelectorAll('.he-q').forEach(b => { b.onclick = () => heShowQ(+b.dataset.q); });
  const qs = document.querySelector('.he-qs');
  if (qs) qs.addEventListener('keydown', e => {   // ←→ で質問を切り替え
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = (heQ + (e.key === 'ArrowRight' ? 1 : HE_QA.length - 1)) % HE_QA.length;
    heShowQ(n); const b = document.querySelector(`.he-q[data-q="${n}"]`); if (b) b.focus();
  });
  heShowQ(0);
}

// ── 「どんなおうち？」ボタン
const HE_CHIPS = {
  solo: { madori: ['1R', '1K', '1DK'] },
  two: { madori: ['1LDK', '2K', '2DK', '2LDK'] },
  pet: { features: ['ペット可'] },
  near: { walkMax: 5 },
  vr: { vr: true }
};
let heVR = false;
function heRefresh() {
  currentPage = 1; renderCards(); updateResultsCount();
  if (typeof renderMapSidebar === 'function') renderMapSidebar();
  if (typeof updateMapMarkerVisibility === 'function') updateMapMarkerVisibility();
}
function heChip(btn) {
  const c = HE_CHIPS[btn.dataset.chip]; if (!c) return;
  const on = !btn.classList.contains('on');
  btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  ['madori', 'features'].forEach(k => {
    if (!c[k]) return;
    if (!(filterState[k] instanceof Set)) filterState[k] = new Set();
    c[k].forEach(v => on ? filterState[k].add(v) : filterState[k].delete(v));
  });
  if (c.walkMax) filterState.walkMax = on ? c.walkMax : null;
  if (c.vr) heVR = on;
  heSearchReset();
  heRefresh();
  const n = getFilteredProps().length;
  toast(on ? `${btn.textContent.trim()}：${n}件` : t('条件を外しました'), on && !n ? 'warn' : 'info');
}
function initChips() {
  document.querySelectorAll('.he-chip').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.onclick = () => heChip(b); });
}
const _getFiltered3 = window.getFilteredProps;
window.getFilteredProps = function () {
  const list = _getFiltered3.apply(this, arguments);
  return heVR ? list.filter(p => p.floorplanData || p.splatURL || (p.panoramas && p.panoramas.length)) : list;
};
const _resetFilters = window.resetFilters;
window.resetFilters = function () {
  heVR = false; heSearchReset();
  document.querySelectorAll('.he-chip.on').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
  return _resetFilters.apply(this, arguments);
};

// ── 回る模型
let heProp = null, heDecided = false, heReady = false, heSent = false, heInView = false, heVrOpen = false;
function hePick() {
  const ok = p => p.floorplanData && p.status !== 'closed' && p.status !== 'hidden';
  const list = PROPS.filter(ok);
  return list.find(isPR) || list.sort((a, b) => (+b.id || 0) - (+a.id || 0))[0] || null;
}
function heCaption() {
  const cap = $('he-cap'), lbl = document.querySelector('#he-enter span');
  if (lbl) lbl.textContent = t(heProp ? 'この部屋に入ってみる' : 'サンプルの部屋に入ってみる');
  if (!cap) return;
  if (!heProp) { cap.classList.remove('show'); return; }
  cap.innerHTML = `${esc(heProp.name || '')}<small>${esc(heProp.madori || '')}${heProp.price ? '・' + yen(heProp.price) + t('/月') : ''}</small>`;
  cap.classList.add('show', 'fx-noi18n');
}
async function heDecide() {
  heProp = hePick();
  if (heProp && heProp.floorplanData && heProp.floorplanData._stub && !(await ensureFull(heProp.id))) heProp = null;
  heDecided = true; heCaption(); heSend();
}
function heWin() { const f = document.querySelector('#he-frame-wrap iframe'); return f && f.contentWindow; }
function heSend() {
  const w = heWin();
  if (!w || !heReady || !heDecided || heSent) return;
  heSent = true;
  w.postMessage({ type: 'vr-hero-init', data: heProp ? heProp.floorplanData : null }, '*');
  heRun();
}
function heRun() { const w = heWin(); if (w && heSent) w.postMessage({ type: 'vr-hero-run', on: heInView && !heVrOpen && !document.hidden }, '*'); }
function heCanWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
function heLoadFrame() {
  const wrap = $('he-frame-wrap');
  if (!wrap || wrap.firstChild) return;
  if (!heCanWebGL() || (navigator.connection && navigator.connection.saveData)) return;   // 重い端末・節約モードは絵のまま
  const f = document.createElement('iframe');
  f.title = '回せる部屋の模型'; f.setAttribute('tabindex', '-1'); f.setAttribute('aria-hidden', 'true');
  f.src = 'vr-viewer.html?hero=1';
  wrap.appendChild(f);
}
function heEnter() {
  if (heProp) window.viewInVR(heProp.id);
  else openVRViewer({ sample: true, propName: '', lang: fxLang, liveOk: false });
}
window.fxHeroEnter = heEnter;
const _toggleLang = window.fxToggleLang;
window.fxToggleLang = function () { const r = _toggleLang.apply(this, arguments); heShowQ(heQ); heCaption(); return r; };
window.addEventListener('message', e => {
  const m = e.data; if (!m || typeof m !== 'object') return;
  if (e.source !== heWin()) return;
  if (m.type === 'vr-hero-ready') { heReady = true; heSend(); }
  else if (m.type === 'vr-hero-shown') { const st = $('he-stage'); if (st) st.classList.add('live'); }
  else if (m.type === 'vr-hero-enter') heEnter();
});
document.addEventListener('visibilitychange', heRun);
const _openVR = window.openVRViewer;
window.openVRViewer = function () { heVrOpen = true; heRun(); return _openVR.apply(this, arguments); };
const _closeVR2 = window.closeVRViewer;
window.closeVRViewer = function () { heVrOpen = false; const r = _closeVR2.apply(this, arguments); heRun(); return r; };
const _fetchProps = window.fetchAndRenderProps;
window.fetchAndRenderProps = async function () { const r = await _fetchProps.apply(this, arguments); heDecide(); return r; };
function initHero() {
  const st = $('he-stage'), go = $('he-enter');
  if (!st) return;
  if (go) go.onclick = heEnter;
  const start = () => setTimeout(() => {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(ents => {
        heInView = ents.some(x => x.isIntersecting);
        if (heInView) heLoadFrame();
        heRun();
      }, { rootMargin: '100px' }).observe(st);
    } else { heInView = true; heLoadFrame(); }
  }, 400);
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
}


/* ══════════════ 27. やどかりんに相談（チャット）══════════════
   悩みや希望を書くと、やどかりんがおすすめの物件を3件まで出す。
   サーバーの ykChat が答える（AIモード / かんたんモード）。会話はこのタブの中だけに残る */
Object.assign(EN, {
  'やどかりんに相談': 'Ask Yadokarin', '住まいの悩みを聞かせてね': 'Tell me your housing worries', '相談する': 'Ask',
  '最初から': 'Start over', '詳しく見る': 'Details', '間取り図': 'Floor plan', '間取り図（イメージ）': 'Floor plan (illustration)', 'VRで中を歩く': 'Walk inside in VR', 'お気に入りに追加': 'Add to favorites', 'お気に入り済み': 'Saved', 'もう一度押すとお気に入りから外します': 'Tap again to remove from favorites', 'お気に入りから外しました': 'Removed from favorites', 'お気に入りに追加しました': 'Added to favorites', 'VRで入る': 'Enter in VR', '考え中…': 'Thinking…',
  '自分の悩みを相談してみる': 'Ask about your own situation', 'かんたん': 'Basic', '送る': 'Send',
  'やどかりんAIが読み取った条件': 'What Yadokarin AI understood', '内見チェック': 'Viewing checklist', '内見メモ': 'Viewing notes',
  'メモ（気づいたこと）': 'Notes', 'VRで確かめる': 'Check in VR', 'VR内見の「チェック」ボタンからも記録できます。': 'You can also record this from the Checklist button in VR viewing.',
  '現地で内見したときのメモにも使えます。': 'Also handy for notes from an in-person visit.', 'ログインすると保存されます（いまはこのタブを閉じると消えます）。': 'Log in to keep these (they disappear when you close this tab).', 'いまの条件': 'Current conditions', 'クリア': 'Clear', '生成AI': 'Gen AI',
  'やどかりんはまちがえることもあるよ。くわしくは物件ページや担当者に確認してね。名前や電話番号などは書かないでね。': 'Yadokarin can make mistakes — check the listing and the agent for details. Please do not share your name or phone number.'
});
const YKC_KEY = 'yk_chat_v1';
const YKC_HELLO = ['ぼく、やどかりん。住まいのことで困っていること、気になっていることを教えてね。いっしょに合う部屋を探すよ！',
  "I'm Yadokarin! Tell me what's on your mind about finding a home, and I'll look for rooms that fit you."];
const YKC_CHIPS = [['猫と住みたい', 'I want to live with my cat'], ['はじめての一人暮らしで不安', 'Nervous about living alone for the first time'],
  ['在宅ワークの部屋がほしい', 'I need a room to work from home'], ['家賃をおさえたい', 'I want to keep rent low'], ['遠くに住んでいて内見に行けない', "I live far away and can't visit"]];
let ykcLog = [], ykcBusy = false, ykcCond = {}, ykcChips = [];   // ykcCond: いまの条件（サーバーが更新して返す）
try { ykcLog = JSON.parse(sessionStorage.getItem(YKC_KEY) || '[]') || []; } catch (e) { ykcLog = []; }
try { const c = JSON.parse(sessionStorage.getItem(YKC_KEY + '_cond') || 'null'); if (c) { ykcCond = c.cond || {}; ykcChips = c.chips || []; } } catch (e) {}
function ykcSave() {
  try { sessionStorage.setItem(YKC_KEY, JSON.stringify(ykcLog.slice(-30))); sessionStorage.setItem(YKC_KEY + '_cond', JSON.stringify({ cond: ykcCond, chips: ykcChips })); } catch (e) {}
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function ykcBuild() {
  if ($('ykc') || !YK) return;
  const fab = el('button', 'ykc-fab'); fab.id = 'ykc-fab'; fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-controls', 'ykc'); fab.setAttribute('aria-label', 'やどかりんに相談');
  fab.innerHTML = YK.svg({ size: 60, face: 'happy', wave: false, title: '' }) + '<span class="ykc-fab-lbl">相談する</span>';
  fab.onclick = () => ykcOpen(true);
  const box = el('section'); box.id = 'ykc'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-labelledby', 'ykc-title');
  box.innerHTML = `<header class="ykc-head"><span class="ykc-face" aria-hidden="true">${YK.svg({ size: 44, face: 'wink', wave: false, title: '' })}</span>
      <div class="ykc-ttl"><h2 id="ykc-title">やどかりんに相談</h2><small>住まいの悩みを聞かせてね</small><span class="ykc-mode fx-noi18n" id="ykc-mode" hidden></span></div>
      <button type="button" class="ykc-reset" id="ykc-reset" aria-label="最初から" title="最初から"><i class="ti ti-refresh" aria-hidden="true"></i></button>
      <button type="button" class="ykc-x" id="ykc-x" aria-label="閉じる"><i class="ti ti-x"></i></button></header>
    <div class="ykc-log" id="ykc-log" aria-live="polite"></div>
    <div class="ykc-chips" id="ykc-chips"></div>
    <div class="ykc-cond" id="ykc-cond" hidden><span class="ykc-cond-ttl">いまの条件</span><span class="ykc-cond-list" id="ykc-cond-list"></span><button type="button" class="ykc-cond-clear" id="ykc-cond-clear">クリア</button></div>
    <form class="ykc-form" id="ykc-form"><label class="ykc-sr" for="ykc-in">相談する</label>
      <textarea id="ykc-in" rows="1" maxlength="400" placeholder="例: 猫と住みたい。家賃は8万円まで"></textarea>
      <button type="submit" class="ykc-send" aria-label="送る"><i class="ti ti-send"></i></button></form>
    <p class="ykc-note">やどかりんはまちがえることもあるよ。くわしくは物件ページや担当者に確認してね。名前や電話番号などは書かないでね。</p>`;
  document.body.appendChild(fab); document.body.appendChild(box);
  EN['例: 猫と住みたい。家賃は8万円まで'] = 'e.g. I have a cat. Rent under ¥80,000';
  $('ykc-x').onclick = () => ykcOpen(false);
  $('ykc-reset').onclick = () => { ykcLog = []; ykcCond = {}; ykcChips = []; ykcSave(); ykcRender(); $('ykc-in').focus(); };
  $('ykc-cond-clear').onclick = () => ykcRefine({});
  $('ykc-form').onsubmit = e => { e.preventDefault(); ykcSend($('ykc-in').value); };
  const inp = $('ykc-in');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ykcSend(inp.value); } });
  inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); ykcOpen(false); } });
  ykcRender();
}
// やどかりんAI（yk-ai.js）で、文章から条件を読み取る。読み込めなければ null（サーバーのルールにまかせる）
async function ykcIntents(text) {
  if (!window.YkAI) return null;
  try {
    await Promise.race([YkAI.load(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    return YkAI.predict(text).map(x => ({ label: x.label, p: Math.round(x.p * 100) / 100, ja: x.ja, en: x.en }));
  } catch (e) { return null; }
}
function ykcOpen(on) {
  const box = $('ykc'), fab = $('ykc-fab'); if (!box) return;
  if (on && window.YkAI) YkAI.load().catch(() => {});
  box.hidden = !on; fab.setAttribute('aria-expanded', on ? 'true' : 'false');
  document.body.classList.toggle('ykc-open', on);
  if (on) { ykcRender(); setTimeout(() => $('ykc-in').focus(), 30); } else fab.focus();
}
window.fxOpenYk = function (text) { ykcOpen(true); if (text) ykcSend(text); };
function ykcPickCard(pk) {
  const p = findProp(pk.id); if (!p) return null;
  const card = el('div', 'ykc-pick');
  const img = el('div', 'ykc-pick-img');
  const src = (p.thumbURL && p.photoURLs && p.thumbOf === p.photoURLs[0]) ? p.thumbURL : ((p.photoURLs || [])[0] || '');
  const vr = !!(p.floorplanData || p.splatURL || (p.panoramas && p.panoramas.length));
  if (src) img.style.backgroundImage = `url("${String(src).replace(/["\\]/g, '')}")`;
  else if (p.fpMini && fpSvg(p.fpMini)) { img.classList.add('fp'); img.innerHTML = fpSvg(p.fpMini); }
  else if (vr) img.classList.add('doll');
  const body = el('div', 'ykc-pick-body');
  body.appendChild(el('b', 'fx-noi18n', p.name || ''));
  body.appendChild(el('span', 'ykc-pick-meta', [yen(p.price) + t('/月'), p.madori, (p.station || '') + (p.walkMin ? (fxLang === 'en' ? ` ${p.walkMin} min` : ` 徒歩${p.walkMin}分`) : '')].filter(Boolean).join('・')));
  if (pk.reason) body.appendChild(el('em', 'fx-noi18n', pk.reason));
  const btns = el('div', 'ykc-pick-btns');
  const d = el('button', 'ykc-b', t('詳しく見る')); d.type = 'button';
  d.onclick = () => { if (matchMedia('(max-width: 640px)').matches) ykcOpen(false); showPropDetail(p.id); };
  btns.appendChild(d);
  if (vr) { const v = el('button', 'ykc-b ykc-b-vr', t('VRで入る')); v.type = 'button'; v.onclick = () => window.viewInVR(p.id); btns.appendChild(v); }
  body.appendChild(btns);
  card.appendChild(img); card.appendChild(body);
  return card;
}
function ykcBubble(role, text, extra) {
  const row = el('div', 'ykc-row ' + (role === 'me' ? 'me' : 'yk'));
  if (role !== 'me') { const f = el('span', 'ykc-av'); f.setAttribute('aria-hidden', 'true'); f.innerHTML = YK.svg({ size: 34, face: (extra && extra.face) || 'happy', wave: false, title: '' }); row.appendChild(f); }
  const b = el('div', 'ykc-msg fx-noi18n' + (extra && extra.err ? ' err' : ''), text);
  row.appendChild(b);
  return row;
}
function ykcRender() {
  const log = $('ykc-log'); if (!log) return;
  log.innerHTML = '';
  log.appendChild(ykcBubble('yk', fxLang === 'en' ? YKC_HELLO[1] : YKC_HELLO[0], { face: 'wink' }));
  ykcLog.forEach(m => {
    log.appendChild(ykcBubble(m.role, m.text, m));
    if (m.role === 'me' && m.intents && m.intents.length) {
      const c = el('div', 'ykc-read fx-noi18n');
      c.appendChild(el('small', '', t('やどかりんAIが読み取った条件')));
      m.intents.forEach(x => { const sp = el('span', '', `${fxLang === 'en' ? x.en : x.ja} ${Math.round(x.p * 100)}%`); sp.title = fxLang === 'en' ? 'confidence' : 'AIの自信の度合い'; c.appendChild(sp); });
      log.appendChild(c);
    }
    (m.picks || []).forEach(pk => { const card = ykcPickCard(pk); if (card) log.appendChild(card); });
    const located = (m.picks || []).filter(pk => { const p = findProp(pk.id); return p && p.lat && p.lng; });
    if (located.length) {
      const b = el('button', 'ykc-b ykc-mapbtn'); b.type = 'button';
      b.innerHTML = '<i class="ti ti-map-2" aria-hidden="true"></i> '; b.appendChild(document.createTextNode(t('地図で見る')));
      b.onclick = () => window.fxPicksOnMap((m.picks || []).map(pk => pk.id));
      log.appendChild(b);
    }
  });
  if (ykcBusy) { const r = ykcBubble('yk', t('考え中…'), { face: 'wow' }); r.classList.add('busy'); log.appendChild(r); }
  const chips = $('ykc-chips'); chips.innerHTML = '';
  if (!ykcLog.length && !ykcBusy) YKC_CHIPS.forEach(c => { const b = el('button', 'ykc-chip fx-noi18n', fxLang === 'en' ? c[1] : c[0]); b.type = 'button'; b.onclick = () => ykcSend(b.textContent); chips.appendChild(b); });
  const last = [...ykcLog].reverse().find(m => m.mode);
  const mode = $('ykc-mode'); if (mode) { mode.hidden = !last; if (last) mode.textContent = last.mode === 'ai' ? t('生成AI') : last.mode === 'model' ? 'やどかりんAI' : t('かんたん'); }
  // いまの条件（×で1つずつ外せる）
  const cb = $('ykc-cond'), cl = $('ykc-cond-list');
  if (cb && cl) {
    cl.innerHTML = '';
    ykcChips.forEach(c => {
      const b = el('button', 'ykc-cond-chip fx-noi18n'); b.type = 'button';
      b.appendChild(el('span', '', c.label)); b.appendChild(el('i', 'ti ti-x'));
      b.setAttribute('aria-label', (fxLang === 'en' ? 'Remove: ' : '外す: ') + c.label);
      b.onclick = () => ykcRefine(ykcDrop(ykcCond, c.key));
      cl.appendChild(b);
    });
    cb.hidden = !ykcChips.length;
  }
  log.scrollTop = log.scrollHeight;
}
function ykcDrop(cond, key) {
  const c = JSON.parse(JSON.stringify(cond || {}));
  if (key.startsWith('i:')) c.intents = (c.intents || []).filter(k => k !== key.slice(2));
  else if (key === 'madori') c.madori = [];
  else c[key] = null;
  return c;
}
// 文を区切る（サーバーと同じ区切り方）。「猫がいるので、駅は気にしない」→「猫がいる」「駅は気にしない」
function ykcClauses(text) { return text.split(/[。！？!?\n、,，]+|けど|けれど|ので|が、/).map(x => x.trim()).filter(Boolean); }
async function ykcCall(body) {
  const r = await api('ykChat', { body });
  if (r.cond) ykcCond = r.cond;
  if (r.chips) ykcChips = r.chips;
  ykcLog.push({ role: 'yk', text: r.reply || '', picks: r.picks || [], mode: r.mode, face: (r.picks || []).length ? 'happy' : 'wow' });
}
function ykcHist() { return ykcLog.filter(m => !m.err).slice(-12).map(m => ({ role: m.role, text: m.text })); }
async function ykcRefine(cond) {
  if (ykcBusy) return;
  ykcBusy = true; ykcRender();
  try { await ykcCall({ messages: ykcHist(), cond, refine: true, lang: fxLang }); }
  catch (e) { ykcLog.push({ role: 'yk', err: true, face: 'sad', text: e.status === 429 ? e.message : (fxLang === 'en' ? 'Sorry, I could not connect. Please try again.' : 'ごめんね、うまくつながらなかったみたい。もう一度ためしてみて。') }); }
  finally { ykcBusy = false; ykcSave(); ykcRender(); }
}
async function ykcSend(text) {
  text = String(text || '').trim().slice(0, 400);
  if (!text || ykcBusy) return;
  $('ykc-in').value = ''; $('ykc-in').style.height = '';
  const mine = { role: 'me', text };
  ykcLog.push(mine);
  ykcBusy = true; ykcRender();
  try {
    if (!PROPS.length && typeof fetchAndRenderProps === 'function') await fetchAndRenderProps();
    const it = await ykcIntents(text);
    if (it) mine.intents = it;
    const body = { messages: ykcHist(), cond: ykcCond, lang: fxLang };
    if (it) {   // 文全体と、区切りごとにやどかりんAIで読む（区切りごとだと「〜は気にしない」を正しく外せる）
      body.lastIntents = it.map(x => x.label);
      const cl = ykcClauses(text);
      body.lastClauses = await Promise.all(cl.slice(0, 12).map(async c => ({ text: c, intents: ((await ykcIntents(c)) || []).map(x => x.label) })));
    }
    await ykcCall(body);
  } catch (e) {
    ykcLog.push({ role: 'yk', err: true, face: 'sad', text: e.status === 429 ? e.message : (fxLang === 'en' ? 'Sorry, I could not connect. Please try again.' : 'ごめんね、うまくつながらなかったみたい。もう一度送ってみて。') });
  } finally {
    ykcBusy = false; ykcSave(); ykcRender();
  }
}
const _toggleLang2 = window.fxToggleLang;
window.fxToggleLang = function () { const r = _toggleLang2.apply(this, arguments); ykcRender(); return r; };


/* ══════════════ 28. 地図で探す（トップのリストと切り替え）══════════════
   ・ピンに家賃を表示。VRで歩ける物件は緑のピン
   ・ピンと一覧が連動（スマホは下のカードを横にスワイプ）
   ・「この範囲で探す」「現在地」・通勤先の目安の円
   ・やどかりんのおすすめを地図で見る */
Object.assign(EN, {
  'リスト': 'List', '地図': 'Map', 'この範囲で探す': 'Search this area', 'VRで歩ける': 'Walkable in VR', '写真のみ': 'Photos only',
  '地図の範囲で絞り込み中': 'Filtered to map area', 'やどかりんのおすすめ': "Yadokarin's picks", '地図で見る': 'View on map',
  '現在地を表示': 'Show my location', '通勤先': 'Commute', '地図で見る物件がありません': 'No homes to show on the map'
});
let heView = 'list', heMap = null, heLayer = null, heCommuteLayer = null, heMeLayer = null, heSel = null, heBounds = null, heOnlyIds = null;
let heUserMoved = false, heFitting = false, hePins = {};
try { if (localStorage.getItem('he_view') === 'map') heView = 'map'; } catch (e) {}

// 地図の範囲・やどかりんのおすすめで絞り込む（リストにも効く）
const _getFiltered4 = window.getFilteredProps;
window.getFilteredProps = function () {
  let list = _getFiltered4.apply(this, arguments);
  if (heOnlyIds) list = list.filter(p => heOnlyIds.includes(p.id));
  if (heBounds) list = list.filter(p => p.lat && p.lng && +p.lat >= heBounds[0][0] && +p.lat <= heBounds[1][0] && +p.lng >= heBounds[0][1] && +p.lng <= heBounds[1][1]);
  return list;
};
function heActive() {
  const box = $('he-active'); if (!box) return;
  box.innerHTML = '';
  const add = (label, off) => { const b = el('button', 'he-active-chip fx-noi18n'); b.type = 'button'; b.appendChild(el('span', '', label)); b.appendChild(el('i', 'ti ti-x')); b.setAttribute('aria-label', (fxLang === 'en' ? 'Remove: ' : '外す: ') + label); b.onclick = off; box.appendChild(b); };
  if (heBounds) add(t('地図の範囲で絞り込み中'), () => { heBounds = null; heRefresh(); });
  if (heOnlyIds) add(`${t('やどかりんのおすすめ')} ${heOnlyIds.length}${fxLang === 'en' ? '' : '件'}`, () => { heOnlyIds = null; heRefresh(); });
  box.hidden = !box.childNodes.length;
}
function heRefresh() { currentPage = 1; renderCards(); updateResultsCount(); heActive(); }
// 検索したら: 前の「この範囲で探す」は外して、地図を検索結果に合わせて動かす
let heFitNext = false;
function heSearchReset() { heBounds = null; heOnlyIds = null; heFitNext = true; setTimeout(heActive, 0); }
const _applyFiltersMap = window.applyFilters;
window.applyFilters = function () {
  heSearchReset();
  const r = _applyFiltersMap.apply(this, arguments);
  if (heMap && heView === 'map') { heFitNext = false; heDraw(true); }
  return r;
};

function heSetView(v, opts) {
  heView = v === 'map' ? 'map' : 'list';
  try { localStorage.setItem('he_view', heView); } catch (e) {}
  document.querySelectorAll('.he-view-btn').forEach(b => { const on = b.dataset.view === heView; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  const isMap = heView === 'map';
  const grid = $('card-grid'), pager = document.querySelector('#s-top .pagination'), map = $('he-map');
  if (grid) grid.hidden = isMap;
  if (pager) pager.hidden = isMap;
  if (map) map.hidden = !isMap;
  document.body.classList.toggle('he-mapview', isMap);
  if (isMap) { heInitMap(); setTimeout(() => { if (heMap) { heMap.invalidateSize(); heDraw(!(opts && opts.keepView)); } }, 30); }
  setTimeout(heFabDodge, 60);
  heTabMark();
  if (opts && opts.scroll) { const tgt = $('he-list-anchor') || document.querySelector('.he-list-title'); if (tgt) tgt.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
window.fxSetView = heSetView;
// 上のタブ: トップで地図表示のときは「マップ」を光らせる
function heTabMark() {
  const top = $('s-top'); if (!top || !top.classList.contains('active')) return;
  const tm = $('tab-map'), tt = $('tab-top');
  if (tm) tm.classList.toggle('active', heView === 'map');
  if (tt) tt.classList.toggle('active', heView !== 'map');
}
// 古い「マップ」画面はもう使わない。どこから開かれても（戻るボタン・#map のURLなど）トップの地図表示にする
const _showScreenOld = window.showScreen;
window.showScreen = function (id) {
  if (id === 'map') {
    const r = _showScreenOld.call(this, 'top');
    setTimeout(() => { heSetView('map'); heTabMark(); }, 30);
    return r;
  }
  const r = _showScreenOld.apply(this, arguments);
  if (id === 'top') setTimeout(heTabMark, 0);
  return r;
};
window.initLeafletMap = function () {};   // 古い地図は作らない
const _applyScreenOld = window._applyScreen;
if (typeof _applyScreenOld === 'function') window._applyScreen = function (id) {
  if (id === 'map') { const r = _applyScreenOld.call(this, 'top'); setTimeout(() => { heSetView('map'); heTabMark(); }, 30); return r; }
  const r = _applyScreenOld.apply(this, arguments);
  if (id === 'top') setTimeout(heTabMark, 0);
  return r;
};

function heInitMap() {
  if (heMap || typeof L === 'undefined' || !$('he-map-canvas')) return;
  heMap = L.map('he-map-canvas', { zoomControl: true, scrollWheelZoom: true, tap: true }).setView([35.6762, 139.6503], 12);
  fxBaseLayers(heMap, true);
  heLayer = L.layerGroup().addTo(heMap);
  heCommuteLayer = L.layerGroup().addTo(heMap);
  // 利用者が地図を動かしたら「この範囲で探す」を出す（こちらが動かしたときは出さない）
  heMap.on('movestart', () => { if (!heFitting) heUserMoved = true; });
  heMap.on('moveend', () => { if (heUserMoved && !heFitting) { const b = $('he-map-area'); if (b) b.hidden = false; } heFitting = false; });
  heMap.on('zoomend moveend', heCompact);
  $('he-map-area').onclick = () => {
    const b = heMap.getBounds();
    heBounds = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    $('he-map-area').hidden = true; heUserMoved = false;
    heRefresh();
  };
  $('he-map-loc').onclick = heLocate;
  // スマホ: 下のカードを横にスワイプしたら、そのピンを選ぶ
  const list = $('he-map-list');
  let st = null;
  list.addEventListener('scroll', () => {
    if (!matchMedia('(max-width: 760px)').matches) return;
    clearTimeout(st);
    st = setTimeout(() => {
      const r = list.getBoundingClientRect(), cx = r.left + r.width / 2;
      let best = null, bd = 1e9;
      list.querySelectorAll('.he-ml-item').forEach(it => { const ir = it.getBoundingClientRect(); const d = Math.abs(ir.left + ir.width / 2 - cx); if (d < bd) { bd = d; best = it; } });
      if (best && +best.dataset.id !== heSel) heSelect(+best.dataset.id, { from: 'list' });
    }, 140);
  }, { passive: true });
}
// 地図の絵（タイル）。ふだんは見やすい OpenStreetMap（CARTO Voyager）。右上で国土地理院の地図・航空写真にも切り替えられる
function fxBaseLayers(map, withControl) {
  const en = fxLang === 'en';
  const gsi = (id, ext) => L.tileLayer(`https://cyberjapandata.gsi.go.jp/xyz/${id}/{z}/{x}/{y}.${ext}`, {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>', maxNativeZoom: 18, maxZoom: 19 });
  const voyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>', subdomains: 'abcd', maxZoom: 19 });
  const layers = {};
  layers[en ? 'Map' : '地図'] = voyager;
  layers[en ? 'Map (GSI)' : '地図（国土地理院）'] = gsi('std', 'png');
  layers[en ? 'Aerial photo' : '航空写真'] = gsi('seamlessphoto', 'jpg');
  const keys = ['map', 'gsi', 'photo'], names = Object.keys(layers);
  let pick = 0;
  try { const k = keys.indexOf(localStorage.getItem('fx_map_base')); if (k >= 0) pick = k; } catch (e) {}
  const first = layers[names[pick]];
  let errs = 0;   // 読めないときは別の地図にする
  first.on('tileerror', () => { if (++errs === 6 && map.hasLayer(first)) { map.removeLayer(first); layers[names[pick === 0 ? 1 : 0]].addTo(map); } });
  first.addTo(map);
  if (withControl) {
    L.control.layers(layers, null, { position: 'topleft', collapsed: true }).addTo(map);
    map.on('baselayerchange', e => { try { localStorage.setItem('fx_map_base', keys[names.indexOf(e.name)] || 'map'); } catch (er) {} });
  }
  return layers;
}
window.fxBaseLayers = fxBaseLayers;
window.fxHeMap = () => ({ map: heMap, pins: hePins });   // テスト・確認用
function hePriceLabel(p) { return (Math.round((+p.price || 0) / 1000) / 10).toString() + '万'; }   // 98000 → 9.8万
function heLatLng(list) {
  // 同じ場所の物件は少しずらして、ピンが重ならないようにする
  const seen = {}, out = {};
  list.forEach(p => {
    const k = (+p.lat).toFixed(5) + ',' + (+p.lng).toFixed(5);
    const n = seen[k] = (seen[k] || 0) + 1;
    const a = (n - 1) * 2.4, r = n > 1 ? 0.00022 * Math.sqrt(n - 1) : 0;
    out[p.id] = [+p.lat + r * Math.sin(a), +p.lng + r * Math.cos(a)];
  });
  return out;
}
function heIsVR(p) { return !!(p.floorplanData || p.splatURL || (p.panoramas && p.panoramas.length)); }
function heDraw(fit) {
  if (!heMap) return;
  const all = getFilteredProps();
  const list = all.filter(p => p.lat && p.lng);
  heLayer.clearLayers(); hePins = {};
  const pos = heLatLng(list);
  list.forEach(p => {
    const vr = heIsVR(p);
    const icon = L.divIcon({ className: 'he-pin-wrap', iconSize: null,
      html: `<div class="he-pin${vr ? ' vr' : ''}${isPR(p) ? ' pr' : ''}${heSel === p.id ? ' sel' : ''}"><span>${esc(fxLang === 'en' ? '¥' + Math.round((+p.price || 0) / 1000) + 'k' : hePriceLabel(p))}</span></div>` });
    const m = L.marker(pos[p.id], { icon, title: `${p.name}（${yen(p.price)}）`, alt: p.name, riseOnHover: true, keyboard: true });
    m.on('click', () => heSelect(p.id, { from: 'pin' }));
    m.addTo(heLayer); hePins[p.id] = m;
  });
  heDrawCommute();
  heRenderList(all, list.length);
  setTimeout(heCompact, 0);
  const note = $('he-map-note');
  if (note) { const miss = all.length - list.length; note.hidden = !miss; note.textContent = miss ? (fxLang === 'en' ? `${miss} home(s) without a location are only in the list` : `位置が登録されていない${miss}件は、一覧にだけ出ています`) : ''; }
  if (fit) {
    const pts = list.map(p => pos[p.id]);
    if (commute) pts.push([commute.lat, commute.lng]);
    heFitting = true;
    if (pts.length > 1) heMap.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    else if (pts.length === 1) heMap.setView(pts[0], 15);
    else heFitting = false;
    heUserMoved = false; const b = $('he-map-area'); if (b) b.hidden = true;
  }
}
// ピンが多くて重なるときは、小さな点にして見やすくする（近づくと家賃が出る）
function heCompact() {
  if (!heMap) return;
  const b = heMap.getBounds();
  let n = 0; Object.values(hePins).forEach(m => { if (b.contains(m.getLatLng())) n++; });
  const box = heMap.getContainer();
  box.classList.toggle('he-compact', n > 35 && heMap.getZoom() < 15);
}
function heDrawCommute() {
  if (!heCommuteLayer) return;
  heCommuteLayer.clearLayers();
  if (!commute) return;
  // 通勤時間の目安の円。commuteMin() と同じ考え方（道のり＝直線×1.25、電車は時速30km、待ち8分、駅まで徒歩7分くらい）
  //   電車: 7 + 8 + 直線km×1.25÷30×60 ≦ 分  →  直線km ≦ (分 − 15) ÷ 2.5
  //   徒歩: 直線km×1.25×1000÷80 ≦ 分      →  直線km ≦ 分 × 0.064
  const km = Math.max(commute.max * 0.064, (commute.max - 15) / 2.5, 0.3);
  L.circle([commute.lat, commute.lng], { radius: km * 1000, color: '#E8604A', weight: 2, dashArray: '6 6', fillColor: '#E8604A', fillOpacity: 0.06, interactive: false }).addTo(heCommuteLayer);
  L.marker([commute.lat, commute.lng], { icon: L.divIcon({ className: 'he-pin-wrap', iconSize: null, html: `<div class="he-cm-pin"><i class="ti ti-briefcase"></i> ${esc(commute.name)}<small>${commute.max}${fxLang === 'en' ? ' min' : '分圏の目安'}</small></div>` }), interactive: false, keyboard: false }).addTo(heCommuteLayer);
}
function heRenderList(all, onMap) {
  const box = $('he-map-list'); if (!box) return;
  box.innerHTML = '';
  if (!all.length) { box.appendChild(el('div', 'he-ml-empty', t('地図で見る物件がありません'))); return; }
  all.forEach(p => {
    const it = el('div', 'he-ml-item' + (heSel === p.id ? ' sel' : '') + (p.lat && p.lng ? '' : ' noloc'));
    it.dataset.id = p.id; it.tabIndex = 0; it.setAttribute('role', 'button');
    it.setAttribute('aria-label', `${p.name} ${yen(p.price)}`);
    const img = el('div', 'he-ml-img');
    const src = (p.thumbURL && p.photoURLs && p.thumbOf === p.photoURLs[0]) ? p.thumbURL : ((p.photoURLs || [])[0] || '');
    if (src) img.style.backgroundImage = `url("${String(src).replace(/["\\]/g, '')}")`;
    else if (p.fpMini && fpSvg(p.fpMini)) { img.classList.add('fp'); img.innerHTML = fpSvg(p.fpMini); }
    else if (heIsVR(p)) img.classList.add('doll');
    if (heIsVR(p)) img.appendChild(el('span', 'he-ml-vr', 'VR'));
    const body = el('div', 'he-ml-body');
    body.appendChild(el('b', 'he-ml-price', yen(p.price) + t('/月')));
    body.appendChild(el('span', 'he-ml-name fx-noi18n', p.name || ''));
    body.appendChild(el('span', 'he-ml-meta', [p.madori, p.size ? p.size + '㎡' : '', (p.station || '') + (p.walkMin ? (fxLang === 'en' ? ` ${p.walkMin} min` : ` 徒歩${p.walkMin}分`) : '')].filter(Boolean).join('・')));
    const btns = el('div', 'he-ml-btns');
    const d = el('button', 'ykc-b', t('詳しく見る')); d.type = 'button'; d.onclick = e => { e.stopPropagation(); showPropDetail(p.id); };
    btns.appendChild(d);
    if (heIsVR(p)) { const v = el('button', 'ykc-b ykc-b-vr', t('VRで入る')); v.type = 'button'; v.onclick = e => { e.stopPropagation(); window.viewInVR(p.id); }; btns.appendChild(v); }
    body.appendChild(btns);
    it.appendChild(img); it.appendChild(body);
    it.onclick = () => heSelect(p.id, { from: 'list', zoom: true });
    it.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); heSelect(p.id, { from: 'list', zoom: true }); } };
    it.onmouseenter = () => { const m = hePins[p.id]; if (m && m._icon) m._icon.classList.add('hover'); };
    it.onmouseleave = () => { const m = hePins[p.id]; if (m && m._icon) m._icon.classList.remove('hover'); };
    box.appendChild(it);
  });
}
function heSelect(id, o) {
  o = o || {};
  heSel = id;
  Object.entries(hePins).forEach(([k, m]) => { const pin = m._icon && m._icon.querySelector('.he-pin'); if (pin) pin.classList.toggle('sel', +k === id); if (m._icon) m.setZIndexOffset(+k === id ? 1000 : 0); });
  const items = document.querySelectorAll('#he-map-list .he-ml-item');
  items.forEach(it => it.classList.toggle('sel', +it.dataset.id === id));
  const it = document.querySelector(`#he-map-list .he-ml-item[data-id="${id}"]`);
  if (it && o.from !== 'list') it.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  const m = hePins[id];
  if (m && heMap && o.from !== 'pin') {
    heFitting = true;
    if (o.zoom) heMap.setView(m.getLatLng(), Math.max(heMap.getZoom(), 15), { animate: true });
    else heMap.panTo(m.getLatLng(), { animate: true });
  }
}
function heLocate() {
  if (!navigator.geolocation) { toast(fxLang === 'en' ? 'Location is not available' : 'この端末では現在地を使えません', 'warn'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (heMeLayer) heMeLayer.remove();
    heMeLayer = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(heMap);
    heMap.setView(ll, 15);
  }, () => toast(fxLang === 'en' ? 'Could not get your location' : '現在地を取得できませんでした（位置情報の許可を確認してね）', 'warn'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
}
// 物件の一覧が描き直されるたびに、地図も描き直す
const _renderCards4 = window.renderCards;
window.renderCards = function () {
  const r = _renderCards4.apply(this, arguments);
  if (heMap && heView === 'map') { heDraw(heFitNext); heFitNext = false; }
  return r;
};
// 古い「マップ」画面へ行こうとしたら、トップの地図表示にする
const _guarded2 = window.guardedScreen;
window.guardedScreen = function (name) {
  if (name === 'map') { const r = _guarded2.call(this, 'top'); setTimeout(() => heSetView('map', { scroll: true }), 50); return r; }
  return _guarded2.apply(this, arguments);
};
// スマホの地図表示: 下のカードが画面の下にあるときだけ、やどかりんボタンをカードの上に逃がす
function heFabDodge() {
  const fab = $('ykc-fab'); if (!fab) return;
  let lift = 0;
  if (heView === 'map' && matchMedia('(max-width: 760px)').matches && $('s-top').classList.contains('active')) {
    const st = document.querySelector('.he-map-stage'), vh = window.innerHeight;
    if (st) { const r = st.getBoundingClientRect(); const bandTop = r.bottom - 150; if (r.bottom > vh - 90 && bandTop < vh) lift = Math.max(0, vh - bandTop + 8 - 16); }
  }
  fab.style.transform = lift ? `translateY(-${lift}px)` : '';
}
let heFabRaf = 0;
['scroll', 'resize'].forEach(ev => window.addEventListener(ev, () => { cancelAnimationFrame(heFabRaf); heFabRaf = requestAnimationFrame(heFabDodge); }, { passive: true }));
// 上のタブの高さを測って、各画面のヘッダーをその真下にぴったり固定する（すき間・潜りこみをなくす）
function fitStickyNav() {
  const tb = document.querySelector('.tab-bar'); if (!tb) return;
  const h = tb.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--tabh', h + 'px');
}
if ('ResizeObserver' in window) { const ro = new ResizeObserver(fitStickyNav); const tb0 = document.querySelector('.tab-bar'); if (tb0) ro.observe(tb0); }
window.addEventListener('resize', fitStickyNav);
function initMapView() {
  document.querySelectorAll('.he-view-btn').forEach(b => { b.onclick = () => heSetView(b.dataset.view); });
  if (heView === 'map') heSetView('map');
}
// やどかりんのおすすめを地図で見る
window.fxPicksOnMap = function (ids) {
  heOnlyIds = (ids || []).filter(id => findProp(id));
  if (!heOnlyIds.length) { heOnlyIds = null; return; }
  heBounds = null;
  ykcOpen(false);
  if (!$('s-top').classList.contains('active')) _guarded2('top');
  heRefresh();
  heSetView('map', { scroll: true });
};


/* ══════════════ 30. 掲載の管理（マスター＝サイト運営）══════════════
   運営ができるのは「掲載を止める／再開する」と「おすすめ掲載（PR）の設定」だけ。物件の中身は不動産会社（管理者）が編集する */
async function renderModeration() {
  const box = $('master-listings'); if (!box) return;
  const nSample = PROPS.filter(p => p.sample).length;
  box.innerHTML = `<h2 class="fx-mod-h">掲載の管理</h2><p class="fx-mini">不適切な掲載を止めたり、おすすめ掲載（PR）の期間を設定したりできます。物件の内容（家賃・写真など）は、掲載した不動産会社が編集します。</p>
    <div class="fx-mod-sample"><b><i class="ti ti-database-plus"></i> サンプル物件（発表・テスト用）</b>
      <p class="fx-mini">実在の駅・町名をもとに、家賃・設備・間取り（毎回ランダムで、VR内見できる）までそれらしい物件を自動で作ります。番地と建物名は架空です。名前に【サンプル】が付き、まとめて消せます。いまのサンプル：${nSample}件</p>
      <div class="fx-mod-sample-row"><select class="finput" id="fx-seed-pref" aria-label="作る場所">${SAMPLE_PREF_OPTS.map(o => `<option${o === fxSeedPref ? ' selected' : ''}>${o}</option>`).join('')}</select>
      <select class="finput" id="fx-seed-n" aria-label="件数"><option>20</option><option selected>50</option><option>100</option><option>200</option></select>
      <button class="btn btn-sm btn-p" type="button" id="fx-seed-go">サンプル物件を追加</button>
      <button class="btn btn-sm" type="button" id="fx-seed-clear" ${nSample ? '' : 'disabled'}>サンプル物件を全部消す</button></div></div>
    <input class="finput fx-mod-q" id="fx-mod-q" placeholder="物件名・登録者でしぼりこむ" value="${esc(fxModQ)}">
    <div class="fx-mod-list" id="fx-mod-list">読み込み中…</div>`;
  $('fx-seed-go').onclick = () => { fxSeedPref = $('fx-seed-pref').value; seedSamples(+$('fx-seed-n').value, fxSeedPref); };
  $('fx-seed-clear').onclick = () => clearSamples(nSample);
  const q = $('fx-mod-q');
  q.oninput = () => { fxModQ = q.value; clearTimeout(fxModT); fxModT = setTimeout(() => { renderModeration(); const n = $('fx-mod-q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); };
  const list = $('fx-mod-list'); list.innerHTML = '';
  const kw = fxModQ.trim().toLowerCase();
  const props = PROPS.filter(p => !kw || `${p.name} ${p.ownerName || ''} ${p.ownerEmail || ''}`.toLowerCase().includes(kw))
    .sort((a, b) => (+!!b.modHidden) - (+!!a.modHidden) || (+b.id || 0) - (+a.id || 0));
  if (!props.length) { list.textContent = '物件がありません'; return; }
  const today = ymd(new Date());
  props.forEach(p => {
    const row = el('div', 'fx-mod-row' + (p.modHidden ? ' stopped' : ''));
    const info = el('div', 'fx-mod-info');
    info.appendChild(el('b', 'fx-noi18n', p.name || ''));
    info.appendChild(el('span', 'fx-mini', `${p.ownerName || p.ownerEmail || '（登録者なし）'}・${yen(p.price)}・${(PSTATUS[p.status || 'open'] || ['?'])[0]}`));
    if (p.modHidden) info.appendChild(el('span', 'fx-mod-note', `運営が掲載停止中${p.modNote ? '：' + p.modNote : ''}`));
    const pr = el('div', 'fx-mod-pr');
    const lab = el('label', 'fx-mini', 'PR終了日 '); const inp = el('input', 'finput'); inp.type = 'date'; inp.value = p.featuredUntil || ''; inp.min = today;
    lab.appendChild(inp); pr.appendChild(lab);
    const save = el('button', 'btn btn-sm', '保存'); save.type = 'button';
    save.onclick = () => moderate(p, { featuredUntil: inp.value || null }, inp.value ? `PRを${inp.value}までにしました` : 'PRを外しました');
    pr.appendChild(save);
    const act = el('button', 'btn btn-sm ' + (p.modHidden ? 'btn-p' : ''), p.modHidden ? '掲載を再開する' : '掲載を止める'); act.type = 'button';
    act.onclick = () => {
      if (p.modHidden) { moderate(p, { modHidden: false }, '掲載を再開しました'); return; }
      const ov = openModal('fx-mod', '掲載を止める', `<p class="fx-mini">「${esc(p.name)}」を一覧・検索・予約から外します。掲載した不動産会社にはお知らせが届きます。</p>
        <textarea class="finput" id="fx-mod-reason" rows="3" maxlength="200" placeholder="理由（例：写真が物件と違う）"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn btn-sm" onclick="fxCloseModal('fx-mod')">やめる</button><button class="btn btn-sm btn-red" id="fx-mod-go">掲載を止める</button></div>`, { width: 460 });
      setTimeout(() => { const go = $('fx-mod-go'); if (go) go.onclick = () => { const r = ($('fx-mod-reason') || {}).value || ''; fxCloseModal('fx-mod'); moderate(p, { modHidden: true, modNote: r }, '掲載を止めました'); }; }, 0);
      void ov;
    };
    row.appendChild(info); row.appendChild(pr); row.appendChild(act);
    list.appendChild(row);
  });
}
let fxModQ = '', fxModT = 0, fxSeedPref = '全国（ランダム）';
const SAMPLE_PREF_OPTS = ['全国（ランダム）', '首都圏', '関西', '東京都', '神奈川県', '埼玉県', '千葉県', '大阪府', '京都府', '兵庫県', '愛知県', '福岡県', '北海道', '宮城県', '広島県'];
async function seedSamples(n, pref) {
  const btn = $('fx-seed-go'); if (btn) { btn.disabled = true; btn.textContent = '作成中…'; }
  try {
    const r = await api('seedSamples', { body: { count: n, prefs: pref && pref !== '全国（ランダム）' ? pref : '全国' } });
    toast(`サンプル物件を${r.added}件追加しました（${pref || '全国'}）`, 'success');
    await fetchAndRenderProps();
  } catch (e) { toast('追加できませんでした: ' + e.message, 'error'); }
  renderModeration();
}
async function clearSamples(n) {
  if (!confirm(`サンプル物件（${n}件）を全部消しますか？\n不動産会社が登録した物件は消えません。`)) return;
  try {
    const r = await api('clearSamples', { body: {} });
    toast(`サンプル物件を${r.deleted}件消しました`, 'info');
    await fetchAndRenderProps();
  } catch (e) { toast('消せませんでした: ' + e.message, 'error'); }
  renderModeration();
}
async function moderate(p, change, msg) {
  try {
    const r = await api('moderateProp', { body: Object.assign({ id: p.id }, change) });
    Object.assign(p, { modHidden: !!r.prop.modHidden, modNote: r.prop.modNote || '', featuredUntil: r.prop.featuredUntil || '' });
    if (!r.prop.featuredUntil) delete p.featuredUntil;
    toast(msg, 'success');
    renderModeration(); renderCards(); updateResultsCount();
  } catch (e) { toast('できませんでした: ' + e.message, 'error'); }
}
const _switchMaster = window.switchMaster;
window.switchMaster = function (id) { const r = _switchMaster.apply(this, arguments); if (id === 'listings') renderModeration(); return r; };
// 管理者（不動産会社）向け: 運営に掲載を止められている物件のお知らせ
function modNotice() {
  const host = $('admin-props'); if (!host || !currentUser) return;
  let box = $('fx-mod-notice');
  const mine = PROPS.filter(p => p.modHidden && canEdit(p));
  if (!mine.length) { if (box) box.remove(); return; }
  if (!box) { box = el('div', 'fx-mod-notice'); box.id = 'fx-mod-notice'; host.insertBefore(box, host.firstChild); }
  box.innerHTML = '';
  box.appendChild(el('b', '', '運営が掲載を止めている物件があります'));
  mine.forEach(p => box.appendChild(el('div', 'fx-mini fx-noi18n', `・${p.name}${p.modNote ? '（理由：' + p.modNote + '）' : ''}　内容を直したら、お問い合わせから運営に連絡してください。`)));
}
const _renderAdminPropTable = window.renderAdminPropTable;
if (typeof _renderAdminPropTable === 'function') window.renderAdminPropTable = function () { const r = _renderAdminPropTable.apply(this, arguments); try { modNotice(); } catch (e) {} return r; };

/* ══════════════ 31. 物件の詳細画面でお気に入り ══════════════ */
function pdFavSync() {
  const b = $('pd-fav-btn'); if (!b || typeof pdCurrentId === 'undefined') return;
  const on = !!(isLoggedIn && favs && favs.has(pdCurrentId));
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  const sp = b.querySelector('span'); if (sp) sp.textContent = on ? t('お気に入り済み') : t('お気に入りに追加');
  b.title = on ? t('もう一度押すとお気に入りから外します') : '';
  const ic = b.querySelector('i'); if (ic) ic.className = 'ti ti-heart';
}
const _toggleFavPd = window.toggleFav;
window.toggleFav = function (id, el) {
  const before = isLoggedIn && favs.has(id);
  const r = _toggleFavPd.apply(this, arguments);
  pdFavSync();
  if (isLoggedIn && typeof pdCurrentId !== 'undefined' && id === pdCurrentId && document.getElementById('pd-overlay').classList.contains('show'))
    toast(before ? t('お気に入りから外しました') : t('お気に入りに追加しました'), before ? 'info' : 'success');
  return r;
};
const _renderPropDetailFav = window.renderPropDetail;
window.renderPropDetail = function () { const r = _renderPropDetailFav.apply(this, arguments); try { pdFavSync(); } catch (e) {} return r; };

/* ══════════════ 32. 間取り図のサムネイル（写真がない物件のカード・詳細に出す）══════════════ */
function fpColor(n) {
  n = String(n || '');
  if (/LDK|DK|^K$|リビング|ダイニング|キッチン/.test(n)) return '#D9F2E6';
  if (/和室/.test(n)) return '#FBEBC8';
  if (/浴室|洗面|トイレ|ユニット|バス/.test(n)) return '#E2E8F0';
  if (/玄関|廊下|収納|納戸|WIC|クローゼット/.test(n)) return '#F4F1EA';
  return '#DCE9F8';
}
function fpSvg(mini, opts) {
  if (!Array.isArray(mini) || !mini.length) return '';
  opts = opts || {};
  const shapes = mini.map(r => {
    if (r.p) { const pts = []; for (let i = 0; i + 1 < r.p.length; i += 2) pts.push([+r.p[i], +r.p[i + 1]]); return { n: r.n, pts }; }
    const [x, y, w, h] = (r.r || []).map(Number); return { n: r.n, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
  }).filter(s => s.pts.length >= 3 && s.pts.every(p => isFinite(p[0]) && isFinite(p[1])));
  if (!shapes.length) return '';
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  shapes.forEach(s => s.pts.forEach(([x, y]) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }));
  const W = Math.max(1, x2 - x1), H = Math.max(1, y2 - y1), pad = Math.max(W, H) * 0.06;
  const sw = Math.max(W, H) / 160, fs = Math.max(W, H) / (opts.big ? 26 : 16);
  const body = shapes.map(s => {
    const d = s.pts.map(([x, y]) => `${x},${y}`).join(' ');
    let cx = 0, cy = 0; s.pts.forEach(([x, y]) => { cx += x; cy += y; }); cx /= s.pts.length; cy /= s.pts.length;
    const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
    const rw = Math.max(...xs) - Math.min(...xs), rh = Math.max(...ys) - Math.min(...ys);
    const label = s.n && rw > fs * Math.min(5, s.n.length) * 0.9 && rh > fs * 1.4
      ? `<text x="${cx}" y="${cy}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="#334155" font-weight="700">${esc(s.n)}</text>` : '';
    return `<polygon points="${d}" fill="${fpColor(s.n)}" stroke="#334155" stroke-width="${sw}" stroke-linejoin="round"/>${label}`;
  }).join('');
  return `<svg class="fx-fp-svg" viewBox="${x1 - pad} ${y1 - pad} ${W + pad * 2} ${H + pad * 2}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t('間取り図'))}">${body}</svg>`;
}
window.fxFpSvg = fpSvg;
function fpThumbs() {
  document.querySelectorAll('#card-grid .prop-card').forEach(card => {
    const fb = card.querySelector('.fav-btn'); const img = card.querySelector('.prop-img');
    if (!fb || !img || img.classList.contains('has-fp') || !img.querySelector('.prop-img-placeholder')) return;
    const p = findProp(+fb.dataset.propId); if (!p || !p.fpMini) return;
    const svg = fpSvg(p.fpMini); if (!svg) return;
    img.classList.add('has-fp');
    img.insertAdjacentHTML('afterbegin', `<div class="fx-fp-thumb">${svg}</div>`);
  });
}
const _renderCardsFp = window.renderCards;
window.renderCards = function () { const r = _renderCardsFp.apply(this, arguments); try { fpThumbs(); } catch (e) {} return r; };
const _renderPropDetailFp = window.renderPropDetail;
window.renderPropDetail = function (prop) {
  const r = _renderPropDetailFp.apply(this, arguments);
  try {
    if (prop && !(prop.photoURLs || []).length && prop.fpMini) {
      const svg = fpSvg(prop.fpMini, { big: true });
      if (svg) $('pd-slider').innerHTML = `<div class="fx-fp-hero">${svg}<span class="fx-fp-cap"><i class="ti ti-layout-2"></i> ${t('間取り図（イメージ）')}</span>${prop.floorplanData || prop.splatURL ? `<button type="button" class="fx-fp-vr" onclick="viewInVR(${+prop.id})"><i class="ti ti-vr"></i> ${t('VRで中を歩く')}</button>` : ''}</div>`;
    }
  } catch (e) {}
  return r;
};

/* ══════════════ 33. 物件フォームを使いやすく ══════════════
   ・項目を「基本 → 場所 → お金 → 設備と説明 → 写真とVR → 公開と内見 → 詳細」に分けて、上のボタンで移動できる
   ・必須項目のチェック、入力の充実度、費用の目安、説明文と間取りの自動作成、下書きの自動保存、二重登録の注意 */
function fpMiniFrom(fp) {
  return ((fp && fp.rooms) || []).map(r => Array.isArray(r.vertices) && r.vertices.length >= 3
    ? { n: r.name, p: r.vertices.flatMap(v => [+v.x || 0, +v.y || 0]) }
    : { n: r.name, r: [+r.wx || 0, +r.wy || 0, +r.ww || 0, +r.wh || 0] });
}
function svgDataURL(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')); }
const _applyFpThumb = window._applyFloorplanThumbnail;
window._applyFloorplanThumbnail = function () {
  const r = typeof _applyFpThumb === 'function' ? _applyFpThumb.apply(this, arguments) : undefined;
  const img = $('fp-thumb-img');
  if (img && window.editedFloorplanData && !window.editedFloorplanThumb) {
    const svg = fpSvg(fpMiniFrom(window.editedFloorplanData), { big: true });
    if (svg) img.src = svgDataURL(svg);
  }
  afScore();
  return r;
};
const AF_SECTIONS = [
  ['basic', '基本の情報', ['af-name', 'af-madori', 'af-size', 'af-type', 'af-structure', 'af-age', 'af-floor-no']],
  ['place', '場所', ['af-address', 'af-area', 'af-station', 'af-walk-min', 'af-access']],
  ['money', 'お金', ['af-rent', 'af-mgmt', 'af-deposit', 'af-key', 'af-cost']],
  ['feat', '設備と説明', ['af-feat-field', 'af-desc']],
  ['media', '写真とVR', ['af-photo', 'af-fp-field', 'af-splat', 'af-pano-field']],
  ['pub', '公開と内見', ['af-pr-field', 'fx-af-extra']],
  ['more', 'くわしい情報（任意）', ['af-available']]
];
let afDirty = false, afSaving = false, afDraftT = 0;
function afField(id) {   // その入力欄が入っている、いちばん外側の項目
  let e = $(id);
  while (e && e.parentNode && !(e.parentNode.matches && e.parentNode.matches('#add-form .add-form-inner > .add-form-grid'))) e = e.parentNode;
  return e && e.parentNode ? e : null;
}
function initFormUX() {
  const grid = document.querySelector('#add-form .add-form-inner > .add-form-grid'); if (!grid || $('af-secnav')) return;
  // 費用の目安
  const money = afField('af-key');
  const cost = el('div', 'field'); cost.id = 'af-cost'; cost.style.gridColumn = '1/-1';
  cost.innerHTML = '<div class="fx-af-cost" id="af-cost-box"></div>';
  money.parentNode.insertBefore(cost, money.nextSibling);
  // 設備（「公開と内見」の箱から出して、独立した項目にする）
  const fb = $('af-features-box');
  if (fb) {
    const f = el('div', 'field'); f.id = 'af-feat-field'; f.style.gridColumn = '1/-1';
    const lab = fb.previousElementSibling; if (lab) { lab.style.marginTop = '0'; f.appendChild(lab); }
    f.appendChild(fb);
    const pr = $('af-pr-box'), prf = el('div', 'field'); prf.id = 'af-pr-field'; prf.style.gridColumn = '1/-1';
    if (pr) { const pl = pr.previousElementSibling; if (pl) { pl.style.marginTop = '0'; prf.appendChild(pl); } prf.appendChild(pr); const pn = $('af-pr-note'); if (pn) prf.appendChild(pn); }
    grid.appendChild(f); grid.appendChild(prf);
  }
  // 360°写真は「写真とVR」へ
  const pano = $('af-pano');
  if (pano) {
    const f = el('div', 'field'); f.id = 'af-pano-field'; f.style.gridColumn = '1/-1';
    const lab = pano.previousElementSibling; if (lab) { lab.style.marginTop = '0'; f.appendChild(lab); }
    f.appendChild(pano); const pl = $('af-pano-list'); if (pl) f.appendChild(pl);
    grid.appendChild(f);
  }
  const fpb = document.querySelector('#add-form [onclick="openFloorEditor()"]');
  if (fpb) { const f = fpb.closest('.field'); f.id = 'af-fp-field'; }
  // 説明文の自動作成・間取りの自動作成ボタン
  const desc = $('af-desc');
  if (desc) desc.closest('.field').querySelector('.flabel').insertAdjacentHTML('beforeend', ' <button type="button" class="btn btn-sm fx-af-mini" id="af-desc-gen"><i class="ti ti-sparkles"></i> 入力した内容から説明文を作る</button>');
  if (fpb) fpb.insertAdjacentHTML('afterend', ' <button type="button" class="btn btn-sm btn-p" id="af-fp-gen"><i class="ti ti-wand"></i> 間取りを自動で作る</button><div class="fx-mini" style="margin-top:6px">「間取り」と「面積」から、VR内見できる間取りを自動で作ります。作ったあと「間取りを編集する」で直せます。押すたびに別の形になります。</div>');
  // 項目を区切りごとに並べ直す
  AF_SECTIONS.forEach(([key, title, ids], i) => {
    const h = el('div', 'fx-af-sec'); h.id = 'af-sec-' + key;
    h.innerHTML = `<span class="fx-af-num">${i + 1}</span>${title}`;
    grid.appendChild(h);
    ids.forEach(id => { const f = afField(id); if (f && f.parentNode === grid) grid.appendChild(f); });
  });
  // 上の案内（区切りへ移動・充実度）
  const head = document.querySelector('#add-form .add-form-head');
  const nav = el('div', 'fx-af-nav'); nav.id = 'af-secnav';
  nav.innerHTML = `<div class="fx-af-chips">${AF_SECTIONS.map(([k, tt], i) => `<button type="button" data-sec="${k}">${i + 1}. ${tt.replace('（任意）', '')}</button>`).join('')}</div>
    <div class="fx-af-score"><div class="fx-af-bar"><i id="af-score-bar"></i></div><span id="af-score-text"></span></div>
    <div class="fx-af-todo" id="af-todo"></div>
    <div class="fx-af-draft" id="af-draft" hidden></div>`;
  head.parentNode.insertBefore(nav, head.nextSibling);
  nav.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { const t = $('af-sec-' + b.dataset.sec); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  // 入力に合わせて更新
  const form = $('add-form');
  form.addEventListener('input', e => { afDirty = true; if (e.target.closest('.fx-invalid')) e.target.closest('.fx-invalid').classList.remove('fx-invalid'); afCost(); afScore(); afDraftSave(); });
  form.addEventListener('change', e => { if (e.target.type === 'file') setTimeout(afScore, 900); });
  form.addEventListener('click', e => { if (e.target.closest('[data-f], #af-features-box, #af-wdays, [data-d]')) setTimeout(() => { afDirty = true; afScore(); afDraftSave(); }, 0); });
  $('af-madori').addEventListener('blur', () => { const v = afNormMadori($('af-madori').value); if (v !== $('af-madori').value) { $('af-madori').value = v; afScore(); } });
  $('af-address').addEventListener('blur', afAreaFromAddress);
  $('af-desc-gen').onclick = afGenDesc;
  if ($('af-fp-gen')) $('af-fp-gen').onclick = afGenFloorplan;
  afCost(); afScore();
}
function afNormMadori(v) {
  v = String(v || '').normalize('NFKC').toUpperCase().replace(/\s+/g, '').replace(/ＬＤＫ/g, 'LDK');
  const m = v.match(/^([1-9])(S?LDK|S?DK|S?K|R)(\+S)?$/);
  return m ? m[1] + m[2] + (m[3] || '') : v;
}
function afAreaFromAddress() {
  const ar = $('af-area'), ad = $('af-address'); if (!ar || !ad || ar.value.trim()) return;
  const m = ad.value.normalize('NFKC').trim().match(/^(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)?((?:[^\s\d]{1,5}?市)?[^\s\d]{1,5}?[区市町村])/);
  if (m) { ar.value = m[1]; afScore(); }
}
function afNum(id) { return +(($(id) || {}).value || 0) || 0; }
function afCost() {
  const box = $('af-cost-box'); if (!box) return;
  const rent = afNum('af-rent'), mg = afNum('af-mgmt');
  if (!rent) { box.innerHTML = '<span class="fx-mini">家賃を入れると、毎月の支払いと初期費用の目安が出ます</span>'; return; }
  const dep = afNum('af-deposit') * rent, key = afNum('af-key') * rent;
  const first = dep + key + rent + mg + Math.round(rent * 1.1);    // 敷金＋礼金＋前家賃（1か月）＋仲介手数料（1か月＋税）
  box.innerHTML = `<b>${(rent / 10000).toFixed(rent % 1000 ? 2 : 1).replace(/\.?0+$/, '')}万円</b>・毎月 <b>${yen(rent + mg)}</b>（家賃＋管理費）・初期費用の目安 <b>${yen(first)}</b><span class="fx-mini">（敷金・礼金・前家賃1か月・仲介手数料1か月分で計算。お客さんの画面の「費用シミュレーション」と同じ考え方です）</span>`;
}
function afChecks() {
  const v = id => (($(id) || {}).value || '').trim();
  const photos = ((typeof editingExistingPhotos !== 'undefined' ? editingExistingPhotos : []) || []).length + ((typeof _newPhotoQueue !== 'undefined' ? _newPhotoQueue : []) || []).length;
  const feats = document.querySelectorAll('#af-features-box .on, #af-features-box button.fx-on').length;
  return [
    ['必須', v('af-name') && v('af-address') && v('af-area') && afNum('af-rent') > 0 && /^[1-9](S?LDK|S?DK|S?K|R)/.test(afNormMadori(v('af-madori'))), '必須の項目（物件名・住所・エリア・家賃・間取り）', 'basic', 30],
    ['写真', photos > 0, '写真（1枚目が一覧に出ます）', 'media', 15],
    ['VR', !!(window.editedFloorplanData || window.editedSplat), '間取り（VR内見できるようになります）', 'media', 20],
    ['説明', v('af-desc').length >= 40, '物件説明（40文字以上）', 'feat', 10],
    ['設備', feats >= 3, '設備・条件（3つ以上）', 'feat', 10],
    ['駅', v('af-station') && afNum('af-walk-min') > 0, '最寄り駅と徒歩分', 'place', 10],
    ['面積', afNum('af-size') > 0 && afNum('af-age') >= 0 && v('af-size'), '面積', 'basic', 5]
  ];
}
function afScore() {
  const bar = $('af-score-bar'); if (!bar) return;
  const cs = afChecks();
  const sc = cs.reduce((a, c) => a + (c[1] ? c[4] : 0), 0);
  bar.style.width = sc + '%';
  bar.style.background = sc >= 80 ? 'var(--teal,#1A7F72)' : sc >= 50 ? '#F59E0B' : 'var(--coral,#E8604A)';
  $('af-score-text').textContent = `掲載の充実度 ${sc}%`;
  const todo = cs.filter(c => !c[1]);
  $('af-todo').innerHTML = todo.length ? 'あと少し：' + todo.map(c => `<button type="button" data-sec="${c[3]}">${c[2]}</button>`).join('') : '<span class="fx-af-ok"><i class="ti ti-circle-check"></i> 必要な情報がそろっています</span>';
  $('af-todo').querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { const t = $('af-sec-' + b.dataset.sec); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}
function afGenDesc() {
  const v = id => (($(id) || {}).value || '').trim();
  const feats = [...document.querySelectorAll('#af-features-box .on, #af-features-box button.fx-on')].map(b => b.textContent.trim()).filter(Boolean);
  const st = v('af-station'), wk = afNum('af-walk-min'), md = afNormMadori(v('af-madori')), sz = afNum('af-size'), age = v('af-age'), type = v('af-type'), str = ($('af-structure') || {}).value || '';
  const fl = afNum('af-floor-no'), fls = afNum('af-floors');
  const parts = [];
  if (st) parts.push(`${st}駅から徒歩${wk || '−'}分。`);
  parts.push(`${age === '' ? '' : (+age === 0 ? '新築の' : `築${age}年の`)}${str && str !== 'その他' ? str + (/造$/.test(str) ? '' : '造') + 'の' : ''}${type || '物件'}${fl ? `（${fls ? fls + '階建ての' : ''}${fl}階）` : ''}です。`);
  if (md) parts.push(`間取りは${md}${sz ? `（${sz}㎡）` : ''}。${/^1(R|K)/.test(md) ? 'ひとり暮らしにちょうどいい広さです。' : /^1(DK|LDK)/.test(md) ? 'ひとり暮らしでゆったり、ふたり暮らしにも。' : /^2/.test(md) ? 'ふたり暮らしや小さなお子さまのいるご家族に。' : 'ご家族でゆったり暮らせます。'}`);
  if (feats.length) parts.push(`${feats.slice(0, 5).join('・')}${feats.length > 5 ? 'など' : ''}がそろっています。`);
  if (window.editedFloorplanData || window.editedSplat) parts.push('VR内見で、お部屋の中を歩いて広さや日当たりを確かめられます。');
  const d = $('af-desc');
  if (d.value.trim() && !confirm('いまの物件説明を、自動で作った文に置きかえますか？')) return;
  d.value = parts.join('');
  afDirty = true; afScore(); afDraftSave();
  toast('説明文を作りました。自由に書き足してください', 'success');
}
async function afGenFloorplan() {
  const md = afNormMadori(($('af-madori') || {}).value);
  if (!/^[1-9](S?LDK|S?DK|S?K|R)/.test(md)) { afMark(['af-madori'], '先に「間取り」を入れてください（例：1K、2LDK）'); return; }
  if (window.editedFloorplanData && !confirm('いまの間取りを、自動で作った間取りに置きかえますか？')) return;
  const b = $('af-fp-gen'); b.disabled = true; b.innerHTML = '<i class="ti ti-loader-2"></i> 作っています…';
  try {
    const r = await api('genFloorplan', { body: { madori: md, size: afNum('af-size') } });
    window.editedFloorplanData = r.floorplanData; window.editedFloorplanThumb = null;
    if (!afNum('af-size')) $('af-size').value = r.size;
    window._applyFloorplanThumbnail();
    const info = $('fp-thumb-info'); if (info) info.textContent = `${r.madori}・約${r.size}㎡（${r.rooms}）`;
    afDirty = true; afScore(); afDraftSave();
    toast('間取りを作りました。保存するとVR内見できます', 'success');
  } catch (e) { toast('作れませんでした: ' + e.message, 'error'); }
  b.disabled = false; b.innerHTML = '<i class="ti ti-wand"></i> 間取りを自動で作る';
}
function afMark(ids, msg) {
  ids.forEach(id => { const f = afField(id) || ($(id) && $(id).closest('.field')); if (f) f.classList.add('fx-invalid'); });
  const first = $(ids[0]);
  if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (e) {} }, 300); }
  toast(msg, 'warn');
}
function afValidate() {
  document.querySelectorAll('#add-form .fx-invalid').forEach(f => f.classList.remove('fx-invalid'));
  afAreaFromAddress();
  const md = $('af-madori'); md.value = afNormMadori(md.value);
  const v = id => (($(id) || {}).value || '').trim();
  const bad = [];
  if (!v('af-name')) bad.push(['af-name', '物件名']);
  if (!v('af-address')) bad.push(['af-address', '住所']);
  if (!v('af-area')) bad.push(['af-area', 'エリア']);
  if (!(afNum('af-rent') > 0)) bad.push(['af-rent', '家賃']);
  if (!/^[1-9](S?LDK|S?DK|S?K|R)/.test(md.value)) bad.push(['af-madori', '間取り（例：1K、2LDK）']);
  if (bad.length) { afMark(bad.map(b => b[0]), '入力してください：' + bad.map(b => b[1]).join('・')); return false; }
  const warn = [];
  if (afNum('af-rent') < 10000) warn.push(`家賃が ${yen(afNum('af-rent'))} になっています（円で入れてください）`);
  if (afNum('af-size') > 300) warn.push(`面積が ${afNum('af-size')}㎡ になっています`);
  if (afNum('af-mgmt') > afNum('af-rent')) warn.push('管理費が家賃より高くなっています');
  if (afNum('af-floor-no') && afNum('af-floors') && afNum('af-floor-no') > afNum('af-floors')) warn.push('所在階が建物の階数より上になっています');
  if (typeof editingPropId === 'undefined' || editingPropId == null) {
    const n = v('af-name').normalize('NFKC'), a = v('af-address').normalize('NFKC').replace(/\s/g, '');
    const dup = PROPS.find(p => String(p.name || '').normalize('NFKC') === n && String(p.address || '').normalize('NFKC').replace(/\s/g, '') === a);
    if (dup) warn.push(`同じ名前・住所の物件「${dup.name}」がすでにあります（二重登録かもしれません）`);
  }
  if (warn.length && !confirm(warn.join('\n') + '\n\nこのまま保存しますか？')) return false;
  return true;
}
const _addPropertyUX = window.addProperty;
window.addProperty = async function () {
  if (afSaving) return;
  if (!afValidate()) return;
  afSaving = true;
  const btn = $('af-submit-btn'), html = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i> 保存しています…'; }
  try { return await _addPropertyUX.apply(this, arguments); }
  finally { afSaving = false; afDirty = false; if (btn) { btn.disabled = false; btn.innerHTML = html; } }
};
// 下書き（新しく登録するときだけ。この端末に保存）
const AF_DRAFT_IDS = ['af-name', 'af-address', 'af-area', 'af-station', 'af-walk-min', 'af-rent', 'af-mgmt', 'af-deposit', 'af-key', 'af-madori', 'af-size', 'af-type', 'af-structure', 'af-age', 'af-floor-no', 'af-floors', 'af-access', 'af-desc',
  'af-available', 'af-transaction', 'af-units', 'af-parking', 'af-contract', 'af-renewal', 'af-guarantor', 'af-conditions', 'af-insurance', 'af-otherfees', 'af-surroundings'];
function afDraftKey() { return 'vr_af_draft_' + (currentUser ? currentUser.email : ''); }
function afDraftSave() {
  if (typeof editingPropId !== 'undefined' && editingPropId != null) return;
  clearTimeout(afDraftT);
  afDraftT = setTimeout(() => {
    const d = {}; AF_DRAFT_IDS.forEach(id => { const e = $(id); if (e && e.value) d[id] = e.value; });
    if (!Object.keys(d).length) return;
    const extra = { feats: (fxForm.features || []).slice(), fp: window.editedFloorplanData || null };
    try { localStorage.setItem(afDraftKey(), JSON.stringify({ t: Date.now(), d, extra })); }
    catch (e) { try { localStorage.setItem(afDraftKey(), JSON.stringify({ t: Date.now(), d, extra: { feats: extra.feats } })); } catch (e2) {} }
  }, 600);
}
function afDraftClear() { clearTimeout(afDraftT); try { localStorage.removeItem(afDraftKey()); } catch (e) {} const b = $('af-draft'); if (b) b.hidden = true; }
function afDraftOffer() {
  const box = $('af-draft'); if (!box) return;
  let dr = null; try { dr = JSON.parse(localStorage.getItem(afDraftKey()) || 'null'); } catch (e) {}
  const empty = AF_DRAFT_IDS.every(id => !(($(id) || {}).value || '').trim() || ['af-type', 'af-structure'].includes(id));
  if (!dr || !dr.d || !empty) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<i class="ti ti-file-text"></i> 前に入力していた下書き（${new Date(dr.t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・${esc(dr.d['af-name'] || '名前なし')}）があります <button type="button" class="btn btn-sm btn-p" id="af-draft-yes">つづきから入力</button><button type="button" class="btn btn-sm" id="af-draft-no">消す</button>`;
  $('af-draft-yes').onclick = () => {
    Object.entries(dr.d).forEach(([id, v]) => { const e = $(id); if (e) e.value = v; });
    const x = dr.extra || {};
    if (Array.isArray(x.feats)) { fxForm.features = x.feats.slice(); renderFormExtras2(); }
    if (x.fp && x.fp.rooms) { window.editedFloorplanData = x.fp; window.editedFloorplanThumb = null; window._applyFloorplanThumbnail(); }
    box.hidden = true; afCost(); afScore();
    toast('下書きを戻しました（写真は選び直してください）', 'info');
  };
  $('af-draft-no').onclick = afDraftClear;
}
const _clearAddUX = window.clearAddForm;
window.clearAddForm = function () { const r = _clearAddUX.apply(this, arguments); if (typeof editingPropId === 'undefined' || editingPropId == null) afDraftClear(); afDirty = false; setTimeout(() => { afCost(); afScore(); }, 0); return r; };
const _toggleAddUX = window.toggleAddForm;
window.toggleAddForm = function () {
  const f = $('add-form'), open = f && f.classList.contains('show');
  if (open && afDirty && typeof editingPropId !== 'undefined' && editingPropId != null && !afSaving && !confirm('保存していない変更があります。閉じてもいいですか？')) return;
  const r = _toggleAddUX.apply(this, arguments);
  if (!open) { afDirty = false; document.querySelectorAll('#add-form .fx-invalid').forEach(x => x.classList.remove('fx-invalid')); setTimeout(() => { afCost(); afScore(); if (typeof editingPropId === 'undefined' || editingPropId == null) afDraftOffer(); else { const b = $('af-draft'); if (b) b.hidden = true; } }, 0); }
  return r;
};
const _startEditUX = window.startEditProp;
window.startEditProp = async function () { const r = await _startEditUX.apply(this, arguments); afDirty = false; setTimeout(() => { afCost(); afScore(); const b = $('af-draft'); if (b) b.hidden = true; }, 50); return r; };

/* ══════════════ 起動 ══════════════ */
function boot() {
  addNavButtons(); addListControls(); addFormExtras(); addCommuteUI(); addCsvButton(); addDeleteAccount(); addPhotoBulkDelete(); a11yStatic(); fitStickyNav(); heLogos(); initHero(); initChips(); initAsk(); ykcBuild(); initMapView(); addHeroMascot(); addGateMascot(); addFormExtras2(); addExportButtons(); loadServerFieldDefs(); initFormUX();
  const help = $('s-help');
  if (help && !$('fx-help-links')) help.insertAdjacentHTML('beforeend', '<div id="fx-help-links" style="text-align:center;font-size:12px;padding:18px 0 90px;color:#94a3b8"><a href="terms.html" target="_blank">利用規約</a>　・　<a href="privacy.html" target="_blank">個人情報の取り扱い</a>　・　<a href="help.html" target="_blank">使い方ガイド</a></div>');
  setGuestClass();
  document.documentElement.lang = fxLang;
  if (fxLang === 'en') translateAll();
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  const iv = setInterval(() => {
    if (!isLoggedIn) return;
    refreshNotif(); renderCompareBar(); decorateCards();
    clearInterval(iv);
  }, 500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

const _enterApp = window._enterApp;
window._enterApp = function () {
  const r = _enterApp.apply(this, arguments);
  setGuestClass();
  const fn = afterLogin; afterLogin = null;
  setTimeout(() => { lastNotifyCount = -1; refreshNotif(); renderCompareBar(); decorateCards(); decorateCardsMore(); if (fn) { try { fn(); } catch (e) { console.error(e); } } }, 400);
  return r;
};
// ログインする前（ゲスト）につけた内見チェックは、ログインしたらアカウントに引き継ぐ
const _enterApp2 = window._enterApp;
window._enterApp = function () {
  const r = _enterApp2.apply(this, arguments);
  // 不動産会社・運営は、非公開や運営が止めた自分の物件も一覧に出したいので読み直す
  try { if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'master') && typeof fetchAndRenderProps === 'function') fetchAndRenderProps(); } catch (e) {}
  try {
    const guest = JSON.parse(sessionStorage.getItem(CHECK_SS) || '{}') || {};
    if (Object.keys(guest).length && currentUser) {
      currentUser.myChecks = Object.assign({}, currentUser.myChecks || {}, guest);
      sessionStorage.removeItem(CHECK_SS);
      setTimeout(() => { if (isLoggedIn && currentUser) saveUserToAWS(currentUser); }, 800);
    }
  } catch (e) {}
  return r;
};
const _doLogout = window.doLogout;
window.doLogout = function () {
  stopLive(true);
  clearTimeout(furnTimer);
  if (isLoggedIn && currentUser && currentUser.myFurniture) saveUserToAWS(currentUser);   // まだ送っていない家具を保存してから
  const r = _doLogout.apply(this, arguments);
  ['nav-admin-btn', 'tab-admin', 'tab-master'].forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
  try { sessionStorage.clear(); } catch (e) {}
  setGuestClass(); renderCards(); renderCompareBar();
  try { renderContactSender(); } catch (e) {}
  try { if (PROPS.some(p => p.modHidden || p.status === 'hidden') && typeof fetchAndRenderProps === 'function') fetchAndRenderProps(); } catch (e) {}
  return r;
};
})();
