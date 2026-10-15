'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
function setup({venueStore,writeError=false,savedLastRun=null,ocr=null}={}){
  const filename=path.resolve(__dirname,'../src/chrome-main.js'),load=createRequire(filename),source=fs.readFileSync(filename,'utf8').split('app.whenReady().then')[0];
  const calls=[];
  class Target{
    constructor(bridge,row){this.update(row);}update(row){Object.assign(this,row);}getURL(){return this.url;}getTitle(){return this.title||'fixture';}isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;}isDemo(){return false;}
    async invoke(fn,arg){calls.push({fn,arg,id:this.id});if(context.invoke)return context.invoke(fn,arg);if(fn==='gateState')return null;if(fn?.name==='scene')return {selected:[],buttons:[],grades:[],hasSeats:false};return {};}
  }
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}},shell:{openExternal:async url=>calls.push({external:url})}};
  const context={require:n=>n==='electron'?electron:n==='./ocr-client'&&ocr?{OcrClient:class{async warmup(){return {};}async recognize(data,options){calls.push({ocr:true});return ocr(data,options);}close(){}}}:n==='./chrome-target'?{ChromeTarget:Target}:n==='./browser-bridge'?{BrowserBridge:class{}}:n==='./venue-profiles'&&venueStore?{createVenueStore:()=>venueStore}:n==='node:fs'?{...fs,statSync(file){if(savedLastRun&&file.endsWith('last-run.json'))return {size:JSON.stringify(savedLastRun).length};throw Error('fixture');},readFileSync(file){if(savedLastRun&&file.endsWith('last-run.json'))return JSON.stringify(savedLastRun);throw Error('fixture');},mkdirSync(){},writeFileSync(file,body){if(writeError)throw Error('fixture write failure');calls.push({write:file,body});}}:load(n),__dirname:path.dirname(filename),process:{argv:[],pid:0},URL,Date,console,setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(source+`
  bridge={getState:()=>globalThis.bridgeState||{},request:async q=>{globalThis.calls.push(q);if(q.action==='network.attach'&&globalThis.attachPromise)await globalThis.attachPromise;if(q.action==='network.snapshot')return globalThis.network;return {};}};
  globalThis.api={autoLoop,trackTabs,onDocument,onBrowserEvent,command,selectionAdapter,beginRun,targets,runs,metaStores,scopeVersions,validHome,isEntryPage,seatRefs,ensureNetwork,networkSnapshot,runJs,readEntryPage,acknowledgeNotice,launch,stopRun,finishRun,last:()=>lastRun,warning:()=>diagnosticWarning,revision:()=>revision,
    current,active:()=>active,begin:id=>{active=id;return beginRun(targets.get(id),{},'auto');},setTask:p=>runner.task=p};`,context);
  context.calls=calls;context.network={healthy:true,sequence:0,pending:[],results:[]};
  return {api:context.api,context,calls};
}
const gate=(id,extra={})=>({id,url:'https://tickets.interpark.com/gates/ticket/26005452',title:'gate',documentId:'initial-document',...extra});
test('preflight is read-only and separates bridge connectivity from observer health',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);context.bridgeState={connected:true};
  context.invoke=fn=>fn?.name==='scene'?{selected:[],grades:[{name:'본부석',count:20}],hasSeats:false,buttons:[]}:undefined;
  const result=await api.command('preflight',{preferences:{autoComplete:false}});
  assert.equal(result.canStart,true);assert.equal(result.checks.find(c=>c.id==='observer').level,'ok');
  assert.match(result.checks.find(c=>c.id==='scope').title,/다음 단계 이동 안 함/);
  assert.equal(api.runs.current,null);assert.ok(calls.every(c=>!c.fn||c.fn?.name==='scene'));
  context.network.healthy=false;const failed=await api.command('preflight',{});assert.equal(failed.canStart,false);
});
test('explicit start at an existing seat page never sends a new entry request',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  context.invoke=fn=>fn?.name==='scene'?{completed:true,selected:[],buttons:[]}:undefined;
  await api.command('start',{preferences:{autoCaptcha:false}});const run=api.runs.current;await run.task;
  assert.equal(api.last().entry.strategy,'current-seat');assert.equal(api.last().diagnosis.code,'price-confirmed');
  assert.ok(api.last().metrics.operations.some(row=>row.action==='screen-read'));
  assert.ok(!calls.some(c=>['prepareEntry','armGate','gameCards','gateStatus'].includes(c.fn?.name)));
});
test('existing selected seats stop a resumed run without further selection',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  context.invoke=fn=>fn?.name==='scene'?{completed:false,captcha:false,selected:['existing'],buttons:[],notice:{present:false}}:undefined;
  await api.command('start',{preferences:{autoCaptcha:false}});const run=api.runs.current;await assert.rejects(run.task,/기존에 선택한 좌석/);
  assert.ok(!calls.some(c=>c.fn?.name==='clickKnown'||c.action==='live.liveAction'));
});
test('observer-specific cause is preserved in the final diagnostic',async()=>{
  const {api}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);
  api.onBrowserEvent({type:'entry',tabId:1,event:{kind:'observer-lost',reason:'debugger-detached'}});
  await api.stopRun('secondary stop');assert.equal(run.diagnosis.code,'debugger-detached');
  assert.equal(api.last().diagnosis.code,'debugger-detached');
});
test('loss on an old parent tab cannot overwrite the active popup result',()=>{
  const {api}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;
  api.trackTabs([gate(1),gate(2,{openerTabId:1,url:'https://tickets.interpark.com/onestop/seat'})]);
  api.onBrowserEvent({type:'entry',tabId:1,event:{kind:'observer-lost',reason:'target-closed'}});
  assert.equal(run.signal.aborted,false);assert.equal(run.diagnosis,undefined);
});
test('older extension cannot begin the updated seat flow before any browser action',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);context.bridgeState={extensionVersion:'0.9.3'};
  await assert.rejects(api.command('start',{}),/v0.9.4/);assert.equal(api.runs.current,null);assert.equal(calls.length,0);
});
test('Chrome targets: only a child of the running tab is adopted; unrelated tabs do not switch target',()=>{
  const {api}=setup();api.trackTabs([gate(1),gate(7)]);const run=api.begin(1);run.entryActionsStarted=true;
  api.trackTabs([gate(1),gate(7),gate(8,{openerTabId:7}),gate(2,{openerTabId:1})]);
  assert.equal(run.targetId,2);assert.equal(api.active(),2);assert.deepEqual([...run.windowIds],[1,2]);
});
test('Chrome document navigation invalidates old seat scope even at the same URL',async()=>{
  const {api}=setup();api.trackTabs([gate(1)]);const wc=api.current(),run=api.begin(1),adapter=api.selectionAdapter(wc,run);
  api.onDocument({tabId:1,documentId:'new-document'});
  await assert.rejects(adapter.snapshot(),/경기 또는 회차가 변경/);
});
test('Chrome context change clears metadata and invalidates scope; navigation reset does not double-increment',()=>{
  const {api}=setup();api.trackTabs([gate(1)]);api.metaStores.get(1).set('s',{id:'s'});
  api.onBrowserEvent({type:'metadata-reset',tabId:1,reason:'navigation'});assert.equal(api.scopeVersions.get(1),0);assert.equal(api.metaStores.get(1).size,0);
  api.onBrowserEvent({type:'metadata-reset',tabId:1,reason:'context'});assert.equal(api.scopeVersions.get(1),1);
});
test('Seat selection snapshot reads current background network health, never fabricates healthy observation',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);context.network={healthy:false,sequence:3,pending:[],results:[]};const run=api.begin(1);
  const info=await api.selectionAdapter(api.current(),run).snapshot();assert.equal(info.network.healthy,false);assert.ok(calls.some(q=>q.action==='network.snapshot'));
});
test('Baseball entry URL supports different NOL team pages and prevents unrelated/login/credential URLs',()=>{
  const {api}=setup();assert.equal(api.isEntryPage('https://nol.yanolja.com/ticket/genre/sports/bears'),true);assert.equal(api.isEntryPage('https://nol.yanolja.com/ticket/genre/sports/postseason'),true);
  for(const url of ['http://nol.yanolja.com/ticket','https://evil.test/ticket','https://x:y@nol.yanolja.com/ticket','https://tickets.interpark.com/onestop/seat','javascript:alert(1)'])assert.equal(api.validHome(url),false,url);
  assert.equal(api.validHome('https://tickets.interpark.com/goods/26005452'),true);
});
test('Missing the selected seat tab cancels immediately without closing other Chrome tabs',async()=>{
  const {api}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'}),gate(2)]);const run=api.begin(1);api.trackTabs([gate(2)]);await Promise.resolve();assert.equal(run.signal.aborted,true);assert.ok(api.targets.has(2));
});
test('Stop during delayed observer attach cancels preparation before any gate action is installed',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);let release;context.attachPromise=new Promise(r=>release=r);
  await api.command('start',{});const run=api.runs.current;assert.ok(run);const stopping=api.command('stop');release();await stopping;
  assert.equal(run.signal.aborted,true);assert.equal(api.runs.current,null);assert.ok(!calls.some(c=>c.fn?.name==='gateStatus'||c.fn?.name==='armGate'));
});
test('Same URL booking context reset invalidates every previously scanned manual seat reference',async()=>{
  const {api}=setup();api.trackTabs([gate(1)]);api.seatRefs.set('old',{wcId:1,revision:api.revision(),url:gate(1).url,created:Date.now()});
  api.onBrowserEvent({type:'metadata-reset',tabId:1,reason:'context'});assert.equal(api.seatRefs.size,0);await assert.rejects(api.command('seat',{key:'old',action:'click'}),/좌석 목록이 만료/);
});
test('Losing Chrome debugger observation stops gate watchers and cancels the run',async()=>{
  const {api,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);api.onBrowserEvent({type:'entry',tabId:1,event:{kind:'observer-lost'}});await Promise.resolve();
  assert.equal(run.signal.aborted,true);assert.ok(calls.some(c=>c.fn==='stopWatchers'));
});
test('Ready for the current document retains metadata that arrived earlier and does not invalidate gate scope',()=>{
  const {api}=setup();api.trackTabs([gate(1)]);api.metaStores.get(1).set('new',{id:'new'});api.onDocument({tabId:1,documentId:'initial-document'});
  assert.equal(api.metaStores.get(1).size,1);assert.equal(api.scopeVersions.get(1),0);
});
test('Late metadata from a replaced document is ignored',()=>{
  const {api}=setup();api.trackTabs([gate(1)]);api.trackTabs([gate(1,{documentId:'second-document'})]);
  api.onBrowserEvent({type:'metadata',tabId:1,documentId:'initial-document',rows:[{id:'old'}]});assert.equal(api.metaStores.get(1).size,0);
  api.onBrowserEvent({type:'metadata',tabId:1,documentId:'second-document',rows:[{id:'new'}]});assert.equal(api.metaStores.get(1).size,1);
});

