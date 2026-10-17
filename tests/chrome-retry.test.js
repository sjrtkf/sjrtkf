'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const {SeatRetry}=require('../src/seat-retry');
const {chooseCandidates,keyFor}=require('../src/selection');

// Exercise the packaged Chrome entrypoint without Electron, a server, or actual
// seat holds. Time and the browser boundary are deterministic fixture objects.
function setup(options={}){
  const filename=path.resolve(__dirname,'../src/chrome-main.js'),load=createRequire(filename);
  const source=fs.readFileSync(filename,'utf8').split('app.whenReady().then')[0];
  const clock={now:Date.now()},seen={pauses:[],opened:[],backs:0,reads:0,selections:[],calls:[]};let api;
  class FakeDate extends Date{static now(){return clock.now;}}
  const scene={completed:false,busy:false,captcha:false,dialog:null,selected:[],grades:[],hasSeats:true,buttons:[{label:'좌석도 전체보기',enabled:true}]};
  class Target{
    constructor(_bridge,row){this.update(row);}update(row){Object.assign(this,row);}getURL(){return this.url;}getTitle(){return 'fixture';}isDestroyed(){return false;}isDemo(){return false;}
    async invoke(fn,arg){
      if(fn?.name==='priceState')return {ready:true,quantity:api.runs.current.preferences.quantity};
      if(fn?.name==='proceedBooking')return {dispatched:true};if(fn?.name==='bookingProgress')return {ready:true};if(fn?.name==='adultPriceStep')return {status:'complete',message:'가격/할인 화면 · 성인 가격 확인'};
      if(fn?.name==='bookingIdentity')return {goodsCode:'26005452',placeCode:'25001730',playSeq:'001'};
      seen.calls.push({fn:fn?.name||fn,arg});
      if(options.invoke)return options.invoke(fn,arg,{api,seen,clock});
      if(fn?.name==='readDetails')return {blocks:[],grades:[]};
      if(fn?.name==='scene')return {...scene,...options.scene?.({api,seen,clock})};
      if(fn?.name==='liveRead')return this.readSeats();
      if(fn?.name==='clickKnown'){assert.equal(arg,'좌석도 전체보기');seen.backs++;options.back?.({api,seen,clock});return true;}
      throw Error('Unexpected browser call: '+(fn?.name||fn));
    }
    async readSeats(){seen.reads++;return {rows:options.rows?.({api,seen,clock})||[]};}
    async seatAction(row,action){assert.equal(action,'click');seen.opened.push(row.name);options.open?.(row,{api,seen,clock});}
  }
  const control={...load('./run-control'),pause:async(ms,signal)=>{
    seen.pauses.push(ms);clock.now+=options.timeStep??ms;
    options.pause?.({api,seen,clock,ms});
    if(signal?.aborted)throw Error('작업이 중지되었습니다.');
    if(seen.pauses.length>(options.maxPauses??50))throw Error('FIXTURE_END');
  }};
  const select={...load('./selection'),chooseCandidates:async args=>{
    seen.selections.push(args.groups);return options.select?.(args,{api,seen,clock})||{completed:true,attempted:1,message:'fixture secured'};
  }};
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}}};
  const context={require:n=>n==='electron'?electron:n==='./chrome-target'?{ChromeTarget:Target}:n==='./browser-bridge'?{BrowserBridge:class{}}:n==='node:fs'?{...fs,readFileSync(){throw Error('fixture no preferences');}}:n==='./run-control'?control:n==='./selection'?select:n==='./timing'&&options.clockForGate?{...load(n),clockForGate:options.clockForGate}:n==='node:perf_hooks'&&options.clockForGate?{performance:{now:()=>100}}:load(n),__dirname:path.dirname(filename),process:{argv:[],pid:0},URL,Date:FakeDate,console,setTimeout,clearTimeout};
  context.httpFixture=async(_wc,run,{seats,resumePrice})=>{
    if(resumePrice)return {completed:true,bookingAdvanced:true,message:'HTTP 가격/할인 승인 · 예매하기 다음 화면'};
    const groups=[{seats}];seen.selections.push(groups);
    const result=await options.select?.({groups,excludedGroups:run.excludedGroups},{api,seen,clock});
    return result?.exhausted?{conflict:true}:{completed:true,bookingAdvanced:true,...result};
  };
  vm.createContext(context);vm.runInContext(source+`
    bridge={getState:()=>({}),request:async()=>({healthy:true,sequence:0,pending:[],results:[]})};
    // Ranking/retry tests replace the HTTP transaction boundary; http-booking.test
    // executes its real fetch state machine separately.
    runHttpBooking=globalThis.httpFixture;
    globalThis.api={autoLoop,trackTabs,runs,scopeVersions,command,scheduleGateClock,current,setClock:value=>clockInfo=value,begin:p=>beginRun(current(),p,'auto')};`,context);
  api=context.api;api.trackTabs([{id:1,url:'https://tickets.interpark.com/onestop/seat',documentId:'one'}]);
  return {api,clock,seen,start(p={}){const run=api.begin(p);run.openAt=clock.now;return run;}};
}
function pair(row=1,grade='A'){
  return [1,2].map(n=>({kind:'seat',id:grade+'-'+row+'-'+n,available:true,grade,block:'118',row,number:n,colIdx:n,segment:grade+'-'+row,obstructed:false,aisle:n===1,neighbors:[grade+'-'+row+'-'+(n===1?2:1)]}));
}
test('2 seats together with no area restriction advances past isolated seats to the next grade',async()=>{
  let inMap=false,currentGrade;const grades=[{name:'A',count:2},{name:'B',count:2}];
  const t=setup({timeStep:1600,scene:()=>({hasSeats:true,grades:inMap?[]:grades}),
    rows:()=>inMap?(currentGrade==='A'?[pair(1,'A')[0],pair(2,'A')[0]]:pair(13,'B')):[...pair(1,'background'),...grades.map(g=>({kind:'grade',name:g.name,count:'2',available:true}))],
    open:row=>{inMap=true;currentGrade=row.name;},back:()=>{inMap=false;}
  });
  const result=await t.api.autoLoop(t.start({quantity:2,requireTogether:true,areas:[],blocks:[]}));
  assert.equal(result.bookingAdvanced,true);assert.deepEqual(t.seen.opened,['A','B']);assert.equal(t.seen.backs,1);assert.equal(t.seen.selections[0][0].seats[0].grade,'B');
});

