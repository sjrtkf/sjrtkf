'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const flow=require('../src/flow'),entry=require('../src/entry');
function fixture({notice=true,heading='예매 안내',headingTag='h2',body='N석 응원석 / 테이블석 / 데크존 / 원정석 예매 유의사항',label='확인하고 예매하기',input=false,modal=true}={}){
  let clicks=0,gateClicks=0,observer;const size=()=>({width:100,height:40});
  const documentBody={dataset:{}};
  const title={textContent:heading,getBoundingClientRect:size};
  const button={textContent:label,disabled:false,getAttribute:()=>null,getBoundingClientRect:size,click(){clicks++;}};
  const field={getBoundingClientRect:size};
  const container={parentElement:documentBody,textContent:heading+' '+body+' '+label,getBoundingClientRect:size,contains:e=>e===button,querySelector:()=>null,
    querySelectorAll(selector){if(selector.startsWith('h1,'))return selector.split(',').includes(headingTag)?[title]:[];if(selector==='button')return [button];if(selector.startsWith('input,'))return input?[field]:[];return [];}};
  button.parentElement=container;
  const gateButton={textContent:'남은시간 00:01',disabled:true,getAttribute:()=>null,getBoundingClientRect:size,click(){gateClicks++;}};
  const main={textContent:'예매 준비가 완료됐어요',querySelectorAll:()=>[gateButton,...(notice?[button]:[])]};
  const document={body:documentBody,querySelector:selector=>selector==='main'?main:null,querySelectorAll(selector){
    if(selector==='button')return [gateButton,...(notice?[button]:[])];
    if(selector.includes('[role="dialog"]')||selector.includes('[role="alertdialog"]'))return notice&&modal?[container]:[];
    return [];
  }};
  const context=vm.createContext({siteInvoke:(e,kind,value)=>{if(kind==='change'){e.value=value;e.siteChange?.(value);return;}return e.click();},window:{},document,location:{origin:'https://tickets.interpark.com',pathname:'/gates/ticket/26005452',href:'https://tickets.interpark.com/gates/ticket/26005452'},performance:{now:()=>0,timeOrigin:1},Date,URL,getComputedStyle:e=>({display:e.hidden?'none':'block',visibility:'visible'}),setTimeout:()=>1,clearTimeout(){},MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}});
  const run=(fn,arg)=>vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context);
  return {run,button,container,title,gateButton,context,clicks:()=>clicks,gateClicks:()=>gateClicks,setNotice:value=>notice=value,notify:()=>observer?.()};
}
test('Ordinary booking notice accepts the exact button once, including duplicate calls after DOM replacement',()=>{
  const f=fixture();assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),1);
  f.button.click=()=>{throw Error('A replaced listener must not run twice');};assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);
});

test('Cancellation deadline notice accepts its booking button and exposes the same stable key on gate and seat pages',()=>{
  const f=fixture({heading:'취소/환불 안내',body:'취소/환불 기간이 지난 예매를 선택했습니다. 이 일정은 예매 후 취소/환불이 불가합니다. 취소마감시간: 2026-10-15 15:00'});
  assert.equal(f.run(entry.gateStatus).notice.key,'취소/환불안내');
  assert.equal(f.run(flow.scene).notice.key,'취소/환불안내');
  const result=f.run(flow.clickKnown,'확인하고 예매하기');
  assert.equal(result.clicked,true);assert.equal(result.key,'취소/환불안내');assert.equal(f.clicks(),1);
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),1);
});

test('Different ordinary notices can follow immediately in one document, but each is acknowledged only once',()=>{
  const f=fixture(),firstText=f.container.textContent;assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').key,'예매안내');
  f.title.textContent='취소/환불 안내';f.container.textContent='취소/환불 안내 취소/환불 기간이 지난 예매입니다. 확인하고 예매하기';
  assert.equal(f.run(entry.gateStatus).notice.key,'취소/환불안내');
  assert.equal(f.run(flow.scene).notice.key,'취소/환불안내');
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);assert.equal(f.clicks(),2);
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),2);
  f.title.textContent='예매 안내';f.container.textContent=firstText;
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),2);
});