test('Official seating guides open only the exact public CDN image pattern without session parameters',async()=>{
  const {api,calls}=setup(),base='https://ent-ticketimage.interparkcdn.net/display/articles/0123456789abcdef0123456789abcdef.jpg';
  await api.command('openSeatingGuide',{url:base});assert.deepEqual(calls.filter(c=>c.external).map(c=>c.external),[base]);
  for(const url of [base+'?token=secret',base+'#fragment',base.replace('https://','http://'),base.replace('.net/','.net.evil.test/'),base.replace('https://','https://user:pass@'),base.replace('.jpg','.html'),base.replace('/articles/','/private/')])await assert.rejects(api.command('openSeatingGuide',{url}),/공식 좌석 안내/);
  assert.equal(calls.filter(c=>c.external).length,1);
});

test('legacy extension still reads games and explicitly asks for the v0.6 extension without issuing unsupported pageInfo',async()=>{
  const {api,context,calls}=setup();api.trackTabs([{id:1,url:'https://nol.yanolja.com/ticket/genre/sports/postseason'}]);context.bridgeState={extensionUpdateRequired:true,message:'v0.6 확장을 등록해 주세요.'};
  context.invoke=fn=>fn?.name==='gameCards'?[{key:'1',schedule:''}]:undefined;
  const result=await api.command('games');assert.equal(result.games.length,1);assert.equal(result.pageInfo,null);assert.match(result.message,/v0.6/);assert.equal(calls.some(c=>c.fn?.name==='pageInfo'),false);
});
test('only an unsupported pageInfo command falls back; timeout, document and parser failures remain errors',async()=>{
  for(const message of ['허용되지 않은 보조 동작입니다.','Chrome 응답을 기다리는 시간이 지났습니다.','페이지가 바뀌었습니다.','Cannot read properties of undefined']){
    const {api,context}=setup();api.trackTabs([{id:1,url:'https://nol.yanolja.com/ticket/genre/sports/postseason'}]);
    context.invoke=fn=>{if(fn?.name==='gameCards')return [{key:'1',schedule:''}];if(fn?.name==='pageInfo')throw Error(message);};
    if(message==='허용되지 않은 보조 동작입니다.'){const result=await api.command('games');assert.equal(result.games.length,1);assert.equal(result.pageInfo,null);assert.match(result.compatibilityWarning,/v0.9/);}
    else await assert.rejects(api.command('games'),error=>error.message===message);
  }
});
test('Venue IPC forwards current unsaved conditions and returns the selected profile with normalized preferences',async()=>{
  const storeCalls=[],normalized=require('../src/preferences').normalizePreferences;
  let activeId='legacy',prefs=normalized({});
  const venueStore={getState:()=>({activeId,profiles:[]}),getPreferences:()=>prefs,
    select(id,current){storeCalls.push({action:'select',id,current});activeId=id;prefs=normalized({quantity:3,areas:['내야']});return prefs;},
    create(name,current){storeCalls.push({action:'create',name,current});activeId='custom-fixture';prefs=normalized(current);return prefs;},
    saveActive(input){storeCalls.push({action:'save',input});prefs=normalized(input);return prefs;}};
  const {api,calls}=setup({venueStore}),current={quantity:1,areas:['A']};
  const switched=await api.command('venueSelect',{id:'jamsil',preferences:current});
  assert.equal(switched.venueProfiles.activeId,'jamsil');assert.equal(switched.preferences.quantity,3);assert.deepEqual(storeCalls[0],{action:'select',id:'jamsil',current});
  const saved=await api.command('preferences',{quantity:4,areas:['B']});assert.equal(saved.preferences.quantity,4);assert.equal(saved.venueProfiles.activeId,'jamsil');assert.equal(storeCalls[1].action,'save');assert.equal(calls.filter(c=>c.write).length,1);
  const created=await api.command('venueCreate',{name:'새 구장',preferences:current});assert.equal(created.venueProfiles.activeId,'custom-fixture');assert.equal(created.preferences.quantity,1);assert.equal(storeCalls[2].name,'새 구장');
});
test('Venue settings cannot switch or save while a booking run is active',async()=>{
  const {api}=setup();api.trackTabs([gate(1)]);api.begin(1);
  for(const action of ['venueSelect','venueCreate','preferences'])await assert.rejects(api.command(action,{}),/진행 중에는/);
});
test('A named popup is adopted only after its real document changes during this preparation',()=>{
  const {api}=setup(),parent=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/gangwonfc'}),popup=gate(2,{openerTabId:1});
  api.trackTabs([parent,popup]);const run=api.begin(1);run.entryActionsStarted=true;
  api.trackTabs([parent,{...popup,title:'다른 제목',active:true}]);assert.equal(run.targetId,1);
  api.trackTabs([parent,{...popup,documentId:'new-popup-document'}]);assert.equal(run.targetId,2);assert.equal(api.active(),2);assert.deepEqual([...run.windowIds],[1,2]);
});
test('Existing popup document changes before preparation or from a different opener cannot change target',()=>{
  for(const beforePreparation of [true,false]){
    const {api}=setup(),parent=gate(1),popup=gate(2,{openerTabId:beforePreparation?1:9});
    api.trackTabs([parent,popup]);const run=api.begin(1);run.entryActionsStarted=!beforePreparation;
    api.trackTabs([parent,{...popup,documentId:'new-popup-document'}]);assert.equal(run.targetId,1);
  }
});
test('No new or reused popup is adopted after seat scope is pinned',()=>{
  const {api}=setup(),parent=gate(1),popup=gate(2,{openerTabId:1});api.trackTabs([parent,popup]);const run=api.begin(1);run.entryActionsStarted=true;run.seatScope={id:1,version:0};
  api.trackTabs([parent,{...popup,documentId:'new-popup-document'},gate(3,{openerTabId:1})]);assert.equal(run.targetId,1);assert.deepEqual([...run.windowIds],[1]);
});
test('An old popup temporarily omitted from listings is not mistaken for a new popup on return',()=>{
  const {api}=setup(),parent=gate(1),popup=gate(2,{openerTabId:1});api.trackTabs([parent,popup]);const run=api.begin(1);run.entryActionsStarted=true;
  api.trackTabs([parent]);api.trackTabs([parent,popup]);assert.equal(run.targetId,1);
  api.trackTabs([parent,{...popup,documentId:'changed-after-preparation'}]);assert.equal(run.targetId,2);
});
test('A temporarily missing entry tab blocks new browser/network actions and reconnects on return',async()=>{
  const {api,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1),wc=api.current();api.trackTabs([]);
  assert.equal(run.signal.aborted,false);assert.ok(api.targets.has(1));assert.throws(()=>api.current(),/화면을 전환/);
  await assert.rejects(api.ensureNetwork(wc),/화면을 전환/);await assert.rejects(api.networkSnapshot(wc),/화면을 전환/);await assert.rejects(api.runJs(run,wc,'gateState'),/화면을 전환/);
  api.onDocument({tabId:1,documentId:'late-document'});assert.equal(calls.length,0);
  api.onBrowserEvent({type:'entry',tabId:1,event:{kind:'observer-lost'}});assert.equal(run.signal.aborted,false);
  api.trackTabs([gate(1,{documentId:'returned-document'})]);await run.observerTask;
  assert.equal(api.current().documentId,'returned-document');assert.equal(api.scopeVersions.get(1),1);assert.equal(calls.filter(c=>c.action==='network.attach').length,1);assert.equal(run.signal.aborted,false);
});
test('The first stop reason survives later stop calls and secondary cancelled-command errors',async()=>{
  const {api}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);let release;
  const task=api.launch(run,async()=>{await new Promise(resolve=>release=resolve);throw Error('중지되었거나 연결이 바뀐 동작입니다.');});
  const expected=assert.rejects(task,/연결이 바뀐/),first=api.stopRun('실행하던 탭의 관찰 연결이 끊겼습니다.'),second=api.stopRun('추가 중지');release();
  await Promise.all([expected,first,second]);assert.equal(api.last().message,'실행하던 탭의 관찰 연결이 끊겼습니다.');assert.equal(api.last().stopReason,api.last().message);assert.match(api.last().failureDetail,/연결이 바뀐/);
});
test('A failed in-flight preparation click is never replayed against a reused popup',async()=>{
  const {api,context,calls}=setup(),parent=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/gangwonfc'}),popup=gate(2,{openerTabId:1});api.trackTabs([parent,popup]);
  context.invoke=(fn)=>{
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='prepareEntry'){api.trackTabs([parent,{...popup,documentId:'new-popup-document'}]);throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');}
    return {};
  };
  await api.command('start',{key:'wanted',inspectionOnly:true});const run=api.runs.current;await assert.rejects(run.task,/페이지가 바뀌어/);
  assert.equal(calls.filter(c=>c.fn?.name==='prepareEntry').length,1);assert.equal(calls.some(c=>c.fn?.name==='armGate'),false);assert.match(api.last().message,/페이지가 바뀌어/);
});
test('Diagnostic write failure never changes a confirmed completion outcome',()=>{
  const {api}=setup({writeError:true});api.trackTabs([gate(1)]);const run=api.begin(1);
  assert.doesNotThrow(()=>api.finishRun(run,'좌석 선택 완료 · 가격/할인 화면 이동 확인'));assert.equal(api.runs.current,null);assert.match(api.last().message,/좌석 선택 완료/);assert.match(api.warning(),/기록을 파일에 저장하지 못/);
});
test('Restoring the previous run seeds IDs so a new completion is not hidden as the old result',()=>{
  const {api}=setup({savedLastRun:{id:7,durationMs:100,message:'이전 결과',entry:{}}});
  assert.equal(api.last().id,7);api.trackTabs([gate(1)]);const run=api.begin(1);assert.equal(run.id,8);
  api.finishRun(run,'새 결과');assert.equal(api.last().id,8);assert.equal(api.last().message,'새 결과');
  const next=api.begin(1);assert.equal(next.id,9);
});
test('Starting from an open gate continues observing its seat popup if navigation wins the initial gate read',async()=>{
  const {api,context,calls}=setup(),parent=gate(1);api.trackTabs([parent]);
  context.invoke=fn=>{
    if(fn?.name==='gateStatus'){api.trackTabs([parent,gate(2,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat',openerTabId:1})]);return {supported:false};}
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected old-page action');
  };
  await api.command('start',{inspectionOnly:true});const run=api.runs.current;await run.task;
  assert.match(api.last().message,/진입 확인 완료/);assert.equal(api.last().entry.seatPageObserved,true);assert.equal(calls.some(c=>c.fn?.name==='armGate'||c.fn==='gateState'),false);
});

test('An initial read rejected by document navigation follows only the adopted seat popup',async()=>{
  const {api,context,calls}=setup(),parent=gate(1);api.trackTabs([parent]);
  context.invoke=fn=>{
    if(fn?.name==='gateStatus'){
      api.trackTabs([parent,gate(2,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat',openerTabId:1})]);
      throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');
    }
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected old-page action');
  };
  await api.command('start',{inspectionOnly:true});const run=api.runs.current;await run.task;
  assert.match(api.last().message,/진입 확인 완료/);assert.equal(run.targetId,2);
  assert.equal(calls.filter(c=>c.fn?.name==='gateStatus').length,1);
  assert.equal(calls.some(c=>c.fn?.name==='prepareEntry'||c.fn?.name==='armGate'||c.fn==='gateState'),false);
});

for(const read of ['gateStatus','gateState'])test(`The ${read} observation tolerates a late navigation event without another entry request`,async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;run.inspectionOnly=true;
  run.entry.requestCount=1;run.entry.preparationConfirmed=true;
  context.invoke=fn=>{
    const name=typeof fn==='string'?fn:fn?.name;
    if(name===read){
      setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'})]),5);
      throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');
    }
    if(name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:false}};
    throw Error('Unexpected follow-up');
  };
  assert.match((await api.autoLoop(run)).message,/진입 확인 완료/);
  assert.equal(calls.filter(c=>(typeof c.fn==='string'?c.fn:c.fn?.name)===read).length,1);
  assert.equal(calls.some(c=>c.fn?.name==='prepareEntry'||c.fn?.name==='armGate'),false);
  assert.equal(run.entry.requestCount,1);assert.equal(run.entry.seatPageObserved,true);
});

test('An unchanged gate cannot conceal an unexplained document error or replay its read forever',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);
  context.invoke=()=>{throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/페이지가 바뀌어/);
  assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
});

test('An unrelated popup does not recover a rejected gate read',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;
  context.invoke=()=>{api.trackTabs([gate(1),gate(2,{url:'https://tickets.interpark.com/onestop/seat',openerTabId:9})]);throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/페이지가 바뀌어/);
  assert.equal(run.targetId,1);assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
});

test('Reloading the same gate document still stops before any gate mutation',async()=>{
  for(const rejected of [false,true]){
    const {api,context,calls}=setup();api.trackTabs([gate(1)]);
    context.invoke=fn=>{
      if(fn?.name==='gateStatus'){
        api.trackTabs([gate(1,{documentId:'replacement'})]);
        if(rejected)throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');
        return {supported:true,goodsCode:'26005452'};
      }
      return true;
    };
    await api.command('start',{inspectionOnly:true});const run=api.runs.current;await assert.rejects(run.task,/준비 화면이 다시 로드/);
    assert.equal(calls.some(c=>c.fn?.name==='armGate'),false);
  }
});

test('A gate mutation rejected during navigation is never recovered or replayed',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;run.inspectionOnly=true;
  context.invoke=fn=>{
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:false}};
    if(fn==='gateState')return null;
    if(fn?.name==='armGate'){api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'})]);throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');}
    throw Error('Unexpected follow-up');
  };
  await assert.rejects(api.autoLoop(run),/페이지가 바뀌어/);
  assert.equal(calls.filter(c=>c.fn?.name==='armGate').length,1);assert.equal(run.entry.seatPageObserved,false);
});

