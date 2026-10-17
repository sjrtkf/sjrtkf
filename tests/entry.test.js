'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const entry=require('../src/entry');
function fixture(){
  let clicks=0,callback;
  const button={disabled:true,textContent:'09/18 11:00 예매하기',getAttribute(){return null;},getBoundingClientRect(){return {width:100,height:40};},click(){clicks++;}};
  const main={textContent:'예매 준비가 완료됐어요',querySelectorAll(){return [button];}};
  const document={body:{},querySelector(){return main;},querySelectorAll(){return [];}};
  const context=vm.createContext({siteInvoke:(e,kind,value)=>{if(kind==='change'){e.value=value;e.siteChange?.(value);return;}return e.click();},document,window:{},location:{origin:'https://tickets.interpark.com',pathname:'/gates/ticket/26005452'},performance:{now:()=>0},Date,getComputedStyle:()=>({display:'block',visibility:'visible'}),setTimeout:()=>1,clearTimeout(){},MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){}}});
  return {context,button,main,document,tick:()=>callback(),clicks:()=>clicks,run:(fn,arg)=>vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context)};
}
test('게이트는 활성화 전에는 클릭하지 않고 실제 활성화 순간 한 번만 클릭한다',()=>{
  const f=fixture();f.run(entry.armGate,{goodsCode:'26005452'});assert.equal(f.clicks(),0);
  f.button.disabled=false;f.tick();assert.equal(f.clicks(),0,'시간 표기 버튼은 개방으로 해석하지 않는다');
  f.button.textContent='예매하기';f.tick();f.tick();f.run(entry.armGate,{goodsCode:'26005452'});assert.equal(f.clicks(),1);
});
test('이미 열린 경기의 자동 진행과 경합하지 않고 비활성 카운트다운 전이를 지원한다',()=>{
  const f=fixture();f.button.disabled=false;f.button.textContent='예매하기';
  const status=f.run(entry.armGate,{goodsCode:'26005452'});f.tick();assert.equal(f.clicks(),0);assert.equal(status.observedDisabled,false);
  f.button.disabled=true;f.button.textContent='남은시간 00:02';f.tick();assert.equal(status.observedDisabled,true);
  f.button.disabled=false;f.button.textContent='예매하기';f.tick();assert.equal(f.clicks(),1);
});
test('게이트 준비 문구/상품/모달 검증 실패 시 닫힌 상태로 대기한다',()=>{
  const f=fixture();f.button.disabled=false;f.button.textContent='예매하기';f.main.textContent='회원 인증 필요';
  assert.equal(f.run(entry.gateStatus).enabled,false);f.run(entry.armGate,{goodsCode:'26005452'});f.tick();assert.equal(f.clicks(),0);
  f.main.textContent='예매 준비가 완료됐어요';f.document.querySelectorAll=()=>[f.button];f.tick();assert.equal(f.clicks(),0,'모달이 존재하면 진행 금지');
  assert.equal(f.run(entry.gateStatus,{goodsCode:'99999999'}).enabled,false);
  assert.throws(()=>f.run(entry.armGate,{goodsCode:'99999999'}),/준비 화면/);
});
test('중지 또는 사이트 자체 이동 후에는 지연된 DOM 변경이 클릭을 만들지 않는다',()=>{
  for(const how of ['stop','navigate']){
    const f=fixture();f.run(entry.armGate,{goodsCode:'26005452'});
    if(how==='stop')f.context.window.__bearsGate.stop();else{f.context.location.pathname='/onestop/seat';f.tick();}
    f.button.disabled=false;f.button.textContent='예매하기';f.tick();assert.equal(f.clicks(),0);
  }
});
test('카드 준비 진입은 오픈 시각과 무관하게 활성 카드만 한 번 클릭한다',()=>{
  const f=fixture();f.button.disabled=false;f.button.textContent='예매하기';
  f.button.parentElement={querySelector:()=>({textContent:'9월 23일'}),querySelectorAll:()=>[{alt:'두산'},{alt:'KIA'}]};
  f.document.querySelectorAll=()=>[f.button];
  const args={key:'9월 23일 | 두산 vs KIA'};f.run(entry.prepareEntry,args);f.run(entry.prepareEntry,args);assert.equal(f.clicks(),1);
  f.context.window.__bearsEntry=null;f.button.disabled=true;assert.throws(()=>f.run(entry.prepareEntry,args),/활성화/);assert.equal(f.clicks(),1);
});
test('명시적 새 실행은 이전 카드 클릭 상태를 재사용하지 않으며 게이트 관찰을 새로 시작한다',()=>{
  const f=fixture();f.button.disabled=false;f.button.textContent='예매하기';f.button.parentElement={querySelector:()=>({textContent:'9월 23일'}),querySelectorAll:()=>[{alt:'두산'},{alt:'KIA'}]};f.document.querySelectorAll=()=>[f.button];
  f.run(entry.prepareEntry,{key:'9월 23일 | 두산 vs KIA',runId:'r1'});f.run(entry.prepareEntry,{key:'9월 23일 | 두산 vs KIA',runId:'r2'});assert.equal(f.clicks(),2);
  f.document.querySelectorAll=()=>[];f.button.disabled=true;f.run(entry.armGate,{goodsCode:'26005452',runId:'r1'});f.context.window.__bearsGate.stop();
  const status=f.run(entry.armGate,{goodsCode:'26005452',runId:'r2'});assert.equal(status.phase,'armed');assert.equal(status.runId,'r2');assert.equal(status.observedDisabled,true);
});
