'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {bookingObservation,inspectionState}=require('../src/booking-observation');
const {metadataUrl,parseMetadata}=require('../src/metadata');
const {normalizePreferences}=require('../src/preferences');
const flow=require('../src/flow');

test('record serializes independently and never exports bootstrap credentials or prices',()=>{
  const initial={token:'PRIVATE',sessionId:'PRIVATE',entMemberCode:'PRIVATE',goods:{goodsCode:'26014421',placeCode:'26001228',reserved:true,extra:'PRIVATE'},playSeq:{playSeq:'001',bookWait:false,seats:[{seatGrade:'19',seatGradeName:'3루 레드석',remainCount:1,salesPrice:55000,token:'PRIVATE'}]}};
  const document={querySelector:()=>({textContent:JSON.stringify({props:{pageProps:{initData:initial}}})}),querySelectorAll:()=>[]};
  const result=vm.runInNewContext('('+bookingObservation.toString()+')()',{document,location:{origin:'https://tickets.interpark.com',pathname:'/onestop/seat'},URL,Date});
  const text=JSON.stringify(result);assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('salesPrice'));assert.equal(result.initialGrades[0].remainCount,1);assert.equal(result.goods.goodsCode,'26014421');assert.equal(result.play.playSeq,'001');
});

test('inspection mode waits for a visible challenge to disappear and never skips a dialog',()=>{
  const run={preferences:normalizePreferences({stopAfterCaptcha:true})},ready={grades:[{name:'일반',count:0}]};
  assert.equal(inspectionState(run,{...ready,captcha:true},0),null);
  assert.equal(inspectionState(run,{...ready,busy:true},1).waiting,true);
  assert.equal(inspectionState(run,{...ready,dialog:{kind:'unknown'}},2).waiting,true);
  assert.equal(inspectionState(run,ready,3).ready,true);
});

test('inspection without a challenge requires a stable ready screen and explicitly reports no challenge',()=>{
  const run={preferences:normalizePreferences({stopAfterCaptcha:true})},ready={hasSeats:true};
  assert.equal(inspectionState(run,ready,0).waiting,true);
  assert.equal(inspectionState(run,{busy:true},2000).waiting,true);
  assert.equal(inspectionState(run,ready,2100).waiting,true);
  assert.equal(inspectionState(run,ready,4599).waiting,true);
  assert.match(inspectionState(run,ready,4600).message,/표시되지 않았거나/);
  assert.equal(inspectionState({preferences:normalizePreferences()},ready),null);
});

test('external metadata is observed only at the exact HTTPS origin and parsed conservatively',()=>{
  assert.equal(metadataUrl('https://tickets.interpark.com/onestop/api/externalSeatMeta?blockKeys=001:123'),true);
  for(const u of ['http://tickets.interpark.com/onestop/api/externalSeatMeta','https://evil.test/onestop/api/externalSeatMeta','https://user:secret@tickets.interpark.com/onestop/api/seatMeta','https://tickets.interpark.com/onestop/api/externalSeatStatus'])assert.equal(metadataUrl(u),false);
  assert.deepEqual(parseMetadata({unexpected:{seats:[]}}),[]);
});

test('conflict notice accepts known already-selected wording but never payment or unknown confirmations',()=>{
  for(const [message,ok] of [['다른 예매자가 이미 선택한 좌석입니다.',true],['다른 고객님이 먼저 선택한 좌석입니다.',true],['이미 선택된 좌석입니다.',true],['좌석 결제 확인에 동의합니다.',false],['로그인이 필요합니다.',false]]){
    let clicks=0;const size=()=>({width:10,height:10});
    const button={textContent:'확인',disabled:false,getBoundingClientRect:size,click(){clicks++;}};
    const modal={textContent:message,getBoundingClientRect:size,querySelector:()=>null,querySelectorAll:()=>[button]};
    const context={siteInvoke:e=>e.click(),window:{},URL,location:{href:'https://tickets.interpark.com/onestop/seat'},document:{querySelectorAll:()=>[modal]},getComputedStyle:()=>({visibility:'visible',display:'block'})};
    const invoke=()=>vm.runInNewContext('('+flow.dismissConflict.toString()+')()',context);
    if(ok){invoke();assert.equal(clicks,1);}else{assert.throws(invoke);assert.equal(clicks,0);}
  }
});
