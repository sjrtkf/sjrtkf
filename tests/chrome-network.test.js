'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createBaseballNetworkObserver,allowedTabUrl}=require('../extension/network-observer');
const parsers={metadata:require('../src/metadata'),seatNetwork:require('../src/seat-network'),entryNetwork:require('../src/entry-network')};
const metaUrl='https://tickets.interpark.com/onestop/api/seatMeta';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const source={tabId:9};
test('background execution is enabled without focusing windows and can be cleared then reenabled',async()=>{
 const f=fixture();await f.observer.attach(9);await f.observer.setBackground(9,false);await f.observer.attach(9);
 assert.deepEqual(f.commands.filter(c=>c.method==='Emulation.setFocusEmulationEnabled').map(c=>c.arg.enabled),[true,false,true]);
 assert.ok(!f.commands.some(c=>/bringToFront|Input\./.test(c.method)));
});
function eventSource(){const listeners=[];return {addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.forEach(fn=>fn(...args))};}
function fixture(parserOverrides={}){
 const events=[],commands=[],responses=new Map();let tabUrl='https://tickets.interpark.com/onestop/seat';
 const chrome={debugger:{onEvent:eventSource(),onDetach:eventSource(),attach:async target=>commands.push({method:'attach',target}),detach:async target=>commands.push({method:'detach',target}),sendCommand:async(target,method,arg)=>{commands.push({method,target,arg});return method==='Network.getResponseBody'?await responses.get(arg.requestId):{};}},tabs:{get:async()=>({url:tabUrl}),onRemoved:eventSource(),onCreated:eventSource()},webNavigation:{onCommitted:eventSource()}};
 const observer=createBaseballNetworkObserver({chrome,emit:e=>events.push(e),parsers:{...parsers,...parserOverrides},now:()=>100});
 const request=(id,req,extra={})=>chrome.debugger.onEvent.emit(source,'Network.requestWillBeSent',{requestId:id,request:req,timestamp:1,...extra});
 const finish=(id,status=200)=>{chrome.debugger.onEvent.emit(source,'Network.responseReceived',{requestId:id,response:{status}});chrome.debugger.onEvent.emit(source,'Network.loadingFinished',{requestId:id,encodedDataLength:100,timestamp:1.05});};
 return {chrome,observer,events,commands,responses,request,finish,setUrl:url=>tabUrl=url};
}
const select=(id='A')=>({url:'https://tickets.interpark.com/onestop/gql',method:'POST',postData:JSON.stringify({operationName:'PreselectSeat',query:'mutation PreselectSeat($command: PreselectSeatCommand!) { preselectSeat(command:$command) }',variables:{command:{seatInfoId:id,sessionId:'secret-session'}}})});
const grade=(playSeq='001')=>({url:'https://tickets.interpark.com/onestop/gql',method:'POST',postData:JSON.stringify({operationName:'GetRemainSeats',query:'query GetRemainSeats($input:GetRemainSeatSortInput){ getRemainSeats(input:$input){ seatGrade seatGradeName } }',variables:{input:{playSeq}}})});
test('only explicitly selected supported ticket tabs can attach; missing observation is unhealthy',async()=>{
 const f=fixture();assert.equal(f.observer.snapshot(9).healthy,false);
 f.setUrl('https://accounts.interpark.com/login');await assert.rejects(f.observer.attach(9),/지원하는/);assert.equal(f.commands.length,0);
 for(const url of ['https://tickets.interpark.com.evil.invalid/onestop/seat','http://tickets.interpark.com/onestop/seat','https://user:pass@tickets.interpark.com/onestop/seat'])assert.equal(allowedTabUrl(url),false);
 f.setUrl('https://nol.yanolja.com/ticket/genre/sports/bears');await Promise.all([f.observer.attach(9),f.observer.attach(9)]);
 assert.equal(f.commands.filter(c=>c.method==='attach').length,1);assert.equal(f.observer.snapshot(9).healthy,true);
 assert.deepEqual(f.commands.map(c=>c.method),['attach','Page.enable','Network.enable','Emulation.setFocusEmulationEnabled']);
});
test('seat request stays pending until response decoding; only sanitized result leaves observer',async()=>{
 const f=fixture();await f.observer.attach(9);let respond;f.responses.set('seat',new Promise(r=>respond=r));
 f.request('seat',select());f.finish('seat');assert.equal(f.observer.snapshot(9).pending.length,1);
 respond({body:'{"data":{"preselectSeat":true},"member":"secret-member"}'});await tick();
 assert.deepEqual(f.observer.snapshot(9).results,[{seq:1,kind:'select',status:'ok',seatIds:['seat_block_A']}]);
 assert.equal(JSON.stringify(f.events).includes('secret'),false);
});
test('login/member responses and unselected-tab events are never decoded',async()=>{
 const f=fixture();await f.observer.attach(9);
 for(const [id,url] of [['login','https://accounts.interpark.com/login'],['member','https://tickets.interpark.com/onestop/api/member']]){f.request(id,{url,method:'GET'});f.finish(id);}
 f.chrome.debugger.onEvent.emit({tabId:10},'Network.requestWillBeSent',{requestId:'wrong-tab',request:select()});
 f.chrome.debugger.onEvent.emit({...source,sessionId:'child'},'Network.requestWillBeSent',{requestId:'child',request:select()});
 await tick();assert.equal(f.commands.filter(c=>c.method==='Network.getResponseBody').length,0);assert.equal(f.observer.snapshot(9).sequence,0);
});
test('metadata publishes parsed seat fields and rejects late response after navigation',async()=>{
 const f=fixture();f.chrome.webNavigation.getFrame=async()=>({documentId:'old-doc'});await f.observer.attach(9);const body=JSON.stringify(require('../src/demo-data'));
 f.responses.set('meta',{body});f.request('meta',{url:metaUrl,method:'GET'});f.finish('meta');await tick();
 assert.equal(f.events.find(e=>e.type==='metadata').rows[0].row,1);
 assert.equal(f.events.find(e=>e.type==='metadata').documentId,'old-doc');
 let respond;f.responses.set('old',new Promise(r=>respond=r));f.request('old',{url:metaUrl,method:'GET'});f.finish('old');
 f.chrome.webNavigation.onCommitted.emit({tabId:9,frameId:0,url:'https://tickets.interpark.com/onestop/seat',documentId:'new-doc'});
 respond({body});await tick();assert.equal(f.events.filter(e=>e.type==='metadata').length,1);
 assert.equal(f.events.at(-2).reason,'navigation');
});
test('game context changes reset metadata and discard old grade response',async()=>{
 const f=fixture();await f.observer.attach(9);let respond;
 f.responses.set('g1',new Promise(r=>respond=r));f.request('g1',grade('001'));f.finish('g1');f.request('g2',grade('002'));
 respond({body:'{"data":{"getRemainSeats":[{"seatGrade":"R","seatGradeName":"레드","salePrice":99999}]}}'});await tick();
 assert.equal(f.events.filter(e=>e.type==='grades').length,0);assert.equal(f.events.filter(e=>e.reason==='context').length,1);
 f.responses.set('g2',{body:'{"data":{"getRemainSeats":[{"seatGrade":"R","seatGradeName":"레드","salePrice":99999}]}}'});f.finish('g2');await tick();
 assert.deepEqual(f.events.find(e=>e.type==='grades').rows,[{code:'R',name:'레드'}]);
});
test('entry observations never fetch body and redirect segment is bounded',async()=>{
 const f=fixture();await f.observer.attach(9);
 f.request('entry',{url:'https://ent-waiting-api.interpark.com/waiting/api/secure-url',method:'POST',postData:'secret-signed-entry'});
 f.request('entry',{url:'https://other.invalid/redirect',method:'GET'},{timestamp:1.1,redirectResponse:{status:302}});f.finish('entry');await tick();
 assert.deepEqual(f.events.filter(e=>e.type==='entry').map(e=>e.event.kind),['request','finished']);
 assert.equal(f.commands.filter(c=>c.method==='Network.getResponseBody').length,0);assert.equal(JSON.stringify(f.events).includes('secret'),false);
});
test('debugger loss marks pending seats uncertain and never implies completion',async()=>{
 const f=fixture();await f.observer.attach(9);f.request('seat',select());f.chrome.debugger.onDetach.emit(source,'canceled_by_user');
 const info=f.observer.snapshot(9);assert.equal(info.healthy,false);assert.equal(info.pending.length,0);assert.equal(info.results[0].status,'uncertain');
 assert.equal(f.events.at(-1).event.kind,'observer-lost');
});
test('debugger loss preserves only documented Chrome reasons without claiming a cause for user cancellation',async()=>{
 for(const [detachReason,reason] of [['canceled_by_user','debugger-detached'],['target_closed','target-closed']]){
  const f=fixture();await f.observer.attach(9);f.chrome.debugger.onDetach.emit(source,detachReason);
  assert.deepEqual(f.events.at(-1).event,{kind:'observer-lost',atMono:100,reason,detachReason});
  assert.equal(f.commands.filter(c=>c.method==='attach').length,1);
 }
});
test('unknown debugger details are not exported and repeated loss preserves the first reason',async()=>{
 const f=fixture();await f.observer.attach(9);f.request('seat',select());
 f.chrome.debugger.onDetach.emit(source,'future-reason secret-session https://example.invalid/private');
 f.chrome.debugger.onDetach.emit(source,'target_closed');await f.observer.detach(9);
 const losses=f.events.filter(e=>e.type==='entry'&&e.event.kind==='observer-lost');
 assert.equal(losses.length,1);assert.deepEqual(losses[0].event,{kind:'observer-lost',atMono:100,reason:'debugger-detached'});
 assert.equal(JSON.stringify(f.events).includes('secret'),false);
});
test('an internal observation error reports a code without raw error contents',async()=>{
 const f=fixture({entryNetwork:{isEntryRequest(){throw Error('secret-token protocol details');}}});
 await f.observer.attach(9);f.request('broken',{url:metaUrl,method:'GET'});await tick();
 const losses=f.events.filter(e=>e.type==='entry'&&e.event.kind==='observer-lost');
 assert.deepEqual(losses.map(e=>e.event.reason),['observer-error']);assert.equal(f.observer.snapshot(9).healthy,false);
 assert.equal(JSON.stringify(f.events).includes('secret-token'),false);
 assert.equal(f.commands.filter(c=>c.method==='attach').length,1);
});
test('pending observation overflow reports a bounded diagnostic and stops retaining requests',async()=>{
 const f=fixture();await f.observer.attach(9);
 for(let i=0;i<1026;i++)f.request('meta-'+i,{url:metaUrl,method:'GET'});
 await tick();
 assert.deepEqual(f.events.filter(e=>e.type==='entry').map(e=>e.event.reason),['pending-overflow']);
 assert.equal(f.observer.snapshot(9).healthy,false);assert.equal(f.commands.filter(c=>c.method==='Network.getResponseBody').length,0);
});
test('intentional detach and tab closure retain distinct first diagnostic causes',async()=>{
 for(const closed of [false,true]){
  const f=fixture();await f.observer.attach(9);
  if(closed)f.chrome.tabs.onRemoved.emit(9);else await f.observer.detach(9);
  f.chrome.debugger.onDetach.emit(source,'canceled_by_user');await tick();
  assert.deepEqual(f.events.filter(e=>e.type==='entry').map(e=>e.event.reason),[closed?'target-closed':'manual-detach']);
  assert.equal(f.observer.snapshot(9).healthy,false);assert.equal(f.commands.filter(c=>c.method==='detach').length,1);
 }
});
test('navigating outside allowed ticket pages detaches and drops in-flight response',async()=>{
 const f=fixture();await f.observer.attach(9);let respond;f.responses.set('seat',new Promise(r=>respond=r));f.request('seat',select());f.finish('seat');
 f.chrome.webNavigation.onCommitted.emit({tabId:9,frameId:0,url:'https://accounts.interpark.com/login'});respond({body:'{"data":{"preselectSeat":true}}'});await tick();
 assert.equal(f.observer.snapshot(9).healthy,false);assert.equal(f.commands.at(-1).method,'detach');assert.equal(f.events.filter(e=>e.type==='network'&&e.snapshot.results.some(r=>r.status==='ok')).length,0);
});
test('disconnect while initial tab lookup is pending prevents a later debugger attach',async()=>{
 const f=fixture();let lookup;f.chrome.tabs.get=()=>new Promise(r=>lookup=r);
 const attaching=f.observer.attach(9);await f.observer.detachAll();lookup({url:'https://tickets.interpark.com/onestop/seat'});
 await assert.rejects(attaching,/취소/);assert.equal(f.commands.length,0);assert.equal(f.observer.snapshot(9).healthy,false);
});
test('only popups of a watched tab can receive temporary blank-page observation',async()=>{
 const f=fixture();await f.observer.attach(9);
 f.chrome.tabs.get=async id=>({id,url:'about:blank',openerTabId:id===10?9:22});
 f.chrome.tabs.onCreated.emit({id:10,url:'about:blank',openerTabId:9});
 f.chrome.tabs.onCreated.emit({id:11,url:'about:blank',openerTabId:22});await tick();
 assert.equal(f.observer.snapshot(10).healthy,true);assert.equal(f.observer.snapshot(11).healthy,false);
 f.chrome.webNavigation.onCommitted.emit({tabId:10,frameId:0,url:'https://accounts.interpark.com/login',documentId:'login-doc'});await tick();
 assert.equal(f.observer.snapshot(10).healthy,false);assert.equal(f.events.find(e=>e.tabId===10&&e.documentId==='login-doc')?.snapshot?.healthy,false);
});

