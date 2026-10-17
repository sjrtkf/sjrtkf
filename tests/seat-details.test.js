'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readDetails}=require('../src/seat-details');
const {readBookingContext}=require('../src/booking-context');
const {resolveGradeNames}=require('../src/grade-names');
const expected={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
function fixture({captcha=false,foreign=false,changeSession=false,gradeRows=[{seatGrade:'3',seatGradeName:'W석'}],changeRound=false}={}){
  const context={sessionId:'private-session',bizCode:'private-biz',channelType:'NOL',goods:{goodsCode:expected.goodsCode,placeCode:expected.placeCode,reserved:true,isInterlocking:false,preOpt:'private-token'},playSeq:{playSeq:'001'}};
  const initial=structuredClone(context),calls=[];
  const circle={parentElement:{id:'seat_block_001:101'},getBoundingClientRect:()=>({width:2,height:2})};
  const sandbox={Date,URL,URLSearchParams,AbortSignal,location:{origin:'https://tickets.interpark.com',pathname:'/onestop/seat',href:'https://tickets.interpark.com/onestop/seat'},
    sessionStorage:{getItem:k=>k==='interpark/context'?JSON.stringify(context):null},getComputedStyle:()=>({display:'block',visibility:'visible'}),
    document:{querySelector:s=>s==='#__NEXT_DATA__'?{textContent:JSON.stringify({props:{pageProps:{initData:initial}}})}:null,querySelectorAll:s=>s==='circle.js-seat[id]'?[circle]:captcha&&s.includes('캡챠')?[circle]:[]},
    fetch:async(url,options)=>{calls.push({url,options});if(changeSession)context.sessionId='changed';if(changeRound&&options.method==='POST')context.playSeq.playSeq='002';
      const data=options.method==='GET'?{data:[{blockKey:'001:101',seats:[{seatInfoId:(foreign?'99999999':expected.goodsCode)+':25001730:001:466',rowIdx:0,colIdx:0,rowNo:'A',seatNo:'1',seatGrade:'3',isExposable:true,seatGroupId:null,unneededPrivateField:'private-data'}]}]}:{data:{getSeatGradePrices:gradeRows}};
      return {ok:true,text:async()=>JSON.stringify(data)};
    }};
  vm.createContext(sandbox);
  vm.runInContext('const readBookingContext='+readBookingContext.toString(),sandbox);
  vm.runInContext('const resolveGradeNames='+resolveGradeNames.toString(),sandbox);
  return {calls,sandbox,run:arg=>vm.runInContext(`(${readDetails.toString()})(${JSON.stringify({expected,blockKeys:['001:101'],includeGrades:true,expiresAt:Date.now()+20000,...arg})})`,sandbox)};
}
test('late attachment recovers only seat metadata and grade names without selecting or exporting credentials',async()=>{
  const f=fixture(),result=await f.run();
  assert.equal(result.blocks[0].seats[0].rowNo,'A');assert.equal(result.grades[0].name,'W석');
  assert.equal(f.calls[0].options.method,'GET');
  assert.deepEqual(new URL(f.calls[0].url,'https://tickets.interpark.com').searchParams.getAll('blockKeys'),['001:101']);
  const body=JSON.parse(f.calls[1].options.body);assert.match(body.query,/^query HelperSeatGradeNames/);assert.ok(!body.query.includes('mutation'));assert.match(body.query,/getSeatGradePrices/);assert.ok(!body.query.includes('getRemainSeats'));assert.equal(body.variables.input.playSeq,expected.playSeq);assert.equal(f.calls[1].options.cache,'no-store');
  assert.ok(!JSON.stringify(result).includes('private-'));
});

test('metadata and grade queries overlap, join before returning, and record separate durations',async()=>{
  const f=fixture(),releases=[],fetch=f.sandbox.fetch;
  f.sandbox.fetch=(...args)=>new Promise(resolve=>releases.push(()=>resolve(fetch(...args))));
  let finished=false;const pending=f.run().then(value=>{finished=true;return value;});
  assert.equal(releases.length,2);releases[1]();await new Promise(r=>setImmediate(r));assert.equal(finished,false);
  releases[0]();const result=await pending;assert.equal(result.blocks.length,1);assert.equal(result.grades.length,1);
  for(const key of ['metadataMs','gradesMs','totalMs'])assert.ok(Number.isFinite(result.timings[key]));
});

test('a failed parallel read joins the other read before returning an error',async()=>{
  const f=fixture();let release;f.sandbox.fetch=async(_url,options)=>{if(options.method==='GET')throw Error('fixture read failure');return new Promise(r=>{release=()=>r({ok:true,text:async()=>JSON.stringify({data:{getSeatGradePrices:[]}})});});};
  let finished=false;const pending=f.run().catch(error=>{finished=true;throw error;}),rejected=assert.rejects(pending,/fixture/);
  await new Promise(r=>setImmediate(r));assert.equal(finished,false);release();await rejected;
});
test('unobserved block, wrong booking and expired command produce no detail requests',async()=>{
  for(const arg of [{blockKeys:['001:999']},{expected:{...expected,playSeq:'002'}},{expiresAt:0}]){const f=fixture();await assert.rejects(f.run(arg));assert.equal(f.calls.length,0);}
});
test('CAPTCHA blocks detail recovery and foreign seat responses cannot be used',async()=>{
  const captcha=fixture({captcha:true});await assert.rejects(captcha.run(),/안내·인증/);assert.equal(captcha.calls.length,0);
  const foreign=fixture({foreign:true});await assert.rejects(foreign.run(),/다른 상품/);assert.equal(foreign.calls.length,2);
});
test('session changes during a read discard the response before another request',async()=>{
  const f=fixture({changeSession:true});await assert.rejects(f.run(),/세션이 바뀌/);assert.equal(f.calls.length,1);
});

// Grade-price responses intentionally have no per-row event identity fields.
test('postseason map grade names allow nullable entries without requiring sports-group identities',async()=>{
  const f=fixture({gradeRows:[null,{seatGrade:'01',seatGradeName:'1루 오렌지석'},null]});
  const result=await f.run({blockKeys:[]});assert.deepEqual(JSON.parse(JSON.stringify(result.grades)),[{code:'01',name:'1루 오렌지석'}]);assert.equal(f.calls.length,1);
});
test('a changed round during grade-price lookup cannot populate a different booking',async()=>{
  const f=fixture({changeRound:true});await assert.rejects(f.run(),/BOOTSTRAP_CONTEXT_MISMATCH|세션/);
});
test('malformed grade names remain rejected rather than silently mislabeling seats',async()=>{
  for(const gradeRows of [[{seatGrade:'',seatGradeName:'석'}],[{seatGrade:'1',seatGradeName:''}],[{seatGrade:{bad:true},seatGradeName:'석'}]])await assert.rejects(fixture({gradeRows}).run(),/좌석 등급/);
});
test('spacing variants deduplicate while genuinely ambiguous grades do not abort unrelated grades',async()=>{
  const result=await fixture({gradeRows:[{seatGrade:'1',seatGradeName:'블루 존'},{seatGrade:'1',seatGradeName:'블루존'},{seatGrade:'2',seatGradeName:'일반석'},{seatGrade:'2',seatGradeName:'시야방해석'},{seatGrade:'3',seatGradeName:'W석'}]}).run();
  assert.deepEqual(JSON.parse(JSON.stringify(result.grades)),[{code:'1',name:'블루 존'},{code:'3',name:'W석'}]);
  assert.equal(result.duplicateCount,1);assert.deepEqual(JSON.parse(JSON.stringify(result.gradeConflicts)),[{code:'2',names:['일반석','시야방해석']}]);
});
