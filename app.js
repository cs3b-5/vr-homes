/* ══════════════════════════════════════
   STATE & CONSTANTS
══════════════════════════════════════ */
// 管理者・マスターのコードはサーバー(Lambdaの環境変数)だけが知っている。ここには書かない
const AWS_API_URL  = 'https://h5mx5gy6l2y7v6k46kxxfsm4li0cxnpr.lambda-url.ap-northeast-3.on.aws/';

/* ── ログイン通行証(サーバーが発行する署名つきトークン) ── */
const TOKEN_KEY = 'vr_session_token';
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY)||''; }catch(e){ return ''; } }
function setToken(t){ try{ if(t) localStorage.setItem(TOKEN_KEY,t); else localStorage.removeItem(TOKEN_KEY); }catch(e){} }
/* AWS への通信には自動で通行証を付ける */
(function(){
  const _fetch=window.fetch.bind(window);
  window.fetch=function(input, init){
    const url=typeof input==='string'?input:((input&&input.url)||'');
    const token=getToken();
    if(token && url.indexOf(AWS_API_URL)===0){
      init=Object.assign({}, init||{});
      const h=new Headers(init.headers||{});
      h.set('Authorization','Bearer '+token);
      init.headers=h;
    }
    return _fetch(input, init);
  };
})();
const EDITOR_PATH  = 'floor-editor.html';

let isLoggedIn  = false;
let currentUser = null;

/* ── デモ物件データ ── */
const DEMO_PROPS = [];   // サーバーにつながらないときに見本の物件を出すのはやめた（本物と見分けがつかないため）

/* ── マスター管理の物件条件フィールド（localStorageで永続化） ── */
const DEFAULT_FIELD_DEFS = {
  types: ['マンション','アパート','一戸建て','テラスハウス','タワーマンション','ヴィラ・邸宅','シェアハウス','学生寮','店舗・事務所'],
  features: ['オートロック','バス・トイレ別','エアコン','インターネット無料','浴室乾燥機','宅配ボックス','南向き',
             'ペット可','独立洗面台','室内洗濯機置場','システムキッチン','食洗機','IHコンロ','ウォークインクローゼット',
             '駐車場','駐輪場','即入居可','DIY可','家具・家電付き','リノベーション済み','フリーレント','保証人不要',
             '二人暮らし可','子供可','学生向け','女性限定','敷金なし','礼金なし'],
  madori: ['1K','1DK','1LDK','2K','2DK','2LDK','3K','3DK','3LDK','4LDK以上'],
};

function loadFieldDefs() {
  try {
    const s = localStorage.getItem('vr_field_defs');
    if (s) return JSON.parse(s);
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_FIELD_DEFS));
}
function saveFieldDefs(defs) {
  localStorage.setItem('vr_field_defs', JSON.stringify(defs));
}
let fieldDefs = loadFieldDefs();

// マスターはサーバー(DynamoDB)に登録されたアカウントでログインする。パスワードはここに書かない
const DEMO_USER  = { name:'デモユーザー', email:'demo@vrhomes.jp', password:'demo1234', role:'user',  active:true, photoURL:null, wishlist:{}, favs:[], history:[] };
const DEMO_ADMIN = { name:'デモ管理者',   email:'admin@vrhomes.jp', password:'admin1234', role:'admin', active:true, photoURL:null, wishlist:{}, favs:[], history:[] };
let userStore = [DEMO_USER, DEMO_ADMIN];

let leafletMap  = null;
let mapMarkers  = {};
let pdMiniMap   = null;
let pdSliderIdx = 0;
let pdCurrentId = null;

let PROPS      = [];
let favs       = new Set();
let nextPropId = 1;
let viewHistory= [];

let filterState = {
  madori:new Set(), types:new Set(), features:new Set(),
  priceMax:null, sizeMin:null, walkMax:null, searchText:'',
};

/* 地方名 → 含まれる都道府県のマッピング（キーワード検索用） */
const REGION_MAP = {
  '北海道':['北海道'],
  '東北':['青森','岩手','宮城','秋田','山形','福島'],
  '関東':['東京','神奈川','埼玉','千葉','茨城','栃木','群馬'],
  '首都圏':['東京','神奈川','埼玉','千葉'],
  '中部':['新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知'],
  '甲信越':['山梨','長野','新潟'],
  '北陸':['富山','石川','福井','新潟'],
  '東海':['愛知','岐阜','三重','静岡'],
  '近畿':['大阪','京都','兵庫','奈良','和歌山','滋賀','三重'],
  '関西':['大阪','京都','兵庫','奈良','和歌山','滋賀'],
  '中国':['鳥取','島根','岡山','広島','山口'],
  '山陰':['鳥取','島根'],
  '山陽':['岡山','広島','山口'],
  '四国':['徳島','香川','愛媛','高知'],
  '九州':['福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島'],
  '九州・沖縄':['福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'],
  '沖縄':['沖縄'],
};

/* 検索キーワードが地方名なら、含まれる都道府県のいずれかにマッチするか判定 */
function matchesRegionOrText(prop, keyword){
  // アクセス欄（複数駅）・詳細も検索対象に含める → 徒歩圏内の駅すべてでヒット
  const d=prop.details||{};
  const hay=[
    prop.name, prop.area, prop.station, prop.address, prop.description,
    prop.access,            // 「あおなみ線/荒子駅 徒歩7分」など複数駅
    d.surroundings,         // 周辺情報
    prop.madori, prop.type
  ].filter(Boolean).join(' ').toLowerCase();
  const kw=keyword.toLowerCase().trim();
  if(!kw) return true;
  // 「駅」を付けても外しても両方ヒットするように
  const kwNoStation=kw.replace(/駅$/,'');
  if(hay.includes(kw)) return true;
  if(kwNoStation && hay.includes(kwNoStation)) return true;
  // 地方名マッチ
  const normalized=keyword.replace(/地方|地区|エリア/g,'').trim();
  for(const region in REGION_MAP){
    if(region.toLowerCase()===kw || region===normalized || region.replace(/・/g,'')===normalized){
      return REGION_MAP[region].some(pref=>hay.includes(pref.toLowerCase()));
    }
  }
  return false;
}

/* ══════════════════════════════════════
   ENTER KEY NAVIGATION
══════════════════════════════════════ */
function handleFormKey(e, nextId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const next = document.getElementById(nextId);
    if (next) { next.focus(); next.select && next.select(); }
  }
}

/* ══════════════════════════════════════
   HERO PARTICLES
══════════════════════════════════════ */
function initParticles() {
  const c = document.getElementById('hero-particles'); if(!c) return;
  const colors = ['rgba(96,165,250,.4)','rgba(167,139,250,.3)','rgba(52,211,153,.3)','rgba(251,191,36,.2)'];
  for(let i=0;i<18;i++){
    const d=document.createElement('div');
    const size = Math.random()*10+4;
    d.className='hero-particle';
    d.style.cssText=`width:${size}px;height:${size}px;background:${colors[i%colors.length]};
      left:${Math.random()*100}%;top:${Math.random()*100}%;
      animation-delay:${Math.random()*6}s;animation-duration:${Math.random()*4+5}s`;
    c.appendChild(d);
  }
}

/* ══════════════════════════════════════
   DYNAMIC FILTER RENDERING
══════════════════════════════════════ */
function buildAdvFilterHTML() {
  const types = fieldDefs.types;
  const features = fieldDefs.features;
  const madoriList = fieldDefs.madori;
  const regions = ['北海道','東北','関東','中部','近畿','中国','四国','九州','沖縄'];
  return `
    <div class="filter-sec">
      <div class="filter-sec-title"><i class="ti ti-map-2" style="font-size:12px"></i> 地方・キーワードから探す</div>
      <div class="filter-range-row" style="margin-bottom:6px">
        <input class="finput" type="text" id="f-adv-keyword" placeholder="地名・駅名・地方名など" style="font-size:12px"
          onkeydown="if(event.key==='Enter')applyKeyword()">
        <button class="btn btn-sm" style="font-size:11px;padding:5px 10px;flex-shrink:0" onclick="applyKeyword()"><i class="ti ti-search"></i></button>
      </div>
      <div class="filter-tag-wrap">
        ${regions.map(r=>`<span class="ftag" onclick="searchByRegion('${r}',this)">${r}</span>`).join('')}
      </div>
    </div>
    <div class="filter-sec">
      <div class="filter-sec-title"><i class="ti ti-cash" style="font-size:12px"></i> 価格・費用</div>
      <div class="filter-range-row">
        <input class="finput" type="number" id="f-adv-price" placeholder="家賃上限(万円)" style="font-size:12px"
          onkeydown="if(event.key==='Enter')applyFilters()">
        <span>万円以下</span>
      </div>
      <div class="filter-tag-wrap" style="margin-top:6px">
        <span class="ftag" onclick="toggleFtag(this,'features','敷金なし')">敷金なし</span>
        <span class="ftag" onclick="toggleFtag(this,'features','礼金なし')">礼金なし</span>
      </div>
    </div>
    <div class="filter-sec">
      <div class="filter-sec-title"><i class="ti ti-layout" style="font-size:12px"></i> 間取り</div>
      <div class="filter-tag-wrap">
        ${madoriList.map(m=>`<span class="ftag" onclick="toggleFtag(this,'madori','${m}')">${m}</span>`).join('')}
      </div>
    </div>
    <div class="filter-sec">
      <div class="filter-sec-title"><i class="ti ti-ruler" style="font-size:12px"></i> 広さ・立地</div>
      <div class="filter-range-row">
        <input class="finput" type="number" id="f-adv-size" placeholder="面積下限(㎡)" style="font-size:12px"
          onkeydown="if(event.key==='Enter')applyFilters()">
        <span>㎡以上</span>
      </div>
      <div class="filter-range-row" style="margin-top:6px">
        <input class="finput" type="number" id="f-adv-walk" placeholder="徒歩(分)" min="1" max="60" style="font-size:12px"
          onkeydown="if(event.key==='Enter')applyFilters()">
        <span>分以内</span>
      </div>
      <div class="filter-tag-wrap" style="margin-top:6px">
        <span class="ftag" onclick="toggleFtag(this,'walkMax','5')">徒歩5分</span>
        <span class="ftag" onclick="toggleFtag(this,'walkMax','10')">徒歩10分</span>
        <span class="ftag" onclick="toggleFtag(this,'walkMax','15')">徒歩15分</span>
      </div>
    </div>
    <div class="filter-sec">
      <div class="filter-sec-title"><i class="ti ti-building" style="font-size:12px"></i> 物件種別</div>
      <div class="filter-tag-wrap">
        ${types.map(t=>`<span class="ftag" onclick="toggleFtag(this,'types','${t}')">${t}</span>`).join('')}
      </div>
    </div>
    <div class="filter-sec">
      <div class="filter-sec-title"><i class="ti ti-home-2" style="font-size:12px"></i> 設備・条件</div>
      <div class="filter-tag-wrap">
        ${features.map(f=>`<span class="ftag" onclick="toggleFtag(this,'features','${f}')">${f}</span>`).join('')}
      </div>
    </div>`;
}

function buildMapFilterHTML() {
  const types = fieldDefs.types;
  const features = fieldDefs.features;
  const madoriList = fieldDefs.madori;
  return `
    <details class="map-filter-details" open>
      <summary>価格・費用</summary>
      <div class="ftag-wrap">
        <input class="finput" type="number" id="f-map-price" placeholder="家賃上限(万円)" style="font-size:11px;padding:5px 8px;margin-bottom:6px;width:100%"
          onkeydown="if(event.key==='Enter')applyMapFilters()">
        <span class="ftag" onclick="toggleFtag(this,'features','敷金なし')">敷金なし</span>
        <span class="ftag" onclick="toggleFtag(this,'features','礼金なし')">礼金なし</span>
      </div>
    </details>
    <details class="map-filter-details">
      <summary>間取り</summary>
      <div class="ftag-wrap">
        <div style="display:flex;gap:5px;margin-bottom:7px;width:100%">
          <input class="finput" id="f-map-madori-text" placeholder="自由入力(例:3LDK+S)" style="font-size:11px;padding:5px 8px;flex:1"
            onkeydown="if(event.key==='Enter'){applyMapFilters();}">
          <button class="btn btn-sm" style="font-size:10px;padding:4px 8px;flex-shrink:0" onclick="applyMapMadoriText()">追加</button>
        </div>
        ${madoriList.map(m=>`<span class="ftag" onclick="toggleFtag(this,'madori','${m}')">${m}</span>`).join('')}
      </div>
    </details>
    <details class="map-filter-details">
      <summary>立地・交通</summary>
      <div class="ftag-wrap">
        <input class="finput" type="number" id="f-map-walk" placeholder="徒歩(分)以内" style="font-size:11px;padding:5px 8px;margin-bottom:6px;width:100%"
          onkeydown="if(event.key==='Enter')applyMapFilters()">
        <span class="ftag" onclick="toggleFtag(this,'walkMax','5')">5分以内</span>
        <span class="ftag" onclick="toggleFtag(this,'walkMax','10')">10分以内</span>
        <span class="ftag" onclick="toggleFtag(this,'walkMax','15')">15分以内</span>
      </div>
    </details>
    <details class="map-filter-details">
      <summary>面積</summary>
      <div class="ftag-wrap">
        <input class="finput" type="number" id="f-map-size" placeholder="面積下限(㎡)" style="font-size:11px;padding:5px 8px;width:100%"
          onkeydown="if(event.key==='Enter')applyMapFilters()">
      </div>
    </details>
    <details class="map-filter-details">
      <summary>物件種別</summary>
      <div class="ftag-wrap">
        ${types.map(t=>`<span class="ftag" onclick="toggleFtag(this,'types','${t}')">${t}</span>`).join('')}
      </div>
    </details>
    <details class="map-filter-details">
      <summary>設備・条件</summary>
      <div class="ftag-wrap">
        ${features.slice(0,14).map(f=>`<span class="ftag" onclick="toggleFtag(this,'features','${f}')">${f}</span>`).join('')}
      </div>
    </details>
    <div style="padding:10px 14px;display:flex;gap:6px">
      <button class="btn btn-p" style="flex:1;padding:7px;font-size:12px;justify-content:center" onclick="applyMapFilters()"><i class="ti ti-search"></i> 適用</button>
      <button class="btn" style="padding:7px 10px;font-size:12px" onclick="resetFilters()" title="リセット"><i class="ti ti-refresh"></i></button>
    </div>`;
}

function refreshAllFilters() {
  // TOP詳細フィルター
  const advBody = document.getElementById('adv-filter-body');
  if (advBody) advBody.innerHTML = buildAdvFilterHTML();
  // MAP フィルター（PC版サイドバー）
  const mapFilters = document.getElementById('map-filters-container');
  if (mapFilters) mapFilters.innerHTML = buildMapFilterHTML();
  // MAP フィルター（スマホ版シート）
  const mapFiltersM = document.getElementById('map-filters-container-m');
  if (mapFiltersM) mapFiltersM.innerHTML = buildMapFilterHTML();
  // 管理者フォームの物件種別select
  rebuildTypeSelect();
  // マスター管理画面
  if (isMaster()) renderFieldManagement();
}

function rebuildTypeSelect() {
  const sel = document.getElementById('af-type');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = fieldDefs.types.map(t=>`<option${t===cur?' selected':''}>${t}</option>`).join('');
}

/* ══════════════════════════════════════
   MASTER FIELD MANAGEMENT
══════════════════════════════════════ */
function renderFieldManagement() {
  renderFieldList('types', 'field-list-types');
  renderFieldList('features', 'field-list-features');
  renderFieldList('madori', 'field-list-madori');
}

