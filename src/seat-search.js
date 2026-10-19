'use strict';

const jobKey=job=>JSON.stringify([job.tierIndex,job.name]);
function nextJob(plan,{triedJobs,metadataCooldown,jobVisits},now){
  const eligible=plan.filter(job=>{const key=jobKey(job),until=metadataCooldown?.get(key);return (until??0)<=now&&(!triedJobs.has(key)||until!=null);});
  // A slow overview transition must not promote the same expired metadata job
  // ahead of a grade that has never been inspected in this round.
  // An explicit data-change wakeup is stronger evidence than a timer expiry:
  // inspect it before a lower-priority fresh grade, while retaining fairness
  // among fresh grades at the same tier.
  const fresh=eligible.filter(job=>!jobVisits?.has(jobKey(job))),woken=eligible.filter(job=>metadataCooldown?.get(jobKey(job))===0);
  const preferredTier=Math.min(...fresh.map(job=>job.tierIndex),...woken.map(job=>job.tierIndex));
  const preferred=fresh.find(job=>job.tierIndex===preferredTier);if(preferred)return preferred;
  const retries=Number.isFinite(preferredTier)?eligible.filter(job=>job.tierIndex===preferredTier):eligible;
  return retries.sort((a,b)=>(jobVisits?.get(jobKey(a))??0)-(jobVisits?.get(jobKey(b))??0))[0];
}
function rememberMap(run,rows){
  run.seatMaps??=new Map();
  const key=run.currentJob?.name||'current-map',seats=rows.filter(row=>row.kind==='seat');
  const ids=new Set(seats.map(row=>row.id));
  // Overlapping maps keep the latest observation for a seat. A grade map can
  // hide another grade in the same block, so absence there is not availability
  // evidence; every pooled seat is checked by fresh HTTP status before a hold.
  for(const [name,old] of run.seatMaps)if(name!==key)run.seatMaps.set(name,old.filter(row=>!ids.has(row.id)));
  run.seatMaps.set(key,seats.map(row=>({...row})));
  return pooledSeats(run);
}
function pooledSeats(run){
  const seats=new Map();
  for(const rows of run.seatMaps?.values()||[])for(const row of rows)if(!run.excludedIds.has(row.id))seats.set(row.id,row);
  return [...seats.values()];
}
function forgetSeats(run,ids){
  const rejected=new Set(ids);
  for(const [name,rows] of run.seatMaps||[])run.seatMaps.set(name,rows.filter(row=>!rejected.has(row.id)));
}
function resetSearch(run){run.jobVisits=new Map();run.seatMaps=new Map();run.metadataCooldown?.clear();}
module.exports={jobKey,nextJob,rememberMap,pooledSeats,forgetSeats,resetSearch};
