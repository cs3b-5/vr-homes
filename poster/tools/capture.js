// ポスター用の画面を高解像度で撮る: node capture.js vr|ed|phone|yk|feat
// 先に python demo_plan.py と python draw_madori.py を実行しておく（ed は demo/_madori_small.png も使う: assets/madori.png を1/3に縮小して置く）
const { chromium } = require('playwright');   // npm i playwright && npx playwright install chromium
const http = require('http'), fs = require('fs'), path = require('path');
const SITE = path.resolve(__dirname, '..', '..'), O = path.join(__dirname, '..', 'assets') + path.sep;
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(SITE, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); }).listen(8302);
const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const mk = async (opts) => { const ctx = await b.newContext(opts);
    const pg = await ctx.newPage(); pg.setDefaultTimeout(300000); return { ctx, pg }; };
  const which = process.argv[2];
  if (which === 'vr') {
    const { ctx, pg } = await mk({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 3 });
    await pg.goto('http://localhost:8302/vr-viewer.html?plan=/demo/_p2ldk.json');
    await pg.waitForFunction(() => document.getElementById('loading').classList.contains('hide'), null, { timeout: 300000 });
    await pg.waitForTimeout(2000);
    await pg.evaluate(() => { engine.setHardwareScalingLevel(1 / 3); engine.resize(); });
    await pg.addStyleTag({ content: '#hint,#topbar,#tools,#minimap,#roomName{display:none!important}' });
    const shot = async (n, x, z, yaw, pitch) => { await pg.evaluate(([x, z, y, p]) => { camera.position.x = x; camera.position.z = z; window.yaw = y; }, [x, z, yaw, pitch]);
      await pg.evaluate(([y, p]) => { yaw = y * Math.PI / 180; pitch = p; }, [yaw, pitch || -0.04]); await pg.waitForTimeout(1500); await pg.evaluate(raf); await pg.screenshot({ path: O + n + '.png' }); console.log(n); };
    await shot('vr_ldk', 205 / 50, -205 / 50, 50);
    await shot('vr_entry', 225 / 50, -350 / 50, 0);
    await ctx.close();
  }
  if (which === 'ed') {
    const { ctx, pg } = await mk({ viewport: { width: 1600, height: 1000 } });
    await pg.goto('http://localhost:8302/floor-editor.html'); await pg.waitForTimeout(1500);
    await pg.setInputFiles('#fileBg', path.join(SITE, 'demo', '_madori_small.png')); await pg.waitForTimeout(1500);
    await pg.evaluate(() => { const m = document.getElementById('autoModal'); if (m) m.classList.remove('show'); });
    const r = await pg.evaluate(async () => (window.autoBuildFromImageFull ? autoBuildFromImageFull(70, true, false) : autoBuildFromImage(70, true)));
    console.log(JSON.stringify(r));
    fs.writeFileSync(path.join(SITE, 'demo', '_gen.json'), JSON.stringify(await pg.evaluate(() => exportData())));
    await ctx.close();
    const v = await mk({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 3 });
    await v.pg.goto('http://localhost:8302/vr-viewer.html?plan=/demo/_gen.json');
    await v.pg.waitForFunction(() => document.getElementById('loading').classList.contains('hide'), null, { timeout: 300000 });
    await v.pg.waitForTimeout(1500);
    await v.pg.click('[data-tool="doll"]'); await v.pg.waitForTimeout(2500);
    await v.pg.evaluate(() => { engine.setHardwareScalingLevel(1 / 3); engine.resize(); dollCam.alpha = -Math.PI / 2 - 0.4; dollCam.beta = 0.75; });
    await v.pg.addStyleTag({ content: '#hint,#topbar,#tools,#minimap,#roomName,#dollBar,#labels{display:none!important}' });
    await v.pg.waitForTimeout(1500); await v.pg.evaluate(raf);
    await v.pg.screenshot({ path: O + 'ed_doll.png' }); console.log('ed_doll');
    await v.ctx.close();
  }
  if (which === 'phone') {
    const { ctx, pg } = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true });
    await pg.goto('http://localhost:8302/index.html'); await pg.waitForTimeout(8000);
    await pg.screenshot({ path: O + 'phone.png' }); console.log('phone');
    await ctx.close();
  }
  if (which === 'yk') {
    const { ctx, pg } = await mk({ viewport: { width: 2000, height: 2000 } });
    await pg.goto('http://localhost:8302/help.html'); await pg.setContent('<html><body style="margin:0;background:transparent"><div id="h"></div></body></html>');
    await pg.addScriptTag({ path: path.join(SITE, 'mascot.js') });
    await pg.evaluate(() => { document.getElementById('h').innerHTML = window.Yadokarin.svg({ size: 1900, face: 'happy', wave: true, title: '' }); });
    await (await pg.$('#h svg')).screenshot({ path: O + 'yk.png', omitBackground: true }); console.log('yk');
    await ctx.close();
  }

  if (which === 'feat') {
    const { ctx, pg } = await mk({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2.5 });
    const open = async () => { await pg.goto('http://localhost:8302/vr-viewer.html?plan=/demo/_p2ldk.json');
      await pg.waitForFunction(() => document.getElementById('loading').classList.contains('hide'), null, { timeout: 300000 });
      await pg.waitForTimeout(1500); await pg.evaluate(() => { engine.setHardwareScalingLevel(1 / 2.5); engine.resize(); });
      await pg.addStyleTag({ content: '#hint,#topbar,#minimap,#roomName{display:none!important}' }); };
    const place = (x, z, y, p) => pg.evaluate(([x, z, y, p]) => { camera.position.x = x / 50; camera.position.z = -z / 50; yaw = y * Math.PI / 180; pitch = p; }, [x, z, y, p]);
    // 全体
    await open(); await pg.click('[data-tool="doll"]'); await pg.waitForTimeout(2500);
    await pg.addStyleTag({ content: '#dollBar,#tools{display:none!important}' });
    await pg.evaluate(() => { dollCam.alpha = -Math.PI / 2 - 0.5; dollCam.beta = 0.8; }); await pg.waitForTimeout(1500); await pg.evaluate(raf);
    await pg.screenshot({ path: O + 'f_doll.png' }); console.log('doll');
    // 測る
    await open(); await place(300, 150, 0, 0.12); await pg.waitForTimeout(800);
    await pg.click('[data-tool="measure"]'); await pg.waitForTimeout(500);
    await pg.mouse.click(250, 470); await pg.waitForTimeout(500); await pg.mouse.click(1000, 470); await pg.waitForTimeout(1200);
    await pg.addStyleTag({ content: '#tools{display:none!important}' }); await pg.evaluate(raf);
    console.log('measure', await pg.evaluate(() => document.getElementById('measureMsg').textContent));
    await pg.screenshot({ path: O + 'f_measure.png' });
    // 家具
    await open(); await place(330, 160, -10, 0.25); await pg.waitForTimeout(800);
    await pg.click('[data-tool="furn"]'); await pg.waitForTimeout(800);
    const chips = await pg.evaluate(() => [...document.querySelectorAll('#fCatalog button, #fCatalog span')].map(b => b.textContent.trim()));
    console.log('chips', chips.join('|'));
    await pg.evaluate(() => { const b = [...document.querySelectorAll('#fCatalog button')].find(b => /ソファ/.test(b.textContent)); b && b.click(); });
    await pg.waitForTimeout(1500); await pg.addStyleTag({ content: '#tools{display:none!important}' }); await pg.evaluate(raf);
    await pg.screenshot({ path: O + 'f_furn.png' }); console.log('furn');
    // 日当たり
    await open(); await place(330, 60, 200, 0.55); await pg.waitForTimeout(800);
    await pg.click('[data-tool="sun"]'); await pg.waitForTimeout(800);
    await pg.evaluate(() => { const m = document.getElementById('sunMonth'), h = document.getElementById('sunHour'); m.value = 12; m.dispatchEvent(new Event('input', { bubbles: true })); h.value = 13; h.dispatchEvent(new Event('input', { bubbles: true })); });
    await pg.waitForTimeout(2000); await pg.addStyleTag({ content: '#tools{display:none!important}' }); await pg.evaluate(raf);
    await pg.screenshot({ path: O + 'f_sun.png' }); console.log('sun');
    await ctx.close();
  }
  await b.close(); srv.close();
})();
