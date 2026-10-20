'use strict';
const fs=require('node:fs'),path=require('node:path');
const {safeLastRun,safeText}=require('./run-diagnostics');
const {metricName}=require('./run-metrics');
const MAX_BYTES=1024*1024,MAX_FILES=30;
function safeDetail(input={}){
  const out={};
  for(const key of ['action','stage','message','pageStage','kind','result','reason'])if(typeof input[key]==='string')out[key]=safeText(input[key],500);
  for(const key of ['elapsedMs','durationMs','status','count','cycle','planCount','rowCount','availableCount','detailedCount','pooledCount','missingGradeCount','missingRowCount','missingNumberCount','missingMetadataCount','unsupportedRowCount','unsupportedNumberCount','nonExposableCount','groupedCount','duplicateCount','blockCount','gradeCount','conflictCount','selectedCount','candidateCount','rank','invokeDelayMs','requestDelayMs','timerDelayMs'])if(Number.isFinite(input[key])&&input[key]>=0)out[key]=input[key];
  // Signed timing distinguishes early dispatch from lateness against the
  // corrected deadline; never include the signed API request itself.
  if(Number.isFinite(input.requestDeadlineDelayMs))out.requestDeadlineDelayMs=input.requestDeadlineDelayMs;
  if(Array.isArray(input.grades))out.grades=input.grades.slice(0,60).map(g=>({name:safeText(g.name,150),code:safeText(g.code,50),count:Number.isFinite(g.count)&&g.count>=0?g.count:null,eligible:g.eligible===true,reasons:(Array.isArray(g.reasons)?g.reasons:[]).slice(0,8).map(r=>safeText(r,60))}));
  if(Array.isArray(input.seatSamples))out.seatSamples=input.seatSamples.filter(s=>s&&typeof s==='object').slice(0,8).map(s=>{
    const sample={};
    for(const key of ['gradeCode','grade','block','blockName','rowLabel','rawRowLabel','rawSeatNumber'])if(typeof s[key]==='string'||s[key]===null)sample[key]=s[key]===null?null:safeText(s[key],80);
    for(const key of ['rowIdx','colIdx'])if(Number.isSafeInteger(s[key])&&s[key]>=0)sample[key]=s[key];
    for(const key of ['hasMetadata','exposable','grouped','domAvailable'])if(typeof s[key]==='boolean')sample[key]=s[key];
    sample.reasons=(Array.isArray(s.reasons)?s.reasons:[]).filter(r=>typeof r==='string').slice(0,8).map(r=>safeText(r,60));
    return sample;
  });
  if(input.timing){out.timing={};for(const key of ['dnsMs','connectMs','tlsMs','firstByteMs'])if(Number.isFinite(input.timing[key])&&input.timing[key]>=0&&input.timing[key]<=3600000)out.timing[key]=input.timing[key];for(const key of ['connectionReused','timingAvailable'])if(typeof input.timing[key]==='boolean')out.timing[key]=input.timing[key];}
  if(Array.isArray(input.gradeConflicts))out.gradeConflicts=input.gradeConflicts.slice(0,30).map(g=>({code:safeText(g.code,100),names:(Array.isArray(g.names)?g.names:[]).slice(0,8).map(n=>safeText(n,300))}));
  if(input.priceAssessment&&typeof input.priceAssessment==='object'){
    const text=value=>typeof value==='string'||typeof value==='number'&&Number.isFinite(value)?safeText(value,100):null;
    const index=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    out.priceAssessment={groups:(Array.isArray(input.priceAssessment.groups)?input.priceAssessment.groups:[]).filter(g=>g&&typeof g==='object').slice(0,8).map(g=>{
      const all=(Array.isArray(g.options)?g.options:[]).filter(option=>option&&typeof option==='object'),selectedIndex=index(g.selectedIndex),options=all.slice(0,30);
      // Keep the chosen option visible even when an unusually long source list
      // needs sampling. Indices still refer to the original price list.
      const selected=selectedIndex==null?null:all.find(option=>option.index===selectedIndex);
      if(selected&&!options.includes(selected))options[options.length-1]=selected;
      return {seatGrade:text(g.seatGrade),seatCount:index(g.seatCount),selectedIndex,options:options.map(option=>({index:index(option.index),priceGrade:text(option.priceGrade),pgCode:text(option.pgCode),priceGradeName:text(option.priceGradeName),discountName:text(option.discountName),amount:Number.isFinite(option.amount)&&option.amount>=0?option.amount:null,eligible:option.eligible===true,reasons:(Array.isArray(option.reasons)?option.reasons:[]).filter(reason=>typeof reason==='string').slice(0,8).map(reason=>safeText(reason,100))}))};
    })};
  }
  if(input.summary)out.summary=safeLastRun(input.summary);
  if(input.preferences){
    const p=input.preferences;out.preferences={};
    for(const key of ['quantity'])if(Number.isInteger(p[key]))out.preferences[key]=p[key];
    for(const key of ['requireTogether','excludeObstructed','excludeRestricted','fallbackAnywhere','autoComplete','autoNotice','stopAfterCaptcha'])if(typeof p[key]==='boolean')out.preferences[key]=p[key];
    if(typeof p.priority==='string')out.preferences.priority=safeText(p.priority,50);
    for(const key of ['areas','blocks'])if(Array.isArray(p[key]))out.preferences[key]=p[key].slice(0,50).map(v=>safeText(v,100));
    if(Array.isArray(p.tiers))out.preferences.tiers=p.tiers.slice(0,10).map(t=>({areas:(t.areas||[]).slice(0,50).map(v=>safeText(v,100)),blocks:(t.blocks||[]).slice(0,50).map(v=>safeText(v,100)),minRow:Number.isInteger(t.minRow)?t.minRow:null,maxRow:Number.isInteger(t.maxRow)?t.maxRow:null}));
  }
  return out;
}
function createRunLog({directory,version='unknown',io=fs,now=()=>new Date(),onError=()=>{}}){
  let file=null,bytes=0,capped=false,failed=false;
  const report=()=>{failed=true;onError('진단 로그 저장에 실패했습니다. 설정 폴더의 쓰기 권한과 남은 용량을 확인해 주세요.');};
  function event(type,detail={}){
    if(!file||capped)return;
    try{
      let line=JSON.stringify({at:now().toISOString(),event:metricName(type),...safeDetail(detail)})+'\n';
      if(bytes+Buffer.byteLength(line)>MAX_BYTES){line=JSON.stringify({at:now().toISOString(),event:'log-limit',message:'기록 크기 제한에 도달했습니다. 최종 요약은 last-run.json에 저장됩니다.'})+'\n';capped=true;}
      io.appendFileSync(file,line,'utf8');bytes+=Buffer.byteLength(line);
    }catch{report();}
  }
  return {
    start(id){
      file=null;bytes=0;capped=false;failed=false;
      try{
        io.mkdirSync(directory,{recursive:true});
        const stamp=now().toISOString().replace(/[:.]/g,'-');
        file=path.join(directory,`run-${stamp}-${id}.jsonl`);
        // Only this logger's bounded, regular files can be rotated.
        const files=io.readdirSync(directory).filter(n=>/^run-\d{4}-\d{2}-\d{2}T[\dTZ-]+-\d+\.jsonl$/.test(n)).sort();
        for(const name of files.slice(0,Math.max(0,files.length-MAX_FILES+1))){const target=path.join(directory,name);if(io.lstatSync(target).isFile())io.unlinkSync(target);}
        event('run-start',{message:'앱 '+safeText(version,30),count:id});
      }catch{file=null;report();}
    },
    event,
    diagnostic(type,detail){
      // Errors before a booking run need a file too. A separate writer keeps
      // the active run's destination and byte limit intact.
      const standalone=createRunLog({directory,version,io,now,onError});
      standalone.start(0);standalone.event(type,detail);
      if(standalone.failed)failed=true;
    },
    finish(summary){event('run-finish',{summary});file=null;},
    get failed(){return failed;},
    directory
  };
}
module.exports={createRunLog,safeDetail,MAX_BYTES,MAX_FILES};
