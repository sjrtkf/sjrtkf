'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {parseMetadata}=require('../src/metadata');

// Exercise real main orchestration, ChromeTarget action mapping, metadata
// enrichment, ranking and selection/completion coordinators together. Only
// the Chrome/HTTP boundary is a fixture; no site, browser, OCR or seat hold runs.
function seatFlowFixture({rowNo='1',delayedMapReads=0,blankMapReads=0,startWithMap=false,mapSidebarCount=null,emptyMapReads=0}={}){
  const filename=path.resolve(__dirname,'../src/chrome-main.js'),load=createRequire(filename);
  const source=fs.readFileSync(filename,'utf8').split('app.whenReady().then')[0];
  const grade='본부석-중앙(W4~W5)',tab={id:1,title:'Synthetic sports fixture',url:'https://tickets.interpark.com/onestop/seat',documentId:'fixture-document'};
  const preferences={quantity:2,areas:[grade],blocks:['W4'],requireTogether:true,excludeObstructed:true,autoComplete:true,autoCaptcha:false,manualCaptchaAssist:false};
  const rawMetadata=[{blockKey:'001:W4',seats:[0,1,5].map((colIdx,index)=>({
    seatInfoId:'fixture-'+(index+1),rowIdx:0,colIdx,rowNo,seatNo:String(index+1),seatGrade:'W',isExposable:true,seatGroupId:null,
  }))}];
  const metadata=parseMetadata(rawMetadata),byId=new Map(metadata.map(row=>[row.id,row]));
  const geometry=metadata.map((row,index)=>({kind:'seat',id:row.id,label:'지도 후보 '+(index+1),available:true,group:'001:W4',fill:'#f00',cx:String(index*10),cy:'10'}));
  const trace=[],selected=[],selectedActions=[],network={healthy:true,sequence:0,pending:[],results:[]};
  let phase='grades',api,acknowledge=null,completionCount=0,directMapCount=0,remainingMapReads=delayedMapReads,remainingBlankReads=blankMapReads,remainingEmptyReads=emptyMapReads,unchangedMapReads=0,boundaryCalls=0;
  function showMap(){
    phase='map';
    // Geometry carries no row/number/grade. The real metadata join must supply
    // those, including the grade-name mapping and physical adjacency.
    api.onBrowserEvent({type:'metadata',tabId:tab.id,documentId:tab.documentId,rows:metadata});
    api.onBrowserEvent({type:'grades',tabId:tab.id,documentId:tab.documentId,rows:[{code:'W',name:grade}]});
  }
  const snapshot=()=>{
    const current=structuredClone(network);
    // The visible selection is optimistic. The next read initially sees the
    // pending request; confirmation arrives separately, after that read.
    if(acknowledge){const done=acknowledge;acknowledge=null;queueMicrotask(done);}
    return current;
  };
  function pending(kind,seatIds,onAck){
    assert.equal(network.pending.length,0,'a later mutation must wait for the previous acknowledgement');
    const seq=++network.sequence;network.pending=[{seq,kind,seatIds}];
    acknowledge=()=>{network.pending=[];network.results.push({seq,kind,seatIds,status:'ok'});trace.push(kind+'-ack');onAck?.();};
  }
  const bridge={getState:()=>({connected:true}),request:async command=>{
    if(command.action==='directApi.bookingIdentity')return {goodsCode:'26005452',placeCode:'25001730',playSeq:'001'};
    assert.ok(++boundaryCalls<150,'fixture must not spin indefinitely after an unhandled screen');
    const {action,arg,tabId,documentId}=command;
    assert.equal(tabId,tab.id);
    if(documentId)assert.equal(documentId,tab.documentId);
    if(action==='network.attach'){trace.push('observer-ready');return snapshot();}
    if(action==='network.snapshot')return snapshot();
    if(action==='httpBooking.httpBookingAction'){
      if(arg.action==='begin'){
        assert.equal(phase,'map');assert.equal(arg.quantity,2);
        for(const seat of arg.seats){assert.equal(seat.grade,grade);assert.equal(seat.row,1);assert.equal(seat.block,'W4');selectedActions.push(seat);}
        trace.push('http-begin');return {stage:'metadata',status:'pending',requestCount:0,heldCount:0};
      }
      assert.equal(arg.action,'step');completionCount++;trace.push('http-approved');
      return {stage:'ready',status:'pending',requestCount:6,heldCount:2,confirmed:true,validated:true};
    }
    if(action==='httpBooking.httpBookingNavigate'){
      if(arg.checkOnly)return {supported:true};
      assert.equal(completionCount,1);trace.push('validated-navigation');phase='payment';return {dispatched:true};
    }
    if(action==='pricePage.bookingProgress')return {ready:phase==='payment'};
    if(action==='flow.scene'){
      let loading=false;
      if(phase==='choice'&&directMapCount){
        if(remainingBlankReads>0){remainingBlankReads--;loading=true;}
        else if(remainingMapReads>0){remainingMapReads--;unchangedMapReads++;}else showMap();
      }
      return {
      completed:phase==='price',busy:network.pending.length>0,captcha:false,dialog:null,notice:{present:false,enabled:false},
      selected:[...selected],selectedGrades:selected.map(()=>grade),
      selectedNames:selected.map(id=>{const s=byId.get(id);return `${s.block}블럭 ${s.rowLabel??s.row}열 ${s.number}번`;}),
      grades:phase==='grades'?[{name:grade,count:3}]:phase==='map'&&mapSidebarCount!=null?[{name:grade,count:mapSidebarCount}]:[],hasSeats:phase==='map'||phase==='completing',
      buttons:loading?[]:phase==='choice'?[{label:'자동 배정받기',enabled:true},{label:'직접 좌석 선택하기',enabled:true}]:phase==='map'?[{label:'선택 완료',enabled:selected.length===2},{label:'좌석도 전체보기',enabled:true}]:[],
      };
    }
    if(action==='live.liveRead'){
      if(phase==='grades')return {rows:[{kind:'grade',id:grade,name:grade,count:'3',available:true,label:grade}]};
      assert.equal(phase,'map');trace.push('geometry-read');
      const empty=remainingEmptyReads>0;if(empty)remainingEmptyReads--;
      return {rows:[...geometry.map(row=>({...row,available:!empty})),...(mapSidebarCount!=null?[{kind:'grade',id:grade,name:grade,count:String(mapSidebarCount),available:true,label:grade}]:[])]};
    }
    if(action==='live.liveAction'){
      assert.equal(arg.action,'click');
      if(arg.row.kind==='grade'){
        assert.ok(phase==='grades'||phase==='map'&&mapSidebarCount!=null);assert.equal(arg.row.name,grade);phase='choice';trace.push('grade-open');return true;
      }
      throw Error('Seat click is forbidden in the HTTP flow');
    }
    if(action==='flow.clickKnown'&&arg==='직접 좌석 선택하기'){
      assert.equal(phase,'choice');assert.equal(directMapCount,0,'a lingering direct-map button must not be clicked again');
      directMapCount++;trace.push('direct-map');if(!delayedMapReads&&!blankMapReads)showMap();
      return true;
    }
    throw Error('Unexpected fixture boundary action: '+action);
  }};
  const noFile=()=>{const error=Error('No persisted fixture settings');error.code='ENOENT';throw error;};
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}},net:{fetch(){throw Error('Live network access is forbidden in this test');}}};
  const context={require:name=>name==='electron'?electron:name==='node:fs'?{...fs,statSync:noFile,readFileSync:noFile}:name==='./browser-bridge'?{BrowserBridge:class{}}:name==='./ocr-client'?{OcrClient:class{constructor(){throw Error('OCR must not run in this test');}}}:name==='./run-control'?{...load(name),pause:async(_ms,signal)=>{if(signal?.aborted)throw Error('Fixture cancelled');}}:load(name),__dirname:path.dirname(filename),process:{argv:[],pid:0},URL,Date,console,setTimeout,clearTimeout,fixtureBridge:bridge};
  vm.createContext(context);vm.runInContext(source+`
    bridge=fixtureBridge;
    globalThis.api={autoLoop,trackTabs,onBrowserEvent,current,ensureNetwork,begin:()=>beginRun(current(),${JSON.stringify(preferences)},'auto')};`,context);
  api=context.api;api.trackTabs([{...tab}]);if(startWithMap)showMap();
  return {api,trace,selectedActions,network,get phase(){return phase;},get completionCount(){return completionCount;},get directMapCount(){return directMapCount;},get unchangedMapReads(){return unchangedMapReads;}};
}

