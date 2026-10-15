'use strict';
const SERVER_TIME_URL='https://api-ticketfront.interpark.com/v1/getServerTime?type=1';
const GATE_CLOCK_LIMITS=Object.freeze({maxAgeMs:60000,maxRttMs:1000,maxUncertaintyMs:501});
function parseOpening(text,now=Date.now()) {
  const match=String(text||'').match(/일반예매\s*(\d{1,2})\.(\d{1,2})(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/);
  if(!match)return null;
  const kst=new Date(now+9*3600000),year=kst.getUTCFullYear();
  const [,month,day,hour,minute]=match.map(Number);
  if(month<1||month>12||day<1||day>31||hour>23||minute>59)return null;
  let result=Date.UTC(year,month-1,day,hour-9,minute);
  if(result<now-180*86400000)result=Date.UTC(year+1,month-1,day,hour-9,minute);
  if(result>now+180*86400000)result=Date.UTC(year-1,month-1,day,hour-9,minute);
  const check=new Date(result+9*3600000);if(check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null;
  return result;
}
function clockSample({date,age,cache,start,end}) {
  const timestamp=Date.parse(date),rtt=end-start;
  if(!Number.isFinite(timestamp)||!Number.isFinite(rtt)||rtt<0||rtt>4000||Number(age||0)>0||/hit/i.test(cache||''))return null;
  return {offsetMs:timestamp+500-(start+end)/2,uncertaintyMs:500+rtt/2,rttMs:rtt,measuredAt:end,source:'http-date-fallback'};
}
function serverClockSample({body,age,cache,start,end,monoStart,monoEnd}) {
  const anchored=monoStart!==undefined||monoEnd!==undefined;
  if(anchored&&(!Number.isFinite(monoStart)||!Number.isFinite(monoEnd)||monoStart<0||monoEnd<monoStart))return null;
  const text=String(body??'').trim(),rtt=anchored?monoEnd-monoStart:end-start;
  // The public gate reads plain epoch milliseconds, not HTTP Date seconds.
  if(!/^\d{13}$/.test(text)||!Number.isFinite(start)||!Number.isFinite(end)||rtt<0||rtt>4000||Number(age||0)>0||/hit/i.test(cache||''))return null;
  const timestamp=Number(text);
  if(!Number.isSafeInteger(timestamp)||timestamp<Date.UTC(2020,0,1)||timestamp>Date.UTC(2100,0,1))return null;
  const result={offsetMs:timestamp-(start+end)/2,uncertaintyMs:1+rtt/2,rttMs:rtt,measuredAt:end,source:'ticket-server',serverTimeMs:timestamp};
  // Carry an epoch estimate tied to this process's monotonic clock. Date.now()
  // remains useful for display, but must not drive a scheduled gate trigger.
  if(anchored)Object.assign(result,{anchorMonoMs:monoEnd,serverEpochAtAnchorMs:timestamp+rtt/2});
  return result;
}
function clockForGate(sample,{monoNow=performance.now()}={}) {
  if(!sample||sample.source!=='ticket-server')return null;
  const {anchorMonoMs,serverEpochAtAnchorMs,rttMs,uncertaintyMs}=sample;
  if(![monoNow,anchorMonoMs,serverEpochAtAnchorMs,rttMs,uncertaintyMs].every(Number.isFinite))return null;
  if(anchorMonoMs<0||rttMs<0||rttMs>GATE_CLOCK_LIMITS.maxRttMs||uncertaintyMs<1+rttMs/2||uncertaintyMs>GATE_CLOCK_LIMITS.maxUncertaintyMs)return null;
  if(serverEpochAtAnchorMs<Date.UTC(2020,0,1)||serverEpochAtAnchorMs>Date.UTC(2100,0,1))return null;
  const ageMs=monoNow-anchorMonoMs;
  if(ageMs<0||ageMs>GATE_CLOCK_LIMITS.maxAgeMs)return null;
  return {serverNowMs:serverEpochAtAnchorMs+ageMs,ageMs,uncertaintyMs,rttMs,source:'ticket-server',validForMs:GATE_CLOCK_LIMITS.maxAgeMs-ageMs};
}
function bestClock(samples){const valid=samples.filter(Boolean).sort((a,b)=>a.rttMs-b.rttMs);if(!valid.length)throw new Error('캐시되지 않은 서버 시각을 확인하지 못했습니다. PC 시각으로 대기할 수 있습니다.');return valid[0];}
module.exports={parseOpening,clockSample,serverClockSample,bestClock,clockForGate,SERVER_TIME_URL,GATE_CLOCK_LIMITS};