test('Entry read recovery rejects mutating actions and cannot relax a pinned seat scope',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1),wc=api.current();
  await assert.rejects(api.readEntryPage(run,wc,'armGate'),/허용되지 않은/);assert.equal(calls.length,0);
  run.seatScope={id:1,version:0};context.invoke=()=>{api.trackTabs([gate(1,{documentId:'changed'})]);throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');};
  await assert.rejects(api.readEntryPage(run,wc,'gateState'),/페이지가 바뀌어/);assert.equal(calls.length,1);
});

test('Consecutive booking and cancellation notices each click once in the same document',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1),wc=api.current();let notice='예매안내';
  context.invoke=(fn,arg)=>{assert.equal(fn?.name,'clickKnown');assert.equal(arg,'확인하고 예매하기');return {present:true,clicked:true,key:notice};};
  assert.equal(await api.acknowledgeNotice(run,wc,{present:true,enabled:true,key:notice}),true);
  assert.equal(await api.acknowledgeNotice(run,wc,{present:true,enabled:true,key:notice}),false);
  notice='취소/환불안내';
  assert.equal(await api.acknowledgeNotice(run,wc,{present:true,enabled:true,key:notice}),true);
  assert.equal(await api.acknowledgeNotice(run,wc,{present:true,enabled:true,key:notice}),false);
  assert.equal(run.noticeAttempt.key,notice);assert.equal(run.noticeTransition.key,notice);
  assert.equal(calls.filter(c=>c.fn?.name==='clickKnown').length,2);
});
test('A pre-notice extension is rejected before reserving a run or sending any entry/browser action',async()=>{
  const {api,context,calls}=setup();context.bridgeState={bookingNoticeSupported:false};api.trackTabs([gate(1)]);
  await assert.rejects(api.command('start',{}),/v0.9.*chrome-extension/);assert.equal(api.runs.current,null);assert.equal(calls.length,0);
});

