/* ══════════════════════════════════════
   STATE & CONSTANTS
══════════════════════════════════════ */
const MASTER_EMAIL = 'nori1216chopper@gmail.com';
const ADMIN_CODE   = 'admin';
const MASTER_CODE  = 'master';
const AD_SECRET_CODE = 'zakoshi';
const AWS_API_URL  = 'https://h5mx5gy6l2y7v6k46kxxfsm4li0cxnpr.lambda-url.ap-northeast-3.on.aws/';
const EDITOR_PATH  = 'floor-editor.html';

let isLoggedIn  = false;
let currentUser = null;

/* ── デモ物件データ ── */
const DEMO_PROPS = [
  { id:1, name:'サンシャインマンション渋谷', area:'東京都渋谷区', address:'東京都渋谷区道玄坂1丁目10-8',
    station:'渋谷', walkMin:5, price:85000, mgmt:5000, deposit:1, key:1,
    madori:'1LDK', size:38, type:'マンション', structure:'RC（鉄筋コンクリート）', age:8,
    features:['オートロック','バス・トイレ別','エアコン','インターネット無料'],
    tags:[], description:'渋谷駅徒歩5分の好立地マンション。', photoURLs:[], lat:35.6580, lng:139.7016 },
  { id:2, name:'グリーンアパート新宿', area:'東京都新宿区', address:'東京都新宿区西新宿2丁目4-1',
    station:'新宿', walkMin:8, price:65000, mgmt:3000, deposit:1, key:0,
    madori:'1K', size:25, type:'アパート', structure:'木造', age:15,
    features:['バス・トイレ別','エアコン','ペット可'],
    tags:[], description:'ペット可の1Kアパート。', photoURLs:[], lat:35.6896, lng:139.6917 },
  { id:3, name:'パークコート池袋', area:'東京都豊島区', address:'東京都豊島区東池袋1丁目35-3',
    station:'池袋', walkMin:3, price:120000, mgmt:8000, deposit:2, key:2,
    madori:'2LDK', size:62, type:'マンション', structure:'RC（鉄筋コンクリート）', age:3,
    features:['オートロック','バス・トイレ別','エアコン','浴室乾燥機','宅配ボックス','南向き'],
    tags:[], description:'池袋駅徒歩3分の高級マンション。', photoURLs:[], lat:35.7295, lng:139.7109 },
];

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

const MASTER_USER = { name:'のり', email:MASTER_EMAIL, password:'nori1216master', role:'master', active:true, photoURL:null, wishlist:{} };
const DEMO_USER  = { name:'デモユーザー', email:'demo@vrhomes.jp', password:'demo1234', role:'user',  active:true, photoURL:null, wishlist:{}, favs:[], history:[] };
const DEMO_ADMIN = { name:'デモ管理者',   email:'admin@vrhomes.jp', password:'admin1234', role:'admin', active:true, photoURL:null, wishlist:{}, favs:[], history:[] };
let userStore = [MASTER_USER, DEMO_USER, DEMO_ADMIN];

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
    if(cu.email===MASTER_EMAIL) return; // マスターは固定
    const existing=userStore.find(u=>u.email===cu.email);
    if(existing){
      // AWSより新しいローカル値で上書き（ユーザー個人データのみ・パスワードは扱わない）
      existing.favs=cu.favs||existing.favs||[];
      existing.history=cu.history||existing.history||[];
      existing.role=cu.role||existing.role;
      existing.active=(cu.active!==undefined)?cu.active:existing.active;
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
    if(!res.ok) throw new Error('HTTP '+res.status);
    const users=await res.json();
    const awsUsers=users.filter(u=>u.email!==MASTER_EMAIL&&u.email!==DEMO_USER.email&&u.email!==DEMO_ADMIN.email);
    userStore=[MASTER_USER,DEMO_USER,DEMO_ADMIN,...awsUsers];
  }catch(e){ console.warn('ユーザー取得失敗（デモモードで続行）:',e.message); }
  // AWS取得後、ローカルキャッシュを必ずマージ（データ消失を防ぐ）
  mergeUserCache();
}

/* AWSとローカル両方に保存（ローカルは即時・確実） */
async function saveUserToAWS(user){
  cacheUserLocal(user); // まずローカルに確実保存
  if(!AWS_API_URL||user.email===MASTER_EMAIL) return;
  try{
    await fetch(AWS_API_URL+'?action=saveUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...user})});
  }catch(e){console.warn('ユーザー保存失敗（ローカルには保存済み）:',e.message);}
}

async function deleteUserFromAWS(email){
  removeCachedUser(email); // ローカルからも削除
  if(!AWS_API_URL||email===MASTER_EMAIL) return;
  try{
    await fetch(AWS_API_URL+'?action=deleteUser&email='+encodeURIComponent(email),{method:'DELETE'});
  }catch(e){console.warn('ユーザー削除失敗:',e.message);}
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
    if(prop){_fePendingInit.data=prop.floorplanData||null;_fePendingInit.propName=prop.name||'';}
  } else {
    _fePendingInit.data=window.editedFloorplanData||null;
    _fePendingInit.propName=(document.getElementById('af-name')||{}).value||'新規物件';
  }
  _openFloorEditorModal('edit');
}

const VR_VIEWER_PATH = 'vr-viewer.html';
let _vrPendingInit=null;

/* ブラウザ内でVR内見を開く(PC・スマホ・Questブラウザ共通) */
function viewInVR(propId){
  const prop=PROPS.find(p=>p.id===propId);
  if(!prop){alert('物件が見つかりません');return;}
  if(!prop.floorplanData){alert('この物件には間取りデータがありません');return;}
  closeVRViewer();
  _vrPendingInit={type:'vr-viewer-init',data:prop.floorplanData,propName:prop.name||''};
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
});

/* 旧方式: Unity(FloorPlayVR6)を動かしているQuest 3へ間取りを送信する。ボタンからは呼んでいない(予備) */
function sendFloorplanToQuest(propId){
  const prop=PROPS.find(p=>p.id===propId);
  if(!prop){alert('物件が見つかりません');return;}
  if(!prop.floorplanData){alert('この物件には間取りデータがありません');return;}
  if(!confirm(`「${prop.name}」をQuest 3に送信します。\n\nQuest側でVRアプリが起動済みであることを確認してください。`)) return;
  fetch(AWS_API_URL+'?action=saveFloorplan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prop.floorplanData)})
    .then(r=>r.json()).then(d=>{
      if(d&&d.success) alert(`✅ 送信完了！\n\nQuest 3 で Bボタン を押してください`);
      else alert('送信は完了しましたがレスポンスが想定外でした。');
    }).catch(e=>alert('送信に失敗しました:\n'+e.message));
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
window.clearFloorplan=clearFloorplan;window.openFloorEditor=openFloorEditor;window.viewInVR=viewInVR;window.closeFloorEditor=closeFloorEditor;window.closeVRViewer=closeVRViewer;window.sendFloorplanToQuest=sendFloorplanToQuest;

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
  if(isMaster()) return true;              // マスターは自由
  if(!isAdmin()) return false;             // 管理者未満は不可
  if(!prop) return false;
  // 自分が追加した物件
  if(prop.ownerEmail && prop.ownerEmail===currentUser.email) return true;
  // オーナー情報がない古い物件は、管理者なら編集可（後方互換）
  if(!prop.ownerEmail) return true;
  // 同じグループのメンバーが追加した物件
  const myGroup=currentUser.groupId;
  if(myGroup){
    const owner=userStore.find(u=>u.email===prop.ownerEmail);
    if(owner && owner.groupId===myGroup) return true;
  }
  return false;
}
function isRegular(u){return (u||currentUser)?.role==='user';}
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
  document.getElementById('mp-nav-code').classList.remove('hidden'); // 全ユーザーに表示
  document.getElementById('nav-admin-btn').classList.toggle('hidden',!isAdmin());
  document.getElementById('admin-email-display').textContent=u.email;
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
  const total=userStore.filter(u=>u.role!=='master').length;
  const admins=userStore.filter(u=>u.role==='admin').length;
  const regulars=userStore.filter(u=>u.role==='user').length;
  [['admin-user-count',total],['master-user-count',userStore.length],['master-admin-count',admins],['master-regular-count',regulars]]
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

  // ① デモアカウント・マスターはローカルで先に照合（users.jsonに無いため）
  const localSpecial=[DEMO_USER, DEMO_ADMIN, MASTER_USER].find(u=>u.email===email&&u.password===pass);
  if(localSpecial){
    if(!localSpecial.active){showGateMsg('このアカウントは停止されています',true);return;}
    try{ localStorage.setItem('vr_session_email', localSpecial.email); }catch(e){}
    _enterApp(localSpecial);
    return;
  }

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
          try{ localStorage.setItem('vr_session_email', user.email); }catch(e){}
          _enterApp(user);
          return;
        }
      } else {
        const d=await res.json().catch(()=>({}));
        if(res.status===401||res.status===403){
          showGateMsg(d.error||'メールアドレスまたはパスワードが違います',true);
          return;
        }
      }
    }catch(e){
      console.warn('サーバー認証に接続できません。ローカル照合にフォールバック:',e.message);
    }
  }

  // ③ フォールバック：ローカル照合（オフライン時のみ）
  const user=userStore.find(u=>u.email===email&&(u.password===pass));
  if(!user){showGateMsg('メールアドレスまたはパスワードが違います',true);return;}
  if(!user.active){showGateMsg('このアカウントは停止されています',true);return;}
  try{ localStorage.setItem('vr_session_email', user.email); }catch(e){}
  _enterApp(user);
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
  if(isMaster()){
    renderMasterUserTable();renderRoleTable();renderFieldManagement();
    if(isAdUnlocked()){_showAdTab();renderAdManagement();}
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
  if(email===MASTER_EMAIL){showGateMsg('このアカウントは変更できません',true);return;}
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
   CODE INPUT
══════════════════════════════════════ */
function submitCode(){
  const code=(document.getElementById('code-input')||{}).value?.trim()||'';
  const msgEl=document.getElementById('code-msg');
  const okAdmin  = code===ADMIN_CODE;
  const okMaster = code===MASTER_CODE;
  const okAd     = code.toLowerCase()===AD_SECRET_CODE.toLowerCase();
  const ok = okAdmin||okMaster||okAd;

  const showMsg=(text,isOk)=>{
    msgEl.style.cssText=`display:block;background:${isOk?'rgba(22,163,74,.15)':'rgba(220,38,38,.15)'};border:1px solid ${isOk?'rgba(22,163,74,.3)':'rgba(220,38,38,.3)'};color:${isOk?'var(--green)':'var(--red)'};border-radius:var(--r-md);padding:9px 13px;font-size:13px;margin-bottom:14px`;
    msgEl.textContent=text;
    setTimeout(()=>{msgEl.style.display='none';},3000);
  };

  if(okAd){
    // 広告管理解放
    localStorage.setItem(AD_UNLOCK_KEY,'yes');
    document.getElementById('code-input').value='';
    showMsg('🔓 広告管理が解放されました！マスターパネルで確認できます',true);
    if(isMaster()){_showAdTab();renderAdManagement();}
    return;
  }
  if(ok){
    const newRole=okMaster?'master':'admin';
    currentUser.role=newRole;
    const s=userStore.find(u=>u.email===currentUser.email);if(s) s.role=newRole;
    saveUserToAWS(currentUser); // ロール変更をローカル＆AWSに保存（リロードでも維持）
    showMsg(`✓ ${okMaster?'マスター':'管理者'}として認証されました！`,true);
    applyRoleUI();
    if(okMaster){renderFieldManagement();if(isAdUnlocked()){_showAdTab();renderAdManagement();}}
    setTimeout(()=>{document.getElementById('code-input').value='';guardedScreen(okMaster?'master':'admin');},1500);
  } else {
    showMsg('コードが正しくありません。',false);
    document.getElementById('code-input').value='';
  }
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
  const list=userStore.filter(u=>u.role!=='master')
    .filter(u=>!q||(u.name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q)))
    .filter(u=>!f||u.role===f);
  tbody.innerHTML=list.map(u=>`<div class="admin-table-row" style="grid-template-columns:1.5fr 2fr 1fr 1fr 1fr">
    <span style="font-weight:600;color:var(--navy)">${u.name}</span>
    <span style="color:#64748b;font-size:11px">${u.email}</span>
    <span>${roleLabel(u.role)}</span>
    <span><span class="tag ${u.active?'tg':'tr'}" style="font-size:9px">${u.active?'有効':'停止中'}</span></span>
    <span style="display:flex;gap:4px">
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="showUserDetail('${u.email}')"><i class="ti ti-info-circle"></i></button>
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="confirmToggleActive('${u.email}')"><i class="ti ti-${u.active?'ban':'check'}" style="color:var(--${u.active?'amber':'green'})"></i></button>
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="confirmDeleteUser('${u.email}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>
    </span>
  </div>`).join('')||'<div style="padding:14px;font-size:13px;color:#94a3b8;text-align:center">該当するユーザーはいません</div>';
}

