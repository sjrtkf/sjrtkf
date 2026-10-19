'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {httpBookingAction,httpBookingNavigate,planAdultPrices}=require('../src/http-booking');
const {readBookingContext}=require('../src/booking-context');
const {parseSeatLabels}=require('../src/metadata');
const identity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
const price={seatGrade:'1',pgCode:'PG002',priceGrade:'A',priceGradeName:'예매가',discountName:'성인',salesPrice:'10000',discountSalesPrice:'10000',priceMaxCount:4,discountSeq:'0'};
function fixture(options={}){
  const initial={sessionId:'private-session',channelType:'NOL',bizCode:'WEBBR',entMemberCode:'private-member',goods:{...identity,goodsName:'fixture',reserved:true,reservedSeat:true,isInterlocking:false,preOpt:'private-token',kindOfGoods:'01007',ticketMaxCount:4},playSeq:{playSeq:'001'}};
  if(options.goods)Object.assign(initial.goods,options.goods);
  const seats=[0,1].map(n=>({id:'seat_block_26009123:25001730:001:'+n,blockKey:'001:101',gradeCode:'1',grade:'일반석',rowIdx:0,colIdx:n,row:1,rowLabel:'1',rowKind:'numeric',number:n+1}));
  const records=seats.map(s=>({seatInfoId:s.id.slice(11),blockKey:s.blockKey,seatGrade:'1',seatGradeName:'일반석',rowIdx:s.rowIdx,colIdx:s.colIdx,seatNo:String(s.number),rowNo:'1열',isExposable:true,seatGroupId:null}));
  const store=new Map([['interpark/context',JSON.stringify(initial)]]),calls=[],routes=[],window={next:{router:{push:async route=>{routes.push(route);return true;}}}};
  const el={matches:()=>true,parentElement:{id:'seat_block_001:101'},getBoundingClientRect:()=>({width:10,height:10}),getAttribute:()=>'',click(){throw Error('DOM click forbidden');}};
  const cache=new Map([['/getContextData/undefined',{data:initial}]]);
  window.webpackChunk_N_E=[];window.webpackChunk_N_E.push=entry=>entry[2](id=>id===74133?{F:{getContextData:()=>JSON.parse(store.get('interpark/context'))}}:{d:{cache,mutate:async(k,data)=>cache.set(k,{data})}});
  let intercept=options.reply;
  const sandbox={URL,URLSearchParams,Date,AbortSignal,crypto:require('node:crypto').webcrypto,window,location:{origin:'https://tickets.interpark.com',pathname:'/onestop/seat',href:'https://tickets.interpark.com/onestop/seat'},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},getComputedStyle:()=>({display:'block',visibility:'visible'}),document:{querySelector:s=>s==='#__NEXT_DATA__'?{textContent:JSON.stringify({props:{pageProps:{initData:initial}}})}:null,querySelectorAll:s=>options.blocked&&s.includes('alertdialog')?[el]:[],getElementById:id=>seats.some(v=>v.id===id)?el:null},fetch:async(url,opts)=>{
    const body=opts.body?JSON.parse(opts.body):null,call={url,body,opts};calls.push(call);
    const blockKeys=new URL(url,'https://tickets.interpark.com').searchParams.getAll('blockKeys'),inBlock=key=>records.filter(v=>v.blockKey===key);
    let data;if(url.startsWith('/onestop/api/seatMeta?'))data=blockKeys.map(blockKey=>({blockKey,seats:inBlock(blockKey)}));
    else if(url.startsWith('/onestop/api/seatStatus?'))data={data:blockKeys.map(blockKey=>'f'.repeat(Math.ceil(inBlock(blockKey).length/4)))};
    else if(url.startsWith('/onestop/api/prices/'))data={prices:[{seatGrade:'1',ticketMaxCount:4,priceList:[{...price,...options.price}]}]};
    else if(body?.operationName==='PreselectSeat')data={data:{preselectSeat:true}};
    else if(body?.operationName==='DeselectSeat')data={data:{deselectSeat:true}};
    else if(body?.operationName==='BulkPreselectSeats')data={data:{bulkPreselectSeats:true}};
    else if(body?.operationName==='BulkDeselectSeats')data={data:{bulkDeselectSeats:true}};
    else if(body?.operationName==='ValidatePricingSelection')data={data:{validatePricingSelection:true}};
    else if(url==='/onestop/api/seats/select')data={unselectableSeatInfoIds:[]};else throw Error('Unexpected request');
    const result=intercept?await intercept(call,data):data,status=options.httpStatus||200;return {ok:status<400,status,text:async()=>JSON.stringify(result)};
  }};
  vm.createContext(sandbox);vm.runInContext('const readBookingContext='+readBookingContext.toString()+';const parseSeatLabels='+parseSeatLabels.toString()+';const planAdultPrices='+planAdultPrices.toString()+';globalThis.action='+httpBookingAction.toString()+';globalThis.navigate='+httpBookingNavigate.toString(),sandbox);
  const invoke=arg=>sandbox.action({runId:'fixture-run',...arg}),begin=arg=>invoke({action:'begin',expected:identity,seats,quantity:2,expiresAt:Date.now()+60000,...arg});
  return {sandbox,store,calls,routes,seats,records,invoke,begin,context:()=>JSON.parse(store.get('interpark/context')),setContext:c=>store.set('interpark/context',JSON.stringify(c)),reply:fn=>{intercept=fn;},navigate:()=>sandbox.navigate({runId:'fixture-run',expected:identity,expiresAt:Date.now()+5000}),async run(){let result=await begin();for(let i=0;i<30&&result.status==='pending'&&result.stage!=='ready';i++)result=await invoke({action:'step'});return result;}};
}
test('real HTTP coordinator selects two seats, validates adult quantities and stores native context without clicks',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.stage,'ready');assert.equal(result.requestCount,7);assert.equal(f.calls.length,7);
  assert.equal(f.context().seats.length,2);assert.equal(f.context().prices[0].selectedSeatCount,2);assert.equal(result.validated,true);
  assert.ok(!JSON.stringify(result).includes('private-'));assert.ok(!JSON.stringify(result).includes('pgPrice'));
  const verify=f.calls.at(-1);assert.equal(verify.body.operationName,'ValidatePricingSelection');assert.deepEqual(verify.body.variables.selectedPrices,[{seatGrade:'1',priceGrade:'A',selectCnt:2}]);
  await f.navigate();assert.deepEqual(f.routes,['/payment']);await assert.rejects(f.navigate(),/NOT_CONFIRMED/);assert.equal(f.routes.length,1);
  await f.invoke({action:'step'});assert.equal(f.calls.length,7);
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
test('seat metadata mismatch stops before hold requests',async()=>{const f=fixture();f.records[0].seatNo='999';const r=await f.run();assert.equal(r.code,'HTTP_METADATA_CHANGED');assert.equal(f.calls.length,1);});
test('unsupported adult price and certification requirements stop before any hold',async()=>{
  for(const p of [{priceGradeName:'청소년'},{isMembership:true},{randomCertifySeq:'123'},{discountSalesPrice:'9000'},{priceMaxCount:1}]){const f=fixture({price:p}),r=await f.run();assert.equal(r.status,'blocked');assert.equal(f.calls.length,2);assert.equal(f.context().seats,undefined);}
});
test('cancellation during an accepted hold prevents confirmation and persists the acknowledged seat',async()=>{
  const f=fixture();f.reply(async(call,data)=>{if(call.body?.operationName==='PreselectSeat')await f.invoke({action:'cancel'});return data;});const r=await f.run();assert.equal(r.code,'HTTP_CANCELLED');assert.equal(f.context().seats.length,1);assert.equal(f.calls.length,4);await assert.rejects(f.navigate());
});
test('concurrent step calls share the pending operation rather than duplicate it',async()=>{
  const f=fixture();let release;f.reply((_call,data)=>new Promise(resolve=>{release=()=>resolve(data);}));await f.begin();const first=f.invoke({action:'step'});await new Promise(r=>setImmediate(r));const second=await f.invoke({action:'step'});assert.equal(second.stage,'metadata');assert.equal(f.calls.length,1);release();await first;
});
test('session changes during a response prevent all later requests and context writes',async()=>{
  const f=fixture();f.reply((call,data)=>{if(call.body?.operationName==='PreselectSeat'){const c=f.context();c.sessionId='changed';f.setContext(c);}return data;});const r=await f.run();assert.equal(r.code,'HTTP_CONTEXT_CHANGED');assert.equal(f.calls.length,4);assert.equal(f.context().seats,undefined);
});
test('manual price edits after validation cannot be sent by navigation',async()=>{const f=fixture();await f.run();const c=f.context();c.prices[0].pgPrice.discountSalesPrice='1';f.setContext(c);await assert.rejects(f.navigate(),/CONTEXT_CHANGED/);assert.equal(f.routes.length,0);});
test('existing CAPTCHA/dialog blocks all requests',async()=>{const f=fixture({blocked:true}),r=await f.run();assert.equal(r.code,'HTTP_PAGE_BLOCKED');assert.equal(f.calls.length,0);});
test('ambiguous adult entries never select the first arbitrary price',()=>{assert.throws(()=>planAdultPrices([{seatGrade:'1',ticketMaxCount:4,priceList:[price,{...price,priceGrade:'B'}]}],[{seatGrade:'1'}]),/AMBIGUOUS/);});
module.exports={fixture};

