/* ══════════════════════════════════════════════
   VR Homes のキャラクター「やどかりん」
   ヤドカリ＝宿借り。おうちを背負って、新しいおうちを探している。
   Yadokarin.svg({ size, face, wave })
     face: 'happy'（ふつう）| 'wow'（おどろき）| 'sad'（しょんぼり）| 'vr'（VRゴーグル）| 'wink'
══════════════════════════════════════════════ */
(function () {
  'use strict';
  const C = { ink: '#2D2A32', body: '#FF8066', bodyDark: '#E8604A', belly: '#FFB59E', wall: '#FFF4E0', roof: '#1FA597', roofDark: '#178277',
    chimney: '#E8604A', glass: '#8FD6FF', blush: '#FF5E7A', visor: '#3D5AFE', visorHi: '#9FB0FF', door: '#C98B5B' };
  function eyes(face) {
    const L = { x: 54, y: 78 }, R = { x: 88, y: 74 };
    const stalks = `<path d="M60 116 Q56 98 ${L.x} ${L.y + 10}" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
      <path d="M80 114 Q86 96 ${R.x} ${R.y + 10}" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>`;
    if (face === 'vr') {
      return stalks + `<g transform="rotate(-6 71 76)"><rect x="38" y="62" width="66" height="30" rx="14" fill="${C.visor}" stroke="${C.ink}" stroke-width="4"/>
        <rect x="46" y="68" width="22" height="8" rx="4" fill="${C.visorHi}" opacity=".9"/><circle cx="92" cy="72" r="3" fill="#fff"/>
        <path d="M38 77 H30 M104 77 H112" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/></g>`;
    }
    const ball = (p, pupil) => `<circle cx="${p.x}" cy="${p.y}" r="13" fill="#fff" stroke="${C.ink}" stroke-width="4"/>` + pupil;
    if (face === 'wink') {
      return stalks + ball(L, `<circle cx="${L.x + 2}" cy="${L.y + 1}" r="6.5" fill="${C.ink}"/><circle cx="${L.x + 4.5}" cy="${L.y - 2}" r="2.2" fill="#fff"/>`)
        + `<path d="M${R.x - 10} ${R.y + 2} Q${R.x} ${R.y - 8} ${R.x + 10} ${R.y + 2}" fill="none" stroke="${C.ink}" stroke-width="4.5" stroke-linecap="round"/>`;
    }
    const dy = face === 'sad' ? 4 : 0, r = face === 'wow' ? 5 : 6.5;
    const pup = p => `<circle cx="${p.x + 2}" cy="${p.y + 1 + dy}" r="${r}" fill="${C.ink}"/><circle cx="${p.x + 4.5}" cy="${p.y - 2 + dy}" r="2.2" fill="#fff"/>`;
    let brows = '';
    if (face === 'sad') brows = `<path d="M${L.x - 11} ${L.y - 19} L${L.x + 6} ${L.y - 15}" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/><path d="M${R.x + 11} ${R.y - 19} L${R.x - 6} ${R.y - 15}" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>`;
    return stalks + ball(L, pup(L)) + ball(R, pup(R)) + brows;
  }
  function mouth(face) {
    if (face === 'wow') return `<ellipse cx="72" cy="140" rx="6" ry="7.5" fill="${C.ink}"/>`;
    if (face === 'sad') return `<path d="M63 145 Q72 137 81 145" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>`;
    return `<path d="M62 137 Q72 149 82 137" fill="${C.ink}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/><path d="M67 142 Q72 146 77 142" fill="${C.blush}"/>`;
  }
  function svg(opts) {
    opts = opts || {};
    const size = opts.size || 120, face = opts.face || 'happy', wave = opts.wave !== false;
    const title = opts.title === undefined ? 'やどかりん' : opts.title;
    return `<svg class="yadokarin${wave ? ' yk-wave' : ''}" width="${size}" height="${size}" viewBox="0 0 200 200" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="100" cy="188" rx="66" ry="7" fill="#000" opacity=".12"/>
  <g class="yk-legs" stroke="${C.ink}" stroke-width="5" stroke-linecap="round" fill="none">
    <path d="M58 160 Q50 176 42 182"/><path d="M74 166 Q72 178 66 186"/><path d="M92 164 Q96 178 100 184"/>
  </g>
  <g class="yk-house" transform="rotate(-9 128 104)">
    <rect x="86" y="74" width="92" height="92" rx="12" fill="${C.wall}" stroke="${C.ink}" stroke-width="4.5"/>
    <rect x="148" y="34" width="15" height="28" rx="3" fill="${C.chimney}" stroke="${C.ink}" stroke-width="4"/>
    <path d="M76 84 L132 34 L188 84 Z" fill="${C.roof}" stroke="${C.ink}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M92 80 L132 45 L172 80" fill="none" stroke="${C.roofDark}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
    <circle cx="146" cy="108" r="15" fill="${C.glass}" stroke="${C.ink}" stroke-width="4"/>
    <path d="M146 94 V122 M132 108 H160" stroke="${C.ink}" stroke-width="3"/>
    <path d="M140 102 q4 -4 9 -3" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/>
    <rect x="152" y="134" width="18" height="30" rx="8" fill="${C.door}" stroke="${C.ink}" stroke-width="4"/>
    <circle cx="157" cy="150" r="2.2" fill="${C.ink}"/>
  </g>
  <g class="yk-body">
    <path d="M30 140 Q30 108 66 106 Q104 104 110 134 Q114 166 72 168 Q32 168 30 140 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="4.5"/>
    <path d="M44 150 Q70 162 98 148" fill="none" stroke="${C.bodyDark}" stroke-width="4" stroke-linecap="round" opacity=".6"/>
    <ellipse cx="48" cy="136" rx="7" ry="4.5" fill="${C.blush}" opacity=".55"/><ellipse cx="96" cy="132" rx="7" ry="4.5" fill="${C.blush}" opacity=".55"/>
    ${mouth(face)}
  </g>
  ${eyes(face)}
  <g class="yk-claw">
    <path d="M34 146 Q20 140 18 124" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
    <path d="M18 126 Q2 118 6 100 Q10 86 24 90 Q20 104 30 108 Q36 96 30 86 Q44 92 40 110 Q36 126 18 126 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="4.5" stroke-linejoin="round"/>
  </g>
</svg>`;
  }
  const css = `
.yadokarin{display:inline-block;overflow:visible}
.yadokarin .yk-claw{transform-origin:34px 146px}
.yadokarin.yk-wave .yk-claw{animation:ykWave 2.4s ease-in-out infinite}
.yadokarin .yk-house,.yadokarin .yk-body{transform-box:view-box}
.yk-bob{animation:ykBob 1.6s ease-in-out infinite}
.yk-hop{animation:ykHop .5s ease}
@keyframes ykWave{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(-14deg)}80%{transform:rotate(8deg)}90%{transform:rotate(-10deg)}}
@keyframes ykBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes ykHop{0%{transform:translateY(0)}40%{transform:translateY(-14px) rotate(-4deg)}100%{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.yadokarin .yk-claw,.yk-bob,.yk-hop{animation:none!important}}`;
  function injectCss() { if (document.getElementById('yk-css')) return; const s = document.createElement('style'); s.id = 'yk-css'; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  injectCss();
  window.Yadokarin = { svg: svg, name: 'やどかりん' };
})();
