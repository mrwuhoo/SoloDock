const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Reset news renderer timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer/index.html'));
  const result = await win.webContents.executeJavaScript(`(async () => {
    let reads = 0;
    let external = '';
    window.notchAPI = {
      getResetNews: async () => ({ok:true,today:'2026-09-24',checkedAt:'2026-09-24T10:00:00+08:00',events:[
        {id:'a',day:'2026-09-23',kind:'credit',status:'confirmed',title:'重置卡已发放',scope:'Plus',schedule:'',posts:[{text:'公开消息',url:'https://x.com/thsottiaux/status/1'}]},
        {id:'b',day:'2026-09-25',kind:'reset',status:'announced',title:'Tibo 预告重置',scope:'',schedule:'预计 9 月 25 日',posts:[]}
      ]}),
      openExternal: async (url) => { external = url; }
    };
    await setMode(true);
    await setActiveTab('home');
    const usageInHome = !!document.querySelector('#settings-home-module-list [data-settings-home-module="usage"]');
    const usageInFeatures = !!document.querySelector('#settings-feature-list [data-settings-home-module="usage"]');
    document.getElementById('usage-news').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const active = document.getElementById('tab-resets').classList.contains('active');
    const day = document.querySelector('.reset-news-day[data-day="2026-09-25"]');
    const forecast = day?.textContent.includes('预告');
    document.querySelector('.reset-news-day[data-day="2026-09-23"]').click();
    const detail = document.getElementById('reset-news-events').textContent;
    document.querySelector('.reset-news-link').click();
    const sourceLink = external;
    await setActiveTab('settings');
    await new Promise((resolve) => setTimeout(resolve, 40));
    const page = document.getElementById('settings-page');
    const left = page.querySelector('.settings-column-primary');
    const right = page.querySelector('.settings-column-secondary');
    const scroll = {pageOverflow:getComputedStyle(page).overflowY,leftOverflow:getComputedStyle(left).overflowY,rightOverflow:getComputedStyle(right).overflowY,pageCanScroll:page.scrollHeight>page.clientHeight};
    return {usageInHome,usageInFeatures,active,forecast,detail,sourceLink,scroll};
  })()`);
  assert.equal(result.usageInHome, true);
  assert.equal(result.usageInFeatures, false);
  assert.equal(result.active, true);
  assert.equal(result.forecast, true);
  assert.match(result.detail, /重置卡已发放/);
  assert.equal(result.sourceLink, 'https://x.com/thsottiaux/status/1');
  assert.deepEqual(result.scroll, {pageOverflow:'auto',leftOverflow:'visible',rightOverflow:'visible',pageCanScroll:true});
  assert.deepEqual(errors, []);
  if (process.env.SOLODOCK_RESET_SCREENSHOT) {
    await win.webContents.executeJavaScript("setActiveTab('resets')");
    await new Promise((resolve) => setTimeout(resolve, 250));
    fs.writeFileSync(process.env.SOLODOCK_RESET_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("setActiveTab('settings')");
    await new Promise((resolve) => setTimeout(resolve, 250));
    fs.writeFileSync(process.env.SOLODOCK_RESET_SCREENSHOT.replace('.png', '-settings.png'), (await win.webContents.capturePage()).toPNG());
  }
  clearTimeout(deadline);
  await win.close();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
