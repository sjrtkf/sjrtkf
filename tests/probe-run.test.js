'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRunRegistry,createNavigationAttribution}=require('../src/probe-run');
const gate='https://tickets.interpark.com/gates/ticket/26005452',seat='https://tickets.interpark.com/onestop/seat';
test('직접 전송 예약은 최신 측정 창 계열만 소비하고 창/모드 전환으로 취소된다',()=>{
  const r=createRunRegistry(),first=r.create(1),second=r.create(2);r.arm();assert.equal(r.consume(first),false);assert.equal(r.consume(second),true);assert.equal(r.consume(second),false);
  r.arm();const third=r.create(3);assert.equal(r.consume(second),false);assert.equal(r.consume(third),false);
  r.arm();r.observe();assert.equal(r.consume(third),false);r.arm();r.close(third);assert.throws(()=>r.arm(),/NO_MEASUREMENT/);
});
test('SPA 좌석 도착은 해당 요청에 한 번 귀속되고 나중 새로고침은 기록을 바꾸지 않는다',()=>{
  let now=0;const a=createNavigationAttribution({now:()=>now});a.begin('a',0,gate);const row={status:200,outcome:'응답 수신'};a.response('a',row);now=90;a.arrived(seat);assert.equal(row.seatNavigationMs,90);
  now=9900;a.starting(seat);a.arrived(seat);assert.equal(row.seatNavigationMs,90);
});
test('응답 이벤트보다 이른 이동도 같은 요청 성공이 확인된 후에만 기록한다',()=>{
  let now=0;const a=createNavigationAttribution({now:()=>now});a.begin('a',0,gate);now=50;a.arrived(seat);const row={status:200,outcome:'응답 수신'};assert.equal(a.response('a',row),true);assert.equal(row.seatNavigationMs,50);
});
test('다른 이동/실패/유효시간 경과/요청 교체는 오래된 진입 기록을 폐기한다',()=>{
  for(const scenario of ['unrelated','failure','expired','superseded']){
    let now=0;const a=createNavigationAttribution({now:()=>now,maxAgeMs:100});a.begin('a',0,gate);const row={status:scenario==='failure'?403:200,outcome:'응답 수신'};a.response('a',row);
    if(scenario==='unrelated')a.starting('https://nol.yanolja.com/');if(scenario==='expired')now=101;if(scenario==='superseded')a.begin('b',10,gate);
    a.arrived(seat);assert.equal(row.seatNavigationMs,undefined,scenario);
  }
});
test('도착 전에 두 진입 요청이 겹치면 어느 요청에도 임의로 도착시간을 붙이지 않는다',()=>{
  let now=0;const a=createNavigationAttribution({now:()=>now}),first={status:200,outcome:'응답 수신'},second={status:200,outcome:'응답 수신'};
  a.begin('a',0,gate);a.response('a',first);a.begin('b',1,gate);a.response('b',second);now=10;a.arrived(seat);
  assert.equal(first.seatNavigationMs,undefined);assert.equal(second.seatNavigationMs,undefined);
});
