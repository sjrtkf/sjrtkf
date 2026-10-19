'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const entry=require('../src/entry');
const KEY='10월 20일 18:30 | 두산 vs KIA',RUN='listing-run';

function fixture(){
  let mono=0,wall=1792400000000,nextTimer=1,behavior;
  const timers=new Map(),observers=[],invocations=[];
  const cardButton=(info='10월 20일 18:30',teams=['두산','KIA'])=>({
    disabled:true,ariaDisabled:null,textContent:'예매 예정',hidden:false,connected:true,
    get isConnected(){return this.connected;},
    getAttribute(name){return name==='aria-disabled'?this.ariaDisabled:null;},
    getBoundingClientRect(){return {width:100,height:40};},
    click(){throw Error('DOM clicks are not permitted');},
    parentElement:{querySelector:()=>({textContent:info}),querySelectorAll:()=>teams.map(alt=>({alt}))}
  });
  const button=cardButton(),dialog=cardButton(),notice=cardButton();notice.textContent='확인하고 예매하기';
  const document={body:{},cards:[button],modal:false,notice:false,querySelectorAll(selector){
    if(selector==='button.grid-area_cta')return this.cards;
    if(selector==='button')return this.notice?[...this.cards,notice]:this.cards;
    return this.modal?[dialog]:[];
  }};
  class FakeDate extends Date{static now(){return wall;}}
  const context=vm.createContext({
    window:{},document,location:{origin:'https://tickets.interpark.com',pathname:'/sports/29/3',search:'',hash:''},
    performance:{now:()=>mono,timeOrigin:1792400000000},Date:FakeDate,
    getComputedStyle:element=>({display:element.hidden?'none':'block',visibility:element.visibility||'visible'}),
    siteInvoke:element=>{invocations.push(element);return behavior?.(element);},
    setTimeout(fn,delay=0){const id=nextTimer++;timers.set(id,{fn,due:mono+Math.max(0,Number(delay)||0)});return id;},
    clearTimeout(id){timers.delete(id);},
    MutationObserver:class{constructor(fn){this.fn=fn;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}}
  });
  const run=(fn,arg)=>vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context);
  function advance(target){
    assert.ok(target>=mono);let count=0;
    for(;;){
      const ready=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];
      if(!ready)break;
      assert.ok(++count<1000,'timer loop did not settle');
      const [id,timer]=ready;timers.delete(id);mono=Math.max(mono,timer.due);timer.fn();
    }
    mono=target;
  }
  const config=overrides=>({key:KEY,runId:RUN,documentId:context.window.__bearsEntry?.status.documentId,source:'ticket-server',deadlineMono:100,validUntilMono:1000,uncertaintyMs:20,openAt:1792400000100,...overrides});
  return {
    context,document,button,cardButton,run,timers,observers,advance,invocations,config,
    activate:(target=button)=>{target.disabled=false;target.ariaDisabled=null;target.textContent='예매하기';},
    notify:()=>{for(const observer of observers)if(observer.connected)observer.fn([],observer);},
    arm:(options={})=>run(entry.armListing,{key:KEY,runId:RUN,...options}),
    clock:(options={})=>run(entry.setListingClock,config(options)),
    behavior:fn=>{behavior=fn;},elapseWithoutTasks:time=>{assert.ok(time>=mono);mono=time;},jumpWall:time=>{wall=time;}
  };
}

test('선택한 목록 버튼의 disabled, aria-disabled, 예매하기 문구를 모두 확인한 뒤 즉시 한 번 실행한다',()=>{
  const f=fixture(),status=f.arm();assert.equal(status.phase,'armed');
  f.button.textContent='예매하기';f.notify();assert.equal(f.invocations.length,0);
  f.button.disabled=false;f.button.ariaDisabled='true';f.notify();assert.equal(f.invocations.length,0);
  f.button.ariaDisabled=null;f.button.textContent='10/20 11:00 예매하기';f.notify();assert.equal(f.invocations.length,0);
  f.advance(30);f.button.textContent='예매하기';f.notify();
  assert.equal(f.invocations.length,1);assert.equal(f.invocations[0],f.button);assert.equal(status.phase,'clicked');
  assert.equal(status.trigger,'activation');assert.equal(status.enabledObservedMono,30);assert.equal(status.clickedMono,30);assert.equal(status.invokeDelayMs,0);
  assert.equal(f.run(entry.listingState),status);assert.equal(f.arm(),status);f.notify();f.advance(5000);
  assert.equal(f.invocations.length,1);assert.equal(f.timers.size,0);assert.equal(f.observers.length,1);assert.equal(f.observers[0].connected,false);
});

