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
  // An existing seven-card profile migrates without resetting the user's ordering.
  const oldOrder = ['commands','note','mirror','recorder','windows','pomodoro','music'];
  await win.webContents.executeJavaScript(`localStorage.setItem('notch-home-order-v3',${JSON.stringify(JSON.stringify(oldOrder))}); localStorage.setItem('notch-home-widget-sizes-v2',JSON.stringify({music:'medium',pomodoro:'mini',windows:'large',recorder:'small',mirror:'medium',note:'medium',commands:'mini'}));`);
  await win.reload();
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const migrated = await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-home-module]')].sort((a,b)=>Number(a.style.order)-Number(b.style.order)).map(t=>t.dataset.homeModule)`);
  assert.deepEqual(migrated,[...oldOrder,'usage']);
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
    const checks=[];
    for(let i=0;i<4;i++){
      const button=tile.querySelector('[data-widget-size-cycle]');button.click();await settle();
      const rect=tile.getBoundingClientRect();
      const outside=[...tile.querySelectorAll('button,progress')].filter(x=>{const r=x.getBoundingClientRect();return r.width&&r.height&&(r.left<rect.left-1||r.right>rect.right+1||r.top<rect.top-1||r.bottom>rect.bottom+1)}).map(x=>x.id||x.className);
      checks.push({size:tile.dataset.widgetSize,outside,visible:!tile.hidden});
    }
    window.NotchHome.setModuleVisible('mirror',false);await settle();
    const sizeButton=tile.querySelector('[data-widget-size-cycle]');
    const hiddenResizeBefore={available:!sizeButton.hidden&&!sizeButton.disabled,size:sizeButton.dataset.currentSize};
    sizeButton.click();await settle();
    const hiddenResizeAfter={size:sizeButton.dataset.currentSize,stored:JSON.parse(localStorage.getItem('notch-home-widget-sizes-v2')).usage,valid:[...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')].reduce((sum,item)=>sum+Number(item.dataset.layoutWidth)*Number(item.dataset.layoutHeight),0)===48};
    window.NotchHome.setModuleVisible('mirror',true);await settle();
    const restoredAfterResize=!tile.hidden&&![...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')].some(item=>!item.dataset.layoutWidth);
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
    return {noReadBeforeConsent,noUsageTab,connected,external,internalNews,checks,hiddenResizeBefore,hiddenResizeAfter,restoredAfterResize,configOpens,hidden,hiddenCalls,restoredCalls,collapsedCalls,reopenedCalls,manualCalls,failed,expired,escaped};
  })()`);
  assert.equal(result.noReadBeforeConsent,true);
  assert.equal(result.noUsageTab,true);
  assert.deepEqual(result.connected,{calls:1,percent:'68%',meter:68,credits:'重置卡 1 张',sync:'5'});
  assert.equal(result.external,'');
  assert.equal(result.internalNews,true);
  assert.deepEqual(result.checks.map(x=>x.size),['large','mini','small','medium']);
  for(const check of result.checks){assert.equal(check.visible,true);assert.deepEqual(check.outside,[],JSON.stringify(check));}
  assert.equal(result.hiddenResizeBefore.available,true);
  assert.notEqual(result.hiddenResizeAfter.size,result.hiddenResizeBefore.size);
  assert.equal(result.hiddenResizeAfter.stored,result.hiddenResizeAfter.size);
  assert.equal(result.hiddenResizeAfter.valid,true);
  assert.equal(result.restoredAfterResize,true);
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
    await win.webContents.executeJavaScript("setActiveTab('home')");
    for(let i=0;i<4;i++){
      const capture=await win.webContents.executeJavaScript(`(async()=>{
        const tile=document.getElementById('home-usage');
        tile.querySelector('[data-widget-size-cycle]').click();
        await new Promise(r=>setTimeout(r,60));
        const r=tile.getBoundingClientRect();
        return {size:tile.dataset.widgetSize,rect:{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}};
      })()`);
      fs.writeFileSync(process.env.SOLODOCK_USAGE_SCREENSHOT.replace('.png','-'+capture.size+'.png'),(await win.webContents.capturePage(capture.rect)).toPNG());
    }
  }
  await win.webContents.executeJavaScript("setActiveTab('home')");
  const drag=await win.webContents.executeJavaScript(`(()=>{
    const point=id=>{const r=document.querySelector('[data-home-module="'+id+'"]').getBoundingClientRect();return {x:Math.round(r.x+24),y:Math.round(r.y+24)}};
    return {from:point('usage'),to:point('commands'),order:JSON.parse(localStorage.getItem('notch-home-order-v3')),sizes:localStorage.getItem('notch-home-widget-sizes-v2')};
  })()`);
  win.webContents.sendInputEvent({type:'mouseDown',...drag.from,button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,460));
  win.webContents.sendInputEvent({type:'mouseMove',...drag.to,button:'left'});
  await new Promise(r=>setTimeout(r,60));
  win.webContents.sendInputEvent({type:'mouseUp',...drag.to,button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,60));
  const reordered=await win.webContents.executeJavaScript(`({order:JSON.parse(localStorage.getItem('notch-home-order-v3')),sizes:localStorage.getItem('notch-home-widget-sizes-v2')})`);
  const expected=[...drag.order], source=expected.indexOf('usage'), target=expected.indexOf('commands');
  [expected[source],expected[target]]=[expected[target],expected[source]];
  assert.deepEqual(reordered.order,expected,'Usage participates in the shared long-press reorder');
  assert.equal(reordered.sizes,drag.sizes,'Dragging keeps widget sizes');
  const savedHiddenSize=await win.webContents.executeJavaScript(`(()=>{
    window.NotchHome.setModuleVisible('mirror',false);
    const button=document.querySelector('#home-usage [data-widget-size-cycle]');
    button.click();
    return {size:button.dataset.currentSize,hidden:window.NotchHome.getVisibility().hiddenIds.includes('mirror')};
  })()`);
  assert.equal(savedHiddenSize.hidden,true);
  await win.reload();
  await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  const reloadedHiddenSize=await win.webContents.executeJavaScript(`(()=>{
    const button=document.querySelector('#home-usage [data-widget-size-cycle]');
    return {size:button.dataset.currentSize,available:!button.hidden&&!button.disabled,hidden:window.NotchHome.getVisibility().hiddenIds.includes('mirror')};
  })()`);
  assert.deepEqual(reloadedHiddenSize,{size:savedHiddenSize.size,available:true,hidden:true},'Hidden-card sizing survives restart');
  console.log('Codex widget: migration, four sizes, drag reorder, visibility, configuration, lifecycle and quota states passed');
  clearTimeout(deadline);app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