const ocrResult=()=>({valid:true,text:'WTCNBW',confidence:.99});
const captchaSnapshot={present:true,supported:true,status:'ready',challengeId:'challenge1',existingText:'',imageDataUrl:'data:image/png;base64,aGVsbG8='};
function captchaFixture({ocr=ocrResult}={}){
  const fixture=setup({ocr}),{api,context}=fixture;
  api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  context.bridgeState={captchaSupported:true,bookingNoticeSupported:true};
  context.invoke=fn=>fn==='captcha.captchaSnapshot'?captchaSnapshot:fn==='captcha.captchaSubmit'?{submitted:true}:fn==='captcha.captchaStatus'?{present:false,status:'absent'}:{};
  return fixture;
}
test('standalone CAPTCHA read and submit never begin a booking or seat selection',async()=>{
  const {api,calls}=captchaFixture();
  assert.equal((await api.command('captchaRead')).status,'read');assert.equal(api.runs.current,null);
  assert.equal((await api.command('captchaSubmit')).status,'verified');assert.equal(api.runs.current,null);
  assert.ok(calls.filter(c=>c.fn).every(c=>String(c.fn).startsWith('captcha.')));assert.equal(calls.some(c=>c.action==='network.attach'),false);
});
test('legacy concert tab selection and standalone OCR require no sports game or network debugger',async()=>{
  const {api,calls}=captchaFixture();api.trackTabs([gate(1),gate(2,{url:'https://ticket.interpark.com/Book/BookSession.asp'})]);
  await api.command('target',2);assert.equal((await api.command('captchaRead')).status,'read');
  assert.equal(calls.some(c=>c.action==='network.attach'),false);assert.equal(api.runs.current,null);
});
test('automatic booking handles CAPTCHA then resumes after the dialog disappeared',async()=>{
  const {api,context,calls}=captchaFixture();const original=context.invoke;let scenes=0;
  context.invoke=fn=>fn?.name==='scene'?{completed:scenes++>0,captcha:true,selected:[],buttons:[],grades:[]}:original(fn);
  const run=api.begin(1);run.preferences.manualCaptchaAssist=false;assert.match((await api.autoLoop(run)).message,/가격\/할인/);
  assert.equal(calls.filter(c=>c.fn==='captcha.captchaSubmit').length,1);assert.equal(calls.filter(c=>c.ocr).length,1);
});
test('entry inspection-only stops before CAPTCHA capture or recognition',async()=>{
  const {api,calls}=captchaFixture(),run=api.begin(1);run.inspectionOnly=true;
  assert.match((await api.autoLoop(run)).message,/진입 확인 완료/);assert.equal(calls.length,0);
});
test('old extension cannot start automatic CAPTCHA or a standalone test',async()=>{
  const {api,context,calls}=captchaFixture();context.bridgeState={captchaSupported:false,bookingNoticeSupported:true};
  await assert.rejects(api.command('captchaRead'),/v0.9/);api.trackTabs([gate(1)]);
  await assert.rejects(api.command('start',{preferences:{manualCaptchaAssist:false}}),/v0.9/);assert.equal(api.runs.current,null);assert.equal(calls.length,0);
});
test('canceling a standalone OCR job prevents submission and blocks competing actions',async()=>{
  let release;const {api,calls}=captchaFixture({ocr:()=>new Promise(r=>release=r)});
  const pending=api.command('captchaSubmit');await new Promise(r=>setImmediate(r));
  for(const action of ['start','code','target','captchaRead'])await assert.rejects(api.command(action),/보안문자 처리 중/);
  const stopping=api.command('captchaStop');release(ocrResult());await assert.rejects(pending,/중지/);await stopping;
  assert.equal(calls.some(c=>c.fn==='captcha.captchaSubmit'),false);assert.ok(calls.some(c=>c.fn==='captcha.captchaCancel'));
});
test('document replacement during OCR prevents input even when tab URL stays the same',async()=>{
  let release;const {api,calls}=captchaFixture({ocr:()=>new Promise(r=>release=r)});
  const pending=api.command('captchaSubmit');await new Promise(r=>setImmediate(r));api.onDocument({tabId:1,documentId:'replacement'});release(ocrResult());
  await assert.rejects(pending,/문서가 바뀌/);assert.equal(calls.some(c=>c.fn==='captcha.captchaSubmit'),false);
});
test('manual code submission disables automatic OCR before the browser reply arrives',async()=>{
  const {api,context}=captchaFixture();const run=api.begin(1);let release;
  context.invoke=fn=>fn?.name==='enterCode'?new Promise(r=>release=r):{};
  const pending=api.command('code','WTCNBW');assert.equal(run.captchaDisabled,true);
  await assert.rejects(api.command('code','TXCBPQ'),/직접 입력한/);release(true);await pending;
});