function renderFieldList(key, containerId) {
  const el = document.getElementById(containerId); if (!el) return;
  const items = fieldDefs[key] || [];
  if (!items.length) {
    el.innerHTML = '<div style="padding:10px;font-size:12px;color:#94a3b8;text-align:center">まだ項目がありません</div>';
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <div class="field-item-card">
      <div class="field-item-label" id="field-label-${key}-${i}">${item}</div>
      <div class="field-item-actions">
        <button class="btn btn-sm" style="font-size:10px;padding:3px 9px" onclick="startEditField('${key}',${i})">
          <i class="ti ti-pencil"></i>
        </button>
        <button class="btn btn-sm" style="font-size:10px;padding:3px 9px;color:var(--red)" onclick="deleteFieldItem('${key}',${i})">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>`).join('');
}

function addFieldItem(key) {
  const inputId = `new-${key==='types'?'type':key==='features'?'feature':'madori'}-input`;
  const input = document.getElementById(inputId); if (!input) return;
  const val = input.value.trim(); if (!val) return;
  if (fieldDefs[key].includes(val)) { showToast('すでに存在する項目です', 'warn'); return; }
  fieldDefs[key].push(val);
  saveFieldDefs(fieldDefs);
  input.value = '';
  renderFieldList(key, `field-list-${key}`);
  // TOPフィルター・MAPフィルター・selectを即時更新
  refreshAllFilters();
  showToast(`「${val}」を追加しました。フィルターに反映されました`, 'success');
}

function deleteFieldItem(key, index) {
  const item = fieldDefs[key][index];
  if (!confirm(`「${item}」を削除しますか？`)) return;
  fieldDefs[key].splice(index, 1);
  saveFieldDefs(fieldDefs);
  renderFieldList(key, `field-list-${key}`);
  refreshAllFilters(); // MAP含む全フィルター即時更新
  showToast(`「${item}」を削除しました`, 'info');
}

let _editingField = null;
function startEditField(key, index) {
  const item = fieldDefs[key][index];
  const newVal = prompt(`項目を編集:`, item);
  if (newVal === null || newVal.trim() === '') return;
  const trimmed = newVal.trim();
  if (fieldDefs[key].includes(trimmed) && trimmed !== item) { showToast('すでに存在する項目です', 'warn'); return; }
  fieldDefs[key][index] = trimmed;
  saveFieldDefs(fieldDefs);
  renderFieldList(key, `field-list-${key}`);
  refreshAllFilters(); // MAP含む全フィルター即時更新
  showToast(`「${item}」→「${trimmed}」に変更しました`, 'success');
}

/* ══════════════════════════════════════
   MAP ADDRESS SEARCH
══════════════════════════════════════ */
async function _runMapSearch(val){
  if (!val) return;
  // PC・スマホ・TOP すべての検索欄に反映
  ['f-search-text','map-addr-input','map-addr-input-m'].forEach(id=>{const el=document.getElementById(id);if(el) el.value=val;});
  filterState.searchText = val;
  showToast('「'+val+'」を検索中...', 'info', 2000);
  const coords = await geocodeAddress(val);
  if (coords && leafletMap) {
    leafletMap.flyTo([coords.lat, coords.lng], 15, {duration:0.8});
    showToast('地図を移動しました', 'success');
  } else {
    showToast('住所が見つかりませんでした', 'warn');
  }
  currentPage=1;
  renderCards(); updateResultsCount(); renderMapSidebar(); updateMapMarkerVisibility();
}
async function searchMapAddress() {
  const inp = document.getElementById('map-addr-input');
  await _runMapSearch(inp ? inp.value.trim() : '');
}
async function searchMapAddressMobile() {
  const inp = document.getElementById('map-addr-input-m');
  await _runMapSearch(inp ? inp.value.trim() : '');
}

/* スマホ用フィルターシート開閉 */
function openMobileFilterSheet(){
  const sheet=document.getElementById('map-filter-sheet');
  if(sheet) sheet.classList.add('show');
  const cur=history.state;
  pushNavState({screen:(cur&&cur.screen)||'map', modal:'filter'});
}
function closeMobileFilterSheet(){
  const sheet=document.getElementById('map-filter-sheet');
  const wasOpen=sheet&&sheet.classList.contains('show');
  if(sheet) sheet.classList.remove('show');
  if(wasOpen && !_navSuppress && history.state && history.state.modal==='filter'){
    history.back();
  }
}

/* TOP検索→MAPアドレスバー（PC・スマホ両方）にも反映 */
function syncSearchToMap() {
  const val = (document.getElementById('f-search-text')||{}).value||'';
  ['map-addr-input','map-addr-input-m'].forEach(id=>{const el=document.getElementById(id);if(el) el.value=val;});
}

/* ══════════════════════════════════════
   AWS ユーザー同期
══════════════════════════════════════ */
/* ══════════════════════════════════════
   ユーザーデータのローカルキャッシュ
   AWSが保存に失敗/未対応でもデータを保持する二重保存
══════════════════════════════════════ */
const USER_CACHE_KEY = 'vr_user_cache';

/* 1ユーザー分のデータをローカルに保存（favs/history/role/active/photoURL/wishlist等） */
function cacheUserLocal(user){
  if(!user||!user.email) return;
  let cache={};
  try{ cache=JSON.parse(localStorage.getItem(USER_CACHE_KEY)||'{}'); }catch(e){}
  // セキュリティ：パスワードはローカルに保存しない（認証はサーバー側で実施）
  cache[user.email]={
    name:user.name, email:user.email,
    role:user.role, active:user.active, photoURL:user.photoURL||null,
    groupId:user.groupId||null, groupName:user.groupName||null, groupOwner:user.groupOwner||false,
    wishlist:user.wishlist||{}, favs:user.favs||[], history:user.history||[],
    _updated:Date.now()
  };
  try{ localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cache)); }catch(e){}
}

/* ローカルキャッシュ全体を取得 */
function loadUserCache(){
  try{ return JSON.parse(localStorage.getItem(USER_CACHE_KEY)||'{}'); }catch(e){ return {}; }
}

/* userStore にローカルキャッシュをマージ（キャッシュを優先） */
function mergeUserCache(){
  const cache=loadUserCache();
  Object.values(cache).forEach(cu=>{
    const existing=userStore.find(u=>u.email===cu.email);
    if(existing){
      // AWSより新しいローカル値で上書き（ユーザー個人データのみ・パスワードは扱わない）
      existing.favs=cu.favs||existing.favs||[];
      existing.history=cu.history||existing.history||[];
      // ロールと停止状態はサーバーの値を正とする(端末側で書き換えても反映しない)
      existing.role=existing.role||cu.role;
      existing.active=(existing.active!==undefined)?existing.active:cu.active;
      existing.photoURL=cu.photoURL||existing.photoURL;
      existing.wishlist=cu.wishlist||existing.wishlist||{};
      if(cu.groupId!==undefined) existing.groupId=cu.groupId;
      if(cu.groupName!==undefined) existing.groupName=cu.groupName;
      if(cu.groupOwner!==undefined) existing.groupOwner=cu.groupOwner;
    } else {
      // AWSにないユーザーはキャッシュから復元（パスワードなし＝サーバー認証専用）
      userStore.push({
        name:cu.name, email:cu.email,
        role:cu.role||'user', active:cu.active!==false, photoURL:cu.photoURL||null,
        groupId:cu.groupId||null, groupName:cu.groupName||null, groupOwner:cu.groupOwner||false,
        wishlist:cu.wishlist||{}, favs:cu.favs||[], history:cu.history||[]
      });
    }
  });
}

/* ローカルキャッシュからユーザーを削除 */
function removeCachedUser(email){
  let cache={};
  try{ cache=JSON.parse(localStorage.getItem(USER_CACHE_KEY)||'{}'); }catch(e){}
  delete cache[email];
  try{ localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cache)); }catch(e){}
}

async function fetchUsers(){
  if(!AWS_API_URL) return;
  try{
    const res=await fetch(AWS_API_URL+'?action=getUsers');
    if(res.status===401){ setToken(''); throw new Error('未ログインまたはログイン期限切れ'); }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const users=await res.json();
    const awsUsers=users.filter(u=>u.email!==DEMO_USER.email&&u.email!==DEMO_ADMIN.email);
    userStore=[DEMO_USER,DEMO_ADMIN,...awsUsers];
  }catch(e){ console.warn('ユーザー取得失敗（デモモードで続行）:',e.message); }
  // AWS取得後、ローカルキャッシュを必ずマージ（データ消失を防ぐ）
  mergeUserCache();
  // サーバー上の最新の権限・グループで自分の情報を更新して、表示を描き直す
  if(currentUser){ const me=userStore.find(u=>u.email===currentUser.email); if(me && me!==currentUser){ ['role','active','groupId','groupName','groupOwner','adUnlocked'].forEach(k=>{ if(me[k]!==undefined) currentUser[k]=me[k]; }); } try{ applyRoleUI(); }catch(e){} }
  refreshPermissionViews();
}

/* AWSとローカル両方に保存（ローカルは即時・確実） */
async function saveUserToAWS(user){
  cacheUserLocal(user); // まずローカルに確実保存
  if(!AWS_API_URL) return;
  if(user.email===DEMO_USER.email||user.email===DEMO_ADMIN.email) return; // デモはサーバーに保存しない
  try{
    const res=await fetch(AWS_API_URL+'?action=saveUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...user})});
    if(!res.ok){
      const d=await res.json().catch(()=>({}));
      console.warn('ユーザー保存がサーバーで拒否されました:',d.error||res.status);
      if(res.status===401) showToast('ログインの有効期限が切れました。もう一度ログインしてください','warn');
      else if(user.email!==currentUser?.email) showToast('保存できませんでした: '+(d.error||res.status),'error');
      return false;
    }
    return true;
  }catch(e){console.warn('ユーザー保存失敗（ローカルには保存済み）:',e.message);return false;}
}

async function deleteUserFromAWS(email){
  removeCachedUser(email); // ローカルからも削除
  if(!AWS_API_URL) return true;
  try{
    const res=await fetch(AWS_API_URL+'?action=deleteUser&email='+encodeURIComponent(email),{method:'DELETE'});
    if(!res.ok){ const d=await res.json().catch(()=>({})); showToast('削除できませんでした: '+(d.error||res.status),'error'); return false; }
    return true;
  }catch(e){console.warn('ユーザー削除失敗:',e.message);showToast('削除できませんでした','error');return false;}
}

/* ══════════════════════════════════════
   間取りエディタ
══════════════════════════════════════ */
window.editedFloorplanData = null;
window.editedFloorplanThumb = null;
let _feMode='edit', _feIframeReady=false, _feLoadingTimer=null, _fePendingInit=null;

function openFloorEditor(propId){
  _feMode='edit';
  _fePendingInit={type:'init',mode:'edit',data:null,propName:''};
  if(propId!=null){
    const prop=PROPS.find(p=>p.id===propId);
    if(prop){_fePendingInit.data=prop.floorplanData||null;_fePendingInit.propName=prop.name||'';_fePendingInit.area=+prop.size||0;}
  } else {
    _fePendingInit.data=window.editedFloorplanData||null;
    _fePendingInit.propName=(document.getElementById('af-name')||{}).value||'新規物件';
    _fePendingInit.area=+((document.getElementById('af-size')||{}).value)||0;  // 専有面積(画像から自動作成の縮尺に使う)
  }
  _openFloorEditorModal('edit');
}

const VR_VIEWER_PATH = 'vr-viewer.html';
let _vrPendingInit=null;

/* ブラウザ内でVR内見を開く(PC・スマホ・Questブラウザ共通) */
function viewInVR(propId){
  const prop=PROPS.find(p=>p.id===propId);
  if(!prop){alert('物件が見つかりません');return;}
  if(!prop.floorplanData&&!prop.splatURL){alert('この物件には間取りデータがありません');return;}
  openVRViewer({data:prop.floorplanData||null,propName:prop.name||'',
    splat:prop.splatURL?{url:prop.splatURL,transform:prop.splatTransform||null,ext:'.spz'}:null});
}
function openVRViewer(init){
  closeVRViewer();
  _vrPendingInit=Object.assign({type:'vr-viewer-init'},init);
  const overlay=document.createElement('div');
  overlay.id='vr-viewer-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:100000;background:#0a0e1a';
  const iframe=document.createElement('iframe');
  iframe.id='vr-viewer-iframe';
  iframe.title='VR内見';
  iframe.setAttribute('allow','xr-spatial-tracking; fullscreen; gyroscope; accelerometer');
  iframe.setAttribute('allowfullscreen','');
  iframe.style.cssText='width:100%;height:100%;border:0;display:block';
  iframe.src=VR_VIEWER_PATH+'?embed=1';
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  document.body.style.overflow='hidden';
}

function closeVRViewer(){
  const overlay=document.getElementById('vr-viewer-overlay');
  if(overlay){overlay.remove();document.body.style.overflow='';}
  _vrPendingInit=null;
}

window.addEventListener('message',function(e){
  const msg=e.data;
  if(!msg||typeof msg!=='object'||!msg.type) return;
  if(msg.type==='vr-viewer-ready'){
    const iframe=document.getElementById('vr-viewer-iframe');
    if(_vrPendingInit&&iframe&&iframe.contentWindow) iframe.contentWindow.postMessage(_vrPendingInit,'*');
  } else if(msg.type==='vr-viewer-close'){closeVRViewer();}
  else if(msg.type==='vr-viewer-align-save'){
    // 実写の位置合わせの結果を、編集中の物件に入れておく(保存ボタンで物件と一緒に保存)
    if(window.editedSplat){ window.editedSplat.transform=msg.transform||null; _renderSplatStatus(); }
    closeVRViewer();
    showToast('位置合わせを反映しました。「登録する/変更を保存」で保存されます','success');
  }
});

/* ===== 実写データ(.spz)の下ごしらえ =====
   撮影データには部屋の外の遠くの点(空や外の景色)が混ざっていて、重くて位置合わせもしにくい。
   アップロード前にブラウザの中で
     1) 点が集まっている範囲(=部屋)だけを残す
     2) 色の細かい情報(球面調和)を落としてファイルを小さくする
   をして、同じ .spz 形式で保存し直す。 */
async function gunzipBytes(buf) {
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer());
}
async function gzipBytes(u8) {
  const cs = new CompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
}
// 1軸ぶん: 点が密集している連続区間(中央値を含む)を探す
function denseRange(vals, bin, minFrac) {
  const n = vals.length; if (!n) return [0, 0];
  const sorted = Float32Array.from(vals).sort();
  const med = sorted[n >> 1];
  const lo = sorted[Math.floor(n * 0.001)], hi = sorted[Math.floor(n * 0.999)];
  const nb = Math.max(1, Math.min(4000, Math.ceil((hi - lo) / bin)));
  const cnt = new Uint32Array(nb + 1);
  for (let i = 0; i < n; i++) { const v = vals[i]; if (v < lo || v > hi) continue; cnt[Math.min(nb, Math.floor((v - lo) / bin))]++; }
  const th = n * minFrac, mb = Math.min(nb, Math.max(0, Math.floor((med - lo) / bin)));
  let a = mb, b = mb, gap = 0;
  // 少しの隙間(2ビン)は許して広げる
  for (let k = mb - 1; k >= 0; k--) { if (cnt[k] >= th) { a = k; gap = 0; } else if (++gap > 2) break; }
  gap = 0;
  for (let k = mb + 1; k <= nb; k++) { if (cnt[k] >= th) { b = k; gap = 0; } else if (++gap > 2) break; }
  return [lo + a * bin, lo + (b + 1) * bin];
}
async function processSpz(arrayBuffer, opts) {
  opts = Object.assign({ margin: 0.3, keepSH: false, maxPoints: 600000 }, opts || {});
  const d = await gunzipBytes(arrayBuffer);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const magic = dv.getUint32(0, true), version = dv.getUint32(4, true), n = dv.getUint32(8, true);
  const shDeg = d[12], frac = d[13], flags = d[14];
  if (magic !== 0x5053474e) throw new Error('.spz ファイルではないようです');
  if (version < 2 || version > 3) throw new Error('この .spz のバージョン(' + version + ')には対応していません');
  const shCoef = [0, 3, 8, 15][shDeg] || 0, rotB = version >= 3 ? 4 : 3;
  let off = 16;
  const posOff = off; off += n * 9;
  const alphaOff = off; off += n;
  const colOff = off; off += n * 3;
  const sclOff = off; off += n * 3;
  const rotOff = off; off += n * rotB;
  const shOff = off; off += n * shCoef * 3;
  if (off > d.length) throw new Error('.spz ファイルが壊れているようです');
  // 位置を読む(24bit固定小数)
  const P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], sc = 1 / (1 << frac);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
    const o = posOff + i * 9 + a * 3;
    let v = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16); if (v & 0x800000) v -= 0x1000000;
    P[a][i] = v * sc;
  }
  const rx = denseRange(P[0], 0.25, 0.0015), ry = denseRange(P[1], 0.25, 0.0015), rz = denseRange(P[2], 0.25, 0.0015);
  const m = opts.margin;
  const keep = [];
  for (let i = 0; i < n; i++) {
    if (P[0][i] < rx[0] - m || P[0][i] > rx[1] + m || P[1][i] < ry[0] - m || P[1][i] > ry[1] + m || P[2][i] < rz[0] - m || P[2][i] > rz[1] + m) continue;
    if (d[alphaOff + i] < 8) continue;   // ほぼ透明な点も捨てる
    keep.push(i);
  }
  // 多すぎるときは間引く(スマホ向け)
  let idx = keep;
  if (keep.length > opts.maxPoints) { const step = keep.length / opts.maxPoints; idx = []; for (let k = 0; k < keep.length; k += step) idx.push(keep[Math.floor(k)]); }
  const m2 = idx.length, outSh = opts.keepSH ? shCoef : 0, outShDeg = opts.keepSH ? shDeg : 0;
  const out = new Uint8Array(16 + m2 * (9 + 1 + 3 + 3 + rotB + outSh * 3));
  const ov = new DataView(out.buffer);
  ov.setUint32(0, magic, true); ov.setUint32(4, version, true); ov.setUint32(8, m2, true);
  out[12] = outShDeg; out[13] = frac; out[14] = flags; out[15] = 0;
  let o = 16;
  const copy = (srcOff, size) => { for (let k = 0; k < m2; k++) { out.set(d.subarray(srcOff + idx[k] * size, srcOff + idx[k] * size + size), o); o += size; } };
  copy(posOff, 9); copy(alphaOff, 1); copy(colOff, 3); copy(sclOff, 3); copy(rotOff, rotB);
  if (outSh) copy(shOff, outSh * 3);
  const gz = await gzipBytes(out);
  return {
    blob: new Blob([gz], { type: 'application/octet-stream' }),
    info: { pointsIn: n, pointsOut: m2, bytesIn: arrayBuffer.byteLength, bytesOut: gz.byteLength,
      box: { x: [rx[0] - m, rx[1] + m], y: [ry[0] - m, ry[1] + m], z: [rz[0] - m, rz[1] + m] } }
  };
}

/* ── 物件フォーム: 実写データ(.spz) ── */
window.editedSplat=null;   // {blob?, url, transform, info?}
async function onSplatFileChange(input){
  const f=input.files&&input.files[0]; if(!f) return;
  const st=document.getElementById('af-splat-status');
  if(!/\.spz$/i.test(f.name)){ showToast('.spz ファイルを選んでください','warn'); input.value=''; return; }
  if(typeof DecompressionStream==='undefined'){ showToast('このブラウザでは実写データを扱えません。最新のChrome・Edge・Safariを使ってください','error'); return; }
  st.style.display='block'; st.textContent='実写データを準備しています…(部屋の外の点を取り除いて軽くしています)';
  try{
    const r=await processSpz(await f.arrayBuffer());
    if(window.editedSplat&&window.editedSplat.url&&window.editedSplat.blob) URL.revokeObjectURL(window.editedSplat.url);
    window.editedSplat={blob:r.blob,url:URL.createObjectURL(r.blob),transform:null,info:r.info};
    _renderSplatStatus();
    showToast('実写データを読み込みました。「位置合わせ」で間取りに重ねてください','success');
  }catch(e){ console.error(e); st.textContent='読み込めませんでした: '+e.message; }
  input.value='';
}
function _renderSplatStatus(){
  const st=document.getElementById('af-splat-status'), acts=document.getElementById('af-splat-actions');
  if(!st||!acts) return;
  const sp=window.editedSplat;
  if(!sp){ st.style.display='none'; acts.style.display='none'; return; }
  st.style.display='block'; acts.style.display='flex';
  const mb=b=>(b/1024/1024).toFixed(1)+'MB';
  const i=sp.info;
  st.innerHTML=(i?`📷 実写データ: ${(i.pointsOut/10000).toFixed(1)}万点・${mb(i.bytesOut)}(元: ${(i.pointsIn/10000).toFixed(1)}万点・${mb(i.bytesIn)})`:'📷 実写データあり')
    +'<br>'+(sp.transform?'<span style="color:var(--green)">✓ 位置合わせ済み</span>':'<span style="color:var(--amber)">位置合わせがまだです(自動の推定で表示されます)</span>');
}
function alignSplat(){
  const sp=window.editedSplat; if(!sp){ showToast('先に実写データを選んでください','warn'); return; }
  const editing=editingPropId!=null?PROPS.find(p=>p.id===editingPropId):null;
  const plan=window.editedFloorplanData||(editing&&editing.floorplanData)||null;
  if(!plan) showToast('間取りがないので、実写の床と中心だけ合わせます','info');
  openVRViewer({data:plan,propName:'位置合わせ',align:true,splat:{url:sp.url,transform:sp.transform,ext:'.spz'}});
}
function previewSplat(){
  const sp=window.editedSplat; if(!sp) return;
  const editing=editingPropId!=null?PROPS.find(p=>p.id===editingPropId):null;
  openVRViewer({data:window.editedFloorplanData||(editing&&editing.floorplanData)||null,propName:'プレビュー',splat:{url:sp.url,transform:sp.transform,ext:'.spz'}});
}
function clearSplat(){
  if(window.editedSplat&&window.editedSplat.blob&&window.editedSplat.url) URL.revokeObjectURL(window.editedSplat.url);
  window.editedSplat=null; _renderSplatStatus();
}
window.onSplatFileChange=onSplatFileChange;window.alignSplat=alignSplat;window.previewSplat=previewSplat;window.clearSplat=clearSplat;
// 実写データをS3に置いて、公開URLを返す
async function uploadSplatToS3(blob){
  const filename='photos/splat_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.spz';
  const signRes=await fetch(AWS_API_URL+'?action=upload&filename='+encodeURIComponent(filename));
  if(!signRes.ok){ const d=await signRes.json().catch(()=>({})); throw new Error(d.error||'アップロードの準備に失敗しました'); }
  const {url}=await signRes.json();
  const putRes=await fetch(url,{method:'PUT',body:blob,headers:{'Content-Type':'application/octet-stream'}});
  if(!putRes.ok) throw new Error('S3へのアップロードに失敗しました ('+putRes.status+')');
  return S3_PUBLIC_BASE+filename;
}
// フォームの実写データを保存用の値にする({splatURL, splatTransform})
async function resolveSplatForSave(){
  const sp=window.editedSplat;
  if(!sp) return {splatURL:null,splatTransform:null};
  if(sp.blob){
    showToast('実写データをアップロード中…(数MBあります)','info',4000);
    const url=await uploadSplatToS3(sp.blob);
    return {splatURL:url,splatTransform:sp.transform||null};
  }
  return {splatURL:sp.url,splatTransform:sp.transform||null};
}

function _openFloorEditorModal(mode){
  const overlay=document.getElementById('floor-editor-overlay');
  const iframe=document.getElementById('fe-iframe');
  const loading=document.getElementById('fe-loading');
  const errorEl=document.getElementById('fe-error');
  const badge=document.getElementById('fe-mode-badge');
  const title=document.getElementById('fe-title');
  if(mode==='view'){badge.textContent='VR内見モード';badge.classList.add('vr');title.textContent='Quest 3 で見る';}
  else{badge.textContent='編集モード';badge.classList.remove('vr');title.textContent='間取りエディタ';}
  _feIframeReady=false;
  errorEl.classList.remove('show');loading.classList.remove('hidden');
  overlay.classList.add('show');
  iframe.src=EDITOR_PATH+'?embed=1';
  if(_feLoadingTimer) clearTimeout(_feLoadingTimer);
  _feLoadingTimer=setTimeout(()=>{if(!_feIframeReady){loading.classList.add('hidden');errorEl.classList.add('show');}},5000);
}

function closeFloorEditor(){
  document.getElementById('floor-editor-overlay').classList.remove('show');
  document.getElementById('fe-iframe').src='about:blank';
  if(_feLoadingTimer){clearTimeout(_feLoadingTimer);_feLoadingTimer=null;}
  _feIframeReady=false;_fePendingInit=null;
}

window.addEventListener('message',function(e){
  const msg=e.data;
  if(!msg||typeof msg!=='object'||!msg.type) return;
  if(msg.type==='vr-editor-ready'){
    _feIframeReady=true;
    if(_feLoadingTimer){clearTimeout(_feLoadingTimer);_feLoadingTimer=null;}
    document.getElementById('fe-loading').classList.add('hidden');
    if(_fePendingInit){const iframe=document.getElementById('fe-iframe');if(iframe&&iframe.contentWindow) iframe.contentWindow.postMessage(_fePendingInit,'*');}
  } else if(msg.type==='vr-editor-save'){
    window.editedFloorplanData=msg.data||null;
    window.editedFloorplanThumb=msg.thumbnail||null;
    _applyFloorplanThumbnail();closeFloorEditor();
  } else if(msg.type==='vr-editor-cancel'){closeFloorEditor();}
});

function _applyFloorplanThumbnail(){
  const wrap=document.getElementById('fp-thumb-wrap');
  const img=document.getElementById('fp-thumb-img');
  const info=document.getElementById('fp-thumb-info');
  if(!wrap||!img) return;
  if(window.editedFloorplanData){
    wrap.style.display='flex';
    if(window.editedFloorplanThumb) img.src=window.editedFloorplanThumb;
    const d=window.editedFloorplanData;
    if(info) info.textContent='部屋'+(d.rooms||[]).length+' / 家具'+(d.furnitures||[]).length;
  } else {wrap.style.display='none';}
}

function clearFloorplan(){window.editedFloorplanData=null;window.editedFloorplanThumb=null;_applyFloorplanThumbnail();}
window.clearFloorplan=clearFloorplan;window.openFloorEditor=openFloorEditor;window.viewInVR=viewInVR;window.closeFloorEditor=closeFloorEditor;window.closeVRViewer=closeVRViewer;

function downloadFloorplan(id){
  const prop=PROPS.find(p=>p.id===id);
  if(!prop||!prop.floorplanURL){alert('この物件には間取り図がありません');return;}
  const a=document.createElement('a');a.href=prop.floorplanURL;a.download=`${prop.name}_間取り図.png`;document.body.appendChild(a);a.click();document.body.removeChild(a);
}

function normalizeAddress(addr){
  if(!addr) return '';
  addr=addr.replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  addr=addr.replace(/　/g,' ');
  addr=addr.replace(/[ー－−―]/g,'-');
  addr=addr.replace(/^[〒＝]?\s*\d{3}-\d{4}\s*/g,'');
  return addr.trim();
}

/* ══════════════════════════════════════
   ROLE HELPERS
══════════════════════════════════════ */
function isMaster(u){return (u||currentUser)?.role==='master';}
function isAdmin(u){const r=(u||currentUser)?.role;return r==='admin'||r==='master';}

/* ══════════════════════════════════════
   物件の編集・削除権限の判定
   - マスター：すべて可
   - 管理者：自分が追加した物件、または同じグループの管理者が追加した物件
   - それ以外：不可
══════════════════════════════════════ */
function canEditProp(prop){
  if(!currentUser) return false;
  if(!isAdmin()) return false;             // 管理者未満は不可（isAdmin はマスターも含む）
  if(!prop) return false;
  // サーバーが「この人は編集できる」と教えてくれたときはそれを使う（登録者のアドレスは編集できる人にしか届かない）
  if(prop.canEdit!==undefined) return !!prop.canEdit;
  // 自分が追加した物件
  if(prop.ownerEmail && prop.ownerEmail===currentUser.email) return true;
  // 登録者のいない古い物件は、マスター（運営）が引き取る
  if(!prop.ownerEmail) return isMaster();
  // マスター（運営）でも、他の人の物件の中身は編集しない（掲載の停止・PRは「掲載の管理」から）
  // 同じグループのメンバーが追加した物件
  const myGroup=currentUser.groupId;
  if(myGroup){
    const owner=userStore.find(u=>u.email===prop.ownerEmail);
    if(owner && owner.groupId===myGroup) return true;
  }
  return false;
}
function isRegular(u){return (u||currentUser)?.role==='user';}
/* デモアカウントは端末の中だけの存在なので、管理画面の一覧には出さない */
function isDemoUser(u){return !!u && (u.email===DEMO_USER.email||u.email===DEMO_ADMIN.email);}
function realUsers(){return userStore.filter(u=>!isDemoUser(u));}
/* 他のユーザーを停止・削除できるか(サーバー側のルールと同じ) */
function canManageUser(u){
  // 利用停止・再開と権限の変更はマスター（運営）だけ。管理者（不動産会社）はユーザーを管理しない
  if(!u||!currentUser||u.email===currentUser.email||u.role==='master') return false;
  return isMaster();
}
/* ログイン・ログアウト・権限変更のたびに、編集できるかどうかで変わる表示を描き直す */
function refreshPermissionViews(){
  try{ renderAdminPropTable(); }catch(e){}
  try{ renderCards(); updateResultsCount(); }catch(e){}
  try{ if(pdCurrentId!=null && document.getElementById('pd-overlay').classList.contains('show')){ const p=PROPS.find(x=>x.id===pdCurrentId); if(p) renderPropDetail(p); } }catch(e){}
}
function roleLabel(role){
  if(role==='master') return '<span class="tag tmaster">マスター</span>';
  if(role==='admin')  return '<span class="tag tgold">管理者</span>';
  return '<span class="tag tgr">一般</span>';
}

/* ══════════════════════════════════════
   UI AFTER LOGIN
══════════════════════════════════════ */
function applyRoleUI(){
  const u=currentUser;if(!u) return;
  updateAvatarDisplay();
  document.getElementById('mp-name').textContent=u.name;
  document.getElementById('mp-email').textContent=u.email;
  document.getElementById('mp-role-badge').innerHTML=roleLabel(u.role);
  if(document.getElementById('prof-email')) document.getElementById('prof-email').value=u.email;
  const parts=u.name.split(' ');
  if(document.getElementById('prof-sei')) document.getElementById('prof-sei').value=parts[0]||'';
  if(document.getElementById('prof-mei')) document.getElementById('prof-mei').value=parts[1]||'';
  document.getElementById('tab-admin').classList.toggle('hidden',!isAdmin());
  document.getElementById('tab-master').classList.toggle('hidden',!isMaster());
  document.getElementById('nav-admin-btn').classList.toggle('hidden',!isAdmin());
  document.getElementById('admin-email-display').textContent=u.email;
  const mb=document.getElementById('master-name-badge'); if(mb) mb.textContent=u.name||u.email;
  refreshStats();
  if(u.wishlist) renderWishlistUI(u.wishlist);
}

function updateAvatarDisplay(){
  const u=currentUser;if(!u) return;
  ['mp-avatar','mp-avatar-prof'].forEach(id=>{
    const el=document.getElementById(id);if(!el) return;
    if(u.photoURL){el.style.backgroundImage=`url(${u.photoURL})`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.textContent='';}
    else{el.style.backgroundImage='';el.textContent=u.name.charAt(0);}
  });
}

function refreshStats(){
  const users=realUsers();
  const total=users.filter(u=>u.role!=='master').length;
  const admins=users.filter(u=>u.role==='admin').length;
  const regulars=users.filter(u=>u.role==='user').length;
  const vr=PROPS.filter(p=>p.floorplanData).length;
  const mine=currentUser?PROPS.filter(p=>p.ownerEmail===currentUser.email).length:0;
  const rents=PROPS.map(p=>+p.price).filter(v=>v>0);
  const avg=rents.length?Math.round(rents.reduce((a,b)=>a+b,0)/rents.length):0;
  [['admin-user-count',total],['admin-user-count2',total],['master-user-count',users.length],['master-admin-count',admins],['master-regular-count',regulars],
   ['stat-prop-count',PROPS.length],['stat-vr-count',vr],['stat-my-count',mine],['stat-avg-rent',avg?'¥'+avg.toLocaleString():'−']]
    .forEach(([id,v])=>{const el=document.getElementById(id);if(el) el.textContent=v;});
}

/* ══════════════════════════════════════
   LOGIN GATE
══════════════════════════════════════ */
function showGateMsg(msg,isError){
  const el=document.getElementById('gate-msg');
  el.style.background=isError?'rgba(220,38,38,.15)':'rgba(22,163,74,.15)';
  el.style.border=isError?'1px solid rgba(220,38,38,.3)':'1px solid rgba(22,163,74,.3)';
  el.style.color=isError?'#fca5a5':'#86efac';
  el.style.borderRadius='8px';el.style.padding='10px 14px';
  el.textContent=msg;el.style.display='block';
  if(!isError) setTimeout(()=>el.style.display='none',3000);
}

function switchGateAuth(t){
  const isLogin=t==='login';
  const isReset=t==='reset';
  const tl=document.getElementById('gatab-login'),tr=document.getElementById('gatab-reg');
  if(tl) tl.classList.toggle('on',isLogin);
  if(tr) tr.classList.toggle('on',t==='reg');
  const msg=document.getElementById('gate-msg');if(msg) msg.style.display='none';
  const hint=document.getElementById('gate-switch-hint');
  const form=document.getElementById('gate-form');
  if(!form) return;

  if(isReset){
    form.innerHTML=`
      <div style="font-size:13px;color:rgba(255,255,255,.7);margin-bottom:18px;line-height:1.7">
        登録済みのメールアドレスと新しいパスワードを入力してください。
      </div>
      <div class="lfield"><label>メールアドレス</label>
        <input class="linput" id="rst-email" type="text" placeholder="example@email.com" autocomplete="username"
          onkeydown="handleFormKey(event,'rst-pass')">
      </div>
      <div class="lfield"><label>新しいパスワード（6文字以上）</label>
        <div class="pass-wrap">
          <input class="linput" id="rst-pass" type="password" placeholder="新しいパスワード" autocomplete="new-password"
            onkeydown="handleFormKey(event,'rst-pass2')">
          <button class="eye-btn" type="button" onclick="const i=document.getElementById('rst-pass');i.type=i.type==='password'?'text':'password'"><i class="ti ti-eye"></i></button>
        </div>
      </div>
      <div class="lfield"><label>新しいパスワード（確認）</label>
        <input class="linput" id="rst-pass2" type="password" placeholder="もう一度入力" autocomplete="new-password"
          onkeydown="if(event.key==='Enter')gateResetPassword()">
      </div>
      <button class="lbtn" type="button" onclick="gateResetPassword()"><i class="ti ti-lock"></i> パスワードを再設定</button>`;
    if(hint) hint.innerHTML='<a onclick="switchGateAuth(\'login\')">← ログインに戻る</a>';
    return;
  }

  if(isLogin){
    form.innerHTML=`
      <div class="lfield"><label>メールアドレス</label>
        <input class="linput" id="g-email" type="text" placeholder="example@email.com" autocomplete="username"
          onkeydown="handleFormKey(event,'g-pass')">
      </div>
      <div class="lfield"><label>パスワード</label>
        <div class="pass-wrap">
          <input class="linput" id="g-pass" type="password" placeholder="••••••••" autocomplete="current-password"
            onkeydown="if(event.key==='Enter')gateLogin()">
          <button class="eye-btn" id="g-eye" type="button" onclick="toggleGateEye()"><i class="ti ti-eye"></i></button>
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:#93c5fd;cursor:pointer;margin-bottom:20px" onclick="switchGateAuth('reset')">パスワードをお忘れですか？</div>
      <button class="lbtn" type="button" onclick="gateLogin()"><i class="ti ti-login"></i> ログイン</button>`;
    if(hint) hint.innerHTML='アカウントをお持ちでない方は <a onclick="switchGateAuth(\'reg\')">新規登録</a>';
  } else {
    form.innerHTML=`
      <div class="lfield"><label>お名前 <span style="color:#f87171">*</span></label>
        <input class="linput" id="g-name" placeholder="田中 太郎" onkeydown="handleFormKey(event,'g-email')">
      </div>
      <div class="lfield"><label>メールアドレス <span style="color:#f87171">*</span></label>
        <input class="linput" id="g-email" type="text" placeholder="example@email.com" autocomplete="email"
          onkeydown="handleFormKey(event,'g-pass')">
      </div>
      <div class="lfield" style="margin-bottom:6px"><label>パスワード（6文字以上）<span style="color:#f87171">*</span></label>
        <div class="pass-wrap">
          <input class="linput" id="g-pass" type="password" placeholder="6文字以上" autocomplete="new-password"
            onkeydown="if(event.key==='Enter')gateRegister()">
          <button class="eye-btn" id="g-eye" type="button" onclick="toggleGateEye()"><i class="ti ti-eye"></i></button>
        </div>
        <div class="str-bar" style="margin-top:8px"><div class="str-seg" id="gs1"></div><div class="str-seg" id="gs2"></div><div class="str-seg" id="gs3"></div><div class="str-seg" id="gs4"></div></div>
      </div>
      <button class="lbtn" type="button" onclick="gateRegister()" style="margin-top:16px"><i class="ti ti-user-plus"></i> 会員登録する</button>`;
    if(hint) hint.innerHTML='すでにアカウントをお持ちの方は <a onclick="switchGateAuth(\'login\')">ログイン</a>';
    document.getElementById('g-pass').addEventListener('input',function(){
      const v=this.value,segs=[document.getElementById('gs1'),document.getElementById('gs2'),document.getElementById('gs3'),document.getElementById('gs4')];
      segs.forEach(s=>s.className='str-seg');
      if(v.length>=2)segs[0].className='str-seg weak';
      if(v.length>=4)segs[1].className='str-seg weak';
      if(v.length>=6){segs[0].className='str-seg mid';segs[1].className='str-seg mid';segs[2].className='str-seg mid';}
      if(v.length>=10&&/[A-Z]/.test(v)) segs.forEach(s=>s.className='str-seg strong');
    });
  }
}

function toggleGateEye(){
  const inp=document.getElementById('g-pass'),btn=document.getElementById('g-eye');
  inp.type=inp.type==='password'?'text':'password';
  btn.innerHTML=inp.type==='text'?'<i class="ti ti-eye-off"></i>':'<i class="ti ti-eye"></i>';
}

async function gateLogin(){
  const email=(document.getElementById('g-email')||{}).value?.trim()||'';
  const pass=(document.getElementById('g-pass')||{}).value||'';
  if(!email||!pass){showGateMsg('メールアドレスとパスワードを入力してください',true);return;}


  // ② AWS サーバー側で認証（パスワードはハッシュ照合）
  if(AWS_API_URL){
    try{
      const res=await fetch(AWS_API_URL+'?action=login',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,password:pass})
      });
      if(res.ok){
        const data=await res.json();
        if(data&&data.success&&data.user){
          const user=data.user;
          const idx=userStore.findIndex(u=>u.email===user.email);
          if(idx>=0) userStore[idx]={...userStore[idx],...user};
          else userStore.push(user);
          cacheUserLocal(user);
          setToken(data.token||'');
          try{ localStorage.setItem('vr_session_email', user.email); }catch(e){}
          // ログインできたので、通行証つきでユーザー一覧を取り直す
          fetchUsers().catch(()=>{});
          _enterApp(user);
          return;
        }
      } else {
        const d=await res.json().catch(()=>({}));
        showGateMsg(d.error||'メールアドレスまたはパスワードが違います',true);
        return;
      }
    }catch(e){
      console.warn('サーバー認証に接続できません:',e.message);
    }
  }

  showGateMsg('サーバーにつながりませんでした。通信環境を確認して、もう一度お試しください',true);
}

/* ログイン成功後の共通処理（新規ログイン・セッション復元で共用） */
function _enterApp(user){
  isLoggedIn=true;currentUser=user;
  favs=new Set(Array.isArray(user.favs)?user.favs:[]);
  viewHistory=(user.history||[]).map(h=>({...h,time:new Date(h.time)}));
  const gate=document.getElementById('login-gate');
  gate.classList.add('hidden');
  gate.style.display='none';
  applyRoleUI();
  refreshAllFilters();
  refreshPermissionViews();   // ログイン前に描いた「鍵マーク」のままにならないように描き直す
  // お問い合わせフォームに自分の名前とメールを入れておく
  try{ renderContactSender(); }catch(e){}
  if(isMaster()){
    renderMasterUserTable();renderRoleTable();renderFieldManagement();
    showScreen('master');
  }
  else showScreen('top');
}

/* リロード時にセッションを復元 */
function restoreSession(){
  let email=null;
  try{ email=localStorage.getItem('vr_session_email'); }catch(e){}
  const gate=document.getElementById('login-gate');
  const showGate=()=>{
    document.documentElement.classList.remove('has-session');
    if(gate){ gate.style.display=''; gate.classList.remove('hidden'); }
  };
  if(!email){ showGate(); return false; }
  const isDemo=(email===DEMO_USER.email||email===DEMO_ADMIN.email);
  if(!isDemo && !getToken()){
    // 通行証が無い・期限切れなら、もう一度ログインしてもらう
    try{localStorage.removeItem('vr_session_email');}catch(e){}
    showGate();
    return false;
  }
  const user=userStore.find(u=>u.email===email);
  if(!user||!user.active) {
    try{localStorage.removeItem('vr_session_email');}catch(e){}
    showGate();
    return false;
  }
  _enterApp(user);
  return true;
}

function gateRegister(){
  const name=(document.getElementById('g-name')||{}).value?.trim()||'';
  const email=(document.getElementById('g-email')||{}).value?.trim()||'';
  const pass=(document.getElementById('g-pass')||{}).value||'';
  if(!name){showGateMsg('お名前を入力してください',true);return;}
  if(!email){showGateMsg('メールアドレスを入力してください',true);return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showGateMsg('正しいメールアドレスを入力してください',true);return;}
  if(pass.length<6){showGateMsg('パスワードは6文字以上で入力してください',true);return;}
  if(userStore.find(u=>u.email===email)){showGateMsg('このメールアドレスはすでに登録されています',true);return;}
  const newUser={name,email,password:pass,role:'user',active:true,photoURL:null,wishlist:{}};
  userStore.push(newUser);saveUserToAWS(newUser);
  showGateMsg('登録完了！ログインしてください',false);
  setTimeout(()=>switchGateAuth('login'),1200);
}

/* パスワード再設定：ステップ1（メール入力→サーバーが6桁コードを生成・送信） */
let _resetPending = null; // {email, newPass}

async function gateResetPassword(){
  const email=(document.getElementById('rst-email')||{}).value?.trim()||'';
  const pass=(document.getElementById('rst-pass')||{}).value||'';
  const pass2=(document.getElementById('rst-pass2')||{}).value||'';
  if(!email){showGateMsg('メールアドレスを入力してください',true);return;}
  if(pass.length<6){showGateMsg('パスワードは6文字以上で入力してください',true);return;}
  if(pass!==pass2){showGateMsg('パスワードが一致しません',true);return;}

  if(!AWS_API_URL){showGateMsg('現在パスワード再設定はご利用いただけません',true);return;}

  showGateMsg('確認コードを送信中...',false);
  try{
    // サーバー側でコード生成＋メール送信（コードはサーバーが保持、フロントには渡さない）
    const res=await fetch(AWS_API_URL+'?action=requestResetCode',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok){ showGateMsg(d.error||'コードの送信に失敗しました',true); return; }
    if(!d.success){ showGateMsg('メールの送信に失敗しました。メールアドレスをご確認ください',true); return; }
    // 新パスワードを一時保持（コード検証成功後に確定）
    _resetPending={email, newPass:pass};
    switchGateAuthToVerify(email);
  }catch(e){
    showGateMsg('通信エラーが発生しました。もう一度お試しください',true);
  }
}

/* コード入力画面を表示（コードはサーバーが保持しているので画面には出さない） */
function switchGateAuthToVerify(email){
  const form=document.getElementById('gate-form');
  const hint=document.getElementById('gate-switch-hint');
  const msg=document.getElementById('gate-msg');if(msg) msg.style.display='none';
  const tl=document.getElementById('gatab-login');if(tl) tl.classList.remove('on');
  const tr=document.getElementById('gatab-reg');if(tr) tr.classList.remove('on');
  form.innerHTML=`
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-bottom:16px;line-height:1.7">
      <strong style="color:#93c5fd">${email}</strong> に6桁の確認コードを送信しました。メールをご確認のうえ、コードを入力してください。
    </div>
    <div class="lfield"><label>確認コード（6桁）</label>
      <input class="linput" id="rst-code" type="text" inputmode="numeric" maxlength="6"
        placeholder="000000" autocomplete="one-time-code"
        style="letter-spacing:.4em;text-align:center;font-size:20px"
        onkeydown="if(event.key==='Enter')gateVerifyCode()">
    </div>
    <button class="lbtn" type="button" onclick="gateVerifyCode()"><i class="ti ti-shield-check"></i> 認証して再設定</button>
    <div style="text-align:center;margin-top:12px">
      <span style="font-size:12px;color:#93c5fd;cursor:pointer" onclick="switchGateAuth('reset')">← やり直す</span>
    </div>`;
  if(hint) hint.innerHTML='<a onclick="switchGateAuth(\'login\')">ログインに戻る</a>';
  setTimeout(()=>{const c=document.getElementById('rst-code');if(c) c.focus();},100);
}

/* ステップ2：サーバーでコード検証＋パスワード更新（ハッシュ化） */
async function gateVerifyCode(){
  const input=(document.getElementById('rst-code')||{}).value?.trim()||'';
  if(!_resetPending){showGateMsg('セッションが切れました。最初からやり直してください',true);return;}
  if(!input){showGateMsg('確認コードを入力してください',true);return;}
  showGateMsg('認証中...',false);
  try{
    const res=await fetch(AWS_API_URL+'?action=confirmReset',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:_resetPending.email, code:input, newPassword:_resetPending.newPass})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok){ showGateMsg(d.error||'確認コードが正しくありません',true); return; }
    if(!d.success){ showGateMsg('再設定に失敗しました。もう一度お試しください',true); return; }
    const email=_resetPending.email;
    _resetPending=null;
    // ローカルキャッシュのパスワードは削除（サーバーがハッシュ管理するため）
    showGateMsg('✓ パスワードを再設定しました。ログインしてください',false);
    setTimeout(()=>{
      switchGateAuth('login');
      const em=document.getElementById('g-email');if(em) em.value=email;
    },1400);
  }catch(e){
    showGateMsg('通信エラーが発生しました',true);
  }
}

function doLogout(){
  isLoggedIn=false;currentUser=null;
  try{ localStorage.removeItem('vr_session_email'); }catch(e){}
  setToken('');
  setTimeout(refreshPermissionViews,0);
  document.documentElement.classList.remove('has-session');
  // 履歴をクリア（ログアウト後に戻るで中に入れないように）
  try{ history.replaceState({screen:'top'}, '', location.pathname+location.search); }catch(e){}
  // ログイン画面フォームをリセット
  const form=document.getElementById('gate-form');
  if(form) form.innerHTML='';
  const tl=document.getElementById('gatab-login');if(tl) tl.classList.add('on');
  const tr=document.getElementById('gatab-reg');if(tr) tr.classList.remove('on');
  switchGateAuth('login');
  const gate=document.getElementById('login-gate');
  gate.classList.remove('hidden');
  gate.style.display='';
  window.scrollTo(0,0);
}

/* ══════════════════════════════════════
   PROFILE / AVATAR
══════════════════════════════════════ */
function saveProfile(){
  const sei=(document.getElementById('prof-sei')||{}).value?.trim()||'';
  const mei=(document.getElementById('prof-mei')||{}).value?.trim()||'';
  const newName=(sei+' '+mei).trim()||currentUser.name;
  currentUser.name=newName;
  const s=userStore.find(u=>u.email===currentUser.email);if(s) s.name=newName;
  saveUserToAWS(currentUser);
  document.getElementById('mp-name').textContent=newName;
  updateAvatarDisplay();
  const msg=document.getElementById('prof-save-msg');
  if(msg){msg.style.display='block';setTimeout(()=>msg.style.display='none',2500);}
}
function handleAvatarUpload(input){
  const file=input.files[0];if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{const url=e.target.result;currentUser.photoURL=url;const s=userStore.find(u=>u.email===currentUser.email);if(s) s.photoURL=url;updateAvatarDisplay();};
  reader.readAsDataURL(file);
}

/* ══════════════════════════════════════
   WISHLIST
══════════════════════════════════════ */
function renderWishlistUI(wishlist){
  Object.keys(wishlist||{}).forEach(key=>{
    const wrap=document.getElementById(`wish-${key}`);if(!wrap) return;
    const selected=new Set(Array.isArray(wishlist[key])?wishlist[key]:[]);
    wrap.querySelectorAll('.wtag').forEach(el=>el.classList.toggle('on',selected.has(el.dataset.value)));
  });
}
function toggleWtag(el,key){
  el.classList.toggle('on');
  if(!currentUser) return;
  if(!currentUser.wishlist) currentUser.wishlist={};
  const wrap=document.getElementById(`wish-${key}`);if(!wrap) return;
  currentUser.wishlist[key]=[...wrap.querySelectorAll('.wtag.on')].map(t=>t.dataset.value);
  const s=userStore.find(u=>u.email===currentUser.email);if(s) s.wishlist=currentUser.wishlist;
  saveUserToAWS(currentUser);
}
function applyWishlistToFilter(){
  if(!currentUser||!currentUser.wishlist) return;
  const w=currentUser.wishlist;
  if(w.madori) w.madori.forEach(v=>filterState.madori.add(v));
  if(w.features) w.features.forEach(v=>filterState.features.add(v));
  guardedScreen('top');
  setTimeout(()=>{renderCards();updateResultsCount();},100);
}

/* ══════════════════════════════════════
   FAVORITES
══════════════════════════════════════ */
function toggleFav(id,el){
  if(favs.has(id)){
    favs.delete(id);
    if(el){el.classList.remove('on');const icon=el.querySelector('i');if(icon) icon.className='ti ti-heart';}
  } else {
    favs.add(id);
    if(el){el.classList.add('on');const icon=el.querySelector('i');if(icon) icon.className='ti ti-heart';}
  }
  document.querySelectorAll(`.fav-btn[data-prop-id="${id}"]`).forEach(btn=>{
    btn.classList.toggle('on',favs.has(id));
    const icon=btn.querySelector('i');
    if(icon) icon.className='ti ti-heart';
  });
  if(currentUser){currentUser.favs=[...favs];saveUserToAWS(currentUser);}
  const favTab=document.getElementById('mp-fav');
  if(favTab&&favTab.style.display!=='none') renderFavorites();
}

function renderFavorites(){
  const container=document.getElementById('mp-fav-list');if(!container) return;
  const favProps=PROPS.filter(p=>favs.has(p.id));
  if(!favProps.length){
    container.innerHTML=`<div style="padding:40px 0;text-align:center;color:#94a3b8">
      <i class="ti ti-heart" style="font-size:40px;display:block;margin-bottom:12px;opacity:.3"></i>
      <div style="font-size:13px">お気に入りはまだありません</div></div>`;return;
  }
  container.innerHTML=favProps.map(p=>{
    const photos=p.photoURLs||[];
    return `<div class="prop-list-item" style="cursor:pointer" onclick="showPropDetail(${p.id})">
      <div class="prop-thumb" style="${photos[0]?'background-image:url('+photos[0]+');background-size:cover;background-position:center':''}">
        ${!photos[0]?'<i class="ti ti-building"></i>':''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;margin-bottom:3px;color:var(--navy)">${p.name}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:4px">¥${Number(p.price).toLocaleString()} / ${p.madori} / ${p.size}㎡</div>
        <div style="font-size:11px;color:#94a3b8">${p.station||''}${p.walkMin?' 徒歩'+p.walkMin+'分':''}</div>
      </div>
      <button class="btn btn-sm" style="flex-shrink:0;color:var(--red)" onclick="event.stopPropagation();toggleFav(${p.id},null)">
        <i class="ti ti-heart"></i>
      </button>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════
   HISTORY
══════════════════════════════════════ */
function formatTimeAgo(date){
  const diff=Date.now()-date.getTime();
  const min=Math.floor(diff/60000),hr=Math.floor(diff/3600000),day=Math.floor(diff/86400000);
  if(min<1) return 'たった今';if(min<60) return min+'分前';if(hr<24) return hr+'時間前';return day+'日前';
}
function addToHistory(prop){
  viewHistory=viewHistory.filter(h=>h.id!==prop.id);
  viewHistory.unshift({id:prop.id,name:prop.name,area:prop.area,madori:prop.madori,time:new Date()});
  if(viewHistory.length>50) viewHistory=viewHistory.slice(0,50);
  if(currentUser){currentUser.history=viewHistory.map(h=>({...h,time:h.time.toISOString()}));saveUserToAWS(currentUser);}
}
function renderHistory(){
  const container=document.getElementById('mp-hist-list');if(!container) return;
  if(!viewHistory.length){
    container.innerHTML=`<div style="padding:40px 0;text-align:center;color:#94a3b8">
      <i class="ti ti-history" style="font-size:40px;display:block;margin-bottom:12px;opacity:.3"></i>
      <div style="font-size:13px">閲覧履歴はありません</div></div>`;return;
  }
  container.innerHTML=`<div class="card" style="padding:0;overflow:hidden">
    ${viewHistory.map(h=>`<div class="hist-item" style="cursor:pointer" onclick="showPropDetail(${h.id})">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;margin-bottom:2px;color:var(--navy)">${h.name}</div>
        <div style="font-size:11px;color:#64748b">${h.area||''} / ${h.madori||''}</div>
      </div>
      <div style="font-size:11px;color:#94a3b8;flex-shrink:0;margin-left:8px">${formatTimeAgo(h.time)}</div>
    </div>`).join('')}
  </div>
  <button class="btn btn-sm" style="margin-top:10px;color:#64748b" onclick="viewHistory=[];if(currentUser){currentUser.history=[];saveUserToAWS(currentUser);}renderHistory()">
    <i class="ti ti-trash"></i> 履歴を消去
  </button>`;
}

/* ══════════════════════════════════════
   ADMIN: USER TABLE
══════════════════════════════════════ */
function renderUserTable(){
  const q=(document.getElementById('user-search')||{}).value?.toLowerCase()||'';
  const f=(document.getElementById('user-filter')||{}).value||'';
  const tbody=document.getElementById('user-table-body');if(!tbody) return;
  const list=realUsers().filter(u=>u.role!=='master')
    .filter(u=>!q||(u.name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q)))
    .filter(u=>!f||u.role===f);
  tbody.innerHTML=list.map(u=>`<div class="admin-table-row" style="grid-template-columns:1.5fr 2fr 1fr 1fr 1fr">
    <span style="font-weight:600;color:var(--navy)">${u.name}</span>
    <span style="color:#64748b;font-size:11px">${u.email}</span>
    <span>${roleLabel(u.role)}</span>
    <span><span class="tag ${u.active?'tg':'tr'}" style="font-size:9px">${u.active?'有効':'停止中'}</span></span>
    <span style="display:flex;gap:4px">
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" title="詳細" onclick="showUserDetail('${u.email}')"><i class="ti ti-info-circle"></i></button>
      ${canManageUser(u)?`<button class="btn btn-sm" style="font-size:10px;padding:3px 8px" title="${u.active?'利用停止する':'利用を再開する'}" onclick="confirmToggleActive('${u.email}')"><i class="ti ti-${u.active?'ban':'check'}" style="color:var(--${u.active?'amber':'green'})"></i></button>`:''}
    </span>
  </div>`).join('')||'<div style="padding:14px;font-size:13px;color:#94a3b8;text-align:center">該当するユーザーはいません</div>';
}

function renderMasterUserTable(){
  const q=(document.getElementById('master-search')||{}).value?.toLowerCase()||'';
  const f=(document.getElementById('master-filter')||{}).value||'';
  const tbody=document.getElementById('master-user-table-body');if(!tbody) return;
  const list=realUsers().filter(u=>!q||(u.name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q))).filter(u=>!f||u.role===f);
  tbody.innerHTML=list.map(u=>`<div class="admin-table-row" style="grid-template-columns:1.5fr 2fr 1fr 1fr 1fr">
    <span style="font-weight:600;color:var(--navy)">${u.name}${u.role==='master'?'<span class="master-badge" style="font-size:9px;margin-left:4px"><i class="ti ti-crown" style="font-size:9px"></i></span>':''}</span>
    <span style="color:#64748b;font-size:11px">${u.email}</span>
    <span>${roleLabel(u.role)}</span>
    <span><span class="tag ${u.active?'tg':'tr'}" style="font-size:9px">${u.active?'有効':'停止中'}</span></span>
    <span style="display:flex;gap:4px">
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="showUserDetail('${u.email}')"><i class="ti ti-info-circle"></i></button>
      ${canManageUser(u)?`<button class="btn btn-sm" style="font-size:10px;padding:3px 8px" title="${u.active?'利用停止する':'利用を再開する'}" onclick="confirmToggleActive('${u.email}')">${u.active?'<i class="ti ti-ban" style="color:var(--amber)"></i>':'<i class="ti ti-check" style="color:var(--green)"></i>'}</button>`:''}
    </span>
  </div>`).join('')||'<div style="padding:14px;font-size:13px;color:#94a3b8;text-align:center">該当するユーザーはいません</div>';
}

function confirmToggleActive(email){
  const u=userStore.find(u=>u.email===email);if(!u) return;
  if(!canManageUser(u)){alert('このユーザーを変更する権限がありません');return;}
  if(u.role==='master'){alert('マスターアカウントは変更できません');return;}
  if(email===currentUser?.email){alert('自分自身のアカウントは変更できません');return;}
  if(!confirm(`ユーザー「${u.name}」を${u.active?'利用停止にします。ログインできなくなります。よろしいですか？':'利用再開しますか？'}`)) return;
  toggleUserActive(email);
}
async function deleteUser(email){
  if(!(await deleteUserFromAWS(email))) return;   // サーバーで消せた時だけ一覧からも消す
  const idx=userStore.findIndex(u=>u.email===email);if(idx>-1) userStore.splice(idx,1);
  renderUserTable();renderMasterUserTable();renderRoleTable();refreshStats();
  showToast('ユーザーを削除しました','success');
}
async function toggleUserActive(email){
  const u=userStore.find(u=>u.email===email);if(!u) return;
  u.active=!u.active;
  if(!(await saveUserToAWS(u))) u.active=!u.active;   // 失敗したら元に戻す
  renderUserTable();renderMasterUserTable();renderRoleTable();refreshStats();
  if(document.getElementById('user-detail-modal').style.display==='block') showUserDetail(email);
}
/* ロール変更(マスターのみ)。サーバーに保存できたときだけ反映する */
async function setUserRole(email,role){
  const u=userStore.find(u=>u.email===email);
  if(!u||u.role==='master'||!isMaster()) return false;
  const prev=u.role; u.role=role;
  const ok=await saveUserToAWS(u);
  if(!ok) u.role=prev; else showToast(`${u.name} のロールを変更しました`,'success');
  renderRoleTable();renderMasterUserTable();renderUserTable();refreshStats();refreshPermissionViews();
  return ok;
}
window.setUserRole=setUserRole;

/* ══════════════════════════════════════
   USER DETAIL MODAL
══════════════════════════════════════ */
function showUserDetail(email){
  const u=userStore.find(u=>u.email===email);if(!u) return;
  const modal=document.getElementById('user-detail-modal');
  document.getElementById('user-detail-content').innerHTML=`
    <div style="text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
      <div class="avatar" style="margin:0 auto 10px;pointer-events:none;${u.photoURL?'background-image:url('+u.photoURL+');background-size:cover;background-position:center':''}">
        ${u.photoURL?'':u.name.charAt(0)}
      </div>
      <div style="font-size:17px;font-weight:800;color:var(--navy)">${u.name}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">${u.email}</div>
      <div style="margin-top:8px">${roleLabel(u.role)}</div>
    </div>
    ${isMaster()?`<div style="background:var(--gold-l);border:1px solid var(--gold-border,#f0d070);border-radius:var(--r-md);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:10px"><i class="ti ti-crown"></i> マスター専用</div>
      <div style="display:grid;gap:7px;font-size:12px">
        ${[['メール',u.email],['ロール',u.role],['状態',u.active?'有効':'停止中'],
           ['グループ',u.groupName?u.groupName+'（'+u.groupId+'）':'未所属']].map(([l,v])=>`
        <div style="display:flex;justify-content:space-between"><span style="color:#64748b">${l}</span><span style="font-weight:600">${v}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:4px;border-top:1px dashed rgba(0,0,0,.08)">
          <span style="color:#64748b">パスワード</span>
          <span style="font-size:11px;color:#94a3b8"><i class="ti ti-lock"></i> 暗号化されています</span>
        </div>
      </div>
    </div>`:''}
    <!-- メール送信 -->
    <div style="background:var(--surface2);border-radius:var(--r-md);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px"><i class="ti ti-mail"></i> このユーザーにメールを送る</div>
      <input class="finput" id="ud-mail-subject" placeholder="件名" style="font-size:12px;margin-bottom:6px">
      <textarea class="finput" id="ud-mail-body" rows="3" placeholder="本文" style="font-size:12px;resize:vertical;margin-bottom:8px"></textarea>
      <div id="ud-mail-status" style="display:none;font-size:11px;margin-bottom:6px"></div>
      <button class="btn btn-p btn-sm" style="width:100%;justify-content:center" onclick="sendMailToUser('${email}')">
        <i class="ti ti-send"></i> 送信する
      </button>
    </div>
    ${canManageUser(u)?`<div style="background:var(--surface2);border-radius:var(--r-md);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">ロール変更</div>
      <div style="display:flex;gap:8px">
        <select class="finput" id="user-detail-role" style="font-size:12px;padding:5px 8px">
          <option value="user" ${u.role==='user'?'selected':''}>一般ユーザー</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>管理者</option>
        </select>
        <button class="btn btn-sm" onclick="changeRoleFromDetail('${email}')">変更</button>
      </div>
    </div>`:''}
    ${canManageUser(u)?`<button class="btn" style="width:100%;justify-content:center;padding:10px;color:${u.active?'var(--amber)':'var(--green)'}" onclick="confirmToggleActive('${email}')">
      <i class="ti ${u.active?'ti-ban':'ti-check'}"></i> ${u.active?'利用停止にする':'利用を再開する'}
    </button>
    <p style="font-size:11px;color:#94a3b8;margin-top:8px;line-height:1.6">アカウントの削除（退会）は本人がマイページから行います。パスワードを忘れたときは、本人がログイン画面から再設定します。</p>`:''}`;
  modal.style.display='block';
}

/* ユーザー詳細からメール送信 */
async function sendMailToUser(email){
  const subject=(document.getElementById('ud-mail-subject')||{}).value?.trim()||'';
  const bodyText=(document.getElementById('ud-mail-body')||{}).value?.trim()||'';
  const status=document.getElementById('ud-mail-status');
  const show=(t,ok)=>{if(status){status.style.cssText=`display:block;font-size:11px;margin-bottom:6px;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;}};
  if(!subject||!bodyText){show('件名と本文を入力してください',false);return;}
  show('送信中...',true);
  // サイト内メールにも保存
  await saveMessage({
    id:'m'+Date.now(), to:email, from:(currentUser&&currentUser.email)||'',
    fromName:(currentUser&&currentUser.name)||'運営',
    subject, body:bodyText, time:new Date().toISOString(), read:false
  });
  const ok=await sendRealMail(email, subject, bodyText);
  show(ok?'✓ 送信しました（サイト内メール＋メール）':'✓ サイト内メールに送信しました', true);
  const s=document.getElementById('ud-mail-subject');if(s) s.value='';
  const b=document.getElementById('ud-mail-body');if(b) b.value='';
  setTimeout(()=>{if(status) status.style.display='none';},3000);
}
window.sendMailToUser=sendMailToUser;