test('seat-only mode stops after acknowledged holds and synchronizes without confirming or pricing',async()=>{
  const f=fixture();let r=await f.begin({stopAfterSeats:true});
  for(let i=0;i<10&&r.stage!=='selected';i++)r=await f.invoke({action:'step'});
  assert.equal(r.stage,'selected');assert.equal(f.calls.length,4);
  await f.sandbox.navigate({runId:'fixture-run',expected:identity,syncOnly:true,expiresAt:Date.now()+5000});
  assert.equal(f.routes.length,0);assert.equal(f.context().prices,undefined);
  assert.ok(!f.calls.some(c=>c.url.includes('/prices/')||c.url.endsWith('/select')));
  await f.invoke({action:'step'});assert.equal(f.calls.length,4);
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
  const f=fixture();await f.run();f.store.set('interpark/reserveExpireTime',String(Date.now()-1));await assert.rejects(f.navigate(),/SESSION_EXPIRED/);assert.equal(f.routes.length,0);assert.equal(f.calls.length,7);
});

function wheelchairFixture(options={}){
  const f=fixture(options),{parseMetadata,enrich}=require('../src/metadata'),record=f.records[0];
  Object.assign(record,{seatGradeName:'1루 K5 휠체어장애인석',rowNo:'101블록',seatNo:'W4-1',rowIdx:34,colIdx:8,seatGroupId:record.seatInfoId+'::1::1'});
  const parsed=parseMetadata([{blockKey:'001:101',seats:f.records}]);
  f.seats[0]=enrich([{id:f.seats[0].id,kind:'seat',available:true}],new Map(parsed.map(s=>[s.id,s])))[0];
  f.runSingleton=async(stopAfterSeats=true)=>{let r=await f.begin({seats:[f.seats[0]],quantity:1,stopAfterSeats});for(let i=0;i<15&&r.status==='pending'&&!['selected','ready'].includes(r.stage);i++)r=await f.invoke({action:'step'});return r;};
  return f;
}

