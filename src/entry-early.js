'use strict';
// Installed in the selected tab before navigation, using only bundled code.
// Hold the site's mount-time fetch until the normal gate controller adopts it.
function installEarlyEntry({goodsCode,runId}={}){
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
}
module.exports={installEarlyEntry};
