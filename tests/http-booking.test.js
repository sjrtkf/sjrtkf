'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {httpBookingAction,httpBookingNavigate,planAdultPrices}=require('../src/http-booking');
const {readBookingContext}=require('../src/booking-context');
const identity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
const price={seatGrade:'1',pgCode:'PG002',priceGrade:'A',priceGradeName:'예매가',discountName:'성인',salesPrice:'10000',discountSalesPrice:'10000',priceMaxCount:4,discountSeq:'0'};
function fixture(options={}){
  const initial={sessionId:'private-session',channelType:'NOL',bizCode:'WEBBR',entMemberCode:'private-member',goods:{...identity,goodsName:'fixture',reserved:true,reservedSeat:true,isInterlocking:false,preOpt:'private-token',kindOfGoods:'01007',ticketMaxCount:4},playSeq:{playSeq:'001'}};
  if(options.goods)Object.assign(initial.goods,options.goods);
  const seats=[0,1].map(n=>({id:'seat_block_26009123:25001730:001:'+n,blockKey:'001:101',gradeCode:'1',grade:'일반석',rowIdx:0,colIdx:n,number:n+1}));
  const records=seats.map(s=>({seatInfoId:s.id.slice(11),seatGrade:'1',seatGradeName:'일반석',rowIdx:s.rowIdx,colIdx:s.colIdx,seatNo:String(s.number),rowNo:'1열',isExposable:true,seatGroupId:null}));
  const store=new Map([['interpark/context',JSON.stringify(initial)]]),calls=[],routes=[],window={next:{router:{push:async route=>{routes.push(route);return true;}}}};
  const el={matches:()=>true,parentElement:{id:'seat_block_001:101'},getBoundingClientRect:()=>({width:10,height:10}),getAttribute:()=>'',click(){throw Error('DOM click forbidden');}};
  const cache=new Map([['/getContextData/undefined',{data:initial}]]);
  window.webpackChunk_N_E=[];window.webpackChunk_N_E.push=entry=>entry[2](id=>id===74133?{F:{getContextData:()=>JSON.parse(store.get('interpark/context'))}}:{d:{cache,mutate:async(k,data)=>cache.set(k,{data})}});
  let intercept=options.reply;
  const sandbox={URL,URLSearchParams,Date,AbortSignal,crypto:require('node:crypto').webcrypto,window,location:{origin:'https://tickets.interpark.com',pathname:'/onestop/seat',href:'https://tickets.interpark.com/onestop/seat'},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{querySelector:s=>s==='#__NEXT_DATA__'?{textContent:JSON.stringify({props:{pageProps:{initData:initial}}})}:null,querySelectorAll:s=>options.blocked&&s.includes('alertdialog')?[el]:[],getElementById:id=>seats.some(v=>v.id===id)?el:null},fetch:async(url,opts)=>{
    const body=opts.body?JSON.parse(opts.body):null,call={url,body,opts};calls.push(call);
    let data;if(url.startsWith('/onestop/api/seatMeta?'))data=[{blockKey:'001:101',seats:records}];
    else if(url.startsWith('/onestop/api/prices/'))data={prices:[{seatGrade:'1',ticketMaxCount:4,priceList:[{...price,...options.price}]}]};
    else if(body?.operationName==='PreselectSeat')data={data:{preselectSeat:true}};
    else if(body?.operationName==='DeselectSeat')data={data:{deselectSeat:true}};
    else if(body?.operationName==='ValidatePricingSelection')data={data:{validatePricingSelection:true}};
    else if(url==='/onestop/api/seats/select')data={unselectableSeatInfoIds:[]};else throw Error('Unexpected request');
    const result=intercept?await intercept(call,data):data,status=options.httpStatus||200;return {ok:status<400,status,text:async()=>JSON.stringify(result)};
  }};
  vm.createContext(sandbox);vm.runInContext('const readBookingContext='+readBookingContext.toString()+';const planAdultPrices='+planAdultPrices.toString()+';globalThis.action='+httpBookingAction.toString()+';globalThis.navigate='+httpBookingNavigate.toString(),sandbox);
  const invoke=arg=>sandbox.action({runId:'fixture-run',...arg}),begin=arg=>invoke({action:'begin',expected:identity,seats,quantity:2,expiresAt:Date.now()+60000,...arg});
  return {sandbox,store,calls,routes,seats,records,invoke,begin,context:()=>JSON.parse(store.get('interpark/context')),setContext:c=>store.set('interpark/context',JSON.stringify(c)),reply:fn=>{intercept=fn;},navigate:()=>sandbox.navigate({runId:'fixture-run',expected:identity,expiresAt:Date.now()+5000}),async run(){let result=await begin();for(let i=0;i<30&&result.status==='pending'&&result.stage!=='ready';i++)result=await invoke({action:'step'});return result;}};
}
test('real HTTP coordinator selects two seats, validates adult quantities and stores native context without clicks',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.stage,'ready');assert.equal(result.requestCount,6);assert.equal(f.calls.length,6);
  assert.equal(f.context().seats.length,2);assert.equal(f.context().prices[0].selectedSeatCount,2);assert.equal(result.validated,true);
  assert.ok(!JSON.stringify(result).includes('private-'));assert.ok(!JSON.stringify(result).includes('pgPrice'));
  const verify=f.calls.at(-1);assert.equal(verify.body.operationName,'ValidatePricingSelection');assert.deepEqual(verify.body.variables.selectedPrices,[{seatGrade:'1',priceGrade:'A',selectCnt:2}]);
  await f.navigate();assert.deepEqual(f.routes,['/payment']);await assert.rejects(f.navigate(),/NOT_CONFIRMED/);assert.equal(f.routes.length,1);
  await f.invoke({action:'step'});assert.equal(f.calls.length,6);
});
test('preorder routing matches the native ordinary adult-price flow',async()=>{const f=fixture({goods:{isPreOrder:true}});await f.run();await f.navigate();assert.deepEqual(f.routes,['/preorder']);});
test('a known conflict releases only acknowledged holds before another candidate can run',async()=>{
  const f=fixture({reply:(call,data)=>call.body?.operationName==='PreselectSeat'&&call.body.variables.command.seatInfoId.endsWith(':1')?{errors:[{extensions:{backendErrorCode:'P41150'}}]}:data});
  const r=await f.run();assert.equal(r.status,'conflict');assert.equal(r.stage,'released');assert.equal(f.context().seats.length,0);
  assert.deepEqual(f.calls.filter(v=>v.body?.operationName==='DeselectSeat').map(v=>v.body.variables.command.seatInfoId),[f.seats[0].id.slice(11)]);assert.ok(!f.calls.some(v=>v.url==='/onestop/api/seats/select'));
});
test('timeouts and mixed GraphQL failures never retry or navigate',async()=>{
  for(const reply of [(call,data)=>{if(call.body?.operationName==='PreselectSeat')throw Error('timeout');return data;},(call,data)=>call.body?.operationName==='PreselectSeat'?{errors:[{extensions:{backendErrorCode:'P41150'}},{message:'unknown'}]}:data]){
    const f=fixture({reply}),r=await f.run();assert.equal(r.status,'uncertain');const count=f.calls.length;await f.invoke({action:'step'});assert.equal(f.calls.length,count);await assert.rejects(f.navigate());assert.equal(f.routes.length,0);
  }
});
test('HTTP 200 with empty completion or false pricing validation is not success',async()=>{
  for(const stage of ['confirm','validate']){const f=fixture({reply:(call,data)=>stage==='confirm'&&call.url==='/onestop/api/seats/select'?{}:stage==='validate'&&call.body?.operationName==='ValidatePricingSelection'?{data:{validatePricingSelection:false}}:data});const r=await f.run();assert.notEqual(r.stage,'ready');await assert.rejects(f.navigate());assert.equal(f.routes.length,0);}
});
test('seat metadata mismatch stops before hold requests',async()=>{const f=fixture();f.records[0].seatNo='999';const r=await f.run();assert.equal(r.code,'HTTP_METADATA_MISMATCH');assert.equal(f.calls.length,1);});
test('unsupported adult price and certification requirements stop before any hold',async()=>{
  for(const p of [{priceGradeName:'청소년'},{isMembership:true},{randomCertifySeq:'123'},{discountSalesPrice:'9000'},{priceMaxCount:1}]){const f=fixture({price:p}),r=await f.run();assert.equal(r.status,'blocked');assert.equal(f.calls.length,2);assert.equal(f.context().seats,undefined);}
});
test('cancellation during an accepted hold prevents confirmation and persists the acknowledged seat',async()=>{
  const f=fixture();f.reply(async(call,data)=>{if(call.body?.operationName==='PreselectSeat')await f.invoke({action:'cancel'});return data;});const r=await f.run();assert.equal(r.code,'HTTP_CANCELLED');assert.equal(f.context().seats.length,1);assert.equal(f.calls.length,3);await assert.rejects(f.navigate());
});
test('concurrent step calls share the pending operation rather than duplicate it',async()=>{
  const f=fixture();let release;f.reply((_call,data)=>new Promise(resolve=>{release=()=>resolve(data);}));await f.begin();const first=f.invoke({action:'step'});await new Promise(r=>setImmediate(r));const second=await f.invoke({action:'step'});assert.equal(second.stage,'metadata');assert.equal(f.calls.length,1);release();await first;
});
test('session changes during a response prevent all later requests and context writes',async()=>{
  const f=fixture();f.reply((call,data)=>{if(call.body?.operationName==='PreselectSeat'){const c=f.context();c.sessionId='changed';f.setContext(c);}return data;});const r=await f.run();assert.equal(r.code,'HTTP_CONTEXT_CHANGED');assert.equal(f.calls.length,3);assert.equal(f.context().seats,undefined);
});
test('manual price edits after validation cannot be sent by navigation',async()=>{const f=fixture();await f.run();const c=f.context();c.prices[0].pgPrice.discountSalesPrice='1';f.setContext(c);await assert.rejects(f.navigate(),/CONTEXT_CHANGED/);assert.equal(f.routes.length,0);});
test('existing CAPTCHA/dialog blocks all requests',async()=>{const f=fixture({blocked:true}),r=await f.run();assert.equal(r.code,'HTTP_PAGE_BLOCKED');assert.equal(f.calls.length,0);});
test('ambiguous adult entries never select the first arbitrary price',()=>{assert.throws(()=>planAdultPrices([{seatGrade:'1',ticketMaxCount:4,priceList:[price,{...price,priceGrade:'B'}]}],[{seatGrade:'1'}]),/AMBIGUOUS/);});
module.exports={fixture};