test('observed one-person wheelchair group uses native bulk selection and preserves original labels',async()=>{
  const f=wheelchairFixture(),r=await f.runSingleton();
  assert.equal(r.stage,'selected');assert.equal(r.heldCount,1);assert.equal(f.calls.length,3);
  const call=f.calls[2];assert.equal(call.body.operationName,'BulkPreselectSeats');
  assert.match(call.body.query,/BulkPreselectSeatsCommand!/);
  assert.deepEqual(call.body.variables.command,{playSeq:'001',blockKey:'001:101',seatGrade:'1',seatInfoIds:[f.records[0].seatInfoId]});
  assert.equal(f.context().seats[0].rowNo,'101블록');assert.equal(f.context().seats[0].seatNo,'W4-1');
  assert.equal(f.seats[0].row,null);assert.equal(f.seats[0].number,null);
  await f.sandbox.navigate({runId:'fixture-run',expected:identity,syncOnly:true,expiresAt:Date.now()+5000});
  assert.equal(f.routes.length,0);assert.equal(f.calls.length,3);
});

test('wheelchair metadata changes and incomplete evidence stop before any selection',async()=>{
  const changes=[
    f=>{f.records[0].rowNo='102블록';},
    f=>{f.records[0].seatNo='W5-1';},
    f=>{f.records[0].seatGroupId+='x';},
    f=>{f.records[0].seatGroupId=null;},
    f=>{f.records[0].isExposable=false;},
    f=>{f.records[0].seatGradeName='일반석';},
    f=>{f.records[0].rowIdx++;},
    f=>{f.records[0].colIdx++;},
    f=>{f.records.push({...f.records[0],seatInfoId:'hidden-member',isExposable:false,rowIdx:null,colIdx:null});},
    f=>{f.seats[0].singletonGroup=false;},
    f=>{f.seats[0].groupSize=2;},
    f=>{f.seats[0].rawSeatNumber='W99-1';},
    f=>{f.seats[0].block='999';}
  ];
  for(const change of changes){const f=wheelchairFixture();change(f);const r=await f.runSingleton();assert.equal(r.code,'HTTP_METADATA_CHANGED');assert.equal(r.status,'blocked');assert.equal(f.calls.length,1);assert.equal(f.context().seats,undefined);}
});

