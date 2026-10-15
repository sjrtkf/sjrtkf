'use strict';
function createRunRegistry(){
  let sequence=0,active=null,armedId=null;
  return {
    create(rootWindowId){armedId=null;active={runId:`run-${++sequence}`,rootWindowId};return active;},
    arm(){if(!active)throw new Error('NO_MEASUREMENT_WINDOW');armedId=active.runId;return active;},
    observe(){armedId=null;},
    close(run){if(active?.runId===run.runId){active=null;armedId=null;}},
    consume(run){if(armedId!==run.runId)return false;armedId=null;return true;},
    get active(){return active;}
  };
}
const isSeat=url=>{try{const u=new URL(url);return u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat';}catch{return false;}};
const isEntryRoute=url=>{try{const u=new URL(url);return u.origin==='https://tickets.interpark.com'&&(/^\/gates\/ticket\/\d{8}$/.test(u.pathname)||/^\/waiting(?:\/|$)/.test(u.pathname));}catch{return false;}};
// Records the first URL arrival only. Document reload/paint is a different
// metric and must never be attributed to an earlier SPA booking request.
function createNavigationAttribution({now=()=>performance.now(),maxAgeMs=120000,isSeatUrl=isSeat,isEntryUrl=isEntryRoute}={}){
  let pending=null,currentUrl='',ambiguous=false;
  const clear=()=>{pending=null;};
  const valid=()=>{if(pending&&now()-pending.start>maxAgeMs)clear();return pending;};
  return {
    begin(id,start,url){
      currentUrl=url;
      // Two requests before arrival cannot be disambiguated from URL alone.
      if(valid()){clear();ambiguous=true;return;}
      pending=!ambiguous&&isEntryUrl(url)?{id,start,row:null,arrival:null}:null;
    },
    response(id,row){const p=valid();if(!p||p.id!==id)return false;if(row.status!==200||row.outcome!=='응답 수신'){clear();return false;}p.row=row;if(p.arrival!=null){row.seatNavigationMs=p.arrival;clear();return true;}return false;},
    starting(url,{inPlace=false}={}){
      const p=valid();if(!p)return;
      // A reload or unrelated page ends the measurement, even if a delayed
      // did-finish-load later reports the seat URL.
      if((!inPlace&&isSeatUrl(currentUrl))||!isSeatUrl(url)&&!isEntryUrl(url))clear();
    },
    arrived(url){
      const p=valid(),wasSeat=isSeatUrl(currentUrl);currentUrl=url;
      if(ambiguous){ambiguous=false;clear();return false;}
      if(!p)return false;
      if(isSeatUrl(url)&&!wasSeat){p.arrival=Math.round((now()-p.start)*10)/10;if(p.row){p.row.seatNavigationMs=p.arrival;clear();return true;}}
      else if(!isEntryUrl(url)||wasSeat)clear();
      return false;
    },
    clear
  };
}
module.exports={createRunRegistry,createNavigationAttribution};