test('Consecutive booking notices with the same title distinguish seat-view guidance without repeating either notice',()=>{
  const f=fixture(),firstText=f.container.textContent,first=f.run(flow.clickKnown,'확인하고 예매하기');
  f.container.textContent='예매 안내 ※ 시야방해석 안내 경기장 구조로 인해 시야 방해가 있을 수 있으며, 이미지 내 별도 표시된 좌석은 시야방해석으로 관람하시기에 불편이 있을 수 있습니다. 취소 기간 이후, 시야 방해로 인한 취소는 불가능하며 세부사항은 예매안내 유의사항을 참고하여 주시기 바랍니다. 확인하고 예매하기';
  const gateNotice=f.run(entry.gateStatus).notice,seatNotice=f.run(flow.scene).notice;
  assert.equal(gateNotice.key,'예매안내');assert.equal(seatNotice.key,'예매안내');
  assert.equal(gateNotice.signature,seatNotice.signature);assert.notEqual(gateNotice.signature,first.signature);
  const second=f.run(flow.clickKnown,'확인하고 예매하기');
  assert.equal(second.signature,gateNotice.signature);assert.equal(second.clicked,true);assert.equal(f.clicks(),2);
  f.container.textContent=f.container.textContent.replaceAll(' ','\n  ');
  assert.equal(f.run(entry.gateStatus).notice.signature,second.signature);
  assert.equal(f.run(flow.scene).notice.signature,second.signature);
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),2);
  f.container.textContent=firstText;
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),2);
});

test('An exact ordinary title in plain markup is recognized but protected or unknown content remains blocked',()=>{
  for(const headingTag of ['span','p','strong','b','div']){
    const f=fixture({headingTag});
    assert.equal(f.run(entry.gateStatus).notice.key,'예매안내');assert.equal(f.run(flow.scene).notice.key,'예매안내');
    assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);assert.equal(f.clicks(),1);
    for(const options of [{heading:'예매 안내와 약관'},{body:'약관 동의가 필요합니다.'},{input:true}]){
      const blocked=fixture({headingTag,...options});
      assert.throws(()=>blocked.run(flow.clickKnown,'확인하고 예매하기'),/직접 확인|자동으로 확인하지/);assert.equal(blocked.clicks(),0);
    }
  }
});

test('A title-only latch from an earlier extension keeps its duplicate protection until the notice is absent',()=>{
  const f=fixture();f.context.window.__bearsBookingNotice={clicked:true,clickedKeys:['예매안내']};
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').pending,true);assert.equal(f.clicks(),0);
  f.setNotice(false);f.run(flow.scene);f.setNotice(true);
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);assert.equal(f.clicks(),1);
});
test('Absent notice returns immediately without timers, clicks, or a missing-button error',()=>{
  const f=fixture({notice:false});f.context.setTimeout=()=>{throw Error('No notice wait should be installed');};
  assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').present,false);assert.equal(f.clicks(),0);assert.equal(f.run(entry.gateStatus).notice.present,false);
});
test('Generic confirmation, authentication, expired-session and consent dialogs are never accepted',()=>{
  for(const options of [{label:'확인'},{heading:'본인 인증'},{heading:'결제 안내'},{heading:'알 수 없는 안내'},{body:'세션이 만료되었습니다.'},{body:'본인 인증을 진행해 주세요.'},{body:'보안문자를 입력해 주세요.'},{body:'약관 동의가 필요합니다.'},{body:'결제를 진행합니다.'},{body:'구매를 확정합니다.'},{input:true}]){
    const f=fixture(options);
    if(options.label)assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').present,false);
    else assert.throws(()=>f.run(flow.clickKnown,'확인하고 예매하기'),/직접 확인|자동으로 확인하지/);
    assert.equal(f.clicks(),0);
  }
});

test('Cancellation notice keeps authentication, consent, payment and input checks',()=>{
  for(const options of [{body:'본인 인증을 진행해 주세요.'},{body:'약관 동의가 필요합니다.'},{body:'결제를 진행합니다.'},{input:true}]){
    const f=fixture({heading:'취소/환불 안내',...options});
    assert.throws(()=>f.run(flow.clickKnown,'확인하고 예매하기'),/자동으로 확인하지/);assert.equal(f.clicks(),0);
  }
});

