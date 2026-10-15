const {test}=require('node:test');const assert=require('node:assert/strict');const {parseOpening,clockSample,serverClockSample,bestClock,clockForGate,GATE_CLOCK_LIMITS}=require('../src/timing');
test('공식 일반예매 표기만 한국 시각으로 파싱한다',()=>{const now=Date.parse('2026-09-10T00:00:00Z');assert.equal(parseOpening('D-6 일반예매 09.16(수) 11:00',now),Date.parse('2026-09-16T11:00:00+09:00'));assert.equal(parseOpening('9월 23일 18:30',now),null);});
test('연도 경계와 유효하지 않은 날짜를 처리한다',()=>{assert.equal(parseOpening('일반예매 01.02(토) 11:00',Date.parse('2026-12-29')),Date.parse('2027-01-02T11:00:00+09:00'));assert.equal(parseOpening('일반예매 02.30(월) 11:00',Date.parse('2026-01-01')),null);});
test('캐시되거나 지나치게 느린 시각 표본은 거절한다',()=>{const sample={date:'Thu, 10 Sep 2026 08:00:00 GMT',start:1789027200000,end:1789027200100};assert.equal(clockSample({...sample,age:'1'}),null);assert.equal(clockSample({...sample,cache:'Hit from cloudfront'}),null);assert.equal(clockSample({...sample,end:sample.start+5000}),null);assert.ok(clockSample(sample).uncertaintyMs>=500);});
test('왕복 시간이 가장 짧은 유효 표본을 선택한다',()=>{assert.equal(bestClock([null,{rttMs:200},{rttMs:80}]).rttMs,80);assert.throws(()=>bestClock([null]));});
test('실제 서버 시각 응답의 밀리초 정밀도를 보존하고 HTTP Date 대체값을 구분한다',()=>{
  const start=Date.parse('2026-09-18T02:00:00Z'),end=start+20;
  const s=serverClockSample({body:String(start+27),start,end});assert.equal(s.offsetMs,17);assert.equal(s.uncertaintyMs,11);assert.equal(s.source,'ticket-server');
  assert.equal(clockSample({date:new Date(start).toUTCString(),start,end}).source,'http-date-fallback');
});
test('서버 시각은 빈 값·초 단위·JSON·캐시·역행 표본을 거절한다',()=>{
  const start=Date.now(),end=start+10;
  for(const body of ['',null,'0',String(Math.floor(start/1000)),JSON.stringify({time:start}),'NaN'])assert.equal(serverClockSample({body,start,end}),null);
  for(const bad of [{age:'1'},{cache:'Hit from Cloudfront'},{start:end,end:start},{end:start+4001}])assert.equal(serverClockSample({body:String(start),start,end,...bad}),null);
});
test('예약 실행은 서버 시각 표본의 monotonic 기준점에서 경과 시간을 계산한다',()=>{
  const epoch=Date.parse('2026-09-18T02:00:00Z');
  const sample=serverClockSample({body:String(epoch+30),start:epoch,end:epoch+40,monoStart:100,monoEnd:140});
  assert.equal(sample.anchorMonoMs,140);assert.equal(sample.serverEpochAtAnchorMs,epoch+50);
  assert.deepEqual(clockForGate(sample,{monoNow:240}),{serverNowMs:epoch+150,ageMs:100,uncertaintyMs:21,rttMs:40,source:'ticket-server',validForMs:59900});
});
test('요청 중 또는 이후 PC 시계가 앞뒤로 바뀌어도 예약 시각은 바뀌지 않는다',()=>{
  const epoch=Date.parse('2026-09-18T02:00:00Z');
  const create=end=>serverClockSample({body:String(epoch+30),start:epoch,end,monoStart:100,monoEnd:140});
  const expected=clockForGate(create(epoch+40),{monoNow:1140});
  for(const jump of [-3600000,3600000]){
    const sample=create(epoch+40+jump);
    assert.equal(sample.rttMs,40);
    assert.deepEqual(clockForGate(sample,{monoNow:1140}),expected);
    assert.deepEqual(clockForGate({...sample,measuredAt:sample.measuredAt+jump,offsetMs:sample.offsetMs-jump},{monoNow:1140}),expected);
  }
});
test('오래된 표본·역행한 monotonic 시각·HTTP Date·기준점 없는 표본은 예약에 쓰지 않는다',()=>{
  const epoch=Date.parse('2026-09-18T02:00:00Z'),sample=serverClockSample({body:String(epoch),start:epoch,end:epoch+20,monoStart:100,monoEnd:120});
  assert.ok(clockForGate(sample,{monoNow:120+GATE_CLOCK_LIMITS.maxAgeMs}));
  assert.equal(clockForGate(sample,{monoNow:121+GATE_CLOCK_LIMITS.maxAgeMs}),null);
  assert.equal(clockForGate(sample,{monoNow:119}),null);
  assert.equal(clockForGate({...sample,source:'http-date-fallback'},{monoNow:120}),null);
  assert.equal(clockForGate(serverClockSample({body:String(epoch),start:epoch,end:epoch+20}),{monoNow:120}),null);
  assert.equal(clockForGate(null,{monoNow:120}),null);
});
test('예약용 시각 표본은 왕복시간과 추정 오차가 상한을 넘으면 거절한다',()=>{
  const epoch=Date.parse('2026-09-18T02:00:00Z');
  const atLimit=serverClockSample({body:String(epoch),start:epoch,end:epoch+1000,monoStart:100,monoEnd:1100});
  assert.ok(clockForGate(atLimit,{monoNow:1100}));
  const tooSlow=serverClockSample({body:String(epoch),start:epoch,end:epoch+1001,monoStart:100,monoEnd:1101});
  assert.equal(clockForGate(tooSlow,{monoNow:1101}),null);
  assert.equal(clockForGate({...atLimit,uncertaintyMs:502},{monoNow:1100}),null);
  assert.equal(clockForGate({...atLimit,uncertaintyMs:0},{monoNow:1100}),null);
});
test('불완전하거나 유한하지 않은 monotonic 표본을 허용하지 않는다',()=>{
  const epoch=Date.parse('2026-09-18T02:00:00Z'),base={body:String(epoch),start:epoch,end:epoch+20};
  for(const invalid of [{monoStart:100},{monoEnd:120},{monoStart:NaN,monoEnd:120},{monoStart:100,monoEnd:Infinity},{monoStart:-1,monoEnd:20},{monoStart:120,monoEnd:100}])assert.equal(serverClockSample({...base,...invalid}),null);
  const sample=serverClockSample({...base,monoStart:100,monoEnd:120});
  for(const key of ['anchorMonoMs','serverEpochAtAnchorMs','rttMs','uncertaintyMs'])for(const value of [NaN,Infinity,undefined])assert.equal(clockForGate({...sample,[key]:value},{monoNow:120}),null);
  assert.equal(clockForGate(sample,{monoNow:NaN}),null);
});
