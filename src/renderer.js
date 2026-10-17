'use strict';
const $=id=>document.getElementById(id);
let seats=[],gameRows=[],prefInitialized=false,running=false,localBusy=0,currentTargetUrl='',currentTargetId=null,lastRunId=null,currentEntry=null,browserConnected=null,pageUrlInitialized=false;
let activeStep='connect',savedPrefsSnapshot=null,latestPageInfo=null,pairingExpiryTimer=null,venueProfiles=null;
let currentCatalog=null;
let preflightFingerprint=null,lastPreflightState='',lastRunRecord=null;
let captchaState={available:false,ready:false,busy:false,message:'인식 프로그램 준비 상태를 확인하고 있습니다.',text:'',confidence:null,mode:null},captchaPending=false;
let manualCaptchaState={present:false,supported:false,status:'idle',challengeId:null,imageDataUrl:null,existingText:'',message:'이미지 보기·입력 준비를 눌러 주세요.',targetId:null,busy:false},manualCaptchaPending=false,manualCaptchaShownKey=null,manualCaptchaSubmittedKey=null;
const POSTSEASON_URL='https://nol.yanolja.com/ticket/genre/sports/postseason';
const stepOrder=['connect','page','prefs','run','captcha'];
const captchaBusy=()=>captchaPending||captchaState.busy===true;
const manualCaptchaBusy=()=>manualCaptchaPending||manualCaptchaState.busy===true;
const safeManualCaptchaImage=value=>typeof value==='string'&&value.length<=3*1024*1024&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:'';
const manualCaptchaKey=()=>manualCaptchaState.present&&manualCaptchaState.supported&&manualCaptchaState.challengeId&&String(manualCaptchaState.targetId)===String(currentTargetId)?String(manualCaptchaState.targetId)+':'+manualCaptchaState.challengeId:null;
const targetIsGate=()=>/^https:\/\/tickets\.interpark\.com\/gates\/ticket\/\d+(?:[/?#]|$)/.test(currentTargetUrl);
const targetIsSeat=()=>{try{const url=new URL(currentTargetUrl);return url.origin==='https://tickets.interpark.com'&&url.pathname==='/onestop/seat';}catch{return false;}};
const lockedIds=['home','postseason','testBears','pageUrl','demo','target','games','game','openAt','restoreOpening','clock','entryStrategy','entryOffsetMs','inspectionOnly','stopAfterCaptcha','excludeRestricted','recordObservation','preflight','start','save','quantity','quantityMinus','quantityPlus','priority','areas','blocks','together','obstructed','autoComplete','autoCaptcha','manualCaptchaAssist','notice','readAreas','addArea','areaChoice','recommend','choose','complete','scan','minus','reset','plus','addTier','refreshPairing','updateExtension','extensionFolder','venueProfile','venueName','createVenue','referenceArea','referenceTarget','addReferenceAreas','catalogTarget','blockChoice','addBlock'];
const browserIds=['recordObservation','home','postseason','testBears','demo','target','games','game','start','readAreas','recommend','choose','complete','scan','minus','reset','plus','focus','code','submitCode'];
const tierValue=(node,name)=>node.querySelector('[data-field="'+name+'"]');
function showStep(step,{focus=false}={}){
  if(!stepOrder.includes(step))return;
  activeStep=step;
  for(const name of stepOrder){$('panel-'+name).hidden=name!==step;$('tab-'+name).setAttribute('aria-selected',String(name===step));$('tab-'+name).tabIndex=name===step?0:-1;}
  if(focus)$('tab-'+step).focus();
  window.scrollTo({top:0,behavior:'instant'});
  updateOverview();
}
function updateOverview(){
  const p=readPrefs(),dirty=savedPrefsSnapshot!==null&&JSON.stringify(p)!==savedPrefsSnapshot;
  const inspectionOnly=$('inspectionOnly').checked;
  $('runMode').value=inspectionOnly?'entry':p.stopAfterCaptcha?'observe':p.autoComplete?'full':'seat';
  $('runMode').disabled=running||localBusy>0||captchaBusy()||manualCaptchaBusy();
  $('nextCard').hidden=running||activeStep==='run';
  if(preflightFingerprint!==null&&preflightFingerprint!==currentPreflightFingerprint())displayPreflight(null,{stale:true});
  const profile=venueProfiles?.profiles?.find(item=>item.id===venueProfiles.activeId);
  $('runVenueSummary').textContent=profile?.name||'기존 공통 설정';
  $('runModeSummary').textContent=inspectionOnly?'진입 확인만 · 좌석 선택 없이 정지':p.stopAfterCaptcha?'보안문자 확인 후 기록·정지':'자동 진행 · 좌석 조건 적용';
  const scopeStart=targetIsSeat()?'현재 좌석 화면':'예매창 진입';
  $('runScope').textContent=inspectionOnly?scopeStart+' → 정지. 좌석 선택과 선택 완료는 실행하지 않습니다.':p.stopAfterCaptcha?scopeStart+' → 보안문자 확인 → 정보 기록 → 정지.':p.autoComplete?scopeStart+' → 좌석 조건 확인·선택 → 성인 수량 선택 → N매 예매하기 → 다음 화면 확인. 결제는 직접 진행합니다.':scopeStart+' → 좌석 조건 확인·선택 → 정지. ‘선택 완료’가 꺼져 있어 다음 화면으로 자동 이동하지 않습니다.';
  $('runScope').dataset.level=inspectionOnly||p.stopAfterCaptcha||!p.autoComplete?'warning':'ok';
  const quantity=Number.isInteger(p.quantity)&&p.quantity>=1&&p.quantity<=4?p.quantity+'석':'좌석 수 확인 필요';
  const seatSummary=[quantity,p.requireTogether?'연석 필수':'떨어진 좌석도 허용',p.excludeObstructed?'시야방해석 제외':'시야방해석 허용'].join(' · ');
  const priority=()=> '통로 거리 → 앞열';
  const conditionSummary=p.tiers.length?p.tiers.map((t,i)=>{
    const areas=t.areas.trim()||'전체 구역',blocks=t.blocks.trim()?'블럭 '+t.blocks.trim():'';
    const rows=t.minRow||t.maxRow?(t.minRow||'1')+'~'+(t.maxRow||'끝')+'열':'열 제한 없음';
    return [(i+1)+'순위 '+(t.name||''),areas,blocks,rows,priority()].filter(Boolean).join(' · ');
  }).join('\n'):'기본 조건 · '+priority(p.priority)+'\n'+(p.areas.trim()?p.areas.trim().split('\n').join(' → '):'전체 구역')+(p.blocks.trim()?' · 블럭 '+p.blocks.trim():'');
  for(const id of ['seatSummary','runSeatSummary'])$(id).textContent=seatSummary;
  for(const id of ['conditionSummary','runConditionSummary'])$(id).textContent=conditionSummary;
  $('saveBadge').textContent=dirty?'변경됨 · 미저장':'저장됨';$('saveBadge').classList.toggle('unsaved',dirty);$('dirtyBadge').hidden=!dirty;
  const profileName=profile?.name||'현재 구장';
  $('saveHint').textContent=dirty?'변경한 조건은 이번 실행에 바로 적용됩니다. ‘'+profileName+'’에 저장하면 다음에도 불러올 수 있습니다.':'‘'+profileName+'’에 저장된 조건입니다. 구장을 바꾸어도 따로 보존됩니다.';
  $('quantityMinus').disabled=running||localBusy>0||captchaBusy()||manualCaptchaBusy()||p.quantity<=1;
  $('quantityPlus').disabled=running||localBusy>0||captchaBusy()||manualCaptchaBusy()||p.quantity>=4;
  const selected=Boolean($('game').value)||targetIsGate()||targetIsSeat();
  $('start').disabled=activeStep==='captcha'||running||localBusy>0||captchaBusy()||manualCaptchaBusy()||browserConnected!==true||!selected;
  $('autoCaptchaSummary').textContent=inspectionOnly?'진입 확인만 모드: 보안문자를 처리하기 전에 멈춥니다.':'보안문자 자동 인식 · 입력 · 확인 항상 사용';
  const rows=[
    [browserConnected===true,browserConnected?'Chrome 연결됨':'Chrome 연결 필요'],
    [Boolean(currentTargetUrl),currentTargetUrl?'대상 탭 지정됨':'대상 예매 탭을 열어 주세요'],
    [selected,targetIsSeat()?'현재 좌석 화면에서 시작 · 다시 진입하지 않습니다':targetIsGate()?'열린 예매 준비 화면 사용':selected?'대상 경기 선택됨':'경기 목록에서 대상 경기를 선택하세요'],
    [true,inspectionOnly?'진입 확인만 실행 · 좌석을 선택하지 않습니다':'자동 진행 실행 · 설정한 좌석 조건을 적용합니다'],
    [!dirty,dirty?'현재 입력한 좌석 조건 사용 · 미저장':'저장한 좌석 조건 사용'],
  ];
  $('readiness').replaceChildren();for(const [ready,text] of rows){const li=document.createElement('li');li.className=ready?'ready':'attention';li.textContent=text;$('readiness').append(li);}
  $('tab-connect').classList.toggle('done',browserConnected===true);$('tab-page').classList.toggle('done',selected);$('tab-prefs').classList.toggle('done',savedPrefsSnapshot!==null&&!dirty);
  let next;
  if(running)next=['진행 중인 Chrome 화면을 확인하세요','보안문자는 자동 인식·입력·확인합니다. 실패하면 새 이미지로 다시 시도합니다.','진행 상태 보기 →','run'];
  else if(captchaBusy())next=['보안문자를 처리하고 있습니다','선택한 탭에서 보안문자만 처리합니다. 아래 테스트 화면에서 상태를 확인하거나 중지하세요.','보안문자 상태 보기 →','captcha'];
  else if(browserConnected!==true)next=['Chrome과 연결해 주세요','처음 한 번 확장을 등록하고 연결 코드를 붙여넣으면 됩니다.','연결 안내 보기 →','connect'];
  else if(activeStep==='captcha')next=['보안문자 자동 인식을 확인하세요','인식 결과를 확인하거나 자동 입력·확인을 테스트할 수 있습니다. 경기 선택은 필요 없습니다.','자동 인식 카드 ↓','captcha'];
  else if(!currentTargetUrl)next=['예매할 페이지를 열어 주세요','포스트시즌 공식 페이지를 열고 현재 판매 일정을 확인하세요.','경기 페이지 열기 →','page'];
  else if(!selected)next=latestPageInfo?.empty?['현재 예매 가능한 상품이 없습니다','공식 페이지의 공지가 바뀌면 경기 목록을 다시 읽어 주세요.','경기 정보 보기 →','page']:['대상 경기를 선택해 주세요','경기 목록을 읽고 실제 예매할 경기를 선택하세요. 준비 화면을 이미 열었다면 그 탭을 지정하세요.','경기 선택하기 →','page'];
  else if(inspectionOnly)next=['좌석을 선택하지 않고 진입만 확인합니다','현재는 테스트용 진입 확인 모드입니다. 좌석을 선택하려면 시작 탭에서 이 모드를 해제하세요.','진입 확인 설정 보기 →','run'];
  else if(targetIsSeat())next=['현재 좌석 화면에서 시작할 수 있습니다','좌석 조건을 확인하고 시작 버튼을 눌러 주세요. 연결만으로 자동 재개하지 않으며 다시 진입 요청을 보내지 않습니다.','좌석 조건과 점검 보기 →','run'];
  else next=['좌석 조건을 확인한 뒤 시작하세요','자동 진행은 현재 입력한 조건을 사용합니다. 실제 로그인과 판매 상태는 Chrome에서 확인하세요.','시작 전 확인 →','run'];
  $('nextLabel').textContent=running?'현재 진행':'지금 할 일';$('nextTitle').textContent=next[0];$('nextHint').textContent=next[1];$('nextAction').textContent=next[2];$('nextAction').dataset.go=next[3];
  $('start').textContent=running?(inspectionOnly?'진입 확인 중':'자동 진행 중'):localBusy||captchaBusy()?'처리 중…':activeStep==='captcha'?'자동 예매는 시작 탭에서':browserConnected!==true?'Chrome 연결 후 시작':!selected?'경기 선택 후 시작':inspectionOnly?(targetIsSeat()?'현재 좌석 화면만 확인':'진입 확인만 시작'):targetIsSeat()?'현재 좌석 화면에서 시작':'자동 진행 시작';$('runDot').classList.toggle('running',running||captchaBusy());
  $('targetHint').textContent=targetIsSeat()?'이미 열린 좌석 화면입니다. 경기 목록을 읽지 않아도 시작 탭에서 직접 시작할 수 있습니다. 연결만으로 자동 진행하지 않습니다.':targetIsGate()?'열린 준비 화면을 그대로 사용합니다. 아래 경기 선택은 필요하지 않습니다.':currentTargetUrl?'이 탭에만 설정과 예매 보조를 적용합니다.':'예매 페이지를 열면 탭 목록에 표시됩니다.';
}
function showVenueProfiles(value,{applyPreferences=false}={}){
  if(!value||!Array.isArray(value.profiles))return;
  const changed=venueProfiles?.activeId!==value.activeId;
  venueProfiles=value;
  const profile=value.profiles.find(item=>item.id===value.activeId);
  $('venueProfile').replaceChildren();
  for(const item of value.profiles)$('venueProfile').append(new Option(item.name,item.id));
  $('venueProfile').value=value.activeId;
  $('venueDescription').textContent=profile?.description||'';
  $('venueWarning').hidden=!value.warning;$('venueWarning').textContent=value.warning||'';
  $('venueReference').hidden=!profile?.reference;
  if(profile?.reference){
    $('venueReferenceSource').textContent=profile.reference.source;
    $('venueReferenceNote').textContent=profile.reference.note;
    const selected=new Set([...$('referenceArea').selectedOptions].map(option=>option.value));
    $('referenceArea').replaceChildren();for(const name of profile.reference.areas){const option=new Option(name,name);option.selected=selected.has(name);$('referenceArea').append(option);}
  }
  if(profile&&(changed||applyPreferences)){showPrefs(profile.preferences);prefInitialized=true;}
  updateOverview();
}
function showPageInfo(info,count=0){
  latestPageInfo=info||null;$('pageReadout').hidden=!info;
  if(!info){updateOverview();return;}
  $('pageReadoutTitle').textContent=String(info.title||'현재 페이지');
  const state=info.empty?'예매 가능한 상품 없음':count?count+'개 경기 정보를 읽었습니다.':Number(info.cardCount)>0?'현재 경기 카드 구조를 확인하지 못했습니다.':'상품 목록을 확인하지 못했습니다. 로딩 후 다시 읽어 주세요.';
  $('pageReadoutStatus').textContent=state;$('gameHint').textContent=state;
  const checked=new Date(info.checkedAt);$('pageReadoutTime').textContent=Number.isFinite(checked.getTime())?'확인: '+checked.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' (한국 시각)':'';
  const notes=[...(Array.isArray(info.notes)?info.notes:[])];
  if(Number.isInteger(info.maxTickets)&&info.maxTickets>0&&!notes.some(note=>/1인|매수|최대.*매/.test(String(note))))notes.push('사이트 안내: 1인 최대 '+info.maxTickets+'매');
  if(info.mobileOnly&&!notes.some(note=>/모바일/.test(String(note))))notes.push('모바일 티켓 안내를 확인하세요.');
  if(info.cardOnly&&!notes.some(note=>/카드/.test(String(note))))notes.push('카드 결제 안내를 확인하세요.');
  $('pageNotes').replaceChildren();for(const note of [...new Set(notes)]){const li=document.createElement('li');li.textContent=String(note);$('pageNotes').append(li);}
  $('seatingGuides').replaceChildren();for(const guide of Array.isArray(info.seatImages)?info.seatImages:[]){const button=document.createElement('button');button.className='wide';button.textContent=String(guide.label||'공식 좌석 안내')+' ↗';button.onclick=()=>exclusive('openSeatingGuide',{url:guide.url});$('seatingGuides').append(button);}
  updateOverview();
}
function lockControls(){
  const busy=running||localBusy>0||captchaBusy()||manualCaptchaBusy();
  for(const id of lockedIds)if($(id))$(id).disabled=busy;
  for(const id of browserIds)$(id).disabled=busy||browserConnected===false;
  for(const id of ['game','games'])$(id).disabled=busy||targetIsGate()||targetIsSeat()||browserConnected===false;
  for(const id of ['openAt','restoreOpening'])$(id).disabled=busy||targetIsSeat()||browserConnected===false;
  $('selectionMethod').disabled=busy;for(const id of ['clock','entryStrategy','entryOffsetMs'])$(id).disabled=busy||targetIsSeat();
  // Manual verification and cancellation remain available during an active run.
  for(const id of ['focus','code','captchaFocus'])$(id).disabled=browserConnected!==true||!currentTargetUrl;
  $('submitCode').disabled=running||localBusy>0||captchaBusy()||manualCaptchaBusy()||browserConnected!==true;
  $('securityCode').disabled=running||captchaBusy()||manualCaptchaBusy();
  $('captchaTarget').disabled=busy||browserConnected!==true;
  for(const id of ['captchaRead','captchaSubmit'])$(id).disabled=busy||browserConnected!==true||!currentTargetUrl||!captchaState.available||!captchaState.ready;
  $('captchaStop').disabled=!captchaBusy();
  $('autoCaptcha').checked=true;$('manualCaptchaAssist').checked=false;
  $('autoCaptcha').disabled=true;$('manualCaptchaAssist').disabled=true;
  const manualUnavailable=running||browserConnected!==true||!currentTargetUrl;
  $('manualCaptchaPrepare').disabled=localBusy>0||captchaBusy()||manualCaptchaBusy()||manualUnavailable;
  $('manualCaptchaFocus').disabled=manualUnavailable||manualCaptchaBusy();
  const manualReady=Boolean(manualCaptchaKey()&&safeManualCaptchaImage(manualCaptchaState.imageDataUrl)&&manualCaptchaState.status==='ready');
  $('manualCaptchaText').disabled=manualUnavailable||captchaBusy()||manualCaptchaBusy()||!manualReady;
  $('manualCaptchaSubmit').disabled=$('manualCaptchaText').disabled||!/^[A-Z]{6}$/.test($('manualCaptchaText').value)||manualCaptchaSubmittedKey===manualCaptchaKey();
  let enabledTiers=0;
  for(const tier of document.querySelectorAll('.tier')){
    const enabled=tierValue(tier,'enabled');enabled.disabled=busy;if(enabled.checked)enabledTiers++;
    for(const field of tier.querySelectorAll('[data-field]'))if(field!==enabled)field.disabled=busy||!enabled.checked;
    tier.classList.toggle('tier-off',!enabled.checked);
  }
  for(const id of ['areas','blocks','priority'])$(id).disabled=busy||enabledTiers>0;
  $('legacyPrefs').classList.toggle('legacy-off',enabledTiers>0);
  $('tierMode').textContent=enabledTiers?'사용한 조건 묶음을 위에서부터 적용합니다. 같은 묶음 안의 구역·블럭은 동등한 허용 범위입니다.':'조건 묶음을 사용하지 않으면 아래의 기본 허용 구역·블록를 적용합니다.';
  for(const button of $('seats').querySelectorAll('button'))button.disabled=busy||browserConnected===false;
  for(const button of $('seatingGuides').querySelectorAll('button'))button.disabled=busy;
  const previousReferenceTarget=$('referenceTarget').value;
  $('referenceTarget').replaceChildren();
  if(!enabledTiers)$('referenceTarget').append(new Option('기본 구역 목록','base'));
  [...$('tiers').children].forEach((node,index)=>{if(tierValue(node,'enabled').checked)$('referenceTarget').append(new Option((index+1)+'순위 · '+tierValue(node,'name').value,String(index)));});
  if([...$('referenceTarget').options].some(option=>option.value===previousReferenceTarget))$('referenceTarget').value=previousReferenceTarget;
  const oldTarget=$('catalogTarget').value;$('catalogTarget').replaceChildren();
  if(!enabledTiers)$('catalogTarget').append(new Option('기본 구역·블록 목록','base'));
  [...$('tiers').children].forEach((node,index)=>{if(tierValue(node,'enabled').checked)$('catalogTarget').append(new Option((index+1)+'순위 · '+tierValue(node,'name').value,String(index)));});
  if([...$('catalogTarget').options].some(o=>o.value===oldTarget))$('catalogTarget').value=oldTarget;
  updateOverview();
}
function addTier(tier={},enabled=false){
  const index=$('tiers').children.length,node=document.createElement('fieldset');node.className='tier';
  const legend=document.createElement('legend');legend.textContent=(index+1)+'순위 조건 묶음';node.append(legend);
  const field=(name,label,type,value,options)=>{
    const wrapper=document.createElement('label');wrapper.htmlFor='tier-'+index+'-'+name;
    const caption=document.createElement('span');caption.textContent=label;wrapper.append(caption);
    const control=document.createElement(type==='select'?'select':'input');control.id=wrapper.htmlFor;control.dataset.field=name;
    if(type==='select')for(const [value,text] of options)control.append(new Option(text,value));
    else {control.type=type;if(type==='number'){control.min='1';control.max='9999';control.placeholder='제한 없음';}}
    if(type==='checkbox'){control.checked=Boolean(value);wrapper.className='check';wrapper.prepend(control);}else{control.value=value??'';wrapper.append(control);}
    node.append(wrapper);return control;
  };
  field('enabled','이 조건 묶음 사용','checkbox',enabled).onchange=lockControls;
  field('name','묶음 이름','text',tier.name||((index+1)+'순위'));
  field('areas','허용 구역 (쉼표로 구분)','text',(tier.areas||[]).join(', ')).placeholder='빈칸: 전체 구역';
  field('blocks','허용 블럭 (쉼표로 구분)','text',(tier.blocks||[]).join(', ')).placeholder='예: 118, 117 · 빈칸: 전체';
  const min=field('minRow','시작 열','number',tier.minRow),max=field('maxRow','마지막 열','number',tier.maxRow),range=document.createElement('div');range.className='row-range';range.append(min.parentElement,max.parentElement);node.append(range);
  const hint=document.createElement('p');hint.textContent='통로 거리 → 앞열 순으로 고릅니다. 통로석이 없어도 가까운 좌석을 계속 찾습니다.';node.append(hint);
  $('tiers').append(node);lockControls();
}
function readPrefs(){
  const tiers=[...$('tiers').children].filter(node=>tierValue(node,'enabled').checked).map(node=>Object.fromEntries(['name','areas','blocks','minRow','maxRow'].map(name=>[name,tierValue(node,name).value])));
  return {quantity:Number($('quantity').value),priority:'aisle',areas:$('areas').value,blocks:$('blocks').value,tiers,requireTogether:$('together').checked,excludeObstructed:$('obstructed').checked,autoComplete:$('autoComplete').checked,autoNotice:$('notice').checked,manualCaptchaAssist:false,autoCaptcha:true,stopAfterCaptcha:$('stopAfterCaptcha').checked,selectionMethod:$('selectionMethod').value,excludeRestricted:$('excludeRestricted').checked};
}
function showPrefs(p){
  $('quantity').value=p.quantity;$('priority').value='aisle';$('areas').value=p.areas.join('\n');$('blocks').value=p.blocks.join(', ');$('together').checked=p.requireTogether;$('obstructed').checked=p.excludeObstructed;$('autoComplete').checked=p.autoComplete;$('notice').checked=p.autoNotice;
  $('stopAfterCaptcha').checked=p.stopAfterCaptcha===true;
  $('excludeRestricted').checked=p.excludeRestricted!==false;$('selectionMethod').value=p.selectionMethod||'click';
  $('manualCaptchaAssist').checked=false;
  $('autoCaptcha').checked=true;
  $('tiers').replaceChildren();for(let i=0;i<Math.max(3,p.tiers?.length||0);i++)addTier(p.tiers?.[i]||{},!!p.tiers?.[i]);savedPrefsSnapshot=JSON.stringify(readPrefs());lockControls();
}
function message(text){if(text)$('status').textContent=text;}
function manualCaptchaMessage(text,error=false){$('manualCaptchaStatus').textContent=text;$('manualCaptchaStatus').dataset.error=String(error);}
function showManualCaptchaMode(){const ready=manualCaptchaKey()&&safeManualCaptchaImage(manualCaptchaState.imageDataUrl);$('manualCaptchaMode').textContent=manualCaptchaBusy()?'처리 중':manualCaptchaState.status==='submitted'?'확인 전달됨':manualCaptchaState.status==='verified'?'확인 완료':manualCaptchaState.status==='manual'?'Chrome 입력 확인':ready?'직접 입력 대기':'입력 준비 전';}
function showManualCaptcha(value){
  const previousKey=manualCaptchaKey(),previousImage=manualCaptchaState.imageDataUrl;
  if(value&&typeof value==='object')manualCaptchaState={present:false,supported:false,status:'idle',challengeId:null,imageDataUrl:null,existingText:'',message:'이미지 보기·입력 준비를 눌러 주세요.',targetId:null,busy:false,...value};
  const key=manualCaptchaKey(),preview=key?safeManualCaptchaImage(manualCaptchaState.imageDataUrl):'';
  const changed=previousKey!==key||previousImage!==manualCaptchaState.imageDataUrl;
  if(changed||!key){$('manualCaptchaText').value='';manualCaptchaSubmittedKey=null;}
  if(changed&&key&&typeof manualCaptchaState.existingText==='string')$('manualCaptchaText').value=manualCaptchaState.existingText.toUpperCase().replace(/[^A-Z]/g,'').slice(0,6);
  $('manualCaptchaPreview').hidden=!preview;if(preview)$('manualCaptchaPreview').src=preview;else $('manualCaptchaPreview').removeAttribute('src');
  $('manualCaptchaImageHint').hidden=Boolean(preview);
  showManualCaptchaMode();
  manualCaptchaMessage(manualCaptchaState.message||'이미지를 보고 영문 6자리를 직접 입력해 주세요.');
  if(key&&preview&&key!==manualCaptchaShownKey){manualCaptchaShownKey=key;showStep('captcha');}
  if(!key)manualCaptchaShownKey=null;
}
function showCaptchaStatus(value){
  if(value&&typeof value==='object')captchaState={...captchaState,...value};
  const busy=captchaBusy();
  $('captchaStatus').textContent=captchaState.message||(!captchaState.available?'인식 프로그램을 사용할 수 없습니다.':!captchaState.ready?'인식 모델을 준비하고 있습니다.':'보안문자가 있는 탭을 선택하고 테스트하세요.');
  $('captchaMode').textContent=busy?(captchaState.mode==='auto'?'자동 진행 중':captchaState.mode==='submit'?'입력·확인 중':'읽는 중'):!captchaState.available?'사용 불가':captchaState.errorCode?'인식 실패':!captchaState.ready?'준비 중':captchaState.text?'처리 결과':'준비됨';
  $('captchaText').textContent=captchaState.text||'—';
  const score=captchaState.confidence;
  $('captchaConfidence').textContent=typeof score==='number'&&Number.isFinite(score)?'모델 점수 '+(Math.min(1,Math.max(0,score))*100).toFixed(1)+'% · 정답률을 뜻하지 않습니다.':'';
  const preview=typeof captchaState.previewDataUrl==='string'&&captchaState.previewDataUrl.length<=3*1024*1024&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(captchaState.previewDataUrl)?captchaState.previewDataUrl:'';
  $('captchaPreview').hidden=!preview;if(preview)$('captchaPreview').src=preview;else $('captchaPreview').removeAttribute('src');
  $('captchaTargetHint').textContent=running?'자동 진행 중에는 별도 보안문자 테스트와 탭 변경이 잠깁니다.':busy?'보안문자 작업 중에는 대상 탭이 고정됩니다.':currentTargetUrl?'경기 탭과 같은 대상을 사용합니다. 이 테스트는 경기 선택 없이 실행할 수 있습니다.':'Chrome에서 보안문자가 있는 콘서트·스포츠 예매창을 열어 주세요.';
}
function showPairing(info){
  if(!info)return;
  if(Object.hasOwn(info,'pairCode'))$('pairingCode').value=info.pairCode||'';
  if(!$('pairingCode').value){clearTimeout(pairingExpiryTimer);if(browserConnected)$('pairingHint').textContent='Chrome이 연결되어 있습니다. 다시 연결해야 할 때 새 코드를 만드세요.';}
  $('copyPairing').disabled=!$('pairingCode').value;
  if(info.paired&&!info.pairCode)$('pairingHint').textContent='연결 정보가 저장되어 있습니다. 다른 Chrome으로 바꿀 때만 새 연결 코드를 만드세요.';
  if(info.expiresAt&&info.pairCode){
    const expiry=new Date(info.expiresAt);clearTimeout(pairingExpiryTimer);
    const refresh=()=>{const valid=expiry>new Date();$('copyPairing').disabled=!valid||!$('pairingCode').value;$('pairingHint').textContent=(valid?'연결 코드 유효 시각: '+expiry.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'연결 코드가 만료되었습니다. 새 코드를 만들어 주세요.')+' · 다른 사람에게 공유하지 마세요.';};
    refresh();if(expiry>new Date())pairingExpiryTimer=setTimeout(refresh,Math.min(2147483647,expiry-Date.now()+20));
  }
}
function showBrowserStatus(info){
  if(!info)return;
  const wasConnected=browserConnected;browserConnected=Boolean(info.connected);
  $('browserBadge').textContent=browserConnected?'연결됨':'연결 전';
  $('browserBadge').classList.toggle('connected',browserConnected);
  $('browserStatus').textContent=info.message||(browserConnected?'Chrome에서 예매하세요. 이 패널의 설정을 연결된 탭에 적용합니다.':info.paired?'이전에 연결한 Chrome을 기다립니다. 앱과 Chrome을 켜 두면 자동으로 다시 연결합니다.':'Chrome 확장을 열고 최초 연결 코드를 입력해 주세요.');
  if(browserConnected&&wasConnected!==true){$('connectionHelp').open=false;if(activeStep==='connect')showStep('page');}
  showPairing(info);
}
function showClock(c){
  if(!c||!Number.isFinite(c.offsetMs)||!Number.isFinite(c.uncertaintyMs))return;
  const difference=Math.abs(c.offsetMs)/1000;
  const direction=difference<.0005?'PC와 거의 같음':'PC보다 '+difference.toFixed(3)+'초 '+(c.offsetMs>=0?'빠름':'느림');
  $('clockInfo').textContent=(c.source==='ticket-server'?'예매 서버: ':'웹 응답 시계(대체): ')+direction+' · 오차 약 ±'+(c.uncertaintyMs/1000).toFixed(3)+'초';
  const measured=Number.isFinite(c.measuredAt)?new Date(c.measuredAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Seoul'})+' 측정. ':'';
  $('clockHint').textContent=measured+(c.source==='ticket-server'?'사이트 시계를 읽은 당시의 차이입니다. 시험 방식은 예매 시작이 가까워지면 다시 확인합니다.':'예매 서버 시계를 읽지 못해 일반 웹 응답으로 추정했습니다. 이 값으로 정시 클릭을 예약하지 않습니다.');
}
const clockOutcomeLabel=value=>({'not-configured':'사용 안 함','waiting-sync':'시각 확인 중','armed':'예약됨','not-ready':'예정 시각에 준비되지 않음 · 활성화 감지 유지','stale':'시각 정보 만료 · 활성화 감지로 진행','clicked':'함수 실행','fallback':'기본 활성화 감지로 진행'}[value]||'미확인');
function showEntryMode(){
  if(targetIsSeat()){$('entryMode').textContent='이미 열린 좌석 화면에서 시작합니다. 시작 버튼을 누르면 현재 화면과 선택 상태부터 확인하며 예매 진입 요청이나 오픈 시각 예약은 실행하지 않습니다.';return;}
  if(running&&currentEntry){
    $('entryMode').textContent=currentEntry.strategy==='clock'?'이번 작업: 서버 시각 + 활성화 감지. '+(currentEntry.clockReason||'사이트 활성화 후 진입 함수를 실행합니다.'):'이번 작업: 사이트 활성화 감지. 사이트가 예매 버튼을 활성화하면 진입 함수를 실행합니다.';
    return;
  }
  $('entryMode').textContent=targetIsGate()?'현재 준비 화면에서 시작합니다. 공식 시각으로 되돌리기로 포스트시즌 시작 시각을 읽거나 예약 시각을 직접 입력하세요.':$('entryStrategy').value==='clock'?'보정한 예약 시각과 사이트 활성화를 모두 확인하여 진입합니다. 요청이 발생하지 않은 경우만 다시 확인하며, 느린 응답에는 중복 전송하지 않습니다.':'로그인 후 예매 준비 화면에 미리 들어가고, 예매 버튼이 활성화되면 진입 함수를 한 번 실행합니다.';
}
function currentPreflightFingerprint(){
  return JSON.stringify({preferences:readPrefs(),inspectionOnly:$('inspectionOnly').checked,connected:browserConnected,target:currentTargetId,url:currentTargetUrl,game:$('game').value,openAt:$('openAt').value,strategy:$('entryStrategy').value,offset:$('entryOffsetMs').value});
}
function displayPreflight(result,{stale=false}={}){
  const checks=Array.isArray(result?.checks)?result.checks:[];
  preflightFingerprint=result?currentPreflightFingerprint():null;
  $('preflightSummary').textContent=result?(result.message||(result.canStart?'점검 완료 · 아래 확인 사항을 읽어 주세요.':'진행 전 조치가 필요합니다.')):stale?'조건이나 대상이 바뀌었습니다. 실행 전 점검을 다시 눌러 주세요.':'현재 연결·설정·화면을 읽어 진행 가능 여부를 확인합니다.';
  $('preflightResult').dataset.level=result?(!result.canStart?'error':checks.some(item=>item.level==='warning')?'warning':'ok'):stale?'warning':'idle';
  $('preflightChecks').replaceChildren();
  for(const item of checks){
    const li=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('p');
    li.dataset.level=['ok','warning','error'].includes(item.level)?item.level:'warning';
    title.textContent=({'ok':'확인','warning':'확인 필요','error':'조치 필요'}[li.dataset.level])+': '+String(item.title||item.id||'점검 항목');
    detail.textContent=String(item.detail||'');li.append(title,detail);$('preflightChecks').append(li);
  }
}
const metricDuration=ms=>Number.isFinite(ms)&&ms>=0?(ms/1000).toFixed(2)+'초':'—';
const metricActionLabel=value=>({'observer-connect':'응답 관찰 연결','response-status':'응답 상태 확인','screen-read':'화면 상태 읽기','seat-read':'좌석 정보 읽기','seat-details':'좌석 상세·등급 조회','screen-action':'화면 동작 전달','cleanup':'진행 종료·정리','page-command':'페이지 명령 처리','seat-select':'좌석 선택 전달','candidate-rank':'좌석 조건 계산','grade-open':'구역 열기'}[value]||String(value||'처리'));
function showRunDiagnostics(record,{live=false}={}){
  const diagnosis=record?.diagnosis,metrics=record?.metrics;
  $('runDiagnosis').hidden=!diagnosis;
  $('diagnosisMode').textContent=live?'현재 진행 상태':'마지막 실행 결과';
  $('runDiagnosis').dataset.level=diagnosis?.level==='success'?'ok':['ok','info','warning','error'].includes(diagnosis?.level)?diagnosis.level:'info';
  $('diagnosisTitle').textContent=String(diagnosis?.title||'');
  $('diagnosisDetail').textContent=String(diagnosis?.detail||'');
  $('diagnosisNext').textContent=diagnosis?.nextAction?'다음 행동: '+String(diagnosis.nextAction):'';
  $('runMetrics').hidden=!metrics;
  $('metricsMode').textContent=live?'진행 중 · 현재까지의 시간':'종료된 작업 · 시간 분석';
  $('metricsElapsed').textContent='전체 경과 '+metricDuration(metrics?.elapsedMs)+' · 처리 중 '+(Number.isInteger(metrics?.pendingCount)&&metrics.pendingCount>=0?metrics.pendingCount:0)+'건';
  const phases=$('phaseMetrics').querySelector('tbody'),operations=$('operationMetrics').querySelector('tbody');phases.replaceChildren();operations.replaceChildren();
  for(const item of Array.isArray(metrics?.phases)?metrics.phases:[]){
    const row=document.createElement('tr'),label=document.createElement('td'),duration=document.createElement('td');label.textContent=String(item.label||item.code||'단계');duration.textContent=metricDuration(item.durationMs);row.append(label,duration);phases.append(row);
  }
  for(const item of Array.isArray(metrics?.operations)?metrics.operations:[]){
    const row=document.createElement('tr'),action=document.createElement('td'),count=document.createElement('td'),time=document.createElement('td');
    const nonnegative=value=>Number.isInteger(value)&&value>=0?value:0;
    action.textContent=metricActionLabel(item.action);count.textContent=nonnegative(item.count)+'건 / 실패 '+nonnegative(item.failed)+'건';time.textContent='누적 '+metricDuration(item.totalMs)+'\n최대 '+metricDuration(item.maxMs)+' · 최근 '+metricDuration(item.lastMs);row.append(action,count,time);operations.append(row);
  }
  $('phaseMetricsEmpty').hidden=phases.children.length>0;$('operationMetricsEmpty').hidden=operations.children.length>0;
}
function showLastRun(record){
  if(!record||record.id===lastRunId)return;lastRunId=record.id;lastRunRecord=record;
  const duration=ms=>Number.isFinite(ms)?(ms/1000).toFixed(2)+'초':'—';
  $('lastRunSummary').textContent='작업 소요 '+duration(record.durationMs)+' · '+(record.message||'작업 종료');
  const entry=record.entry;
  if(entry){
    const trigger={'server-clock':'서버 시각 예약','activation':'사이트 활성화 감지'}[entry.trigger]||'없음';
    const outcome=clockOutcomeLabel(entry.clockOutcome);
    const count=n=>Number.isInteger(n)&&n>=0?n:0;
    const lines=['진입 방식: '+(entry.strategy==='current-seat'?'열린 좌석 화면에서 시작 · 새 진입 요청 없음':entry.strategy==='clock'?'서버 시각 + 활성화 감지':'사이트 활성화 감지'),'진입 실행 계기: '+trigger,'서버 시각 예약: '+outcome];
    if(entry.clockReason)lines.push(String(entry.clockReason));
    if(Number.isFinite(entry.clockUncertaintyMs))lines.push('시각 추정 불확실성: 약 ±'+Math.ceil(entry.clockUncertaintyMs)+'ms');
    lines.push('진입 요청 관찰 '+count(entry.requestCount)+'건 · 응답 수신 완료 '+count(entry.receivedCount)+'건 · 전송 실패 '+count(entry.failedCount)+'건');
    if(entry.observerLost)lines.push('진입 요청 관찰 연결 끊김 · 요청 수는 불완전할 수 있음');
    if(Number.isFinite(entry.lastRequestDurationMs))lines.push('마지막 요청 수신 완료까지 '+duration(entry.lastRequestDurationMs));
    lines.push('좌석 페이지 경로: '+(entry.seatPageObserved?'확인':'미확인'),'응답 수신 완료는 예매 접수 승인이나 좌석 확보를 뜻하지 않습니다.');
    $('entryResult').textContent=lines.join(' · ');
  }else $('entryResult').textContent='';
  const body=$('runTimeline').querySelector('tbody');body.replaceChildren();
  for(const item of record.stages||[]){const row=document.createElement('tr'),stage=document.createElement('td'),elapsed=document.createElement('td');stage.textContent=item.stage;elapsed.textContent=duration(item.elapsedMs);row.append(stage,elapsed);body.append(row);}
}
async function run(action,payload){
  try{const result=await window.helper.run(action,payload);if(result.captchaStatus)showCaptchaStatus(result.captchaStatus);if(result.manualCaptcha)showManualCaptcha(result.manualCaptcha);if(result.error)throw new Error(result.error);message(result.message);return result;}
  catch(e){message(e.message);return null;}
}
async function exclusive(action,payload){
  if(running||localBusy||captchaBusy()||manualCaptchaBusy()){message('진행 중인 작업이 끝나거나 중지된 뒤 실행해 주세요.');return null;}
  localBusy++;lockControls();try{return await run(action,payload);}finally{localBusy--;lockControls();}
}
async function runCaptcha(action){
  if(running||localBusy||captchaBusy()||manualCaptchaBusy()){message('진행 중인 작업이 끝나거나 중지된 뒤 보안문자를 테스트해 주세요.');return;}
  if(browserConnected!==true||!currentTargetUrl||!captchaState.available||!captchaState.ready){message('Chrome 대상 탭과 인식 프로그램 준비 상태를 확인해 주세요.');return;}
  captchaPending=true;showCaptchaStatus({errorCode:null,text:'',confidence:null,previewDataUrl:'',message:action==='captchaRead'?'현재 보안문자를 읽고 있습니다.':'현재 보안문자를 읽고 입력·확인합니다.',mode:action==='captchaRead'?'read':'submit'});lockControls();
  try{const result=await run(action);if(!result)showCaptchaStatus({message:$('status').textContent});}finally{captchaPending=false;showCaptchaStatus();lockControls();}
}
async function prepareManualCaptcha(){
  if(localBusy||captchaBusy()||manualCaptchaBusy()||browserConnected!==true||!currentTargetUrl)return;
  manualCaptchaPending=true;manualCaptchaMessage('현재 탭의 보안문자 이미지와 입력칸을 확인합니다.');$('manualCaptchaMode').textContent='처리 중';lockControls();
  try{const result=await run('manualCaptchaPrepare');if(!result)manualCaptchaMessage($('status').textContent,true);}
  finally{manualCaptchaPending=false;showManualCaptchaMode();lockControls();}
}
async function submitManualCaptcha(){
  if(localBusy||captchaBusy()||manualCaptchaBusy())return;
  const text=$('manualCaptchaText').value.toUpperCase(),key=manualCaptchaKey();$('manualCaptchaText').value=text;
  if(!/^[A-Z]{6}$/.test(text)){manualCaptchaMessage('이미지에 보이는 영문 6자리를 입력해 주세요.',true);lockControls();return;}
  if(browserConnected!==true||!currentTargetUrl||!key||!safeManualCaptchaImage(manualCaptchaState.imageDataUrl)){manualCaptchaMessage('이미지가 바뀌었거나 준비되지 않았습니다. 입력 준비를 다시 눌러 주세요.',true);return;}
  if(manualCaptchaSubmittedKey===key){manualCaptchaMessage('이 이미지에는 이미 확인을 전달했습니다. Chrome의 결과를 확인해 주세요.');return;}
  if(manualCaptchaState.status!=='ready'){manualCaptchaMessage(manualCaptchaState.message||'현재 Chrome 입력 상태를 확인하고 입력 준비를 다시 눌러 주세요.');return;}
  manualCaptchaSubmittedKey=key;manualCaptchaPending=true;manualCaptchaMessage('작성한 문자를 한 번 전달하고 확인합니다.');$('manualCaptchaMode').textContent='처리 중';lockControls();
  try{const result=await run('manualCaptchaSubmit',{challengeId:manualCaptchaState.challengeId,text});if(!result)manualCaptchaMessage($('status').textContent,true);}
  finally{manualCaptchaPending=false;showManualCaptchaMode();lockControls();}
}
function clear(){seats=[];render();$('summary').textContent='좌석 화면을 다시 확인해 주세요.';}
function render(){
  $('seats').replaceChildren();const q=$('filter').value.trim().toLowerCase();
  const matching=seats.filter(s=>s.label.toLowerCase().includes(q));
  if(!matching.length){const div=document.createElement('div');div.className='empty';div.textContent=seats.length?'검색 결과가 없습니다.':'확인된 좌석이 없습니다.';$('seats').append(div);return;}
  // Rendering is bounded; matching and recommendation continue to use the full pool.
  if(matching.length>400){const note=document.createElement('div');note.className='empty';note.textContent=matching.length+'개 중 400개 표시 · 검색과 자동 추천은 전체 대상';$('seats').append(note);}
  for(const s of matching.slice(0,400)){
    const div=document.createElement('div');div.className='seat';const label=document.createElement('span');label.textContent=s.label;div.append(label);
    for(const [action,text] of [['focus','위치'],['click',s.kind==='grade'?'열기':'선택']]){
      const button=document.createElement('button');button.textContent=text;button.setAttribute('aria-label',s.label+' '+text);
      button.onclick=async()=>{const result=await exclusive('seat',{key:s.key,action});if(action==='click'||!result)clear();};div.append(button);
    }
    $('seats').append(div);
  }
  lockControls();
}
for(const [id,action,payload] of [['demo','demo'],['minus','zoom',-.1],['reset','zoom',0],['plus','zoom',.1]])$(id).onclick=()=>exclusive(action,payload);
for(const step of stepOrder){
  $('tab-'+step).onclick=()=>showStep(step);
  $('tab-'+step).onkeydown=e=>{const visible=stepOrder.filter(name=>!$('tab-'+name).hidden);let index=visible.indexOf(step);if(e.key==='ArrowRight')index=(index+1)%visible.length;else if(e.key==='ArrowLeft')index=(index+visible.length-1)%visible.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=visible.length-1;else return;e.preventDefault();showStep(visible[index],{focus:true});};
}
for(const button of document.querySelectorAll('[data-go]'))button.onclick=()=>showStep(button.dataset.go);
$('nextAction').onclick=()=>showStep($('nextAction').dataset.go);
$('panel-prefs').addEventListener('input',updateOverview);
$('panel-prefs').addEventListener('change',updateOverview);
for(const [id,delta] of [['quantityMinus',-1],['quantityPlus',1]])$(id).onclick=()=>{$('quantity').value=Math.min(4,Math.max(1,(Number($('quantity').value)||1)+delta));updateOverview();};
$('restoreWindow').onclick=()=>run('restoreWindow');
$('alwaysOnTop').onchange=async()=>{const result=await run('alwaysOnTop',$('alwaysOnTop').checked);if(result?.desktop)$('alwaysOnTop').checked=result.desktop.alwaysOnTop;};
$('postseason').onclick=async()=>{const result=await exclusive('postseason');if(result)$('pageUrl').value=POSTSEASON_URL;};
$('home').onclick=()=>exclusive('home',{url:$('pageUrl').value.trim()});
$('testBears').onclick=async()=>{const url='https://nol.yanolja.com/ticket/genre/sports/bears';const result=await exclusive('home',{url});if(result)$('pageUrl').value=url;};
$('extensionFolder').onclick=()=>run('openExtensionFolder');
$('updateExtension').onclick=()=>run('updateExtension');
$('copyPairing').onclick=()=>run('copyPairCode');
$('refreshPairing').onclick=async()=>{const result=await exclusive('refreshPairing');if(result)showPairing(result);};
for(const id of ['focus','code','captchaFocus'])$(id).onclick=()=>run('focus');
$('target').onchange=()=>exclusive('target',$('target').value);
$('captchaTarget').onchange=()=>exclusive('target',$('captchaTarget').value);
$('captchaRead').onclick=()=>runCaptcha('captchaRead');
$('captchaSubmit').onclick=()=>runCaptcha('captchaSubmit');
$('captchaStop').onclick=()=>run('captchaStop');
$('manualCaptchaPrepare').onclick=prepareManualCaptcha;
$('manualCaptchaSubmit').onclick=submitManualCaptcha;
$('manualCaptchaFocus').onclick=()=>run('manualCaptchaFocus');
$('manualCaptchaText').oninput=()=>{const input=$('manualCaptchaText'),start=input.selectionStart,end=input.selectionEnd;input.value=input.value.toUpperCase();if(start!==null)input.setSelectionRange(start,end);manualCaptchaMessage(/[^A-Z]/.test(input.value)?'영문만 입력해 주세요.':'이미지를 확인한 뒤 Enter 또는 입력·확인을 눌러 주세요.',/[^A-Z]/.test(input.value));lockControls();};
$('manualCaptchaText').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&!e.repeat){e.preventDefault();return submitManualCaptcha();}};
$('manualCaptchaAssist').onchange=()=>{lockControls();updateOverview();};
$('autoCaptcha').onchange=()=>{lockControls();updateOverview();};
$('filter').oninput=render;
$('scan').onclick=async()=>{const result=await exclusive('scan');if(result){seats=result.seats;$('summary').textContent=result.message;render();}else clear();};
let lastRevision=-1;
window.helper.onState(state=>{
  if(typeof state.appVersion==='string'&&/^\d+\.\d+\.\d+$/.test(state.appVersion)){
    document.title='야구 티켓팅 도우미 v'+state.appVersion;
    $('appVersion').textContent='v'+state.appVersion+' · 예매는 Chrome에서';
  }
  const wasRunning=running;running=Boolean(state.running);currentEntry=state.entry||null;message(state.message);
  if(state.desktop&&typeof state.desktop.alwaysOnTop==='boolean')$('alwaysOnTop').checked=state.desktop.alwaysOnTop;
  if(running&&!wasRunning)showStep('run');
  if(running&&/보안문자|보안 코드/.test(state.runStatus||''))$('securityDetails').open=true;
  $('quickStop').hidden=true;
  showBrowserStatus(state.browserStatus);
  if(!pageUrlInitialized&&state.pageUrl){$('pageUrl').value=state.pageUrl;pageUrlInitialized=true;}
  if(state.revision!==lastRevision){lastRevision=state.revision;clear();currentCatalog=null;renderCatalog();}
  const windows=state.windows||[];
  for(const id of ['target','captchaTarget']){$(id).replaceChildren();for(const w of windows)$(id).append(new Option(w.title,w.id));if(!windows.length)$(id).append(new Option('연결된 예매 탭 없음',''));}
  const nextTargetUrl=windows.find(w=>String(w.id)===String(state.target))?.url||'';
  const manualTargetChanged=nextTargetUrl!==currentTargetUrl||String(state.target)!==String(currentTargetId)||state.browserStatus?.connected===false;
  if(manualTargetChanged)showManualCaptcha({present:false,supported:false,message:'대상 탭이 바뀌었습니다. 입력 준비를 다시 눌러 주세요.'});
  if(currentTargetUrl&&(nextTargetUrl!==currentTargetUrl||String(state.target)!==String(currentTargetId))&&!running){gameRows=[];$('game').replaceChildren(new Option('목록을 읽고 경기를 선택하세요',''));$('official').textContent='경기를 선택하면 확인합니다.';$('openAt').value='';showPageInfo(null);$('gameHint').textContent='탭이 바뀌었습니다. 경기 목록을 다시 읽어 주세요.';}
  if(manualTargetChanged){currentCatalog=null;renderCatalog();}
  currentTargetUrl=nextTargetUrl;currentTargetId=state.target;
  if(targetIsSeat()){$('official').textContent='이미 좌석 화면에 진입했습니다. 오픈 시각 예약은 사용하지 않습니다.';$('gameHint').textContent='현재 좌석 화면을 사용하므로 경기 목록 선택은 필요하지 않습니다.';}
  $('captchaTarget').value=state.target;showCaptchaStatus(state.captchaStatus);
  if(state.browserStatus?.connected!==false&&state.manualCaptcha)showManualCaptcha(state.manualCaptcha);
  showEntryMode();
  $('target').value=state.target;if(!prefInitialized&&state.preferences){showPrefs(state.preferences);prefInitialized=true;}
  showVenueProfiles(state.venueProfiles);
  $('runStatus').textContent=state.running?'자동 진행 중':'자동 진행 대기';
  if(running&&currentEntry?.strategy==='clock')$('runStatus').textContent+=' · 시각 예약: '+clockOutcomeLabel(currentEntry.clockOutcome)+(currentEntry.clockReason?' · '+currentEntry.clockReason:'');
  showClock(state.clockInfo);
  showLastRun(state.lastRun);
  if(Object.hasOwn(state,'preflight')){const fingerprint=JSON.stringify(state.preflight);if(fingerprint!==lastPreflightState){lastPreflightState=fingerprint;displayPreflight(state.preflight);}}
  showRunDiagnostics(running?state.runDiagnostics:lastRunRecord,{live:running});
  lockControls();
});
$('save').onclick=async()=>{const r=await exclusive('preferences',readPrefs());if(r){if(r.venueProfiles)showVenueProfiles(r.venueProfiles);showPrefs(r.preferences);}};
$('venueProfile').onchange=async()=>{
  const id=$('venueProfile').value,r=await exclusive('venueSelect',{id,preferences:readPrefs()});
  if(r?.venueProfiles)showVenueProfiles(r.venueProfiles,{applyPreferences:true});
  else if(venueProfiles)$('venueProfile').value=venueProfiles.activeId;
};
$('createVenue').onclick=async()=>{
  const name=$('venueName').value.trim();if(!name){message('새 구장 설정의 이름을 입력해 주세요.');$('venueName').focus();return;}
  const r=await exclusive('venueCreate',{name,preferences:readPrefs()});
  if(r?.venueProfiles){$('venueName').value='';showVenueProfiles(r.venueProfiles,{applyPreferences:true});}
};
$('addReferenceAreas').onclick=()=>{
  const names=[...$('referenceArea').selectedOptions].map(option=>option.value);
  if(!names.length){message('참고 목록에서 추가할 구역을 선택해 주세요.');return;}
  const target=$('referenceTarget').value==='base'?$('areas'):tierValue($('tiers').children[Number($('referenceTarget').value)],'areas');
  if(!target)return;
  const separator=target===$('areas')?'\n':', ';
  target.value=[...new Set([...target.value.split(/[\n,]/).map(value=>value.trim()).filter(Boolean),...names])].join(separator);
  updateOverview();message('선택한 과거 구역명을 추가했습니다. 현재 경기의 이름·판매 단위를 확인한 뒤 저장하세요.');
};
$('addTier').onclick=()=>addTier({},true);
$('games').onclick=async()=>{const r=await exclusive('games');if(!r)return;gameRows=r.games||[];$('game').replaceChildren(new Option(gameRows.length?'대상 경기 선택':'읽어 온 경기 없음',''));for(const g of gameRows)$('game').append(new Option(g.label,g.key));$('game').onchange();showPageInfo(r.pageInfo,gameRows.length);if(!r.pageInfo)$('gameHint').textContent=gameRows.length?gameRows.length+'개 경기 중 대상을 선택하세요.':'읽어 온 경기가 없습니다. 사이트의 현재 판매 상태를 확인하세요.';};
function showOpening(g,{fill=true}={}){
  const format=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const now=Date.now(),hasTime=Number.isFinite(g?.openAt);
  const saleStatus=g?.endAt!=null&&now>g.endAt?'판매 종료':hasTime&&now>=g.openAt?'예매 시작 시각 경과':hasTime?'예매 시작 전':g?.buttonText==='예매하기'?'현재 예매하기 표시':'판매 상태 미확인';
  $('official').textContent=g?hasTime?format(g.openAt)+' (한국 시각) · '+saleStatus+' · 출처: '+(g.openingSource||'경기 카드 공지'):saleStatus+' · '+(g.openingReason||'공지된 일반 예매 시작 시각을 확인하지 못했습니다.'):'경기를 선택하면 확인합니다.';
  if(fill)$('openAt').value=hasTime?new Date(g.openAt+9*3600000).toISOString().slice(0,19):'';
  updateOverview();
}
$('game').onchange=()=>showOpening(gameRows.find(g=>g.key===$('game').value));
$('restoreOpening').onclick=async()=>{if(targetIsGate()){const r=await exclusive('gateOpening');if(r?.opening)showOpening(r.opening);}else showOpening(gameRows.find(g=>g.key===$('game').value));};
$('clock').onclick=()=>exclusive('clock');
$('entryStrategy').onchange=showEntryMode;
$('excludeRestricted').onchange=updateOverview;$('selectionMethod').onchange=updateOverview;
$('inspectionOnly').onchange=()=>{if($('inspectionOnly').checked)$('stopAfterCaptcha').checked=false;updateOverview();};
$('stopAfterCaptcha').onchange=()=>{if($('stopAfterCaptcha').checked){$('inspectionOnly').checked=false;$('manualCaptchaAssist').checked=false;$('autoCaptcha').checked=true;}updateOverview();};
$('runMode').onchange=()=>{const mode=$('runMode').value;$('inspectionOnly').checked=mode==='entry';$('stopAfterCaptcha').checked=mode==='observe';$('autoComplete').checked=mode!=='seat';updateOverview();};
$('openLogs').onclick=()=>run('openLogs');
$('recordObservation').onclick=()=>exclusive('recordObservation');
$('panel-run').addEventListener('input',updateOverview);
$('preflight').onclick=async()=>{const result=await exclusive('preflight',{preferences:readPrefs(),inspectionOnly:$('inspectionOnly').checked});if(result){const value=result.preflight||result;if(Array.isArray(value.checks)){lastPreflightState=JSON.stringify(value);displayPreflight(value);}}};
$('start').onclick=async()=>{if(!$('game').value&&!targetIsGate()&&!targetIsSeat()){message('대상 경기를 선택하거나 열린 예매 준비·좌석 화면을 지정해 주세요.');showStep('page');return;}const value=$('openAt').value;await exclusive('start',{key:targetIsSeat()?'':$('game').value,openAt:!targetIsSeat()&&value?Date.parse(value+'+09:00'):null,entryStrategy:$('entryStrategy').value,entryOffsetMs:Number($('entryOffsetMs').value),inspectionOnly:$('inspectionOnly').checked,preferences:readPrefs()});};
$('stop').onclick=()=>run('stop');
$('quickStop').onclick=()=>run('stop');
$('submitCode').onclick=async()=>{const code=$('securityCode').value;$('securityCode').value='';await run('code',code);};
$('securityCode').onkeydown=e=>{if(e.key==='Enter')$('submitCode').click();};
$('readAreas').onclick=async()=>{const r=await exclusive('catalog');if(!r)return;currentCatalog=r;renderCatalog();};
$('areaChoice').onchange=renderCatalogBlocks;
$('blockChoice').onchange=renderCatalogSeats;
$('addArea').onclick=()=>addCatalogChoices(false);
$('addBlock').onclick=()=>addCatalogChoices(true);
$('recommend').onclick=async()=>{const r=await exclusive('recommend',{preferences:readPrefs()});if(r){seats=r.groups.length?r.groups[0].seats:r.seats;$('summary').textContent=r.message;render();}};
$('choose').onclick=()=>exclusive('choose',{preferences:readPrefs()});
$('complete').onclick=()=>exclusive('complete',{preferences:readPrefs()});
run('state');
run('pairingInfo').then(showPairing);

function renderCatalog(){
  $('areaChoice').replaceChildren();
  for(const a of currentCatalog?.areas||[])$('areaChoice').append(new Option(a.name+(a.code?' · 코드 '+a.code:' · 코드 미수신'),a.name));
  $('catalogHint').textContent=currentCatalog?currentCatalog.title+' · '+currentCatalog.message:'현재 경기의 좌석 화면에서 목록을 읽어 주세요. 목록은 조건에 추가할 때만 적용됩니다.';
  renderCatalogBlocks();
}
function renderCatalogBlocks(){
  const names=new Set([...$('areaChoice').selectedOptions].map(o=>o.value));$('blockChoice').replaceChildren();
  for(const b of currentCatalog?.blocks||[])if(!names.size||b.areas.some(n=>names.has(n)))$('blockChoice').append(new Option(b.areas.join(' / ')+' · '+b.name+' · 코드 '+b.code,b.code));
  renderCatalogSeats();
}
function renderCatalogSeats(){
  const blocks=new Set([...$('blockChoice').selectedOptions].map(o=>o.value)),areas=new Set([...$('areaChoice').selectedOptions].map(o=>o.value));
  const rows=(currentCatalog?.seats||[]).filter(s=>(!blocks.size||blocks.has(s.block))&&(!areas.size||areas.has(s.area)));
  $('catalogSeats').replaceChildren();$('catalogSeatCount').textContent=rows.length+'개 중 최대 200개 표시 · 선택 가능 여부는 실행 시 다시 확인합니다.';
  for(const s of rows.slice(0,200)){const tr=document.createElement('tr');for(const value of [s.area+' / '+s.block,String(s.row??'?')+' · '+String(s.number??'?')+'번',s.id]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('catalogSeats').append(tr);}
}
function addCatalogChoices(withBlocks){
  const chosenAreas=[...$('areaChoice').selectedOptions].map(o=>o.value),chosenBlocks=[...$('blockChoice').selectedOptions].map(o=>o.value);
  if(withBlocks)for(const b of currentCatalog?.blocks||[])if(chosenBlocks.includes(b.code))chosenAreas.push(...b.areas);
  const target=$('catalogTarget').value,node=target==='base'?null:$('tiers').children[Number(target)];
  const add=(field,values)=>{const control=node?tierValue(node,field):$(field);const items=[...new Set([...control.value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean),...values])];control.value=items.join(field==='areas'&&!node?'\n':', ');};
  add('areas',chosenAreas);if(withBlocks)add('blocks',chosenBlocks);updateOverview();
}
