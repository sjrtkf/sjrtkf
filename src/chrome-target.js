const directApi=require('./direct-seat-api'),publicGame=require('./public-game');
const pricePage=require('./price-page');
const seatDetails=require('./seat-details');
const httpBooking=require('./http-booking');
'use strict';
const observation=require('./booking-observation');
const {EventEmitter}=require('node:events');
const entry=require('./entry'),live=require('./live-adapter'),flow=require('./flow'),captcha=require('./captcha-page'),manualCaptcha=require('./manual-captcha-page');
const pageActions={
  stopWatchers:function stopWatchers(){if(window.__ticketDirectApi)window.__ticketDirectApi.cancelled=true;if(window.__ticketHttpBooking){window.__ticketHttpBooking.cancelled=true;try{const r=JSON.parse(sessionStorage.getItem("baseball/http-booking")||"null");if(r){r.cancelled=true;sessionStorage.setItem("baseball/http-booking",JSON.stringify(r));}}catch{}}window.__ticketSeatChanges?.stop();window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();return true;},
  pageClock:function pageClock(){return {pageMono:performance.now(),documentId:window.__bearsGate?.status.documentId};},
  gateSnapshot:function gateSnapshot(){return window.__bearsGate?.status||null;},
  showAll:function showAll(){const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='전체보기'&&e.getBoundingClientRect().width>0);if(!b)return true;return new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);observer.disconnect();resolve(true);};const observer=new MutationObserver(finish);observer.observe(b.parentElement||document.body,{subtree:true,childList:true,attributes:true});timer=setTimeout(finish,1500);siteInvoke(b);});}
};
pageActions.gateState=pageActions.gateSnapshot;pageActions.showAllGames=pageActions.showAll;
const functionActions=new Map();
for(const [group,functions] of Object.entries({entry,live,flow,captcha,manualCaptcha,observation,directApi,publicGame,seatDetails,pricePage,httpBooking,page:pageActions}))for(const [name,fn] of Object.entries(functions))if(typeof fn==='function')functionActions.set(fn,`${group}.${name}`);
class ChromeTarget extends EventEmitter{
  constructor(bridge,tab){super();this.bridge=bridge;this.id=tab.id;this.destroyed=false;this.update(tab);}
  update(tab){const prior=this.tab;this.tab={...tab};if(prior&&prior.url!==tab.url)this.emit('did-start-navigation',{},tab.url,true,true);if(prior&&prior.title!==tab.title)this.emit('page-title-updated');}
  getURL(){return this.tab.url;}getTitle(){return this.tab.title;}isDestroyed(){return this.destroyed;}
  get documentId(){return this.tab.documentId;}set documentId(value){this.tab.documentId=value;}
  invoke(fn,arg){let action=typeof fn==='string'?fn:functionActions.get(fn);if(typeof action==='string'&&!action.includes('.'))action='page.'+action;if(!action)return Promise.reject(Error('Chrome에 등록되지 않은 보조 동작입니다.'));if(this.destroyed)return Promise.reject(Error('닫힌 Chrome 탭입니다.'));return this.bridge.request({action,tabId:this.id,arg,documentId:this.tab.documentId});}
  readSeats(){return this.invoke(live.liveRead);}seatAction(row,action){return this.invoke(live.liveAction,{row,action});}
  async focus(){return this.bridge.request({action:'tabs.focus',tabId:this.id});}
  attachNetwork(){return this.bridge.request({action:'network.attach',tabId:this.id});}
  detachNetwork(){return this.bridge.request({action:'network.detach',tabId:this.id});}
  async setZoomFactor(factor){return this.bridge.request({action:'tabs.zoom',tabId:this.id,arg:{factor}});}
  async zoom(delta){return this.bridge.request({action:'tabs.zoom',tabId:this.id,arg:{delta}});}
  isDemo(){return /^chrome-extension:\/\/[a-p]{32}\/demo.html$/.test(this.tab.url);}
  destroy(){this.dispose();}
  dispose(){if(this.destroyed)return;this.destroyed=true;this.emit('destroyed');}
}
module.exports={ChromeTarget,pageActions,functionActions};