/* マスターによる代理パスワードリセット */
async function adminResetPassword(targetEmail){
  const newPass=(document.getElementById('ud-new-pass')||{}).value?.trim()||'';
  const masterPass=(document.getElementById('ud-master-pass')||{}).value||'';
  const status=document.getElementById('ud-reset-status');
  const show=(t,ok)=>{if(status){status.style.cssText=`display:block;font-size:11px;margin-bottom:6px;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;}};
  if(!newPass){show('新しいパスワードを入力してください',false);return;}
  if(newPass.length<6){show('パスワードは6文字以上で入力してください',false);return;}
  if(!masterPass){show('あなた（マスター）のパスワードを入力してください',false);return;}
  if(!isMaster()){show('マスター権限が必要です',false);return;}
  if(!AWS_API_URL){show('サーバーに接続できません',false);return;}
  if(!confirm(`「${targetEmail}」のパスワードをリセットしますか？\n\n新しいパスワード: ${newPass}\n\n※このパスワードを本人にお伝えください。`)) return;
  show('リセット中...',true);
  try{
    const res=await fetch(AWS_API_URL+'?action=adminResetPassword',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        targetEmail, newPassword:newPass,
        masterEmail:currentUser.email, masterPassword:masterPass
      })
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok){ show(d.error||'リセットに失敗しました',false); return; }
    if(!d.success){ show('リセットに失敗しました',false); return; }
    show('✓ パスワードをリセットしました。本人にお伝えください',true);
    const np=document.getElementById('ud-new-pass');if(np) np.value='';
    const mp=document.getElementById('ud-master-pass');if(mp) mp.value='';
    // サイト内メールでも通知
    await saveMessage({
      id:'m'+Date.now(), to:targetEmail, from:currentUser.email, fromName:currentUser.name||'運営',
      subject:'【VR Homes】パスワードが再設定されました',
      body:'管理者によりパスワードが再設定されました。新しいパスワードは管理者からお受け取りください。\nログイン後、マイページから任意のパスワードに変更できます。',
      time:new Date().toISOString(), read:false
    });
  }catch(e){
    show('通信エラーが発生しました',false);
  }
}
window.adminResetPassword=adminResetPassword;

/* 自分のパスワードを変更（ログイン中の本人） */
async function changeMyPassword(){
  const cur=(document.getElementById('pc-current')||{}).value||'';
  const np=(document.getElementById('pc-new')||{}).value||'';
  const np2=(document.getElementById('pc-new2')||{}).value||'';
  const msg=document.getElementById('pc-msg');
  const show=(t,ok)=>{
    if(!msg) return;
    msg.style.cssText=`display:block;background:${ok?'var(--green-l)':'rgba(220,38,38,.08)'};border:1px solid ${ok?'#86efac':'#fecaca'};color:${ok?'var(--green)':'var(--red)'};border-radius:var(--r-md);padding:9px 13px;font-size:13px;margin-bottom:14px`;
    msg.textContent=t;
  };
  if(!currentUser){show('ログインしてください',false);return;}
  if(!cur||!np||!np2){show('すべての項目を入力してください',false);return;}
  if(np.length<6){show('新しいパスワードは6文字以上で入力してください',false);return;}
  if(np!==np2){show('新しいパスワードが一致しません',false);return;}
  if(cur===np){show('現在のパスワードと同じです',false);return;}

  // デモ・マスターなどフロント定数アカウントはサーバーに無いので変更不可
  const isLocalOnly=[DEMO_USER,DEMO_ADMIN].some(u=>u.email===currentUser.email);
  if(isLocalOnly){
    show('デモアカウントのパスワードは変更できません',false);return;
  }
  if(!AWS_API_URL){show('サーバーに接続できません',false);return;}
  show('変更中...',true);
  try{
    const res=await fetch(AWS_API_URL+'?action=changePassword',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:currentUser.email, currentPassword:cur, newPassword:np})
    });
    const d=await res.json().catch(()=>({}));
    if(!res.ok){ show(d.error||'変更に失敗しました',false); return; }
    if(!d.success){ show('変更に失敗しました',false); return; }
    show('✓ パスワードを変更しました',true);
    ['pc-current','pc-new','pc-new2'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});
    setTimeout(()=>{if(msg) msg.style.display='none';},4000);
  }catch(e){
    show('通信エラーが発生しました',false);
  }
}
window.changeMyPassword=changeMyPassword;
function closeUserDetail(){document.getElementById('user-detail-modal').style.display='none';}
function changeRoleFromDetail(email){
  const role=document.getElementById('user-detail-role').value;
  const u=userStore.find(u=>u.email===email);if(!u||u.role==='master') return;
  if(!confirm(`「${u.name}」のロールを変更しますか？`)) return;
  setUserRole(email,role).then(()=>showUserDetail(email));
}

/* ══════════════════════════════════════
   ROLE TABLE
══════════════════════════════════════ */
function renderRoleTable(){
  const tbody=document.getElementById('role-table-body');if(!tbody) return;
  tbody.innerHTML=realUsers().filter(u=>u.role!=='master').map(u=>`<div class="admin-table-row" style="grid-template-columns:1.5fr 2fr 1fr 1fr">
    <span style="font-weight:600;color:var(--navy)">${u.name}</span>
    <span style="color:#64748b;font-size:11px">${u.email}</span>
    <span>${roleLabel(u.role)}</span>
    <span><select class="finput" style="padding:4px 8px;font-size:11px;width:auto" onchange="quickSetRole('${u.email}',this.value)">
      <option value="user" ${u.role==='user'?'selected':''}>一般</option>
      <option value="admin" ${u.role==='admin'?'selected':''}>管理者</option>
    </select></span>
  </div>`).join('');
}
function changeUserRole(){
  const email=(document.getElementById('role-target-email')||{}).value?.trim()||'';
  const role=document.getElementById('role-select').value;
  const msgEl=document.getElementById('role-msg');
  const u=userStore.find(u=>u.email===email);
  const show=(msg,ok)=>{msgEl.style.cssText=`display:block;background:${ok?'var(--green-l)':'var(--red-l)'};border:1px solid ${ok?'#86efac':'var(--red-b)'};color:${ok?'var(--green)':'var(--red)'};border-radius:var(--r-md);padding:9px 13px;font-size:13px;margin-bottom:14px`;msgEl.textContent=msg;setTimeout(()=>msgEl.style.display='none',3000);};
  if(!u){show('該当するユーザーが見つかりません',false);return;}
  if(u.role==='master'){show('マスターアカウントのロールは変更できません',false);return;}
  setUserRole(email,role).then(ok=>show(ok?`${u.name} のロールを変更しました`:'変更できませんでした',ok));
}
function quickSetRole(email,role){setUserRole(email,role);}

/* ══════════════════════════════════════
   SCREEN NAV
══════════════════════════════════════ */
/* ══════════════════════════════════════
   履歴ナビゲーション（スワイプ／戻るボタン対応）
   画面遷移・モーダルを history に積み、popstate で戻す
══════════════════════════════════════ */
let _navSuppress = false;   // popstate 由来の遷移中は pushState しない
let _navInitialized = false;

/* 現在の状態を履歴に積む */
function pushNavState(state){
  if(_navSuppress) return;
  try{
    const hash = state.modal ? `#${state.screen}/${state.modal}` : `#${state.screen}`;
    history.pushState(state, '', hash);
  }catch(e){}
}

/* 履歴の現在エントリを置き換える（初期表示・同一画面内の遷移用） */
function replaceNavState(state){
  try{
    const hash = state.modal ? `#${state.screen}/${state.modal}` : `#${state.screen}`;
    history.replaceState(state, '', hash);
  }catch(e){}
}

/* 現在開いているモーダルを取得 */
function getOpenModal(){
  const pd=document.getElementById('pd-overlay');
  if(pd&&pd.classList.contains('show')) return 'detail';
  const ct=document.getElementById('contact-overlay');
  if(ct&&ct.classList.contains('show')) return 'contact';
  const fe=document.getElementById('floor-editor-overlay');
  if(fe&&fe.classList.contains('show')) return 'floor';
  const fs=document.getElementById('map-filter-sheet');
  if(fs&&fs.classList.contains('show')) return 'filter';
  return null;
}

/* 開いているモーダルをすべて閉じる（履歴を積まずに） */
function closeAllModals(){
  _navSuppress=true;
  try{
    const pd=document.getElementById('pd-overlay');
    if(pd&&pd.classList.contains('show')) closePropDetail();
    const ct=document.getElementById('contact-overlay');
    if(ct&&ct.classList.contains('show')) closeContactForm();
    const fe=document.getElementById('floor-editor-overlay');
    if(fe&&fe.classList.contains('show')) closeFloorEditor();
    const fs=document.getElementById('map-filter-sheet');
    if(fs&&fs.classList.contains('show')) closeMobileFilterSheet();
  }finally{ _navSuppress=false; }
}

/* 戻る操作（スワイプ／戻るボタン）を処理 */
function initNavigation(){
  if(_navInitialized) return;
  _navInitialized=true;

  window.addEventListener('popstate', (e)=>{
    const state=e.state;
    _navSuppress=true;
    try{
      // 開いているモーダルがあれば、まず閉じる
      const openModal=getOpenModal();
      const targetModal=state&&state.modal;
      if(openModal && openModal!==targetModal){
        closeAllModals();
      }
      // 画面を戻す
      if(state&&state.screen){
        if(!isLoggedIn){
          // 未ログインなら何もしない（ログイン画面のまま）
          return;
        }
        _applyScreen(state.screen);
        // 戻り先がモーダルなら再度開く
        if(state.modal==='detail' && state.propId!=null){
          _openDetailNoHistory(state.propId);
        }
      } else {
        // stateがない＝最初の状態。モーダルだけ閉じる
        if(openModal) closeAllModals();
      }
    }finally{ _navSuppress=false; }
  });

  // 初期状態を履歴に記録
  const initial=(location.hash||'#top').replace('#','').split('/')[0];
  replaceNavState({screen:initial||'top'});
}

/* 履歴を積まずに画面だけ切り替える（popstate用） */
function _applyScreen(id){
  const el=document.getElementById('s-'+id);
  if(!el) return;
  // 権限チェック（戻り先が権限不足なら top へ）
  if(id==='admin'&&!isAdmin()) { id='top'; }
  if(id==='master'&&!isMaster()) { id='top'; }
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('s-'+id).classList.add('active');
  const tab=document.getElementById('tab-'+id);if(tab) tab.classList.add('active');
  window.scrollTo(0,0);
  // 画面ごとの再描画
  if(id==='admin'){ renderUserTable(); renderAdminPropTable(); }
  if(id==='mypage'){ renderFavorites(); updateInboxBadge(); }
  if(id==='master'){ renderMasterUserTable();renderRoleTable();renderFieldManagement(); }
  if(id==='map') setTimeout(()=>{ if(leafletMap) leafletMap.invalidateSize(); else initLeafletMap(); },150);
}

/* 履歴を積まずに詳細を開く（popstate用） */
function _openDetailNoHistory(id){
  const prop=PROPS.find(p=>p.id===id);if(!prop) return;
  pdCurrentId=id;pdSliderIdx=0;
  document.getElementById('pd-overlay').classList.add('show');
  document.body.style.overflow='hidden';
  renderPropDetail(prop);
}

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('s-'+id).classList.add('active');
  const tab=document.getElementById('tab-'+id);if(tab) tab.classList.add('active');
  window.scrollTo(0,0);
  // 履歴に積む（同じ画面の連続pushは避ける）
  const cur=history.state;
  if(!_navSuppress && (!cur || cur.screen!==id || cur.modal)){
    pushNavState({screen:id});
  }
}
function guardedScreen(id){
  if(!isLoggedIn){const g=document.getElementById('login-gate');g.classList.remove('hidden');g.style.display='';return;}
  if(id==='admin'&&!isAdmin()){alert('管理者権限が必要です');return;}
  if(id==='master'&&!isMaster()){alert('マスター権限が必要です');return;}
  if(id==='admin'){ renderUserTable(); renderAdminPropTable(); }
  if(id==='mypage'){ renderFavorites(); updateInboxBadge(); } // マイページを開いたらお気に入りとバッジ更新
  if(id==='master'){
    renderMasterUserTable();renderRoleTable();renderFieldManagement();
  }
  showScreen(id);
  if(id==='map') setTimeout(initLeafletMap,150);
}

