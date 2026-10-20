'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
function setup({savedPreferences=null,savedDesktop=null,writeError=false,savedLastRun=null,ocr=null,clock=null}={}){
  const filename=path.resolve(__dirname,'../src/chrome-main.js'),rawLoad=createRequire(filename),load=n=>n==='node:perf_hooks'&&clock?{performance:{now:clock}}:rawLoad(n),source=fs.readFileSync(filename,'utf8').split('app.whenReady().then')[0];
  const calls=[];
  class Target{
    constructor(bridge,row){this.update(row);}update(row){Object.assign(this,row);}getURL(){return this.url;}getTitle(){return this.title||'fixture';}isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;}isDemo(){return false;}
    async invoke(fn,arg){if(fn?.name==='httpBookingAction'){calls.push({fn,arg,id:this.id});return context.httpInvoke?context.httpInvoke(fn,arg):{stage:'ready',status:'pending',requestCount:6,heldCount:2,confirmed:true,validated:true};}if(fn?.name==='httpBookingNavigate'){calls.push({fn,arg,id:this.id});return context.httpInvoke?context.httpInvoke(fn,arg):arg.checkOnly?{supported:true}:{dispatched:true};}if(context.priceInvoke&&['proceedBooking','bookingProgress','priceState','adultPriceStep'].includes(fn?.name)){calls.push({fn,arg,id:this.id});return context.priceInvoke(fn,arg);}if(fn?.name==='priceState')return {ready:true,quantity:context.api?.runs.current?.preferences.quantity||2};if(fn?.name==='proceedBooking')return {dispatched:true};if(fn?.name==='bookingProgress')return {ready:true};if(fn?.name==='adultPriceStep')return {status:'complete',message:'가격/할인 화면 · 성인 가격 확인'};if(fn?.name==='bookingIdentity')return context.bookingIdentity||{goodsCode:'26005452',placeCode:'25001730',playSeq:'001'};if(fn?.name==='resolveGame')return {goodsCode:'26005452',placeCode:'25001730',playSeq:'001'};calls.push({fn,arg,id:this.id});if(context.invoke)return context.invoke(fn,arg);if(fn==='gateState')return null;if(fn?.name==='scene')return {selected:[],buttons:[],grades:[],hasSeats:false};return {};}
  }
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}},shell:{openExternal:async url=>calls.push({external:url})}};
  const context={require:n=>n==='electron'?electron:n==='./ocr-client'&&ocr?{OcrClient:class{async warmup(){return {};}async recognize(data,options){calls.push({ocr:true});return ocr(data,options);}close(){}}}:n==='./chrome-target'?{ChromeTarget:Target}:n==='./browser-bridge'?{BrowserBridge:class{}}:n==='node:fs'?{...fs,statSync(file){if(savedLastRun&&file.endsWith('last-run.json'))return {size:JSON.stringify(savedLastRun).length};throw Error('fixture');},readFileSync(file){if(savedDesktop&&file.endsWith('settings.json'))return JSON.stringify(savedDesktop);if(savedPreferences&&file.endsWith('preferences.json'))return JSON.stringify(savedPreferences);if(savedLastRun&&file.endsWith('last-run.json'))return JSON.stringify(savedLastRun);throw Error('fixture');},mkdirSync(){},readdirSync(){return [];},appendFileSync(file,body){if(writeError)throw Error("fixture write failure");(context.logs??=[]).push({file,body});},writeFileSync(file,body){if(writeError)throw Error('fixture write failure');calls.push({write:file,body});}}:load(n),__dirname:path.dirname(filename),process:{argv:[],pid:0},URL,URLSearchParams,Date,console,setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(source+`
  bridge={getState:()=>globalThis.bridgeState||{},listTabs:()=>globalThis.bridgeTabs||[],request:async q=>{globalThis.calls.push(q);if(q.action==='tabs.open'&&globalThis.openedTab)return globalThis.openedTab;if(q.action==='network.attach'&&globalThis.attachPromise)await globalThis.attachPromise;if(q.action==='network.snapshot')return globalThis.network;return {};}};
  globalThis.api={scheduleGateClock,pinListingDocument,rememberGate,rememberListing,setClock:value=>clockInfo=value,runHttpBooking,selectCandidates,rankRunSeats,followNoticeDocument,finishPriceSelection,finishBookingButton,recoverPriceSelection,autoLoop,trackTabs,onDocument,onBrowserEvent,command,selectionAdapter,beginRun,targets,runs,metaStores,scopeVersions,validHome,isEntryPage,ensureNetwork,networkSnapshot,runJs,readEntryPage,acknowledgeNotice,launch,stopRun,finishRun,last:()=>lastRun,warning:()=>diagnosticWarning,revision:()=>revision,preferences:()=>preferences,
    applyGradeDetails,gradeStores,recoverSeatDetails,current,active:()=>active,begin:id=>{active=id;return beginRun(targets.get(id),{},'auto');},setTask:p=>runner.task=p};`,context);
  context.calls=calls;context.network={healthy:true,sequence:0,pending:[],results:[]};
  return {api:context.api,context,calls};
}
const gate=(id,extra={})=>({id,url:'https://tickets.interpark.com/gates/ticket/26005452',title:'gate',documentId:'initial-document',...extra});
test('entry strategy and offset survive desktop settings reload without a browser action',async()=>{
  const first=setup();const result=await first.api.command('entrySettings',{entryStrategy:'clock',entryOffsetMs:-125});
  assert.equal(result.desktop.entryStrategy,'clock');assert.equal(result.desktop.entryOffsetMs,-125);
  const saved=JSON.parse(first.calls.find(call=>call.write?.endsWith('settings.json')).body);
  const reloaded=setup({savedDesktop:saved});const restored=await reloaded.api.command('entrySettings',{});
  assert.equal(restored.desktop.entryStrategy,'clock');assert.equal(restored.desktop.entryOffsetMs,-125);
  assert.equal(reloaded.calls.length,0);assert.equal(first.calls.filter(call=>!call.write).length,0);
});
test('invalid entry preferences and failed persistence leave the previous settings unchanged',async()=>{
  const savedDesktop={entryStrategy:'clock',entryOffsetMs:20};
  const {api,calls}=setup({savedDesktop});
  for(const input of [{entryStrategy:'invalid'},{entryOffsetMs:251},{entryOffsetMs:0.5}])await assert.rejects(api.command('entrySettings',input),/진입/);
  assert.equal(calls.length,0);assert.equal((await api.command('entrySettings',{})).desktop.entryOffsetMs,20);
  const failing=setup({savedDesktop,writeError:true});
  await assert.rejects(failing.api.command('entrySettings',{entryOffsetMs:30}),/write failure/);
  assert.equal((await failing.api.command('entrySettings',{})).desktop.entryOffsetMs,20);
});
test('removed standalone seat and profile commands cannot read or mutate a booking page',async()=>{
  const {api,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  for(const action of ['scan','seat','catalog','recommend','choose','complete','venueSelect','venueCreate'])await assert.rejects(api.command(action,{}),/지원하지 않는 동작/);
  assert.equal(calls.length,0);assert.equal(api.runs.current,null);
});
test('late metadata hydration joins the observed block once without any seat mutation',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);run.preferences.selectionMethod='api';
  const id='seat_block_26005452:25001730:001:466';
  context.invoke=(fn,arg)=>{
    assert.equal(fn?.name,'readDetails');assert.deepEqual([...arg.blockKeys],['001:101']);
    return {blocks:[{blockKey:'001:101',seats:[{seatInfoId:id.slice(11),rowIdx:0,colIdx:0,rowNo:'A',seatNo:'1',seatGrade:'3',isExposable:true}]}],grades:[{code:'3',name:'W석'}]};
  };
  const rows=[{id,kind:'seat',group:'seat_block_001:101'}];
  assert.equal(await api.recoverSeatDetails(run,api.current(),rows),true);
  assert.equal(api.metaStores.get(1).get(id).rowLabel,'A');
  assert.equal(await api.recoverSeatDetails(run,api.current(),rows),false);
  assert.equal(calls.filter(c=>c.fn?.name==='readDetails').length,1);
  assert.ok(!calls.some(c=>c.fn?.name==='reserveByCode'||c.action==='live.liveAction'));
});

for(const field of ['row','number','grade'])test(`An incomplete cached ${field} permits only one bounded block refresh per visit`,async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  const row={id:'seat_block_26005452:25001730:001:466',kind:'seat',group:'seat_block_001:101',row:1,number:2,grade:'A',[field]:null};
  api.metaStores.get(1).set(row.id,{...row});run.detailsReadGrades=true;
  context.invoke=(fn,arg)=>{assert.equal(fn?.name,'readDetails');assert.deepEqual([...arg.blockKeys],['001:101']);assert.equal(arg.includeGrades,false);return {blocks:[],grades:[]};};
  assert.equal(await api.recoverSeatDetails(run,api.current(),[row]),true);
  assert.equal(await api.recoverSeatDetails(run,api.current(),[row]),false);
  assert.equal(calls.filter(c=>c.fn?.name==='readDetails').length,1);
  assert.equal(api.metaStores.get(1).get(row.id)[field],null);
});

