'use strict';
const {metricName,metricText,MAX_PHASES,MAX_OPERATIONS}=require('./run-metrics');
// Persist only an allowlisted summary, never URLs, transport records, bodies,
// cookies, tokens, or arbitrary properties received from the browser.
function safeText(value,limit=500){
  return String(value??'').replace(/(?:https?|chrome-extension):\/\/[^\s<>"']+/gi,'[주소 생략]')
    .replace(/\b(?:authorization|cookie|bearer)\b[^\r\n]*/gi,'[인증 정보 생략]')
    .replace(/\b(?:token|sessionId|signature|secret|secureData|passCode|captcha|securityCode|password)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'[인증 값 생략]')
    .replace(/[A-Za-z0-9_+/=-]{40,}/g,'[긴 식별자 생략]').slice(0,limit);
}
function nonnegative(value){return Number.isFinite(value)&&value>=0;}
function safeMetrics(input){
  if(!input||typeof input!=='object'||!nonnegative(input.elapsedMs))return null;
  const phases=(Array.isArray(input.phases)?input.phases:[]).slice(-MAX_PHASES)
    .filter(phase=>phase&&nonnegative(phase.durationMs))
    .map(phase=>({code:metricName(phase.code,'unknown'),label:metricText(phase.label),durationMs:phase.durationMs}));
  const operations=[];const seen=new Set();
  for(const item of (Array.isArray(input.operations)?input.operations:[]).slice(0,MAX_OPERATIONS)){
    if(!item||!Number.isSafeInteger(item.count)||item.count<0||!Number.isSafeInteger(item.failed)||item.failed<0||item.failed>item.count||!['totalMs','maxMs','lastMs'].every(key=>nonnegative(item[key])))continue;
    const action=metricName(item.action);if(seen.has(action))continue;seen.add(action);
    operations.push({action,count:item.count,failed:item.failed,totalMs:item.totalMs,maxMs:item.maxMs,lastMs:item.lastMs});
  }
  return {elapsedMs:input.elapsedMs,phases,operations,pendingCount:Number.isSafeInteger(input.pendingCount)&&input.pendingCount>=0?input.pendingCount:0};
}
function safeDiagnosis(input){
  if(!input||typeof input!=='object')return null;
  const code=metricName(input.code,'unknown'),title=metricText(input.title,150);
  if(!title)return null;
  return {code,title,detail:metricText(input.detail,500),nextAction:metricText(input.nextAction,500),level:['info','success','warning','error'].includes(input.level)?input.level:'info'};
}
function safeStage(input){
  const stage={stage:safeText(input.stage,250),elapsedMs:input.elapsedMs};
  if(typeof input.code==='string')stage.code=metricName(input.code,'unknown');
  if(nonnegative(input.durationMs))stage.durationMs=input.durationMs;
  return stage;
}
function safeLastRun(input){
  if(!input||typeof input!=='object'||!Number.isSafeInteger(input.id)||input.id<1||!Number.isFinite(input.durationMs)||input.durationMs<0)return null;
  const result={id:input.id,durationMs:input.durationMs,message:safeText(input.message),stopReason:input.stopReason?safeText(input.stopReason):null,failureDetail:input.failureDetail?safeText(input.failureDetail):null,
    stages:(Array.isArray(input.stages)?input.stages:[]).slice(-80).filter(s=>s&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0).map(safeStage),entry:{}};
  for(const key of ['strategy','trigger','clockOutcome','clockReason','httpOutcome','httpCode','queueState'])if(typeof input.entry?.[key]==='string')result.entry[key]=safeText(input.entry[key],250);
  for(const key of ['offsetMs','requestCount','receivedCount','failedCount','lastRequestDurationMs','clockUncertaintyMs','queueRank'])if(Number.isFinite(input.entry?.[key]))result.entry[key]=input.entry[key];
  for(const key of ['seatPageObserved','observerLost','preparationConfirmed'])if(typeof input.entry?.[key]==='boolean')result.entry[key]=input.entry[key];
  if(input.retry){result.retry={};for(const key of ['cycle','attempted'])if(Number.isSafeInteger(input.retry[key])&&input.retry[key]>=0)result.retry[key]=input.retry[key];result.retry.lastReason=safeText(input.retry.lastReason,250);}
  const metrics=safeMetrics(input.metrics);if(metrics)result.metrics=metrics;
  const diagnosis=safeDiagnosis(input.diagnosis);if(diagnosis)result.diagnosis=diagnosis;
  return result;
}
module.exports={safeLastRun,safeMetrics,safeDiagnosis,safeText};