test('Chrome auto: candidate 21 is attempted after a fresh map read, without ending at the 20-candidate chunk',async()=>{
  const t=setup({rows:()=>Array.from({length:21},(_,i)=>pair(i+1)).flat(),select:(args,{seen})=>{
    if(seen.selections.length<=20)return {exhausted:true,attempted:1};
    return {completed:true,attempted:1};
  }});
  const run=t.start(),result=await t.api.autoLoop(run);
  assert.equal(result.completed,true);assert.equal(t.seen.selections.length,21);assert.equal(t.seen.selections[20].length,1);assert.equal(t.seen.selections[20][0].seats[0].row,21);
  assert.equal(t.seen.reads,2);assert.equal(run.retry.attempted,21);assert.equal(t.seen.backs,0);assert.deepEqual(t.seen.pauses,[]);
});
test('Chrome auto: a fully exhausted set of grades cycles again and finds a seat that appeared later',async()=>{
  let inMap=false,currentGrade;const grades=[{name:'A',count:2},{name:'B',count:2}];
  const t=setup({timeStep:1600,scene:()=>({hasSeats:inMap,grades:inMap?[]:grades}),
    rows:({api})=>inMap?(api.runs.current.retry.cycle>1?pair(1,currentGrade):[]):grades.map(g=>({kind:'grade',name:g.name,id:g.name,count:'2',available:true})),
    open:row=>{inMap=true;currentGrade=row.name;},back:()=>{inMap=false;}
  });
  const run=t.start({areas:['A','B']}),result=await t.api.autoLoop(run);
  assert.equal(result.completed,true);assert.deepEqual(t.seen.opened,['A','B','A']);assert.equal(t.seen.backs,2);assert.equal(run.retry.cycle,2);assert.equal(t.seen.selections.length,1);assert.ok(t.seen.pauses.includes(3000));
});
test('Chrome auto: explicit conflicts in every grade clear per-round exclusions only after the next round begins',async()=>{
  let inMap=false,currentGrade;const grades=[{name:'A',count:2},{name:'B',count:2}];
  const t=setup({scene:()=>({hasSeats:inMap,grades:inMap?[]:grades}),rows:()=>inMap?pair(1,currentGrade):grades.map(g=>({kind:'grade',name:g.name,id:g.name,count:'2',available:true})),open:row=>{inMap=true;currentGrade=row.name;},back:()=>{inMap=false;},
    select:(args,{api})=>{if(api.runs.current.retry.cycle===1){args.excludedGroups.add(keyFor(args.groups[0]));return {exhausted:true,attempted:1};}return {completed:true,attempted:1};}
  });
  const run=t.start({areas:['A','B']}),result=await t.api.autoLoop(run);
  assert.equal(result.completed,true);assert.deepEqual(t.seen.opened,['A','B','A']);assert.equal(run.retry.cycle,2);assert.equal(run.retry.attempted,3);
});
test('Chrome auto: empty grade counts remain waiting and stop immediately during retry pacing',async()=>{
  const t=setup({scene:()=>({hasSeats:false,grades:[{name:'A',count:0}]}),pause:({api,ms})=>{if(ms===3000)api.runs.cancel();}}),run=t.start();
  await assert.rejects(t.api.autoLoop(run),/중지/);assert.equal(t.seen.selections.length,0);assert.equal(t.seen.opened.length,0);assert.equal(run.retry.cycle,1);assert.equal(run.retry.nextAt,null);assert.deepEqual(t.seen.pauses,[3000]);
});

