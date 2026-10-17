'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {queueRequest,queueResponse,networkTiming}=require('../src/entry-observation');
const {safeDetail}=require('../src/run-log');
test('queue observations require exact endpoints and never export credentials',()=>{
  assert.equal(queueRequest({method:'GET',url:'https://ent-waiting-api.interpark.com/waiting/api/rank?waitingId=private'}),'rank');
  for(const url of ['https://evil.invalid/waiting/api/rank','https://ent-waiting-api.interpark.com/waiting/api/rank/other','https://u:p@ent-waiting-api.interpark.com/waiting/api/rank'])assert.equal(queueRequest({method:'GET',url}),null);
  const body=JSON.stringify({waitingId:'private',sessionId:'private',exist:true});
  assert.deepEqual(queueResponse('line-up',200,body),{outcome:'existing-queue'});
  assert.deepEqual(queueResponse('line-up',200,'{"waitingId":"private"}'),{outcome:'registered'});
  assert.deepEqual(queueResponse('rank',200,'{"myRank":20,"sessionId":"private"}'),{outcome:'rank-confirmed',rank:20});
  for(const body of ['{}','{"myRank":null}','{"myRank":"20"}','{"myRank":-1}','{"myRank":20,"error":"Expired"}'])assert.equal(queueResponse('rank',200,body).outcome,'unconfirmed');
});
test('missing CDP timing is unknown, not a reused connection with zero costs',()=>{
  assert.deepEqual(networkTiming({}),{timingAvailable:false});
  const r=networkTiming({connectionReused:true,timing:{dnsStart:-1,dnsEnd:-1,connectStart:-1,connectEnd:-1,sslStart:-1,sslEnd:-1,sendEnd:5,receiveHeadersStart:405}});
  assert.deepEqual(r,{timingAvailable:true,connectionReused:true,firstByteMs:400});
  const full=networkTiming({connectionReused:false,timing:{dnsStart:0,dnsEnd:10,connectStart:10,sslStart:30,sslEnd:60,connectEnd:60,sendEnd:61,receiveHeadersStart:80}});
  assert.equal(full.connectMs,50);assert.equal(full.tlsMs,30);
  const safe=safeDetail({timing:{...full,url:'secret',headers:{cookie:'secret'}},rank:12,requestDelayMs:2,body:'secret'});
  assert.equal(JSON.stringify(safe).includes('secret'),false);assert.equal(safe.requestDelayMs,2);
});
