'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {reserveByCode,assertIdentity}=require('../src/direct-seat-api');
const {readBookingContext}=require('../src/booking-context');
const identity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
function fixture({captcha=false,reply,contextPatch={},initialPatch={},emptyBootstrap=false,headerName='수원삼성 vs 화성FC (10.18)',headerDate='2026.10.18(일) 2:00 PM'}={}){
 const context={sessionId:'private-session',channelType:'NOL',goods:{goodsCode:identity.goodsCode,placeCode:identity.placeCode,goodsName:'수원삼성 vs 화성FC (10.18)',reserved:true,isInterlocking:false,preOpt:'private-token',kindOfGoods:'01007'},playSeq:{playSeq:'001',playDate:'20261018',playTime:'2:00 PM'},...contextPatch};
 const initial={...context,...initialPatch},calls=[],state={};
 const id='seat_block_26009123:25001730:001:2',seat={id,blockKey:'001:001',gradeCode:'1'};
 const el={matches:()=>true,parentElement:{id:'seat_block_001:001'},getBoundingClientRect:()=>({width:2,height:2}),getAttribute:()=>'',textContent:''};
 const header={textContent:headerName,parentElement:{textContent:headerName+headerDate},getBoundingClientRect:()=>({width:100,height:20})};
 const sandbox={URL,Date,crypto:require('node:crypto').webcrypto,AbortSignal,window:state,location:{origin:'https://tickets.interpark.com',pathname:'/onestop/seat',href:'https://tickets.interpark.com/onestop/seat'},sessionStorage:{getItem:k=>k==='interpark/context'?JSON.stringify(context):null},getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{querySelector:s=>s==='#__NEXT_DATA__'?{textContent:JSON.stringify({props:{pageProps:emptyBootstrap?{}:{initData:initial}}})}:null,querySelectorAll:s=>s==='h3'?[header]:captcha&&s.includes('캡챠')?[el]:[],getElementById:key=>key===id?el:null},fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body,headers:options.headers});return reply?reply(calls.length,body):{ok:true,json:async()=>body.operationName?{data:{preselectSeat:true}}:{success:true,data:{}}};}};
 const original=sandbox.fetch;sandbox.fetch=async(...args)=>{const response=await original(...args);if(!reply&&args[0]==='/onestop/api/seats/select')return {ok:true,json:async()=>({unselectableSeatInfoIds:[]})};return response;};
 const run=vm.runInNewContext('const readBookingContext='+readBookingContext.toString()+';('+reserveByCode.toString()+')',sandbox);
 return {calls,state,context,run:arg=>run({expected:identity,seats:[seat],runId:'test',expiresAt:Date.now()+20000,...arg}),seat};
}
test('wrong game, venue, round and date are rejected before seat actions',()=>{
 for(const field of ['goodsCode','placeCode','playSeq','playDate'])assert.throws(()=>assertIdentity({...identity,playDate:'20261018'},{...identity,playDate:'20261018',[field]:'99999999'}),/달라/);
 assert.throws(()=>assertIdentity(identity,{}),/확인하지/);
 assert.equal(assertIdentity({...identity,playTime:'18:30'},{...identity,playTime:'6:30 PM'}).playSeq,'001');
});
test('code request preselects and confirms one seat with no DOM click or credential export',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.status,'server-completed');assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,'/onestop/gql');assert.equal(f.calls[0].body.variables.command.seatInfoId,f.seat.id.slice(11));assert.equal(f.calls[1].url,'/onestop/api/seats/select');assert.ok(!JSON.stringify(r).includes('private-'));
});

test('client-rendered booking with empty bootstrap validates session and visible event before the two requests',async()=>{
 const f=fixture({emptyBootstrap:true}),r=await f.run();assert.equal(r.status,'server-completed');assert.equal(f.calls.length,2);assert.ok(!JSON.stringify(r).includes('private-'));
});

test('empty-bootstrap fallback rejects mismatched visible name, date or time without requests',async()=>{
 for(const options of [{headerName:'다른 경기'},{headerDate:'2026.10.19(월) 2:00 PM'},{headerDate:'2026.10.18(일) 6:00 PM'}]){
  const f=fixture({emptyBootstrap:true,...options});assert.equal((await f.run()).code,'BOOKING_HEADER_MISMATCH');assert.equal(f.calls.length,0);
 }
});