test('Meaningful metadata changes expire cooldown and clear its tried job while identical values do not',()=>{
  const {api}=setup();api.trackTabs([gate(1)]);const run=api.begin(1),key=JSON.stringify([0,'A']),until=Date.now()+1000;
  run.metadataCooldown=new Map([[key,until]]);run.triedJobs.add(key);run.detailsReadBlocks=new Set(['001:101']);
  const first={id:'seat-1',row:null,number:1,grade:'A'};api.metaStores.get(1).set(first.id,first);
  api.onBrowserEvent({type:'metadata',tabId:1,documentId:'initial-document',rows:[{grade:'A',number:1,row:null,id:'seat-1'}]});
  assert.equal(run.metadataCooldown.get(key),until);assert.equal(run.triedJobs.has(key),true);
  api.onBrowserEvent({type:'metadata',tabId:1,documentId:'initial-document',rows:[{...first,row:1}]});
  assert.equal(run.metadataCooldown.get(key),0);assert.equal(run.triedJobs.has(key),false);
  assert.equal(run.metadataCooldown.has(key),true);assert.equal(run.detailsReadBlocks.has('001:101'),true);
});

test('Only changed effective grade names expire metadata cooldown',()=>{
  const {api}=setup();api.trackTabs([gate(1)]);const run=api.begin(1),key=JSON.stringify([0,'A']),until=Date.now()+1000;
  api.applyGradeDetails(api.current(),{grades:[{code:'1',name:'A'}]},run);
  run.metadataCooldown=new Map([[key,until]]);run.triedJobs.add(key);
  api.onBrowserEvent({type:'grades',tabId:1,documentId:'initial-document',rows:[{code:'1',name:'A'},{code:'1',name:'A'}]});
  assert.equal(run.metadataCooldown.get(key),until);assert.equal(run.triedJobs.has(key),true);
  api.onBrowserEvent({type:'grades',tabId:1,documentId:'initial-document',rows:[{code:'2',name:'B'}]});
  assert.equal(run.metadataCooldown.get(key),0);assert.equal(run.triedJobs.has(key),false);
});

function wheelchairSingleton(){
  const id='seat_block_26005452:25001730:001:1823';
  return {kind:'seat',id,group:'seat_block_001:104',available:true,grade:'3루 K5 휠체어장애인석',gradeCode:'28',block:'104',row:null,number:null,rowIdx:12,colIdx:5,
    rawRowLabel:'104블록',rawSeatNumber:'W4-1',exposable:true,grouped:true,hasMetadata:true,singletonGroup:true,labelFormat:'wheelchair-block',groupSize:1,seatGroupId:id.slice(11)+'::1::1'};
}

test('A verified wheelchair singleton does not requery supported original row and seat labels',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1),row=wheelchairSingleton();
  context.invoke=()=>{throw Error('Supported singleton must not hydrate again');};
  assert.equal(await api.recoverSeatDetails(run,api.current(),[row]),false);
  assert.equal(calls.length,0);assert.equal(row.row,null);assert.equal(row.number,null);
  context.invoke=fn=>{assert.equal(fn?.name,'readDetails');return {blocks:[],grades:[]};};
  assert.equal(await api.recoverSeatDetails(run,api.current(),[{...row,seatGroupId:'unverified'}]),true);
  assert.equal(calls.filter(c=>c.fn?.name==='readDetails').length,1);
});

test('A verified singleton excluded by quantity is detailed data rather than metadata cooldown',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1),row=wheelchairSingleton();
  run.preferences.quantity=2;run.preferences.excludeRestricted=false;run.currentJob={name:row.grade,tierIndex:0};run.gradeOpenedAt=Date.now()-1000;
  api.metaStores.get(1).set(row.id,{...row});api.current().readSeats=async()=>({rows:[row],revision:1});
  context.invoke=fn=>{
    if(fn?.name==='scene')return {completed:false,captcha:false,hasSeats:true,selected:[],grades:[],buttons:[{label:'좌석도 전체보기',enabled:true}]};
    if(fn?.name==='clickKnown')throw Error('FIXTURE_NEXT_GRADE');
    throw Error('Unexpected singleton action');
  };
  await assert.rejects(api.autoLoop(run),/FIXTURE_NEXT_GRADE/);
  assert.equal(run.metadataCooldown?.size||0,0);assert.ok(!calls.some(c=>c.fn?.name==='readDetails'||c.fn?.name==='httpBookingAction'));
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse)),evidence=events.find(e=>e.event==='seat-candidates');
  assert.equal(evidence.detailedCount,1);assert.equal(evidence.missingRowCount,0);assert.equal(evidence.missingNumberCount,0);
  assert.equal(evidence.unsupportedRowCount,0);assert.equal(evidence.unsupportedNumberCount,0);assert.equal(evidence.groupedCount,0);
  assert.equal(events.some(e=>e.event==='metadata-unresolved'),false);
});
test('wrong booking identity stops before notices, CAPTCHA or seat mutations',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  context.bookingIdentity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
  const run=api.begin(1);run.expectedBooking={goodsCode:'26005452',placeCode:'25001730',playSeq:'001'};
  await assert.rejects(api.autoLoop(run),/상품·구장·회차가 달라/);assert.equal(calls.length,0);
});

for(const read of ['bookingIdentity','scene'])test(`The initial seat ${read} reconnects before the first notice in one run`,async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  const wc=api.current(),invoke=wc.invoke.bind(wc),sequence=[];let failed=false,notices=0;
  wc.invoke=async(fn,arg)=>{
    const name=typeof fn==='string'?fn:fn?.name;sequence.push(name);
    if(name===read&&!failed){failed=true;throw Error('Could not establish connection. Receiving end does not exist.');}
    return invoke(fn,arg);
  };
  context.invoke=(fn,arg)=>{
    if(fn?.name==='scene')return {completed:notices>0,captcha:false,selected:[],buttons:[],grades:[],notice:notices?{present:false}:{present:true,enabled:true,key:'예매안내'}};
    if(fn?.name==='clickKnown'){assert.equal(arg,'확인하고 예매하기');notices++;return {clicked:true,key:'예매안내'};}
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected action');
  };
  await api.command('start',{preferences:{autoCaptcha:false,autoComplete:false}});const run=api.runs.current;await run.task;
  assert.match(api.last().message,/추가 요청 없이/);assert.equal(notices,1);
  assert.equal(sequence.slice(0,sequence.indexOf('clickKnown')).filter(name=>name===read).length,2);
  assert.ok(!calls.some(c=>c.fn?.name==='httpBookingAction'));
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse));
  assert.equal(events.filter(e=>e.event==='run-start').length,1);
  assert.ok(events.some(e=>e.event==='entry-transition'&&e.result==='reconnected'&&e.action===read));
});

test('A receiver failure after the first notice cannot reopen initial seat read recovery',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  const run=api.begin(1);let notices=0,scenes=0;
  context.invoke=fn=>{
    if(fn?.name==='scene'){
      scenes++;if(notices)throw Error('Could not establish connection. Receiving end does not exist.');
      return {completed:false,captcha:false,selected:[],buttons:[],notice:{present:true,enabled:true,key:'예매안내'}};
    }
    if(fn?.name==='clickKnown'){notices++;return {clicked:true,key:'예매안내'};}
    throw Error('Unexpected action');
  };
  await assert.rejects(api.autoLoop(run),/Receiving end/);
  assert.equal(notices,1);assert.equal(scenes,2);assert.ok(run.seatScope);
  assert.ok(!calls.some(c=>c.fn?.name==='httpBookingAction'));
});

test('A seat scope changed before a completed screen stops before price or booking actions',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  const run=api.begin(1);run.seatScope={id:1,version:api.scopeVersions.get(1)};
  api.onDocument({tabId:1,documentId:'replacement'});
  context.invoke=fn=>{if(fn?.name==='scene')return {completed:true,selected:[],buttons:[]};throw Error('Unexpected action');};
  await assert.rejects(api.autoLoop(run),/경기 또는 회차가 변경/);
  assert.equal(calls.length,0);
});

test('A document replacement between the first identity and scene cannot authorize a completed action',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  const run=api.begin(1);
  context.invoke=fn=>{
    if(fn?.name==='scene'){api.onDocument({tabId:1,documentId:'replacement'});return {completed:true,selected:[],buttons:[]};}
    throw Error('Unexpected action');
  };
  await assert.rejects(api.autoLoop(run),/준비 화면이 다시 로드|경기 또는 회차가 변경/);
  assert.equal(calls.filter(c=>c.fn?.name==='scene').length,1);
  assert.ok(!calls.some(c=>c.fn?.name==='httpBookingAction'||c.fn?.name==='clickKnown'));
});

test('a late transitional route gets its own wait and performs no page action before the seat page',async()=>{
  const {api,calls,context}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/transition'})]);
  const run=api.begin(1);run.started=Date.now()-60000;run.inspectionOnly=true;
  const task=api.autoLoop(run);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(calls.length,0,'unknown transitional routes must not issue page commands');
  api.targets.get(1).url='https://tickets.interpark.com/onestop/seat';
  assert.match((await task).message,/진입 확인 완료/);
  assert.equal(run.unsupportedSince,null);
});

