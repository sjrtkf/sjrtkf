'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');

// Load the real routing functions without starting Electron or any network.
// Browser calls return fixture snapshots; only the clock/pause and selection
// boundary are replaced so timeouts and routing can be tested deterministically.
function setup(options={}){
  const sourcePath=path.resolve(__dirname,'../src/main.js'),load=createRequire(sourcePath);
  const source=fs.readFileSync(sourcePath,'utf8').split('app.whenReady().then')[0];
  const clock={now:Date.now()},observed={back:0,reads:0,selections:[],pauses:0,calls:[]};
  class FixtureDate extends Date {static now(){return clock.now;}}
  let api;
  const defaultScene={completed:false,captcha:false,dialog:null,selected:[],grades:[],hasSeats:true,buttons:[{label:'좌석도 전체보기',enabled:true}]};
  const wc={id:1,isDestroyed:()=>false,getURL:()=> 'https://tickets.interpark.com/onestop/seat',
    executeJavaScriptInIsolatedWorld:async(_world,scripts)=>{
      const code=scripts[0].code;observed.calls.push(code);
      if(code.startsWith('(function scene'))return {...defaultScene,...options.scene?.({observed,api,clock})};
      if(code.startsWith('(function liveRead')){observed.reads++;return {rows:options.rows?.({observed,api,clock})||[],message:'fixture'};}
      if(code.startsWith('(function clickKnown')){assert.ok(code.includes('좌석도 전체보기'));observed.back++;options.onBack?.({observed,api,clock});return true;}
      if(code.startsWith('(function liveAction')){const payload=JSON.parse(code.slice(code.lastIndexOf(')(')+2,-1));options.onGrade?.(payload.row,{observed,api,clock});return true;}
      throw Error('Unexpected browser call: '+code.slice(0,100));
    }};
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}}};
  const mockFs={...fs,readFileSync:()=>{throw Error('no saved preferences');},writeFileSync(){},mkdirSync(){}};
  const routingControl={...load('./run-control'),pause:async()=>{
    observed.pauses++;clock.now+=options.advanceMs??100;options.onPause?.({observed,api,clock});
    if(observed.pauses>(options.maxPauses??5))throw Error('FIXTURE_END');
  }};
  const selection={...load('./selection'),chooseCandidates:async args=>{
    observed.selections.push(args.groups);return options.selectionResult||{selected:true,message:'fixture selected'};
  }};
  const context={require:n=>n==='electron'?electron:n==='node:fs'?mockFs:n==='./run-control'?routingControl:n==='./selection'?selection:load(n),__dirname:path.dirname(sourcePath),process:{argv:['node','--smoke-test'],pid:0},URL,Date:FixtureDate,console,setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(source+'\nglobalThis.audit={autoLoop,begin:p=>beginRun(targets.get(1),p,"auto"),setScope:n=>scopeVersions.set(1,n),init:wc=>{targets.set(1,wc);active=1;mainId=1;scopeVersions.set(1,0);metaStores.set(1,new Map());gradeStores.set(1,new Map());}};',context);
  api=context.audit;api.init(wc);
  return {api,clock,observed,start(p={}){const run=api.begin(p);run.openAt=clock.now;return run;}};
}
function pair(row,grade='A'){
  return [1,2].map(n=>({kind:'seat',id:grade+'-'+row+'-'+n,available:true,grade,block:'118',row,number:n,colIdx:n,segment:grade+'-'+row,obstructed:false,aisle:n===1,neighbors:[grade+'-'+row+'-'+(n===1?2:1)]}));
}
test('main: 가용석 0인 지도는 1.5초 뒤 다음 구역으로 이동한다',async()=>{
  const t=setup({scene:({observed})=>observed.back?{hasSeats:false,grades:[{name:'A',count:0}]}:{},rows:()=>[]});
  const run=t.start();run.currentJob={name:'A',tierIndex:0};run.gradeOpenedAt=t.clock.now-1600;
  const result=await t.api.autoLoop(run);
  assert.equal(t.observed.back,1);assert.equal(t.observed.selections.length,0);assert.match(result.message,/후보를 찾지 못/);
});
test('main: 일부만 상세정보가 연결된 지도도 8초 뒤 다음 구역으로 이동한다',async()=>{
  const t=setup({scene:({observed})=>observed.back?{hasSeats:false,grades:[{name:'A',count:0}]}:{},rows:()=>[pair(1)[0],{kind:'seat',id:'unknown',available:true}]});
  const run=t.start();run.currentJob={name:'A',tierIndex:0};run.gradeOpenedAt=t.clock.now-8100;
  await t.api.autoLoop(run);
  assert.equal(t.observed.back,1);assert.equal(t.observed.selections.length,0);
});
test('main: 부분 상세정보의 대기시간 전에는 구역을 건너뛰지 않는다',async()=>{
  const t=setup({rows:()=>[{kind:'seat',id:'unknown',available:true}],maxPauses:0});
  const run=t.start();run.currentJob={name:'A',tierIndex:0};run.gradeOpenedAt=t.clock.now-7900;
  await assert.rejects(t.api.autoLoop(run),/FIXTURE_END/);
  assert.equal(t.observed.back,0);assert.equal(t.observed.selections.length,0);
});
test('main: 전체보기 클릭 후 이전 지도가 남아 있어도 다른 순위의 좌석을 선택하지 않는다',async()=>{
  const t=setup({rows:({observed})=>observed.back?pair(8):[],maxPauses:2});
  const run=t.start({tiers:[{name:'앞열',maxRow:5},{name:'뒤열',minRow:6}]});run.currentJob={name:'A',tierIndex:0};run.gradeOpenedAt=t.clock.now-1600;
  await assert.rejects(t.api.autoLoop(run),/FIXTURE_END/);
  assert.equal(t.observed.back,1);assert.equal(t.observed.reads,1);assert.equal(t.observed.selections.length,0);assert.match(run.status,/구역 목록 화면 도착/);
});
test('main: 선택한 구역 작업의 tierIndex만 후보 계산에 전달한다',async()=>{
  const t=setup({rows:()=>[...pair(1),...pair(4)]});
  const run=t.start({tiers:[{name:'앞열',maxRow:2},{name:'대안',minRow:3,maxRow:5}]});run.currentJob={name:'A',tierIndex:1};run.gradeOpenedAt=t.clock.now;
  await t.api.autoLoop(run);
  assert.equal(t.observed.selections.length,1);
  assert.ok(t.observed.selections[0].every(g=>g.tierIndex===1&&g.seats.every(s=>s.row===4)));
});
test('main: 보안문자 대기 중 같은 창의 경기·회차 범위가 바뀌면 중단한다',async()=>{
  const t=setup({scene:()=>({captcha:true}),onPause:({api})=>api.setScope(1)});
  const run=t.start();
  await assert.rejects(t.api.autoLoop(run),/경기 또는 회차가 변경/);
  assert.equal(t.observed.reads,0);assert.equal(t.observed.selections.length,0);assert.equal(t.observed.back,0);
});
test('main: 한 순위의 모든 구역이 끝난 뒤 다음 순위에서 같은 구역을 다시 확인한다',async()=>{
  let inMap=false;const opened=[];
  const grades=[{name:'A',count:2},{name:'B',count:2}];
  const t=setup({advanceMs:1000,maxPauses:20,scene:()=>({hasSeats:inMap,grades:inMap?[]:grades}),rows:()=>inMap?[]:grades.map(g=>({kind:'grade',name:g.name,id:g.name,count:String(g.count),available:true})),onGrade:row=>{opened.push(row.name);inMap=true;},onBack:()=>{inMap=false;}});
  const run=t.start({tiers:[{name:'앞열',areas:['A','B'],maxRow:5},{name:'뒤열',areas:['A','B'],minRow:6}]});
  const result=await t.api.autoLoop(run);
  assert.deepEqual(opened,['A','B','A','B']);
  assert.deepEqual([...run.triedJobs],['[0,"A"]','[0,"B"]','[1,"A"]','[1,"B"]']);
  assert.equal(t.observed.back,4);assert.match(result.message,/모든 우선순위/);
});
