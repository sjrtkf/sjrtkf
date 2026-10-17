'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const entry=require('../src/entry');
const GOODS='26005452',RUN='clock-run';

function fixture(){
  let mono=0,wall=1789700000000,nextTimer=1,clicks=0,attributeWrites=0,disabled=true;
  const timers=new Map(),observers=[];
  const button={
    textContent:'남은시간 00:01',ariaDisabled:null,
    get disabled(){return disabled;},set disabled(value){attributeWrites++;disabled=value;},
    getAttribute(name){return name==='aria-disabled'?this.ariaDisabled:null;},
    getBoundingClientRect(){return {width:100,height:40};},click(){clicks++;}
  };
  const dialog={getBoundingClientRect(){return {width:100,height:40};}};
  const main={textContent:'예매 준비가 완료됐어요',querySelectorAll(){return [button];}};
  const document={body:{},hidden:false,modal:false,querySelector(){return main;},querySelectorAll(){return this.modal?[dialog]:[];}};
  class FakeDate extends Date{static now(){return wall;}}
  const context=vm.createContext({siteInvoke:(e,kind,value)=>{if(kind==='change'){e.value=value;e.siteChange?.(value);return;}return e.click();},
    window:{},document,location:{origin:'https://tickets.interpark.com',pathname:'/gates/ticket/'+GOODS},
    performance:{now:()=>mono,timeOrigin:1789700000000},Date:FakeDate,getComputedStyle:()=>({display:'block',visibility:'visible'}),
    setTimeout(fn,delay=0){const id=nextTimer++;timers.set(id,{fn,due:mono+Math.max(0,Number(delay)||0)});return id;},
    clearTimeout(id){timers.delete(id);},
    MutationObserver:class{constructor(fn){this.fn=fn;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}}
  });
  function run(fn,arg){return vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context);}
  function advance(target){
    assert.ok(target>=mono,'monotonic time cannot move backwards');
    let count=0;
    for(;;){
      const ready=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];
      if(!ready)break;
      assert.ok(++count<1000,'timer loop did not settle');
      const [id,timer]=ready;timers.delete(id);mono=Math.max(mono,timer.due);timer.fn();
    }
    mono=target;
  }
  function activate(){disabled=false;button.textContent='예매하기';}
  function notify(){for(const observer of observers)if(observer.connected)observer.fn([],observer);}
  const config=overrides=>({runId:RUN,goodsCode:GOODS,documentId:context.window.__bearsGate?.status.documentId,source:'ticket-server',deadlineMono:100,validUntilMono:1000,uncertaintyMs:20,openAt:1789700000100,...overrides});
  return {
    context,document,button,main,timers,observers,run,advance,activate,notify,config,
    arm:(options={})=>run(entry.armGate,{goodsCode:GOODS,runId:RUN,...options}),
    clock:(options={})=>run(entry.setGateClock,config(options)),
    clicks:()=>clicks,attributeWrites:()=>attributeWrites,now:()=>mono,
    jumpWall:value=>{wall=value;},elapseWithoutTasks:value=>{assert.ok(value>=mono);mono=value;}
  };
}

test('서버 시각 타이머는 기한 전 실행하지 않고 기한에 자연 활성 버튼을 한 번 누른다',()=>{
  const f=fixture(),status=f.arm();assert.equal(f.clock(),true);
  f.advance(99);f.activate();f.advance(99.99);assert.equal(f.clicks(),0);
  f.advance(100);assert.equal(f.clicks(),1);assert.equal(status.trigger,'server-clock');
  assert.equal(status.phase,'clicked');assert.equal(status.clock.firedAtMono,100);
  assert.equal(status.clickedMono,100);assert.equal(f.attributeWrites(),0);
  assert.equal(status.phase==='request-observed',false,'DOM click delivery is not a network request observation');
});

test('타이머와 자연 활성화 감지의 순서가 달라도 공통 잠금으로 클릭은 한 번이다',()=>{
  for(const first of ['clock','observer']){
    const f=fixture(),status=f.arm();f.clock();f.advance(99);f.activate();
    if(first==='observer')f.notify();
    f.advance(100);f.notify();f.advance(2000);
    for(const observer of f.observers)observer.fn([],observer);
    assert.equal(f.clicks(),1,first);
    assert.equal(status.trigger,'server-clock');
    assert.equal(f.run(entry.setGateClock,f.config()),false,'completed latch cannot be rearmed');
  }
});

test('기한에도 비활성이라면 DOM을 바꾸지 않고 이후 자연 활성화를 감지한다',()=>{
  const f=fixture(),status=f.arm();f.clock();f.advance(100);
  assert.equal(f.clicks(),0);assert.equal(f.button.disabled,true);assert.equal(f.attributeWrites(),0);
  assert.equal(status.phase,'armed');assert.equal(status.clock.outcome,'not-ready');
  f.activate();f.notify();assert.equal(f.clicks(),1);assert.equal(status.trigger,'activation');
});

test('시각 도달 시 모달이면 실행을 보류하고 기존 감지를 유지한다',()=>{
  for(const block of ['modal']){
    const f=fixture(),status=f.arm();f.clock();f.advance(99);f.activate();f.document[block]=true;
    f.advance(100);assert.equal(f.clicks(),0,block);assert.equal(status.clock.outcome,'not-ready');
    f.document[block]=false;f.notify();assert.equal(f.clicks(),1,block);assert.equal(status.trigger,'activation');
  }
});