test('Multiple matching buttons or a separate visible dialog are not acknowledged',()=>{
  for(const duplicate of [true,false]){
    const f=fixture({heading:'취소/환불 안내'}),query=f.context.document.querySelectorAll;
    const other={...f.button,contains:()=>false,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:100,height:40})};
    f.context.document.querySelectorAll=selector=>{
      const values=query(selector);
      if(duplicate&&selector==='button')return [...values,other];
      if(!duplicate&&(selector.includes('[role="dialog"]')||selector.includes('[role="alertdialog"]')))return [...values,other];
      return values;
    };
    if(duplicate){assert.equal(f.run(entry.gateStatus).notice.key,null);assert.equal(f.run(entry.gateStatus).notice.enabled,false);assert.equal(f.run(flow.scene).notice.key,null);}
    assert.throws(()=>f.run(flow.clickKnown,'확인하고 예매하기'),/하나로 확인|자동으로 확인하지/);assert.equal(f.clicks(),0);
  }
});
test('A disabled notice is not clicked or latched and can be accepted after natural activation',()=>{
  const f=fixture();f.button.disabled=true;assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').disabled,true);assert.equal(f.clicks(),0);
  f.button.disabled=false;assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);assert.equal(f.clicks(),1);
});

test('Known non-modal sports grade sheet behind a notice is not an extra confirmation',()=>{
  for(const blocked of [false,true]){
    const f=fixture(),query=f.context.document.querySelectorAll;
    f.context.location.pathname='/onestop/seat';
    const choice={getBoundingClientRect:()=>({width:100,height:40}),matches:s=>s==='button[class*="SportsSeatGradeList_contentItem__"]'};
    const sheet={textContent:'관람 구역을 선택해 주세요 W석 5',getBoundingClientRect:()=>({width:100,height:400}),contains:()=>false,
      getAttribute:k=>k==='role'?'dialog':null,classList:{contains:n=>n==='nds-e-bottom-sheet__container'},
      querySelectorAll:s=>s==='button'?[choice]:blocked?[choice]:[]};
    f.context.document.querySelectorAll=s=>s.includes('[role="dialog"]')?[...query(s),sheet]:query(s);
    if(blocked)assert.throws(()=>f.run(flow.clickKnown,'확인하고 예매하기'),/자동으로 확인하지/);
    else assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);
    assert.equal(f.clicks(),blocked?0:1);
  }
});
test('Gate status distinguishes the notice from the underlying booking button and blocks its watcher',()=>{
  const f=fixture({modal:false}),status=f.run(entry.gateStatus);assert.equal(status.notice.present,true);assert.equal(status.notice.enabled,true);assert.equal(status.buttonText,'남은시간 00:01');assert.equal(status.enabled,false);
  f.run(entry.armGate,{goodsCode:'26005452',runId:1});f.gateButton.disabled=false;f.gateButton.textContent='예매하기';f.notify();assert.equal(f.gateClicks(),0);assert.equal(f.clicks(),0);
});
test('A late ordinary notice blocks an armed gate without mistaking its button for entry activation',()=>{
  const f=fixture({notice:false,modal:false});f.run(entry.armGate,{goodsCode:'26005452',runId:1});
  f.setNotice(true);f.gateButton.disabled=false;f.gateButton.textContent='예매하기';f.notify();assert.equal(f.gateClicks(),0);
  assert.equal(f.run(entry.gateStatus).notice.present,true);f.run(flow.clickKnown,'확인하고 예매하기');f.setNotice(false);f.notify();assert.equal(f.clicks(),1);assert.equal(f.gateClicks(),1);
});
test('Seat scene reports the same exact notice while an unrelated label does not become a notice',()=>{
  const f=fixture();assert.equal(f.run(flow.scene).notice.present,true);f.button.textContent='확인';assert.equal(f.run(flow.scene).notice.present,false);
});

test('same-title notice can reopen after an observed absence on the same document',()=>{for(const reader of [flow.scene,entry.gateStatus]){const f=fixture();f.run(flow.clickKnown,'확인하고 예매하기');f.setNotice(false);f.run(reader);f.setNotice(true);assert.equal(f.run(flow.clickKnown,'확인하고 예매하기').clicked,true);assert.equal(f.clicks(),2);}});