/* ══════════════════════════════════════
   LEAFLET MAP
══════════════════════════════════════ */
function initLeafletMap(){
  if(leafletMap){leafletMap.invalidateSize();renderMapSidebar();return;}
  const el=document.getElementById('leaf-map');if(!el) return;
  if(typeof L==='undefined'){el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;font-size:13px">地図ライブラリを読み込めませんでした</div>';return;}
  leafletMap=L.map('leaf-map',{preferCanvas:true,fadeAnimation:false,markerZoomAnimation:false}).setView([35.6762,139.6503],12);
  // ベースマップ：OSM日本（駅名が日本語で読みやすい）
  const osmJp=L.tileLayer('https://tile.openstreetmap.jp/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:18,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2});
  const carto=L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{attribution:'&copy; OpenStreetMap &copy; CARTO',subdomains:'abcd',maxZoom:19,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2});
  let osmFailed=false;
  osmJp.on('tileerror',()=>{if(!osmFailed){osmFailed=true;leafletMap.removeLayer(osmJp);carto.addTo(leafletMap);}});
  osmJp.addTo(leafletMap);
  // 鉄道強調オーバーレイ：OpenRailwayMap（路線・駅をくっきり表示）
  const railway=L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',{
    attribution:'&copy; OpenRailwayMap',
    subdomains:'abc',maxZoom:19,opacity:0.85,
    minZoom:11,  // 広域では読み込まない（軽量化）
    updateWhenIdle:true,updateWhenZooming:false,keepBuffer:1,
  });
  // ズーム11以上のときだけ鉄道レイヤーを表示（タイル読み込みを削減）
  const syncRailway=()=>{
    const z=leafletMap.getZoom();
    if(z>=11){ if(!leafletMap.hasLayer(railway)) railway.addTo(leafletMap); }
    else { if(leafletMap.hasLayer(railway)) leafletMap.removeLayer(railway); }
  };
  leafletMap.on('zoomend', syncRailway);
  syncRailway();
  PROPS.forEach(p=>{if(p.lat&&p.lng) addMapMarker(p);});
  // 地図を動かす/ズームするたびに、表示範囲内の物件を優先してサイドバー更新
  let _moveTimer=null;
  leafletMap.on('moveend zoomend',()=>{
    if(window._suppressMapResort) return; // クリック由来の移動では並べ替えない
    clearTimeout(_moveTimer);
    // 600msに延長＋マップ画面表示中のみ再描画（軽量化）
    _moveTimer=setTimeout(()=>{
      const mapScreen=document.getElementById('s-map');
      if(mapScreen&&mapScreen.classList.contains('active')) renderMapSidebar();
    },600);
  });
  renderMapSidebar();
}

