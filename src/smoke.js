'use strict';
const assert=require('node:assert/strict');const path=require('node:path');
const entry=require('./entry');const flow=require('./flow');
module.exports=async function({app,win,view,command,js,targets}){
  const checks=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const errors=[];win.webContents.on('console-message',(_e,_level,message)=>{if(/Uncaught|TypeError/.test(message))errors.push(message);});
  await command('preferences',{quantity:2,autoComplete:true});
  await command('demo');let result=await command('scan');assert.equal(result.seats.filter(s=>s.available).length,8);checks.push('SVG 가용석 및 상세 열·번호 연결');
  const chosen=result.seats[0];await command('seat',{key:chosen.key,action:'click'});assert.equal((await js(view.webContents,flow.scene)).selected.length,1);checks.push('실제 사이트와 같은 pointerup 선택 이벤트');
  await assert.rejects(()=>command('seat',{key:chosen.key,action:'click'}));checks.push('만료된 목록의 중복 클릭 차단');
  await command('demo');result=await command('recommend');assert.ok(result.groups.length);assert.equal(result.groups[0].seats[0].row,1);assert.equal(result.groups[0].seats.length,2);checks.push('앞열 우선 2매 연석 추천');
  await command('choose');assert.equal((await js(view.webContents,flow.scene)).selected.length,2);assert.equal(await view.webContents.executeJavaScript('document.body.dataset.completed'),'true');checks.push('연석 선택·사이트 결과 검증·선택 완료 연결');
  await command('demo');
  await view.webContents.executeJavaScript(`(()=>{const seat=document.getElementById('seat_block_demo:1'),original=seat.onpointerup;seat.onpointerup=()=>{original();if(seat.classList.contains('SeatMap_selected__demo')){document.body.setAttribute('aria-busy','true');setTimeout(()=>document.body.removeAttribute('aria-busy'),300);}};const b=document.getElementById('completeDemo'),complete=b.onclick;b.onclick=()=>{document.body.dataset.earlyComplete=String(document.body.getAttribute('aria-busy')==='true');complete();};})()`);
  await command('choose');assert.equal(await view.webContents.executeJavaScript('document.body.dataset.earlyComplete'),'false');checks.push('낙관적 선택 표시 후 처리 중에는 완료 클릭하지 않음');
  await command('demo');
  await view.webContents.executeJavaScript(`(()=>{const seat=document.getElementById('seat_block_demo:1'),original=seat.onpointerup;let rejected=false;seat.onpointerup=()=>{original();if(!rejected){rejected=true;const modal=document.createElement('div');modal.setAttribute('role','alertdialog');modal.textContent='이미 선택된 좌석입니다.';const confirm=document.createElement('button');confirm.textContent='확인';confirm.onclick=()=>modal.remove();modal.append(confirm);document.body.append(modal);}};})()`);
  const recovered=await command('choose');assert.equal(recovered.completed,true);assert.equal((await js(view.webContents,flow.scene)).selected.includes('seat_block_demo:1'),false);checks.push('선점 실패 팝업 처리·부분 선택 해제·다음 후보 완료');
  await command('demo');
  await win.webContents.executeJavaScript(`(async()=>{const enabled=document.getElementById('tier-0-enabled');enabled.checked=true;enabled.dispatchEvent(new Event('change'));document.getElementById('tier-0-minRow').value='3';document.getElementById('tier-0-maxRow').value='3';document.getElementById('tier-0-aisle').value='any';await document.getElementById('choose').onclick();})()`);
  const tierSelection=await js(view.webContents,flow.scene);assert.equal(tierSelection.selected.length,2);assert.ok(tierSelection.selectedNames.every(s=>s.includes('3열')));checks.push('미저장 UI 조건 묶음을 적용하여 3열 연석 선택');
  await command('demo');await command('choose',{preferences:{quantity:2,autoComplete:false}});
  await assert.rejects(()=>command('complete',{preferences:{quantity:2,tiers:[{minRow:3,maxRow:3,aisle:'any'}]}}),/조건/);
  assert.equal((await js(view.webContents,flow.scene)).selected.length,2);
  await command('complete',{preferences:{quantity:2}});assert.equal((await js(view.webContents,flow.scene)).completed,true);checks.push('수동 완료도 현재 열·연석 조건 검증 후 다음 화면 확인');
  await command('preferences',{quantity:2,autoComplete:true});
  assert.equal(await view.webContents.executeJavaScript('typeof window.helper'),'undefined');checks.push('예매 화면의 로컬 권한 분리');
  await view.webContents.loadFile(path.join(app.getAppPath(),'tests/entry-fixture.html'));
  const games=await js(view.webContents,entry.gameCards);assert.equal(games.length,1);assert.match(games[0].schedule,/일반예매/);checks.push('공식 경기 카드·오픈 표기 읽기');
  const openAt=Date.now()+180;await js(view.webContents,entry.armEntry,{key:games[0].key,openAt});await delay(70);assert.equal(await view.webContents.executeJavaScript("document.getElementById('clicks').textContent"),'0');
  await view.webContents.executeJavaScript('document.querySelector("button").disabled=false');await delay(250);assert.equal(await view.webContents.executeJavaScript("document.getElementById('clicks').textContent"),'1');const entryState=await view.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:'window.__bearsEntry.status'}]);assert.ok(entryState.delayMs>=0);checks.push('오픈 전 클릭 없음·정시 단일 클릭·실행 지연 기록');
  await js(view.webContents,entry.armEntry,{key:games[0].key,openAt:Date.now()+150});await view.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:'window.__bearsEntry.stop()'}]);await delay(200);assert.equal(await view.webContents.executeJavaScript("document.getElementById('clicks').textContent"),'1');checks.push('오픈 대기 중지 후 클릭 없음');
  await view.webContents.executeJavaScript("document.querySelector('button').onclick=()=>{location.href='../src/demo.html';};true");
  await command('start',{key:games[0].key,openAt:Date.now()+60});
  let completed=false;for(let i=0;i<35;i++){await delay(100);try{completed=await view.webContents.executeJavaScript("document.body?.dataset.completed==='true'");}catch{}if(completed)break;}assert.equal(completed,true);checks.push('오픈 클릭부터 연석 선택·완료까지 전체 자동 진행');
  await command('stop');
  const wc=view.webContents;const created=new Promise(resolve=>wc.once('did-create-window',resolve));await wc.executeJavaScript("window.open('about:blank');true");const child=await created;const childWc=child.webContents;const childId=childWc.id;assert.ok(targets.has(childId));await new Promise(resolve=>{childWc.once('destroyed',()=>setImmediate(resolve));child.close();});assert.equal(targets.has(childId),false);checks.push('예매 팝업 생성·종료 시 id 오류 회귀 검증');
  await command('home');assert.match(wc.getTitle(),/두산/);assert.ok(await wc.executeJavaScript("document.body.innerText.includes('경기 예매')"));const liveGames=await command('games');assert.ok(liveGames.games.length>=3);assert.ok(liveGames.games.some(g=>g.openAt));checks.push('앱에서 실제 공개 경기 목록과 공식 오픈 시각 읽기');
  const ui=await win.webContents.executeJavaScript("({bridge:typeof window.helper.run,controls:['start','stop','quantity','priority','areas','blocks','tiers','lastRunSummary','runTimeline','entryStrategy','entryResult'].every(id=>!!document.getElementById(id)),tiers:document.querySelectorAll('.tier').length,modes:[...document.getElementById('entryStrategy').options].map(o=>o.value)})");assert.equal(ui.bridge,'function');assert.equal(ui.controls,true);assert.ok(ui.tiers>=3);assert.deepEqual(ui.modes,['site','clock']);checks.push('조건 묶음·진입 방식·작업 기록 UI 및 앱 연결');
  const facts=await win.webContents.executeJavaScript("(()=>{showLastRun({id:'smoke-clock-facts',durationMs:1000,stages:[],entry:{strategy:'clock',trigger:'activation',clockOutcome:'not-ready',requestCount:1,receivedCount:1,failedCount:0,seatPageObserved:true}});return document.getElementById('entryResult').textContent;})()");assert.match(facts,/진입 요청 관찰 1건/);assert.match(facts,/사이트 활성화 감지/);checks.push('클릭 전달과 진입 요청 관찰을 구분한 기록 표시');
  assert.deepEqual(errors,[]);
  try{const image=await win.webContents.capturePage();require('node:fs').writeFileSync(path.join(app.getAppPath(),'work','preview-v0.4.png'),image.toPNG());}catch{}
  try{await win.webContents.executeJavaScript("document.getElementById('tiers').scrollIntoView({block:'start'});true");await delay(50);const image=await win.webContents.capturePage();require('node:fs').writeFileSync(path.join(app.getAppPath(),'work','preview-v0.4-preferences.png'),image.toPNG());}catch{}
  let clockProbe;try{const result=await command('clock');assert.ok(result.clockInfo.uncertaintyMs>=0);assert.ok(['ticket-server','http-date-fallback'].includes(result.clockInfo.source));clockProbe={available:true,...result.clockInfo};}catch(error){clockProbe={available:false,reason:error.message};}
  return {passed:true,checks,clockProbe,timing:{fixtureDispatchDelayMs:Math.round(entryState.delayMs),note:'로컬 재현 테스트의 타이머 지연이며 실제 접속 순위나 네트워크 성능을 의미하지 않습니다.'}};
};
