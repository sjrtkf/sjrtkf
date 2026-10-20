'use strict';
// Pure summaries: no browser commands, credentials, transport bodies or model data.
const PHASES={prepare:'실행 준비',entry:'진입·화면 전환 대기',verification:'사용자 인증·안내 대기',search:'좌석 정보·조건 확인',selection:'좌석 선택 결과 확인',completion:'다음 화면 확인',retry:'재확인 대기',stop:'중지·정리',other:'기타 처리'};
function seatExtensionCompatible(version){
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return false;
  const parts=version.split('.').map(Number),minimum=[0,9,27];
  for(let i=0;i<3;i++){if(parts[i]>minimum[i])return true;if(parts[i]<minimum[i])return false;}
  return true;
}
function phaseForStatus(text){
  let code='other';
  if(/중지|정리/.test(String(text).replace('확보 또는 중지까지 반복','')))code='stop';
  else if(/보안문자|인증|직접 입력|안내.*확인/.test(text))code='verification';
  else if(/초 후|다시.*확인|순환|갱신 대기/.test(text))code='retry';
  else if(/선택 완료|가격|할인|승인/.test(text))code='completion';
  else if(/후보.*선택|좌석.*선택|선점|선택.*확인/.test(text))code='selection';
  else if(/구역|좌석 정보|연석|지도|순위/.test(text))code='search';
  else if(/진입|예매 버튼|예매 준비|개방|화면 전환/.test(text))code='entry';
  else if(/준비/.test(text))code='prepare';
  return {code,label:PHASES[code]};
}
function observerDiagnosis(reason){
  const base={code:'observer-lost',level:'error',title:'좌석·진입 응답 관찰이 중단됐습니다.',detail:'Chrome 확장 연결과 사이트 응답 관찰은 별도입니다. 결과를 확인할 수 없어 자동 진행을 중지했습니다.',nextAction:'Chrome의 실제 화면을 먼저 확인하고, 개발자 도구나 다른 브라우저 제어를 종료한 뒤 실행 전 점검을 다시 하세요.'};
  if(reason==='target-closed')return {...base,code:'target-closed',title:'관찰하던 예매 탭이 닫혔습니다.',nextAction:'현재 경기의 예매 탭을 선택하고 실행 전 점검을 다시 하세요.'};
  if(reason==='debugger-detached')return {...base,code:'debugger-detached',detail:'Chrome에서 디버깅 연결이 해제됐습니다. 사용자 해제 또는 다른 도구와의 충돌 가능성이 있지만, 원인을 단정할 수는 없습니다.'};
  if(reason==='pending-overflow')return {...base,code:'observer-overflow',detail:'관찰 중인 요청의 처리 한도를 넘어 응답 추적을 중지했습니다.',nextAction:'현재 선택 결과를 Chrome에서 확인하고 중복 실행을 피하세요. 반복되면 마지막 작업 기록을 확인하세요.'};
  if(reason==='observer-error')return {...base,code:'observer-error',detail:'사이트 응답 관찰을 처리하는 중 오류가 발생했습니다.'};
  if(reason==='manual-detach')return {...base,code:'observer-detached',detail:'도우미의 관찰 연결이 해제됐습니다.'};
  return base;
}
function diagnosisForRun(run,message=''){
  if(run.outcome==='booking-advanced')return {code:'booking-advanced',level:'success',title:'예매하기 후 다음 화면에 도착했습니다.',detail:'일반 가격 수량과 예매하기 진행을 확인했습니다. 결제는 진행하지 않았습니다.',nextAction:'Chrome에서 예매 내용·수령 방법·결제를 확인하세요.'};
  const priceConfirmed={code:'price-confirmed',level:'success',title:'가격·할인 화면 도착을 확인했습니다.',detail:'좌석 선택 다음 단계까지 확인했으며 결제 완료는 아닙니다.',nextAction:'Chrome에서 가격·할인과 예매 내용을 확인하세요.'};
  if(run.outcome==='price-confirmed')return priceConfirmed;
  if(run.diagnosis)return {...run.diagnosis};
  const text=String(run.stopReason||run.failureDetail||message);
  if(/STANDARD_PRICE_UNAVAILABLE|PRICE_GRADE_AMBIGUOUS|PRICE_RESPONSE_UNSUPPORTED|PRICE_REQUIRES_CERTIFICATION|PRICE_RULE_UNSUPPORTED|PRICE_QUANTITY_LIMIT|ADULT_PRICE_AMBIGUOUS/.test(text))return {code:'price-selection',level:'warning',title:'일반 가격의 적용 조건을 확인해야 합니다.',detail:'좌석 등급별 가격 목록에서 이용 자격·할인·매수 조건을 확인하며, 조건을 확정할 수 없는 가격은 자동 적용하지 않습니다.',nextAction:'자동 로그의 price-selection 기록에서 가격 항목과 선택·제외 사유를 확인하세요. 현재 좌석 선택 상태도 Chrome에서 확인하세요.'};
  if(/등급.*이름|구역 이름을 확정/.test(text))return {code:'grade-name-conflict',level:'error',title:'좌석 구역 이름을 확정하지 못했습니다.',detail:'같은 등급 코드에 여러 이름이 표시됩니다. 좌석별 이름으로도 확인하지 못한 좌석은 조건을 검증할 수 없어 선택하지 않았습니다.',nextAction:'자동 로그 폴더의 grade-names 또는 grade-unresolved 기록에서 코드·이름을 확인할 수 있습니다.'};
  if(/관찰 연결|응답 관찰/.test(text))return observerDiagnosis(run.entry?.observerLostReason);
  if(!run.failureDetail&&!run.stopReason&&/^진입 확인 완료/.test(text))return {code:'entry-only',level:'info',title:'진입 확인만 완료했습니다.',detail:'진입 확인만 모드이므로 좌석 선택과 다음 단계 이동을 실행하지 않았습니다.',nextAction:'좌석까지 테스트하려면 진입 확인만을 끄고 실행하세요.'};
  if(!run.failureDetail&&!run.stopReason&&/^좌석 선택 승인 · 가격\/할인 화면 도착을 확인했습니다\./.test(text))return priceConfirmed;
  if(/연결.*끊|확장.*연결/.test(text))return {code:'connection-lost',level:'error',title:'Chrome 연결을 확인해야 합니다.',detail:'연결이 끊긴 동안 이미 전송한 작업의 결과는 알 수 없습니다.',nextAction:'Chrome 화면을 확인하고 확장을 다시 연결한 뒤 실행 전 점검을 누르세요.'};
  if(/경기 또는 회차|문서|화면.*변경|대상.*변경/.test(text))return {code:'context-changed',level:'warning',title:'경기 또는 화면이 바뀌었습니다.',detail:'이전 화면의 좌석 정보를 새 화면에서 사용하지 않도록 중지했습니다.',nextAction:'대상 경기·탭·좌석 조건을 확인하고 실행 전 점검을 다시 하세요.'};
  if(/상세 정보|좌석 정보.*확인하지|좌석.*로딩|지원하는.*화면/.test(text))return {code:'seat-information',level:'warning',title:'좌석 정보를 충분히 확인하지 못했습니다.',detail:'좌석 표기·상세 정보 또는 화면 구조가 현재 지원 범위와 다를 수 있습니다.',nextAction:'실행 전 점검으로 지도·상세 정보·후보 수를 확인하세요. 연결 전에 지도를 열었다면 구역 목록에서 다시 들어가세요.'};
  if(/중지/.test(text))return {code:'stopped',level:'info',title:'진행을 중지했습니다.',detail:'중지 전에 이미 전송된 동작은 취소되지 않을 수 있습니다.',nextAction:'Chrome의 현재 선택 상태를 확인하세요.'};
  if(run.preferences?.autoComplete===false&&!run.failureDetail)return {code:'selection-only',level:'info',title:'좌석 선택까지만 진행하는 설정입니다.',detail:'선택 완료와 가격·할인 화면 이동은 자동으로 실행하지 않습니다.',nextAction:'Chrome에서 선택 좌석을 확인하거나 선택 완료까지 진행 설정을 사용하세요.'};
  return {code:run.failureDetail?'run-error':'run-finished',level:run.failureDetail?'error':'info',title:run.failureDetail?'진행 중 확인이 필요한 문제가 발생했습니다.':'작업 기록을 확인하세요.',detail:'아래 단계 기록과 최종 메시지에서 마지막으로 확인한 지점을 확인할 수 있습니다.',nextAction:'Chrome의 현재 화면을 확인한 뒤 실행 전 점검으로 상태를 다시 읽으세요.'};
}
function buildPreflight({connected=false,extensionUpdateRequired=false,extensionVersion,target=false,pageStage='unsupported',preferences={},inspectionOnly=false,networkHealthy=null,scene=null,seats=null,httpCapability=null,readFailed=false}={}){
  const checks=[],add=(id,level,title,detail)=>checks.push({id,level,title,detail});
  add('connection',connected?'ok':'error',connected?'Chrome 확장 연결됨':'Chrome 확장 연결 전',connected?'앱과 확장이 통신하고 있습니다. 사이트 응답 관찰 상태는 아래에서 별도로 확인합니다.':'연결 코드를 Chrome 확장에 입력하세요.');
  if(extensionUpdateRequired||connected&&extensionVersion!==undefined&&!seatExtensionCompatible(extensionVersion))add('extension','error','확장 업데이트가 필요합니다.','좌석 등급별 일반 가격 선택과 가격 판단 기록에는 v0.9.27 이상 확장이 필요합니다. 현재 배포 폴더의 chrome-extension으로 업데이트하고 다시 연결하세요.');
  else if(connected)add('extension',seatExtensionCompatible(extensionVersion)?'ok':'warning',seatExtensionCompatible(extensionVersion)?'확장 버전 호환 확인':'확장 버전 확인 필요','좌석 등급별 일반 가격 선택과 가격 판단 기록에는 v0.9.27 이상 확장을 사용하세요.');
  add('target',target?'ok':'error',target?'대상 탭 확인':'예매 탭을 선택하세요.',target?'현재 선택한 탭을 기준으로 점검했습니다.':'경기 목록 또는 예매창을 열고 대상 탭을 선택하세요.');
  const stages={listing:'경기 목록',gate:'예매 준비',seat:'좌석 선택',unsupported:'지원 여부 미확인'};
  if(target)add('page',pageStage==='unsupported'?'error':'ok','현재 화면 · '+stages[pageStage],pageStage==='seat'?'좌석 선택 단계의 화면을 읽습니다.':'예매창 진입 후 좌석 구조를 추가로 확인해야 합니다.');
  add('scope',inspectionOnly||preferences.stopAfterCaptcha||preferences.autoComplete===false?'warning':'ok',inspectionOnly?'진입만 확인 · 좌석 선택 안 함':preferences.stopAfterCaptcha?'보안문자 후 기록·정지':preferences.autoComplete===false?'좌석 선택까지만 · 다음 단계 이동 안 함':'좌석 선택 → 선택 완료 → 다음 화면 확인',inspectionOnly?'좌석까지 진행하려면 진입 확인만 체크를 해제하세요.':preferences.stopAfterCaptcha?'인증 이후 정보를 기록하고 좌석 선택 전에 멈춥니다.':preferences.autoComplete===false?'선택 완료까지 진행 설정이 꺼져 있습니다.':'사이트 가격 목록에서 조건을 충족하는 첫 일반 가격으로 수량을 선택하고 N매 예매하기 후 다음 화면을 확인합니다. 결제는 직접 진행합니다.');
  if(connected&&target){
    add('observer',networkHealthy===true?'ok':networkHealthy===false?'error':'warning',networkHealthy===true?'사이트 응답 관찰 연결 정상':'사이트 응답 관찰 확인 필요',networkHealthy===true?'지금 연결 상태를 확인했습니다. 이후 화면 변경이나 다른 도구의 연결로 해제될 수 있습니다.':'Chrome 개발자 도구나 다른 브라우저 제어와 충돌하는지 확인하고 다시 점검하세요.');
    if(readFailed)add('read','error','현재 화면을 읽지 못했습니다.','탭 전환이 끝난 뒤 다시 점검하세요. 진행 중인 선택은 Chrome에서 먼저 확인하세요.');
    if(scene?.selected?.length)add('selected','error','이미 선택된 좌석이 있습니다.','기존 선택을 자동으로 덮어쓰지 않습니다. Chrome에서 선택 상태를 확인하세요.');
    if(scene?.completed)add('completed','error','이미 가격·할인 단계입니다.','좌석 자동 진행을 다시 시작할 필요가 없습니다. Chrome에서 계속 진행하세요.');
    if(scene?.dialog)add('dialog','warning','사이트 안내 확인 필요','현재 안내는 Chrome에서 확인하세요. 점검 과정에서는 버튼을 누르지 않습니다.');
    if(pageStage==='seat'&&!inspectionOnly&&!preferences.stopAfterCaptcha){
      const details={HTTP_SEAT_SYSTEM_UNSUPPORTED:'현재 상품의 좌석 운영 방식은 자동 진행 지원 범위에 포함되지 않습니다.',HTTP_CONTEXT_SYNC_UNAVAILABLE:'현재 화면과 선택 결과를 연결할 준비를 확인하지 못했습니다. 새로고침 후 다시 점검하세요.',HTTP_NAVIGATION_CONTEXT_CHANGED:'점검 중 경기 또는 회차가 바뀌었습니다. 대상 탭을 다시 확인하세요.',HTTP_NAVIGATION_EXPIRED:'현재 화면이나 점검 유효 시간이 바뀌었습니다. 좌석 화면에서 다시 점검하세요.'};
      add('http-capability',httpCapability?.supported===true?'ok':httpCapability?.supported===false?'error':'warning',httpCapability?.supported===true?'자동 진행 연결 준비 확인':httpCapability?.supported===false?'현재 화면의 자동 진행을 지원하지 않습니다.':'자동 진행 연결은 아직 미확인',httpCapability?.supported===true?'현재 화면의 선택 결과 연결 기능을 확인했습니다. 좌석 확보와 이용 자격은 실행 중 별도로 확인합니다.':details[httpCapability?.code]||'현재 화면의 자동 진행 지원 여부를 확인하지 못했습니다. 좌석 화면에서 실행 전 점검을 다시 하세요.');
    }
    if(scene?.grades?.length)add('grades','ok',scene.grades.length+'개 구역 확인','구역 이름을 읽었습니다. 실제 좌석·연석 지원 여부는 지도에서 확인합니다.');
    if(seats){
      add('seat-metadata',seats.detailed>0?'ok':'warning',`보이는 후보 ${seats.visible}개 · 상세 정보 ${seats.detailed}개`,seats.detailed?'열·번호·구역 정보를 결합했습니다.':'연결 전에 지도를 열었다면 구역 목록에서 다시 들어가세요. 확인되지 않은 좌석은 자동 선택하지 않습니다.');
      add('seat-candidates',seats.groups>0?'ok':'warning',`현재 조건의 조합 ${seats.groups}개`,seats.groups?'현재 지도와 설정 기준이며 서버의 좌석 확보를 보장하지 않습니다.':'매수·구역·블록·열·연석 조건 또는 상세 정보 부족을 확인하세요.');
      if(seats.alphaRows)add('alpha-rows','warning','문자 열 표기 확인','A=1, B=2, …, Z=26 기준으로 열 범위를 적용합니다. 화면에는 원래 문자 열을 표시합니다.');
      if(seats.singletonCount>0){
        const restricted=preferences.excludeRestricted!==false,multiple=(preferences.quantity??2)>1;
        let detail='‘104블록 W4-1’처럼 표시되는 확인된 1인 장애인·휠체어석은 1매 설정에서만 선택할 수 있습니다. 블록·W번호를 숫자 열·좌석 번호로 바꾸지 않습니다.';
        if(restricted)detail+=' 현재는 장애인·휠체어석 제외 설정입니다.';
        else if(multiple)detail+=' 현재 매수 설정에서는 이 형식의 좌석을 후보에서 제외합니다. 일반석 후보는 계속 확인합니다.';
        if(seats.explicitRowBounds)detail+=' 숫자 열 범위가 있는 순위에는 맞지 않으며, 열 제한이 없는 순위나 전체 구역 대안에서만 확인합니다.';
        add('singleton-seats',restricted?'ok':multiple||seats.explicitRowBounds?'warning':'ok',`특수 표기 장애인·휠체어석 ${seats.singletonCount}개 · 1매만 지원`,detail);
      }
      if(preferences.requireTogether===false)add('dispersed-seats','ok','여러 구역·등급의 분산 좌석 합산','높은 순위의 좌석을 최대한 포함하고, 부족한 수만 다음 순위에서 채웁니다. 각 순위의 구역을 확인한 뒤 다음 순위로 넓히며, 선택 직전에 각 좌석을 다시 확인합니다.');
    }
    add('authentication','warning','로그인·입장 권한은 보장하지 않습니다.','점검은 현재 화면과 연결 상태 확인이며 서버 인증 성공을 검증하지 않습니다.');
  }
  const canStart=!checks.some(c=>c.level==='error');
  return {checks,canStart,message:canStart?'점검 완료 · 주의 항목과 실행 범위를 확인하세요.':'점검에서 확인이 필요한 항목이 있습니다.'};
}
module.exports={phaseForStatus,observerDiagnosis,diagnosisForRun,buildPreflight,seatExtensionCompatible};