test('seat-only mode stops after acknowledged holds and synchronizes without confirming or pricing',async()=>{
  const f=fixture();let r=await f.begin({stopAfterSeats:true});
  for(let i=0;i<10&&r.stage!=='selected';i++)r=await f.invoke({action:'step'});
  assert.equal(r.stage,'selected');assert.equal(f.calls.length,3);
  await f.sandbox.navigate({runId:'fixture-run',expected:identity,syncOnly:true,expiresAt:Date.now()+5000});
  assert.equal(f.routes.length,0);assert.equal(f.context().prices,undefined);
  assert.ok(!f.calls.some(c=>c.url.includes('/prices/')||c.url.endsWith('/select')));
  await f.invoke({action:'step'});assert.equal(f.calls.length,3);
});

test('existing price-page seats resume with price lookup and validation only',async()=>{
  const f=fixture(),c=f.context();c.seats=f.records.map(v=>({...v,blockKey:'001:101'}));f.setContext(c);f.sandbox.location.href+='?step=price';
  let r=await f.begin({resumePrice:true});for(let i=0;i<5&&r.stage!=='ready';i++)r=await f.invoke({action:'step'});
  assert.equal(r.stage,'ready');assert.equal(f.calls.length,2);assert.ok(!f.calls.some(c=>c.body?.operationName==='PreselectSeat'));await f.navigate();assert.equal(f.routes.length,1);
});

