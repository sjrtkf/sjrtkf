'use strict';
const {RunMetrics}=require('./run-metrics');
class RunControl {
  constructor(){this.current=null;this.serial=0;}
  begin(targetId,preferences,kind='auto'){
    if(this.current)throw Error('진행 중인 작업을 중지하고 정리가 끝날 때까지 기다려 주세요.');
    const run={id:++this.serial,kind,entryId:targetId,targetId,windowIds:new Set([targetId]),preferences,controller:new AbortController(),cancelled:false,status:'준비 중',started:Date.now(),timeline:[]};
    run.metrics=new RunMetrics();run.metrics.stage('prepare','준비 중');
    run.signal=run.controller.signal;this.current=run;return run;
  }
  assert(run){if(this.current!==run||run.signal.aborted)throw Error('작업이 중지되었습니다.');}
  cancel(){const run=this.current;if(run){run.cancelled=true;run.status='중지 · 진행 중인 선택 정리 중';run.controller.abort();}return run;}
  adopt(parentId,childId){const run=this.current;if(!run||run.signal.aborted||run.targetId!==parentId)return false;run.windowIds.add(childId);run.targetId=childId;return true;}
  finish(run){if(this.current===run)this.current=null;}
}
function pause(ms,signal){return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('작업이 중지되었습니다.'));
  const onAbort=()=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);reject(Error('작업이 중지되었습니다.'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},ms);signal?.addEventListener('abort',onAbort,{once:true});
});}
module.exports={RunControl,pause};
