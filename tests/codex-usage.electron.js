const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Codex widget renderer timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer/index.html'));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'no-preference'}]});
  const result = await win.webContents.executeJavaScript(`(async () => {
    let calls = 0, failure = false;
    let clock = Date.now();
    const initialClock = clock;
    Date.now = () => clock;
    const data = {ok:true,updatedAt:clock,resetCredits:1,buckets:[{id:'codex',name:'codex',plan:'example-plan',windows:[
      {key:'primary',remainingPercent:68,durationMinutes:10080,resetsAt:clock+2*86400000},
      {key:'secondary',remainingPercent:null,durationMinutes:300,resetsAt:null}
    ]}]};
    let external = '';
    window.notchAPI = {getCodexUsage:async()=>{calls++;return failure?{ok:false,error:'timeout'}:data;},openExternal:async url=>{external=url;}};
    await setMode(true); await setActiveTab('home');
    const tile=document.getElementById('home-usage');
    const get=id=>document.getElementById(id);
    const settle=()=>new Promise(r=>setTimeout(r,40));
    const noReadBeforeConsent=calls===0;
    const noUsageTab=!get('tab-button-usage') && !get('tab-usage');
    get('usage-connect').click();await settle();
    const connected={calls,percent:get('usage-remaining').textContent,meter:get('usage-meter').value,credits:get('usage-credits').textContent,sync:get('usage-sync').value};
    get('usage-news').click();await settle();
    const internalNews=get('tab-resets').classList.contains('active');
    await setActiveTab('home');
    // Every control stays inside the compact card.
    const rect=tile.getBoundingClientRect();
    const outside=[...tile.querySelectorAll('button,progress')].filter(x=>{const r=x.getBoundingClientRect();return r.width&&r.height&&(r.left<rect.left-1||r.right>rect.right+1||r.top<rect.top-1||r.bottom>rect.bottom+1)}).map(x=>x.id||x.className);
    tile.querySelector('.usage-configure').click();await new Promise(r=>setTimeout(r,260));
    const configOpens=get('tab-settings').classList.contains('active') && document.activeElement===get('codex-usage-refresh');
    const toggle=document.querySelector('#settings-home-module-list [data-settings-home-module="usage"]');
    toggle.checked=false;toggle.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    const hidden=tile.hidden && window.NotchHome.isVisible('usage')===false;
    clock+=300001;await setActiveTab('home');await settle();const hiddenCalls=calls;
    toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));await settle();const restoredCalls=calls;
    clock+=300001;await setMode(false);await settle();const collapsedCalls=calls;
    await setMode(true);await settle();const reopenedCalls=calls;
    get('usage-sync').value='0';get('usage-sync').dispatchEvent(new Event('change'));clock+=300001;
    document.dispatchEvent(new CustomEvent('notch:modechange',{detail:{expanded:true}}));await settle();const manualCalls=calls;
    failure=true;get('codex-usage-refresh').click();await settle();
    const failed={percent:get('usage-remaining').textContent,hidden:get('usage-meter').hidden,status:get('codex-usage-status').dataset.state};
    failure=false;clock=initialClock+3*86400000;get('codex-usage-refresh').click();await settle();
    const expired=get('usage-meter').hidden && get('usage-remaining').textContent==='—';
    data.buckets[0].name='<img src=x onerror=alert(1)>';get('codex-usage-refresh').click();await settle();
    const escaped=get('usage-details').querySelectorAll('img').length===0;
    data.buckets[0].name='codex';clock=initialClock;get('codex-usage-refresh').click();await settle();
    await setActiveTab('home');
    return {noReadBeforeConsent,noUsageTab,connected,external,internalNews,outside,configOpens,hidden,hiddenCalls,restoredCalls,collapsedCalls,reopenedCalls,manualCalls,failed,expired,escaped};
  })()`);
  assert.equal(result.noReadBeforeConsent,true);
  assert.equal(result.noUsageTab,true);
  assert.deepEqual(result.connected,{calls:1,percent:'68%',meter:68,credits:'重置卡 1 张',sync:'5'});
  assert.equal(result.external,'');
  assert.equal(result.internalNews,true);
  assert.deepEqual(result.outside,[]);
  assert.equal(result.configOpens,true);assert.equal(result.hidden,true);
  assert.deepEqual([result.hiddenCalls,result.restoredCalls,result.collapsedCalls,result.reopenedCalls,result.manualCalls],[1,2,2,3,3]);
  assert.deepEqual(result.failed,{percent:'—',hidden:true,status:'error'});
  assert.equal(result.expired,true);assert.equal(result.escaped,true);
  assert.deepEqual(errors,[]);
  if(process.env.SOLODOCK_USAGE_SCREENSHOT){
    await win.webContents.executeJavaScript("document.getElementById('status-toast').style.display='none'");
    await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(process.env.SOLODOCK_USAGE_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("setActiveTab('settings')");
    await new Promise(r=>setTimeout(r,250));
    fs.writeFileSync(process.env.SOLODOCK_USAGE_SCREENSHOT.replace('.png','-settings.png'),(await win.webContents.capturePage()).toPNG());
  }
  console.log('Codex widget: compact row, visibility, configuration, lifecycle and quota states passed');
  clearTimeout(deadline);app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