function renderMasterUserTable(){
  const q=(document.getElementById('master-search')||{}).value?.toLowerCase()||'';
  const f=(document.getElementById('master-filter')||{}).value||'';
  const tbody=document.getElementById('master-user-table-body');if(!tbody) return;
  const list=userStore.filter(u=>!q||(u.name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q))).filter(u=>!f||u.role===f);
  tbody.innerHTML=list.map(u=>`<div class="admin-table-row" style="grid-template-columns:1.5fr 2fr 1fr 1fr 1fr">
    <span style="font-weight:600;color:var(--navy)">${u.name}${u.email===MASTER_EMAIL?'<span class="master-badge" style="font-size:9px;margin-left:4px"><i class="ti ti-crown" style="font-size:9px"></i></span>':''}</span>
    <span style="color:#64748b;font-size:11px">${u.email}</span>
    <span>${roleLabel(u.role)}</span>
    <span><span class="tag ${u.active?'tg':'tr'}" style="font-size:9px">${u.active?'有効':'停止中'}</span></span>
    <span style="display:flex;gap:4px">
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="showUserDetail('${u.email}')"><i class="ti ti-info-circle"></i></button>
      ${u.role!=='master'?`<button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="confirmToggleActive('${u.email}')">${u.active?'<i class="ti ti-ban" style="color:var(--amber)"></i>':'<i class="ti ti-check" style="color:var(--green)"></i>'}</button>`:'' }
      ${u.email!==MASTER_EMAIL?`<button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="confirmDeleteUser('${u.email}')"><i class="ti ti-trash" style="color:var(--red)"></i></button>`:'' }
    </span>
  </div>`).join('')||'<div style="padding:14px;font-size:13px;color:#94a3b8;text-align:center">該当するユーザーはいません</div>';
}

function confirmDeleteUser(email){
  const u=userStore.find(u=>u.email===email);if(!u) return;
  if(email===MASTER_EMAIL){alert('マスターアカウントは削除できません');return;}
  if(email===currentUser?.email){alert('自分自身は削除できません');return;}
  if(!confirm(`ユーザー「${u.name}」（${email}）を完全に削除しますか？`)) return;
  deleteUser(email);closeUserDetail();
}
function confirmToggleActive(email){
  const u=userStore.find(u=>u.email===email);if(!u) return;
  if(email===MASTER_EMAIL){alert('マスターアカウントは変更できません');return;}
  if(email===currentUser?.email){alert('自分自身のアカウントは変更できません');return;}
  if(!confirm(`ユーザー「${u.name}」を${u.active?'停止':'有効化'}しますか？`)) return;
  toggleUserActive(email);
}
function deleteUser(email){
  const idx=userStore.findIndex(u=>u.email===email);if(idx>-1) userStore.splice(idx,1);
  deleteUserFromAWS(email);
  renderUserTable();renderMasterUserTable();renderRoleTable();refreshStats();
}
function toggleUserActive(email){
  const u=userStore.find(u=>u.email===email);if(!u) return;
  u.active=!u.active;saveUserToAWS(u);
  renderUserTable();renderMasterUserTable();renderRoleTable();refreshStats();
  if(document.getElementById('user-detail-modal').style.display==='block') showUserDetail(email);
}

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
           ['グループ',u.groupName?u.groupName+'（'+u.groupId+'）':'未所属'],
           ['お気に入り',(u.favs||[]).length+'件'],['履歴',(u.history||[]).length+'件']].map(([l,v])=>`
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
    ${isMaster()&&u.role!=='master'?`
    <!-- パスワード代理リセット（マスター専用） -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--r-md);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:6px"><i class="ti ti-key"></i> パスワードを代理リセット</div>
      <p style="font-size:11px;color:#991b1b;margin-bottom:10px;line-height:1.6">
        ユーザーがパスワードを忘れた場合に、マスターが新しいパスワードを設定できます。設定後、本人に直接お伝えください。
      </p>
      <input class="finput" id="ud-new-pass" type="text" placeholder="新しいパスワード（6文字以上）" style="font-size:12px;margin-bottom:6px">
      <input class="finput" id="ud-master-pass" type="password" placeholder="あなた（マスター）のパスワード" style="font-size:12px;margin-bottom:8px">
      <div id="ud-reset-status" style="display:none;font-size:11px;margin-bottom:6px"></div>
      <button class="btn btn-sm" style="width:100%;justify-content:center;color:var(--red);border-color:var(--red-b)" onclick="adminResetPassword('${email}')">
        <i class="ti ti-key"></i> パスワードをリセット
      </button>
    </div>`:''}
    ${u.role!=='master'?`<div style="background:var(--surface2);border-radius:var(--r-md);padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">ロール変更</div>
      <div style="display:flex;gap:8px">
        <select class="finput" id="user-detail-role" style="font-size:12px;padding:5px 8px">
          <option value="user" ${u.role==='user'?'selected':''}>一般ユーザー</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>管理者</option>
        </select>
        <button class="btn btn-sm" onclick="changeRoleFromDetail('${email}')">変更</button>
      </div>
    </div>`:''}
    ${email!==MASTER_EMAIL&&email!==currentUser?.email?`<button class="btn" style="width:100%;justify-content:center;padding:10px;color:var(--red);border-color:var(--red-b)" onclick="confirmDeleteUser('${email}')">
      <i class="ti ti-trash"></i> このユーザーを削除する
    </button>`:''}`;
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
    id:'m'+Date.now(), to:email, from:(currentUser&&currentUser.email)||MASTER_EMAIL,
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
  const isLocalOnly=[DEMO_USER,DEMO_ADMIN,MASTER_USER].some(u=>u.email===currentUser.email);
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
  u.role=role;saveUserToAWS(u);
  renderUserTable();renderMasterUserTable();renderRoleTable();refreshStats();showUserDetail(email);
}