function addMapMarker(prop){
  if(!leafletMap||!prop.lat||!prop.lng) return;
  if(mapMarkers[prop.id]) mapMarkers[prop.id].remove();
  const marker=L.marker([prop.lat,prop.lng]).addTo(leafletMap);
  // ポップアップは開いた時に初めて中身を生成（遅延生成で軽量化）
  marker.bindPopup(()=>buildMarkerPopup(prop),{maxWidth:240});
  // マーカークリックでその場所までズーム
  marker.on('click',()=>{
    leafletMap.flyTo([prop.lat,prop.lng],17,{duration:0.8});
    document.querySelectorAll('#map-results .result-item').forEach(el=>el.classList.toggle('on',el.dataset.propId===String(prop.id)));
  });
  mapMarkers[prop.id]=marker;
}

/* ポップアップHTMLを必要時に生成（写真も開いた時だけ遅延読み込み） */
function buildMarkerPopup(prop){
  const photos=prop.photoURLs||[];
  const photoHTML=photos[0]?`<img src="${photos[0]}" loading="lazy" style="width:100%;height:60px;object-fit:cover;border-radius:6px;margin-bottom:6px">`:'';
  const feats=(prop.features||[]).slice(0,3).map(t=>`<span style="background:#dbeafe;color:#1d4ed8;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600">${t}</span>`).join(' ');
  return `<div style="min-width:210px;font-family:-apple-system,sans-serif;cursor:pointer" onclick="showPropDetail(${prop.id})">
      ${photoHTML}
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px">${prop.name}</div>
      <div style="font-size:12px;color:#2563eb;font-weight:700;margin-bottom:3px">¥${Number(prop.price).toLocaleString()}/月</div>
      <div style="font-size:11px;color:#64748b;margin-bottom:5px">${prop.madori} / ${prop.size}㎡ / ${prop.station||''}駅 徒歩${prop.walkMin||'?'}分</div>
      <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:6px">${feats}</div>
      <div style="font-size:11px;color:#2563eb;font-weight:600">クリックして詳細を見る →</div>
    </div>`;
}

function removeMapMarker(id){if(mapMarkers[id]){mapMarkers[id].remove();delete mapMarkers[id];}}

function renderMapSidebar(){
  const container=document.getElementById('map-results');if(!container) return;
  let filtered=getFilteredProps();

  // マップの表示範囲内の物件を優先的に上位へ並べ替え
  let inViewCount=0;
  if(leafletMap){
    const bounds=leafletMap.getBounds();
    const center=leafletMap.getCenter();
    const inView=[], outView=[];
    filtered.forEach(p=>{
      if(p.lat&&p.lng&&bounds.contains([p.lat,p.lng])) inView.push(p);
      else outView.push(p);
    });
    // 範囲内は中心に近い順にソート
    const dist2=(p)=>{const dx=p.lat-center.lat,dy=p.lng-center.lng;return dx*dx+dy*dy;};
    inView.sort((a,b)=>dist2(a)-dist2(b));
    inViewCount=inView.length;
    filtered=[...inView, ...outView];
  }

  container.innerHTML=filtered.length?filtered.map((p,i)=>{
    const hasLoc=!!(p.lat&&p.lng);
    const locBadge=hasLoc?'':`<span style="font-size:9px;background:#fee2e2;color:#dc2626;padding:1px 5px;border-radius:3px;margin-left:4px">位置情報なし</span>`;
    // 表示範囲の区切り線（範囲内の最後の次に「範囲外」ラベル）
    const divider=(inViewCount>0&&i===inViewCount)?`<div style="font-size:10px;color:#94a3b8;padding:8px 4px 4px;border-top:1px dashed var(--border);margin-top:4px">― 表示範囲外の物件 ―</div>`:'';
    const inViewMark=(i<inViewCount)?`<span style="font-size:9px;background:#dbeafe;color:#1d4ed8;padding:1px 5px;border-radius:3px;margin-left:4px">表示中</span>`:'';
    return `${divider}<div class="result-item${i===0?' on':''}${hasLoc?'':' no-loc'}" data-prop-id="${p.id}" onclick="focusMapPin(${p.id})">
      <div style="font-size:12px;font-weight:600;color:var(--navy)">${p.name}${inViewMark}${locBadge}</div>
      <div style="font-size:11px;color:#64748b;margin:2px 0">¥${Number(p.price).toLocaleString()} / ${p.madori} / ${p.size}㎡</div>
      <div style="font-size:11px;color:#64748b">${p.station||''}駅 徒歩${p.walkMin||'?'}分</div>
    </div>`;
  }).join(''):'<div style="padding:14px;font-size:12px;color:#94a3b8;text-align:center">条件に合う物件が見つかりません</div>';
  const cnt=document.getElementById('map-count');
  if(cnt) cnt.textContent=inViewCount>0?`表示中 ${inViewCount}件 / 全${filtered.length}件`:filtered.length+'件';
  const cntM=document.getElementById('map-mobile-count');if(cntM) cntM.textContent=filtered.length+'件';
}

function focusMapPin(id){
  document.querySelectorAll('#map-results .result-item').forEach(el=>el.classList.toggle('on',el.dataset.propId===String(id)));
  const p=PROPS.find(p=>p.id===id);if(!p) return;
  if(p.lat&&p.lng){
    if(leafletMap){
      window._suppressMapResort=true; // クリックによる移動中は並べ替えを抑制
      leafletMap.flyTo([p.lat,p.lng],17,{duration:0.8});
      setTimeout(()=>{if(mapMarkers[id]) mapMarkers[id].openPopup();window._suppressMapResort=false;},900);
    }
    return;
  }
  const addr=normalizeAddress(p.address)||normalizeAddress(p.area)||p.station;
  if(!addr){showToast('住所が登録されていません','warn');return;}
  showToast('位置を住所から検索中...','info',2000);
  geocodeAddress(addr).then(coords=>{
    if(coords){
      p.lat=coords.lat;p.lng=coords.lng;addMapMarker(p);
      if(leafletMap){leafletMap.flyTo([p.lat,p.lng],17,{duration:0.8});setTimeout(()=>{if(mapMarkers[id]) mapMarkers[id].openPopup();},850);}
      renderMapSidebar();updatePropertyOnAWS(p).catch(()=>{});showToast('位置を特定しました','success');
    } else {showToast('住所から場所を特定できませんでした','warn');}
  });
}

function updateMapMarkerVisibility(){
  if(!leafletMap) return;
  const filteredIds=new Set(getFilteredProps().map(p=>p.id));
  PROPS.forEach(p=>{const m=mapMarkers[p.id];if(!m) return;if(filteredIds.has(p.id)){if(!leafletMap.hasLayer(m)) m.addTo(leafletMap);}else m.remove();});
}

/* ══════════════════════════════════════
   GEOCODING
══════════════════════════════════════ */
async function geocodeAddress(rawAddr){
  const addr=normalizeAddress(rawAddr);
  if(!addr) return null;
  const tryFetch=async(query)=>{
    try{
      const url='https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(query)+'&limit=1&accept-language=ja&countrycodes=jp';
      const res=await fetch(url,{headers:{'User-Agent':'VRHomes/1.0'}});
      if(!res.ok) return null;
      const data=await res.json();
      if(data.length>0) return {lat:parseFloat(data[0].lat),lng:parseFloat(data[0].lon)};
    }catch(e){console.warn('geocode error:',e);}
    return null;
  };
  let r=await tryFetch(addr);if(r) return r;
  const s2=addr.replace(/\d+[-]\d+\s*$/,'').trim();
  if(s2&&s2!==addr){r=await tryFetch(s2);if(r) return r;}
  const s3=addr.replace(/(\d+丁目).*$/,'$1').trim();
  if(s3&&s3!==s2){r=await tryFetch(s3);if(r) return r;}
  const s4=addr.replace(/\d+丁目.*$/,'').trim();
  if(s4&&s4!==s3){r=await tryFetch(s4);if(r) return r;}
  const s5m=addr.match(/^(.+[都道府県])(.+?[市区町村])/);
  if(s5m){r=await tryFetch(s5m[1]+s5m[2]);if(r) return r;}
  return null;
}

/* 座標から最寄り駅を検索（Overpass API：半径2km内の駅を距離順に） */
async function findNearestStation(lat,lng){
  // 鉄道駅・地下鉄駅のみを厳密に取得（観光地や停留所を除外）
  const query=`[out:json][timeout:20];(
    node["railway"="station"](around:2500,${lat},${lng});
    node["railway"="station"]["station"="subway"](around:2500,${lat},${lng});
    way["railway"="station"](around:2500,${lat},${lng});
  );out center body 40;`;
  const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
  for(const ep of endpoints){
    try{
      const res=await fetch(ep,{method:'POST',body:'data='+encodeURIComponent(query)});
      if(!res.ok) continue;
      const data=await res.json();
      let els=(data.elements||[]).filter(e=>{
        const t=e.tags||{};
        // 駅名があり、かつ鉄道駅であること（観光地・バス停等を除外）
        if(!(t.name||t['name:ja'])) return false;
        if(t.railway!=='station') return false;
        // 廃駅・貨物駅などを除外
        if(t.disused==='yes'||t.abandoned==='yes'||t.usage==='freight') return false;
        return true;
      });
      if(!els.length) continue;
      // 座標補正（way の場合は center を使う）
      els.forEach(e=>{
        if(e.type==='way'&&e.center){e.lat=e.center.lat;e.lon=e.center.lon;}
      });
      // 距離計算
      const toRad=d=>d*Math.PI/180;
      const dist=(la,lo)=>{
        const R=6371000,dLa=toRad(la-lat),dLo=toRad(lo-lng);
        const a=Math.sin(dLa/2)**2+Math.cos(toRad(lat))*Math.cos(toRad(la))*Math.sin(dLo/2)**2;
        return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
      };
      els.forEach(e=>{e._d=dist(e.lat,e.lon);});
      els.sort((a,b)=>a._d-b._d);
      // 同名駅の重複を除去（路線違いで同じ駅名が複数出ることがある）
      const seen=new Set();
      const unique=[];
      for(const e of els){
        const nm=(e.tags['name:ja']||e.tags.name||'').replace(/駅$/,'').replace(/\s*Station$/i,'');
        if(seen.has(nm)) continue;
        seen.add(nm);
        // 路線名を取得（line, network, operator の順で拾う）
        const line=e.tags['line']||e.tags['railway:ref']||e.tags['network']||e.tags['operator']||'';
        unique.push({
          name:nm,
          line:line.replace(/\s*Line$/i,'線').trim(),
          walkMin:Math.max(1,Math.ceil(e._d/80)),
          distance:Math.round(e._d)
        });
        if(unique.length>=3) break; // 上位3駅
      }
      return unique; // 配列で返す
    }catch(e){ console.warn('station search error:',e); }
  }
  return null;
}

/* 住所欄から座標を取得し、最寄駅（複数）・徒歩分を自動入力 */
let _autoFilling=false;
async function autoFillFromAddress(){
  if(_autoFilling) return;
  const addrEl=document.getElementById('af-address');
  const statusEl=document.getElementById('af-geo-status');
  const addr=(addrEl?.value||'').trim();
  const setStatus=(text,type)=>{
    if(!statusEl) return;
    const colors={info:'#2563eb',ok:'#16a34a',warn:'#d97706',err:'#dc2626'};
    statusEl.style.cssText=`font-size:11px;margin-top:5px;display:block;color:${colors[type]||colors.info}`;
    statusEl.textContent=text;
  };
  if(!addr){ setStatus('住所を入力してください','warn'); return; }
  _autoFilling=true;
  setStatus('📍 住所から位置を検索中...','info');
  try{
    const coords=await geocodeAddress(addr);
    if(!coords){ setStatus('住所から位置を特定できませんでした。番地を省いて試してください','err'); _autoFilling=false; return; }
    const areaEl=document.getElementById('af-area');
    if(areaEl&&!areaEl.value.trim()){
      const m=normalizeAddress(addr).match(/^(.+?[都道府県])?(.+?[市区町村])/);
      if(m) areaEl.value=(m[1]||'')+(m[2]||'');
    }
    setStatus('🚉 最寄り駅を検索中...','info');
    const stations=await findNearestStation(coords.lat,coords.lng);
    if(stations&&stations.length){
      // 1駅目をメインの駅欄に入れる
      const stEl=document.getElementById('af-station');
      const walkEl=document.getElementById('af-walk-min');
      if(stEl) stEl.value=stations[0].name;
      if(walkEl) walkEl.value=stations[0].walkMin;
      // 複数駅を af-stations（詳細用）に保存
      window._afStations=stations;
      // アクセス欄に複数駅を表示
      const accessEl=document.getElementById('af-access');
      if(accessEl){
        accessEl.value=stations.map(s=>
          `${s.line?s.line+'/':''}${s.name}駅 徒歩${s.walkMin}分`
        ).join('\n');
      }
      const list=stations.map(s=>`${s.name}駅(徒歩${s.walkMin}分)`).join('、');
      setStatus(`✓ 最寄り駅 ${stations.length}件：${list} を自動入力しました`,'ok');
    } else {
      setStatus('✓ 位置は特定できましたが、近くに駅が見つかりませんでした','warn');
    }
    window._afGeoCoords={lat:coords.lat,lng:coords.lng};
  }catch(e){
    setStatus('エラーが発生しました：'+e.message,'err');
  }
  _autoFilling=false;
}

