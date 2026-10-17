'use strict';
// Static MAIN-world dispatcher. Chrome supplies a pinned native document ID;
// the desktop connection lease and stop epoch are checked again inside it.
function codeRuntime(action,arg,meta,invokeSiteFunction,makeActions){
  const u=new URL(location.href);
  const allowed=u.origin==='https://nol.yanolja.com'&&/^\/ticket(?:\/|$)/.test(u.pathname)||u.origin==='https://tickets.interpark.com'&&/^\/(?:gates\/ticket\/\d{8}\/?$|goods\/\d+\/?$|onestop(?:\/|$)|waiting(?:\/|$))/.test(u.pathname)||u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname);
  if(!allowed||!meta||typeof meta.connection!=='string'||!Number.isInteger(meta.epoch))throw Error('SITE_CODE_SCOPE_INVALID');
  const cancel=action==='stop'||action==='page.stopWatchers';
  if(!cancel&&(!Number.isFinite(meta.expiresAt)||Date.now()>meta.expiresAt))throw Error('SITE_CODE_EXPIRED');
  const stop=()=>{window.__bearsEntry?.stop();window.__bearsGate?.stop();window.__bearsCaptchaPage?.cancel();window.__ticketManualCaptchaPage?.cancel();};
  let control=window.__ticketSiteCode;
  if(!control||control.connection!==meta.connection){
    if(control&&action!=='lease'&&!cancel)throw Error('SITE_CODE_CONNECTION_CHANGED');
    stop();if(control?.timer)clearInterval(control.timer);
    control=window.__ticketSiteCode={connection:meta.connection,epoch:meta.epoch,leaseUntil:0,stopped:true,error:null,calls:0};
    control.timer=setInterval(()=>{if(!control.stopped&&Date.now()>control.leaseUntil){control.stopped=true;stop();}},250);
  }
  if(meta.epoch<control.epoch)throw Error('SITE_CODE_STOPPED');
  if(meta.epoch>control.epoch){stop();control.epoch=meta.epoch;control.error=null;control.stopped=true;}
  if(cancel){control.stopped=true;control.leaseUntil=0;control.error=null;stop();return {stopped:true};}
  if(action==='lease'){control.leaseUntil=Math.min(meta.expiresAt,Date.now()+5000);return {ready:true};}
  if(control.error)throw Error(control.error);
  // A fresh extension command grants a short lease; autonomous callbacks only
  // use this stored deadline and cannot renew it themselves.
  control.leaseUntil=Math.min(meta.expiresAt,Date.now()+5000);
  control.stopped=false;
  const assert=()=>{if(window.__ticketSiteCode!==control||control.connection!==meta.connection||control.epoch!==meta.epoch||control.stopped||Date.now()>control.leaseUntil)throw Error('SITE_CODE_STOPPED');};
  const fail=error=>{if(window.__ticketSiteCode!==control||control.connection!==meta.connection||control.epoch!==meta.epoch)return;control.error=/^SITE_[A-Z_]+$/.test(error?.message||'')?error.message:'SITE_FUNCTION_FAILED';control.stopped=true;stop();};
  const siteInvoke=(element,kind,value)=>{
    assert();control.calls++;
    try{const result=invokeSiteFunction(element,kind,value);if(result&&typeof result.then==='function')result.catch(fail);return result;}
    catch(error){fail(error);throw error;}
  };
  const actions=makeActions(siteInvoke);
  if(!Object.hasOwn(actions,action))throw Error('SITE_CODE_ACTION_UNSUPPORTED');
  assert();return actions[action](arg??undefined);
}
module.exports={codeRuntime};