/* ══════════════════════════════════════
   ROLE TABLE
══════════════════════════════════════ */
function renderRoleTable(){
  const tbody=document.getElementById('role-table-body');if(!tbody) return;
  tbody.innerHTML=userStore.filter(u=>u.role!=='master').map(u=>`<div class="admin-table-row" style="grid-template-columns:1.5fr 2fr 1fr 1fr">
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
  u.role=role;show(`${u.name} のロールを変更しました`,true);
  renderRoleTable();renderMasterUserTable();renderUserTable();refreshStats();
}
function quickSetRole(email,role){const u=userStore.find(u=>u.email===email);if(!u||u.role==='master') return;u.role=role;saveUserToAWS(u);renderRoleTable();renderMasterUserTable();renderUserTable();refreshStats();}

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
  if(id==='admin') renderUserTable();
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
  // 広告ポップアップ（解放済み＆ONの場合のみ）
  if(isAdUnlocked() && isAdPopupEnabled()) showAdPopup();
}
function guardedScreen(id){
  if(!isLoggedIn){const g=document.getElementById('login-gate');g.classList.remove('hidden');g.style.display='';return;}
  if(id==='admin'&&!isAdmin()){alert('管理者権限が必要です');return;}
  if(id==='master'&&!isMaster()){alert('マスター権限が必要です');return;}
  if(id==='admin') renderUserTable();
  if(id==='mypage'){ renderFavorites(); updateInboxBadge(); } // マイページを開いたらお気に入りとバッジ更新
  if(id==='master'){
    renderMasterUserTable();renderRoleTable();renderFieldManagement();
    // 広告タブは解放済みの場合のみ表示
    if(isAdUnlocked()) renderAdManagement();
    // 隠しコード入力欄を表示
    const unlock = document.getElementById('master-secret-unlock');
    if(unlock) unlock.style.display = 'block';
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
  if(!AWS_API_URL) return;
  try{
    const res=await fetch(AWS_API_URL+'?action=add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...prop})});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    showDataSourceBadge('AWS');
  }catch(e){console.error('AWS POST失敗:',e.message);}
}

async function updatePropertyOnAWS(prop){
  if(!AWS_API_URL) return;
  const res=await fetch(AWS_API_URL+'?action=update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...prop})});
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
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
    <div style="margin-top:10px;font-size:13px">AWSから物件データを読み込み中…</div></div>`;
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
      <div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:6px">AWS接続エラー</div>
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
  const targets=PROPS.filter(p=>!p.lat||!p.lng).filter(p=>normalizeAddress(p.address)||normalizeAddress(p.area));
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
function openContactForm(propId){
  const prop=PROPS.find(p=>p.id===propId);
  if(!prop){alert('物件が見つかりません');return;}
  const ov=document.getElementById('contact-overlay');
  const body=document.getElementById('contact-body');
  const ownerLabel = prop.ownerName ? `${prop.ownerName} さん` : '担当者';
  body.innerHTML=`
    <div style="font-size:12px;color:#64748b;margin-bottom:16px;line-height:1.7">
      <strong style="color:var(--navy)">${prop.name}</strong> について、${ownerLabel}へお問い合わせします。
    </div>
    <div class="field"><div class="flabel">お名前</div>
      <input class="finput" id="ct-name" value="${currentUser?currentUser.name:''}" placeholder="お名前"></div>
    <div class="field"><div class="flabel">返信先メールアドレス</div>
      <input class="finput" id="ct-email" value="${currentUser?currentUser.email:''}" placeholder="you@example.com"></div>
    <div class="field"><div class="flabel">お問い合わせ内容</div>
      <textarea class="finput" id="ct-msg" rows="5" placeholder="内見希望日、質問など" style="resize:vertical"></textarea></div>
    <div id="ct-status" style="display:none;font-size:12px;margin-bottom:10px"></div>
    <button class="btn btn-p" style="width:100%;justify-content:center;padding:11px" onclick="submitContact(${propId})">
      <i class="ti ti-send"></i> 送信する
    </button>`;
  ov.classList.add('show');
  // 履歴に積む（戻る／スワイプで閉じられるように）
  const cur=history.state;
  pushNavState({screen:(cur&&cur.screen)||'top', modal:'contact', propId:propId});
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
  const name=(document.getElementById('ct-name')||{}).value?.trim()||'';
  const email=(document.getElementById('ct-email')||{}).value?.trim()||'';
  const text=(document.getElementById('ct-msg')||{}).value?.trim()||'';
  const status=document.getElementById('ct-status');
  const show=(t,ok)=>{status.style.cssText=`display:block;font-size:12px;margin-bottom:10px;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;};
  if(!name||!email){show('お名前とメールアドレスを入力してください',false);return;}
  if(!text){show('お問い合わせ内容を入力してください',false);return;}
  const to=prop.ownerEmail||MASTER_EMAIL; // 登録者、なければマスター
  const msg={
    id:'m'+Date.now(), to, from:email, fromName:name,
    subject:`【物件お問い合わせ】${prop.name}`,
    body:text, propId:prop.id, propName:prop.name,
    time:new Date().toISOString(), read:false
  };
  // サイト内メール保存
  await saveMessage(msg);
  // 実メール送信
  show('送信中...',true);
  const mailOk=await sendRealMail(to, msg.subject, `${name} 様（${email}）からお問い合わせがありました。\n\n物件：${prop.name}\n\n${text}`);
  show(mailOk?'✓ 送信しました（サイト内メール＋メール送信）':'✓ サイト内メールに送信しました',true);
  updateInboxBadge();
  setTimeout(closeContactForm,1600);
}

/* マスター宛お問い合わせ送信 */
async function submitMasterContact(){
  const name=(document.getElementById('mc-name')||{}).value?.trim()||'';
  const email=(document.getElementById('mc-email')||{}).value?.trim()||'';
  const text=(document.getElementById('mc-msg')||{}).value?.trim()||'';
  const status=document.getElementById('mc-status');
  const show=(t,ok)=>{if(status){status.style.cssText=`display:block;font-size:12px;margin:10px 0;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;}};
  if(!name||!email||!text){show('すべての項目を入力してください',false);return;}
  const msg={
    id:'m'+Date.now(), to:MASTER_EMAIL, from:email, fromName:name,
    subject:'【運営へのお問い合わせ】', body:text,
    time:new Date().toISOString(), read:false
  };
  await saveMessage(msg);
  show('送信中...',true);
  const mailOk=await sendRealMail(MASTER_EMAIL,'【運営へのお問い合わせ】',`${name} 様（${email}）\n\n${text}`);
  show(mailOk?'✓ 送信しました':'✓ サイト内メールに送信しました',true);
  updateInboxBadge();
  ['mc-name','mc-email','mc-msg'].forEach(id=>{const el=document.getElementById(id);if(el&&id==='mc-msg') el.value='';});
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
        <i class="ti ti-user"></i> ${m.fromName||'不明'} <span style="color:#94a3b8">（${m.from||''}）</span>
      </div>
      <div style="font-size:13px;color:var(--navy);line-height:1.7;white-space:pre-wrap;background:var(--surface2);border-radius:8px;padding:12px">${m.body||''}</div>
      <div style="margin-top:10px">
        <a href="mailto:${m.from}?subject=Re: ${encodeURIComponent(m.subject||'')}" class="btn btn-sm"><i class="ti ti-corner-up-left"></i> メールで返信</a>
      </div>
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
        ${p.floorplanData?'<div class="prop-vr-badge"><i class="ti ti-vr"></i> VR対応</div>':''}
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
  // インライン広告を挿入
  setTimeout(injectInlineAds, 50);
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
    <span style="font-weight:700;color:var(--navy)">${p.name}${p.floorplanData?'<span class="tag tb" style="font-size:9px;margin-left:4px">VR</span>':''}<br>${ownerLabel}</span>
    <span style="color:#64748b">${p.area}</span>
    <span style="color:var(--blue);font-weight:700">¥${Number(p.price).toLocaleString()}</span>
    <span style="display:flex;gap:5px">
      <button class="btn btn-sm" style="font-size:10px;padding:3px 8px" onclick="showPropDetail(${p.id})"><i class="ti ti-eye"></i></button>
      ${editBtns}
    </span>
  </div>`;
  }).join('');
}

function deleteProp(id){
  const prop=PROPS.find(p=>p.id===id);
  if(!canEditProp(prop)){showToast('この物件を削除する権限がありません','warn');return;}
  PROPS=PROPS.filter(p=>p.id!==id);removeMapMarker(id);favs.delete(id);
  renderCards();renderAdminPropTable();renderMapSidebar();updateResultsCount();
  deletePropFromAWS(id);
}

/* ══════════════════════════════════════
   EDIT PROPERTY
══════════════════════════════════════ */
let editingPropId=null, editingExistingPhotos=[];

function startEditProp(id){
  const prop=PROPS.find(p=>p.id===id);if(!prop){alert('物件が見つかりません');return;}
  if(!canEditProp(prop)){showToast('この物件を編集する権限がありません','warn');return;}
  editingPropId=id;editingExistingPhotos=[...(prop.photoURLs||[])];
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

async function deletePropFromAWS(id){
  if(!AWS_API_URL) return;
  try{
    const res=await fetch(AWS_API_URL+'?action=delete&id='+encodeURIComponent(id),{method:'DELETE'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
  }catch(e){console.error('AWS物件削除失敗:',e.message);}
}

function startPolling(){
  if(!AWS_API_URL) return;
  setInterval(async()=>{
    try{
      const res=await fetch(AWS_API_URL+'?action=list');
      if(!res.ok) return;
      const data=await res.json();
      const np=Array.isArray(data)?data:(data.items||data.properties||[]);
      if(np.length!==PROPS.length){
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
    ['入居時期',d.available],['取引態様',d.transaction],['総戸数',d.units],
    ['駐車場',d.parking],['契約期間',d.contract],['更新料',d.renewal],
    ['保証会社',d.guarantor],['入居条件',d.conditions],['損保',d.insurance],
    ['その他費用',d.otherfees]
  ].filter(([l,v])=>v&&v.trim());
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
  if(vrBtn) vrBtn.style.display=prop.floorplanData?'flex':'none';
  setTimeout(()=>{
    const miniEl=document.getElementById('pd-mini-map');
    if(!miniEl||typeof L==='undefined') return;
    if(pdMiniMap){pdMiniMap.remove();pdMiniMap=null;}
    if(prop.lat&&prop.lng){
      pdMiniMap=L.map('pd-mini-map',{zoomControl:false,attributionControl:false}).setView([prop.lat,prop.lng],15);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:20}).addTo(pdMiniMap);
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
  if(editingPropId!=null){
    const propIdx=PROPS.findIndex(p=>p.id===editingPropId);
    if(propIdx<0){alert('編集対象が見つかりませんでした');resetEditMode();return;}
    const existing=PROPS[propIdx];
    const mergedPhotos=[...editingExistingPhotos,...newPhotoURLs];
    const updated={...existing,name,area,address,station,walkMin,price:rent,mgmt,deposit,key:keyMoney,madori,size,type,structure,age,description:desc,access,details,photoURLs:mergedPhotos,
      floorplanURL:window.editedFloorplanThumb||existing.floorplanURL||null,floorplanData:window.editedFloorplanData||existing.floorplanData||null};
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
  const newProp={id:nextPropId++,name,area,address,station,walkMin,price:rent,mgmt,deposit,key:keyMoney,madori,size,type,structure,age,features:[],tags:[],description:desc,access,details,
    ownerEmail:(currentUser&&currentUser.email)||null, ownerName:(currentUser&&currentUser.name)||null,
    photoURLs:newPhotoURLs,floorplanURL:window.editedFloorplanThumb||null,floorplanData:window.editedFloorplanData||null,
    lat:preCoords?preCoords.lat:null,lng:preCoords?preCoords.lng:null};
  PROPS.push(newProp);renderCards();renderAdminPropTable();updateResultsCount();renderMapSidebar();
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
  window._afGeoCoords=null;
  uploadToAWS(newProp);clearAddForm();toggleAddForm();
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
  if(typeof resetEditMode==='function') resetEditMode();
}

/* ══════════════════════════════════════
   MISC & MISC
══════════════════════════════════════ */
const _style=document.createElement('style');
_style.textContent='@keyframes spin{to{transform:rotate(360deg)}}@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(_style);

function switchMp(id,el){
  ['fav','inbox','hist','prof','wish','code'].forEach(k=>{const e=document.getElementById('mp-'+k);if(e) e.style.display=k===id?'block':'none';});
  document.querySelectorAll('.mp-nav-item').forEach(i=>i.classList.remove('on'));el.classList.add('on');
  if(id==='fav') renderFavorites();
  if(id==='inbox') renderInbox();
  if(id==='hist') renderHistory();
}
function switchAdmin(id,el){
  ['props','group','users','stats'].forEach(k=>document.getElementById('admin-'+k).style.display=k===id?'block':'none');
  document.querySelectorAll('#s-admin .admin-nav-item').forEach(i=>i.classList.remove('on'));if(el&&el.classList) el.classList.add('on');
  if(id==='users') renderUserTable();
  if(id==='group') renderGroupManagement();
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

        <!-- メールアドレスで直接招待 -->
        <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:4px"><i class="ti ti-user-plus" style="color:var(--blue)"></i> メンバーを直接追加</div>
          <p style="font-size:11px;color:#94a3b8;margin-bottom:8px">登録済みの管理者を、招待コードなしで直接グループに追加できます。</p>
          <div style="display:flex;gap:8px">
            <input class="finput" id="invite-email" placeholder="追加する管理者のメールアドレス" style="flex:1;font-size:12px">
            <button class="btn btn-p btn-sm" style="white-space:nowrap" onclick="inviteMemberByEmail()"><i class="ti ti-plus"></i> 追加</button>
          </div>
          <div id="invite-status" style="display:none;font-size:11px;margin-top:6px"></div>
          <!-- 追加できる管理者の候補 -->
          <div style="margin-top:10px">
            <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">未所属の管理者から選ぶ</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px" id="invite-candidates">
              ${(()=>{
                const cands=userStore.filter(u=>u.role==='admin'&&!u.groupId&&u.email!==currentUser.email);
                if(!cands.length) return '<span style="font-size:11px;color:#cbd5e1">候補がいません</span>';
                return cands.map(c=>`<button class="btn btn-sm" style="font-size:11px;padding:4px 10px" onclick="inviteMemberDirect('${c.email}')"><i class="ti ti-plus"></i> ${c.name}</button>`).join('');
              })()}
            </div>
          </div>
        </div>

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

function createGroup(){
  const nameEl=document.getElementById('new-group-name');
  const name=(nameEl?.value||'').trim();
  if(!name){showToast('グループ名を入力してください','warn');return;}
  const code=genGroupCode();
  currentUser.groupId=code;
  currentUser.groupName=name;
  currentUser.groupOwner=true;
  const s=userStore.find(u=>u.email===currentUser.email);
  if(s){s.groupId=code;s.groupName=name;s.groupOwner=true;}
  saveUserToAWS(currentUser);
  showToast('グループを作成しました','success');
  renderGroupManagement();
}

function joinGroup(){
  const codeEl=document.getElementById('join-group-code');
  const code=(codeEl?.value||'').trim().toUpperCase();
  if(!code){showToast('招待コードを入力してください','warn');return;}
  // そのコードのグループが存在するか（既存メンバーを探す）
  const owner=userStore.find(u=>u.groupId===code);
  if(!owner){showToast('そのコードのグループが見つかりません','warn');return;}
  currentUser.groupId=code;
  currentUser.groupName=owner.groupName||'グループ';
  currentUser.groupOwner=false;
  const s=userStore.find(u=>u.email===currentUser.email);
  if(s){s.groupId=code;s.groupName=owner.groupName;s.groupOwner=false;}
  saveUserToAWS(currentUser);
  showToast('グループに参加しました','success');
  renderGroupManagement();
  renderAdminPropTable(); // 編集可能な物件が増えるので再描画
}

function leaveGroup(){
  if(!confirm('グループを脱退しますか？\n脱退すると、グループメンバーの物件を編集できなくなります。')) return;
  currentUser.groupId=null;
  currentUser.groupName=null;
  currentUser.groupOwner=false;
  const s=userStore.find(u=>u.email===currentUser.email);
  if(s){s.groupId=null;s.groupName=null;s.groupOwner=false;}
  saveUserToAWS(currentUser);
  showToast('グループを脱退しました','info');
  renderGroupManagement();
  renderAdminPropTable();
}
window.createGroup=createGroup;window.joinGroup=joinGroup;window.leaveGroup=leaveGroup;
window.renderGroupManagement=renderGroupManagement;

/* メールアドレスを指定してメンバーを直接追加 */
async function inviteMemberByEmail(){
  const el=document.getElementById('invite-email');
  const email=(el?.value||'').trim();
  const status=document.getElementById('invite-status');
  const show=(t,ok)=>{if(status){status.style.cssText=`display:block;font-size:11px;margin-top:6px;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;}};
  if(!email){show('メールアドレスを入力してください',false);return;}
  await _addMemberToGroup(email, show);
  if(el) el.value='';
}