test('an unsupported route still stops after its own grace period without page actions',async()=>{
  const {api,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/unknown'})]);
  const run=api.begin(1);run.unsupportedSince=Date.now()-16000;
  await assert.rejects(api.autoLoop(run),/지원하는 예매 진행 화면이 아닙니다/);
  assert.equal(calls.length,0);
});
test('Seat API mode preserves the normal site entry flow instead of copying a preparation URL',async()=>{
  const {api,context,calls}=setup();
  const listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/bluewings'});
  api.trackTabs([listing]);context.bridgeTabs=[listing];
  context.invoke=(fn,arg)=>{
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='armListing'){
      api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat?step=price',documentId:'new-document'})]);
      return {phase:'clicked',runId:arg.runId,key:arg.key};
    }
    if(fn?.name==='scene')return {completed:true,selected:[],buttons:[]};
    return {};
  };
  await api.command('start',{key:'wanted',preferences:{quantity:1,selectionMethod:'api',autoCaptcha:false}});
  await api.runs.current.task;
  assert.equal(calls.filter(c=>c.fn?.name==='armListing').length,1);
  assert.ok(!calls.some(c=>c.action==='tabs.open'));assert.equal(api.active(),1);
});
test('preflight is read-only and separates bridge connectivity from observer health',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);context.bridgeState={connected:true};
  context.invoke=fn=>fn?.name==='scene'?{selected:[],grades:[{name:'본부석',count:20}],hasSeats:false,buttons:[]}:undefined;
  const result=await api.command('preflight',{preferences:{autoComplete:false}});
  assert.equal(result.canStart,true);assert.equal(result.checks.find(c=>c.id==='observer').level,'ok');
  assert.match(result.checks.find(c=>c.id==='scope').title,/다음 단계 이동 안 함/);
  assert.equal(api.runs.current,null);assert.ok(calls.every(c=>!c.fn||c.fn?.name==='scene'||c.fn?.name==='httpBookingNavigate'&&c.arg.checkOnly===true));
  assert.equal(result.checks.find(c=>c.id==='http-capability').level,'ok');
  context.network.healthy=false;const failed=await api.command('preflight',{});assert.equal(failed.canStart,false);
});
test('explicit start at an existing seat page never sends a new entry request',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  context.invoke=fn=>fn?.name==='scene'?{completed:true,selected:[],buttons:[]}:undefined;
  await api.command('start',{preferences:{autoCaptcha:false}});const run=api.runs.current;await run.task;
  assert.equal(api.last().entry.strategy,'current-seat');assert.equal(api.last().diagnosis.code,'booking-advanced');
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
  await assert.rejects(api.command('start',{}),/v0.9.28/);assert.equal(api.runs.current,null);assert.equal(calls.length,0);
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
test('saved seat preferences load directly and saving writes only the single normalized preferences file',async()=>{
  const savedPreferences={quantity:3,areas:['내야'],blocks:['101'],tiers:[{name:'앞열',areas:['내야'],maxRow:5}]};
  const {api,calls}=setup({savedPreferences});
  assert.equal(api.preferences().quantity,3);assert.deepEqual([...api.preferences().blocks],['101']);assert.equal(api.preferences().tiers[0].maxRow,5);
  const saved=await api.command('preferences',{quantity:4,areas:['B']});assert.equal(saved.preferences.quantity,4);assert.deepEqual([...saved.preferences.areas],['B']);
  const writes=calls.filter(c=>c.write);assert.equal(writes.length,1);assert.equal(path.basename(writes[0].write),'preferences.json');assert.equal(JSON.parse(writes[0].body).quantity,4);
});
test('preferences cannot save while a booking run is active',async()=>{
  const {api}=setup();api.trackTabs([gate(1)]);api.begin(1);
  await assert.rejects(api.command('preferences',{}),/진행 중에는/);
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
test('A listing invocation whose reply loses the navigation race follows a reused popup without replay',async()=>{
  const {api,context,calls}=setup(),parent=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/gangwonfc'}),popup=gate(2,{openerTabId:1});api.trackTabs([parent,popup]);
  context.invoke=(fn)=>{
    if(fn?.name==='stopListing')return {stopped:true};
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='armListing'){api.trackTabs([parent,{...popup,url:'https://tickets.interpark.com/onestop/seat',documentId:'new-popup-document'}]);throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');}
    return {};
  };
  await api.command('start',{key:'wanted',inspectionOnly:true});const run=api.runs.current;await run.task;
  assert.equal(calls.filter(c=>c.fn?.name==='armListing').length,1);assert.equal(calls.some(c=>c.fn?.name==='armGate'),false);
  assert.equal(api.last().entry.listingPhase,'transition-unconfirmed');assert.equal(api.last().entry.seatPageObserved,true);
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

for(const message of [
  'Could not establish connection. Receiving end does not exist.',
  'The message port closed before a response was received.',
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'
])test(`A disconnected read observes the next document without replay: ${message}`,async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;run.inspectionOnly=true;run.entry.requestCount=1;
  context.invoke=fn=>{
    if(fn?.name==='gateStatus'){
      setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'})]),10);
      throw Error(message);
    }
    throw Error('Unexpected replay');
  };
  assert.match((await api.autoLoop(run)).message,/진입 확인 완료/);
  assert.equal(calls.filter(c=>c.fn?.name==='gateStatus').length,1);
  assert.ok(!calls.some(c=>['armGate','armListing','prepareEntry'].includes(c.fn?.name)));
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse));
  assert.ok(events.some(e=>e.event==='entry-transition'&&e.result==='waiting'));
  assert.ok(events.some(e=>e.event==='entry-transition'&&e.result==='observed'));
});

test('A disconnected gate read remains cancellable and never reissues a command while waiting',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);
  context.invoke=()=>{throw Error('Could not establish connection. Receiving end does not exist.');};
  const pending=api.readEntryPage(run,api.current(),'gateState');
  setTimeout(()=>api.runs.cancel(),20);
  await assert.rejects(pending,/중지|취소/);
  assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
});

test('A disconnected read on an unchanged or unrelated document cannot hide the failure',async()=>{
  let mono=0,expire=false;
  const {api,context,calls}=setup({clock:()=>expire?(mono+=16000):mono});api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;
  context.invoke=()=>{
    api.trackTabs([gate(1),gate(2,{url:'https://tickets.interpark.com/onestop/seat',openerTabId:9})]);
    expire=true;
    throw Error('Could not establish connection. Receiving end does not exist.');
  };
  // Advance the bounded wait without sleeping for a real navigation timeout.
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/Receiving end/);
  assert.equal(run.targetId,1);assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
});

test('An unchanged gate reconnects its read once without any entry mutation',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);let reads=0;
  context.invoke=fn=>{
    assert.equal(fn,'gateState');
    if(!reads++)throw Error('Could not establish connection. Receiving end does not exist.');
    return {phase:'armed',runId:run.id};
  };
  assert.equal((await api.readEntryPage(run,api.current(),'gateState')).phase,'armed');
  assert.equal(calls.length,2);assert.equal(api.current().documentId,'initial-document');
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse));
  assert.ok(events.some(e=>e.event==='entry-transition'&&e.result==='reconnected'&&e.count===1));
});

const lostCodeResult='사이트 코드 실행 결과를 확인하지 못했습니다. 같은 동작을 반복하지 않습니다.';
for(const replaced of [false,true])test(`A lost listingState result ${replaced?'rejects document replacement':'reconnects only the same document'}`,async()=>{
  const {api,context,calls}=setup(),listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});
  api.trackTabs([listing]);const run=api.begin(1);run.game={key:'wanted'};api.pinListingDocument(run,api.current());let reads=0;
  context.invoke=fn=>{
    assert.equal(fn?.name,'listingState');
    if(!reads++)throw Error(lostCodeResult);
    if(replaced)api.trackTabs([{...listing,documentId:'replacement'}]);
    return {phase:'armed',key:'wanted',runId:run.id};
  };
  const pending=api.readEntryPage(run,api.current(),require('../src/entry').listingState);
  if(replaced)await assert.rejects(pending,/준비 화면이 다시 로드/);
  else assert.equal((await pending).phase,'armed');
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.fn?.name==='listingState'));
});

test('A repeatedly lost code result keeps the three-read retry cap',async()=>{
  let mono=0,fast=false;
  const {api,context,calls}=setup({clock:()=>fast?(mono+=1000):mono});api.trackTabs([gate(1)]);const run=api.begin(1);
  context.invoke=()=>{fast=true;throw Error(lostCodeResult);};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),error=>error.message===lostCodeResult);
  assert.equal(calls.length,4);assert.ok(calls.every(c=>c.fn==='gateState'));
});

test('Repeated receiver failures have a fixed read retry cap and preserve the original failure',async()=>{
  let mono=0,fast=false;
  const {api,context,calls}=setup({clock:()=>fast?(mono+=1000):mono});api.trackTabs([gate(1)]);const run=api.begin(1);
  context.invoke=()=>{fast=true;throw Error('Could not establish connection. Receiving end does not exist.');};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/Receiving end/);
  assert.equal(calls.length,4);assert.ok(calls.every(c=>c.fn==='gateState'));
});

test('Receiver disconnection cannot recover a replaced gate document or an arbitrary read error',async()=>{
  for(const changeDocument of [true,false]){
    const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);let reads=0;
    context.invoke=()=>{
      if(!reads++)throw Error('Could not establish connection. Receiving end does not exist.');
      if(changeDocument){api.trackTabs([gate(1,{documentId:'replacement'})]);return {};}
      throw Error('fixture permission denied');
    };
    await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),changeDocument?/준비 화면이 다시 로드/:/fixture permission denied/);
    assert.equal(calls.length,2);
  }
});