test('처음부터 활성화된 선택 카드도 실행하고 재진입한 사이트 함수는 동일 실행 잠금을 공유한다',()=>{
  const f=fixture();f.activate();f.behavior(()=>{f.notify();assert.equal(f.arm().phase,'clicked');});
  const status=f.arm();assert.equal(status.phase,'clicked');assert.equal(f.invocations.length,1);assert.equal(f.observers.length,1);
});

test('다른 경기의 활성화는 무시하고 교체된 대상 카드의 현재 함수를 호출한다',()=>{
  const f=fixture(),other=f.cardButton('10월 21일 18:30');f.document.cards.push(other);f.arm();
  f.activate(other);f.notify();assert.equal(f.invocations.length,0);
  const replacement=f.cardButton();f.document.cards=[replacement,other];f.activate(replacement);f.notify();
  assert.deepEqual(f.invocations,[replacement]);
});

test('숨겨진 중복 카드는 제외하되 보이는 중복이나 대상 카드 유실은 확인을 요구하며 중단한다',()=>{
  for(const action of ['hidden','visibility','disconnected','duplicate','missing']){
    const f=fixture(),status=f.arm(),duplicate=f.cardButton();
    if(action==='missing')f.document.cards=[];
    else{duplicate.hidden=action==='hidden';duplicate.visibility=action==='visibility'?'hidden':'visible';duplicate.connected=action!=='disconnected';f.document.cards.push(duplicate);}
    f.activate();f.notify();
    const blocked=['duplicate','missing'].includes(action);
    assert.equal(status.phase,blocked?'blocked':'clicked',action);assert.equal(f.invocations.length,blocked?0:1,action);
    if(blocked){f.document.cards=[f.button];f.notify();f.advance(1000);assert.equal(f.arm(),status);assert.equal(f.invocations.length,0);}
  }
});

test('인증 모달과 정상 예매 안내가 있으면 대기하고 닫힌 뒤 대상 버튼을 다시 확인한다',()=>{
  for(const type of ['modal','notice']){
    const f=fixture(),status=f.arm();f.document[type]=true;f.activate();f.notify();
    assert.equal(status.phase,'armed');assert.equal(f.invocations.length,0);
    const cards=f.document.cards;f.document.cards=[];f.notify();assert.equal(status.phase,'armed','modal can temporarily hide the listing');
    f.document.cards=cards;f.document[type]=false;f.notify();assert.equal(status.phase,'clicked');assert.equal(f.invocations.length,1);
  }
});

test('중지·타임아웃·URL 변화 이후 지연된 타이머와 관찰자는 실행하지 않는다',()=>{
  for(const action of ['stop','timeout','origin','pathname','search','hash']){
    const f=fixture(),status=f.arm({timeoutMs:100});const pending=[...f.timers.values()].map(timer=>timer.fn),observer=f.observers[0];
    if(action==='stop')f.context.window.__bearsEntry.stop();
    else if(action!=='timeout')f.context.location[action]+='changed';
    f.activate();f.advance(100);for(const fn of pending)fn();observer.fn([],observer);
    assert.equal(status.phase,action==='stop'?'stopped':action==='timeout'?'timeout':'navigated',action);
    assert.equal(f.invocations.length,0,action);assert.equal(f.arm(),status);assert.equal(f.invocations.length,0);
  }
});

test('새 실행은 이전 관찰과 타이머를 취소하고 오래된 문서 보정값을 거절한다',()=>{
  const f=fixture(),old=f.arm({clockRequired:true});f.clock();
  const oldConfig=f.config(),pending=[...f.timers.values()].map(timer=>timer.fn),oldObserver=f.observers[0];
  const current=f.arm({runId:'second-run',clockRequired:true});assert.equal(old.phase,'stopped');assert.notEqual(old.documentId,current.documentId);
  assert.equal(f.run(entry.setListingClock,oldConfig),false);f.activate();f.elapseWithoutTasks(100);
  for(const fn of pending)fn();oldObserver.fn([],oldObserver);assert.equal(f.invocations.length,0);
  assert.equal(f.clock({runId:'second-run'}),true);assert.equal(current.phase,'clicked');assert.equal(f.invocations.length,1);
});