test('one-person wheelchair format cannot be used in a multiple-ticket request',async()=>{
  const f=wheelchairFixture(),r=await f.run();assert.equal(r.code,'HTTP_METADATA_CHANGED');assert.equal(f.calls.length,1);
});

test('a rejected wheelchair bulk selection never releases an unacknowledged seat',async()=>{
  const f=wheelchairFixture({reply:(call,data)=>call.body?.operationName==='BulkPreselectSeats'?{errors:[{extensions:{backendErrorCode:'P41150'}}]}:data}),r=await f.runSingleton();
  assert.equal(r.status,'conflict');assert.equal(r.stage,'released');assert.equal(f.calls.length,3);assert.equal(r.heldCount,0);
  assert.ok(!f.calls.some(c=>c.body?.operationName?.includes('Deselect')));
});

test('a completion conflict releases an acknowledged singleton using native bulk deselection',async()=>{
  const f=wheelchairFixture({reply:(call,data)=>call.url==='/onestop/api/seats/select'?{backendErrorCode:'P41150'}:data}),r=await f.runSingleton(false);
  assert.equal(r.status,'conflict');assert.equal(r.stage,'released');assert.equal(f.context().seats.length,0);
  const cleanup=f.calls.at(-1);assert.equal(cleanup.body.operationName,'BulkDeselectSeats');assert.match(cleanup.body.query,/BulkDeselectSeatsCommand!/);
  assert.deepEqual(cleanup.body.variables.command,{seatInfoIds:[f.records[0].seatInfoId]});
  assert.ok(!f.calls.some(c=>['PreselectSeat','DeselectSeat'].includes(c.body?.operationName)));
});

test('unknown bulk outcomes preserve the receipt and cannot be replayed or routed',async()=>{
  for(const mode of ['timeout','false','cancel','cleanup']){
    const f=wheelchairFixture();f.reply(async(call,data)=>{
      if(call.body?.operationName==='BulkPreselectSeats'){
        if(mode==='timeout')throw Error('lost');
        if(mode==='false')return {data:{bulkPreselectSeats:false}};
        if(mode==='cancel')await f.invoke({action:'cancel'});
      }
      if(mode==='cleanup'&&call.url==='/onestop/api/seats/select')return {backendErrorCode:'P41150'};
      if(mode==='cleanup'&&call.body?.operationName==='BulkDeselectSeats')return {data:{bulkDeselectSeats:false}};
      return data;
    });
    const r=await f.runSingleton(mode!=='cleanup');assert.equal(r.status,'uncertain');
    if(['cancel','cleanup'].includes(mode))assert.equal(f.context().seats.length,1);
    const count=f.calls.length;await f.invoke({action:'step'});assert.equal(f.calls.length,count);await assert.rejects(f.navigate());
    delete f.sandbox.window.__ticketHttpBooking;await assert.rejects(f.begin({runId:'second-run',seats:[f.seats[0]],quantity:1}),/PREVIOUS_RESULT_PENDING/);
  }
});

