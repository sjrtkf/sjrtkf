'use strict';
const {pause}=require('./run-control');

// This pacing applies only after a whole seat-search round is exhausted. Entry
// activation and the first pass through available candidates never wait here.
class SeatRetry {
  constructor(){this.cycle=1;this.attempted=0;this.idleRounds=0;this.nextAt=null;this.lastReason='';this.maps=new Map();}
  observe(key,rows){
    const signature=JSON.stringify(rows.filter(s=>s.kind==='seat').map(s=>[s.id,s.available,s.grade,s.block,s.row,s.number]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    const changed=this.maps.has(key)&&this.maps.get(key)!==signature;
    this.maps.set(key,signature);if(changed)this.idleRounds=0;return changed;
  }
  snapshot(){return {cycle:this.cycle,attempted:this.attempted,nextAt:this.nextAt,lastReason:this.lastReason};}
  async next({signal,reason,onStatus=()=>{},wait=pause,now=Date.now,minimumMs=0}={}){
    if(signal?.aborted)throw Error('작업이 중지되었습니다.');
    const delay=Math.max(Math.min(5000,Math.max(0,minimumMs)),Math.min(500*2**Math.min(this.idleRounds,4),5000));
    this.lastReason=reason;this.nextAt=now()+delay;
    onStatus(`${reason} · ${(delay/1000).toFixed(1)}초 후 ${this.cycle+1}차 확인 · 확보 또는 중지까지 반복`);
    try{await wait(delay,signal);if(signal?.aborted)throw Error('작업이 중지되었습니다.');}
    finally{this.nextAt=null;}
    this.idleRounds++;this.cycle++;
  }
}
module.exports={SeatRetry};