test('실행이 늦어 시각 측정이 만료되면 시각 클릭은 폐기하고 자연 활성화 경로를 유지한다',()=>{
  const f=fixture(),status=f.arm();f.clock({validUntilMono:150});
  f.elapseWithoutTasks(200);f.advance(200);
  assert.equal(status.clock.outcome,'stale');assert.equal(f.clicks(),0);
  f.activate();f.notify();assert.equal(f.clicks(),1);assert.equal(status.trigger,'activation');
});

test('중지와 다른 페이지 이동 이후 지연된 타이머 및 관찰자는 클릭하지 않는다',()=>{
  for(const action of ['stop','path','origin']){
    const f=fixture(),status=f.arm();f.clock();const delayed=[...f.timers.values()].map(t=>t.fn);
    if(action==='stop')f.context.window.__bearsGate.stop();
    if(action==='path')f.context.location.pathname='/onestop/seat';
    if(action==='origin')f.context.location.origin='https://example.com';
    f.activate();f.advance(1000);
    for(const fn of delayed)fn();
    for(const observer of f.observers)observer.fn([],observer);
    assert.equal(f.clicks(),0,action);assert.equal(status.phase,action==='stop'?'stopped':'navigated');
  }
});

test('다른 실행·상품·시각 출처 또는 불완전한 시각 값은 타이머를 예약하지 않는다',()=>{
  const invalid=[
    {runId:'other-run'},{goodsCode:'99999999'},{source:'http-date-fallback'},
    {validUntilMono:99},{uncertaintyMs:-1},{uncertaintyMs:502},{deadlineMono:null},{openAt:null}
  ];
  for(const change of invalid){
    const f=fixture(),status=f.arm();assert.equal(f.clock(change),false,JSON.stringify(change));
    f.activate();f.advance(100);assert.equal(f.clicks(),0);assert.equal(status.clock.outcome,'not-configured');
    f.notify();assert.equal(f.clicks(),1,'a refused clock must not disable the normal observer');
  }
});

test('새 실행의 관찰자는 이전 실행 타이머와 관찰자의 지연 호출을 무효화한다',()=>{
  const f=fixture(),old=f.arm();f.clock();const delayed=[...f.timers.values()].map(t=>t.fn),oldObserver=f.observers[0];
  const current=f.arm({runId:'new-run'});assert.equal(old.phase,'stopped');
  assert.equal(f.clock(),false,'old run cannot configure the new gate');
  f.activate();f.elapseWithoutTasks(100);for(const fn of delayed)fn();oldObserver.fn([],oldObserver);
  assert.equal(f.clicks(),0);f.notify();assert.equal(f.clicks(),1);assert.equal(current.trigger,'activation');
});

test('사이트 자체 진입 요청을 관측하면 예약된 시각 클릭과 활성화 클릭을 취소한다',()=>{
  const f=fixture(),status=f.arm();f.clock();const delayed=[...f.timers.values()].map(t=>t.fn);
  assert.equal(f.run(entry.noteGateRequest,{runId:'wrong-run'}),null);assert.equal(status.phase,'armed');
  f.run(entry.noteGateRequest,{runId:RUN});assert.equal(status.phase,'request-observed');
  f.activate();f.advance(2000);for(const fn of delayed)fn();f.notify();
  assert.equal(f.clicks(),0);assert.equal(f.clock(),false);
  assert.equal(f.arm().phase,'request-observed','same-run arm must retain the observed-request latch');
});

test('PC 벽시계가 앞뒤로 바뀌어도 단조 시계의 예약 기한은 변하지 않는다',()=>{
  for(const wall of [0,9999999999999]){
    const f=fixture(),status=f.arm();f.clock();f.advance(90);f.jumpWall(wall);f.activate();
    f.advance(99);assert.equal(f.clicks(),0);f.advance(100);assert.equal(f.clicks(),1);
    assert.equal(status.clickedMono,100);assert.equal(status.clock.delayMs,0);
  }
});

test('처음부터 열린 버튼은 시각 타이머도 누르지 않아 사이트 자동 진입과 경합하지 않는다',()=>{
  const f=fixture();f.activate();const status=f.arm();f.clock();f.advance(100);
  assert.equal(status.observedDisabled,false);assert.equal(f.clicks(),0);
  assert.equal(status.clock.outcome,'not-ready');
});

test('같은 상품과 실행이어도 새 문서는 이전 문서의 시각 보정을 재사용하지 않는다',()=>{
  const f=fixture(),previous=f.arm(),previousConfig=f.config();
  f.context.window.__bearsGate.stop();f.context.window={};
  f.context.performance.timeOrigin+=1000;
  const current=f.arm();assert.notEqual(current.documentId,previous.documentId);
  assert.equal(f.run(entry.setGateClock,previousConfig),false,'old document calibration is rejected');
  assert.equal(current.clock.outcome,'not-configured');
  assert.equal(f.clock(),true,'current-document calibration remains usable');
  f.advance(99);f.activate();f.advance(100);assert.equal(f.clicks(),1);
});

test('a hidden page executes the scheduled function at the deadline without waiting for focus',()=>{
 const f=fixture(),status=f.arm();f.document.hidden=true;f.clock();f.advance(99);f.activate();f.notify();assert.equal(f.clicks(),0);f.advance(100);assert.equal(f.clicks(),1);assert.equal(status.trigger,'server-clock');
});