test('wheelchair inclusion does not bypass certified pricing requirements',async()=>{
  const f=wheelchairFixture({price:{isMembership:true}}),r=await f.runSingleton(false);
  assert.equal(r.status,'blocked');assert.equal(r.code,'PRICE_REQUIRES_CERTIFICATION');assert.equal(f.calls.length,2);assert.equal(f.context().seats,undefined);
});

test('cancelling before any mutation permits restart after zero, metadata, price or status reads',async()=>{
  for(const steps of [0,1,2,3])for(const stopPath of ['action','watchers']){
    const f=fixture();await f.begin();for(let i=0;i<steps;i++)await f.invoke({action:'step'});
    assert.equal(f.calls.length,steps);assert.equal(JSON.parse(f.store.get('baseball/http-booking')).mutationStarted,false);
    if(stopPath==='action')await f.invoke({action:'cancel'});
    else {f.sandbox.window.__ticketHttpBooking.cancelled=true;const receipt=JSON.parse(f.store.get('baseball/http-booking'));receipt.cancelled=true;f.store.set('baseball/http-booking',JSON.stringify(receipt));}
    delete f.sandbox.window.__ticketHttpBooking;
    const r=await f.begin({runId:'restart'});assert.equal(r.stage,'metadata');assert.equal(r.heldCount,0);assert.equal(f.calls.length,steps);
  }
});

test('an in-flight read must settle after cancellation before a new attempt can run',async()=>{
  const f=fixture();let release;f.reply((_call,data)=>new Promise(resolve=>{release=()=>resolve(data);}));await f.begin();
  const pending=f.invoke({action:'step'});await new Promise(resolve=>setImmediate(resolve));await f.invoke({action:'cancel'});
  await assert.rejects(f.begin({runId:'too-early'}),/PREVIOUS_RESULT_PENDING/);
  release();const stopped=await pending;assert.equal(stopped.code,'HTTP_CANCELLED');assert.equal(stopped.heldCount,0);
  assert.equal((await f.begin({runId:'after-read'})).stage,'metadata');assert.equal(f.calls.length,1);
});

test('missing mutation proof and a lost mutation response keep cancelled receipts locked',async()=>{
  const old=fixture();await old.begin();const r=JSON.parse(old.store.get('baseball/http-booking'));r.cancelled=true;delete r.mutationStarted;old.store.set('baseball/http-booking',JSON.stringify(r));delete old.sandbox.window.__ticketHttpBooking;
  await assert.rejects(old.begin({runId:'legacy'}),/PREVIOUS_RESULT_PENDING/);
  const f=fixture();f.reply((call,data)=>{if(call.body?.operationName==='PreselectSeat'){assert.equal(JSON.parse(f.store.get('baseball/http-booking')).mutationStarted,true);throw Error('lost response');}return data;});
  const result=await f.run();assert.equal(result.status,'uncertain');assert.equal(result.heldCount,0);await f.invoke({action:'cancel'});delete f.sandbox.window.__ticketHttpBooking;
  await assert.rejects(f.begin({runId:'unknown'}),/PREVIOUS_RESULT_PENDING/);assert.equal(f.calls.length,4);
});

test('fresh row changes cannot bypass a candidate selected by the maximum-row preference',async()=>{
  const {parseMetadata,enrich}=require('../src/metadata'),{rankGroups}=require('../src/preferences'),f=fixture();
  const metadata=parseMetadata([{blockKey:'001:101',seats:f.records}]);
  f.seats.splice(0,f.seats.length,...enrich(f.seats.map(s=>({id:s.id,kind:'seat',available:true})),new Map(metadata.map(s=>[s.id,s]))));
  assert.equal(rankGroups(f.seats,{quantity:2,fallbackAnywhere:false,tiers:[{maxRow:1}]}).length,1);
  f.records.forEach(v=>{v.rowNo='99열';});const r=await f.run();
  assert.equal(r.code,'HTTP_METADATA_CHANGED');assert.deepEqual([...r.changedIds],[f.seats[0].id]);assert.equal(r.heldCount,0);assert.equal(f.calls.length,1);
});