test('An unchanged gate cannot conceal an unexplained document error or replay its read forever',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);
  context.invoke=()=>{throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/페이지가 바뀌어/);
  assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
});

test('Listing read rejected during a transitional URL waits for the observed seat document without replay',async()=>{
  const {api,context,calls}=setup();
  const listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/baseball'});
  api.trackTabs([listing]);const run=api.begin(1);run.entryActionsStarted=true;run.inspectionOnly=true;
  run.game={key:'wanted'};api.pinListingDocument(run,api.current());run.entry.listingPhase='clicked';
  context.invoke=fn=>{
    if(fn?.name==='listingState'){
      setTimeout(()=>api.trackTabs([]),5);
      setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'})]),30);
      throw Error('지원하는 NOL 예매 탭이 아닙니다.');
    }
    throw Error('Unexpected follow-up');
  };
  assert.match((await api.autoLoop(run)).message,/진입 확인 완료/);
  assert.equal(calls.filter(c=>c.fn?.name==='listingState').length,1);
  assert.ok(!calls.some(c=>['armListing','prepareEntry','armGate'].includes(c.fn?.name)));
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse));
  assert.ok(events.some(e=>e.event==='entry-transition'&&e.action==='listingState'));
});

test('Unsupported-tab read failure without an observed transition still stops and never retries',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);
  context.invoke=()=>{throw Error('지원하는 NOL 예매 탭이 아닙니다.');};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/지원하는 NOL/);
  assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
});

test('Notice evidence distinguishes different bodies with the same title while invoking each only once',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.preferences.autoNotice=true;
  let signature='예매안내:first';context.invoke=fn=>{assert.equal(fn.name,'clickKnown');return {clicked:true,key:'예매안내',signature};};
  const notice=()=>({present:true,enabled:true,key:'예매안내',signature});
  assert.equal(await api.acknowledgeNotice(run,api.current(),notice()),true);
  assert.equal(await api.acknowledgeNotice(run,api.current(),notice()),false);
  signature='예매안내:second';
  assert.equal(await api.acknowledgeNotice(run,api.current(),notice()),true);
  assert.equal(calls.filter(c=>c.fn?.name==='clickKnown').length,2);
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse));
  assert.equal(events.filter(e=>e.event==='booking-notice-result'&&e.result==='invoked').length,2);
});

test('No inventory records grade evidence and waits instead of claiming all seats were inspected',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  run.preferences.quantity=1;run.preferences.areas=[];run.preferences.tiers=[];
  context.invoke=fn=>{
    if(fn?.name==='scene')return {selected:[],buttons:[],grades:[{name:'일반석',count:'0'},{name:'휠체어석',count:'10'}],hasSeats:false};
    if(fn?.name==='liveRead')return {rows:[],revision:7};
    if(fn?.name==='waitForChange'){assert.match(run.status,/표시 잔여석이 0석/);api.runs.cancel();return {changed:false,stopped:true};}
    throw Error('Unexpected action');
  };
  await assert.rejects(api.autoLoop(run));
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse)),evidence=events.find(e=>e.event==='seat-search-plan');
  assert.equal(evidence.reason,'inventory-empty');assert.equal(evidence.planCount,0);assert.equal(evidence.grades[0].count,0);
  assert.ok(evidence.grades[1].reasons.includes('restricted'));
  assert.equal(run.retry.attempted,0);assert.ok(!calls.some(c=>c.fn?.name==='clickKnown'));
});

test('Chrome missing-document race waits for the exact source tab transition without replay',async()=>{
  const {api,context,calls}=setup();
  api.trackTabs([gate(1,{documentId:'A77E947DA9A70F12A042F09381FEAAF0'})]);
  const run=api.begin(1);run.entryActionsStarted=true;run.inspectionOnly=true;run.entry.requestCount=1;
  context.invoke=fn=>{
    if(fn?.name==='gateStatus'){
      setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'})]),5);
      throw Error('No document with id A77E947DA9A70F12A042F09381FEAAF0 in tab with id 1');
    }
    throw Error('Unexpected replay');
  };
  assert.match((await api.autoLoop(run)).message,/진입 확인 완료/);
  assert.equal(calls.filter(c=>c.fn?.name==='gateStatus').length,1);
  assert.ok(!calls.some(c=>c.fn?.name==='armGate'));
});

test('Missing-document error for an unrelated document is not accepted as navigation',async()=>{
  const {api,context}=setup();api.trackTabs([gate(1,{documentId:'ABC123'})]);const run=api.begin(1);
  context.invoke=()=>{throw Error('No document with id DEF456 in tab with id 1');};
  await assert.rejects(api.readEntryPage(run,api.current(),'gateState'),/No document/);
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

for(const failure of ['페이지가 바뀌어 이전 화면의 동작을 취소했습니다.',lostCodeResult])test(`A gate mutation failure is never recovered or replayed: ${failure}`,async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryActionsStarted=true;run.inspectionOnly=true;
  context.invoke=fn=>{
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:false}};
    if(fn==='gateState')return null;
    if(fn?.name==='armGate'){api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'})]);throw Error(failure);}
    throw Error('Unexpected follow-up');
  };
  await assert.rejects(api.autoLoop(run),error=>error.message===failure);
  assert.equal(calls.filter(c=>c.fn?.name==='armGate').length,1);assert.equal(run.entry.seatPageObserved,false);
});

test('A lost notice mutation result is not read-recovered or clicked twice',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  context.invoke=fn=>{assert.equal(fn?.name,'clickKnown');throw Error(lostCodeResult);};
  await assert.rejects(api.acknowledgeNotice(run,api.current(),{present:true,enabled:true,key:'예매안내'}),error=>error.message===lostCodeResult);
  assert.equal(calls.length,1);assert.equal(calls[0].fn.name,'clickKnown');
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
test('One start continues listing, disconnected gate, two notices and CAPTCHA in the same run',async()=>{
  const {api,context,calls}=setup({ocr:ocrResult});
  const listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});
  api.trackTabs([listing]);context.bridgeTabs=[listing];context.bridgeState={captchaSupported:true,bookingNoticeSupported:true};
  let gateReads=0,armed=false,notices=0,verified=false;
  context.invoke=(fn,arg)=>{
    const name=typeof fn==='string'?fn:fn?.name;
    if(name==='gameCards')return [{key:'wanted',schedule:''}];
    if(name==='armListing'){
      api.trackTabs([gate(1,{documentId:'gate-document'})]);
      return {phase:'clicked',runId:arg.runId,key:arg.key};
    }
    if(name==='gateStatus'){
      if(gateReads++===0)return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:false}};
      if(gateReads===2)setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat-document'})]),1800);
      throw Error('Could not establish connection. Receiving end does not exist.');
    }
    if(name==='gateState')return armed?{phase:'armed',runId:api.runs.current.id}:null;
    if(name==='armGate'){armed=true;return {phase:'armed',runId:arg.runId};}
    if(name==='scene')return {completed:false,selected:[],buttons:[],grades:notices===2&&verified?[{name:'일반석',count:1}]:[],captcha:notices===2&&!verified,notice:notices<2?{present:true,enabled:true,key:'예매안내',signature:'notice-'+notices}:{present:false}};
    if(name==='clickKnown'){assert.equal(arg,'확인하고 예매하기');const signature='notice-'+notices;notices++;return {clicked:true,key:'예매안내',signature};}
    if(name==='captcha.captchaSnapshot')return captchaSnapshot;
    if(name==='captcha.captchaSubmit'){verified=true;return {submitted:true};}
    if(name==='captcha.captchaStatus')return {present:false,status:'absent'};
    if(name==='bookingObservation')return {schemaVersion:1,goods:{goodsCode:'26005452'},buttons:[]};
    if(name==='stopWatchers')return true;
    throw Error('Unexpected action '+name);
  };
  await api.command('start',{key:'wanted',preferences:{stopAfterCaptcha:true}});
  const run=api.runs.current;await run.task;
  assert.match(api.last().message,/보안문자 확인 후 정지/);assert.equal(api.last().id,run.id);
  assert.equal(calls.filter(c=>c.fn?.name==='armListing').length,1);
  assert.equal(calls.filter(c=>c.fn?.name==='armGate').length,1);
  assert.equal(calls.filter(c=>c.fn?.name==='clickKnown').length,2);
  assert.equal(calls.filter(c=>c.fn==='captcha.captchaSubmit').length,1);
  assert.ok(!calls.some(c=>['liveAction','httpBookingAction'].includes(c.fn?.name)));
  const events=context.logs.flatMap(l=>l.body.trim().split('\n').map(JSON.parse));
  assert.equal(events.filter(e=>e.event==='run-start').length,1);
  assert.ok(events.some(e=>e.event==='entry-transition'&&e.result==='observed'));
  assert.equal(events.filter(e=>e.event==='booking-notice-result'&&e.result==='invoked').length,2);
});

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
  context.invoke=fn=>fn?.name==='scene'?{completed:scenes++>0,captcha:scenes===1,selected:[],buttons:[],grades:[]}:original(fn);
  const run=api.begin(1);run.preferences.manualCaptchaAssist=false;assert.match((await api.autoLoop(run)).message,/예매하기|가격\/할인|HTTP 승인/);
  assert.equal(calls.filter(c=>c.fn==='captcha.captchaSubmit').length,1);assert.equal(calls.filter(c=>c.ocr).length,1);
});
test('entry inspection-only stops before CAPTCHA capture or recognition',async()=>{
  const {api,calls}=captchaFixture(),run=api.begin(1);run.inspectionOnly=true;
  assert.match((await api.autoLoop(run)).message,/진입 확인 완료/);assert.equal(calls.length,0);
});