/* 候補ボタンから直接追加 */
async function inviteMemberDirect(email){
  const status=document.getElementById('invite-status');
  const show=(t,ok)=>{if(status){status.style.cssText=`display:block;font-size:11px;margin-top:6px;color:${ok?'var(--green)':'var(--red)'}`;status.textContent=t;}};
  await _addMemberToGroup(email, show);
}

/* グループにメンバーを追加する共通処理 */
async function _addMemberToGroup(email, show){
  if(!currentUser||!currentUser.groupId){show('先にグループを作成してください',false);return;}
  const target=userStore.find(u=>u.email===email);
  if(!target){show('そのメールアドレスのユーザーが見つかりません',false);return;}
  if(target.email===currentUser.email){show('自分自身は追加できません',false);return;}
  if(target.role!=='admin'&&target.role!=='master'){show('管理者のみグループに追加できます',false);return;}
  if(target.groupId===currentUser.groupId){show('すでにこのグループのメンバーです',false);return;}
  if(target.groupId){
    if(!confirm(`「${target.name}」は既に別のグループに所属しています。\nこのグループに移動しますか？`)) return;
  }
  target.groupId=currentUser.groupId;
  target.groupName=currentUser.groupName;
  target.groupOwner=false;
  await saveUserToAWS(target);
  // 本人に通知
  await saveMessage({
    id:'m'+Date.now(), to:target.email, from:currentUser.email, fromName:currentUser.name||'運営',
    subject:`【VR Homes】グループ「${currentUser.groupName}」に追加されました`,
    body:`${currentUser.name} さんにより、グループ「${currentUser.groupName}」に追加されました。\n\nこれにより、グループメンバーの物件を編集・削除できるようになります。\n管理者画面の「グループ」タブから確認できます。`,
    time:new Date().toISOString(), read:false
  });
  sendRealMail(target.email, `【VR Homes】グループに追加されました`,
    `${currentUser.name} さんにより、グループ「${currentUser.groupName}」に追加されました。`).catch(()=>{});
  show(`✓ 「${target.name}」をグループに追加しました`,true);
  renderGroupManagement();
  renderAdminPropTable();
}

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
window.inviteMemberByEmail=inviteMemberByEmail;
window.inviteMemberDirect=inviteMemberDirect;
window.removeGroupMember=removeGroupMember;
/* ── 広告管理 隠しコード解放 ── */
const AD_UNLOCK_KEY = 'vr_ad_unlocked';
function isAdUnlocked() {
  try { return localStorage.getItem(AD_UNLOCK_KEY) === 'yes'; } catch(e) { return false; }
}
function submitSecretCode() {
  const inp = document.getElementById('secret-code-input');
  const msg = document.getElementById('secret-code-msg');
  const code = (inp ? inp.value.trim() : '').toLowerCase();
  if (code === AD_SECRET_CODE.toLowerCase()) {
    localStorage.setItem(AD_UNLOCK_KEY, 'yes');
    if (inp) inp.value = '';
    if (msg) {
      msg.style.cssText = 'font-size:11px;margin-top:6px;color:#e0c97a;display:block';
      msg.textContent = '🔓 広告管理が解放されました';
      setTimeout(() => msg.style.display = 'none', 2500);
    }
    // タブをサイドバーに追加 & パネル表示
    _showAdTab();
    renderAdManagement();
    switchMaster('ads', document.getElementById('master-ads-nav-item') || {classList:{add:()=>{},remove:()=>{}}});
  } else if (code === 'lock') {
    // 再ロック
    localStorage.removeItem(AD_UNLOCK_KEY);
    _hideAdTab();
    if (inp) inp.value = '';
    if (msg) {
      msg.style.cssText = 'font-size:11px;margin-top:6px;color:#94a3b8;display:block';
      msg.textContent = '🔒 広告管理をロックしました';
      setTimeout(() => msg.style.display = 'none', 2000);
    }
    switchMaster('fields', document.querySelector('.admin-nav-item'));
  } else {
    if (msg) {
      msg.style.cssText = 'font-size:11px;margin-top:6px;color:#f87171;display:block';
      msg.textContent = 'コードが違います';
      setTimeout(() => msg.style.display = 'none', 2000);
    }
    if (inp) { inp.value = ''; inp.focus(); }
  }
}
function _showAdTab() {
  let tab = document.getElementById('master-ads-nav-item');
  if (tab) { tab.style.display = 'flex'; return; }
  tab = document.createElement('div');
  tab.id = 'master-ads-nav-item';
  tab.className = 'admin-nav-item';
  tab.style.color = '#e0c97a';
  tab.innerHTML = '<i class="ti ti-speakerphone" style="color:#e0c97a"></i>広告管理';
  tab.onclick = () => switchMaster('ads', tab);
  const sidebar = document.querySelector('#s-master .admin-sidebar');
  if (sidebar) {
    // 物件条件管理の次に挿入
    const fieldsTab = [...sidebar.querySelectorAll('.admin-nav-item')].find(el => el.textContent.includes('物件条件'));
    if (fieldsTab) fieldsTab.after(tab);
    else sidebar.appendChild(tab);
  }
}
function _hideAdTab() {
  const tab = document.getElementById('master-ads-nav-item');
  if (tab) tab.style.display = 'none';
}

