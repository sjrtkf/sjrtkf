'use strict';
// Pure allowlisted projections. Never export URLs, keys, session IDs or bodies.
function queueRequest(request){
  try{
    const u=new URL(request.url);
    if(u.origin!=='https://ent-waiting-api.interpark.com'||u.username||u.password)return null;
    if(request.method==='POST'&&u.pathname==='/waiting/api/line-up')return 'line-up';
    if(request.method==='GET'&&u.pathname==='/waiting/api/rank')return 'rank';
    if(request.method==='POST'&&u.pathname==='/waiting/api/refresh-url')return 'refresh-url';
  }catch{}
  return null;
}
function queueResponse(kind,status,body){
  if(status===429)return {outcome:'blocked',code:'RATE_LIMITED'};
  let data;try{data=JSON.parse(body);}catch{return {outcome:'unconfirmed'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {outcome:'unconfirmed'};
  if(data.error||status!==200)return {outcome:'unconfirmed',code:typeof data.error==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(data.error)?data.error:'QUEUE_RESPONSE_ERROR'};
  if(kind==='line-up'){
    if(data.exist===true)return {outcome:'existing-queue'};
    if(typeof data.waitingId==='string'&&data.waitingId.length>0)return {outcome:'registered'};
  }
  if(kind==='rank'&&Number.isSafeInteger(data.myRank)&&data.myRank>=0){
    return {outcome:'rank-confirmed',rank:data.myRank};
  }
  return {outcome:'unconfirmed'};
}
function networkTiming(response){
  const out={timingAvailable:false};
  if(typeof response?.connectionReused==='boolean')out.connectionReused=response.connectionReused;
  const t=response?.timing;if(!t||typeof t!=='object')return out;
  const duration=(name,a,b)=>{if(Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>=a&&b-a<=3600000)out[name]=b-a;};
  duration('dnsMs',t.dnsStart,t.dnsEnd);
  duration('connectMs',t.connectStart,t.connectEnd);
  duration('tlsMs',t.sslStart,t.sslEnd);
  duration('firstByteMs',t.sendEnd,t.receiveHeadersStart);
  out.timingAvailable=['dnsMs','connectMs','tlsMs','firstByteMs'].some(k=>k in out);
  return out;
}
module.exports={queueRequest,queueResponse,networkTiming};