test('post-CAPTCHA inspection records the ready screen without clicking grades or seats',async()=>{
  const {api,context,calls}=captchaFixture();const original=context.invoke;
  let scenes=0;
  context.invoke=fn=>{
    if(fn?.name==='scene')return {completed:false,captcha:scenes++===0,selected:[],buttons:[],grades:[{name:'일반석',count:1}],notice:{present:false}};
    if(fn?.name==='bookingObservation')return {schemaVersion:1,goods:{goodsCode:'26014421'},buttons:[]};
    return original(fn);
  };
  const run=api.begin(1);run.preferences.stopAfterCaptcha=true;run.preferences.manualCaptchaAssist=false;run.preferences.autoCaptcha=false;
  const result=await api.autoLoop(run);assert.match(result.message,/보안문자 확인 후 정지/);
  assert.ok(calls.some(c=>c.write?.includes('observations')));
  assert.ok(calls.every(c=>!c.fn||String(c.fn).startsWith('captcha.')||['scene','bookingObservation'].includes(c.fn.name)));
  assert.equal(calls.filter(c=>c.fn==='captcha.captchaSubmit').length,1);
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
test('automatic booking rejects legacy manual commands without disabling OCR',async()=>{
  const {api,calls}=captchaFixture();const run=api.begin(1);
  for(const action of ['code','manualCaptchaPrepare','manualCaptchaFocus','manualCaptchaSubmit'])await assert.rejects(api.command(action,'WTCNBW'),/자동 입력/);
  assert.notEqual(run.captchaDisabled,true);assert.equal(calls.length,0);
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
test('default booking automatically recognizes and submits without human input',async()=>{
  const {api,context,calls}=captchaFixture();const original=context.invoke;let scenes=0;
  context.invoke=fn=>fn?.name==='scene'?{completed:scenes++>0,captcha:scenes===1,selected:[],buttons:[],grades:[]}:original(fn);
  const run=api.begin(1);assert.equal(run.preferences.manualCaptchaAssist,false);assert.equal(run.preferences.autoCaptcha,true);
  assert.match((await api.autoLoop(run)).message,/예매하기|가격\/할인|HTTP 승인/);
  assert.equal(calls.some(c=>c.fn==='manualCaptcha.manualCaptchaPrepare'),false);
  assert.equal(calls.filter(c=>c.ocr).length,1);assert.equal(calls.filter(c=>c.fn==='captcha.captchaSubmit').length,1);
});

test('old extension explains manual update without sending unsupported commands',async()=>{
  const {api,context,calls}=manualFixture();context.bridgeState={manualCaptchaSupported:false};
  await assert.rejects(api.command('manualCaptchaPrepare'),/v0.9.3/);assert.equal(calls.length,0);
});

test('booking rejection returns to seats, clears only owned seats and requests another search',async()=>{
const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat?step=price'})]);const run=api.begin(1);run.priceOwnedIds=['A'];let selected=['A'],dialog={kind:'empty-selection',dismissible:true,text:'구매하실 좌석을 선택하세요.'},back=0;
context.invoke=(fn)=>{switch(fn.name){case 'proceedBooking':return {dispatched:true};case 'bookingProgress':return {blocked:true};case 'scene':return {selected:[...selected],dialog,busy:false,completed:false};case 'dismissEmptySelection':dialog=null;return true;case 'returnToSeats':back++;api.current().url='https://tickets.interpark.com/onestop/seat';return {returned:true};case 'deselect':selected=[];return true;default:throw Error('Unexpected '+fn.name);}};
context.priceInvoke=context.invoke;const result=await api.finishBookingButton(api.current(),run,{completed:true});assert.equal(result.completed,false);assert.equal(result.retrySeats,true);assert.equal(back,1);assert.deepEqual(selected,[]);assert.ok(run.excludedGroups.has(JSON.stringify(['A'])));assert.equal(calls.filter(c=>c.fn?.name==='proceedBooking').length,1);
});
test('unrecognized booking modal never unlocks or resends booking',async()=>{const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat?step=price'})]);const run=api.begin(1);context.invoke=fn=>fn.name==='proceedBooking'?{dispatched:true}:fn.name==='bookingProgress'?{blocked:true,message:'로그인 만료'}:{dialog:{kind:'unknown',text:'로그인 만료'}};context.priceInvoke=context.invoke;await assert.rejects(api.finishBookingButton(api.current(),run,{}),/로그인 만료/);assert.equal(calls.filter(c=>c.fn?.name==='proceedBooking').length,1);assert.equal(calls.some(c=>c.fn?.name==='returnToSeats'),false);});

test('an initial empty-seat notice resumes after dismissal instead of ending the run',async()=>{const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);let rejected=true;context.invoke=fn=>{if(fn.name==='scene')return {completed:!rejected,busy:false,selected:[],buttons:[],grades:[],dialog:rejected?{kind:'empty-selection',dismissible:true}:null};if(fn.name==='dismissEmptySelection'){rejected=false;return true;}throw Error('Unexpected '+fn.name);};assert.equal((await api.autoLoop(run)).bookingAdvanced,true);assert.equal(calls.filter(c=>c.fn?.name==='dismissEmptySelection').length,1);});

test('acknowledged notice document replacement clears hydration flags for the new seat map',()=>{
  const {api}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1),wc=api.current();
  const version=api.scopeVersions.get(1);run.seatScope={id:1,version};run.noticeTransition={id:1,documentId:wc.documentId,version,url:wc.getURL(),started:Date.now()};
  run.detailsReadBlocks=new Set(['001:101']);run.detailsReadGrades=true;run.triedJobs.add('old-grade');run.gradePlanObserved=true;run.inspectCurrentMap=true;run.currentMapChecked=true;
  api.onDocument({tabId:1,documentId:'notice-replacement'});api.followNoticeDocument(run,wc);
  assert.equal(run.detailsReadBlocks.size,0);assert.equal(run.detailsReadGrades,false);assert.equal(run.triedJobs.size,0);assert.equal(run.seatScope.version,api.scopeVersions.get(1));
  assert.equal(run.gradePlanObserved,false);assert.equal(run.inspectCurrentMap,false);assert.equal(run.currentMapChecked,false);
});
test('a grade list visible under a loading mask waits without sending a grade or seat action',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);let scenes=0;
  context.invoke=fn=>{if(fn.name==='scene')return {completed:scenes++>0,captcha:false,busy:scenes===1,selected:[],buttons:[],grades:[{name:'일반석',count:1}]};throw Error('Unexpected action '+fn.name);};
  const result=await api.autoLoop(api.begin(1));assert.equal(result.bookingAdvanced,true);assert.equal(calls.some(c=>c.fn?.name==='liveRead'||c.fn?.name==='readDetails'),false);
});

test('conflicting global grade labels remove stale mappings while seat-specific labels remain usable',()=>{
 const {api,context}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);api.gradeStores.get(1).set('1','old');
 api.applyGradeDetails(api.current(),{grades:[{code:'2',name:'일반석'}],gradeConflicts:[{code:'1',names:['일반석','시야방해석']}]},run);
 assert.equal(api.gradeStores.get(1).get('1'),null);assert.equal(api.gradeStores.get(1).get('2'),'일반석');assert.equal(run.gradeConflicts.size,1);
 assert.ok(context.logs.some(e=>e.body.includes('grade-names')&&e.body.includes('시야방해석')));
 const {enrich}=require('../src/metadata');const result=enrich([{id:'s',available:true}],new Map([['s',{gradeCode:'1',grade:'일반석',exposable:true}]]),api.gradeStores.get(1));assert.equal(result[0].grade,'일반석');
});

test('HTTP transaction never falls back to legacy price controls on a malformed or uncertain reply',async()=>{
  for(const reply of [{},{stage:'preselect',status:'uncertain',code:'HTTP_OUTCOME_UNKNOWN',requestCount:3,heldCount:0}]){
    const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
    context.httpInvoke=(fn,arg)=>fn.name==='httpBookingNavigate'?{supported:true}:reply;
    await assert.rejects(api.runHttpBooking(api.current(),run,{seats:[]}),/중지|멈췄/);
    assert.equal(calls.filter(c=>c.fn?.name==='httpBookingAction').length,1);
    assert.equal(calls.some(c=>['adultPriceStep','proceedBooking','clickKnown'].includes(c.fn?.name)),false);
  }
});
test('lost navigation acknowledgement is observed once without resending the HTTP transaction',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  context.httpInvoke=(fn,arg)=>{if(fn.name==='httpBookingNavigate'){if(arg.checkOnly)return {supported:true};throw Error('document replaced');}return {stage:'ready',status:'pending',requestCount:6,heldCount:2,confirmed:true,validated:true};};
  const result=await api.runHttpBooking(api.current(),run,{seats:[]});assert.equal(result.bookingAdvanced,true);
  assert.equal(calls.filter(c=>c.fn?.name==='httpBookingNavigate'&&!c.arg.checkOnly).length,1);assert.equal(calls.filter(c=>c.fn?.name==='httpBookingAction').length,1);
});
test('HTTP standard-price assessment is recorded once across repeated status replies',async()=>{
  const {api,context}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);let step=0;
  const priceAssessment={groups:[{seatGrade:'1',seatCount:2,selectedIndex:0,options:[{index:0,priceGrade:'01',pgCode:'00',priceGradeName:'일반',discountName:'예매가',amount:35000,eligible:true,reasons:[],sessionId:'private-session'}]}],headers:{Cookie:'private-cookie'}};
  context.httpInvoke=(fn,arg)=>{
    if(fn.name==='httpBookingNavigate')return arg.checkOnly?{supported:true}:{dispatched:true};
    return {stage:['prices','status','ready'][Math.min(step++,2)],status:'pending',requestCount:step,heldCount:step===3?2:0,priceAssessment};
  };
  const result=await api.runHttpBooking(api.current(),run,{seats:[]});
  assert.equal(result.standardPriceSelected,true);assert.match(result.message,/일반 가격/);assert.equal('adultPriceSelected' in result,false);
  const events=context.logs.map(line=>JSON.parse(line.body)).filter(event=>event.event==='price-selection');
  assert.equal(events.length,1);assert.equal(events[0].priceAssessment.groups[0].selectedIndex,0);assert.doesNotMatch(JSON.stringify(events),/private|headers|sessionId/);
});
test('An unavailable standard price logs its exclusion reasons before returning a clear failure',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  context.httpInvoke=fn=>fn.name==='httpBookingNavigate'?{supported:true}:{stage:'rejected',status:'blocked',code:'STANDARD_PRICE_UNAVAILABLE',httpStatus:200,requestCount:2,heldCount:0,priceAssessment:{groups:[{seatGrade:'30',seatCount:1,selectedIndex:null,options:[{index:0,priceGrade:'02',priceGradeName:'자격 가격',eligible:false,reasons:['certification-required']}]}]}};
  await assert.rejects(api.runHttpBooking(api.current(),run,{seats:[]}),/자동 적용할 수 있는 일반 가격이 없습니다/);
  const events=context.logs.map(line=>JSON.parse(line.body)),price=events.find(event=>event.event==='price-selection');
  assert.deepEqual(price.priceAssessment.groups[0].options[0].reasons,['certification-required']);
  assert.equal(events.filter(event=>event.event==='price-selection').length,1);
  assert.equal(calls.filter(call=>call.fn?.name==='httpBookingAction').length,1);
});

