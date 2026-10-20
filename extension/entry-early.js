globalThis.BaseballEarlyEntry=function(config){const classifyEntryResponse=function classifyEntryResponse(status,body){
  if(status===429)return {outcome:'blocked',code:'RATE_LIMITED'};
  let data;try{data=typeof body==='string'?JSON.parse(body):body;}catch{return {outcome:'unknown',code:'INVALID_RESPONSE'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {outcome:'unknown',code:'INVALID_RESPONSE'};
  const code=typeof data.error==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(data.error)?data.error:null;
  if(status>=200&&status<300&&!data.error){
    try{const u=new URL(data.redirectUrl);if(u.origin==='https://tickets.interpark.com'&&!u.username&&!u.password&&!u.hash&&!/\/(?:error|fail)(?:\/|$)/i.test(u.pathname)&&!u.searchParams.has('errorCode')&&!u.searchParams.has('error')&&/^\/(?:waiting(?:\/|$)|onestop(?:\/|$))/.test(u.pathname))return {outcome:'redirect-ready',code:'VALID_REDIRECT'};}catch{}
    return {outcome:'unknown',code:'INVALID_REDIRECT'};
  }
  if(status>=400&&status<500&&![401,429].includes(status)&&code==='P40057'&&!data.redirectUrl)return {outcome:'not-open',code};
  return {outcome:status>=400&&status<500?'blocked':'unknown',code:code||'UNCLASSIFIED_RESPONSE'};
};const createEntryHttp=function createEntryHttp({assertActive,onStatus=()=>{},beforeSend=null,getWindow=null}){
  const original=window.fetch,controllers=new Set(),timers=new Set();
  let stopped=false,claimed=false,task=null,body=null,cancel=null;
  const status={outcome:'waiting',requestCount:0,code:null,httpStatus:null};
  const report=patch=>{Object.assign(status,patch);onStatus({...status});};
  const active=()=>{if(stopped)throw Error('SITE_CODE_STOPPED');assertActive();};
  const restore=()=>{if(window.fetch===wrapped)window.fetch=original;};
  const cleanup=()=>{for(const id of timers)clearTimeout(id);timers.clear();for(const c of controllers)c.abort();controllers.clear();};
  const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},Math.max(0,ms));timers.add(id);return id;};
  const wrapped=function(input,init){
    let u;try{u=new URL(typeof input==='string'?input:input?.url,location.href);}catch{return original.call(this,input,init);}
    if(u.origin!=='https://ent-waiting-api.interpark.com'||u.pathname!=='/waiting/api/secure-url')return original.call(this,input,init);
    try{
      active();
      if(init?.method!=='POST'||typeof init.body!=='string'||init.body.length>65536||input instanceof Request)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      let payload;try{payload=JSON.parse(init.body);}catch{throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');}
      if(typeof payload.signature!=='string'||!payload.signature||typeof payload.secureData!=='string'||!payload.secureData)throw Error('SITE_ENTRY_REQUEST_UNSUPPORTED');
      if(claimed&&init.body!==body)throw Error('SITE_ENTRY_REQUEST_CONFLICT');
    }catch(e){return Promise.reject(e);}
    if(!claimed){
      claimed=true;body=init.body;
      const frozen={...init,headers:new Headers(init.headers),redirect:'error'};
      task=new Promise((resolve,reject)=>{
        let settled=false,inFlight=0,closed=false,win=null;
        const finish=(error,response,patch)=>{
          if(settled)return;settled=true;cleanup();frozen.signal?.removeEventListener('abort',cancel);
          if(patch)report({...patch,finishedMono:performance.now()});
          if(error)reject(error);else resolve(response);
        };
        cancel=()=>finish(Error('SITE_CODE_STOPPED'),null,{outcome:'stopped',code:'CANCELLED'});
        const expire=()=>finish(Error('SITE_ENTRY_WINDOW_EXPIRED'),null,{outcome:'expired',code:'RETRY_WINDOW_EXPIRED'});
        const fire=async()=>{
          if(settled)return;
          try{active();}catch(e){finish(e,null,{outcome:'stopped',code:'CANCELLED'});return;}
          if(win&&performance.now()>win.endMono){closed=true;if(!inFlight)expire();return;}
          const controller=new AbortController();controllers.add(controller);inFlight++;
          const timeout=later(()=>controller.abort(),8000),now=performance.now();
          report({outcome:'pending',requestCount:status.requestCount+1,startedMono:status.startedMono??now,lastAttemptMono:now});
          try{
            const response=await original.call(window,input,{...frozen,signal:controller.signal});
            const text=await response.clone().text();if(settled)return;active();
            let result=classifyEntryResponse(response.status,text);
            if(response.headers?.get('retry-after')!=null)result={outcome:'blocked',code:'RETRY_AFTER'};
            if(result.outcome==='redirect-ready'){controllers.delete(controller);finish(null,response,{...result,httpStatus:response.status});return;}
            const transient=result.outcome==='not-open'||response.status>=500&&response.status<=599&&result.code!=='RETRY_AFTER'&&!/blacklist/i.test(result.code||'');
            if(!win||!transient){finish(Error('SITE_ENTRY_RESPONSE_REJECTED'),null,{...result,httpStatus:response.status});return;}
            report({outcome:'pending',lastErrorCode:result.code,httpStatus:response.status});
          }catch(error){if(!settled)finish(error,null,{outcome:'unknown',code:'NETWORK_OUTCOME_UNKNOWN'});}
          finally{clearTimeout(timeout);timers.delete(timeout);controllers.delete(controller);inFlight--;if(!settled&&closed&&!inFlight)expire();}
        };
        const tick=()=>{
          if(settled)return;
          const now=performance.now();
          if(now>win.endMono){closed=true;if(!inFlight)expire();return;}
          if(now<win.startMono){later(tick,win.startMono-now);return;}
          void fire();
          if(settled)return;
          const next=win.startMono+(Math.floor((now-win.startMono)/30)+1)*30;
          later(tick,(next<=win.endMono?next:win.endMono+1)-performance.now());
        };
        Promise.resolve().then(async()=>{
          active();if(frozen.signal?.aborted)throw Error('SITE_CODE_STOPPED');
          frozen.signal?.addEventListener('abort',cancel,{once:true});
          if(beforeSend){report({outcome:'scheduled',preparedMono:performance.now()});await beforeSend();}
          if(settled)return;active();
          if(getWindow){
            win=getWindow();
            if(!win||![win.startMono,win.endMono].every(Number.isFinite)||win.endMono<win.startMono||win.endMono-win.startMono>4000)throw Error('SITE_ENTRY_WINDOW_INVALID');
            later(expire,win.endMono+8000-performance.now());tick();
          }else void fire();
        }).catch(error=>{if(!settled)finish(error,null,{outcome:'unknown',code:'REQUEST_NOT_SENT'});});
      });
    }
    return task.then(response=>{active();return response.clone();});
  };
  window.fetch=wrapped;
  return {status,dispose:restore,stop(){stopped=true;cancel?.();cleanup();restore();},get claimed(){return claimed;}};
};(function installEarlyEntry({goodsCode,runId}={}){
  if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/gates/ticket/'+goodsCode)return;
  window.__ticketEarlyEntry?.stop();
  let handlers=null,stopped=false,adopt;
  const ready=new Promise(resolve=>{adopt=resolve;});
  const http=createEntryHttp({
    assertActive:()=>{if(stopped)throw Error('SITE_CODE_STOPPED');handlers?.assertActive();},
    beforeSend:async()=>{await ready;if(stopped)throw Error('SITE_CODE_STOPPED');await handlers.beforeSend();},
    getWindow:()=>handlers?.getWindow(),
    onStatus:value=>handlers?.onStatus(value)
  });
  const timeout=setTimeout(()=>{if(!handlers)control.stop();},15000);
  const control=window.__ticketEarlyEntry={goodsCode,runId,http,
    get available(){return !stopped&&!handlers;},
    adopt(next){if(stopped||handlers)throw Error('SITE_ENTRY_GUARD_UNAVAILABLE');handlers=next;clearTimeout(timeout);next.onStatus({...http.status});adopt();return http;},
    stop(){stopped=true;clearTimeout(timeout);http.stop();adopt();}
  };
})(config);};