function manualFixture(){
  const fixture=setup({ocr:()=>{throw Error('Human input must not call OCR');}}),{api,context}=fixture;
  api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  context.bridgeState={manualCaptchaSupported:true,bookingNoticeSupported:true};
  context.invoke=fn=>fn==='manualCaptcha.manualCaptchaPrepare'?{...captchaSnapshot}:fn==='manualCaptcha.manualCaptchaSubmit'?{submitted:true,status:'submitted',message:'한 번 전달'}:{};
  return fixture;
}
test('human input preparation and explicit submission do not recognize text or start booking',async()=>{
  const {api,calls}=manualFixture();
  const prepared=await api.command('manualCaptchaPrepare');assert.equal(prepared.manualCaptcha.targetId,1);
  assert.equal((await api.command('manualCaptchaSubmit',{challengeId:prepared.challengeId,text:'abcdef'})).submitted,true);
  assert.deepEqual(calls.find(c=>c.fn==='manualCaptcha.manualCaptchaSubmit').arg,{challengeId:'challenge1',text:'ABCDEF'});
  await assert.rejects(api.command('manualCaptchaSubmit',{challengeId:prepared.challengeId,text:'abcdef'}),/이미 확인/);
  assert.equal(calls.some(c=>c.ocr||c.action==='network.attach'),false);assert.equal(api.runs.current,null);
});
test('human submission cannot use a preview from a different document',async()=>{
  const {api,calls}=manualFixture();const prepared=await api.command('manualCaptchaPrepare');
  api.onDocument({tabId:1,documentId:'new-document'});
  await assert.rejects(api.command('manualCaptchaSubmit',{challengeId:prepared.challengeId,text:'ABCDEF'}),/문서가 바뀌/);
  assert.equal(calls.some(c=>c.fn==='manualCaptcha.manualCaptchaSubmit'),false);
});
test('default booking prepares human input and never invokes OCR',async()=>{
  const {api,context,calls}=manualFixture();const original=context.invoke;let scenes=0;
  context.invoke=fn=>fn?.name==='scene'?{completed:scenes++>0,captcha:true,selected:[],buttons:[],grades:[]}:original(fn);
  const run=api.begin(1);assert.equal(run.preferences.manualCaptchaAssist,true);
  assert.match((await api.autoLoop(run)).message,/가격\/할인/);
  assert.equal(calls.some(c=>c.fn==='manualCaptcha.manualCaptchaPrepare'),true);
  assert.equal(calls.some(c=>c.ocr||c.fn==='captcha.captchaSubmit'||c.fn==='manualCaptcha.manualCaptchaSubmit'),false);
});
test('old extension explains manual update without sending unsupported commands',async()=>{
  const {api,context,calls}=manualFixture();context.bridgeState={manualCaptchaSupported:false};
  await assert.rejects(api.command('manualCaptchaPrepare'),/v0.9.3/);assert.equal(calls.length,0);
});