const qualificationOnlyReply=(reasons=['PRICE_REQUIRES_QUALIFICATION'])=>({stage:'rejected',status:'blocked',code:'STANDARD_PRICE_UNAVAILABLE',httpStatus:200,requestCount:2,heldCount:0,priceAssessment:{groups:[{seatGrade:'30',seatCount:1,selectedIndex:null,options:[{index:0,priceGrade:'02',priceGradeName:'장애인',eligible:false,reasons}]}]}});
test('qualification-only prices skip that grade before any hold and preserve the exact assessment in logs',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  context.httpInvoke=fn=>fn.name==='httpBookingNavigate'?{supported:true}:qualificationOnlyReply();
  const result=await api.runHttpBooking(api.current(),run,{seats:[{id:'wheelchair',gradeCode:'30'}]});
  assert.equal(result.priceUnavailable,true);assert.deepEqual([...result.unavailableGrades],['30']);assert.equal(result.completed,false);
  const events=context.logs.map(line=>JSON.parse(line.body));assert.equal(events.filter(event=>event.event==='price-selection').length,1);
  const skipped=events.find(event=>event.event==='seat-price-unavailable');assert.equal(skipped.reason,'qualification-only-prices');assert.equal(skipped.priceAssessment.groups[0].options[0].priceGradeName,'장애인');
  assert.equal(calls.filter(call=>call.fn?.name==='httpBookingAction').length,1);
});
test('a disqualified grade is skipped for the remaining candidates while a different ordinary grade completes',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1);
  context.httpInvoke=(fn,arg)=>fn.name==='httpBookingNavigate'?arg.checkOnly?{supported:true}:{dispatched:true}:arg.seats[0].gradeCode==='30'?qualificationOnlyReply():{stage:'ready',status:'pending',requestCount:6,heldCount:2,confirmed:true,validated:true};
  const result=await api.selectCandidates(api.current(),run,[{seats:[{id:'w1',gradeCode:'30'}]},{seats:[{id:'w2',gradeCode:'30'}]},{seats:[{id:'normal',gradeCode:'1'}]}]);
  assert.equal(result.completed,true);assert.equal(result.attempted,2);assert.ok(run.priceExcludedGrades.has('30'));
  const attempts=calls.filter(call=>call.fn?.name==='httpBookingAction');assert.deepEqual(attempts.map(call=>call.arg.seats[0].id),['w1','normal']);
});
test('mixed-grade price rejection excludes only the unavailable grade and keeps ranked ordinary seats across maps',async()=>{
  const {api,context}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1),reply=qualificationOnlyReply();
  reply.priceAssessment.groups.unshift({seatGrade:'1',seatCount:1,selectedIndex:0,options:[{index:0,priceGrade:'01',priceGradeName:'예매가',eligible:true,reasons:[]}]});
  context.httpInvoke=fn=>fn.name==='httpBookingNavigate'?{supported:true}:reply;
  const result=await api.runHttpBooking(api.current(),run,{seats:[{id:'first',gradeCode:'1'},{id:'restricted',gradeCode:'30'}]});assert.deepEqual([...result.unavailableGrades],['30']);
  run.priceExcludedGrades=new Set(result.unavailableGrades);
  run.preferences=require('../src/preferences').normalizePreferences({quantity:2,requireTogether:false,fallbackAnywhere:false,tiers:[{areas:['1']},{areas:['2']},{areas:['30']}]});
  const row=(id,gradeCode,block)=>({kind:'seat',id,gradeCode,grade:'구역'+gradeCode,block,row:1,number:1,colIdx:0,segment:block,available:true,obstructed:false,aisle:true});
  run.currentJob={name:'first-map',tierIndex:0};assert.equal(api.rankRunSeats(run,api.current(),[row('first','1','101')]).length,0);
  run.currentJob={name:'second-map',tierIndex:2};const ranked=api.rankRunSeats(run,api.current(),[row('restricted','30','102'),row('second','2','103')]);
  assert.equal(ranked.length,1);assert.deepEqual(ranked[0].seats.map(seat=>seat.id).sort(),['first','second']);assert.deepEqual(ranked[0].tierCounts,[1,1,0]);
});
test('unknown or quantity-only prices, existing holds and resumed price steps still stop without another transaction',async()=>{
  for(const fixture of [{reasons:['PRICE_QUANTITY_LIMIT']},{reasons:['PRICE_REQUIRES_QUALIFICATION','PRICE_RECORD_INVALID']},{reasons:['PRICE_REQUIRES_QUALIFICATION','PRICE_AMOUNT_INVALID']},{heldCount:1},{resumePrice:true},{resumeSelected:true},{missingOptions:true},{mismatchedCount:true},{missingGrade:true},{duplicateGrade:true}]){
    const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);const run=api.begin(1),reply=qualificationOnlyReply(fixture.reasons);
    if(fixture.heldCount)reply.heldCount=fixture.heldCount;if(fixture.missingOptions)reply.priceAssessment.groups[0].options=[];
    if(fixture.mismatchedCount)reply.priceAssessment.groups[0].seatCount=2;if(fixture.duplicateGrade)reply.priceAssessment.groups.push({...reply.priceAssessment.groups[0]});
    context.httpInvoke=fn=>fn.name==='httpBookingNavigate'?{supported:true}:reply;
    await assert.rejects(api.runHttpBooking(api.current(),run,{seats:[{id:'wheelchair',gradeCode:'30'},...(fixture.missingGrade?[{id:'normal',gradeCode:'1'}]:[])],resumePrice:fixture.resumePrice,resumeSelected:fixture.resumeSelected}),/자동 적용할 수 있는 일반 가격이 없습니다/);
    assert.equal(calls.filter(call=>call.fn?.name==='httpBookingAction').length,1);assert.equal(context.logs.map(line=>JSON.parse(line.body)).some(event=>event.event==='seat-price-unavailable'),false);
  }
});


test('starting on a countdown gate preserves the supplied schedule and arms conditional HTTP',async()=>{
  const {api,context}=setup();api.trackTabs([gate(1)]);const opening=Date.now()+120000;
  context.bridgeState={extensionVersion:'0.9.28'};
  context.invoke=(fn,arg)=>{
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',prepared:true,enabled:false};
    if(fn==='gateState')return null;
    if(fn?.name==='armGate'){assert.equal(arg.httpRetry,true);assert.equal(api.runs.current.openAt,opening);throw Error('FIXTURE_ARMED');}
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  await api.command('start',{entryStrategy:'clock',openAt:opening});const run=api.runs.current;
  await assert.rejects(run.task,/FIXTURE_ARMED/);assert.equal(run.openAt,opening);assert.equal(run.clockEligible,true);
});
test('conditional entry refuses an extension without the new HTTP runtime',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);context.bridgeState={extensionVersion:'0.9.18'};
  await assert.rejects(api.command('start',{entryStrategy:'clock',openAt:Date.now()+10000}),/v0.9.28/);assert.equal(calls.length,0);
});