test('사이트 함수의 동기 오류와 비동기 거절은 blocked로 보고하며 중복 실행하지 않는다',async()=>{
  for(const asynchronous of [false,true]){
    const f=fixture();f.behavior(()=>{if(asynchronous)return Promise.reject(Error('handler failed'));throw Error('handler failed');});
    const status=f.arm();f.activate();f.notify();await new Promise(setImmediate);
    assert.equal(status.phase,'blocked');assert.equal(f.invocations.length,1);assert.equal(f.arm(),status);f.advance(1000);assert.equal(f.invocations.length,1);
  }
});

test('이전 실행의 늦은 비동기 거절은 새 실행을 변경하거나 호출을 추가하지 않는다',async()=>{
  const f=fixture();let reject;f.behavior(()=>new Promise((_,failed)=>{reject=failed;}));f.activate();const old=f.arm();
  f.button.disabled=true;const current=f.arm({runId:'new-run'});reject(Error('late failure'));await new Promise(setImmediate);
  assert.equal(old.phase,'clicked');assert.equal(current.phase,'armed');assert.equal(f.invocations.length,1);
  f.behavior(()=>{});f.activate();f.notify();assert.equal(current.phase,'clicked');assert.equal(f.invocations.length,2);
});

test('공유 디스패처가 오류로 먼저 관찰자를 중지해도 실패 상태를 보존한다',async()=>{
  for(const asynchronous of [false,true]){
    const f=fixture(),control=f.context.window.__ticketSiteCode={epoch:1,error:null};
    f.behavior(()=>{
      const fail=()=>{control.error='SITE_FUNCTION_FAILED';f.context.window.__bearsEntry.stop();};
      if(asynchronous){const rejected=Promise.reject(Error('handler failed'));rejected.catch(fail);return rejected;}
      fail();throw Error('handler failed');
    });
    const status=f.arm();f.activate();f.notify();await new Promise(setImmediate);
    assert.equal(status.phase,'blocked');assert.equal(f.invocations.length,1);
  }
});

test('시각 필수 모드는 활성화되어도 유효한 서버 보정과 시작 시점까지 기다린다',()=>{
  const f=fixture();f.activate();const status=f.arm({clockRequired:true});assert.equal(f.invocations.length,0);
  assert.equal(f.clock(),true);f.advance(99);f.notify();assert.equal(f.invocations.length,0);
  f.jumpWall(0);f.advance(100);f.notify();assert.equal(f.invocations.length,1);assert.equal(status.trigger,'server-clock');
  assert.equal(status.clock.outcome,'clicked');assert.equal(status.clickedMono,100);assert.equal(status.clock.firedAtMono,100);assert.equal(f.clock(),false);
});

test('서버 시각에 비활성 또는 모달 상태라면 활성화와 안내 종료가 모두 확인된 순간 실행한다',()=>{
  for(const modal of [false,true]){
    const f=fixture(),status=f.arm({clockRequired:true});f.clock();f.document.modal=modal;f.advance(100);
    assert.equal(status.phase,'armed');assert.equal(status.clock.outcome,'not-ready');assert.equal(f.invocations.length,0);
    f.activate();f.notify();assert.equal(f.invocations.length,modal?0:1);
    if(modal){f.document.modal=false;f.notify();}
    assert.equal(f.invocations.length,1);assert.equal(status.trigger,'activation');
  }
});

test('실행 또는 문서·경기·출처가 다르거나 불완전한 시각 값은 거절한다',()=>{
  const invalid=[{runId:'other'},{key:'other'},{documentId:'old-document'},{source:'local-clock'},{deadlineMono:null},{validUntilMono:99},{uncertaintyMs:-1},{uncertaintyMs:502},{openAt:null}];
  for(const override of invalid){
    const f=fixture();f.activate();const status=f.arm({clockRequired:true});assert.equal(f.clock(override),false,JSON.stringify(override));
    f.advance(500);assert.equal(status.phase,'armed');assert.equal(status.clock.outcome,'not-configured');assert.equal(f.invocations.length,0);
  }
});