test('sports seat flow joins metadata, selects physical adjacent seats and confirms price screen after acknowledgements',async()=>{
  const f=seatFlowFixture(),run=f.api.begin();await f.api.ensureNetwork(f.api.current());
  const result=await f.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(f.phase,'payment');assert.equal(result.bookingAdvanced,true);assert.equal(f.completionCount,1);
  assert.equal(run.entry.seatPageObserved,true);assert.equal(run.retry.attempted,1);
  assert.deepEqual(f.selectedActions.map(s=>s.id),['seat_block_fixture-1','seat_block_fixture-2']);
  assert.ok(f.selectedActions[0].neighbors.includes(f.selectedActions[1].id));
  assert.deepEqual(f.trace,['observer-ready','grade-open','direct-map','geometry-read','http-begin','http-approved','validated-navigation']);
  assert.equal(f.network.pending.length,0);
});

test('A-row sports flow preserves site labels and never repeats a direct-map click while its button remains visible',async()=>{
  const f=seatFlowFixture({rowNo:'A',delayedMapReads:2}),run=f.api.begin();await f.api.ensureNetwork(f.api.current());
  const result=await f.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(f.phase,'payment');assert.equal(f.completionCount,1);
  assert.equal(f.directMapCount,1);assert.equal(f.unchangedMapReads,2);
  assert.deepEqual(f.selectedActions.map(s=>[s.row,s.rowLabel,s.rowKind]),[[1,'A','alpha'],[1,'A','alpha']]);
  assert.ok(f.selectedActions.every(s=>s.label.includes('A열')));
  assert.equal(f.network.pending.length,0);assert.equal(run.retry.attempted,1);
});