test('listing start waits through disabled states and follows activation to the seat route exactly once',async()=>{
  const {api,context,calls}=setup(),listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});
  api.trackTabs([listing]);let stateReads=0,armed;
  context.invoke=(fn,arg)=>{
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='armListing'){armed={phase:'armed',runId:arg.runId,key:arg.key,documentId:'listing-doc',clock:{outcome:'not-configured'}};assert.equal(arg.clockRequired,false);return armed;}
    if(fn?.name==='listingState'){
      if(++stateReads===1){api.runs.current.started=Date.now()-180000;api.runs.current.openAt=Date.now()-180000;return armed;}
      if(stateReads===2)return {...armed,phase:'clicked',invokeDelayMs:0.3};
      api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'seat-document'})]);return null;
    }
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  await api.command('start',{key:'wanted',inspectionOnly:true});const run=api.runs.current;await run.task;
  assert.equal(stateReads,3);assert.equal(calls.filter(c=>c.fn?.name==='armListing').length,1);
  assert.equal(calls.some(c=>c.fn?.name==='prepareEntry'),false);
  assert.equal(api.last().entry.startPage,'listing');assert.equal(api.last().entry.preparationConfirmed,true);
  assert.equal(api.last().entry.listingInvokeDelayMs,0.3);assert.equal(api.last().entry.seatPageObserved,true);
});

for(const failure of ['blocked','stopped','missing','reloaded'])test(`listing ${failure} ends the run without installing a second observer`,async()=>{
  const {api,context,calls}=setup(),listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});api.trackTabs([listing]);let armed;
  context.invoke=(fn,arg)=>{
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='armListing')return armed={phase:'armed',runId:arg.runId,key:arg.key,documentId:'listing-doc',clock:{outcome:'not-configured'}};
    if(fn?.name==='listingState'){
      if(failure==='reloaded'){api.trackTabs([{...listing,documentId:'reloaded-document'}]);return armed;}
      return failure==='missing'?null:{...armed,phase:failure,reason:'fixture listing stopped'};
    }
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  await api.command('start',{key:'wanted',inspectionOnly:true});const run=api.runs.current;await assert.rejects(run.task,/fixture listing stopped|감시가 사라|다시 로드/);
  assert.equal(calls.filter(c=>c.fn?.name==='armListing').length,1);assert.equal(api.last().entry.seatPageObserved,false);
});

test('scheduled listing start prepares the verified gate without waiting for listing button activation',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'})]);const opening=Date.now()+120000;
  context.invoke=(fn,arg)=>{
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='prepareScheduledGate'){assert.equal(arg.key,'wanted');assert.equal(arg.goodsCode,'26005452');assert.equal(arg.placeCode,'25001730');assert.equal(api.runs.current.openAt,opening);throw Error('FIXTURE_GATE_PREPARATION');}
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  await api.command('start',{key:'wanted',entryStrategy:'clock',openAt:opening});const run=api.runs.current;await assert.rejects(run.task,/FIXTURE_GATE_PREPARATION/);
  assert.equal(calls.filter(c=>c.fn?.name==='armListing').length,0);assert.equal(calls.filter(c=>c.fn?.name==='prepareScheduledGate').length,1);
});
test('scheduled listing start refuses an unknown opening time instead of silently using activation mode',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'})]);
  context.invoke=fn=>fn?.name==='gameCards'?[{key:'wanted',schedule:''}]:{};
  await api.command('start',{key:'wanted',entryStrategy:'clock'});const run=api.runs.current;
  await assert.rejects(run.task,/예매 시작 시각을 확인하지 못했습니다/);
  assert.equal(calls.some(call=>['armListing','prepareScheduledGate'].includes(call.fn?.name)),false);
});

test('a clock sample is installed once per listing or gate document, including a listing-to-gate transition',async()=>{
  const {api,context,calls}=setup(),{performance}=require('node:perf_hooks');
  api.trackTabs([gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'})]);const run=api.begin(1);
  const mono=performance.now(),epoch=Date.now();Object.assign(run,{game:{key:'wanted'},goodsCode:'26005452',openAt:epoch+10000,clockEligible:true,lastClockRefresh:mono});run.entry.strategy='clock';
  api.setClock({source:'ticket-server',anchorMonoMs:mono,serverEpochAtAnchorMs:epoch,rttMs:10,uncertaintyMs:6});let documentId='listing-clock';
  context.invoke=(fn,arg)=>{
    if(fn==='pageClock'){assert.equal(arg?.entryStage,documentId==='listing-clock'?'listing':undefined);return {pageMono:performance.now(),documentId};}
    if(fn?.name==='setListingClock'){assert.equal(arg.key,'wanted');assert.equal(arg.documentId,documentId);return true;}
    if(fn?.name==='setGateClock'){assert.equal(arg.goodsCode,'26005452');assert.equal(arg.documentId,documentId);return true;}
    throw Error('Unexpected '+(fn?.name||fn));
  };
  let status={phase:'armed',documentId,clock:{outcome:'not-configured'}};
  await api.scheduleGateClock(run,api.current(),status,{listing:true});await api.scheduleGateClock(run,api.current(),status,{listing:true});
  documentId='gate-clock';api.trackTabs([gate(1,{documentId:'gate-document'})]);status={...status,documentId};
  await api.scheduleGateClock(run,api.current(),status);await api.scheduleGateClock(run,api.current(),status);
  assert.equal(calls.filter(c=>c.fn?.name==='setListingClock').length,1);assert.equal(calls.filter(c=>c.fn?.name==='setGateClock').length,1);
});

for(const interruption of ['none','returned','nested'])test(`adopting a ${interruption} popup preserves the parent-listing stop barrier`,async()=>{
  const {api,context,calls}=setup(),parent=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});api.trackTabs([parent]);
  const run=api.begin(1);run.game={key:'wanted'};run.entryActionsStarted=true;run.entry.listingPhase='armed';api.pinListingDocument(run,api.current());let release;
  context.invoke=(fn,arg)=>{
    if(fn?.name==='stopListing'){assert.equal(arg.runId,run.id);assert.equal(arg.key,'wanted');return new Promise(resolve=>release=resolve);}
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  api.trackTabs([parent,gate(2,{openerTabId:1,documentId:'popup-document'})]);await Promise.resolve();
  api.onDocument({tabId:2,documentId:'popup-document'});
  assert.equal(run.targetId,2);assert.ok(run.observerTask);
  assert.equal(calls.some(c=>c.action==='network.attach'&&c.tabId===2),false);
  assert.equal(calls.some(c=>c.fn?.name==='armGate'),false);
  let targetId=2;
  if(interruption==='returned'){api.trackTabs([parent]);api.trackTabs([parent,gate(2,{openerTabId:1,documentId:'popup-document'})]);}
  if(interruption==='nested'){api.trackTabs([parent,gate(2,{openerTabId:1,documentId:'popup-document'}),gate(3,{openerTabId:2,documentId:'nested-document'})]);targetId=3;}
  await Promise.resolve();await Promise.resolve();
  assert.ok(run.observerTask);assert.equal(calls.some(c=>c.action==='network.attach'),false);
  release({stopped:true});await run.observerTask;
  assert.equal(calls.filter(c=>c.fn?.name==='stopListing'&&c.id===1).length,1);
  assert.equal(calls.filter(c=>c.action==='network.attach'&&c.tabId===targetId).length,interruption==='returned'?2:1);
  if(interruption==='nested')assert.equal(calls.some(c=>c.action==='network.attach'&&c.tabId===2),false);
});

test('a missing parent-listing stop acknowledgement cancels instead of starting the popup',async()=>{
  const {api,context,calls}=setup(),parent=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});api.trackTabs([parent]);
  const run=api.begin(1);run.game={key:'wanted'};run.entryActionsStarted=true;api.pinListingDocument(run,api.current());
  context.invoke=fn=>fn?.name==='stopListing'?{stopped:false}:true;
  api.trackTabs([parent,gate(2,{openerTabId:1})]);const barrier=run.observerTask;await assert.rejects(barrier,/감시 중지/);await api.stopRun();
  assert.equal(run.signal.aborted,true);assert.equal(calls.some(c=>c.action==='network.attach'&&c.tabId===2),false);
  assert.equal(calls.some(c=>c.fn?.name==='armGate'),false);
});

