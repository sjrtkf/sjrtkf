'use strict';
const {performance}=require('node:perf_hooks');

const MAX_PHASES=100,MAX_OPERATIONS=20;
// Only static names belong here. Never pass page data, URLs or request values.
function metricName(value,fallback='other'){
  return typeof value==='string'&&/^[a-z][a-z0-9_-]{0,39}$/.test(value)&&!/(?:token|session|signature|secret|cookie|bearer|authorization)/i.test(value)?value:fallback;
}
function metricText(value,limit=250){
  if(typeof value!=='string')return '';
  return value.replace(/(?:https?|chrome-extension):\/\/[^\s<>"']+/gi,'[주소 생략]')
    .replace(/\b(?:authorization|cookie|bearer)\b[^\r\n]*/gi,'[인증 정보 생략]')
    .replace(/\b(?:token|sessionId|signature|secret)\s*[:=]\s*[^\s,;]+/gi,'[인증 값 생략]')
    .replace(/[A-Za-z0-9_+/=-]{40,}/g,'[긴 식별자 생략]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,limit);
}

class RunMetrics{
  constructor({now=()=>performance.now()}={}){
    this.now=typeof now==='function'?now:()=>performance.now();this.lastNow=0;
    this.started=this._time();this.phases=[];this.operations=new Map();this.pendingCount=0;
  }
  _time(){
    // Measurement must never break the work being observed. A bad injected
    // clock is held at its last value, just as a backward reading is clamped.
    let value;try{value=this.now();}catch{return this.lastNow;}
    if(Number.isFinite(value)&&value>=this.lastNow)this.lastNow=value;
    return this.lastNow;
  }
  stage(code,label){
    const safeCode=metricName(code,'unknown'),safeLabel=metricText(label);
    const current=this.phases.at(-1);
    if(current?.code===safeCode&&current?.label===safeLabel)return;
    const at=this._time();if(current)current.end=at;
    this.phases.push({code:safeCode,label:safeLabel,start:at,end:null});
    if(this.phases.length>MAX_PHASES)this.phases.splice(0,this.phases.length-MAX_PHASES);
  }
  _operation(action){
    let name=metricName(action);
    // Reserve one slot for the aggregate bucket, including invalid names.
    const namedCount=this.operations.size-(this.operations.has('other')?1:0);
    if(name!=='other'&&!this.operations.has(name)&&namedCount>=MAX_OPERATIONS-1)name='other';
    if(!this.operations.has(name))this.operations.set(name,{action:name,count:0,failed:0,totalMs:0,maxMs:0,lastMs:0});
    return this.operations.get(name);
  }
  async measure(action,fn){
    const operation=this._operation(action),start=this._time();this.pendingCount++;
    let failed=false;
    try{return await fn();}catch(error){failed=true;throw error;}
    finally{
      const durationMs=this._time()-start;this.pendingCount--;
      operation.count++;if(failed)operation.failed++;
      operation.totalMs+=durationMs;operation.maxMs=Math.max(operation.maxMs,durationMs);operation.lastMs=durationMs;
    }
  }
  snapshot(){
    const now=this._time();
    return {elapsedMs:now-this.started,phases:this.phases.map(({code,label,start,end})=>({code,label,durationMs:(end??now)-start})),
      operations:[...this.operations.values()].map(operation=>({...operation})),pendingCount:this.pendingCount};
  }
}
module.exports={RunMetrics,metricName,metricText,MAX_PHASES,MAX_OPERATIONS};