test('a restarted run cannot replay an unresolved hold even if its in-memory state is gone',async()=>{
  const f=fixture();f.reply((call,data)=>{if(call.body?.operationName==='PreselectSeat')throw Error('lost');return data;});
  await f.run();delete f.sandbox.window.__ticketHttpBooking;const count=f.calls.length;
  await assert.rejects(f.begin({runId:'second-run'}),/PREVIOUS_RESULT_PENDING/);assert.equal(f.calls.length,count);
});

test('missing site cache integration cannot dispatch next-page navigation',async()=>{
  const f=fixture();await f.run();delete f.sandbox.window.webpackChunk_N_E;
  await assert.rejects(f.navigate(),/CONTEXT_SYNC_UNAVAILABLE/);assert.equal(f.routes.length,0);
});

test('expired session and changed session during final navigation cannot dispatch',async()=>{
  const f=fixture();f.store.set('interpark/bsRef',String(Date.now()-1));const result=await f.run();assert.equal(result.code,'HTTP_SESSION_EXPIRED');assert.equal(f.calls.length,0);
  const g=fixture();await g.run();const c=g.context();c.sessionId='new';g.setContext(c);await assert.rejects(g.navigate(),/CONTEXT_CHANGED/);assert.equal(g.routes.length,0);
});

