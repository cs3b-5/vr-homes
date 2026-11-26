// ポスターをA1のPDFにする: node make_pdf.js  (poster/poster.html → poster/VR_Homes_ポスター_A1.pdf)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--allow-file-access-from-files'] });
  const pg = await b.newPage({ viewport: { width: 2245, height: 3179 } });
  await pg.goto('file:///' + require('path').resolve(__dirname, '..', process.argv[2] || 'poster.html').replace(/\\/g, '/')); await pg.waitForTimeout(2000);
  console.log('broken', await pg.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src)));
  console.log(JSON.stringify(await pg.evaluate(() => ({ archBottom: Math.round(document.querySelector('.feat').getBoundingClientRect().bottom), footerTop: Math.round(document.querySelector('.foot2').getBoundingClientRect().top) }))));
  await pg.pdf({ path: require('path').resolve(__dirname, '..', process.argv[3] || 'VR_Homes_ポスター_A1.pdf'), width: '594mm', height: '841mm', printBackground: true, pageRanges: '1', preferCSSPageSize: true, scale: 1 });
  await b.close();
})();