function switchMaster(id,el){
  ['users','roles','fields','ads'].forEach(k=>{const e=document.getElementById('master-'+k);if(e) e.style.display=k===id?'block':'none';});
  document.querySelectorAll('#s-master .admin-nav-item').forEach(i=>i.classList.remove('on'));
  if(el && el.classList) el.classList.add('on');
  if(id==='users') renderMasterUserTable();
  if(id==='roles') renderRoleTable();
  if(id==='fields') renderFieldManagement();
  if(id==='ads' && isAdUnlocked()) renderAdManagement();
}

/* ══════════════════════════════════════
   ハリウッドザコシショウ 広告システム
   ※ 著作権上、実在の画像は使用せずSVGで
     キャラクター風イラストを自作しています
══════════════════════════════════════ */
const AD_STORAGE_KEY = 'vr_zachoshi_ads';

const DEFAULT_ADS = [
  { id:'ad1', variant:'指差し', emoji:'👆', label:'オマエがヤレ！！', color:'#ff6b00',
    img: 'data:image/jpeg;base64,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',
    url: 'https://qjweb.jp/feature/54666/'
  },
  { id:'ad2', variant:'舞台ポーズ', emoji:'🎭', label:'んーーー！！！', color:'#0055ff',
    img: 'data:image/jpeg;base64,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',
    url: 'https://qjweb.jp/feature/54666/'
  },
  { id:'ad3', variant:'眼球眼鏡', emoji:'🔍', label:'眼球眼鏡だゾ！！', color:'#cc00cc',
    img: 'data:image/jpeg;base64,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',
    url: 'https://qjweb.jp/feature/54666/'
  },
  { id:'ad4', variant:'ゴース！', emoji:'👁️', label:'ゴース！！！！', color:'#00aa44',
    img: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCADIASwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBNuDS7cipQtAU+lbXPl+Ui2cUoX2qQLS7aLisRBaULUgXNLsp3DlI9vFG3vUm30pdtFw5SMLRtqQL7Uu2i4cpFtpQtSbaNtFxWIttGypdvNaOnaS95iSTKQ+vc/SpnUjCN5M1o4edafJBXZk7e9KIzt6H8q7i00qwgUFLdSw/ibk/rVl9gTAAHtiuOWOS2R68Mlk/ilb5X/wAjz3Z3o212dzptrdZ3xLn1Xg1z2o6W9i+QS0ZPB7j61pRxkKj5dmcuKyurQjzrVGbt9qTbUu3ik212XPJaIse1G2pStAWnclxIsYNGKk20YouTYi20bak20m3FO4rEeOaQjNSlaTbRcViPFGOKfijFAhm2grT9tGKYhmKMU/FLtoGMxRin4oxmkA3aMUmCaftoCnHSgZPtFG2n7eaXFc56Nhm2jbUgXijFO4WI9tG2pQtG2gViPbRt5qTbRtoCwwLRtqTbRtpisM20bafil20BYW1g86YKw+Ucn6V0UMnyBVGFHAx0rlBqb2WrRW3mxbZ1wIyPmz/hU/8AwkZtbtLS+IhLvsR0iLZPpgcj8q8HHVJzrcq2R9plGEjDCqp1ludhE/y9aQkk8CqttOjIpWQSKwyrryGFW2YAccGsVqjscbMY0uwVSvHW5jaNhwR37VPNMA+MfjWe08cpyjA7unuPWsZTcXozWNJTTUloYrIVYqeo4pNtWJ1/ft9aixX1FKfPBS7o/PMRS9lWlDs2iIrzRtqTFGOa1Odoi29qNtSYoI9KCWiIrRj2qTFJimTYi20EVJtyaQigViPbzSbak20YxTJsRgUpHangUYoFYZgUY4p+3mjFADMc0Yp+KMUAMIoC5HFPxntSAYFAFnbS4qTbRiuc9SwwLRin4pdtAWI9tLtqTFAFArEe2jbUmKMUwsMxRtp+2jbRcLDMUbafilxTFYsaXp0c179qlijOxNokZQSOeg9OlW3tUl1AXtvJGsifKzbef/rVg3OoarDcfZNN2DdHlmdNwTnrjv8AT2q95tzYKt9cTrIwwswWPYMf3sZP/wCqvncTLmqS9T77AUHDDQs90vx1NmL7PbORhVLHJAHU+tOme4/gClT3NV2kjbZMcMCOtWXnR48nKgVgpLVXNXFpp2uUpGYb2kAIRckAcVVDx/ZRO0Dx3Mblm8xRn/gJHVcdKna4iUO0sojQj75PSq08n2yURQbmjUcegHtWaejZ1QiyGVJjiSWPYW6CottWjE8kgXduYnGe2fQfTuaZJC8TbXUg172ArKdJR6o+JznCSp4h1Evdlrcr7aCKlIpNteieJYi20EVLjFJimQ0RbaQrUu2kxQS0RFaTFSlabt5pktEe3NJtqTFGO1MlojAoxT8ECgigmwzFGKfijHPSgQzFJipMUYNArDMdaQKSOlPxSYoBlzFLingUYrnPWsM20uKfijFAWGbaNtPApcUBYZijbT8UY5pisMxRin4oxQFhmKMU/bRigLHN+L7S4ksEuLSV45Izg7TjIPrXOaDr2stA63lz59uCUVJBlvfn0r0K6tlurWWBuBIpGfT3rDtfDen2spcXsvmTMGMAAAB74PofWvLxijFu63Pr8kqOrSUW37n5Pb9fwNDSr5ktI4JM4UfLnsPSpbnVCWCLkKOpzTr2yjkLPH8pwMY9RxWY0IUFZW3N6A14e7Z9FFReprW0n2kkuMoe3rWpHEqwskOcMcsxrnbJppJFiiGccn0Fbbfa4odoAZmGOOwpxdjKrHVJMsaXCzzNKcBR8sY9F9fqTV26tBIvzAGs3T71jI0cg2lcCtiJ/N44rootW03OHERfN7y0MWawZeY+fY1VKMpwwIPvXSSQ9cVA0KkbXQMPcV6dLGzjpPU8KvlVKp71J8r7dDA20ba2W0uGQZQlD+YqrLpc8YyuHHt1rvhiqUutjx6uXYin0v6f1cz8UhWpmQqcMpB9DTSK6Ezz3G25FikIqXbTStUQ0REUmKk2+1G2ghoixRtqTFJgUybEeKMVJijFBNiMjmjHrTyOtGM0xWI8ZpKkxSYoJaLuKXFOxS4rmPYsNxRinYpcUBYZilxTsUYoCw3FGKfijFMLDMUYp+KMUCsMxRin4pMUBYbisWa0sbHWDdyZR5eUGflJ74963MVDdwQ3MBhuIUlRuqMMiuXFwjKk+Z2senlVapRxC9mr30t/XY5vWvE8astrZ5kkPA2c/wCetZX2q6S6K3m6Fh/A3BJ967S1sbLT0/0e3iiz3VRn86p65pdvqti1yABPAcK2Oo9DXgxnTWlvmfaxck7sh0HWIICLaaPZI5zu7MPauujvLVoy2e1eXRpdw3KEgnaeoNdZp1280RWUAKn60pe47oqrRU9TRndBdCRO47Vs2GWAJrn4m8+7Rf8AIFdNaBVQLnpRRV53ObFe7BInZeeKbtB4NOJwuahV9z4FdbaTPOSY4JsbipduRQKcoqkhNlae2imGJEB/nWXc6W8eWi+dfTvW8wFM2itqdWdN6M5q+GpV176179TlipBwRjFNIroLuwjuBuHyv/eH9axpreSByki49/WvTpV41PU+dxWCnQd913K5FNxUpFNIroOBojxSY5qQikxTuTYZijFP20baCbDNtJtqQj1pCtBNhm2kxUhFJimKxcxS4p2KXFcp6thmKXFOxRimA3FGKfigCgLDMUuKdijFAWG4pMU/FGKAsMxRinYoxTFYbik2cbj0PAp5GFP0oaM3UAUE+xFeTmUnaMUfQZJBXnN+SK0zxgYOPaqKXC7prZSCzLuUepHUflVLUnudPm3XAPl5wH7fjTtOtWMy3judynKgV49tNT6xQXLuStoTFRKHxu+6pHT2NV8TQkKVKlTz711ReK5t8jAjbg46qfX8KwdRRoZDG5yw70XJpVHLSRZ05fn80nk8Vsx3BBrnrG4/dLz6/wA6045RtzVRlZmdanzPU02uzs9qjtZy8pqjJKdvWrFiMDdWim3JHO6ajFmwJAMe9PLgVkSXY+2KpbCou4j1PapobgyueeBW6qq9jkdF2uaOc0qiokkGKdv71umYtMlwKjnto50KOuR/KjzPenq+apS10IlG6szAvLJ7VvVD0aqpFdTJGsqlXAINYV5ZtbPxkoehr0aFfm92W58/jcF7P34bfkUselJipCtG2uw8qxHjNLtp+2jFArEZWk21LikxQTYiK0m3joKlI4NNx+NMlouYoxT8UYrnPTG4oxT8UYoAZil207FLigBqqCwBOAT1p5t2+cr8yp1PtUT3VlFuinchyCMZxV62eMSRjd/rI+D6n0riqYrlnZHsUcuc6PNPRvVeliBbSdxlYmI+lRvE8bbXUqfQittPNLAEc1LOkbR4lCke9XHEN6taGc8BFaJ6nObaXbWnNpqN80DYz2bp+dUZIZIjiRCtbxqRlscFShOn8SIcVa0aEqrK3O1iB9KgxV/TeEbHrXLjEnyt9zvy2Uk5pbNfqWru0guLdkkhR1IwQyg5ritTg/spt8K4tScEf88j/h/Ku6b7uKwNTRVaQSKGRwQQRwa83ExWjPoMHUcZWMGy1VYJMkgo33lqe+aK9t90TAyRjdG3qB1U+/8AT6VyE1rfQXN41nG09nbsOnLICM49wPzpljrTLJs87EEvDH+6ezVi8PJLmR6PPSnJuD1W5uW8mNzIfk3ZHtntWpBMSo9KxdF09LKzuVQsVluDIFJyFyBkD271tWqnjisJJKWhte8btFwIWwTxV5CI4M+gqBAAvApuozi306RycbVzWkdDjn7zSM03itdSuDkscD6CtizBWIM3GenvXI2VykbAqNzZ+89dBBfKAN775D2pJcr1LqQbWhuJIFGak8wnmqMEob5m5PpVuMhuf1rojK5wzjYnUZ5NTLUSkU4Hv6VutDnepMDUdwiSxlGGQaN9QSyhQTmm52JUObRmRLEY3KnsaZio5dYsJtUNgLqP7UF3eXu5x/ntU+2vXw9T2lNSZ8rjKHsK0oLYZijFOxSgVuclhhFGKkxSYouKxGRxSbakI4pAvFO5Ni1ijFOxS4rA9Cw3FGKdijFADcUoUkgAZJpcUw3F6Dtt4IYAP+Wkjbm/AD/GonJrZXNqNKM370kki1HYuw3OQgH97rXJzaxJYalNp8oeLy38yF5D1HcfQjpW/JBdXDbp9RuD2xFiMf1P61Ru/DGl30qS3MU0kicBzO+f51x1aFSt8Wh62GxeFwt1G7v/AF/Wg658YJDBGsEsc9w/CxR/O5/AVmajqXjC6g82HT44lHOwygOR9O1blhpVjpiFbK1jh3feKj5j9T1q1iqhhFb33cyq5m7/ALmKXrqzk9E8fyG8+xX48uQcMHBUq3oQa7mG9gu4uqsCOlcV4w8Hx69b/aLXEV/EP3bjgP8A7LH+R7VyGgeJr/SrhrW7EivC22SN+CCKxq0JUtYO67Hdh8RTxatJWkewSWaMSYzj2NLArWygH15rG0vxFBeRKyuPcZrXW7V8HPH8655VvaJJvY1WFVJtxW5eV961la9H/oLyD+EZq2swVsqeO4qrrkq/2TcNuAHlkZPQcU5NSg0yqScaiZi+HIQukJNj5p3aUn6nA/QCsLxL4IM7PfaKAk5OXtsgK/uvYH26V2Fpbi1tIbdekUaoPwFS4r2FTXIos+ceKqRryqwe7OM0W2vrTSvI1CF4ZhIcK2Pu8YP0rXsxT9bkEUmf9kVTtLseVvXmvmcQuWrJLa59vhpyq4eM3u0bIKqMscCsLxRqKxWqx79vmMByeveroeWYBn+Uelcp4om33UURwVRST9T/APqqqXvSSHy8upDCVlPySNn2rTtp3t8GQhF9c5JrD06VDIFYbq6GCFJ0A2itKujszZO6L8GuQ7ghfj+dbttfrIgxwD0rmH0aHb5iZ3jpRa3M1vJsZSTnrWN7axM5U4yR2izgjg08TBVAHQVh292cDccGrQmwhZjgd60VU45UbF+S6WOMu7AKBkk15t4p8ezXMjWWjthOQ1wO/wDu+n1qh4v8Uy61LJYWM3l2EbbZJQf9a3oD/d/nXIuQ2URgVH8KdPxNehRw/N70/u/zOKrVUdIfeWrW4kt51njkHmhw+8cnd657/jXr+h6rFrWmR3UZAf7sqD+F+4/wrxbzioC7UUD+7XW/DjUJB4gazEn7qaFiV9WXBH9a9GndM8jG04zp36o9MxQBT8UmK6DwrCYoxTsUuKAsRleKTbmpCOKQDigmxYxRilorE7RMUuKWigBMUuKXFFAxMUYpaXFMBuKMU7FGKBDcVzHivwbDrwF1bMtvfxjAkI+WQejY/nXU0mKGrlQlKD5oni06ar4cufLv7ea3weH6o3uGHBrpdF8WO6hWlV/cmvQpI0lQpIiujdVYZB/CuS1/wBaXp+1aOI7G7HJQZEcn1A+6fcVx1sJGa03Paw2atNRqLQ1LXV2nIII/CoPFWoxQ+HLlJXx5q7AB1Oa5hLbXNDlVLyBMYzuSdWFZ+t6kl9NDBLmRtwznoOeRj6V5apTjU5We+nTnBVIbHceFtZN54Xtbq9dRIN0eR/FtOAfrjFacN21wSyoQo7VzWnywyhY4lVI0HAUYA+lbMN5FboRu4+tVVx1SXurRficcMqo05ObV3+CKuqadc310WbCxH0PNRW1kLdynUCrz61b8KXFVmv4TIcHmuCTuepByUbWJZiETr2rz/wAV/wBo2OopetGfsdwoETdQSOo9jXZzXIdTtO7t+Nbz6Va3WkLp97As0RQK6N6+vsc969HAU+eTb7HmZlinhoRtu3+B45bagkrjacE9jXT6RfshAlddvb1rnvFnhG88M3Jmj3TWLn93Nj7v+y3offoaoWesJGAlwGI7FTyK66+GutAwuOjJe8z1OK7STCpyT+lS+TGcnaM+tcbpniW1hQKjfietacnimFIi5YD6mvKlQmnax6XNFq6ZukJATI7AAdq4fxZ4ya6V9M0xyVPE0qHGR3AP8zWVrviy41Um2tnKQfxuOC3sPasOIZ+6Aqevb/69ehhsFy+/U+48rFYvm9yn9/8AkPEZZAJW+QcBew+g707zAmEjjJb1bt+FSYROrEH1xlj9B2prCXafLTyUPV3PzGvRvc8+1ipOzhsMfmrV8H3EkHizTWjfazXCoT6g8EfkaxpAqnCsG+nNW9Dcpr+nMp5F1Fj/AL7FapaHNU1TPoPFG2nsPmP1orQ8Sw3bRtp+KMUgsRkcUgFSEcUmKZNiTFGKWlrI6xMUYpaWgBKKWimAYopaKAExRS4oxQITFGKdiimA3FGKWigLGD4o0a41O1V7MqJ4wRtY4DD0z615hcwXOn35a7gkjdRhlkQjn617bSbQRgjNYToRk7noYfH1KMVDdLY8Yh8QSWqsoUhM5VgDge1NOu3lyflMjKf7iE17LNaW9xE8U0KSI6lWVhwQabbWFrZwJBbwJHHGNqgDoKy+p073sdTzirbY8ltV1a6kC2+m3suep8kgfrXR2uleJJEEI01YU7vNKoP9TXf44pMU3g6T3I/tjE9LGBo/h6W1kWe/nSV15WOMHap9ST1rdxTsUYFdFOnGmrRR51evUry5qjuyOSKOaNopUV0YYZWGQR7ivOPH/grStP0OfV9NtzBLE6b0VvkKk4Jx26jpXpWKwvGSLL4auYCM+cNmPr/kU5SUYtsmgpOpGMXuzwATyKeDiplMtwC0spEa9STx+FRCPJJk+ULw3qT6VasLWTUryKBVGGbai9vf8B3pyaSuelHmb5RYoxKBtUiMHGP731NdDYeEPEF+izWujXMiHoxUIv4FsV6V4U8M6ZpcMcqwrPc4/wBdIoJB/wBkdFH0rs04GTXn/WlN+6tDtdB09HueI/8ACvvFhBK6SU9f3sef1NYur+HdV0dj/aOmXEQ7SyDcn4MDivohpAOM1DKyyIUIDKeCCMg/UUvrDixez5j5nMGeqJ7cmtDwrYtc+LtLiCbv9KRiB6A7if0r0vxP4D0u+3zWMYsbg8kwj5GPuvT8sVh/D3w5dQeKri5ulAWwjK7lOQ7uOMf8Bya6aOIjVdluc+JpOlTcnsemEUYp5FJius+fsJilxRS0BYQjikxTjSUBYWloorM6ApaKKYgpaKKACloopjCloooAKKKXFAhKSnUEUAMpQKXFGKAEApcUYpaAExRRS0ANxRilooEJWH4tGdCfHZ1P61u1na5Cs+lSowyuQSPxrOt/Dl6HRhdK8PVfmeCa3YPBcPMgzGxyQP4Sf6Vo+B4Tda42CF8uLjPYZFdld6TZSI2Yh+NUtB0i103xFHLbhkEyMjJnK568flXmvFqdFx62Pp/qbhWVSOx6TpirHEAozgYya0g/GKyrOQCHA7cVfV8x4z71xU5aDqxvK46UttyvpUDyFT6U9pTuxnqKqXEuAc8YFE5BCJWvp8RsR1xVjTLRbOyVQuHf55Djksf84rKeTzWAPIJx+tdDjFduWxTcpHm5xJxjCmvNhSGloNewfPCUuKSnCgQhHFJinEcUUAJg0UuHPY0bT3BrO508ogFO2mkxinA4ouHKJg0YNPDCncUXDlI8UYqTilxTuHKR4oxUmKMUXDlI6XFPwKXAouHKRYNJg1NikxRcXKR0VJtFG2i4cozFGKfso2e1Fw5WR4oxUuz2pPL9qLhyMixRUvlUeV70XQcjIqr3sXn2U0Y6shx9aueT7ijyqTs1ZjjGUWmjiFtftEI2dWP5GsyS1lstTtmbtMBn6giuia3Npqk1vyEDbk+hpus2/m6fvUYKMpz+Ir5ppwm4s+3hUU4qS2Zfs5NoDdsYArSjOAVz1HWuftZSVCg9K2YpQ0Yw3JNTB2MqsR7EL3+v1rNvJyiMp44q/L+7jIZgT14rA1GbG7GTzinJ9ApK4yF90iE8fMDn8a6zmuRssmeCPHMkig/nXabR6V6uXaRkeLnKvOC8iHFGKm2ikwK9O54fIQ4NKKkI5pQBTuHIRmipdoxRt9qVxcpCJT60vmn1oorI7A8zNGQaKKYhMelOBIoopktChqcDRRQAuaXNFFMApeKKKQBSE0UUAG6lzRRQAbqNxoooEG4+tG40UUgEzSZoopgIXxSbyaKKYjG1pGjure6A4OY2/mP61DdsH0+XnjFFFeFjVatofTZc28Or9GZ8ZVXDA8Vo2s5Tbu55zmiiuHqelNJli4uF8ksDknkmsCdjJLnPAOTRRVXuyYKyLWhx+fq6HqsCGQ/XoP611maKK97BRSoo+ZzOTeIafSwZpaKK7DzQoFFFADuKOKKKAP/Z',
    url: 'https://qjweb.jp/feature/54666/'
  },
  { id:'ad5', variant:'ピンクポスター', emoji:'😤', label:'えやんえやん！！', color:'#ff0088',
    img: 'data:image/jpeg;base64,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',
    url: 'https://qjweb.jp/feature/54666/'
  },
  { id:'ad6', variant:'ソファ', emoji:'✨', label:'ウィッシュ！激似！', color:'#ddaa00',
    img: 'data:image/jpeg;base64,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',
    url: 'https://qjweb.jp/feature/54666/'
  },
];

