'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {matches,forwardHeaders,transmit,ENDPOINT}=require('../src/probe-core');
test('실제 진입 endpoint와 POST만 허용',()=>{assert.ok(matches({url:ENDPOINT,method:'POST'}));for(const url of [ENDPOINT+'?extra=1',ENDPOINT+'.evil','https://example.com/waiting/api/secure-url'])assert.equal(matches({url,method:'POST'}),false);assert.equal(matches({url:ENDPOINT,method:'GET'}),false);});
test('세션 쿠키는 재사용 문자열에서 제거하고 나머지 인증 헤더 유지',()=>{assert.deepEqual(forwardHeaders({Cookie:'private',Host:'host','Content-Length':'123',Origin:'https://tickets.interpark.com',Authorization:'synthetic'}),{Origin:'https://tickets.interpark.com',Authorization:'synthetic'});});
test('본문 없으면 전송하지 않음',async()=>{let sent=0;await assert.rejects(transmit(()=>sent++,{url:ENDPOINT}),/REQUEST_BODY_UNAVAILABLE/);assert.equal(sent,0);});
test('실패는 자동 재시도하지 않음',async()=>{let sent=0;await assert.rejects(transmit(async()=>{sent++;throw Error('offline');},{url:ENDPOINT,postData:'{}'}));assert.equal(sent,1);});
