'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {attach,isEntryRequest}=require('../src/entry-network');
const URL='https://ent-waiting-api.interpark.com/waiting/api/secure-url';
const request=extra=>({method:'POST',url:URL,...extra});
function fixture(){
  const wc=new EventEmitter(),debuggerClient=new EventEmitter(),events=[];let mono=100;
  wc.debugger=debuggerClient;debuggerClient.isAttached=()=>true;
  debuggerClient.attach=debuggerClient.sendCommand=()=>{throw Error('Passive observer must never issue commands');};
  const observer=attach(wc,event=>events.push(event),{now:()=>mono});
  return {wc,debuggerClient,events,observer,setNow:value=>{mono=value;},emit:(name,p)=>debuggerClient.emit('message',{},name,p)};
}
test('진입 관찰은 사용자 정보가 없는 정확한 HTTPS POST 엔드포인트만 허용한다',()=>{
  assert.equal(isEntryRequest(request()),true);
  assert.equal(isEntryRequest(request({url:URL+'?signature=private'})),true);
  for(const url of [URL+'/',URL+'/extra',URL.replace('https:','http:'),URL.replace('.com/','.com:8443/'),URL.replace('.com/','.com.attacker.invalid/'),URL.replace('https://','https://user:password@'),'invalid'])assert.equal(isEntryRequest(request({url})),false);
  for(const method of ['GET','OPTIONS','post',null])assert.equal(isEntryRequest(request({method})),false);
  for(const invalid of [null,undefined,{},''])assert.equal(isEntryRequest(invalid),false);
});
test('진입 요청과 응답 완료의 시각 및 CDP 경과 시간만 알린다',()=>{
  const f=fixture();
  f.emit('Network.requestWillBeSent',{requestId:'secret-request-id',timestamp:5,request:request({url:URL+'?signature=secret-query',postData:'secret-body',headers:{Cookie:'secret-cookie'}})});
  f.setNow(140);
  f.emit('Network.responseReceived',{requestId:'secret-request-id',response:{status:200,url:URL,headers:{'Set-Cookie':'secret-response'}}});
  f.emit('Network.loadingFinished',{requestId:'secret-request-id',timestamp:5.04,encodedDataLength:99});
  assert.deepEqual(f.events[0],{kind:'request',atMono:100,seq:1});
  assert.deepEqual(Object.keys(f.events[1]).sort(),['atMono','durationMs','kind','seq','status'].sort());
  assert.equal(f.events[1].kind,'finished');assert.equal(f.events[1].status,200);assert.equal(f.events[1].atMono,140);assert.ok(Math.abs(f.events[1].durationMs-40)<1e-9);
  const encoded=JSON.stringify(f.events);assert.equal(/secret|Cookie|signature|requestId|postData|headers|https/.test(encoded),false);
  f.emit('Network.loadingFinished',{requestId:'secret-request-id',timestamp:6});assert.equal(f.events.length,2);
});
test('관련 없는 요청은 무시하고 실패는 별도 사실로 기록한다',()=>{
  const f=fixture();
  f.emit('Network.requestWillBeSent',{requestId:'other',timestamp:1,request:request({url:'https://tickets.interpark.com/onestop/gql'})});
  f.emit('Network.loadingFinished',{requestId:'other',timestamp:2});
  assert.deepEqual(f.events,[]);
  f.emit('Network.requestWillBeSent',{requestId:'a',timestamp:3,request:request()});
  f.setNow(120);f.emit('Network.loadingFailed',{requestId:'a',timestamp:3.02,errorText:'private error string'});
  assert.equal(f.events[1].kind,'failed');assert.equal(f.events[1].seq,1);assert.equal(f.events[1].atMono,120);assert.ok(Math.abs(f.events[1].durationMs-20)<1e-9);
  assert.equal('status' in f.events[1],false);assert.equal('errorText' in f.events[1],false);
});
test('중복 시작 이벤트를 중복 계산하지 않고 리다이렉트 후 타 출처 응답을 섞지 않는다',()=>{
  const f=fixture(),begin={requestId:'a',timestamp:2,request:request()};
  f.emit('Network.requestWillBeSent',begin);f.emit('Network.requestWillBeSent',begin);assert.equal(f.events.length,1);
  f.emit('Network.requestWillBeSent',{requestId:'a',timestamp:2.125,redirectResponse:{status:302,headers:{secret:'not retained'}},request:request({url:'https://example.invalid/redirect'})});
  assert.deepEqual(f.events[1],{kind:'finished',atMono:100,seq:1,status:302,durationMs:125});
  f.emit('Network.responseReceived',{requestId:'a',response:{status:200}});f.emit('Network.loadingFinished',{requestId:'a',timestamp:3});assert.equal(f.events.length,2);
  f.emit('Network.requestWillBeSent',{requestId:'b',timestamp:4,request:request()});assert.equal(f.events[2].seq,2);
});
test('관찰기 연결 해제는 한 번 알리고 미완료 요청과 이벤트 리스너를 정리한다',()=>{
  const f=fixture();f.emit('Network.requestWillBeSent',{requestId:'a',timestamp:2,request:request()});
  f.debuggerClient.emit('detach',{},'private reason');
  assert.equal(f.observer.healthy,false);assert.deepEqual(f.events[1],{kind:'observer-lost',atMono:100});
  f.debuggerClient.emit('detach');f.wc.emit('destroyed');f.emit('Network.loadingFinished',{requestId:'a',timestamp:3});
  assert.equal(f.events.length,2);assert.equal(f.debuggerClient.listenerCount('message'),0);assert.equal(f.wc.listenerCount('destroyed'),0);assert.doesNotThrow(f.observer.dispose);
});
test('창 파괴 뒤 debugger getter가 실패하더라도 캡처한 인스턴스로 정리한다',()=>{
  const f=fixture();Object.defineProperty(f.wc,'debugger',{get(){throw Error('Object has been destroyed');}});
  assert.doesNotThrow(()=>f.wc.emit('destroyed'));assert.equal(f.observer.healthy,false);assert.deepEqual(f.events,[{kind:'observer-lost',atMono:100}]);assert.equal(f.debuggerClient.listenerCount('message'),0);
});
test('초기 debugger 미연결과 명시적 종료를 구분한다',()=>{
  const wc=new EventEmitter(),events=[];wc.debugger=new EventEmitter();wc.debugger.isAttached=()=>false;
  const failed=attach(wc,e=>events.push(e),{now:()=>10});assert.equal(failed.healthy,false);assert.deepEqual(events,[{kind:'observer-lost',atMono:10}]);assert.equal(wc.debugger.listenerCount('message'),0);
  const f=fixture();f.observer.dispose();assert.equal(f.observer.healthy,false);f.wc.emit('destroyed');assert.deepEqual(f.events,[]);
});
test('누락된 시간이나 비정상 상태 코드를 사실인 것처럼 보정하지 않는다',()=>{
  const f=fixture();f.emit('Network.requestWillBeSent',{requestId:'a',request:request()});f.emit('Network.responseReceived',{requestId:'a',response:{status:'200'}});f.emit('Network.loadingFinished',{requestId:'a',timestamp:3});
  assert.deepEqual(f.events[1],{kind:'finished',atMono:100,seq:1});
  f.emit('Network.requestWillBeSent',{requestId:'b',timestamp:4,request:request()});f.emit('Network.loadingFailed',{requestId:'b',timestamp:3});assert.equal('durationMs' in f.events[3],false);
  assert.doesNotThrow(()=>f.emit('Network.requestWillBeSent',null));
});