test('fresh labels share numeric and alphabetic normalization with metadata parsing',async()=>{
  for(const row of ['01열','1','W1구역 1열']){
    const f=fixture();f.records[0].rowNo=row;f.records[0].seatNo='01번';const r=await f.run();assert.equal(r.stage,'ready');assert.equal(f.context().seats[0].seatNo,'01번');
  }
  const alpha=fixture();for(const seat of alpha.seats)Object.assign(seat,{row:1,rowLabel:'A',rowKind:'alpha'});alpha.records.forEach(v=>{v.rowNo='A열';});assert.equal((await alpha.run()).stage,'ready');
  for(const row of ['A열','unknown','1열 임시']){const f=fixture();f.records[0].rowNo=row;assert.equal((await f.run()).code,'HTTP_METADATA_CHANGED');assert.equal(f.calls.length,1);}
});

test('fresh grade names cannot bypass restricted, obstructed or preferred-area filters',async()=>{
  for(const name of ['일반 시야방해석','휠체어장애인석','다른 구역']){
    const f=fixture();f.records[0].seatGradeName=name;const r=await f.run();
    assert.equal(r.code,'HTTP_METADATA_CHANGED');assert.equal(r.status,'blocked');assert.deepEqual([...r.changedIds],[f.seats[0].id]);
    assert.equal(r.heldCount,0);assert.equal(f.calls.length,1);assert.equal(f.context().seats,undefined);
  }
});

test('equivalent grade spelling and the documented missing-name fallback remain supported',async()=>{
  const equivalent=fixture();equivalent.seats.forEach(seat=>{seat.grade='A석';});equivalent.records.forEach(seat=>{seat.seatGradeName=' Ａ 석 ';});
  assert.equal((await equivalent.run()).stage,'ready');
  for(const missing of [undefined,null,'']){
    const f=fixture();f.records.forEach(seat=>{seat.seatGradeName=missing;});assert.equal((await f.run()).stage,'ready');
    assert.equal(f.context().seats[0].seatGradeName,'일반석');
  }
});

test('one unsupported price in a multi-grade combination stops before any seat mutation',async()=>{
  const f=fixture();Object.assign(f.seats[1],{gradeCode:'2',grade:'다음석'});Object.assign(f.records[1],{seatGrade:'2',seatGradeName:'다음석'});
  f.reply((call,data)=>call.url.startsWith('/onestop/api/prices/')?{prices:[...data.prices,{seatGrade:'2',ticketMaxCount:4,priceList:[{...price,seatGrade:'2',isMembership:true}]}]}:data);
  const r=await f.run();assert.equal(r.code,'PRICE_REQUIRES_CERTIFICATION');assert.equal(r.heldCount,0);assert.equal(f.calls.length,2);
  assert.ok(!f.calls.some(call=>call.body?.operationName==='PreselectSeat'));assert.equal(f.context().seats,undefined);
});

test('fresh status verifies seats from multiple maps without requiring a current DOM circle',async()=>{
  const f=fixture();f.seats[1].blockKey='001:102';f.records[1].blockKey='001:102';f.sandbox.document.getElementById=()=>null;
  const r=await f.run();assert.equal(r.stage,'ready');assert.equal(r.heldCount,2);
  const status=f.calls.find(v=>v.url.startsWith('/onestop/api/seatStatus?'));
  assert.deepEqual(new URL(status.url,'https://tickets.interpark.com').searchParams.getAll('blockKeys'),['001:101','001:102']);
  assert.ok(f.calls.indexOf(status)>f.calls.findIndex(v=>v.url.startsWith('/onestop/api/prices/')));
  assert.deepEqual(f.calls.filter(v=>v.body?.operationName==='PreselectSeat').map(v=>v.body.variables.command.blockKey),['001:101','001:102']);
});

