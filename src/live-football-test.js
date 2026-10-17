'use strict';
// Explicit, one-shot CLI test requested by the user. Not enabled at normal app
// startup. Stops at the price page; CAPTCHA remains manual and payment is absent.
module.exports=function liveFootballTest({bridge,targets,command,runs,dataRoot,state}){
  const version=require('../package.json').version;
  const fs=require('node:fs'),path=require('node:path');
  const file=path.join(dataRoot,'live-football-test.json');
  const start=Date.now();let launched=false,busy=false,finished=false;
  const write=value=>{fs.mkdirSync(dataRoot,{recursive:true});fs.writeFileSync(file,JSON.stringify({version,test:'수원삼성–화성FC 2026-10-18 14:00',quantity:1,selectionMethod:'api',...value,updatedAt:new Date().toISOString()},null,2));};
  write({phase:'waiting-connection'});state('축구 API 시험 준비 · 새 확장 연결 후 1매 진행, 보안문자는 직접 입력, 가격/할인 화면에서 정지');
  const timer=setInterval(async()=>{
    if(finished||busy)return;
    if(Date.now()-start>10*60*1000){finished=true;clearInterval(timer);if(launched)await command('stop');write({phase:'expired',message:'10분 시험 시간 만료'});return;}
    if(launched){write({phase:'running',stage:runs.current?.status||'결과 확인 중'});return;}
    const status=bridge.getState();if(!status.connected||status.extensionVersion!==version){write({phase:'waiting-connection',connected:!!status.connected,extensionVersion:status.extensionVersion||null});return;}
    const all=[...targets.values()];
    const seats=all.filter(t=>/^https:\/\/tickets\.interpark\.com\/onestop\/seat(?:[?#]|$)/.test(t.getURL())&&t.getTitle()==='수원삼성 vs 화성FC (10.18)');
    const tabs=seats.length?seats:all.filter(t=>t.getURL()==='https://nol.yanolja.com/ticket/genre/sports/bluewings');
    if(tabs.length!==1){write({phase:'waiting-listing',message:'수원삼성 경기 목록 또는 해당 축구 좌석 탭 한 개가 필요합니다.'});return;}
    busy=true;
    try{
      await command('target',tabs[0].id);
      let gameKey;
      if(seats.length){
        const directApi=require('./direct-seat-api');
        const identity=await tabs[0].invoke(directApi.bookingIdentity);
        directApi.assertIdentity({goodsCode:'26009123',placeCode:'25001730',playSeq:'001',playDate:'20261018'},identity);
      }else{
        const result=await command('games');
        const games=result.games.filter(g=>g.key.includes('10월 18일')&&g.key.includes('14:00')&&g.key.includes('수원삼성 vs 화성FC'));
        if(games.length!==1)throw Error('정해진 축구 경기 카드가 확인되지 않습니다.');
        gameKey=games[0].key;
      }
      launched=true;
      await command('start',{key:gameKey,preferences:{quantity:1,requireTogether:false,areas:[],blocks:[],tiers:[],priority:'front',excludeRestricted:true,excludeObstructed:true,autoNotice:true,autoComplete:true,manualCaptchaAssist:true,autoCaptcha:false,selectionMethod:'api'}});
      const run=runs.current;if(!run?.task)throw Error('실행 상태를 확인하지 못했습니다.');
      const detach=()=>Promise.allSettled([...run.windowIds].map(tabId=>bridge.request({action:'network.detach',tabId})));
      run.task.then(async result=>{finished=true;clearInterval(timer);write({phase:result.completed?'price-confirmed':'stopped',message:result.message});await detach();},async error=>{finished=true;clearInterval(timer);write({phase:'stopped',message:error.message});await detach();});
    }catch(error){finished=true;clearInterval(timer);write({phase:'stopped',message:error.message});state('축구 API 시험 중지 · '+error.message);}
    finally{busy=false;}
  },1000);
  timer.unref();
};