test('an existing but inconsistent bootstrap is never ignored in favor of the session',async()=>{
 const f=fixture({initialPatch:{goods:{goodsCode:'99999999',placeCode:'25001730'}}});assert.equal((await f.run()).code,'BOOTSTRAP_CONTEXT_MISMATCH');assert.equal(f.calls.length,0);
});
test('CAPTCHA, wrong product, external system and existing reservation block requests',async()=>{
 for(const config of [{captcha:true},{initialPatch:{goods:{goodsCode:'99999999'}}},{contextPatch:{goods:{goodsCode:identity.goodsCode,placeCode:identity.placeCode,reserved:true,isInterlocking:true}}}]){const f=fixture(config);assert.equal((await f.run()).status,'blocked');assert.equal(f.calls.length,0);}
});
test('foreign seat id, expired command and wrong round issue no requests',async()=>{
 for(const arg of [{expected:{...identity,playSeq:'002'}},{expiresAt:0},{seats:[{id:'seat_block_99999999:25001730:001:2',blockKey:'001:001',gradeCode:'1'}]}]){const f=fixture();assert.equal((await f.run(arg)).status,'blocked');assert.equal(f.calls.length,0);}
});
test('confirmed seat conflict permits another candidate without completion',async()=>{
 const f=fixture({reply:async()=>({ok:true,json:async()=>({errors:[{extensions:{backendErrorCode:'P41150'}}]})})});const r=await f.run();assert.equal(r.status,'conflict');assert.equal(f.calls.length,1);assert.equal(f.state.__ticketDirectApi.held.length,0);
});
test('unknown timeout is never retried, including another invocation',async()=>{
 const f=fixture({reply:async()=>{throw Error('timeout');}});assert.equal((await f.run()).status,'uncertain');assert.equal((await f.run()).status,'blocked');assert.equal(f.calls.length,1);
});
test('HTTP success without confirmed selection result cannot advance',async()=>{
 for(const response of [{},{data:{preselectSeat:false}},{data:{preselectSeat:null}}]){const f=fixture({reply:async()=>({ok:true,json:async()=>response})});assert.equal((await f.run()).status,'uncertain');assert.equal(f.calls.length,1);}
});
test('ambiguous completion retains acknowledged hold and stops',async()=>{
 const f=fixture({reply:async n=>({ok:true,json:async()=>n===1?{data:{preselectSeat:true}}:{}})});assert.equal((await f.run()).status,'uncertain');assert.equal(f.calls.length,2);assert.equal(f.state.__ticketDirectApi.held.length,1);assert.equal((await f.run()).status,'blocked');
});
test('changing session or cancellation after selection prevents completion',async()=>{
 for(const cancel of [true,false]){let f;f=fixture({reply:async()=>{if(cancel)f.state.__ticketDirectApi.cancelled=true;else f.context.sessionId='changed';return {ok:true,json:async()=>({data:{preselectSeat:true}})};}});assert.equal((await f.run()).status,'uncertain');assert.equal(f.calls.length,1);}
});

test('header time comparison supports 24-hour formatting but never substring-matches noon',async()=>{
  assert.equal((await fixture({emptyBootstrap:true,headerDate:'2026.10.18(일) 14:00'}).run()).status,'server-completed');
  const wrong=fixture({emptyBootstrap:true,headerDate:'2026.10.18(일) 12:00 PM'});assert.equal((await wrong.run()).code,'BOOKING_HEADER_MISMATCH');assert.equal(wrong.calls.length,0);
  const invalid=fixture({emptyBootstrap:true,contextPatch:{playSeq:{playSeq:'001',playDate:'20261018',playTime:'14:70'}},headerDate:'2026.10.18(일) 14:70'});assert.equal((await invalid.run()).code,'BOOKING_HEADER_REQUIRED');assert.equal(invalid.calls.length,0);
});
test('bootstrap and session time formats may differ only when they identify the same minute',async()=>{
  assert.equal((await fixture({initialPatch:{playSeq:{playSeq:'001',playDate:'20261018',playTime:'14:00'}}}).run()).status,'server-completed');
});
