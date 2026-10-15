'use strict';

// The desktop panel is exercised with fixture connection state only. This test
// never opens Chrome, requests a ticket page, or attaches a browser debugger.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizePreferences}=require('./preferences');
const versionTag='v'+require('../package.json').version.replace(/\.0$/,'');

module.exports=async function panelSmoke({app,win,bridge,command}){
  const output=path.join(app.getAppPath(),'work');
  const report={passed:false,scope:'Local Electron settings panel with fixture Chrome state; no real Chrome or ticket requests.',checks:[],chromeRequests:0};
  const errors=[];
  const originalRequest=bridge.request.bind(bridge);
  bridge.request=async()=>{report.chromeRequests++;throw Error('This local panel test must not send Chrome commands.');};
  win.webContents.on('console-message',(_event,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
  const evaluate=code=>win.webContents.executeJavaScript(code);
  const check=(name,body)=>{body();report.checks.push(name);};
  const read=()=>evaluate(`({
    title:document.title,text:document.body.textContent,
    disabled:Object.fromEntries(['home','testBears','demo','target','games','game','openAt','entryStrategy','entryOffsetMs','start','preflight','readAreas','recommend','choose','complete','scan','minus','reset','plus','focus','code','submitCode','save','quantity','clock','stop','captchaRead','captchaSubmit','captchaStop','captchaTarget','autoCaptcha','manualCaptchaAssist','manualCaptchaPrepare','manualCaptchaSubmit','manualCaptchaText','manualCaptchaFocus'].map(id=>[id,document.getElementById(id).disabled])),
    badge:document.getElementById('browserBadge').textContent,helpOpen:document.getElementById('connectionHelp').open,
    clock:document.getElementById('clockInfo').textContent,clockHint:document.getElementById('clockHint').textContent,
    official:document.getElementById('official').textContent,url:document.getElementById('pageUrl').value,
    mainCount:document.querySelectorAll('main,webview,iframe').length,
    horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    tiers:document.querySelectorAll('.tier').length,pairing:document.getElementById('pairingCode').value,
    quickStopHidden:document.getElementById('quickStop').hidden,
    shownPanels:[...document.querySelectorAll('[data-panel]')].filter(node=>!node.hidden).map(node=>node.dataset.panel),
    dirtyHidden:document.getElementById('dirtyBadge').hidden,
    seatSummary:document.getElementById('seatSummary').textContent,
    conditionSummary:document.getElementById('conditionSummary').textContent,
    nextTitle:document.getElementById('nextTitle').textContent,
    venue:document.getElementById('venueProfile').value,venueCount:document.getElementById('venueProfile').options.length,
    venueName:document.getElementById('runVenueSummary').textContent,
    referenceHidden:document.getElementById('venueReference').hidden,referenceCount:document.getElementById('referenceArea').options.length,
    referenceNote:document.getElementById('venueReferenceNote').textContent,
    quantity:document.getElementById('quantity').value,areas:document.getElementById('areas').value,
    entryOffset:document.getElementById('entryOffsetMs').value,inspectionOnly:document.getElementById('inspectionOnly').checked,
    startLabel:document.getElementById('start').textContent,runMode:document.getElementById('runModeSummary').textContent,readinessText:document.getElementById('readiness').textContent,
    scope:document.getElementById('runScope').textContent,preflightSummary:document.getElementById('preflightSummary').textContent,preflightChecks:document.getElementById('preflightChecks').textContent,preflightCount:document.getElementById('preflightChecks').children.length,
    targetHint:document.getElementById('targetHint').textContent,entryMode:document.getElementById('entryMode').textContent,
    diagnosisHidden:document.getElementById('runDiagnosis').hidden,diagnosisTitle:document.getElementById('diagnosisTitle').textContent,diagnosisNext:document.getElementById('diagnosisNext').textContent,
    metricsHidden:document.getElementById('runMetrics').hidden,metricsElapsed:document.getElementById('metricsElapsed').textContent,phases:document.getElementById('phaseMetrics').textContent,operations:document.getElementById('operationMetrics').textContent,
    alwaysOnTopChecked:document.getElementById('alwaysOnTop').checked,
    captchaTarget:document.getElementById('captchaTarget').value,captchaTargetCount:document.getElementById('captchaTarget').options.length,
    captchaText:document.getElementById('captchaText').textContent,captchaMessage:document.getElementById('captchaStatus').textContent,
    captchaConfidence:document.getElementById('captchaConfidence').textContent,captchaPreview:document.getElementById('captchaPreview').getAttribute('src'),
    autoCaptcha:document.getElementById('autoCaptcha').checked,autoCaptchaSummary:document.getElementById('autoCaptchaSummary').textContent,
    manualCaptchaAssist:document.getElementById('manualCaptchaAssist').checked,manualCaptchaText:document.getElementById('manualCaptchaText').value,
    manualCaptchaPreview:document.getElementById('manualCaptchaPreview').getAttribute('src'),manualCaptchaMessage:document.getElementById('manualCaptchaStatus').textContent,
    manualCaptchaImageSize:(()=>{const image=document.getElementById('manualCaptchaPreview'),r=image.getBoundingClientRect();return {naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:r.width,height:r.height};})(),
    activeElement:document.activeElement?.id,
    profileControlsDisabled:['venueProfile','venueName','createVenue','referenceArea','referenceTarget','addReferenceAreas','entryOffsetMs','inspectionOnly'].map(id=>document.getElementById(id).disabled),
    dockVisible:(()=>{const r=document.querySelector('.action-dock').getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=0;})()
  })`);
  let fixtureRevision=100;
  const fixture=(extra={})=>({message:'로컬 화면 검증 · 실제 Chrome 연결 아님',revision:++fixtureRevision,running:false,windows:[],preferences:normalizePreferences(),manualCaptcha:{present:false,supported:false,busy:false,status:'idle'},pageUrl:'https://nol.yanolja.com/ticket',browserStatus:{connected:false,pairCode:'11111111111111111111111111111111',expiresAt:Date.now()+600000},...extra});
  async function publish(value){
    win.webContents.send('helper:state',value);
    // Await an event-loop boundary, not an arbitrary timing delay.
    await new Promise(resolve=>setImmediate(resolve));
    return read();
  }
  try{
    fs.mkdirSync(output,{recursive:true});
    await evaluate("run('state')");
    let ui=await read();
    check('야구 티켓팅 브랜드 · 삼성 응원 목적 · 두산 테스트 구분',()=>{
      assert.equal(ui.title,'야구 티켓팅 도우미 v'+require('../package.json').version);
      assert.ok(ui.text.includes('v'+require('../package.json').version+' · 예매는 Chrome에서'));
      assert.match(ui.text,/삼성 라이온즈 응원/);assert.match(ui.text,/두산 경기로 테스트/);
      assert.match(ui.text,/구장에 맞춰 직접/);assert.equal(ui.url,'https://nol.yanolja.com/ticket/genre/sports/postseason');
    });
    check('독립된 작은 설정 창 · 내장 웹 화면 없음',()=>{
      assert.equal(ui.mainCount,0);assert.equal(win.contentView.children.filter(child=>child.webContents!==win.webContents).length,0);
      assert.ok(win.getBounds().width<=420);assert.equal(ui.horizontalOverflow,false);
      // Windows can report a hidden window as non-topmost until it is shown.
      // Verify the configured value now; record native support separately below.
      assert.equal(ui.alwaysOnTopChecked,true);
    });
    check('서버 시계 확인 전과 예매 시작 일정의 의미 구분',()=>{
      assert.match(ui.clock,/확인 전/);assert.match(ui.clockHint,/일정과는 별개/);
      assert.match(ui.clockHint,/오류가 아닙니다/);assert.match(ui.text,/경기 시작 시각과는 달라요/);
      assert.match(ui.official,/경기를 선택/);
    });
    ui=await publish(fixture());
    check('Chrome 미연결 시 예매 동작 잠금 · 설정과 저장은 사용 가능',()=>{
      for(const id of ['home','testBears','demo','target','games','game','start','readAreas','recommend','choose','complete','scan','minus','reset','plus','focus','code','submitCode'])assert.equal(ui.disabled[id],true,id);
      for(const id of ['save','quantity','clock','stop'])assert.equal(ui.disabled[id],false,id);
      assert.ok(ui.tiers>=3);assert.equal(ui.badge,'연결 전');
    });
    await evaluate("document.getElementById('nextAction').click()");
    ui=await read();
    check('다음 할 일은 연결 안내로 이동 · 시작과 중지가 항상 표시',()=>{
      assert.deepEqual(ui.shownPanels,['connect']);assert.match(ui.nextTitle,/연결/);assert.equal(ui.dockVisible,true);
    });
    await evaluate("document.getElementById('tab-prefs').click();document.getElementById('quantityPlus').click()");
    ui=await read();
    check('연결 전 좌석 설정 가능 · 좌석 수와 미저장 안내 즉시 반영',()=>{
      assert.deepEqual(ui.shownPanels,['prefs']);assert.match(ui.seatSummary,/3석 · 연석 필수 · 시야방해석 제외/);assert.equal(ui.dirtyHidden,false);
    });
    await evaluate("document.getElementById('quantityMinus').click()");
    ui=await read();
    check('저장한 설정으로 되돌리면 미저장 표시 해제',()=>assert.equal(ui.dirtyHidden,true));
    await evaluate("document.getElementById('tab-prefs').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    ui=await read();
    check('단계 탭 방향키 이동과 하나의 패널만 표시',()=>assert.deepEqual(ui.shownPanels,['run']));
    await evaluate("(async()=>{document.getElementById('quantity').value='3';await document.getElementById('save').onclick();})()");
    const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'preferences.json'),'utf8'));
    check('연결 전에도 패널의 선호 조건 저장 동작',()=>assert.equal(saved.quantity,3));
    ui=await read();
    check('저장 성공 후 미저장 표시 해제',()=>assert.equal(ui.dirtyHidden,true));
    await evaluate("(async()=>{document.getElementById('venueProfile').value='lions-park';await document.getElementById('venueProfile').onchange();})()");
    ui=await read();
    check('예매 전 구장 선택 · 기존 조건 자동 보존 · 라이온즈파크 과거 자료는 선택 전 미적용',()=>{
      assert.equal(ui.venue,'lions-park');assert.equal(ui.venueCount,5);assert.equal(ui.quantity,'2');assert.equal(ui.areas,'');
      assert.equal(ui.referenceHidden,false);assert.equal(ui.referenceCount,43);assert.match(ui.referenceNote,/과거 자료/);assert.match(ui.referenceNote,/현재 경기/);
      assert.match(ui.venueName,/라이온즈파크/);
    });
    await evaluate("document.getElementById('quantity').value='4';[...document.getElementById('referenceArea').options].find(option=>option.value==='블루존').selected=true;document.getElementById('addReferenceAreas').click();");
    ui=await read();
    check('과거 구역명은 명시 선택한 항목만 현재 조건에 추가',()=>{assert.equal(ui.areas,'블루존');assert.equal(ui.dirtyHidden,false);});
    await evaluate("(()=>{const tier=document.querySelector('.tier');tier.querySelector('[data-field=enabled]').checked=true;tier.querySelector('[data-field=enabled]').onchange();tier.querySelector('[data-field=maxRow]').value='5';for(const option of document.getElementById('referenceArea').options)option.selected=option.value==='3루 내야지정석';document.getElementById('addReferenceAreas').click();})()");
    const tierImported=await evaluate("({target:document.getElementById('referenceTarget').value,areas:document.querySelector('.tier [data-field=areas]').value,baseDisabled:document.getElementById('areas').disabled})");
    check('조건 묶음 사용 중에는 선택한 묶음에 구역 추가 · 기본 조건은 비활성',()=>{assert.equal(tierImported.target,'0');assert.equal(tierImported.areas,'3루 내야지정석');assert.equal(tierImported.baseDisabled,true);});
    await evaluate("(async()=>{document.getElementById('venueProfile').value='champions-field';await document.getElementById('venueProfile').onchange();})()");
    ui=await read();
    check('광주 설정은 라이온즈파크 설정과 독립 · 참고 목록 숨김',()=>{assert.equal(ui.venue,'champions-field');assert.equal(ui.quantity,'2');assert.equal(ui.areas,'');assert.equal(ui.referenceHidden,true);});
    await evaluate("(async()=>{document.getElementById('quantity').value='3';document.getElementById('areas').value='로컬 검증용 광주 구역';document.getElementById('venueProfile').value='lions-park';await document.getElementById('venueProfile').onchange();})()");
    ui=await read();
    check('구장 전환 뒤 기존 매수·열·구역 우선순위를 그대로 복원',()=>{assert.equal(ui.quantity,'4');assert.match(ui.conditionSummary,/3루 내야지정석/);assert.match(ui.conditionSummary,/1~5열/);assert.equal(ui.dirtyHidden,true);});
    await evaluate("(async()=>{document.getElementById('quantity').value='0';document.getElementById('venueProfile').value='jamsil';await document.getElementById('venueProfile').onchange();})()");
    ui=await read();
    check('잘못된 매수 입력은 구장 전환을 거부하고 입력·현재 구장을 보존',()=>{assert.equal(ui.venue,'lions-park');assert.equal(ui.quantity,'0');});
    await evaluate("(async()=>{document.getElementById('quantity').value='4';document.getElementById('venueName').value='로컬 검증 구장';await document.getElementById('createVenue').onclick();})()");
    ui=await read();
    check('다른 경기용 구장 설정을 현재 조건으로 복사 · 선택 상태 반영',()=>{assert.match(ui.venue,/^custom-/);assert.equal(ui.venueCount,6);assert.equal(ui.quantity,'4');assert.equal(ui.venueName,'로컬 검증 구장');});
    const savedVenues=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'venue-profiles.json'),'utf8'));
    check('구장별 설정은 파일에 독립 저장 · 기존 공통 설정까지 보존',()=>{
      assert.equal(savedVenues.profiles.find(profile=>profile.id==='legacy').preferences.quantity,3);
      assert.equal(savedVenues.profiles.find(profile=>profile.id==='champions-field').preferences.quantity,3);
      assert.equal(savedVenues.profiles.find(profile=>profile.id==='champions-field').preferences.areas[0],'로컬 검증용 광주 구역');
      assert.equal(savedVenues.profiles.find(profile=>profile.id==='lions-park').preferences.tiers[0].maxRow,5);
    });
    await evaluate("(async()=>{document.getElementById('venueProfile').value='legacy';await document.getElementById('venueProfile').onchange();const result=await run('preferences',{quantity:2});showPrefs(result.preferences);})()");
    ui=await read();
    check('진입 시각 보정과 진입 확인 전용 모드는 사용자가 선택하기 전 기본값 유지',()=>{assert.equal(ui.entryOffset,'0');assert.equal(ui.inspectionOnly,false);});
    const connected=fixture({target:701,windows:[{id:701,title:'로컬 경기 목록',url:'https://nol.yanolja.com/ticket/genre/sports/bears'}],browserStatus:{connected:true,message:'로컬 연결 상태 검증',pairCode:null}});
    ui=await publish(connected);
    check('연결 상태 반영 · Chrome 동작 활성화 · 설치 안내 접기',()=>{
      assert.equal(ui.badge,'연결됨');assert.equal(ui.helpOpen,false);
      for(const id of ['home','testBears','demo','target','games','game','scan','focus'])assert.equal(ui.disabled[id],false,id);
      assert.equal(ui.disabled.start,true,'경기 선택 전에는 시작 잠금');
      assert.equal(ui.pairing,'');
    });
    await evaluate(`showPageInfo({title:'포스트시즌 <img src=x onerror=alert(1)>',checkedAt:Date.UTC(2026,9,15,0,0),empty:true,cardCount:0,maxTickets:4,mobileOnly:true,cardOnly:true,notes:['공식 공지를 확인하세요.'],seatImages:[{label:'잠실 좌석 안내',url:'https://ticketimage.interpark.com/Play/image/large/26/test.jpg'}]},0);showStep('page');`);
    const emptyPage=await evaluate("({status:document.getElementById('pageReadoutStatus').textContent,time:document.getElementById('pageReadoutTime').textContent,title:document.getElementById('pageReadoutTitle').textContent,images:document.querySelectorAll('#pageReadout img').length,guides:document.querySelectorAll('#seatingGuides button').length,next:document.getElementById('nextTitle').textContent,openAt:document.getElementById('openAt').value})");
    check('판매 상품 없음과 확인 시각 · 안전한 텍스트 · 공식 좌석 안내 표시',()=>{
      assert.match(emptyPage.status,/예매 가능한 상품 없음/);assert.match(emptyPage.next,/예매 가능한 상품이 없습니다/);
      assert.match(emptyPage.time,/한국 시각/);assert.match(emptyPage.title,/<img/);assert.equal(emptyPage.images,0);assert.equal(emptyPage.guides,1);assert.equal(emptyPage.openAt,'');
    });
    await evaluate("showPageInfo({title:'확인 중',checkedAt:Date.now(),empty:false,cardCount:2,notes:[]},0)");
    const unknownPage=await evaluate("document.getElementById('pageReadoutStatus').textContent");
    check('미확인 경기 카드 구조를 상품 없음으로 오인하지 않음',()=>assert.match(unknownPage,/구조를 확인하지 못했습니다/));
    await evaluate("showPageInfo({title:'공식 공지',checkedAt:Date.now(),empty:true,cardCount:0,maxTickets:4,mobileOnly:true,cardOnly:true,notes:['1인 최대 4매','모바일 티켓 발권','카드 결제만 가능']},0)");
    const noteCount=await evaluate("document.querySelectorAll('#pageNotes li').length");
    check('페이지 공지와 요약 속성의 같은 안내 중복 방지',()=>assert.equal(noteCount,3));
    await evaluate(`showClock({source:'ticket-server',offsetMs:150,uncertaintyMs:20,measuredAt:Date.UTC(2026,8,18,2,0,0)});`);
    ui=await read();
    check('서버 시계의 빠름 · 초 단위 오차 · 측정 당시 설명',()=>{
      assert.match(ui.clock,/PC보다 0\.150초 빠름/);assert.match(ui.clock,/±0\.020초/);assert.match(ui.clockHint,/읽은 당시/);
    });
    await evaluate(`showClock({source:'ticket-server',offsetMs:-250,uncertaintyMs:30,measuredAt:Date.UTC(2026,8,18,2,0,0)});`);
    ui=await read();
    check('서버 시계가 느린 경우 방향 표시',()=>assert.match(ui.clock,/PC보다 0\.250초 느림/));
    await evaluate(`showClock({source:'http-date-fallback',offsetMs:50,uncertaintyMs:550,measuredAt:Date.UTC(2026,8,18,2,0,0)});`);
    ui=await read();
    check('대체 시각 출처와 정시 예약 사용 안 함 설명',()=>{
      assert.match(ui.clock,/웹 응답 시계\(대체\)/);assert.match(ui.clockHint,/예약하지 않습니다/);
    });
    await evaluate(`(()=>{gameRows=[{key:'fixture-match',openAt:Date.UTC(2026,8,20,2,0,0)}];document.getElementById('game').replaceChildren(new Option('로컬 경기','fixture-match'));document.getElementById('game').onchange();})()`);
    const time=await evaluate("({official:document.getElementById('official').textContent,input:document.getElementById('openAt').value})");
    check('공지된 예매 시작을 한국 시각으로 표시',()=>{
      assert.match(time.input,/^2026-09-20T11:00(?::00)?$/);assert.match(time.official,/한국 시각/);assert.match(time.official,/11:00/);
    });
    ui=await read();
    check('대상 경기를 선택하면 자동 진행 시작 활성화',()=>assert.equal(ui.disabled.start,false));
    await evaluate("document.getElementById('inspectionOnly').checked=true;document.getElementById('inspectionOnly').onchange()");
    ui=await read();
    check('진입 확인 모드를 켜면 시작 버튼·준비 목록·요약에 좌석 선택 안 함 명시',()=>{
      assert.equal(ui.startLabel,'진입 확인만 시작');assert.match(ui.runMode,/진입 확인만 · 좌석 선택 없이 정지/);
      assert.match(ui.readinessText,/진입 확인만 실행 · 좌석을 선택하지 않습니다/);assert.match(ui.nextTitle,/진입만 확인/);
      assert.match(ui.scope,/좌석 선택과 선택 완료는 실행하지 않습니다/);
    });
    await evaluate("document.getElementById('inspectionOnly').checked=false;document.getElementById('inspectionOnly').onchange()");
    ui=await read();
    check('진입 확인 모드를 해제하면 시작 버튼·준비 목록·요약이 자동 진행으로 복귀',()=>{
      assert.equal(ui.startLabel,'자동 진행 시작');assert.equal(ui.runMode,'자동 진행 · 좌석 조건 적용');
      assert.match(ui.readinessText,/자동 진행 실행 · 설정한 좌석 조건을 적용합니다/);assert.doesNotMatch(ui.readinessText,/좌석을 선택하지 않습니다/);
      assert.match(ui.nextTitle,/좌석 조건을 확인/);
    });
    await evaluate("document.getElementById('autoComplete').checked=false;updateOverview()");
    ui=await read();
    check('선택 완료를 끄면 다음 화면으로 이동하지 않는 범위를 표시',()=>{assert.match(ui.scope,/좌석 조건 확인·선택 → 정지/);assert.match(ui.scope,/다음 화면으로 자동 이동하지 않습니다/);});
    await evaluate("document.getElementById('autoComplete').checked=true;updateOverview()");
    const preflightResult={canStart:true,message:'로컬 점검 완료',checks:[{id:'scope',level:'warning',title:'현재 화면 <img src=x>',detail:'로그인 성공 여부는 확인하지 않았습니다.'}]};
    ui=await publish({...connected,revision:++fixtureRevision,preflight:preflightResult});
    check('실행 전 점검은 확인 사항을 안전한 텍스트로 표시 · 시작을 추가 차단하지 않음',()=>{assert.equal(ui.preflightCount,1);assert.match(ui.preflightChecks,/<img src=x>/);assert.match(ui.preflightChecks,/로그인 성공 여부는 확인하지 않았습니다/);assert.equal(ui.disabled.start,false);});
    assert.equal(await evaluate("document.querySelectorAll('#preflightChecks img').length"),0);
    await evaluate("document.getElementById('inspectionOnly').checked=true;document.getElementById('inspectionOnly').onchange()");
    ui=await publish({...connected,revision:++fixtureRevision,preflight:preflightResult});
    check('설정 변경 후 기존 점검결과 무효화 · 같은 상태 알림으로 복구하지 않음',()=>{assert.equal(ui.preflightCount,0);assert.match(ui.preflightSummary,/다시 눌러/);});
    const preflightCalls=await evaluate(`(async()=>{const originalRun=run,calls=[];try{run=async(action,payload)=>{calls.push({action,payload});return ${JSON.stringify(preflightResult)};};await document.getElementById('preflight').onclick();return calls;}finally{run=originalRun;}})()`);
    check('실행 전 점검 버튼은 현재 조건과 진입 확인 모드만 읽기 명령으로 전달',()=>{assert.deepEqual(preflightCalls.map(call=>call.action),['preflight']);assert.equal(preflightCalls[0].payload.inspectionOnly,true);assert.equal(preflightCalls[0].payload.preferences.quantity,2);});
    await evaluate("document.getElementById('inspectionOnly').checked=false;document.getElementById('inspectionOnly').onchange()");
    const diagnostics={diagnosis:{code:'inspection-complete',level:'warning',title:'진입 확인만 실행했습니다.',detail:'좌석 선택은 실행하지 않았습니다. <img src=x>',nextAction:'진입 확인만 설정을 해제한 뒤 시작하세요.'},metrics:{elapsedMs:12500,pendingCount:0,phases:[{code:'entry',label:'예매창 진입',durationMs:12000}],operations:[{action:'read <script>',count:3,failed:1,totalMs:15000,maxMs:10000,lastMs:2000}]}};
    ui=await publish({...connected,revision:++fixtureRevision,lastRun:{id:'fixture-v094',durationMs:12500,message:'로컬 실행 종료',stages:[{stage:'진입 확인 종료',elapsedMs:12500}],...diagnostics}});
    check('마지막 실행의 정지 이유·다음 행동·단계별 시간과 실패 횟수 표시',()=>{assert.equal(ui.diagnosisHidden,false);assert.match(ui.diagnosisTitle,/진입 확인만/);assert.match(ui.diagnosisNext,/해제한 뒤/);assert.equal(ui.metricsHidden,false);assert.match(ui.metricsElapsed,/12.50초/);assert.match(ui.phases,/예매창 진입/);assert.match(ui.operations,/실패 1건/);assert.match(ui.operations,/누적 15.00초/);assert.match(ui.text,/누적 시간을 더해도 전체 경과와 같지 않습니다/);assert.match(ui.text,/대기 시간을 포함/);});
    assert.equal(await evaluate("document.querySelectorAll('#runDiagnosis img,#operationMetrics script').length"),0);
    ui=await publish({...connected,revision:++fixtureRevision,running:true,runStatus:'로컬 진단 상태',runDiagnostics:{...diagnostics,diagnosis:{...diagnostics.diagnosis,title:'현재 화면 확인 중'},metrics:{...diagnostics.metrics,elapsedMs:13000,pendingCount:1}}});
    check('실행 중 진단은 최신 단계·경과 시간·처리 중 명령을 표시',()=>{assert.equal(ui.diagnosisTitle,'현재 화면 확인 중');assert.match(ui.metricsElapsed,/13.00초 · 처리 중 1건/);assert.equal(ui.disabled.preflight,true);});
    ui=await publish({...connected,revision:++fixtureRevision,running:true,runStatus:'로컬 실행 상태 검증'});
    check('진행 중 조건 변경 잠금 · 중지와 직접 보안문자 입력 유지',()=>{
      for(const id of ['home','target','games','save','quantity','scan'])assert.equal(ui.disabled[id],true,id);
      for(const id of ['focus','code','submitCode','stop'])assert.equal(ui.disabled[id],false,id);
      assert.equal(ui.quickStopHidden,false);
      assert.ok(ui.profileControlsDisabled.every(Boolean),'구장 변경·참고 적용·진입 설정도 실행 중 잠금');
      assert.deepEqual(ui.shownPanels,['run']);assert.equal(ui.dockVisible,true);
      for(const id of ['captchaRead','captchaSubmit','captchaTarget','autoCaptcha'])assert.equal(ui.disabled[id],true,id);
    });
    const captchaReady={available:true,ready:true,busy:false,message:'로컬 모델 준비됨',text:'',confidence:null,previewDataUrl:'',mode:null};
    const concert=fixture({target:702,windows:[{id:701,title:'로컬 경기 목록',url:'https://nol.yanolja.com/ticket/genre/sports/bears'},{id:702,title:'로컬 콘서트 예매창',url:'https://tickets.interpark.com/onestop/seat'}],browserStatus:{connected:true,pairCode:null},captchaStatus:captchaReady});
    ui=await publish({...concert,revision:++fixtureRevision});
    check('이미 열린 좌석 페이지는 경기 선택 없이 명시적 시작 가능 · 연결만으로 진행하지 않음',()=>{
      assert.equal(ui.disabled.start,false);assert.equal(ui.startLabel,'현재 좌석 화면에서 시작');assert.match(ui.readinessText,/다시 진입하지 않습니다/);assert.match(ui.targetHint,/연결만으로 자동 진행하지 않습니다/);assert.match(ui.entryMode,/진입 요청이나 오픈 시각 예약은 실행하지 않습니다/);assert.equal(report.chromeRequests,0);
      for(const id of ['games','game','openAt','clock','entryStrategy','entryOffsetMs'])assert.equal(ui.disabled[id],true,id);
    });
    const seatStartCalls=await evaluate("(async()=>{const originalRun=run,calls=[];try{run=async(action,payload)=>{calls.push({action,payload});return {};};await document.getElementById('start').onclick();return calls;}finally{run=originalRun;}})()");
    check('열린 좌석 화면 시작은 사용자 버튼 한 번으로 시작 명령만 전달 · 오픈 시각 미전달',()=>{assert.deepEqual(seatStartCalls.map(call=>call.action),['start']);assert.equal(seatStartCalls[0].payload.key,'');assert.equal(seatStartCalls[0].payload.openAt,null);assert.equal(seatStartCalls[0].payload.inspectionOnly,false);});
    ui=await publish({...concert,revision:++fixtureRevision,windows:[{id:702,title:'지원하지 않는 페이지',url:'https://tickets.interpark.com/onestop/seat-extra'}]});
    check('비슷한 URL은 좌석 화면으로 인정하지 않음',()=>{assert.equal(ui.disabled.start,true);assert.notEqual(ui.startLabel,'현재 좌석 화면에서 시작');});
    const manualPreview=await evaluate("(()=>{const canvas=document.createElement('canvas');canvas.width=210;canvas.height=70;const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,210,70);context.fillStyle='#193149';context.font='bold 28px monospace';context.fillText('ABCXYZ',45,46);return canvas.toDataURL('image/png');})()");
    const manualReady={present:true,supported:true,status:'ready',challengeId:'fixture-a',imageDataUrl:manualPreview,existingText:'',message:'이미지를 보고 직접 입력하세요.',targetId:702,busy:false};
    ui=await publish({...concert,revision:++fixtureRevision,running:true,manualCaptcha:manualReady});
    await evaluate("document.getElementById('manualCaptchaPreview').decode()");ui=await read();
    check('직접 입력 기본 설정 · 자동 진행 중 이미지 준비와 인간 입력 허용',()=>{
      assert.equal(ui.manualCaptchaAssist,true);assert.equal(ui.autoCaptcha,false);assert.equal(ui.disabled.autoCaptcha,true);
      assert.match(ui.autoCaptchaSummary,/보안문자 직접 입력 · 이미지 확대·입력칸 준비/);assert.deepEqual(ui.shownPanels,['captcha']);
      assert.equal(ui.disabled.manualCaptchaPrepare,false);assert.equal(ui.disabled.manualCaptchaText,false);assert.equal(ui.disabled.manualCaptchaSubmit,true);assert.equal(ui.manualCaptchaPreview,manualPreview);
      assert.equal(ui.manualCaptchaImageSize.naturalWidth,210);assert.equal(ui.manualCaptchaImageSize.naturalHeight,70);
      assert.ok(Math.abs(ui.manualCaptchaImageSize.width/ui.manualCaptchaImageSize.height-3)<.02,'원본 가로·세로 비율을 유지');
    });
    const noAutomaticSubmission=await evaluate("(()=>{const originalRun=run,calls=[];try{run=async(action)=>{calls.push(action);return {};};const input=document.getElementById('manualCaptchaText');input.focus();input.value='abcxyz';input.oninput();return {calls,value:input.value};}finally{run=originalRun;}})()");
    check('직접 작성한 소문자를 대문자로 변환 · 6자리 도달만으로 제출하지 않음',()=>{assert.equal(noAutomaticSubmission.value,'ABCXYZ');assert.deepEqual(noAutomaticSubmission.calls,[]);});
    ui=await publish({...concert,revision:++fixtureRevision,running:true,manualCaptcha:{...manualReady,message:'같은 이미지 상태 갱신'}});
    check('같은 이미지 상태 갱신은 작성 중 텍스트와 입력 포커스를 유지',()=>{assert.equal(ui.manualCaptchaText,'ABCXYZ');assert.equal(ui.activeElement,'manualCaptchaText');});
    ui=await publish({...concert,revision:++fixtureRevision,running:true,manualCaptcha:{...manualReady,challengeId:'fixture-b'}});
    check('보안문자 교체 시 이전 작성값과 제출 가능 상태를 무효화',()=>{assert.equal(ui.manualCaptchaText,'');assert.equal(ui.disabled.manualCaptchaSubmit,true);});
    const manualRoutes=await evaluate(`(async()=>{const originalRun=run,calls=[];let resolveSubmit;try{run=async(action,payload)=>{calls.push({action,payload});if(action==='manualCaptchaSubmit')return new Promise(resolve=>{resolveSubmit=resolve;});return {};};await document.getElementById('manualCaptchaPrepare').onclick();await document.getElementById('manualCaptchaFocus').onclick();const input=document.getElementById('manualCaptchaText');input.value='ABC';await document.getElementById('manualCaptchaSubmit').onclick();const shortMessage=document.getElementById('manualCaptchaStatus').textContent;input.value='abcxyz';input.oninput();const first=input.onkeydown({key:'Enter',isComposing:false,repeat:false,preventDefault(){}});await document.getElementById('manualCaptchaSubmit').onclick();await input.onkeydown({key:'Enter',isComposing:false,repeat:true,preventDefault(){}});const inFlight=calls.filter(call=>call.action==='manualCaptchaSubmit').length;resolveSubmit({});await first;await document.getElementById('manualCaptchaSubmit').onclick();return {calls,shortMessage,inFlight};}finally{run=originalRun;lockControls();}})()`);
    check('짧은 입력 거부 · 명시적 Enter만 제출 · 중복 클릭과 키 반복 방지',()=>{
      assert.match(manualRoutes.shortMessage,/영문 6자리/);assert.equal(manualRoutes.inFlight,1);
      assert.deepEqual(manualRoutes.calls.map(call=>call.action),['manualCaptchaPrepare','manualCaptchaFocus','manualCaptchaSubmit']);
      assert.deepEqual(manualRoutes.calls[2].payload,{challengeId:'fixture-b',text:'ABCXYZ'});
    });
    ui=await publish({...concert,revision:++fixtureRevision,target:701,manualCaptcha:manualReady});
    check('다른 대상 탭으로 바꾸면 기존 이미지·작성값·제출 기능을 지움',()=>{assert.equal(ui.manualCaptchaText,'');assert.equal(ui.manualCaptchaPreview,null);assert.equal(ui.disabled.manualCaptchaSubmit,true);});
    ui=await publish({...concert,revision:++fixtureRevision,manualCaptcha:{...manualReady,challengeId:'fixture-external',imageDataUrl:'https://example.invalid/captcha.png'}});
    check('직접 입력 미리보기는 로컬 이미지 데이터만 표시',()=>{assert.equal(ui.manualCaptchaPreview,null);assert.equal(ui.disabled.manualCaptchaText,true);});
    ui=await publish({...concert,revision:++fixtureRevision,manualCaptcha:{...manualReady,challengeId:'fixture-human-input',status:'manual',existingText:'ABCXYZ',message:'예매창에 직접 입력한 내용은 덮어쓰지 않습니다.'}});
    check('Chrome에서 이미 작성한 내용은 표시만 하고 덮어쓰기·중복 전송을 잠금',()=>{assert.equal(ui.manualCaptchaText,'ABCXYZ');assert.equal(ui.disabled.manualCaptchaText,true);assert.equal(ui.disabled.manualCaptchaSubmit,true);});
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,busy:true},manualCaptcha:manualReady});
    check('기존 보안문자 작업 중에는 수동 준비·제출 중복을 차단',()=>{assert.equal(ui.disabled.manualCaptchaPrepare,true);assert.equal(ui.disabled.manualCaptchaSubmit,true);});
    ui=await publish(concert);
    await evaluate("document.getElementById('manualCaptchaAssist').checked=false;document.getElementById('manualCaptchaAssist').onchange();document.getElementById('autoCaptcha').checked=true;document.getElementById('autoCaptcha').onchange()");
    await evaluate("showStep('captcha')");ui=await read();
    check('독립 보안문자 탭 · 경기 미선택이어도 콘서트 대상에 실행 가능',()=>{
      assert.deepEqual(ui.shownPanels,['captcha']);assert.equal(ui.captchaTarget,'702');assert.equal(ui.captchaTargetCount,2);
      assert.equal(ui.disabled.start,true);assert.equal(ui.disabled.captchaRead,false);assert.equal(ui.disabled.captchaSubmit,false);assert.equal(ui.disabled.captchaStop,true);
      assert.match(ui.text,/예매 진입이나 좌석 선택을 시작하지 않습니다/);assert.equal(ui.autoCaptcha,true);
    });
    await evaluate("document.getElementById('autoCaptcha').checked=false;updateOverview()");ui=await read();
    check('자동 보안문자를 끄면 수동 처리 요약에 반영',()=>assert.match(ui.autoCaptchaSummary,/직접 입력 사용/));
    await evaluate("document.getElementById('autoCaptcha').checked=true;updateOverview()");
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,busy:true,mode:'submit',message:'로컬 보안문자 확인 대기'}});
    check('독립 보안문자 처리 중 다른 동작과 수동 중복 입력 잠금 · 중지는 허용',()=>{
      for(const id of ['start','target','captchaTarget','captchaRead','captchaSubmit','submitCode','choose','complete','save'])assert.equal(ui.disabled[id],true,id);
      assert.equal(ui.disabled.captchaStop,false);assert.equal(ui.disabled.focus,false);
      assert.deepEqual(ui.shownPanels,['captcha']);
    });
    const safePreview='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,text:'WTCNBW',confidence:.98,mode:'read',previewDataUrl:safePreview,message:'읽기만 완료'}});
    check('인식 결과와 점수의 의미 · 로컬 PNG 미리보기 표시',()=>{
      assert.equal(ui.captchaText,'WTCNBW');assert.match(ui.captchaConfidence,/98\.0%/);assert.match(ui.captchaConfidence,/정답률을 뜻하지 않습니다/);assert.equal(ui.captchaPreview,safePreview);
    });
    const mislabeledPreview=safePreview.replace('image/png','image/jpeg');
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,errorCode:'IMAGE_DECODE_FAILED',text:'',previewDataUrl:mislabeledPreview,message:'보안문자 이미지 파일을 열지 못했습니다.'}});
    check('JPEG로 표시된 PNG 미리보기 유지 · 실패를 준비됨과 구분',()=>{
      assert.equal(ui.captchaPreview,mislabeledPreview);assert.match(ui.text,/인식 실패/);
      assert.equal(ui.disabled.captchaRead,false);assert.equal(ui.disabled.captchaSubmit,false);
    });
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,errorCode:null,text:'WTCNBW',message:'인식 완료'}});
    check('실패 후 재시도 성공 시 오류 상태 해제',()=>{
      assert.doesNotMatch(ui.text,/인식 실패/);assert.equal(ui.captchaText,'WTCNBW');
    });
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,text:'<img src=x onerror=alert(1)>',previewDataUrl:'https://example.invalid/external.png'}});
    check('보안문자 결과는 텍스트로만 표시 · 외부 이미지 요청 차단',()=>{
      assert.equal(ui.captchaText,'<img src=x onerror=alert(1)>');assert.equal(ui.captchaPreview,null);
    });
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:{...captchaReady,available:false,ready:false,message:'인식 프로그램 없음'}});
    check('인식 프로그램이 준비되지 않으면 별도 테스트를 잠금',()=>{
      assert.equal(ui.disabled.captchaRead,true);assert.equal(ui.disabled.captchaSubmit,true);assert.match(ui.captchaMessage,/프로그램 없음/);
    });
    ui=await publish({...concert,revision:++fixtureRevision,captchaStatus:captchaReady});
    const captchaRoutes=await evaluate(`(async()=>{const originalRun=run,calls=[];try{run=async(action,payload)=>{calls.push({action,payload});return {};};await document.getElementById('captchaRead').onclick();await document.getElementById('captchaSubmit').onclick();await document.getElementById('captchaStop').onclick();return calls;}finally{run=originalRun;showCaptchaStatus(${JSON.stringify(captchaReady)});lockControls();}})()`);
    check('독립 테스트 버튼은 보안문자 명령만 전달 · 예매시작·좌석 명령 없음',()=>assert.deepEqual(captchaRoutes.map(call=>call.action),['captchaRead','captchaSubmit','captchaStop']));
    ui=await publish(fixture());
    check('연결 끊김 반영과 Chrome 명령 전송 없음',()=>{
      assert.equal(ui.disabled.start,true);assert.equal(ui.disabled.scan,true);assert.equal(report.chromeRequests,0);
      assert.equal(ui.quickStopHidden,true);
      assert.equal(ui.disabled.captchaRead,true);assert.equal(ui.disabled.captchaSubmit,true);
    });
    win.showInactive();
    await evaluate("document.getElementById('connectionHelp').open=true;window.scrollTo(0,0);");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await evaluate("showStep('connect')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    ui=await read();
    check('다른 단계에서 연결 단계로 다시 이동 가능',()=>assert.deepEqual(ui.shownPanels,['connect']));
    // Flush the first composited frame after revealing a previously hidden window.
    await win.webContents.capturePage();
    // The desktop/window manager may alter the stacking state while another
    // native application is controlled. Exercise the application's command at
    // this point instead of treating the initial native stacking as immutable.
    await command('alwaysOnTop',false);
    const nativeTopmostOff=win.isAlwaysOnTop(),topmostOff=await read();
    await command('alwaysOnTop',true);
    const nativeTopmostOn=win.isAlwaysOnTop(),topmostOn=await read();
    report.windowStacking={nativeTopmostOff,nativeTopmostOn,visible:win.isVisible(),minimized:win.isMinimized(),setting:topmostOn.alwaysOnTopChecked,nativeVerified:nativeTopmostOff===false&&nativeTopmostOn===true};
    if(!report.windowStacking.nativeVerified)report.limitations=['이 실행 환경에서 항상 위에 표시의 네이티브 창 상태를 확인하지 못했습니다. 설정 저장·UI 반영은 검증했지만 실제 창 겹침 순서는 별도 확인이 필요합니다.'];
    check('항상 위에 표시 설정의 해제·설정 UI 반영 및 파일 저장',()=>{
      assert.equal(topmostOff.alwaysOnTopChecked,false);assert.equal(topmostOn.alwaysOnTopChecked,true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'settings.json'),'utf8')).alwaysOnTop,true);
    });
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-connect.png'),(await win.webContents.capturePage()).toPNG());
    await publish(connected);
    await evaluate("showPageInfo({title:'2026 KBO 포스트시즌 - 와일드카드',checkedAt:Date.UTC(2026,9,15,0,0),empty:true,cardCount:0,maxTickets:4,mobileOnly:true,cardOnly:true,notes:['로컬 화면 검증용 데이터입니다.'],seatImages:[]},0);showStep('page');");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-page.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate("showPrefs({quantity:2,requireTogether:true,excludeObstructed:true,priority:'front',areas:[],blocks:[],tiers:[{name:'앞열 통로',areas:['응원석'],blocks:[],minRow:1,maxRow:5,aisle:'required',priority:'front'}],autoComplete:true,autoNotice:true});showStep('prefs')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-prefs.png'),(await win.webContents.capturePage()).toPNG());
    ui=await read();
    check('설정한 조건 묶음·열 범위·통로 요약 표시',()=>{
      assert.match(ui.conditionSummary,/1순위 앞열 통로/);assert.match(ui.conditionSummary,/1~5열/);assert.match(ui.conditionSummary,/추정 통로 필수/);
      assert.match(ui.text,/A=1, B=2, …, Z=26/);
    });
    win.setSize(360,600);
    await evaluate("document.getElementById('priorityDetails').open=true");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    ui=await read();
    check('최소 창 크기에서 상세 조건 가로 넘침 없음 · 실행 버튼 표시',()=>{assert.equal(ui.horizontalOverflow,false);assert.equal(ui.dockVisible,true);});
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-narrow.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(400,900);
    await evaluate("showStep('run');showClock({source:'ticket-server',offsetMs:150,uncertaintyMs:20,measuredAt:Date.UTC(2026,9,15,2,0,0)});");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-run.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(360,600);
    await evaluate(`showRunDiagnostics(${JSON.stringify(diagnostics)});document.getElementById('runAnalysis').open=true;document.getElementById('runAnalysis').scrollIntoView({block:'start'});`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');ui=await read();
    check('최소 창 크기에서 실행 분석 표 가로 넘침 없음 · 실행 버튼 유지',()=>{assert.equal(ui.horizontalOverflow,false);assert.equal(ui.dockVisible,true);});
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-analysis.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(400,900);
    await publish({...concert,revision:++fixtureRevision,manualCaptcha:{...manualReady,challengeId:'preview-fixture',message:'로컬 화면 예시 · 이미지를 보고 직접 입력하세요.'},captchaStatus:{...captchaReady,text:'WTCNBW',confidence:.98,mode:'read',message:'읽기만 완료 · Chrome 입력은 하지 않았습니다.'}});
    await evaluate("showStep('captcha')");
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output,'preview-'+versionTag+'-captcha.png'),(await win.webContents.capturePage()).toPNG());
    win.setSize(360,600);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');ui=await read();
    check('최소 창 크기에서 보안문자 탭·미리보기 가로 넘침 없음',()=>{assert.equal(ui.horizontalOverflow,false);assert.equal(ui.dockVisible,true);});
    check('화면 렌더링 중 JavaScript 오류 없음',()=>assert.deepEqual(errors,[]));
    report.passed=true;
  }catch(error){report.error=error.stack||String(error);throw error;}
  finally{
    report.completedAt=new Date().toISOString();
    fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'panel-smoke-result-'+versionTag+'.json'),JSON.stringify(report,null,2));
    bridge.request=originalRequest;
    if(!win.isDestroyed())await new Promise(resolve=>{win.once('closed',resolve);win.close();});
  }
  return report;
};
