'use strict';

// Metadata owns CDP attachment and Network.enable. This observer only listens;
// sensitive request data and debugger identifiers never leave the pending map.
const ENTRY_ORIGIN='https://ent-waiting-api.interpark.com';
const ENTRY_PATH='/waiting/api/secure-url';
function isEntryRequest(request){
  if(!request||request.method!=='POST'||typeof request.url!=='string')return false;
  try{
    const url=new URL(request.url);
    return url.origin===ENTRY_ORIGIN&&url.pathname===ENTRY_PATH&&!url.username&&!url.password;
  }catch{return false;}
}
function attach(wc,onEvent,{now=()=>performance.now()}={}){
  let debuggerClient,disposed=false,healthy=false,sequence=0;
  const pending=new Map();
  const report=event=>{try{onEvent(event);}catch{/* Do not crash the native app from an observer callback. */}};
  const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:undefined;
  const finish=(kind,p,overrideStatus)=>{
    const record=pending.get(p.requestId);if(!record)return;
    pending.delete(p.requestId);
    const event={kind,atMono:now(),seq:record.seq};
    const code=status(overrideStatus)??record.status;if(code!==undefined)event.status=code;
    if(Number.isFinite(p.timestamp)&&Number.isFinite(record.startedAt)&&p.timestamp>=record.startedAt)event.durationMs=(p.timestamp-record.startedAt)*1000;
    report(event);
  };
  const handler=(_event,method,p)=>{
    if(disposed||!p||typeof p.requestId!=='string')return;
    if(method==='Network.requestWillBeSent'){
      // A redirect reuses its request ID. Complete this endpoint's segment so
      // later responses from another origin cannot be attributed to it.
      if(pending.has(p.requestId)){
        if(p.redirectResponse)finish('finished',p,p.redirectResponse.status);
        else return;
      }
      if(!isEntryRequest(p.request))return;
      const record={seq:++sequence,startedAt:p.timestamp};
      pending.set(p.requestId,record);
      report({kind:'request',atMono:now(),seq:record.seq});
    }else if(method==='Network.responseReceived'&&pending.has(p.requestId)){
      pending.get(p.requestId).status=status(p.response?.status);
    }else if(method==='Network.loadingFinished')finish('finished',p);
    else if(method==='Network.loadingFailed')finish('failed',p);
  };
  const dispose=()=>{
    if(disposed)return;
    disposed=true;healthy=false;pending.clear();
    debuggerClient?.removeListener('message',handler);
    debuggerClient?.removeListener('detach',lost);
    wc.removeListener('destroyed',lost);
  };
  const lost=()=>{
    if(disposed)return;
    dispose();report({kind:'observer-lost',atMono:now()});
  };
  try{debuggerClient=wc.debugger;healthy=!!debuggerClient.isAttached();}catch{}
  if(healthy){
    debuggerClient.on('message',handler);
    debuggerClient.on('detach',lost);
    wc.once('destroyed',lost);
  }else lost();
  return {dispose,get healthy(){return healthy;}};
}
module.exports={attach,isEntryRequest,classifyEntryResponse:require('./entry-http').classifyEntryResponse,...require('./entry-observation')};
