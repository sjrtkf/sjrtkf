'use strict';
(()=>{
  if(globalThis.__baseballContentInstalled)return;globalThis.__baseballContentInstalled=true;
  let leaseUntil=0,demoTabId=null;const demo=location.href===chrome.runtime.getURL('demo.html'),demoDocumentId=demo?'demo:'+crypto.randomUUID():null;
  const demoReady=demo?chrome.tabs.getCurrent().then(tab=>{demoTabId=tab.id;}):Promise.resolve();const stop=()=>{window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();};
  const ready=()=>demoReady.then(()=>chrome.runtime.sendMessage({type:'baseball-document',documentEpoch:String(performance.timeOrigin),...(demo?{demoTabId,documentId:demoDocumentId}:{})})).catch(()=>{});
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(sender.id!==chrome.runtime.id||sender.tab)return;
    if(demo&&message?.demoTabId!==demoTabId)return;
    if(demo&&(message?.demoDocumentId||message?.type==='baseball-action')&&message.demoDocumentId!==demoDocumentId){sendResponse({error:'페이지가 바뀌어 이전 화면의 동작을 취소했습니다.'});return;}
    if(message?.type==='baseball-ping'){sendResponse({ready:true,...(demo?{documentId:demoDocumentId}:{})});return;}
    if(message?.type==='baseball-lease'){leaseUntil=performance.now()+5000;sendResponse({ready:true});return;}
    if(message?.type==='baseball-stop'){leaseUntil=0;stop();sendResponse({stopped:true});return;}
    if(message?.type!=='baseball-action'||!Object.hasOwn(BaseballActions,message.action))return;
    if(leaseUntil<=performance.now()&&message.action!=='page.stopWatchers'){sendResponse({error:'프로그램과 Chrome의 연결 상태를 확인해 주세요.'});return;}
    Promise.resolve().then(()=>{if(message.action!=='page.stopWatchers'&&(!Number.isFinite(message.expiresAt)||Date.now()>message.expiresAt))throw Error('만료된 보조 동작을 취소했습니다.');return BaseballActions[message.action](message.arg);}).then(value=>sendResponse({value}),error=>sendResponse({error:String(error?.message||error).slice(0,700)}));return true;
  });
  // Safety lease only. Gate clicks execute directly on page DOM events.
  setInterval(()=>{if(leaseUntil&&leaseUntil<=performance.now()){leaseUntil=0;stop();}},250);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