/* ══════════════════════════════════════
   AWS PROPERTY
══════════════════════════════════════ */
async function uploadToAWS(prop){
  if(!AWS_API_URL) return null;
  try{
    const res=await fetch(AWS_API_URL+'?action=add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...prop})});
    const d=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(d.error||`HTTP ${res.status}`);
    showDataSourceBadge('AWS');
    return d.id!=null?d.id:null;   // サーバーが付けた物件番号
  }catch(e){console.error('AWS POST失敗:',e.message);showToast('物件の保存に失敗しました: '+e.message,'error');return null;}
}

async function updatePropertyOnAWS(prop){
  if(!AWS_API_URL) return;
  const res=await fetch(AWS_API_URL+'?action=update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...prop})});
  if(!res.ok){ const d=await res.json().catch(()=>({})); throw new Error(d.error||`HTTP ${res.status}`); }
  return res.json();
}

/* ══════════════════════════════════════
   FILTERS
══════════════════════════════════════ */
function toggleFtag(el,key,value){
  el.classList.toggle('on');
  const isOn=el.classList.contains('on');
  if(key==='walkMax'||key==='priceMax'||key==='sizeMin'){
    if(isOn){
      const parent=el.closest('.filter-tag-wrap,.ftag-wrap');
      if(parent) parent.querySelectorAll('.ftag').forEach(t=>{if(t!==el) t.classList.remove('on');});
      filterState[key]=(key==='priceMax')?parseFloat(value)*10000:parseFloat(value);
    }else{filterState[key]=null;}
  } else {
    if(!(filterState[key] instanceof Set)) filterState[key]=new Set();
    if(isOn) filterState[key].add(value);
    else filterState[key].delete(value);
  }
  currentPage=1;renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility();
}

function applyFilters(){
  const st=document.getElementById('f-search-text');if(st){filterState.searchText=st.value.trim();syncSearchToMap();}
  const pv=(document.getElementById('f-search-price')?.value)||(document.getElementById('f-adv-price')?.value)||'';
  if(pv) filterState.priceMax=parseInt(pv)*10000;
  const sv=document.getElementById('f-adv-size')?.value;if(sv) filterState.sizeMin=parseInt(sv);
  const wv=document.getElementById('f-adv-walk')?.value;if(wv) filterState.walkMax=parseInt(wv);
  currentPage=1;renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility();
}

/* 詳細フィルターのキーワード欄で検索 */
function applyKeyword(){
  const kw=document.getElementById('f-adv-keyword');
  const val=kw?kw.value.trim():'';
  filterState.searchText=val;
  // TOP検索バー・マップにも反映
  const st=document.getElementById('f-search-text');if(st) st.value=val;
  syncSearchToMap();
  currentPage=1;renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility();
  if(val){
    const n=getFilteredProps().length;
    showToast(`「${val}」で${n}件見つかりました`, n>0?'success':'warn');
  }
}

/* 地方ボタンで検索 */
function searchByRegion(region, el){
  // トグル：既に選択中なら解除
  const already = el && el.classList.contains('on');
  document.querySelectorAll('.ftag.region-on').forEach(t=>t.classList.remove('on','region-on'));
  if(already){
    filterState.searchText='';
  } else {
    if(el){ el.classList.add('on','region-on'); }
    filterState.searchText=region;
  }
  const kw=document.getElementById('f-adv-keyword');if(kw) kw.value=filterState.searchText;
  const st=document.getElementById('f-search-text');if(st) st.value=filterState.searchText;
  syncSearchToMap();
  currentPage=1;renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility();
  const n=getFilteredProps().length;
  showToast(already?'地方の絞り込みを解除しました':`${region}地方で${n}件見つかりました`, n>0||already?'info':'warn');
}


function applyMapMadoriText(){
  const inp = document.getElementById('f-map-madori-text');
  if (!inp || !inp.value.trim()) return;
  const val = inp.value.trim();
  if (!(filterState.madori instanceof Set)) filterState.madori = new Set();
  filterState.madori.add(val);
  inp.value = '';
  // 動的タグとして表示
  const wrap = inp.closest('.ftag-wrap');
  if (wrap) {
    const tag = document.createElement('span');
    tag.className = 'ftag on';
    tag.textContent = val;
    tag.onclick = () => { filterState.madori.delete(val); tag.remove(); renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility(); };
    wrap.appendChild(tag);
  }
  currentPage=1;renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility();
  showToast(`間取り「${val}」で絞り込みました`, 'info');
}

function applyMapFilters(){
  // MAPの住所入力をTOPにも反映
  const mapAddr=document.getElementById('map-addr-input');
  if(mapAddr&&mapAddr.value.trim()){
    filterState.searchText=mapAddr.value.trim();
    const topSearch=document.getElementById('f-search-text');
    if(topSearch) topSearch.value=filterState.searchText;
  }
  const pv=document.getElementById('f-map-price')?.value;if(pv) filterState.priceMax=parseInt(pv)*10000;
  const sv=document.getElementById('f-map-size')?.value;if(sv) filterState.sizeMin=parseInt(sv);
  const wv=document.getElementById('f-map-walk')?.value;if(wv) filterState.walkMax=parseInt(wv);
  currentPage=1;renderCards();updateResultsCount();renderMapSidebar();updateMapMarkerVisibility();
}

function resetFilters(){
  filterState={madori:new Set(),types:new Set(),features:new Set(),priceMax:null,sizeMin:null,walkMax:null,searchText:''};
  document.querySelectorAll('.ftag').forEach(el=>el.classList.remove('on','region-on'));
  ['f-search-text','f-search-price','f-adv-price','f-adv-size','f-adv-walk','f-map-price','f-map-size','f-map-walk','map-addr-input','f-adv-keyword'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});
  currentPage=1;
  renderCards();updateResultsCount();renderMapSidebar();
  if(leafletMap) PROPS.forEach(p=>{const m=mapMarkers[p.id];if(m&&!leafletMap.hasLayer(m)) m.addTo(leafletMap);});
}

function toggleAdvFilter(){
  const panel=document.getElementById('adv-filter-panel');
  if(!panel) return;
  panel.classList.toggle('show');
}

function getFilteredProps(){
  const txt=filterState.searchText.trim();
  return PROPS.filter(p=>{
    if(txt){ if(!matchesRegionOrText(p, txt)) return false; }
    if(filterState.priceMax!=null&&p.price>filterState.priceMax) return false;
    if(filterState.sizeMin!=null&&p.size<filterState.sizeMin) return false;
    if(filterState.walkMax!=null&&(p.walkMin||999)>filterState.walkMax) return false;
    if(filterState.madori.size>0){const m=p.madori||'';if(![...filterState.madori].some(f=>m.includes(f))) return false;}
    if(filterState.types.size>0){if(!filterState.types.has(p.type||'')) return false;}
    if(filterState.features.size>0){const pf=new Set([...(p.features||[]),...(p.tags||[])]);if(![...filterState.features].every(f=>pf.has(f))) return false;}
    return true;
  });
}

/* ══════════════════════════════════════
   PROPERTY DATA
══════════════════════════════════════ */
async function fetchAndRenderProps(){
  const grid=document.getElementById('card-grid');
  grid.innerHTML=`<div style="grid-column:1/-1;padding:40px 0;text-align:center;color:#64748b">
    <i class="ti ti-loader-2" style="font-size:24px;animation:spin 1s linear infinite;display:inline-block"></i>
    <div style="margin-top:10px;font-size:13px">物件を読み込み中…</div></div>`;
  try{
    const res=await fetch(AWS_API_URL+'?action=list',{method:'GET'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    PROPS=Array.isArray(data)?data:(data.items||data.properties||data.body||[]);
    PROPS.forEach(p=>{if(!p.photoURLs) p.photoURLs=p.photoURL?[p.photoURL]:[];if(!p.features) p.features=p.tags||[];});
    showDataSourceBadge('AWS');
  }catch(e){
    console.error('AWS接続エラー:',e);
    PROPS=DEMO_PROPS.map(p=>({...p}));
    showDataSourceBadge('local');
    grid.innerHTML=`<div style="grid-column:1/-1;padding:32px 0;text-align:center">
      <i class="ti ti-cloud-off" style="font-size:32px;display:block;margin-bottom:12px;color:var(--amber);opacity:.7"></i>
      <div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:6px">サーバーにつながりませんでした</div>
      <div style="font-size:12px;color:#64748b;max-width:400px;margin:0 auto;line-height:1.7">${e.message}</div>
      <div style="margin-top:16px"><button class="btn btn-sm" onclick="fetchAndRenderProps()"><i class="ti ti-refresh"></i> 再試行</button></div>
    </div>`;
    renderAdminPropTable();return;
  }
  renderCards();renderAdminPropTable();updateResultsCount();
  if(leafletMap){Object.values(mapMarkers).forEach(m=>m.remove());mapMarkers={};PROPS.forEach(p=>{if(p.lat&&p.lng) addMapMarker(p);});renderMapSidebar();}
  scheduleAutoGeocode();
}

let _autoGeocodeRunning=false;
async function scheduleAutoGeocode(){
  if(_autoGeocodeRunning) return;
  // 位置の保存は編集できる人だけ(他の人の物件を書き換えようとしてエラーになるのを防ぐ)
  const targets=PROPS.filter(p=>!p.lat||!p.lng).filter(p=>canEditProp(p)).filter(p=>normalizeAddress(p.address)||normalizeAddress(p.area));
  if(!targets.length) return;
  _autoGeocodeRunning=true;
  for(const p of targets){
    const addr=normalizeAddress(p.address)||normalizeAddress(p.area)||p.station;if(!addr) continue;
    try{
      const coords=await geocodeAddress(addr);
      if(coords){p.lat=coords.lat;p.lng=coords.lng;addMapMarker(p);renderMapSidebar();updatePropertyOnAWS(p).catch(()=>{});}
    }catch(e){console.warn('geocode error:',e);}
    await new Promise(r=>setTimeout(r,1100));
  }
  _autoGeocodeRunning=false;
}

/* ══════════════════════════════════════
   TOAST
══════════════════════════════════════ */
/* ══════════════════════════════════════
   お問い合わせ / サイト内メッセージ
══════════════════════════════════════ */
const INBOX_KEY = 'vr_inbox';        // ローカルフォールバック用
let _inboxCache = [];                // 現在のユーザーの受信箱（サーバーから取得）

/* サイト内メッセージを送信（サーバー保存＝別端末の相手にも届く） */
async function saveMessage(msg){
  // ① サーバーに保存（本命）
  if(AWS_API_URL){
    try{
      const res=await fetch(AWS_API_URL+'?action=sendMessage',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(msg)
      });
      if(res.ok){
        const d=await res.json().catch(()=>({}));
        if(d&&d.success) return true;
      }
    }catch(e){ console.warn('サイト内メール送信失敗:',e.message); }
  }
  // ② フォールバック：ローカルに保存（オフライン時・デモ用）
  let inbox={};
  try{ inbox=JSON.parse(localStorage.getItem(INBOX_KEY)||'{}'); }catch(e){}
  if(!inbox[msg.to]) inbox[msg.to]=[];
  inbox[msg.to].unshift(msg);
  try{ localStorage.setItem(INBOX_KEY, JSON.stringify(inbox)); }catch(e){}
  return false;
}

/* 受信箱をサーバーから取得 */
async function fetchMessages(email){
  if(AWS_API_URL){
    try{
      const res=await fetch(AWS_API_URL+'?action=getMessages&email='+encodeURIComponent(email));
      if(res.ok){
        const list=await res.json();
        if(Array.isArray(list)){ _inboxCache=list; return list; }
      }
    }catch(e){ console.warn('受信箱取得失敗:',e.message); }
  }
  // フォールバック：ローカル
  let inbox={};
  try{ inbox=JSON.parse(localStorage.getItem(INBOX_KEY)||'{}'); }catch(e){}
  _inboxCache=inbox[email]||[];
  return _inboxCache;
}

/* キャッシュから取得（同期的に使う場所用） */
function getMessagesFor(email){
  return _inboxCache;
}

async function markMessagesRead(email){
  if(AWS_API_URL){
    try{
      await fetch(AWS_API_URL+'?action=markMessagesRead',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email})
      });
    }catch(e){}
  }
  _inboxCache.forEach(m=>m.read=true);
  // ローカルも更新
  let inbox={};
  try{ inbox=JSON.parse(localStorage.getItem(INBOX_KEY)||'{}'); }catch(e){}
  if(inbox[email]){ inbox[email].forEach(m=>m.read=true); try{localStorage.setItem(INBOX_KEY, JSON.stringify(inbox));}catch(e){} }
}

function unreadCount(email){
  return _inboxCache.filter(m=>!m.read).length;
}

/* AWS経由で実メール送信を試みる */
async function sendRealMail(to, subject, body){
  if(!AWS_API_URL) return false;
  try{
    const res=await fetch(AWS_API_URL+'?action=sendMail',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({to,subject,body})
    });
    if(res.ok){ const d=await res.json().catch(()=>({})); return !!(d&&d.success); }
  }catch(e){ console.warn('メール送信失敗:',e.message); }
  return false;
}

/* 物件へのお問い合わせフォームを開く */
function escapeHtml(v){ return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function openContactForm(propId){
  const prop=PROPS.find(p=>p.id===propId);
  if(!prop){alert('物件が見つかりません');return;}
  if(!isLoggedIn){ if(window.fxRequireLogin) fxRequireLogin('お問い合わせにはログインが必要です',()=>openContactForm(propId)); return; }
  const ov=document.getElementById('contact-overlay');
  const body=document.getElementById('contact-body');
  const ownerLabel = prop.ownerName ? `${escapeHtml(prop.ownerName)} さん（この物件を登録した担当者）` : '運営';
  body.innerHTML=`
    <div style="font-size:12px;color:#64748b;margin-bottom:14px;line-height:1.7">
      <strong style="color:var(--navy)">${escapeHtml(prop.name)}</strong> について、${ownerLabel}へお問い合わせします。
    </div>
    <div style="font-size:12px;background:var(--surface2);border-radius:var(--r-md);padding:10px 12px;margin-bottom:12px;line-height:1.7">
      <div><span style="color:#64748b">送信者：</span><b>${escapeHtml(currentUser.name||'')}</b></div>
      <div><span style="color:#64748b">返信先：</span>${escapeHtml(currentUser.email||'')}</div>
      <div style="color:#94a3b8;font-size:11px">返事はサイトの受信箱とメールに届きます</div>
    </div>
    <div class="field"><div class="flabel">お問い合わせ内容</div>
      <textarea class="finput" id="ct-msg" rows="5" maxlength="3000" placeholder="内見希望日、質問など" style="resize:vertical"></textarea></div>
    <div id="ct-status" style="display:none;font-size:12px;margin-bottom:10px"></div>
    <button class="btn btn-p" style="width:100%;justify-content:center;padding:11px" onclick="submitContact(${propId})">
      <i class="ti ti-send"></i> 送信する
    </button>`;
  ov.classList.add('show');
  // 履歴に積む（戻る／スワイプで閉じられるように）
  const cur=history.state;
  pushNavState({screen:(cur&&cur.screen)||'top', modal:'contact', propId:propId});
}
/* お問い合わせを送る。宛先はサーバーが決める（物件を登録した人／運営） */
async function sendContact(propId, text){
  const res=await fetch(AWS_API_URL+'?action=contact',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(propId==null?{body:text}:{propId:propId, body:text})});
  const d=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(d.error||('HTTP '+res.status));
  return d;
}
function closeContactForm(){
  const ov=document.getElementById('contact-overlay');
  const wasOpen=ov&&ov.classList.contains('show');
  if(ov) ov.classList.remove('show');
  if(wasOpen && !_navSuppress && history.state && history.state.modal==='contact'){
    history.back();
  }
}

async function submitContact(propId){
  const prop=PROPS.find(p=>p.id===propId);if(!prop) return;
  const text=(document.getElementById('ct-msg')||{}).value?.trim()||'';
  const status=document.getElementById('ct-status');
  const show=(t,ok)=>{status.style.cssText=`display:block;font-size:12px;margin-bottom:10px;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;};
  if(!text){show('お問い合わせ内容を入力してください',false);return;}
  show('送信中...',true);
  try{
    const d=await sendContact(propId, text);
    show(d.mailed?`✓ ${d.toName}に送信しました（サイト内メール＋メール）`:`✓ ${d.toName}のサイト内メールに送信しました`,true);
    setTimeout(closeContactForm,1600);
  }catch(e){ show('送信できませんでした：'+e.message,false); }
}

/* 運営へのお問い合わせ（宛先・差出人は自動） */
async function submitMasterContact(){
  const text=(document.getElementById('mc-msg')||{}).value?.trim()||'';
  const status=document.getElementById('mc-status');
  const show=(t,ok)=>{if(status){status.style.cssText=`display:block;font-size:12px;margin:10px 0;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;}};
  if(!isLoggedIn){ if(window.fxRequireLogin) fxRequireLogin('お問い合わせにはログインが必要です'); return; }
  if(!text){show('お問い合わせ内容を入力してください',false);return;}
  show('送信中...',true);
  try{
    const d=await sendContact(null, text);
    show(d.mailed?'✓ 運営に送信しました（サイト内メール＋メール）':'✓ 運営のサイト内メールに送信しました',true);
    const el=document.getElementById('mc-msg'); if(el) el.value='';
  }catch(e){ show('送信できませんでした：'+e.message,false); }
}
function renderContactSender(){
  const box=document.getElementById('mc-sender'); if(!box) return;
  box.innerHTML=isLoggedIn&&currentUser
    ?`<span style="color:#64748b">送信者：</span><b>${escapeHtml(currentUser.name||'')}</b>　<span style="color:#64748b">返信先：</span>${escapeHtml(currentUser.email||'')}`
    :'お問い合わせにはログインが必要です';
}

/* 受信箱を描画（マイページ・受信箱タブ） */
async function renderInbox(){
  const container=document.getElementById('mp-inbox-list');
  if(!container||!currentUser) return;
  container.innerHTML=`<div style="padding:30px 0;text-align:center;color:#94a3b8;font-size:12px">読み込み中...</div>`;
  const msgs=await fetchMessages(currentUser.email);
  markMessagesRead(currentUser.email);
  updateInboxBadge();
  if(!msgs.length){
    container.innerHTML=`<div style="padding:40px 0;text-align:center;color:#94a3b8">
      <i class="ti ti-inbox" style="font-size:40px;display:block;margin-bottom:12px;opacity:.3"></i>
      <div style="font-size:13px">受信メッセージはありません</div></div>`;return;
  }
  container.innerHTML=msgs.map(m=>`
    <div class="card" style="margin-bottom:10px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;color:var(--navy)">${m.subject}</div>
        <div style="font-size:11px;color:#94a3b8;flex-shrink:0;margin-left:8px">${m.time?formatTimeAgo(new Date(m.time)):''}</div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-bottom:8px">
        <i class="ti ti-user"></i> ${escapeHtml(m.fromName||'不明')}
      </div>
      <div style="font-size:13px;color:var(--navy);line-height:1.7;white-space:pre-wrap;background:var(--surface2);border-radius:8px;padding:12px">${m.body||''}</div>
    </div>`).join('');
}

async function updateInboxBadge(){
  if(!currentUser) return;
  // キャッシュが空ならサーバーから取得
  if(!_inboxCache.length){ await fetchMessages(currentUser.email); }
  const n=unreadCount(currentUser.email);
  const badge=document.getElementById('mp-inbox-badge');
  if(badge){ badge.textContent=n; badge.style.display=n>0?'inline-block':'none'; }
}

/* ══════════════════════════════════════
   VRシステム ダウンロード
   ※ VR_SYSTEM_URL に実際のダウンロードURLを設定してください
     （GitHub Release / Google Drive / S3 など）
══════════════════════════════════════ */
const VR_SYSTEM_URL = ''; // 例: 'https://github.com/shimayu8859-a11y/vr-homes/releases/download/v1.0/FloorPlayVR6.zip'

function handleVRDownload(event){
  if(!VR_SYSTEM_URL){
    event.preventDefault();
    showToast('VRシステムは現在準備中です。もうしばらくお待ちください', 'info', 4000);
    return false;
  }
  // URL設定済みならそのままダウンロード
  const link=document.getElementById('vr-download-link');
  if(link) link.href=VR_SYSTEM_URL;
  showToast('ダウンロードを開始します', 'success');
  return true;
}
window.handleVRDownload=handleVRDownload;

function showToast(message,type='info',duration=3500){
  let host=document.getElementById('toast-container');
  if(!host){host=document.createElement('div');host.id='toast-container';host.className='toast-container';document.body.appendChild(host);}
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  const icons={info:'ti-info-circle',success:'ti-check',warn:'ti-alert-triangle',error:'ti-x'};
  el.innerHTML=`<i class="ti ${icons[type]||icons.info}" style="font-size:16px;flex-shrink:0"></i><span>${message}</span>`;
  host.appendChild(el);
  setTimeout(()=>{el.style.transition='opacity .3s,transform .3s';el.style.opacity='0';el.style.transform='translateX(20px)';setTimeout(()=>el.remove(),300);},duration);
}

function showDataSourceBadge(source){
  return;   // 開発用の表示なので出さない
  let b=document.getElementById('data-source-badge');
  if(!b){
    b=document.createElement('div');b.id='data-source-badge';
    b.style.cssText='display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:4px 11px;border-radius:20px';
    const bar=document.querySelector('.results-bar > div:last-child');if(bar) bar.prepend(b);
  }
  if(source==='AWS'){b.style.background='var(--green-l)';b.style.color='var(--green)';b.style.border='1px solid #86efac';b.innerHTML='<i class="ti ti-cloud-check"></i>AWS同期済み';}
  else{b.style.background='var(--amber-l)';b.style.color='var(--amber)';b.style.border='1px solid #fcd34d';b.innerHTML='<i class="ti ti-database"></i>ローカルデータ';}
}

/* ══════════════════════════════════════
   CARDS
══════════════════════════════════════ */
let currentPage = 1;
const PROPS_PER_PAGE = 12; // 1ページあたりの物件数

function renderCards(){
  const grid=document.getElementById('card-grid');
  const filtered=getFilteredProps();
  if(!filtered.length){
    grid.innerHTML=`<div style="grid-column:1/-1;padding:48px 0;text-align:center;color:#94a3b8">
      <i class="ti ti-building-off" style="font-size:40px;display:block;margin-bottom:14px;opacity:.4"></i>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">${PROPS.length===0?'物件が登録されていません':'条件に合う物件が見つかりません'}</div>
    </div>`;
    const pager=document.getElementById('pagination');if(pager) pager.innerHTML='';
    return;
  }
  // ページ範囲を計算
  const totalPages=Math.ceil(filtered.length/PROPS_PER_PAGE);
  if(currentPage>totalPages) currentPage=totalPages;
  if(currentPage<1) currentPage=1;
  const start=(currentPage-1)*PROPS_PER_PAGE;
  const pageProps=filtered.slice(start, start+PROPS_PER_PAGE);
  grid.innerHTML=pageProps.map(p=>{
    const isFav=favs.has(p.id);
    const photos=p.photoURLs||[];
    const photoStyle=photos[0]?`background-image:url(${photos[0]});background-size:cover;background-position:center;`:'';
    const features=p.features||p.tags||[];
    return `<div class="prop-card" onclick="showPropDetail(${p.id})">
      <div class="prop-img" style="${photoStyle}">
        ${!photos[0]?'<i class="ti ti-building prop-img-placeholder"></i>':''}
        ${(p.floorplanData||p.splatURL)?`<div class="prop-vr-badge"><i class="ti ti-vr"></i> ${p.splatURL?'実写VR':'VR対応'}</div>`:''}
        ${photos.length>1?`<div style="position:absolute;bottom:6px;left:8px;background:rgba(0,0,0,.5);color:#fff;border-radius:12px;padding:2px 8px;font-size:10px;font-weight:600"><i class="ti ti-photo"></i> ${photos.length}</div>`:''}
        <div class="fav-btn${isFav?' on':''}" data-prop-id="${p.id}" onclick="event.stopPropagation();toggleFav(${p.id},this)">
          <i class="ti ti-heart"></i>
        </div>
      </div>
      <div class="prop-body">
        <div class="prop-price">¥${Number(p.price).toLocaleString()}<span class="prop-price-sub">/月</span></div>
        <div class="prop-name">${p.name}</div>
        <div class="prop-loc"><i class="ti ti-map-pin"></i>${p.station||p.area||''}${p.walkMin?' 徒歩'+p.walkMin+'分':''}</div>
        <div class="prop-tags">
          <span class="tag tg">${p.madori||''}</span>
          ${features.slice(0,2).map(t=>`<span class="tag tgr">${t}</span>`).join('')}
        </div>
      </div>
      <div class="prop-footer">
        <span class="prop-area">${p.size||'−'}㎡ / ${p.type||''}</span>
        <span class="tag tb" style="font-size:9px">VR対応</span>
      </div>
    </div>`;
  }).join('');
  // ページネーションUIを描画
  renderPagination(filtered.length, totalPages);
}

