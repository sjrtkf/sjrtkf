'use strict';
// Shared with the static extension bundle. Never return signed URLs or bodies
// to the desktop logger. A redirect is a candidate, not proof of admission.
function classifyEntryResponse(status,body){
  let data;try{data=typeof body==='string'?JSON.parse(body):body;}catch{return {outcome:'unknown',code:'INVALID_RESPONSE'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {outcome:'unknown',code:'INVALID_RESPONSE'};
  const code=typeof data.error==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(data.error)?data.error:null;
  if(status===429)return {outcome:'blocked',code:'RATE_LIMITED'};
  if(status>=200&&status<300&&!data.error){
    try{const u=new URL(data.redirectUrl);if(u.origin==='https://tickets.interpark.com'&&!u.username&&!u.password&&!u.hash&&!/\/(?:error|fail)(?:\/|$)/i.test(u.pathname)&&!u.searchParams.has('errorCode')&&!u.searchParams.has('error')&&/^\/(?:waiting(?:\/|$)|onestop(?:\/|$))/.test(u.pathname))return {outcome:'redirect-ready',code:'VALID_REDIRECT'};}catch{}
    return {outcome:'unknown',code:'INVALID_REDIRECT'};
  }
  // P40057 is the published onestop PRODUCT_NOT_OPEN code. Only an explicit
  // rejection carrying that exact code qualifies; never infer it from HTTP 403.
  // Its occurrence on secure-url has not yet been observed in a live opening.
  if(status>=400&&status<500&&![401,429].includes(status)&&code==='P40057'&&!data.redirectUrl)return {outcome:'not-open',code};
  return {outcome:status>=400&&status<500?'blocked':'unknown',code:code||'UNCLASSIFIED_RESPONSE'};
}

// Wrap exactly one site-created secure-url operation. The site creates its own
// current signed body; it stays in this closure. No cookie extraction or replay
// across documents/runs. Only explicit not-open responses can be retried.
function createEntryHttp({startMono,endMono,assertActive,onStatus,intervalMs=30}){
  if(![startMono,endMono,intervalMs].every(Number.isFinite)||endMono<startMono||endMono-startMono>2000||intervalMs!==30)throw Error('SITE_ENTRY_CONFIG_INVALID');
  const original=window.fetch;let stopped=false,claimed=false,task=null,timer=null,wake=null;
  const status={outcome:'waiting',requestCount:0,code:null,httpStatus:null};
  const report=patch=>{Object.assign(status,patch);onStatus({...status});};
  const active=()=>{if(stopped)throw Error('SITE_CODE_STOPPED');assertActive();};
  const restore=()=>{if(window.fetch===wrapped)window.fetch=original;};
  const wait=async until=>{while(performance.now()<until){active();await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,Math.min(50,Math.max(1,until-performance.now())));});wake=null;timer=null;}active();};
  const wrapped=function(input,init){
    let u;try{u=new URL(typeof input==='string'?input:input?.url,location.href);}catch{return original.call(this,input,init);}
    if(u.origin!=='https://ent-waiting-api.interpark.com'||u.pathname!=='/waiting/api/secure-url')return original.call(this,input,init);
    // Coalesce duplicate calls from the site's automatic path or the user.
    if(claimed)return task.then(response=>response.clone());
    claimed=true;
    task=(async()=>{
      active();
      if(init?.method!=='POST'||typeof init.body!=='string'||init.body.length>65536||input instanceof Request)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      let payload;try{payload=JSON.parse(init.body);}catch{throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');}
      if(typeof payload.signature!=='string'||!payload.signature||typeof payload.secureData!=='string'||!payload.secureData)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      const request={...init,headers:new Headers(init.headers),redirect:'error'};
      let next=Math.max(startMono,performance.now()),lastStart=-Infinity;
      for(;;){
        await wait(next);active();
        if(performance.now()>endMono){report({outcome:'expired',code:'RETRY_WINDOW_ENDED'});throw Error('SITE_ENTRY_WINDOW_ENDED');}
        lastStart=performance.now();report({outcome:'pending',requestCount:status.requestCount+1,startedMono:lastStart});
        let response,body;
        try{
          response=await original.call(window,input,{...request,signal:AbortSignal.any([AbortSignal.timeout(8000),...(init.signal?[init.signal]:[])])});
          body=await response.clone().text();
        }catch(error){report({outcome:'unknown',code:'NETWORK_OUTCOME_UNKNOWN'});throw error;}
        active();
        const result=classifyEntryResponse(response.status,body);report({...result,httpStatus:response.status,finishedMono:performance.now()});
        if(result.outcome==='redirect-ready')return response;
        if(result.outcome!=='not-open')throw Error('SITE_ENTRY_RESPONSE_REJECTED');
        // Skip elapsed slots; never burst to catch up after a delayed timer.
        next=Math.max(lastStart+intervalMs,startMono+Math.ceil((performance.now()-startMono)/intervalMs)*intervalMs);
        if(next>endMono){report({outcome:'expired',code:'RETRY_WINDOW_ENDED'});throw Error('SITE_ENTRY_WINDOW_ENDED');}
      }
    })().finally(restore);
    return task;
  };
  window.fetch=wrapped;
  return {status,dispose:restore,stop(){stopped=true;clearTimeout(timer);wake?.();if(claimed)restore();},get claimed(){return claimed;}};
}
module.exports={classifyEntryResponse,createEntryHttp};
