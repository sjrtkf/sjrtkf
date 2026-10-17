globalThis.BaseballHttpNavigate=async function httpBookingNavigate({runId,expected,expiresAt,syncOnly=false,checkOnly=false}={}){
  if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat'||!Number.isFinite(expiresAt)||Date.now()>expiresAt)throw Error('HTTP_NAVIGATION_EXPIRED');
  const key='baseball/http-booking',r=JSON.parse(sessionStorage.getItem(key)||'null'),c=JSON.parse(sessionStorage.getItem('interpark/context')||'{}');
  if([c.goods?.goodsCode,c.goods?.placeCode,c.playSeq?.playSeq].join(':')!==[expected?.goodsCode,expected?.placeCode,expected?.playSeq].join(':'))throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  if(checkOnly){
    let runtime;
    if(typeof window.next?.router?.push!=='function'||!Array.isArray(window.webpackChunk_N_E))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
    window.webpackChunk_N_E.push([['baseball-http-check-'+runId],{},require=>{runtime=require;}]);
    const storage=runtime?.(74133)?.F,cache=runtime?.(25019)?.d;
    if(typeof storage?.getContextData!=='function'||JSON.stringify(storage.getContextData())!==JSON.stringify(c)||typeof cache?.mutate!=='function'||typeof cache?.cache?.keys!=='function'||![...cache.cache.keys()].some(k=>typeof k==='string'&&k.startsWith('/getContextData/')))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
    return {supported:true};
  }
  if(!r||r.runId!==runId||(syncOnly?r.stage!=='selected':r.stage!=='ready'||!r.confirmed||!r.validated)||r.cancelled||Date.now()-r.at>15000||r.identity!==[expected?.goodsCode,expected?.placeCode,expected?.playSeq].join(':')||r.identity!==[c.goods?.goodsCode,c.goods?.placeCode,c.playSeq?.playSeq].join(':'))throw Error('HTTP_NAVIGATION_NOT_CONFIRMED');
  if(r.contextSignature!==JSON.stringify([c.goods,c.playSeq,c.sessionId,c.channelType,c.bizCode,c.seats||[],c.prices||[]]))throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  if(!syncOnly&&!['/payment','/preorder'].includes(r.route)||c.sessionId!==r.sessionId||JSON.stringify(c.seats)!==r.seatsSignature||!syncOnly&&JSON.stringify(c.prices)!==r.pricesSignature||!Array.isArray(c.seats)||JSON.stringify(c.seats.map(v=>v.seatInfoId))!==JSON.stringify(r.held)||!syncOnly&&c.prices?.reduce((n,v)=>n+v.selectedSeatCount,0)!==r.held.length)throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  if(typeof window.next?.router?.push!=='function')throw Error('HTTP_ROUTER_UNAVAILABLE');
  // The native context hook uses SWR. Storage alone leaves a mounted route's
  // cached seats/prices stale. Use the inspected client's local cache updater;
  // no control events or price/seat requests are dispatched by this sync.
  let runtime;
  if(!Array.isArray(window.webpackChunk_N_E))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
  window.webpackChunk_N_E.push([['baseball-http-context-'+runId],{},require=>{runtime=require;}]);
  const storage=runtime?.(74133)?.F,cache=runtime?.(25019)?.d;
  if(typeof storage?.getContextData!=='function'||typeof cache?.mutate!=='function'||typeof cache?.cache?.keys!=='function'||JSON.stringify(storage.getContextData())!==JSON.stringify(c))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
  if(!syncOnly)r.stage='navigating';sessionStorage.setItem(key,JSON.stringify(r));
  const keys=[...cache.cache.keys()].filter(k=>typeof k==='string'&&k.startsWith('/getContextData/'));
  if(!keys.length)throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
  for(const k of keys)await cache.mutate(k,c,{revalidate:false});
  if(JSON.stringify(storage.getContextData())!==JSON.stringify(c)||keys.some(k=>JSON.stringify(cache.cache.get(k)?.data)!==JSON.stringify(c)))throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  const latest=JSON.parse(sessionStorage.getItem(key)||'null');
  if(latest?.runId!==runId||latest.cancelled||Date.now()>expiresAt)throw Error('HTTP_NAVIGATION_EXPIRED');
  for(const k of ['interpark/bsRef',syncOnly?'interpark/preReserveExpireTime':'interpark/reserveExpireTime']){const expiry=Number(sessionStorage.getItem(k));if(expiry>0&&Date.now()>=expiry)throw Error('HTTP_SESSION_EXPIRED');}
  if(syncOnly)return {synchronized:true};
  const moved=await window.next.router.push(r.route);if(!moved)throw Error('HTTP_NAVIGATION_NOT_CONFIRMED');return {dispatched:true};
};