test('price units, minimums and caps follow the inspected price component rules',()=>{
  const plan=(type,n,count)=>planAdultPrices([{seatGrade:'1',ticketMaxCount:4,priceList:[{...price,priceSettingType:type,priceSettingCount:n}]}],Array.from({length:count},()=>({seatGrade:'1'})));
  for(const [type,n,count] of [['L8003',2,2],['L8004',2,3],['L8005',2,2],['L8006',2,2]])assert.equal(plan(type,n,count)[0].selectedSeatCount,count);
  for(const [type,n,count] of [['L8003',2,3],['L8004',2,1],['L8005',2,3],['L8006',2,1]])assert.throws(()=>plan(type,n,count),/QUANTITY_LIMIT/);
  assert.throws(()=>plan('unknown',1,1),/RULE_UNSUPPORTED/);
});

test('HTTP 500 never counts as a recoverable conflict even with a familiar backend code',async()=>{
  const f=fixture({httpStatus:500,reply:()=>({backendErrorCode:'P41150'})});const r=await f.run();assert.equal(r.status,'blocked');assert.equal(r.httpStatus,500);assert.equal(r.apiCode,'P41150');assert.equal(f.calls.length,1);
});

test('explicit completion of a prior seat-only selection does not preselect it again',async()=>{
  const f=fixture();let r=await f.begin({stopAfterSeats:true});while(r.stage!=='selected')r=await f.invoke({action:'step'});
  await f.invoke({action:'cancel'});
  r=await f.begin({runId:'next-run',resumeSelected:true});
  for(let i=0;i<10&&r.stage!=='ready';i++)r=await f.invoke({action:'step',runId:'next-run'});
  assert.equal(r.stage,'ready');assert.equal(f.calls.filter(c=>c.body?.operationName==='PreselectSeat').length,2);
  assert.equal(f.calls.filter(c=>c.url==='/onestop/api/seats/select').length,1);
});

test('failed conflict cleanup stops without offering another candidate',async()=>{
  const f=fixture({reply:(call,data)=>call.body?.operationName==='DeselectSeat'?{data:{deselectSeat:false}}:call.body?.operationName==='PreselectSeat'&&call.body.variables.command.seatInfoId.endsWith(':1')?{errors:[{extensions:{backendErrorCode:'P41150'}}]}:data});
  const r=await f.run();assert.equal(r.status,'uncertain');assert.equal(f.context().seats.length,1);
  await assert.rejects(f.begin({runId:'retry'}),/PREVIOUS_RESULT_PENDING/);
});

test('navigation capability check is read-only and rejects missing cache before holds',async()=>{
  const f=fixture();const args={runId:'check',expected:identity,expiresAt:Date.now()+5000,checkOnly:true};
  assert.equal((await f.sandbox.navigate(args)).supported,true);assert.equal(f.calls.length,0);assert.equal(f.routes.length,0);assert.equal(f.store.has('baseball/http-booking'),false);
  delete f.sandbox.window.webpackChunk_N_E;await assert.rejects(f.sandbox.navigate(args),/CONTEXT_SYNC_UNAVAILABLE/);
});

test('expiry after validation prevents navigation without replaying validation',async()=>{
  const f=fixture();await f.run();f.store.set('interpark/reserveExpireTime',String(Date.now()-1));await assert.rejects(f.navigate(),/SESSION_EXPIRED/);assert.equal(f.routes.length,0);assert.equal(f.calls.length,6);
});