test('Blank frames while the direct seat map loads are not treated as returning to grades',async()=>{
  const f=seatFlowFixture({blankMapReads:3}),run=f.api.begin();await f.api.ensureNetwork(f.api.current());
  const result=await f.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(f.directMapCount,1);
  assert.equal(f.completionCount,1);assert.equal(run.awaitingGradesAt,null);
});

test('A visible map is selected even when its visible grade sidebar reports zero remaining seats',async()=>{
  const f=seatFlowFixture({startWithMap:true,mapSidebarCount:0}),run=f.api.begin();await f.api.ensureNetwork(f.api.current());
  const result=await f.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(f.phase,'payment');assert.equal(f.completionCount,1);
  assert.deepEqual(f.selectedActions.map(s=>s.id),['seat_block_fixture-1','seat_block_fixture-2']);
  assert.equal(run.retry.cycle,1);assert.equal(run.retry.attempted,1);assert.equal(f.directMapCount,0);
  assert.deepEqual(f.trace,['observer-ready','geometry-read','http-begin','http-approved','validated-navigation']);
});

test('A mixed screen keeps grade-first navigation when its sidebar lists an eligible grade',async()=>{
  const f=seatFlowFixture({startWithMap:true,mapSidebarCount:3,emptyMapReads:1}),run=f.api.begin();await f.api.ensureNetwork(f.api.current());
  const result=await f.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(f.phase,'payment');assert.equal(f.completionCount,1);
  assert.equal(run.retry.cycle,1);assert.equal(run.retry.attempted,1);assert.equal(f.directMapCount,1);
  assert.deepEqual(f.trace,['observer-ready','geometry-read','grade-open','direct-map','geometry-read','http-begin','http-approved','validated-navigation']);
});

test('After a zero-count sidebar round is exhausted, the next round checks the current map for changed seats',async()=>{
  const f=seatFlowFixture({startWithMap:true,mapSidebarCount:0,emptyMapReads:1}),run=f.api.begin();await f.api.ensureNetwork(f.api.current());
  run.gradeOpenedAt=Date.now()-1000;
  const result=await f.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(f.phase,'payment');assert.equal(f.completionCount,1);
  assert.equal(run.retry.cycle,2);assert.equal(run.retry.attempted,1);assert.equal(f.directMapCount,0);
  assert.deepEqual(f.selectedActions.map(s=>s.id),['seat_block_fixture-1','seat_block_fixture-2']);
  assert.deepEqual(f.trace,['observer-ready','geometry-read','geometry-read','geometry-read','http-begin','http-approved','validated-navigation']);
});