for(const transition of ['navigate','reload'])test(`listing clock invocation handles ${transition} without replay`,async()=>{
  const {api,context,calls}=setup(),{performance}=require('node:perf_hooks'),listing=gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'});api.trackTabs([listing]);
  const run=api.begin(1),mono=performance.now(),epoch=Date.now();Object.assign(run,{game:{key:'wanted'},goodsCode:'26005452',openAt:epoch,clockEligible:true,lastClockRefresh:mono});run.entry.strategy='clock';
  api.setClock({source:'ticket-server',anchorMonoMs:mono,serverEpochAtAnchorMs:epoch,rttMs:10,uncertaintyMs:6});
  context.invoke=(fn)=>{
    if(fn==='pageClock')return {pageMono:performance.now(),documentId:'listing-clock'};
    if(fn?.name==='setListingClock'){
      api.trackTabs([transition==='navigate'?gate(1,{url:'https://tickets.interpark.com/onestop/seat',documentId:'new-document'}):{...listing,documentId:'new-document'}]);
      throw Error('페이지가 바뀌어 이전 화면의 동작을 취소했습니다.');
    }
    throw Error('Unexpected '+(fn?.name||fn));
  };
  const task=api.scheduleGateClock(run,api.current(),{phase:'armed',documentId:'listing-clock',clock:{outcome:'not-configured'}},{listing:true});
  if(transition==='navigate'){await task;assert.equal(run.entry.listingPhase,'transition-unconfirmed');}
  else await assert.rejects(task,/페이지가 바뀌어/);
  assert.equal(calls.filter(c=>c.fn?.name==='setListingClock').length,1);
});

for(const listing of [false,true])test(`an expired ${listing?'listing':'gate'} clock can receive a fresh sample after its previous deadline fired`,async()=>{
  const {api,context,calls}=setup(),{performance}=require('node:perf_hooks');api.trackTabs([listing?gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'}):gate(1)]);
  const run=api.begin(1),mono=performance.now(),epoch=Date.now();Object.assign(run,{game:{key:'wanted'},openAt:epoch-1000,clockEligible:true,lastClockRefresh:mono});run.entry.strategy='clock';
  api.setClock({source:'ticket-server',anchorMonoMs:mono,serverEpochAtAnchorMs:epoch,rttMs:10,uncertaintyMs:6});
  const action=listing?'setListingClock':'setGateClock';
  context.invoke=fn=>fn==='pageClock'?{pageMono:performance.now(),documentId:'listing-clock'}:fn?.name===action;
  await api.scheduleGateClock(run,api.current(),{phase:'armed',documentId:'listing-clock',clock:{outcome:'stale',firedAtMono:1}},{listing});
  assert.equal(calls.filter(c=>c.fn?.name===action).length,1);
});

for(const lostReply of [false,true])test(`saved scheduled mode follows SSO and partner preparation once with ${lostReply?'lost':'confirmed'} dispatch reply`,async()=>{
  const {api,context,calls}=setup({savedDesktop:{entryStrategy:'clock',entryOffsetMs:-75}});
  api.trackTabs([gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'})]);
  context.invoke=(fn,arg)=>{
    if(fn?.name==='gameCards')return [{key:'wanted',schedule:''}];
    if(fn?.name==='prepareScheduledGate'){
      assert.equal(arg.placeCode,'25001730');
      const navigate=()=>api.trackTabs([gate(1,{url:'https://sso.yanolja.com/sso/v1/bridge/token',documentId:'sso-document'})]);
      if(lostReply)setTimeout(navigate,5);else navigate();
      setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/gates/partner',documentId:'partner-document'})]),35);
      setTimeout(()=>api.trackTabs([gate(1,{documentId:'prepared-gate-document'})]),150);
      if(lostReply)throw Error('사이트 코드 실행 결과를 확인하지 못했습니다. 같은 동작을 반복하지 않습니다.');
      return {dispatched:true};
    }
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:false}};
    if(fn==='gateState')return null;
    if(fn?.name==='armGate'){
      assert.equal(arg.httpRetry,true);assert.equal(api.runs.current.entry.offsetMs,-75);
      assert.ok(calls.filter(c=>c.action==='network.attach').length>=2);
      throw Error('FIXTURE_SCHEDULED_GATE_READY');
    }
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  await api.command('start',{key:'wanted',openAt:Date.now()+120000});const run=api.runs.current;
  await assert.rejects(run.task,/FIXTURE_SCHEDULED_GATE_READY/);
  assert.equal(calls.filter(c=>c.fn?.name==='prepareScheduledGate').length,1);
  assert.equal(calls.filter(c=>c.fn?.name==='armGate').length,1);
  assert.equal(calls.some(c=>c.fn?.name==='armListing'),false);
  assert.equal(calls.some(c=>c.write?.endsWith('settings.json')),false);
});

test('scheduled preparation tolerates an omitted SSO tab for 45 seconds and reconnects before arming',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'})]);
  const run=api.begin(1);Object.assign(run,{listingPreparationSent:true,listingDispatchedAt:Date.now()-20000,clockEligible:true,openAt:Date.now()+10000,goodsCode:'26005452',entryActionsStarted:true});run.entry.strategy='clock';
  api.onBrowserEvent({type:'entry',tabId:1,event:{kind:'observer-lost',reason:'manual-detach'}});
  assert.equal(run.signal.aborted,false);assert.equal(run.entry.observerLost,undefined);
  api.trackTabs([]);api.targets.get(1).missingSince=Date.now()-20000;
  context.invoke=fn=>{
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:false}};
    if(fn==='gateState')return null;
    if(fn?.name==='armGate'){assert.ok(calls.some(c=>c.action==='network.attach'));throw Error('FIXTURE_RECONNECTED');}
    if(fn==='stopWatchers')return true;
    throw Error('Unexpected '+(fn?.name||fn));
  };
  setTimeout(()=>{api.trackTabs([gate(1,{documentId:'prepared-gate-document'})]);api.onDocument({tabId:1,documentId:'prepared-gate-document'});},10);
  await assert.rejects(api.autoLoop(run),/FIXTURE_RECONNECTED/);
  assert.equal(calls.filter(c=>c.fn?.name==='armGate').length,1);
  assert.equal(run.preparationNetworkReady,true);
});

test('scheduled preparation timeout never retries navigation or entry',async()=>{
  const {api,calls}=setup();api.trackTabs([gate(1,{url:'https://nol.yanolja.com/ticket/genre/sports/postseason'})]);
  const run=api.begin(1);Object.assign(run,{listingPreparationSent:true,listingDispatchedAt:Date.now()-46000});
  api.trackTabs([]);api.targets.get(1).missingSince=Date.now()-46000;
  await assert.rejects(api.autoLoop(run),/45초.*로그인.*다시 시작/);
  assert.equal(calls.length,0);
});

for(const failure of ['페이지가 바뀌어 이전 화면의 동작을 취소했습니다.',lostCodeResult])test(`scheduled clock dispatch observes navigation without replay after ${failure}`,async()=>{
  const {api,context,calls}=setup(),{performance}=require('node:perf_hooks');api.trackTabs([gate(1)]);
  const run=api.begin(1),mono=performance.now(),epoch=Date.now();Object.assign(run,{goodsCode:'26005452',openAt:epoch-10,clockEligible:true,lastClockRefresh:mono});run.entry.strategy='clock';
  api.setClock({source:'ticket-server',anchorMonoMs:mono,serverEpochAtAnchorMs:epoch,rttMs:10,uncertaintyMs:6});
  context.invoke=fn=>{
    if(fn==='pageClock')return {pageMono:performance.now(),documentId:'gate-clock'};
    if(fn?.name==='setGateClock'){
      setTimeout(()=>api.trackTabs([gate(1,{url:'https://tickets.interpark.com/waiting',documentId:'queue-document'})]),5);
      throw Error(failure);
    }
    throw Error('Unexpected '+(fn?.name||fn));
  };
  await api.scheduleGateClock(run,api.current(),{phase:'armed',documentId:'gate-clock',clock:{outcome:'not-configured'}});
  assert.equal(calls.filter(c=>c.fn?.name==='setGateClock').length,1);
});

test('request completion refreshes previously missing deadline timing without an entry mutation',async()=>{
  const {api,context,calls}=setup();api.trackTabs([gate(1)]);const run=api.begin(1);run.entryRequests.add('1:1');run.entry.requestCount=1;
  api.rememberGate(run,{runId:run.id,attempts:1,invokeDelayMs:0.5});
  context.invoke=fn=>{assert.equal(fn,'gateState');return {runId:run.id,attempts:1,invokeDelayMs:0.5,requestDelayMs:1.5,requestDeadlineDelayMs:2.25,clock:{outcome:'clicked',delayMs:0.75}};};
  api.onBrowserEvent({type:'entry',tabId:1,event:{kind:'finished',seq:1,outcome:'redirect-ready',code:'VALID_REDIRECT',status:200}});
  await new Promise(resolve=>setTimeout(resolve,0));
  const events=context.logs.map(line=>JSON.parse(line.body));
  assert.ok(events.some(e=>e.event==='entry-trigger'&&e.requestDeadlineDelayMs===2.25));
  assert.equal(calls.filter(c=>c.fn==='gateState').length,1);
  assert.equal(calls.some(c=>c.fn?.name==='armGate'||c.fn?.name==='noteGateRequest'),false);
});

test('live validation controls are rejected before starting a normal desktop run',async()=>{
  const {api,calls}=setup();api.trackTabs([gate(1,{url:'https://tickets.interpark.com/onestop/seat'})]);
  await assert.rejects(api.command('start',{validationExpectedBooking:{goodsCode:'26005452',placeCode:'25001730',playSeq:'001'}}),/명시적으로 실행한 검증 모드/);
  assert.equal(api.runs.current,null);assert.equal(calls.length,0);
});