test('필수 서버 시각이 만료되면 활성화 경로도 대기하고 새 보정 이후 한 번 실행한다',()=>{
  const f=fixture(),status=f.arm({clockRequired:true});f.clock({validUntilMono:150});f.elapseWithoutTasks(200);f.advance(200);f.activate();f.notify();
  assert.equal(status.clock.outcome,'stale');assert.equal(status.phase,'armed');assert.equal(f.invocations.length,0);
  assert.equal(f.clock({deadlineMono:220,validUntilMono:1000}),true);f.advance(220);assert.equal(status.phase,'clicked');assert.equal(f.invocations.length,1);
});

test('재보정 이전의 지연 타이머는 새로운 시작 시점을 무시하고 실행할 수 없다',()=>{
  const f=fixture(),status=f.arm({clockRequired:true});f.clock();const pending=[...f.timers.values()].map(timer=>timer.fn);
  f.clock({deadlineMono:300});f.activate();f.elapseWithoutTasks(100);for(const fn of pending)fn();
  assert.equal(f.invocations.length,0);assert.equal(status.clock.deadlineMono,300);f.advance(300);assert.equal(f.invocations.length,1);assert.equal(status.clickedMono,300);
});

test('시각이 선택 사항인 기본 감지는 서버 시각 없이 동작하고 상태 조회는 설치 전 null이다',()=>{
  const f=fixture();assert.equal(f.run(entry.listingState),null);assert.equal(f.run(entry.setListingClock,{}),false);
  const status=f.arm();f.activate();f.notify();assert.equal(status.phase,'clicked');assert.equal(status.clock.outcome,'not-configured');assert.equal(f.invocations.length,1);
});

test('목록 중지 확인 후 지연된 활성화와 같은 실행의 재설치는 진입을 만들지 않는다',()=>{
  const empty=fixture();assert.equal(empty.run(entry.stopListing,{key:KEY,runId:RUN}).stopped,true);
  const f=fixture();
  const status=f.arm({clockRequired:true});f.clock();const pending=[...f.timers.values()].map(timer=>timer.fn),observer=f.observers[0];
  for(const args of [{key:'other',runId:RUN},{key:KEY,runId:'other'},{}]){
    assert.equal(f.run(entry.stopListing,args).stopped,false);assert.equal(status.phase,'armed');
  }
  assert.equal(f.run(entry.stopListing,{key:KEY,runId:RUN}).stopped,true);assert.equal(status.phase,'stopped');
  f.activate();f.advance(500);for(const fn of pending)fn();observer.fn([],observer);f.notify();
  assert.equal(f.arm(),status);assert.equal(f.invocations.length,0);assert.equal(f.clock(),false);assert.equal(f.timers.size,0);
});

test('이미 실행한 목록도 중지를 확인하되 clicked 잠금을 보존한다',()=>{
  const f=fixture();f.activate();const status=f.arm();assert.equal(f.invocations.length,1);
  assert.equal(f.run(entry.stopListing,{key:KEY,runId:RUN}).stopped,true);assert.equal(status.phase,'clicked');
  assert.equal(f.arm(),status);f.notify();f.advance(1000);assert.equal(f.invocations.length,1);
});

test('설치 전에 먼저 도착한 중지는 같은 실행의 지연 설치를 차단하고 새 실행은 허용한다',()=>{
  const f=fixture();
  for(const key of [undefined,null,'','   ',42]){
    assert.equal(f.run(entry.stopListing,{key,runId:RUN}).stopped,false);assert.equal(f.run(entry.listingState),null);
  }
  assert.equal(f.run(entry.stopListing,{key:KEY,runId:RUN}).stopped,true);
  const stopped=f.run(entry.listingState);assert.equal(stopped.phase,'stopped');assert.equal(stopped.key,KEY);assert.equal(stopped.runId,RUN);
  f.activate();assert.equal(f.arm(),stopped);f.notify();f.advance(1000);assert.equal(f.invocations.length,0);
  assert.equal(f.observers.length,0);assert.equal(f.timers.size,0);assert.equal(f.clock(),false);
  const current=f.arm({runId:'new-run'});assert.equal(current.phase,'clicked');assert.equal(current.runId,'new-run');assert.equal(f.invocations.length,1);
});