/* ページネーションUI */
function renderPagination(totalItems, totalPages){
  let pager=document.getElementById('pagination');
  if(!pager){
    pager=document.createElement('div');
    pager.id='pagination';
    pager.style.cssText='display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap;padding:24px 12px 8px';
    const grid=document.getElementById('card-grid');
    if(grid&&grid.parentNode) grid.parentNode.insertBefore(pager, grid.nextSibling);
  }
  if(totalPages<=1){ pager.innerHTML=''; return; }
  const btn=(label, page, opts={})=>{
    const {disabled=false, active=false}=opts;
    return `<button ${disabled?'disabled':''} onclick="goToPage(${page})"
      style="min-width:38px;height:38px;padding:0 10px;border-radius:9px;font-size:13px;font-weight:700;cursor:${disabled?'default':'pointer'};
      border:1px solid ${active?'var(--blue)':'var(--border)'};
      background:${active?'var(--blue)':'var(--surface)'};
      color:${active?'#fff':disabled?'#cbd5e1':'var(--navy)'};
      font-family:inherit;transition:all .15s">${label}</button>`;
  };
  // 表示するページ番号の範囲（現在ページの前後2つ）
  let pages=[];
  const range=2;
  for(let i=1;i<=totalPages;i++){
    if(i===1||i===totalPages||(i>=currentPage-range&&i<=currentPage+range)) pages.push(i);
    else if(pages[pages.length-1]!=='...') pages.push('...');
  }
  let html='';
  html+=btn('<i class="ti ti-chevron-left"></i>', currentPage-1, {disabled:currentPage===1});
  pages.forEach(p=>{
    if(p==='...') html+=`<span style="padding:0 4px;color:#94a3b8">…</span>`;
    else html+=btn(p, p, {active:p===currentPage});
  });
  html+=btn('<i class="ti ti-chevron-right"></i>', currentPage+1, {disabled:currentPage===totalPages});
  // 件数表示
  const startN=(currentPage-1)*PROPS_PER_PAGE+1;
  const endN=Math.min(currentPage*PROPS_PER_PAGE, totalItems);
  html+=`<div style="width:100%;text-align:center;font-size:12px;color:#94a3b8;margin-top:10px">全${totalItems}件中 ${startN}〜${endN}件を表示</div>`;
  pager.innerHTML=html;
}

function goToPage(page){
  currentPage=page;
  renderCards();
  // カードグリッドの先頭へスクロール
  const grid=document.getElementById('card-grid');
  if(grid) grid.scrollIntoView({behavior:'smooth', block:'start'});
}
window.goToPage=goToPage;

function updateResultsCount(){
  const el=document.getElementById('results-count');
  if(el) el.textContent=getFilteredProps().length;
}

function renderAdminPropTable(){
  const tbody=document.getElementById('prop-table-body');if(!tbody) return;
  if(!PROPS.length){tbody.innerHTML='<div style="padding:16px;text-align:center;color:#94a3b8;font-size:13px">物件が登録されていません</div>';return;}
  tbody.innerHTML=PROPS.map(p=>{
    const canEdit=canEditProp(p);
    const ownerLabel=p.ownerName?`<span style="font-size:10px;color:#94a3b8">投稿: ${p.ownerName}</span>`:'';
    const editBtns=canEdit?`
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;color:var(--blue)" onclick="startEditProp(${p.id})"><i class="ti ti-pencil"></i></button>
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px;color:var(--red)" onclick="if(confirm('削除しますか？')) deleteProp(${p.id})"><i class="ti ti-trash"></i></button>`
      :`<span style="font-size:10px;color:#cbd5e1;padding:3px 8px" title="編集権限がありません"><i class="ti ti-lock"></i></span>`;
    return `<div class="admin-table-row" style="grid-template-columns:2fr 1fr 1fr 130px">
    <span style="font-weight:700;color:var(--navy)">${p.name}${p.floorplanData?'<span class="tag tb" style="font-size:9px;margin-left:4px">VR</span>':''}${p.splatURL?'<span class="tag tb" style="font-size:9px;margin-left:4px">実写</span>':''}<br>${ownerLabel}</span>
    <span style="color:#64748b">${p.area}</span>
    <span style="color:var(--blue);font-weight:700">¥${Number(p.price).toLocaleString()}</span>
    <span style="display:flex;gap:5px">
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="showPropDetail(${p.id})"><i class="ti ti-eye"></i></button>
      ${editBtns}
    </span>
  </div>`;
  }).join('');
}

async function deleteProp(id){
  const prop=PROPS.find(p=>p.id===id);
  if(!canEditProp(prop)){showToast('この物件を削除する権限がありません','warn');return;}
  // 先にサーバーで消して、成功したら画面からも消す(失敗したのに消えて見えるのを防ぐ)
  const ok=await deletePropFromAWS(id);
  if(!ok) return;
  PROPS=PROPS.filter(p=>p.id!==id);removeMapMarker(id);favs.delete(id);
  renderCards();renderAdminPropTable();renderMapSidebar();updateResultsCount();
  showToast('「'+prop.name+'」を削除しました','success');
}

/* ══════════════════════════════════════
   EDIT PROPERTY
══════════════════════════════════════ */
let editingPropId=null, editingExistingPhotos=[];

function startEditProp(id){
  const prop=PROPS.find(p=>p.id===id);if(!prop){alert('物件が見つかりません');return;}
  if(!canEditProp(prop)){showToast('この物件を編集する権限がありません','warn');return;}
  editingPropId=id;editingExistingPhotos=[...(prop.photoURLs||[])];
  // 管理画面の「物件管理」タブを開いてからフォームを出す(別のタブにいると見えないため)
  if(!document.getElementById('s-admin').classList.contains('active')) guardedScreen('admin');
  switchAdmin('props',document.querySelector('#s-admin .admin-nav-item[onclick*="\'props\'"]'));
  const form=document.getElementById('add-form');
  if(form&&!form.classList.contains('show')) toggleAddForm();
  document.getElementById('af-form-title').textContent='物件を編集: '+prop.name;
  document.getElementById('af-edit-badge').style.display='inline-block';
  document.getElementById('af-submit-btn').innerHTML='<i class="ti ti-device-floppy"></i> 変更を保存';
  const set=(id,v)=>{const el=document.getElementById(id);if(el) el.value=v==null?'':v;};
  set('af-name',prop.name);set('af-area',prop.area);set('af-rent',prop.price);set('af-mgmt',prop.mgmt);
  set('af-deposit',prop.deposit);set('af-key',prop.key);set('af-madori',prop.madori);set('af-size',prop.size);
  set('af-station',prop.station);set('af-walk-min',prop.walkMin);set('af-address',prop.address);
  set('af-desc',prop.description);set('af-age',prop.age);
  set('af-access',prop.access);
  // 詳細情報を読み込み
  const d=prop.details||{};
  set('af-available',d.available);set('af-transaction',d.transaction);set('af-units',d.units);
  set('af-parking',d.parking);set('af-contract',d.contract);set('af-renewal',d.renewal);
  set('af-guarantor',d.guarantor);set('af-conditions',d.conditions);set('af-insurance',d.insurance);
  set('af-otherfees',d.otherfees);set('af-surroundings',d.surroundings);
  _newPhotoQueue=[]; renderNewPhotoPreview(); // 新規写真キューをリセット
  const selType=document.getElementById('af-type');
  if(selType){for(let i=0;i<selType.options.length;i++) if(selType.options[i].text===prop.type){selType.selectedIndex=i;break;}}
  const selStr=document.getElementById('af-structure');
  if(selStr){for(let i=0;i<selStr.options.length;i++) if(selStr.options[i].text===prop.structure){selStr.selectedIndex=i;break;}}
  renderExistingPhotosPreview();
  window.editedFloorplanData=prop.floorplanData||null;
  window.editedFloorplanThumb=prop.floorplanURL||null;
  window.editedSplat=prop.splatURL?{url:prop.splatURL,transform:prop.splatTransform||null}:null;
  _renderSplatStatus();
  if(typeof _applyFloorplanThumbnail==='function') _applyFloorplanThumbnail();
  const photoInput=document.getElementById('af-photo');if(photoInput) photoInput.value='';
  setTimeout(()=>form.scrollIntoView({behavior:'smooth',block:'start'}),50);
}

function renderExistingPhotosPreview(){
  const wrap=document.getElementById('af-existing-photos');
  const list=document.getElementById('af-existing-photos-list');
  const hint=document.getElementById('af-new-photos-hint');
  if(!wrap||!list) return;
  if(editingPropId==null||editingExistingPhotos.length===0){
    wrap.style.display='none';if(hint) hint.style.display=editingPropId!=null?'block':'none';return;
  }
  wrap.style.display='block';if(hint) hint.style.display='block';
  list.innerHTML=editingExistingPhotos.map((url,i)=>`
    <div style="width:80px">
      <div style="position:relative;width:80px;height:60px;border:2px solid ${i===0?'var(--blue)':'var(--border)'};border-radius:6px;overflow:hidden">
        <img src="${url}" style="width:100%;height:100%;object-fit:cover">
        ${i===0?'<div style="position:absolute;top:0;left:0;background:var(--blue);color:#fff;font-size:8px;font-weight:700;padding:1px 4px;border-bottom-right-radius:5px">メイン</div>':''}
        <button onclick="removeExistingPhoto(${i})" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(220,38,38,.9);color:#fff;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;padding:0">✕</button>
      </div>
      <div style="display:flex;justify-content:center;gap:3px;margin-top:2px">
        <button type="button" onclick="moveExistingPhoto(${i},-1)" ${i===0?'disabled':''} style="width:24px;height:20px;border-radius:4px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:11px;padding:0">←</button>
        <button type="button" onclick="moveExistingPhoto(${i},1)" ${i===editingExistingPhotos.length-1?'disabled':''} style="width:24px;height:20px;border-radius:4px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:11px;padding:0">→</button>
      </div>
    </div>`).join('');
}

function moveExistingPhoto(index, dir){
  const ni=index+dir;
  if(ni<0||ni>=editingExistingPhotos.length) return;
  [editingExistingPhotos[index], editingExistingPhotos[ni]]=[editingExistingPhotos[ni], editingExistingPhotos[index]];
  renderExistingPhotosPreview();
}
window.moveExistingPhoto=moveExistingPhoto;

function removeExistingPhoto(index){editingExistingPhotos.splice(index,1);renderExistingPhotosPreview();}
window.removeExistingPhoto=removeExistingPhoto;

function resetEditMode(){
  editingPropId=null;editingExistingPhotos=[];
  document.getElementById('af-form-title').textContent='新規物件登録';
  document.getElementById('af-edit-badge').style.display='none';
  document.getElementById('af-submit-btn').innerHTML='<i class="ti ti-check"></i> 登録する';
  document.getElementById('af-existing-photos').style.display='none';
  const hint=document.getElementById('af-new-photos-hint');if(hint) hint.style.display='none';
}
window.startEditProp=startEditProp;window.resetEditMode=resetEditMode;
/* 物件詳細から編集・削除(権限のある人だけボタンが出る) */
function editFromDetail(){
  const id=pdCurrentId; if(id==null) return;
  closePropDetail();
  guardedScreen('admin');
  setTimeout(()=>startEditProp(id),250);
}
function deleteFromDetail(){
  const id=pdCurrentId; const p=PROPS.find(x=>x.id===id); if(!p) return;
  if(!confirm(`「${p.name}」を削除しますか？\nこの操作は元に戻せません。`)) return;
  closePropDetail();
  deleteProp(id);
}
window.editFromDetail=editFromDetail;window.deleteFromDetail=deleteFromDetail;

async function deletePropFromAWS(id){
  if(!AWS_API_URL) return true;
  try{
    const res=await fetch(AWS_API_URL+'?action=delete&id='+encodeURIComponent(id),{method:'DELETE'});
    if(!res.ok){ const d=await res.json().catch(()=>({})); throw new Error(d.error||`HTTP ${res.status}`); }
    return true;
  }catch(e){console.error('AWS物件削除失敗:',e.message);showToast('削除できませんでした: '+e.message,'error');return false;}
}

function startPolling(){
  if(!AWS_API_URL) return;
  setInterval(async()=>{
    try{
      const res=await fetch(AWS_API_URL+'?action=list');
      if(!res.ok) return;
      const data=await res.json();
      const np=Array.isArray(data)?data:(data.items||data.properties||[]);
      // 件数だけでなく中身も比べて、他の人の編集も反映する(自分が編集フォームを開いている間は上書きしない)
      const sig=JSON.stringify(np);
      const changed=startPolling._last!==undefined && sig!==startPolling._last;
      startPolling._last=sig;
      if(editingPropId==null && (changed || np.length!==PROPS.length)){
        PROPS=np;PROPS.forEach(p=>{if(!p.photoURLs) p.photoURLs=[];if(!p.features) p.features=p.tags||[];});
        renderCards();renderAdminPropTable();updateResultsCount();showDataSourceBadge('AWS');
      }
    }catch(_){}
  },30000);
}

/* ══════════════════════════════════════
   PROP DETAIL MODAL
══════════════════════════════════════ */
function showPropDetail(id){
  const prop=PROPS.find(p=>p.id===id);if(!prop) return;
  pdCurrentId=id;pdSliderIdx=0;addToHistory(prop);
  document.getElementById('pd-overlay').classList.add('show');
  document.body.style.overflow='hidden';
  renderPropDetail(prop);
  // 履歴に積む（戻る／スワイプで閉じられるように）
  const cur=history.state;
  pushNavState({screen:(cur&&cur.screen)||'top', modal:'detail', propId:id});
}
function closePropDetail(){
  const wasOpen=document.getElementById('pd-overlay').classList.contains('show');
  document.getElementById('pd-overlay').classList.remove('show');
  document.body.style.overflow='';
  if(pdMiniMap){pdMiniMap.remove();pdMiniMap=null;}
  // ✕で閉じた場合は履歴も1つ戻す（popstate由来なら何もしない）
  if(wasOpen && !_navSuppress && history.state && history.state.modal==='detail'){
    history.back();
  }
}
function renderPropDetail(prop){
  const photos=prop.photoURLs||[];
  const slider=document.getElementById('pd-slider');
  if(photos.length>0){
    slider.innerHTML=`<img src="${photos[pdSliderIdx]}" alt="物件写真" style="width:100%;height:100%;object-fit:cover;display:block">
      ${photos.length>1?`<button class="pd-slide-btn prev" onclick="pdSlide(-1)">&#8249;</button>
        <button class="pd-slide-btn next" onclick="pdSlide(1)">&#8250;</button>
        <div class="pd-dots">${photos.map((_,i)=>`<button class="pd-dot${i===pdSliderIdx?' on':''}" onclick="pdGoTo(${i})"></button>`).join('')}</div>
        <div class="pd-photo-count">${pdSliderIdx+1} / ${photos.length}</div>`:''}`;
  } else {
    slider.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#93c5fd"><i class="ti ti-building" style="font-size:64px;opacity:.4"></i></div>';
  }
  document.getElementById('pd-name').textContent=prop.name||'−';
  document.getElementById('pd-price').textContent='¥'+(Number(prop.price)||0).toLocaleString();
  document.getElementById('pd-tags').innerHTML=[
    prop.type?`<span class="tag tb">${prop.type}</span>`:'',
    prop.madori?`<span class="tag tg">${prop.madori}</span>`:'',
    prop.structure?`<span class="tag tgr">${prop.structure}</span>`:'',
    prop.age!=null?`<span class="tag tgr">築${prop.age}年</span>`:'',
  ].filter(Boolean).join('');
  document.getElementById('pd-info-grid').innerHTML=[
    ['面積',(prop.size||'−')+'㎡'],['間取り',prop.madori||'−'],
    ['最寄駅',(prop.station||'−')+'駅'],['徒歩',(prop.walkMin!=null?prop.walkMin:'−')+'分'],
    ['所在地',prop.area||'−'],['物件種別',prop.type||'−'],
    ['構造',prop.structure||'−'],['築年数',prop.age!=null?prop.age+'年':'−'],
  ].map(([l,v])=>`<div class="pd-info-item"><div class="pd-info-label">${l}</div><div class="pd-info-value">${v}</div></div>`).join('');
  document.getElementById('pd-costs').innerHTML=[
    ['家賃','¥'+(Number(prop.price)||0).toLocaleString()],
    ['管理費',prop.mgmt?'¥'+(Number(prop.mgmt)||0).toLocaleString():'なし'],
    ['敷金',prop.deposit!=null?prop.deposit+'ヶ月':'−'],
    ['礼金',prop.key!=null?prop.key+'ヶ月':'−'],
  ].map(([l,v])=>`<div class="pd-cost-row"><span class="pd-cost-label">${l}</span><span class="pd-cost-value">${v}</span></div>`).join('');
  const features=[...(prop.features||[]),...(prop.tags||[])];
  document.getElementById('pd-features').innerHTML=features.length?features.map(f=>`<span class="pd-feature">${f}</span>`).join(''):'<span style="color:#94a3b8;font-size:12px">なし</span>';
  document.getElementById('pd-desc').textContent=prop.description||'詳細情報はお問い合わせください。';

  // アクセス（複数駅）
  const accessEl=document.getElementById('pd-access');
  const accessTitle=document.getElementById('pd-access-title');
  if(prop.access&&prop.access.trim()){
    accessTitle.style.display='block';
    accessEl.innerHTML=prop.access.trim().split('\n').filter(l=>l.trim()).map(line=>
      `<div><i class="ti ti-train" style="color:var(--blue);font-size:13px"></i> ${line.trim()}</div>`
    ).join('');
  } else {
    accessTitle.style.display='none';accessEl.innerHTML='';
  }

  // 詳細情報（任意項目・入力されているものだけ表示）
  const d=prop.details||{};
  const detailRows=[
    ['入居時期',d.available],['所在階',d.floor],['取引態様',d.transaction],['総戸数',d.units],
    ['駐車場',d.parking],['契約期間',d.contract],['更新料',d.renewal],
    ['保証会社',d.guarantor],['入居条件',d.conditions],['損保',d.insurance],
    ['その他費用',d.otherfees]
  ].filter(([l,v])=>v&&String(v).trim());
  const detailsSection=document.getElementById('pd-details-section');
  if(detailRows.length){
    detailsSection.style.display='block';
    document.getElementById('pd-details').innerHTML=detailRows.map(([l,v])=>
      `<div class="pd-cost-row"><span class="pd-cost-label">${l}</span><span class="pd-cost-value" style="text-align:right;max-width:60%">${v}</span></div>`
    ).join('');
  } else {
    detailsSection.style.display='none';
  }

  // 周辺情報
  const surrSection=document.getElementById('pd-surroundings-section');
  if(d.surroundings&&d.surroundings.trim()){
    surrSection.style.display='block';
    document.getElementById('pd-surroundings').textContent=d.surroundings.trim();
  } else {
    surrSection.style.display='none';
  }
  document.getElementById('pd-address').innerHTML=`<div style="font-size:13px;color:#64748b;line-height:1.8">
    ${prop.address?`<i class="ti ti-map-pin" style="color:var(--blue)"></i> ${prop.address}<br>`:''}
    <span style="font-size:11px;color:#94a3b8">${prop.area||''} ${prop.station?'・'+prop.station+'駅 徒歩'+(prop.walkMin||'?')+'分':''}</span>
  </div>`;
  const vrBtn=document.getElementById('pd-vr-btn');
  if(vrBtn) vrBtn.style.display=(prop.floorplanData||prop.splatURL)?'flex':'none';
  const pdAdmin=document.getElementById('pd-admin-actions');
  if(pdAdmin) pdAdmin.style.display=canEditProp(prop)?'flex':'none';
  setTimeout(()=>{
    const miniEl=document.getElementById('pd-mini-map');
    if(!miniEl||typeof L==='undefined') return;
    if(pdMiniMap){pdMiniMap.remove();pdMiniMap=null;}
    if(prop.lat&&prop.lng){
      pdMiniMap=L.map('pd-mini-map',{zoomControl:false}).setView([prop.lat,prop.lng],15);pdMiniMap.attributionControl.setPrefix(false);
      if(window.fxBaseLayers) fxBaseLayers(pdMiniMap,false);
      else L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',{maxNativeZoom:18,maxZoom:19}).addTo(pdMiniMap);
      L.marker([prop.lat,prop.lng]).addTo(pdMiniMap);
    } else {
      miniEl.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:12px;text-align:center"><div><i class="ti ti-map-off" style="font-size:20px;display:block;margin-bottom:4px;opacity:.5"></i>地図データなし</div></div>';
    }
  },150);
}
function pdSlide(dir){const prop=PROPS.find(p=>p.id===pdCurrentId);if(!prop) return;const photos=prop.photoURLs||[];if(!photos.length) return;pdSliderIdx=(pdSliderIdx+dir+photos.length)%photos.length;renderPropDetail(prop);}
function pdGoTo(idx){const prop=PROPS.find(p=>p.id===pdCurrentId);if(!prop) return;pdSliderIdx=idx;renderPropDetail(prop);}

/* ══════════════════════════════════════
   ADD / EDIT PROPERTY FORM
══════════════════════════════════════ */
function toggleAddForm(){
  const f=document.getElementById('add-form');
  const wasOpen=f.classList.contains('show');
  f.classList.toggle('show',!wasOpen);
  document.body.style.overflow=wasOpen?'':'hidden';
  if(!wasOpen) f.scrollTop=0;
  if(wasOpen&&editingPropId!=null){resetEditMode();clearAddForm();}
}

function readFileAsDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});}

/* ══════════════════════════════════════
   写真を S3 にアップロード
   base64データURL → S3保存 → 公開URLを返す
   （DynamoDBには重いbase64ではなくURLだけ保存する）
══════════════════════════════════════ */
const S3_PUBLIC_BASE = 'https://my-sotuken-cs3b5-s3.s3.ap-northeast-3.amazonaws.com/';

