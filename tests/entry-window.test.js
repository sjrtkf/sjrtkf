'use strict';
// Virtual time and in-memory responses only. No network transport is used.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createEntryHttp,classifyEntryResponse}=require('../src/entry-http');
const endpoint='https://ent-waiting-api.interpark.com/waiting/api/secure-url',redirect='https://tickets.interpark.com/waiting?key=fixture';
function fixture(respond,{start=100,end=4100,now=0,beforeSend=null}={}){
 let mono=now,id=0,active=true;const timers=new Map(),calls=[];
 const context=vm.createContext({window:{fetch:async(input,init)=>{const call={at:mono,init};calls.push(call);return respond(call,calls.length);}},location:{href:'https://tickets.interpark.com/gates/ticket/26014421'},URL,Headers,Request,AbortController,performance:{now:()=>mono},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:mono+Math.max(0,ms)});return id;},clearTimeout:id=>timers.delete(id),beforeSend,assertActive:()=>{if(!active)throw Error('LEASE_EXPIRED');}});
 vm.runInContext(`const classifyEntryResponse=${classifyEntryResponse};const createEntryHttp=${createEntryHttp};globalThis.engine=createEntryHttp({assertActive,beforeSend,getWindow:()=>({startMono:${start},endMono:${end}})});`,context);
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 return {calls,engine:context.engine,flush,expireLease:()=>active=false,jump:v=>mono=v,async advance(to){await flush();let n=0;for(;;){const ready=[...timers].filter(([,t])=>t.at<=to).sort((a,b)=>a[1].at-b[1].at)[0];if(!ready)break;assert.ok(++n<2000);const [id,t]=ready;timers.delete(id);mono=Math.max(mono,t.at);t.fn();await flush();}mono=to;await flush();},request:()=>context.window.fetch(endpoint,{method:'POST',body:JSON.stringify({signature:'fixture',secureData:'fixture'})})};
}
const response=(status,body,headers={})=>({status,headers:new Headers(headers),clone:()=>({text:async()=>JSON.stringify(body),json:async()=>body})});
const notOpen=()=>response(403,{error:'P40057'});
test('four-second window sends exactly 134 requests at 30ms slots, never outside the window',async()=>{
 const f=fixture(notOpen),rejected=assert.rejects(f.request(),/WINDOW_EXPIRED/);await f.advance(99);assert.equal(f.calls.length,0);await f.advance(4101);await rejected;assert.deepEqual(f.calls.map(c=>c.at),Array.from({length:134},(_,i)=>100+i*30));await f.advance(20000);assert.equal(f.calls.length,134);
});
test('late start after the window never sends a first request',async()=>{
 const f=fixture(notOpen,{now:4101});await assert.rejects(f.request(),/WINDOW_EXPIRED/);assert.equal(f.calls.length,0);
});
test('late timer skips missed slots instead of burst catchup',async()=>{
 const f=fixture(notOpen),rejected=assert.rejects(f.request());await f.advance(100);f.jump(208);await f.advance(208);assert.deepEqual(f.calls.map(c=>c.at),[100,208]);await f.advance(220);assert.deepEqual(f.calls.map(c=>c.at),[100,208,220]);f.engine.stop();await rejected;
});
test('first validated success aborts other requests and suppresses late successes',async()=>{
 const resolves=[];const f=fixture(()=>new Promise(r=>resolves.push(r))),task=f.request();await f.advance(160);assert.equal(f.calls.length,3);resolves[1](response(200,{redirectUrl:redirect}));await f.flush();assert.equal((await (await task).json()).redirectUrl,redirect);assert.equal(f.calls[0].init.signal.aborted,true);assert.equal(f.calls[2].init.signal.aborted,true);resolves[0](response(200,{redirectUrl:redirect}));resolves[2](notOpen());await f.advance(4200);assert.equal(f.calls.length,3);assert.equal(f.engine.status.outcome,'redirect-ready');
});
test('stop rejects promptly and aborts all pending requests',async()=>{
 const f=fixture(()=>new Promise(()=>{})),task=assert.rejects(f.request(),/STOPPED/);await f.advance(190);f.engine.stop();await task;assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>c.init.signal.aborted));await f.advance(9000);assert.equal(f.calls.length,4);
});
test('stop while waiting for preparation sends nothing',async()=>{
 const f=fixture(notOpen,{beforeSend:()=>new Promise(()=>{})}),task=assert.rejects(f.request(),/STOPPED/);await f.flush();f.engine.stop();await task;assert.equal(f.calls.length,0);
});
for(const [status,body,headers] of [[401,{error:'P40057'}],[429,{}],[403,{error:'AccessDenied_Blacklist'}],[503,{}, {'Retry-After':'1'}],[200,{}]])test('terminal response '+status+' '+JSON.stringify(body)+' halts retries',async()=>{
 const f=fixture(()=>response(status,body,headers)),task=assert.rejects(f.request());await f.advance(100);await task;await f.advance(4200);assert.equal(f.calls.length,1);assert.notEqual(f.engine.status.outcome,'pending');
});
test('not-open and transient server errors retry until a validated redirect',async()=>{
 const f=fixture((_,n)=>n===1?notOpen():n===2?response(503,{}):response(200,{redirectUrl:redirect})),task=f.request();await f.advance(160);assert.equal((await (await task).json()).redirectUrl,redirect);assert.deepEqual(f.calls.map(c=>c.at),[100,130,160]);
});
test('in-flight response may succeed after dispatch window closes',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r),{now:4100}),task=f.request();await f.advance(4101);assert.equal(f.calls.length,1);resolve(response(200,{redirectUrl:redirect}));await task;await f.advance(5000);assert.equal(f.calls.length,1);
});
test('unresponsive requests are aborted at bounded response deadline',async()=>{
 const f=fixture(()=>new Promise(()=>{})),task=assert.rejects(f.request());await f.advance(12100);await task;assert.equal(f.calls.length,134);assert.ok(f.calls.every(c=>c.init.signal.aborted));
});
test('lost lease prevents further dispatch and aborts existing requests',async()=>{
 const f=fixture(()=>new Promise(()=>{})),task=assert.rejects(f.request(),/LEASE_EXPIRED/);await f.advance(100);f.expireLease();await f.advance(130);await task;assert.equal(f.calls.length,1);assert.ok(f.calls[0].init.signal.aborted);
});