test('visible grade list can advance while map nodes remain, without using zoom-fit as an unconditional back button',async()=>{
  let opened=false;
  const t=setup({scene:()=>({hasSeats:true,grades:[{name:'A',count:2}]}),rows:()=>opened?pair():[{kind:'grade',name:'A',count:'2',available:true}],open:()=>{opened=true;}});
  const result=await t.api.autoLoop(t.start({areas:['A']}));
  assert.equal(result.completed,true);assert.deepEqual(t.seen.opened,['A']);assert.equal(t.seen.backs,0);
});
test('Chrome auto: expiry of the old 30-minute limit does not stop a late available seat',async()=>{
  const t=setup({rows:()=>pair()}),run=t.start();t.clock.now+=31*60000;
  assert.equal((await t.api.autoLoop(run)).completed,true);assert.equal(t.seen.selections.length,1);
});
test('Chrome auto: confirmed price stage prevents any additional read, selection, or cleanup',async()=>{
  const t=setup({scene:()=>({completed:true})}),run=t.start();
  assert.match((await t.api.autoLoop(run)).message,/예매하기|가격\/할인/);assert.equal(t.seen.reads,0);assert.equal(t.seen.selections.length,0);assert.equal(t.seen.backs,0);
});
test('Chrome entry-only inspection stops at the seat page before scene reads, notices, CAPTCHA, or any seat action',async()=>{
  const t=setup({invoke:()=>{throw Error('Inspection must not execute a seat-page command');}}),run=t.start();run.inspectionOnly=true;
  const result=await t.api.autoLoop(run);assert.match(result.message,/진입 확인 완료/);assert.equal(run.entry.seatPageObserved,true);
  assert.equal(t.seen.calls.length,0);assert.equal(t.seen.reads,0);assert.equal(t.seen.selections.length,0);assert.equal(t.seen.backs,0);
});
test('Chrome start rejects invalid clock offsets before reserving an execution',async()=>{
  const t=setup();t.api.trackTabs([{id:1,url:'https://tickets.interpark.com/gates/ticket/26005452'}]);
  for(const entryOffsetMs of [-251,251,0.5,'25',NaN]){
    await assert.rejects(t.api.command('start',{entryOffsetMs}),/진입 시각 보정/);assert.equal(t.api.runs.current,null);
  }
});
test('Chrome server-clock offsets adjust only the page timer, keeping the official open time unchanged',async()=>{
  for(const offsetMs of [-250,0,250]){
    const t=setup({clockForGate:()=>({serverNowMs:100000,validForMs:60000,uncertaintyMs:20}),invoke:fn=>fn==='pageClock'?{pageMono:1000,documentId:'one'}:true});
    const run=t.start();run.entry.strategy='clock';run.entry.offsetMs=offsetMs;run.clockEligible=true;run.openAt=110000;run.clockTask=Promise.resolve();
    t.api.setClock({anchorMonoMs:100});await t.api.scheduleGateClock(run,t.api.current(),{phase:'armed'});
    const call=t.seen.calls.find(c=>c.fn==='setGateClock');assert.ok(call);assert.equal(call.arg.openAt,110000);assert.equal(call.arg.deadlineMono,11000+offsetMs);assert.equal(run.openAt,110000);
  }
});
test('Chrome server-clock positive offset also participates in sample freshness validation',async()=>{
  const t=setup({clockForGate:()=>({serverNowMs:100000,validForMs:10100,uncertaintyMs:20}),invoke:()=>true});
  const run=t.start();run.entry.strategy='clock';run.entry.offsetMs=250;run.clockEligible=true;run.openAt=110000;run.clockTask=Promise.resolve();t.api.setClock({anchorMonoMs:100});
  await t.api.scheduleGateClock(run,t.api.current(),{phase:'armed'});assert.equal(t.seen.calls.length,0);
});
test('Chrome entry transition waits without page calls and resumes only after the tab returns',async()=>{
  let returned=false;
  const t=setup({pause:({api})=>{if(!returned){returned=true;api.trackTabs([{id:1,url:'https://tickets.interpark.com/onestop/seat',documentId:'returned'}]);}}});
  t.api.trackTabs([{id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'}]);const run=t.start();run.inspectionOnly=true;t.api.trackTabs([]);
  const result=await t.api.autoLoop(run);assert.match(result.message,/진입 확인 완료/);assert.deepEqual(t.seen.pauses,[100]);assert.equal(t.seen.calls.length,0);assert.equal(t.seen.reads,0);assert.equal(run.entry.seatPageObserved,true);
});
test('Chrome entry transition stops after a bounded wait without replaying entry actions',async()=>{
  const t=setup({timeStep:16000});t.api.trackTabs([{id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'}]);const run=t.start();t.api.trackTabs([]);
  await assert.rejects(t.api.autoLoop(run),/15초 안에 확인/);assert.deepEqual(t.seen.pauses,[100]);assert.equal(t.seen.calls.length,0);assert.equal(t.seen.reads,0);
});
test('Chrome gate reads stop using the old document when the site navigates or opens its seat popup during the await',async()=>{
  for(const sameTab of [false,true])for(const adoptAt of ['gateStatus','gateState']){
    const parent={id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'};
    const t=setup({invoke:(fn,_arg,{api})=>{
      const name=fn?.name||fn;
      if(name===adoptAt)api.trackTabs(sameTab?[{id:1,url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'}]:[parent,{id:2,url:'https://tickets.interpark.com/onestop/seat',documentId:'seat',openerTabId:1}]);
      if(name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:true};
      if(name==='gateState')return null;
      throw Error('Unexpected follow-up to old gate: '+name);
    }});
    t.api.trackTabs([parent]);const run=t.start();run.entryActionsStarted=true;run.inspectionOnly=true;
    assert.match((await t.api.autoLoop(run)).message,/진입 확인 완료/);assert.equal(run.targetId,sameTab?1:2);
    assert.deepEqual(t.seen.calls.map(c=>c.fn),adoptAt==='gateStatus'?['gateStatus']:['gateStatus','gateState']);
    assert.equal(run.entry.seatPageObserved,true);assert.equal(t.seen.selections.length,0);
  }
});
test('Chrome clock preparation sends no timer installation to an old gate after popup adoption',async()=>{
  const parent={id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'};
  const t=setup({clockForGate:()=>({serverNowMs:100000,validForMs:60000,uncertaintyMs:20}),invoke:(fn,_arg,{api})=>{
    assert.equal(fn,'pageClock');api.trackTabs([parent,{id:2,url:'https://tickets.interpark.com/onestop/seat',documentId:'seat',openerTabId:1}]);return {pageMono:1000,documentId:'gate'};
  }});
  t.api.trackTabs([parent]);const run=t.start();run.entryActionsStarted=true;run.entry.strategy='clock';run.clockEligible=true;run.openAt=110000;run.clockTask=Promise.resolve();t.api.setClock({anchorMonoMs:100});
  await t.api.scheduleGateClock(run,t.api.current(),{phase:'armed'});assert.equal(run.targetId,2);assert.deepEqual(t.seen.calls.map(c=>c.fn),['pageClock']);
});
test('An initial gate notice is acknowledged once and entry-only inspection stops on the seat page without a delay',async()=>{
  const gate={id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'};
  const t=setup({invoke:(fn,arg,{api})=>{
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:true,enabled:true}};
    if(fn?.name==='clickKnown'){assert.equal(arg,'확인하고 예매하기');api.trackTabs([{...gate,url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'}]);return {clicked:true,present:true};}
    throw Error('Unexpected action: '+(fn?.name||fn));
  }});
  t.api.trackTabs([gate]);const run=t.start();run.inspectionOnly=true;
  assert.match((await t.api.autoLoop(run)).message,/진입 확인 완료/);assert.deepEqual(t.seen.calls.map(c=>c.fn),['gateStatus','clickKnown']);assert.deepEqual(t.seen.pauses,[]);assert.equal(t.seen.selections.length,0);
});
test('A late gate notice is noticed by the normal loop without adding an absent-notice wait',async()=>{
  const gate={id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'};let visible=false;
  const t=setup({pause:()=>{visible=true;},invoke:(fn,arg,{api})=>{
    if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',enabled:false,notice:{present:visible,enabled:visible}};
    if(fn==='gateState')return {runId:api.runs.current.id,phase:'armed',observedDisabled:true};
    if(fn?.name==='clickKnown'){assert.equal(arg,'확인하고 예매하기');api.trackTabs([{...gate,url:'https://tickets.interpark.com/onestop/seat',documentId:'seat'}]);return {clicked:true,present:true};}
    throw Error('Unexpected action: '+(fn?.name||fn));
  }});
  t.api.trackTabs([gate]);const run=t.start();run.inspectionOnly=true;
  assert.match((await t.api.autoLoop(run)).message,/진입 확인 완료/);assert.deepEqual(t.seen.pauses,[100]);assert.deepEqual(t.seen.calls.map(c=>c.fn),['gateStatus','gateState','gateStatus','clickKnown']);
});
test('An initial seat notice is accepted once before continuing the seat search, without a fixed wait',async()=>{
  let visible=true;
  const t=setup({rows:()=>pair(),invoke:fn=>{
    if(fn?.name==='scene')return {completed:false,selected:[],buttons:[],grades:[],hasSeats:!visible,notice:{present:visible,enabled:visible},dialog:visible?{kind:'unknown',text:'예매 안내'}:null};
    if(fn?.name==='clickKnown'){visible=false;return {present:true,clicked:true};}
    throw Error('Unexpected action');
  }}),run=t.start();
  assert.equal((await t.api.autoLoop(run)).completed,true);assert.equal(t.seen.calls.filter(c=>c.fn==='clickKnown').length,1);assert.equal(t.seen.selections.length,1);assert.deepEqual(t.seen.pauses,[]);
});
test('Auto-notice disabled waits for the user on both gate and seat pages without clicking',async()=>{
  for(const atGate of [true,false]){
    const t=setup({maxPauses:0,invoke:fn=>{
      if(fn?.name==='gateStatus')return {supported:true,goodsCode:'26005452',notice:{present:true,enabled:true}};
      if(fn?.name==='scene')return {completed:false,selected:[],buttons:[],grades:[],hasSeats:false,notice:{present:true,enabled:true},dialog:{kind:'unknown',text:'예매 안내'}};
      throw Error('Notice was not allowed to click');
    }});
    if(atGate)t.api.trackTabs([{id:1,url:'https://tickets.interpark.com/gates/ticket/26005452',documentId:'gate'}]);
    const run=t.start({autoNotice:false});await assert.rejects(t.api.autoLoop(run),/FIXTURE_END/);assert.match(run.status,/직접 확인 대기/);assert.equal(t.seen.calls.some(c=>c.fn==='clickKnown'),false);
  }
});
test('An unchanged notice after a successful acknowledgement is not clicked again and reports uncertain transition',async()=>{
  const t=setup({timeStep:11000,invoke:fn=>{
    if(fn?.name==='scene')return {completed:false,selected:[],buttons:[],grades:[],hasSeats:false,notice:{present:true,enabled:true}};
    if(fn?.name==='clickKnown')return {present:true,clicked:true};throw Error('Unexpected action');
  }}),run=t.start();
  await assert.rejects(t.api.autoLoop(run),/같은 버튼을 다시 누르지/);assert.equal(t.seen.calls.filter(c=>c.fn==='clickKnown').length,1);assert.equal(t.seen.selections.length,0);
});
test('A confirmed notice acknowledgement may follow one same-URL document replacement before continuing',async()=>{
  for(const atGate of [true,false]){
    const initial={id:1,url:atGate?'https://tickets.interpark.com/gates/ticket/26005452':'https://tickets.interpark.com/onestop/seat',documentId:'before-notice'};let visible=true;
    const t=setup({rows:()=>pair(),invoke:(fn,arg,{api})=>{
      if(fn?.name==='gateStatus'){
        if(!visible)api.trackTabs([{...initial,url:'https://tickets.interpark.com/onestop/seat',documentId:'final-seat'}]);
        return {supported:true,goodsCode:'26005452',notice:{present:visible,enabled:visible}};
      }
      if(fn?.name==='scene')return {completed:false,selected:[],buttons:[],grades:[],hasSeats:!visible,notice:{present:visible,enabled:visible}};
      if(fn?.name==='clickKnown'){assert.equal(arg,'확인하고 예매하기');visible=false;api.trackTabs([{...initial,documentId:'after-notice'}]);return {present:true,clicked:true};}
      throw Error('Unexpected action');
    }});
    t.api.trackTabs([initial]);const run=t.start();run.inspectionOnly=atGate;
    const result=await t.api.autoLoop(run);assert.ok(result.completed||/진입 확인 완료/.test(result.message));assert.equal(t.seen.calls.filter(c=>c.fn==='clickKnown').length,1);assert.deepEqual(t.seen.pauses,[]);
  }
});
test('A booking-context reset without document replacement is not waived by a notice acknowledgement',async()=>{
  const t=setup({rows:()=>pair(),invoke:(fn,_arg,{api})=>{
    if(fn?.name==='scene')return {completed:false,selected:[],buttons:[],grades:[],hasSeats:false,notice:{present:true,enabled:true}};
    if(fn?.name==='clickKnown'){api.scopeVersions.set(1,1);return {present:true,clicked:true};}throw Error('Unexpected action');
  }}),run=t.start();
  await assert.rejects(t.api.autoLoop(run),/경기 또는 회차가 변경/);assert.equal(t.seen.calls.filter(c=>c.fn==='clickKnown').length,1);assert.equal(t.seen.selections.length,0);
});
test('Chrome auto: cancellation during accepted completion retains confirmed success',async()=>{
  const t=setup({rows:()=>pair(),select:(_args,{api})=>{api.runs.cancel();return {completed:true,attempted:1};}}),run=t.start();
  assert.equal((await t.api.autoLoop(run)).completed,true);assert.equal(t.seen.selections.length,1);
});
test('Chrome auto: unknown response errors do not trigger another round',async()=>{
  const t=setup({rows:()=>pair(),select:()=>{throw Error('선택 결과 불명확');}}),run=t.start();
  await assert.rejects(t.api.autoLoop(run),/불명확/);assert.equal(t.seen.selections.length,1);assert.equal(run.retry.cycle,1);assert.equal(t.seen.backs,0);
});
test('Chrome auto: a map without navigation never retries the same rejected snapshot',async()=>{
  const t=setup({maxPauses:4,scene:()=>({buttons:[]}),rows:()=>pair(),select:args=>{args.excludedGroups.add(keyFor(args.groups[0]));return {exhausted:true,attempted:1};}}),run=t.start();
  await assert.rejects(t.api.autoLoop(run),/FIXTURE_END/);assert.equal(t.seen.selections.length,1);assert.equal(t.seen.backs,0);
});
test('Chrome auto: a changed map without navigation releases exclusions and finds a later candidate',async()=>{
  const t=setup({timeStep:1600,scene:()=>({buttons:[]}),rows:({api})=>pair(api.runs.current.retry.cycle>1?2:1),select:(args,{seen})=>{if(seen.selections.length===1){args.excludedGroups.add(keyFor(args.groups[0]));return {exhausted:true,attempted:1};}return {completed:true,attempted:1};}}),run=t.start();
  assert.equal((await t.api.autoLoop(run)).completed,true);assert.equal(t.seen.selections.length,2);assert.equal(t.seen.selections[1][0].seats[0].row,2);
});
test('Retry pacing backs off only exhausted searches and resets when observed availability changes',async()=>{
  const retry=new SeatRetry(),delays=[];
  retry.observe('A',pair(1));for(let i=0;i<6;i++)await retry.next({wait:async ms=>delays.push(ms)});
  assert.deepEqual(delays,[500,1000,2000,4000,5000,5000]);assert.equal(retry.observe('A',pair(1)),false);assert.equal(retry.observe('A',pair(2)),true);
  await retry.next({wait:async ms=>delays.push(ms)});assert.equal(delays.at(-1),500);
});
test('Selection chunks preserve conflict exclusions across 20 failures and allow candidate 21',async()=>{
  const groups=Array.from({length:21},(_,i)=>({seats:[{id:'s'+i,block:'118',row:1,number:i+1}]}));
  const info={selected:[],selectedGrades:[],selectedNames:[],completed:false,buttons:[{label:'선택 완료',enabled:true}],network:{healthy:true,sequence:0,pending:[],results:[]}};
  const selected=[];const adapter={snapshot:async()=>structuredClone(info),select:async seat=>{
    selected.push(seat.id);const seq=++info.network.sequence;
    if(seat.id!=='s20'){info.dialog={kind:'conflict',dismissible:true};info.network.results.push({seq,kind:'select',status:'conflict',seatIds:[seat.id]});}
    else{info.selected=[seat.id];info.selectedGrades=['레드석'];info.selectedNames=['118블럭 1열 21번'];info.network.results.push({seq,kind:'select',status:'ok',seatIds:[seat.id]});}
  },dismissConflict:async()=>{info.dialog=null;},deselect:async()=>{throw Error('No partial seats should exist');},complete:async()=>{info.completed=true;}};
  const args={groups,adapter,preferences:{quantity:1,excludeObstructed:true,autoComplete:true},excludedIds:new Set(),excludedGroups:new Set(),pollMs:1,timeoutMs:100,observationGraceMs:0};
  const first=await chooseCandidates(args);assert.equal(first.limited,true);assert.equal(first.attempted,20);assert.equal(info.selected.length,0);
  const second=await chooseCandidates(args);assert.equal(second.completed,true);assert.equal(second.attempted,1);assert.equal(selected.length,21);assert.equal(new Set(selected).size,21);
});

test('unmatched area configuration stops with a correction message instead of infinite cycling',async()=>{const t=setup({scene:()=>({hasSeats:false,grades:[{name:'블루존',count:20}]}),rows:()=>[]});await assert.rejects(t.api.autoLoop(t.start({areas:['블루존 오타']})),/현재 경기 목록에 없습니다/);assert.equal(t.seen.opened.length,0);});