// dataURL(base64) を Blob に変換
function dataURLtoBlob(dataURL){
  const [head, base64]=dataURL.split(',');
  const mime=(head.match(/data:([^;]+)/)||[])[1]||'image/jpeg';
  const bin=atob(base64);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}

// 1枚の写真(dataURL)をS3にアップロードし、公開URLを返す
async function uploadPhotoToS3(dataURL){
  if(!AWS_API_URL) return dataURL; // AWS未接続ならそのまま返す（フォールバック）
  // すでにhttp(S3 URL)ならそのまま返す（編集時に既存写真を再アップしない）
  if(/^https?:\/\//.test(dataURL)) return dataURL;
  try{
    const blob=dataURLtoBlob(dataURL);
    const ext=(blob.type.split('/')[1]||'jpg').replace('jpeg','jpg');
    const filename='photos/'+Date.now()+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;
    // ① 署名付きアップロードURLを取得
    const signRes=await fetch(AWS_API_URL+'?action=upload&filename='+encodeURIComponent(filename));
    if(!signRes.ok) throw new Error('署名URL取得失敗');
    const {url}=await signRes.json();
    // ② S3へPUTアップロード
    const putRes=await fetch(url,{method:'PUT',body:blob,headers:{'Content-Type':blob.type}});
    if(!putRes.ok) throw new Error('S3アップロード失敗 '+putRes.status);
    // ③ 公開URLを返す
    return S3_PUBLIC_BASE+filename;
  }catch(e){
    console.warn('写真S3アップロード失敗、base64のまま使用:',e.message);
    return dataURL; // 失敗時はbase64のまま（動作は継続）
  }
}

// 複数写真をまとめてS3アップロード
async function uploadPhotosToS3(dataURLs){
  const results=[];
  for(const d of dataURLs){
    results.push(await uploadPhotoToS3(d));
  }
  return results;
}

/* ══════════════════════════════════════
   新規写真のプレビュー＆並べ替え
══════════════════════════════════════ */
let _newPhotoQueue = []; // {dataURL, name}

async function previewNewPhotos(){
  const input=document.getElementById('af-photo');
  if(!input||!input.files.length){ return; }
  for(const file of input.files){
    try{
      const dataURL=await resizeImageToDataURL(file,1200,0.85);
      _newPhotoQueue.push({dataURL, name:file.name});
    }catch(e){
      try{ _newPhotoQueue.push({dataURL:await readFileAsDataURL(file), name:file.name}); }catch(_){}
    }
  }
  input.value='';
  renderNewPhotoPreview();
}

function renderNewPhotoPreview(){
  const wrap=document.getElementById('af-new-photos-preview');
  const list=document.getElementById('af-new-photos-list');
  if(!wrap||!list) return;
  if(!_newPhotoQueue.length){ wrap.style.display='none'; list.innerHTML=''; return; }
  wrap.style.display='block';
  list.innerHTML=_newPhotoQueue.map((p,i)=>`
    <div style="position:relative;width:88px">
      <div style="position:relative;width:88px;height:88px;border-radius:8px;overflow:hidden;border:2px solid ${i===0?'var(--blue)':'var(--border)'}">
        <img src="${p.dataURL}" style="width:100%;height:100%;object-fit:cover">
        ${i===0?'<div style="position:absolute;top:0;left:0;background:var(--blue);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-bottom-right-radius:6px">メイン</div>':''}
        <button type="button" onclick="removeNewPhoto(${i})" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;background:rgba(220,38,38,.9);color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0">×</button>
      </div>
      <div style="display:flex;justify-content:center;gap:4px;margin-top:3px">
        <button type="button" onclick="moveNewPhoto(${i},-1)" ${i===0?'disabled':''} style="width:26px;height:22px;border-radius:5px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:12px;padding:0">←</button>
        <button type="button" onclick="moveNewPhoto(${i},1)" ${i===_newPhotoQueue.length-1?'disabled':''} style="width:26px;height:22px;border-radius:5px;border:1px solid var(--border);background:var(--surface);cursor:pointer;font-size:12px;padding:0">→</button>
      </div>
    </div>
  `).join('');
}

function moveNewPhoto(index, dir){
  const ni=index+dir;
  if(ni<0||ni>=_newPhotoQueue.length) return;
  [_newPhotoQueue[index], _newPhotoQueue[ni]]=[_newPhotoQueue[ni], _newPhotoQueue[index]];
  renderNewPhotoPreview();
}
function removeNewPhoto(index){
  _newPhotoQueue.splice(index,1);
  renderNewPhotoPreview();
}
window.previewNewPhotos=previewNewPhotos;
window.moveNewPhoto=moveNewPhoto;
window.removeNewPhoto=removeNewPhoto;

function resizeImageToDataURL(file,maxWidth=1200,quality=0.85){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onerror=reject;
    reader.onload=ev=>{
      const img=new Image();img.onerror=reject;
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxWidth){h=Math.round(h*maxWidth/w);w=maxWidth;}
        const cv=document.createElement('canvas');cv.width=w;cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        try{resolve(cv.toDataURL('image/jpeg',quality));}catch(err){reject(err);}
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addProperty(){
  const gv=id=>(document.getElementById(id)||{}).value||'';
  const name=gv('af-name').trim();if(!name){alert('物件名を入力してください');return;}
  const area=gv('af-area').trim(),rent=parseInt(gv('af-rent'))||0,madori=gv('af-madori').trim()||'−';
  const size=parseFloat(gv('af-size'))||0,station=gv('af-station').trim(),walkMin=parseInt(gv('af-walk-min'))||0;
  const address=gv('af-address').trim(),mgmt=parseInt(gv('af-mgmt'))||0;
  const deposit=parseFloat(gv('af-deposit'))||0,keyMoney=parseFloat(gv('af-key'))||0;
  const type=gv('af-type')||'マンション',structure=gv('af-structure')||'RC',age=parseInt(gv('af-age'))||0;
  const desc=gv('af-desc').trim();
  // 詳細情報（任意項目）
  const access=gv('af-access').trim();
  const details={
    available:gv('af-available').trim(),
    transaction:gv('af-transaction').trim(),
    units:gv('af-units').trim(),
    parking:gv('af-parking').trim(),
    contract:gv('af-contract').trim(),
    renewal:gv('af-renewal').trim(),
    guarantor:gv('af-guarantor').trim(),
    conditions:gv('af-conditions').trim(),
    insurance:gv('af-insurance').trim(),
    otherfees:gv('af-otherfees').trim(),
    surroundings:gv('af-surroundings').trim()
  };
  // 並べ替え済みの写真キューを使用（順番はユーザー指定どおり）
  const newPhotoDataURLs=_newPhotoQueue.map(p=>p.dataURL);
  // ★写真をS3にアップロードしてURL化（DynamoDBには重いbase64を入れない）
  let newPhotoURLs=[];
  if(newPhotoDataURLs.length){
    showToast('写真をアップロード中...','info',3000);
    newPhotoURLs=await uploadPhotosToS3(newPhotoDataURLs);
  }
  let splatFields;
  try{ splatFields=await resolveSplatForSave(); }
  catch(e){ showToast('実写データを保存できませんでした: '+e.message,'error'); return; }
  if(editingPropId!=null){
    const propIdx=PROPS.findIndex(p=>p.id===editingPropId);
    if(propIdx<0){alert('編集対象が見つかりませんでした');resetEditMode();return;}
    const existing=PROPS[propIdx];
    const mergedPhotos=[...editingExistingPhotos,...newPhotoURLs];
    const updated={...existing,name,area,address,station,walkMin,price:rent,mgmt,deposit,key:keyMoney,madori,size,type,structure,age,description:desc,access,details,photoURLs:mergedPhotos,
      floorplanURL:window.editedFloorplanThumb||existing.floorplanURL||null,floorplanData:window.editedFloorplanData||existing.floorplanData||null,
      splatURL:splatFields.splatURL,splatTransform:splatFields.splatTransform};
    const addrChanged=(normalizeAddress(address)!==normalizeAddress(existing.address||')'))|| (normalizeAddress(area)!==normalizeAddress(existing.area||''));
    if(addrChanged){updated.lat=null;updated.lng=null;}
    PROPS[propIdx]=updated;removeMapMarker(editingPropId);
    if(updated.lat&&updated.lng) addMapMarker(updated);
    renderCards();renderAdminPropTable();updateResultsCount();renderMapSidebar();
    try{await updatePropertyOnAWS(updated);showToast('「'+name+'」を更新しました','success');}
    catch(e){showToast('AWS更新に失敗: '+e.message,'error');}
    if(addrChanged){
      const addrForGeo=normalizeAddress(address)||normalizeAddress(area)||station;
      if(addrForGeo) geocodeAddress(addrForGeo).then(coords=>{if(coords){updated.lat=coords.lat;updated.lng=coords.lng;addMapMarker(updated);renderMapSidebar();updatePropertyOnAWS(updated).catch(()=>{});}});
    }
    resetEditMode();clearAddForm();toggleAddForm();return;
  }
  // 「駅を自動取得」で取得済みの座標があれば流用
  const preCoords=window._afGeoCoords||null;
  const newProp={id:null,name,area,address,station,walkMin,price:rent,mgmt,deposit,key:keyMoney,madori,size,type,structure,age,features:[],tags:[],description:desc,access,details,
    ownerEmail:(currentUser&&currentUser.email)||null, ownerName:(currentUser&&currentUser.name)||null,
    photoURLs:newPhotoURLs,floorplanURL:window.editedFloorplanThumb||null,floorplanData:window.editedFloorplanData||null,
    splatURL:splatFields.splatURL,splatTransform:splatFields.splatTransform,
    lat:preCoords?preCoords.lat:null,lng:preCoords?preCoords.lng:null};
  window._afGeoCoords=null;
  clearAddForm();toggleAddForm();
  // 先にサーバーへ保存して、サーバーが付けた番号を使う(番号がずれると別の物件を上書きしてしまうため)
  showToast('「'+name+'」を登録しています...','info',2000);
  const {id:_omit,...toSend}=newProp;
  const sid=await uploadToAWS(toSend);
  if(sid==null) return;
  newProp.id=sid;
  PROPS.push(newProp);renderCards();renderAdminPropTable();updateResultsCount();renderMapSidebar();
  showToast('「'+name+'」を登録しました','success');
  if(newProp.lat&&newProp.lng){
    addMapMarker(newProp);renderMapSidebar();
  } else {
    const addrForGeo=normalizeAddress(address)||normalizeAddress(area)||station;
    if(addrForGeo){
      geocodeAddress(addrForGeo).then(coords=>{
        if(coords){newProp.lat=coords.lat;newProp.lng=coords.lng;addMapMarker(newProp);renderMapSidebar();updatePropertyOnAWS(newProp).catch(()=>{});}
        else showToast('住所から場所を特定できませんでした','warn');
      });
    }
  }
}

function clearAddForm(){
  ['af-name','af-area','af-rent','af-madori','af-size','af-station','af-walk-min','af-address','af-mgmt','af-deposit','af-key','af-age','af-desc',
   'af-access','af-available','af-units','af-parking','af-contract','af-renewal','af-guarantor','af-conditions','af-insurance','af-otherfees','af-surroundings'].forEach(id=>{const el=document.getElementById(id);if(el) el.value='';});
  const afTrans=document.getElementById('af-transaction');if(afTrans) afTrans.selectedIndex=0;
  const photoInput=document.getElementById('af-photo');if(photoInput) photoInput.value='';
  _newPhotoQueue=[]; if(typeof renderNewPhotoPreview==='function') renderNewPhotoPreview();
  window._afStations=null;
  const afType=document.getElementById('af-type');if(afType) afType.selectedIndex=0;
  const afStr=document.getElementById('af-structure');if(afStr) afStr.selectedIndex=0;
  const geoStatus=document.getElementById('af-geo-status');if(geoStatus) geoStatus.style.display='none';
  window._afGeoCoords=null;
  if(window.clearFloorplan) window.clearFloorplan();
  if(window.clearSplat) window.clearSplat();
  if(typeof resetEditMode==='function') resetEditMode();
}

/* ══════════════════════════════════════
   MISC & MISC
══════════════════════════════════════ */
const _style=document.createElement('style');
_style.textContent='@keyframes spin{to{transform:rotate(360deg)}}@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(_style);

function switchMp(id,el){
  ['fav','inbox','hist','prof','wish'].forEach(k=>{const e=document.getElementById('mp-'+k);if(e) e.style.display=k===id?'block':'none';});
  document.querySelectorAll('.mp-nav-item').forEach(i=>i.classList.remove('on'));if(!el) el=document.querySelector(`.mp-nav-item[onclick*="'${id}'"]`);if(el) el.classList.add('on');
  if(id==='fav') renderFavorites();
  if(id==='inbox') renderInbox();
  if(id==='hist') renderHistory();
}
function switchAdmin(id,el){
  ['props','group','users','stats'].forEach(k=>document.getElementById('admin-'+k).style.display=k===id?'block':'none');
  document.querySelectorAll('#s-admin .admin-nav-item').forEach(i=>i.classList.remove('on'));if(el&&el.classList) el.classList.add('on');
  if(id==='users') renderUserTable();
  if(id==='group') renderGroupManagement();
  if(id==='stats') refreshStats();
}

/* ══════════════════════════════════════
   グループ管理
   招待コード方式・1人1グループ
══════════════════════════════════════ */
function genGroupCode(){
  // 6文字の招待コード（読みやすい文字のみ）
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c='';for(let i=0;i<6;i++) c+=chars[Math.floor(Math.random()*chars.length)];
  return c;
}

function renderGroupManagement(){
  const el=document.getElementById('group-content');
  if(!el||!currentUser) return;
  const myGroup=currentUser.groupId;

  if(myGroup){
    // すでにグループに所属している
    const members=userStore.filter(u=>u.groupId===myGroup);
    const isOwner=currentUser.groupOwner===true;
    el.innerHTML=`
      <div class="card" style="max-width:560px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:11px;color:#94a3b8">所属グループ</div>
            <div style="font-size:16px;font-weight:800;color:var(--navy)">${currentUser.groupName||'マイグループ'}</div>
          </div>
          ${isOwner?`<span class="tag tb" style="font-size:10px">オーナー</span>`:''}
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;color:#64748b;margin-bottom:6px">招待コード（他の管理者に伝えてください）</div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px;font-weight:800;letter-spacing:.2em;color:var(--blue);font-family:monospace">${myGroup}</span>
            <button class="btn btn-sm" style="font-size:11px" onclick="navigator.clipboard.writeText('${myGroup}').then(()=>showToast('コピーしました','success'))"><i class="ti ti-copy"></i> コピー</button>
          </div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:8px">メンバー（${members.length}人）</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${members.map(m=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
              <div>
                <span style="font-size:13px;font-weight:600;color:var(--navy)">${m.name}</span>
                ${m.email===currentUser.email?'<span style="font-size:10px;color:#94a3b8">（あなた）</span>':''}
                ${m.groupOwner?'<span class="tag tb" style="font-size:9px;margin-left:4px">オーナー</span>':''}
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;color:#94a3b8">${m.email}</span>
                ${isOwner&&m.email!==currentUser.email?`<button class="btn btn-sm" style="font-size:10px;padding:2px 8px;color:var(--red)" onclick="removeGroupMember('${m.email}')" title="このメンバーを外す"><i class="ti ti-user-minus"></i></button>`:''}
              </div>
            </div>`).join('')}
        </div>

        <p style="font-size:11px;color:#94a3b8;margin-top:14px;line-height:1.7">メンバーを増やすときは、上の招待コードを相手に伝えて、相手が自分で「グループに参加する」から入ります（勝手に追加はできません）。</p>

        <button class="btn btn-sm" style="margin-top:16px;color:var(--red);border-color:var(--red-b)" onclick="leaveGroup()">
          <i class="ti ti-logout"></i> グループを脱退
        </button>
      </div>`;
  } else {
    // グループ未所属：作成 or 参加
    el.innerHTML=`
      <div style="display:grid;gap:16px;max-width:560px">
        <div class="card">
          <div style="font-size:15px;font-weight:800;color:var(--navy);margin-bottom:6px"><i class="ti ti-plus" style="color:var(--blue)"></i> 新しいグループを作る</div>
          <p style="font-size:12px;color:#64748b;margin-bottom:12px">グループを作成すると招待コードが発行されます。</p>
          <div style="display:flex;gap:8px">
            <input class="finput" id="new-group-name" placeholder="グループ名（例：○○不動産チーム）" style="flex:1;font-size:13px">
            <button class="btn btn-p btn-sm" style="white-space:nowrap" onclick="createGroup()"><i class="ti ti-plus"></i> 作成</button>
          </div>
        </div>
        <div class="card">
          <div style="font-size:15px;font-weight:800;color:var(--navy);margin-bottom:6px"><i class="ti ti-login" style="color:var(--green)"></i> グループに参加する</div>
          <p style="font-size:12px;color:#64748b;margin-bottom:12px">招待コードを入力してグループに参加します。</p>
          <div style="display:flex;gap:8px">
            <input class="finput" id="join-group-code" placeholder="招待コード（6文字）" maxlength="6" style="flex:1;font-size:15px;letter-spacing:.15em;text-transform:uppercase;font-family:monospace">
            <button class="btn btn-p btn-sm" style="white-space:nowrap" onclick="joinGroup()"><i class="ti ti-login"></i> 参加</button>
          </div>
        </div>
      </div>`;
  }
}

/* グループの作成・参加・脱退はサーバーが確かめる（参加は招待コードを知っている本人だけ） */
async function saveMyGroup(groupId, groupName, action){
  try{
    const res=await fetch(AWS_API_URL+'?action=saveUser',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...currentUser, groupId:groupId, groupName:groupName, groupAction:action})});
    const d=await res.json().catch(()=>({}));
    if(!res.ok){ showToast(d.error||'うまくいきませんでした','warn'); return false; }
    const u=d.user||{};
    ['groupId','groupName','groupOwner'].forEach(k=>{ currentUser[k]=u[k]??null; });
    const s=userStore.find(x=>x.email===currentUser.email); if(s) ['groupId','groupName','groupOwner'].forEach(k=>{ s[k]=currentUser[k]; });
    cacheUserLocal(currentUser);
    await fetchUsers();          // 同じグループのメンバーを読み直す
    try{ await fetchAndRenderProps(); }catch(e){}   // 編集できる物件が変わるので読み直す
    return true;
  }catch(e){ showToast('サーバーにつながりませんでした','error'); return false; }
}
async function createGroup(){
  const nameEl=document.getElementById('new-group-name');
  const name=(nameEl?.value||'').trim();
  if(!name){showToast('グループ名を入力してください','warn');return;}
  if(await saveMyGroup(genGroupCode(), name, 'create')) showToast('グループを作成しました','success');
  renderGroupManagement(); renderAdminPropTable();
}
async function joinGroup(){
  const codeEl=document.getElementById('join-group-code');
  const code=(codeEl?.value||'').trim().toUpperCase();
  if(!code){showToast('招待コードを入力してください','warn');return;}
  if(await saveMyGroup(code, null, 'join')) showToast('グループに参加しました','success');
  renderGroupManagement(); renderAdminPropTable();
}
async function leaveGroup(){
  if(!confirm('グループを脱退しますか？\n脱退すると、グループメンバーの物件を編集できなくなります。')) return;
  if(await saveMyGroup(null, null, 'leave')) showToast('グループを脱退しました','info');
  renderGroupManagement(); renderAdminPropTable();
}
window.createGroup=createGroup;window.joinGroup=joinGroup;window.leaveGroup=leaveGroup;
window.renderGroupManagement=renderGroupManagement;

/* グループからメンバーを外す（オーナーのみ） */
async function removeGroupMember(email){
  if(!currentUser||!currentUser.groupOwner){showToast('オーナーのみメンバーを外せます','warn');return;}
  const target=userStore.find(u=>u.email===email);
  if(!target) return;
  if(!confirm(`「${target.name}」をグループから外しますか？`)) return;
  target.groupId=null;target.groupName=null;target.groupOwner=false;
  await saveUserToAWS(target);
  await saveMessage({
    id:'m'+Date.now(), to:target.email, from:currentUser.email, fromName:currentUser.name||'運営',
    subject:`【VR Homes】グループから外れました`,
    body:`グループ「${currentUser.groupName}」から外れました。`,
    time:new Date().toISOString(), read:false
  });
  showToast(`「${target.name}」をグループから外しました`,'info');
  renderGroupManagement();
  renderAdminPropTable();
}
window.removeGroupMember=removeGroupMember;
/* 広告機能は「おすすめ掲載（PR）」に置きかえたので、古い呼び出しが残っていても何もしない */
function isAdUnlocked(){ return false; }
function isAdPopupEnabled(){ return false; }
function showAdPopup(){}
function renderAdManagement(){}
function _showAdTab(){}
function injectSideAds(){}
function injectInlineAds(){}
function switchMaster(id,el){
  ['users','roles','fields','listings'].forEach(k=>{const e=document.getElementById('master-'+k);if(e) e.style.display=k===id?'block':'none';});
  document.querySelectorAll('#s-master .admin-nav-item').forEach(i=>i.classList.remove('on'));
  if(el && el.classList) el.classList.add('on');
  if(id==='users') renderMasterUserTable();
  if(id==='roles') renderRoleTable();
  if(id==='fields') renderFieldManagement();
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  refreshAllFilters();
});

fetchUsers().then(()=>{
  // リロード時のログイン状態復元
  const restored=restoreSession();
  // 履歴ナビゲーションを初期化（スワイプ／戻るボタン対応）
  initNavigation();
  // URLハッシュの画面を復元（ログイン済みの場合のみ）
  if(restored){
    const hash=(location.hash||'').replace('#','').split('/')[0];
    if(hash && document.getElementById('s-'+hash)){
      _navSuppress=true;
      try{ _applyScreen(hash); replaceNavState({screen:hash}); }
      finally{ _navSuppress=false; }
    }
  }
  return fetchAndRenderProps().then(()=>{
    const el=document.getElementById('lp-stat-props');
    if(el) el.textContent=PROPS.length+'件';
    const countEl=document.getElementById('results-count');
    if(countEl) countEl.textContent=PROPS.length;
  });
});
startPolling();
