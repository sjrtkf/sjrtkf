'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {classifyEntryResponse,createEntryHttp}=require('../src/entry-http');
const {openingPlan,readPostseasonOpening}=require('../src/opening-schedule');
const endpoint='https://ent-waiting-api.interpark.com/waiting/api/secure-url';
const redirect='https://tickets.interpark.com/waiting?key=private-value';
test('entry response classifier never treats transport success as admission',()=>{
  assert.equal(classifyEntryResponse(200,{redirectUrl:redirect}).outcome,'redirect-ready');
  for(const url of ['https://tickets.interpark.com/waiting/error','https://tickets.interpark.com/onestop/error?errorCode=P40057','https://tickets.interpark.com/waiting?errorCode=P40057','https://evil.invalid/waiting','https://tickets.interpark.com/error','javascript:alert(1)','https://name:pass@tickets.interpark.com/waiting'])assert.equal(classifyEntryResponse(200,{redirectUrl:url}).outcome,'unknown');
  for(const [code,body,outcome] of [[403,{error:'P40057'},'not-open'],[403,{error:'AccessDenied_Blacklist'},'blocked'],[401,{error:'P40057'},'blocked'],[429,{error:'P40057'},'blocked'],[500,{error:'P40057'},'unknown'],[200,{error:'P40057'},'unknown'],[200,{},'unknown'],[403,{error:'P40057',redirectUrl:redirect},'blocked']])assert.equal(classifyEntryResponse(code,body).outcome,outcome);
  assert.ok(!JSON.stringify(classifyEntryResponse(200,{redirectUrl:redirect})).includes('private-value'));
});
function fixture(respond,{end=2000,start=0}={}){
  let mono=0,active=true,id=0;const timers=new Map(),calls=[],statuses=[];
  const original=async(...args)=>{calls.push({mono,args});return respond(calls.length);};
  const window={fetch:original};
  const ctx=vm.createContext({window,location:{href:'https://tickets.interpark.com/gates/ticket/26014421'},URL,Headers,Request,AbortSignal,performance:{now:()=>mono},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:mono+ms});return id;},clearTimeout:n=>timers.delete(n),assertActive:()=>{if(!active)throw Error('stopped');},onStatus:s=>statuses.push(s)});
  vm.runInContext(`const classifyEntryResponse=${classifyEntryResponse};const createEntryHttp=${createEntryHttp};globalThis.engine=createEntryHttp({startMono:${start},endMono:${end},assertActive,onStatus});`,ctx);
  const settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
  return {window,original,calls,statuses,engine:ctx.engine,settle,async advance(value){mono=value;for(const [key,t] of [...timers])if(t.at<=mono){timers.delete(key);t.fn();}await settle();},deactivate:()=>{active=false;},request:()=>window.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:'test',secureData:'test'})})};
}
const response=(status,body)=>({status,clone:()=>({text:async()=>JSON.stringify(body)})});
test('unverified not-open rejection never replays signed data',async()=>{
 const f=fixture(()=>response(403,{error:'P40057'}));await assert.rejects(f.request());await f.advance(5000);assert.equal(f.calls.length,1);assert.equal(f.engine.status.outcome,'not-open');f.engine.stop();assert.equal(f.window.fetch,f.original);
});
test('only one request is in flight and duplicate callers do not issue another POST',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const a=f.request(),b=f.request();await f.settle();await f.advance(900);assert.equal(f.calls.length,1);resolve(response(200,{redirectUrl:redirect}));await Promise.all([a,b]);assert.equal(f.calls.length,1);
});
test('timeouts and unclassified responses are not replayed',async()=>{
  for(const respond of [()=>{throw Error('timeout');},()=>response(403,{error:'NOT_KNOWN'}),()=>response(200,{})]){
    const f=fixture(respond),task=assert.rejects(f.request());await task;await f.advance(2000);assert.equal(f.calls.length,1);
  }
});
test('cancellation before dispatch prevents a request and restores fetch',async()=>{
 const f=fixture(()=>response(200,{redirectUrl:redirect}));const task=f.request();f.engine.stop();await assert.rejects(task);assert.equal(f.calls.length,0);assert.equal(f.window.fetch,f.original);
});
test('an in-flight success after cancellation cannot reach site navigation',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const rejection=assert.rejects(f.request());await f.settle();f.engine.stop();resolve(response(200,{redirectUrl:redirect}));await rejection;assert.equal(f.calls.length,1);
});
test('late duplicate after success still shares result without another request',async()=>{
 const f=fixture(()=>new Response(JSON.stringify({redirectUrl:redirect}),{status:200}));await (await f.request()).json();await f.advance(6000);const b=await f.request();assert.equal((await b.json()).redirectUrl,redirect);assert.equal(f.calls.length,1);f.engine.stop();
});
test('unrelated fetches pass through and malformed signed bodies never send',async()=>{
  const f=fixture(()=>response(200,{}));await f.window.fetch('https://example.test/data');assert.equal(f.calls.length,1);await assert.rejects(f.window.fetch(endpoint,{method:'POST',body:'{}'}));assert.equal(f.calls.length,1);
});
test('opening plan preserves the explicit gate time and refuses silent clock fallback',()=>{
  const now=Date.parse('2026-10-19T00:00:00Z'),future=now+3600000;
  assert.deepEqual(openingPlan({requested:future,official:now,strategy:'clock',now}),{openAt:future,clockEligible:true});
  assert.deepEqual(openingPlan({official:future,strategy:'clock',now}),{openAt:future,clockEligible:true});
  assert.throws(()=>openingPlan({strategy:'clock',now}),/시각/);
  for(const requested of [NaN,Infinity,-1,now+16*86400000])assert.throws(()=>openingPlan({requested,strategy:'clock',now}));
});
test('public schedule selects the exact goods code with explicit Korean timezone',async()=>{
  const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/postseason')?{widgets:[{widgetType:'GOODS_RESERVATION',contents:[{contentType:'GOODS_RESERVATION',link:{type:'API_URL',url:'/sports/goods?page=0'}}]}]}:{content:[{goodsCode:'26014421',placeCode:'26001228',bookingOpenTime:'2026-10-19T11:00:00'}]}});
  assert.equal((await readPostseasonOpening('26014421',fetcher)).openAt,Date.parse('2026-10-19T02:00:00Z'));
  assert.equal(await readPostseasonOpening('26014423',fetcher),null);
});


test('duplicate callers can independently consume the coalesced response body',async()=>{
 const f=fixture(()=>new Response(JSON.stringify({redirectUrl:redirect}),{status:200}));
 const [a,b]=await Promise.all([f.request(),f.request()]);assert.equal((await a.json()).redirectUrl,redirect);assert.equal((await b.json()).redirectUrl,redirect);assert.equal(f.calls.length,1);
});

test('a different signed operation is never given the first operations result',async()=>{
 const f=fixture(()=>new Response(JSON.stringify({redirectUrl:redirect}),{status:200}));await f.request();
 await assert.rejects(f.window.fetch(endpoint,{method:'POST',body:JSON.stringify({signature:'other',secureData:'other'})}),/CONFLICT/);
 assert.equal(f.calls.length,1);f.engine.stop();
});
test('a saved wrapper cannot supply a completed success after stop',async()=>{
 const f=fixture(()=>new Response(JSON.stringify({redirectUrl:redirect}),{status:200}));await f.request();const saved=f.window.fetch;f.engine.stop();
 await assert.rejects(saved(endpoint,{method:'POST',body:JSON.stringify({signature:'test',secureData:'test'})}),/STOPPED/);assert.equal(f.calls.length,1);
});