function loadAds() {
  try { const s=localStorage.getItem(AD_STORAGE_KEY); if(s) return JSON.parse(s); } catch(e) {}
  return DEFAULT_ADS.map(a=>({...a}));
}
function saveAds(ads) { localStorage.setItem(AD_STORAGE_KEY, JSON.stringify(ads)); }
let adDefs = loadAds();

function getRandomAd() { return adDefs[Math.floor(Math.random()*adDefs.length)]; }

/* ── 広告クリック → ザコシショウ主張ページへ飛ぶ ── */
function openAdPage(ad) {
  const url = ad?.url || DEFAULT_ADS[0].url;
  window.open(url, '_blank');
}

/* ── 広告バナーHTML生成 ── */
function makeAdBanner(ad) {
  // 写真の実サイズに合わせたバナー（幅100%・高さauto）
  const adJson = JSON.stringify(ad).replace(/"/g,'&quot;');
  const mediaEl = ad.img
    ? `<img src="${ad.img}" style="width:100%;height:auto;display:block;cursor:pointer" onclick="openAdPage(${adJson})" loading="lazy">`
    : (ad.svg
        ? `<div onclick="openAdPage(${adJson})" style="cursor:pointer">${ad.svg}</div>`
        : `<div onclick="openAdPage(${adJson})" style="cursor:pointer;font-size:48px;text-align:center;padding:20px;background:#111">${ad.emoji}</div>`);
  return `<div class="ad-banner" style="width:100%;cursor:pointer;position:relative;border-radius:12px;
      border:2px solid ${ad.color};background:#0a0a0a;overflow:hidden;
      box-shadow:0 0 18px ${ad.color}55">
    ${mediaEl}
    <div style="background:${ad.color};width:100%;text-align:center;padding:4px;
      font-size:10px;font-weight:900;color:#fff;letter-spacing:.05em">📢 PR広告</div>
    <div style="position:absolute;top:5px;right:7px;font-size:9px;color:rgba(255,255,255,.5);
      background:rgba(0,0,0,.55);border-radius:4px;padding:1px 5px">広告</div>
  </div>`;
}

/* ── TOP下部 広告エリア（写真実サイズ・縦並び） ── */
function injectSideAds() {
  // 広告が解放されていなければ、既存の広告ブロックも消して何もしない
  if (!isAdUnlocked()) {
    const existing = document.getElementById('top-bottom-ads');
    if (existing) existing.remove();
    return;
  }
  // 左右サイドバーは廃止。代わりに lp-footer の直前に広告ブロックを挿入
  let el = document.getElementById('top-bottom-ads');
  if (!el) {
    el = document.createElement('div');
    el.id = 'top-bottom-ads';
    el.style.cssText = 'padding:0 24px 28px;max-width:1040px;margin:0 auto';
    // lp-footerの直前に挿入
    const footer = document.querySelector('.lp-footer');
    if (footer) footer.parentNode.insertBefore(el, footer);
    else {
      const top = document.getElementById('s-top');
      if (top) top.appendChild(el);
    }
  }
  el.innerHTML = '';
  // タイトル
  const title = document.createElement('div');
  title.style.cssText = 'font-size:11px;font-weight:800;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:6px';
  title.innerHTML = '📢 <span>PR・広告</span>';
  el.appendChild(title);
  // 広告グリッド（3列）
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:14px';
  adDefs.slice(0, 6).forEach((ad, i) => {
    const cell = document.createElement('div');
    cell.innerHTML = makeAdBanner(ad);
    grid.appendChild(cell);
  });
  el.appendChild(grid);
}

/* ── スクロール間広告（カードグリッドの間に挿入） ── */
function injectInlineAds() {
  const grid = document.getElementById('card-grid');
  if (!grid) return;
  // 既存のインライン広告を必ず削除
  grid.querySelectorAll('.inline-ad-row').forEach(el=>el.remove());
  // 広告が解放されていなければ挿入しない（デフォルトは完全非表示）
  if (!isAdUnlocked()) return;
  const cards = [...grid.children];
  // 4枚おきに広告を挿入
  const insertPositions = [4, 9];
  insertPositions.forEach((pos, idx) => {
    if (cards.length > pos) {
      const ad = adDefs[(idx*2) % adDefs.length];
      const adEl = document.createElement('div');
      adEl.className = 'inline-ad-row';
      adEl.style.cssText = 'grid-column:1/-1;margin:4px 0';
      adEl.innerHTML = `<div onclick="openAdPage(${JSON.stringify(ad).replace(/"/g,"'")})"
        style="cursor:pointer;background:linear-gradient(135deg,${ad.color}22,${ad.color}11);
        border:2px solid ${ad.color};border-radius:14px;padding:14px 20px;
        display:flex;align-items:center;gap:16px;position:relative;overflow:hidden">
        <div style="width:90px;height:90px;flex-shrink:0;border-radius:10px;overflow:hidden;border:2px solid ${ad.color}">
          ${ad.img?`<img src="${ad.img}" style="width:100%;height:100%;object-fit:cover">`:ad.svg||`<div style="font-size:40px;display:flex;align-items:center;justify-content:center;height:100%">${ad.emoji}</div>`}
        </div>
        <div style="flex:1">
          <div style="font-size:11px;color:${ad.color};font-weight:800;letter-spacing:.1em;margin-bottom:4px">📢 PR広告</div>
  
          <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px">ハリウッドザコシショウ公式 — クリックで詳細へ</div>
        </div>
        <div style="font-size:36px;opacity:.15;position:absolute;right:16px">🎭</div>
        <div style="position:absolute;top:6px;right:10px;font-size:9px;color:rgba(255,255,255,.35);background:rgba(0,0,0,.4);border-radius:4px;padding:1px 5px">広告</div>
      </div>`;
      // カードの後ろに挿入
      const refCard = grid.children[pos + idx];
      if (refCard) grid.insertBefore(adEl, refCard);
      else grid.appendChild(adEl);
    }
  });
}

/* ── ポップアップ広告 ── */
/* ══════════════════════════════════════
   広告ポップアップ（タブ移動ごとに表示）
   マスターでオン/オフ可能
══════════════════════════════════════ */
const AD_POPUP_SETTING_KEY = 'vr_ad_popup_enabled';
function isAdPopupEnabled() {
  try { const v = localStorage.getItem(AD_POPUP_SETTING_KEY); return v === 'true'; } // デフォルトOFF
  catch(e) { return false; }
}
function setAdPopupEnabled(flag) {
  localStorage.setItem(AD_POPUP_SETTING_KEY, String(flag));
}

function showAdPopup() {
  if (!isAdPopupEnabled()) return;
  const existing = document.getElementById('ad-popup-overlay');
  if (existing) existing.remove();
  const ad = getRandomAd();
  const overlay = document.createElement('div');
  overlay.id = 'ad-popup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  const close = () => overlay.remove();
  if (ad.img) {
    const tempImg = new Image();
    tempImg.onload = () => _buildAdPopup(overlay, ad, tempImg.naturalWidth, tempImg.naturalHeight, close);
    tempImg.onerror  = () => _buildAdPopup(overlay, ad, 0, 0, close);
    tempImg.src = ad.img;
  } else {
    _buildAdPopup(overlay, ad, 0, 0, close);
  }
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function _buildAdPopup(overlay, ad, nw, nh, close) {
  const adClickJSON = JSON.stringify(ad).replace(/"/g,"'");
  // 720×720 を上限に、写真の縦横比を保って収める
  const MAX = Math.min(720, window.innerWidth - 32, window.innerHeight - 32);
  const ratio = (nw && nh) ? nw / nh : 1;
  let w, h;
  if (ratio >= 1) { w = MAX; h = Math.round(MAX / ratio); }
  else            { h = MAX; w = Math.round(MAX * ratio); }
  const fitStyle = 'object-fit:contain;background:#0a0a0a';
  let inner = '';
  inner += '<div style="position:relative;width:'+w+'px;background:#0a0a0a;'
         + 'border:3px solid '+ad.color+';border-radius:18px;overflow:hidden;'
         + 'box-shadow:0 0 60px '+ad.color+'99,0 0 120px '+ad.color+'44;'
         + 'animation:adPopIn .35s cubic-bezier(.175,.885,.32,1.275)">';
  // 閉じるボタン
  inner += '<button onclick="document.getElementById(\'ad-popup-overlay\').remove()"'
         + ' style="position:absolute;top:10px;right:10px;z-index:10;'
         + 'background:rgba(0,0,0,.7);border:2px solid rgba(255,255,255,.4);'
         + 'border-radius:50%;width:36px;height:36px;cursor:pointer;color:#fff;'
         + 'font-size:20px;font-weight:900;display:flex;align-items:center;justify-content:center">✕</button>';
  // 広告バッジ
  inner += '<div style="position:absolute;top:10px;left:10px;z-index:10;'
         + 'background:rgba(0,0,0,.65);border:1px solid rgba(255,255,255,.25);'
         + 'border-radius:6px;padding:3px 8px;font-size:9px;font-weight:800;'
         + 'color:rgba(255,255,255,.7)">📢 PR広告</div>';
  // 画像エリア
  inner += '<div onclick="openAdPage('+adClickJSON+')"'
         + ' style="cursor:pointer;width:'+w+'px;height:'+h+'px;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative">';
  if (ad.img) {
    inner += '<img src="'+ad.img+'" style="width:100%;height:100%;'+fitStyle+';display:block">';
  } else if (ad.svg) {
    inner += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">'+ad.svg+'</div>';
  } else {
    inner += '<div style="font-size:100px;text-align:center;padding:40px">'+ad.emoji+'</div>';
  }
  // タップ誘導（下部中央）
  inner += '<div style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);'
         + 'background:'+ad.color+';color:#fff;border-radius:20px;padding:6px 20px;'
         + 'font-size:12px;font-weight:900;white-space:nowrap;'
         + 'box-shadow:0 3px 12px '+ad.color+'88">タップで詳細へ →</div>';
  inner += '</div>';
  // 下部バー
  inner += '<div style="background:'+ad.color+';padding:6px 14px;display:flex;align-items:center;justify-content:space-between">'
         + '<span style="font-size:11px;font-weight:800;color:#fff;opacity:.9">ハリウッドザコシショウ 公式</span>'
         + '<span style="font-size:10px;color:rgba(255,255,255,.7)">クリックで詳細へ</span></div>';
  inner += '</div>';
  overlay.innerHTML = inner;
}

function renderAdManagement() {
  const el = document.getElementById('master-ads'); if (!el) return;
  const enabled = isAdPopupEnabled();
  let html = '';
  html += '<h2 style="font-size:18px;font-weight:800;margin-bottom:6px;'
        + 'background:linear-gradient(135deg,#e0c97a,#b45309);'
        + '-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">'
        + '広告管理</h2>';
  html += '<p style="font-size:13px;color:#94a3b8;margin-bottom:22px;line-height:1.7">'
        + '広告ポップアップのオン/オフ・各広告の遷移先URLを管理します。変更は即時反映されます。</p>';

  // ON/OFFトグル
  const borderC = enabled ? '#e0c97a' : '#475569';
  const bgC     = enabled ? 'rgba(224,201,122,.06)' : 'rgba(71,85,105,.06)';
  const titleC  = enabled ? '#e0c97a' : '#94a3b8';
  const bdBotC  = enabled ? 'rgba(224,201,122,.2)' : 'rgba(71,85,105,.2)';
  const badgeBg = enabled ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#475569,#334155)';
  const badgeTxt= enabled ? '✅ オン' : '⛔ オフ';
  const onStyle = enabled  ? 'background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border-color:transparent' : '';
  const offStyle= !enabled ? 'background:linear-gradient(135deg,#475569,#334155);color:#fff;border-color:transparent' : '';

  html += '<div class="master-section" style="border:2px solid '+borderC+';background:'+bgC+'">';
  html += '<div class="master-section-title" style="color:'+titleC+';border-bottom-color:'+bdBotC+'">';
  html += '<i class="ti ti-speakerphone"></i> タブ移動時 広告ポップアップ';
  html += '<span style="margin-left:auto;font-size:11px;font-weight:700;background:'+badgeBg+';color:#fff;padding:3px 12px;border-radius:20px">'+badgeTxt+'</span>';
  html += '</div>';
  html += '<p style="font-size:12px;color:#94a3b8;margin-bottom:16px;line-height:1.7">オンにすると、タブを切り替えるたびにランダムな広告が表示されます。</p>';
  html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">';
  html += '<button onclick="setAdPopupEnabled(true);renderAdManagement();showToast(\'広告ポップアップをオンにしました\',\'success\')" class="btn btn-sm" style="font-size:12px;padding:8px 20px;'+onStyle+'"><i class="ti ti-check"></i> オンにする</button>';
  html += '<button onclick="setAdPopupEnabled(false);renderAdManagement();showToast(\'広告ポップアップをオフにしました\',\'info\')" class="btn btn-sm" style="font-size:12px;padding:8px 20px;'+offStyle+'"><i class="ti ti-ban"></i> オフにする</button>';
  html += '<button onclick="showAdPopup();showToast(\'広告をプレビューしました\',\'info\')" class="btn btn-gold btn-sm" style="font-size:12px;padding:8px 20px;margin-left:auto"><i class="ti ti-eye"></i> 今すぐプレビュー</button>';
  html += '</div></div>';

  // 各広告カード
  adDefs.forEach(function(ad, i) {
    const adJson = JSON.stringify(ad).replace(/"/g,'&quot;');
    const mediaHTML = ad.img
      ? '<img src="'+ad.img+'" style="display:block;max-width:160px;max-height:200px;width:auto;height:auto;object-fit:contain">'
      : (ad.svg || '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;font-size:48px">'+ad.emoji+'</div>');
    html += '<div class="master-section" style="border:2px solid '+ad.color+'55">';
    html += '<div class="master-section-title" style="color:'+ad.color+'"><span style="font-size:18px">'+ad.emoji+'</span> '+ad.variant+'</div>';
    html += '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">';
    // プレビュー
    html += '<div onclick="openAdPage('+adJson+')"'
          + ' style="cursor:pointer;border:2px solid '+ad.color+';border-radius:12px;overflow:hidden;'
          + 'background:#0a0a0a;flex-shrink:0;box-shadow:0 0 16px '+ad.color+'55;transition:transform .18s"'
          + ' onmouseover="this.style.transform=\'scale(1.04)\'" onmouseout="this.style.transform=\'scale(1)\'">'
          + mediaHTML + '</div>';
    // フォーム
    html += '<div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:12px">';
    html += '<div><div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">遷移先URL</div>'
          + '<input class="finput" id="ad-url-'+i+'" value="'+(ad.url||'')+'" placeholder="https://..." style="font-size:11px" onkeydown="if(event.key===\'Enter\')saveAdItem('+i+')"></div>';
    html += '<div><div style="font-size:11px;font-weight:700;color:#94a3b8;margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">アクセントカラー</div>'
          + '<div style="display:flex;align-items:center;gap:10px">'
          + '<input type="color" id="ad-color-'+i+'" value="'+ad.color+'" style="width:44px;height:36px;border:none;border-radius:8px;cursor:pointer;padding:0">'
          + '<span style="font-size:12px;color:#64748b">'+ad.color+'</span></div></div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    html += '<button class="btn btn-sm" onclick="saveAdItem('+i+')" style="background:'+ad.color+';color:#fff;border-color:transparent;font-size:11px"><i class="ti ti-device-floppy"></i> 保存</button>';
    html += '<button class="btn btn-sm" onclick="previewAd('+i+')" style="font-size:11px"><i class="ti ti-eye"></i> プレビュー</button>';
    html += '<button class="btn btn-sm" onclick="resetAdItem('+i+')" style="font-size:11px;color:var(--red)"><i class="ti ti-refresh"></i> リセット</button>';
    html += '</div></div></div></div>';
  });

  // テストパネル
  html += '<div class="master-section" style="border:2px solid rgba(224,201,122,.3);background:rgba(224,201,122,.04)">';
  html += '<div class="master-section-title" style="color:#e0c97a"><i class="ti ti-test-pipe"></i> 広告テスト</div>';
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap">';
  html += '<button class="btn btn-gold btn-sm" onclick="showAdPopup()"><i class="ti ti-speakerphone"></i> ポップアップ表示</button>';
  html += '<button class="btn btn-gold btn-sm" onclick="injectSideAds()"><i class="ti ti-layout-sidebar"></i> サイド広告更新</button>';
  html += '<button class="btn btn-gold btn-sm" onclick="injectInlineAds()"><i class="ti ti-cards"></i> インライン広告更新</button>';
  html += '</div></div>';

  el.innerHTML = html;
}

function saveAdItem(i) {
  const label = document.getElementById(`ad-label-${i}`)?.value?.trim();
  const url   = document.getElementById(`ad-url-${i}`)?.value?.trim();
  const color = document.getElementById(`ad-color-${i}`)?.value;
  if (label) adDefs[i].label = label;
  if (url)   adDefs[i].url   = url;
  if (color) adDefs[i].color = color;
  saveAds(adDefs);
  injectSideAds(); injectInlineAds();
  renderAdManagement();
  showToast('広告を保存しました', 'success');
}

function previewAd(i) {
  const ad = adDefs[i];
  _adPopupShown = false;
  const orig = adDefs;
  adDefs = [ad];
  showAdPopup();
  adDefs = orig;
}

function resetAdItem(i) {
  if (!confirm('この広告をデフォルトに戻しますか？')) return;
  adDefs[i] = {...DEFAULT_ADS[i]};
  saveAds(adDefs);
  injectSideAds(); injectInlineAds();
  renderAdManagement();
  showToast('リセットしました', 'info');
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  refreshAllFilters();
  // 広告CSS
  const adStyle = document.createElement('style');
  adStyle.textContent = `
    @keyframes adPopIn{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
    .ad-banner{transition:transform .18s,box-shadow .18s}
    .ad-banner:hover{transform:translateY(-2px) scale(1.02)}
    .inline-ad-row{transition:opacity .3s}
    #top-bottom-ads .ad-banner img{width:100%;height:auto;display:block}
    @media(max-width:600px){
      #top-bottom-ads>div:last-child{grid-template-columns:1fr 1fr!important}
    }
  `;
  document.head.appendChild(adStyle);
  // 広告はデフォルト完全非表示（zakoshiコードで解放後のみ表示）
  // injectSideAds();
  // setTimeout(showAdPopup, 3000);
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
