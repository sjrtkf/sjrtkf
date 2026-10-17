'use strict';
// Shared with the static extension bundle. Never return signed URLs or bodies
// to the desktop logger. A redirect is a candidate, not proof of admission.
function classifyEntryResponse(status,body){
  if(status===429)return {outcome:'blocked',code:'RATE_LIMITED'};
  let data;try{data=typeof body==='string'?JSON.parse(body):body;}catch{return {outcome:'unknown',code:'INVALID_RESPONSE'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {outcome:'unknown',code:'INVALID_RESPONSE'};
  const code=typeof data.error==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(data.error)?data.error:null;
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

// Guard one operation per document/run. Never replay a signed request. Multiple
// local callers share the same result, including a rejection or unknown outcome.
function createEntryHttp({assertActive,onStatus=()=>{}}){
  const original=window.fetch;let stopped=false,claimed=false,task=null,requestBody,requestMethod;
  const status={outcome:'waiting',requestCount:0,code:null,httpStatus:null};
  const report=patch=>{Object.assign(status,patch);onStatus({...status});};
  const active=()=>{if(stopped)throw Error('SITE_CODE_STOPPED');assertActive();};
  const restore=()=>{if(window.fetch===wrapped)window.fetch=original;};
  const wrapped=function(input,init){
    let u;try{u=new URL(typeof input==='string'?input:input?.url,location.href);}catch{return original.call(this,input,init);}
    if(u.origin!=='https://ent-waiting-api.interpark.com'||u.pathname!=='/waiting/api/secure-url')return original.call(this,input,init);
    if(claimed){
      if(init?.body!==requestBody||init?.method!==requestMethod)return Promise.reject(Error('SITE_ENTRY_REQUEST_CONFLICT'));
      return task.then(response=>{active();return response.clone();});
    }
    claimed=true;requestBody=init?.body;requestMethod=init?.method;
    // Defer execution until task is assigned, so synchronous observers cannot
    // re-enter the wrapper while its shared promise is still null.
    task=Promise.resolve().then(async()=>{
      active();
      if(init?.method!=='POST'||typeof init.body!=='string'||init.body.length>65536||input instanceof Request)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      let payload;try{payload=JSON.parse(init.body);}catch{throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');}
      if(typeof payload.signature!=='string'||!payload.signature||typeof payload.secureData!=='string'||!payload.secureData)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      report({outcome:'pending',requestCount:1,startedMono:performance.now()});
      let response,body;
      try{
        response=await original.call(window,input,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(30000),...(init.signal?[init.signal]:[])])});
        body=await response.clone().text();
      }catch(error){report({outcome:'unknown',code:'NETWORK_OUTCOME_UNKNOWN',finishedMono:performance.now()});throw error;}
      active();
      const result=classifyEntryResponse(response.status,body);
      report({...result,httpStatus:response.status,finishedMono:performance.now()});
      if(result.outcome==='redirect-ready')return response;
      // P40057 is not yet a verified secure-url retry contract. Do not infer
      // permission to reuse a signed body from a code seen on another endpoint.
      throw Error('SITE_ENTRY_RESPONSE_REJECTED');
    }).catch(error=>{if(status.outcome==='waiting')report({outcome:'unknown',code:'REQUEST_NOT_SENT'});throw error;});
    return task.then(response=>{active();return response.clone();});
  };
  window.fetch=wrapped;
  return {status,dispose:restore,stop(){stopped=true;restore();},get claimed(){return claimed;}};
}
module.exports={classifyEntryResponse,createEntryHttp};