test('status bit positions follow every metadata record including hidden seats and nibble padding',async()=>{
  const f=fixture();f.sandbox.document.getElementById=()=>null;
  f.records.unshift({...f.records[0],seatInfoId:'hidden',isExposable:false});
  f.reply((call,data)=>call.url.startsWith('/onestop/api/seatStatus?')?{data:['6']}:data);
  assert.equal((await f.run()).stage,'ready');
  const g=fixture();g.seats[1].blockKey='001:102';g.records[1].blockKey='001:102';g.sandbox.document.getElementById=()=>null;
  g.reply((call,data)=>call.url.startsWith('/onestop/api/seatStatus?')?{data:['8','0']}:data);
  const r=await g.run();assert.equal(r.status,'conflict');assert.equal(r.stage,'released');assert.deepEqual([...r.unavailableIds],[g.seats[1].id]);assert.equal(r.heldCount,0);
  assert.ok(!g.calls.some(v=>v.body?.operationName==='PreselectSeat'));
});

test('malformed or incomplete status masks stop before any hold',async()=>{
  for(const payload of [{},['f'],{data:[]},{data:['']},{data:['g']},{data:['ff']},{data:['f','f']}]){
    const f=fixture({reply:(call,data)=>call.url.startsWith('/onestop/api/seatStatus?')?payload:data});f.sandbox.document.getElementById=()=>null;
    const r=await f.run();assert.equal(r.code,'HTTP_SEAT_STATUS_INVALID');assert.equal(r.status,'blocked');assert.equal(r.heldCount,0);assert.equal(f.calls.length,3);
  }
});

test('available status does not override a mounted disabled or selected circle',async()=>{
  for(const name of ['disabled','selected']){
    const f=fixture();const original=f.sandbox.document.getElementById;f.sandbox.document.getElementById=id=>({...original(id),getAttribute:()=>`SeatMap_${name}`});
    const r=await f.run();assert.equal(r.status,'conflict');assert.equal(r.heldCount,0);assert.deepEqual([...r.unavailableIds],[f.seats[0].id]);assert.equal(f.calls.length,3);
  }
});

test('expired status is reread for remaining seats and a known change releases only acknowledged holds',async()=>{
  const f=fixture();await f.begin();let r;
  do {r=await f.invoke({action:'step'});} while(r.heldCount===0);
  assert.equal(r.heldCount,1);f.sandbox.window.__ticketHttpBooking.statusCheckedAt=Date.now()-20001;
  f.reply((call,data)=>call.url.startsWith('/onestop/api/seatStatus?')?{data:['0']}:data);
  for(let i=0;i<5&&r.status==='pending';i++)r=await f.invoke({action:'step'});
  assert.equal(r.status,'conflict');assert.equal(r.stage,'released');assert.deepEqual([...r.unavailableIds],[f.seats[1].id]);
  assert.deepEqual(f.calls.filter(v=>v.body?.operationName==='DeselectSeat').map(v=>v.body.variables.command.seatInfoId),[f.seats[0].id.slice(11)]);
  assert.equal(f.calls.filter(v=>v.body?.operationName==='PreselectSeat').length,1);assert.equal(f.context().seats.length,0);
});

test('a failed status refresh after an acknowledged hold remains uncertain without a cleanup guess',async()=>{
  const f=fixture();await f.begin();let r;do {r=await f.invoke({action:'step'});}while(r.heldCount===0);
  f.sandbox.window.__ticketHttpBooking.statusCheckedAt=Date.now()-20001;f.reply((call,data)=>{if(call.url.startsWith('/onestop/api/seatStatus?'))throw Error('read timeout');return data;});
  await f.invoke({action:'step'});r=await f.invoke({action:'step'});assert.equal(r.status,'uncertain');assert.equal(r.heldCount,1);
  assert.ok(!f.calls.some(v=>v.body?.operationName==='DeselectSeat'));await assert.rejects(f.begin({runId:'unsafe'}),/PREVIOUS_RESULT_PENDING/);
});