test('native dialogs are reported promptly without exposing text or auto-accepting',async()=>{const f=fixture();await f.observer.attach(9);f.chrome.debugger.onEvent.emit({tabId:9},'Page.javascriptDialogOpening',{type:'confirm',message:'private-token-secret',url:'https://tickets.interpark.com/onestop/seat'});await tick();assert.ok(f.events.some(e=>e.type==='native-dialog'&&e.dialogType==='confirm'));assert.equal(JSON.stringify(f.events).includes('private-token'),false);assert.equal(f.commands.some(c=>c.method==='Page.handleJavaScriptDialog'),false);});

test('map grade-price responses publish names without identity fields or prices',async()=>{
 const f=fixture();await f.observer.attach(9);const request=grade();request.postData=request.postData.replaceAll('GetRemainSeats','GetSeatGradePrices').replaceAll('getRemainSeats','getSeatGradePrices');
 f.responses.set('prices',{body:JSON.stringify({data:{getSeatGradePrices:[null,{seatGrade:'01',seatGradeName:'1루 오렌지석',salePrice:99999}]}})});f.request('prices',request);f.finish('prices');await tick();
 assert.deepEqual(f.events.find(e=>e.type==='grades').rows,[{code:'01',name:'1루 오렌지석'}]);assert.ok(!JSON.stringify(f.events).includes('99999'));
});


test('entry body classification emits only a result code, never signed redirect data',async()=>{
 const f=fixture();await f.observer.attach(9);
 f.responses.set('entry',{body:JSON.stringify({redirectUrl:'https://tickets.interpark.com/waiting?key=secret-queue-value'})});
 f.request('entry',{url:'https://ent-waiting-api.interpark.com/waiting/api/secure-url',method:'POST'});f.finish('entry');await tick();
 assert.equal(f.events.find(e=>e.event?.kind==='finished').event.outcome,'redirect-ready');
 assert.equal(JSON.stringify(f.events).includes('secret-queue-value'),false);
});
