'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildPreflight,diagnosisForRun,observerDiagnosis,phaseForStatus,seatExtensionCompatible}=require('../src/run-inspection');
test('letter-row and diagnostic support require the updated extension version',()=>{
  for(const version of [null,'0.9.27','0.9.26','0.9.25','0.9.24','0.9.23','0.9.22','0.9.21','0.9.20','0.9.19','0.9.18','0.9.17','0.9.16','0.9.15','0.9.12','0.9.11','0.9.9','0.9.3','0.8.9','invalid'])assert.equal(seatExtensionCompatible(version),false);
  for(const version of ['0.9.30','0.10.0','1.0.0'])assert.equal(seatExtensionCompatible(version),true);
  const report=buildPreflight({connected:true,target:true,pageStage:'seat',networkHealthy:true,extensionVersion:'0.9.3'});
  assert.equal(report.canStart,false);assert.equal(report.checks.find(c=>c.id==='extension').level,'error');
});
test('preflight distinguishes extension connection, response observation and entry-only scope',()=>{
  const result=buildPreflight({connected:true,target:true,pageStage:'seat',networkHealthy:false,inspectionOnly:true});
  assert.equal(result.canStart,false);
  assert.equal(result.checks.find(c=>c.id==='connection').level,'ok');
  assert.equal(result.checks.find(c=>c.id==='observer').level,'error');
  assert.match(result.checks.find(c=>c.id==='scope').title,/좌석 선택 안 함/);
});
test('preflight explains missing metadata and existing selection without approving a reservation',()=>{
  const result=buildPreflight({connected:true,target:true,pageStage:'seat',networkHealthy:true,scene:{selected:['one']},seats:{visible:200,detailed:0,groups:0}});
  assert.equal(result.canStart,false);assert.equal(result.checks.find(c=>c.id==='selected').level,'error');
  assert.match(result.checks.find(c=>c.id==='seat-metadata').detail,/구역 목록/);
  assert.equal(result.checks.find(c=>c.id==='seat-candidates').level,'warning');
  assert.match(result.checks.find(c=>c.id==='authentication').title,/보장하지/);
});
test('preflight reports letter rows and configured stopping scope',()=>{
  const result=buildPreflight({connected:true,target:true,pageStage:'seat',networkHealthy:true,preferences:{autoComplete:false},seats:{visible:3,detailed:3,groups:1,alphaRows:true}});
  assert.equal(result.canStart,true);assert.match(result.checks.find(c=>c.id==='alpha-rows').detail,/A=1/);
  assert.match(result.checks.find(c=>c.id==='scope').title,/다음 단계 이동 안 함/);
});
test('preflight fails closed for unreadable or unsupported screens',()=>{
  for(const props of [{pageStage:'unsupported'},{pageStage:'seat',readFailed:true},{pageStage:'gate',extensionUpdateRequired:true}]){
    assert.equal(buildPreflight({connected:true,target:true,networkHealthy:true,...props}).canStart,false);
  }
});
test('preflight explains singleton quantity and row restrictions without blocking valid regular seats',()=>{
  const result=buildPreflight({connected:true,target:true,pageStage:'seat',networkHealthy:true,extensionVersion:'0.9.30',httpCapability:{supported:true},preferences:{quantity:2,excludeRestricted:false,requireTogether:false},seats:{visible:4,detailed:4,groups:1,singletonCount:3,explicitRowBounds:true}});
  assert.equal(result.canStart,true);
  const singleton=result.checks.find(c=>c.id==='singleton-seats');assert.equal(singleton.level,'warning');
  assert.match(singleton.title,/3개 · 1매만 지원/);assert.match(singleton.detail,/현재 매수 설정에서는/);assert.match(singleton.detail,/숫자 열 범위/);
  assert.match(result.checks.find(c=>c.id==='dispersed-seats').detail,/부족한 수만 다음 순위/);
});
test('preflight treats checked, unavailable and unverified automatic progress distinctly',()=>{
  const base={connected:true,target:true,pageStage:'seat',networkHealthy:true,extensionVersion:'0.9.30'};
  assert.equal(buildPreflight({...base,httpCapability:{supported:true}}).checks.find(c=>c.id==='http-capability').level,'ok');
  const blocked=buildPreflight({...base,httpCapability:{supported:false,code:'HTTP_CONTEXT_SYNC_UNAVAILABLE'}});
  assert.equal(blocked.canStart,false);assert.match(blocked.checks.find(c=>c.id==='http-capability').detail,/선택 결과를 연결/);
  assert.equal(buildPreflight(base).checks.find(c=>c.id==='http-capability').level,'warning');
  const unknown=buildPreflight({...base,httpCapability:{supported:false,code:'secret raw failure'}});
  assert.ok(!JSON.stringify(unknown).includes('secret raw failure'));
  const inspection=buildPreflight({...base,inspectionOnly:true,httpCapability:{supported:false}});
  assert.equal(inspection.canStart,true);assert.ok(!inspection.checks.some(c=>c.id==='http-capability'));
});
test('observer reason does not invent a cause for a Chrome detach',()=>{
  const diagnosis=observerDiagnosis('debugger-detached');assert.match(diagnosis.detail,/단정할 수는 없습니다/);
  assert.equal(observerDiagnosis('target-closed').code,'target-closed');
  assert.equal(observerDiagnosis('private raw reason https://example.invalid').code,'observer-lost');
});
test('old run record distinguishes observation failure, inspection and confirmed next screen',()=>{
  assert.equal(diagnosisForRun({stopReason:'Chrome의 예매 응답 관찰 연결이 끊겨 중지했습니다.'}).code,'observer-lost');
  assert.equal(diagnosisForRun({},'진입 확인 완료 · 좌석을 선택하지 않고 중지했습니다.').code,'entry-only');
  assert.equal(diagnosisForRun({},'좌석 선택 승인 · 가격/할인 화면 도착을 확인했습니다.').code,'price-confirmed');
  const first=observerDiagnosis('target-closed');assert.deepEqual(diagnosisForRun({diagnosis:first,failureDetail:'secondary error'}),first);
});
test('stage durations use explicit grouped phases rather than page-derived names',()=>{
  assert.equal(phaseForStatus('보안문자 직접 입력 대기').code,'verification');
  assert.equal(phaseForStatus('현재 지도 갱신 대기').code,'retry');
  assert.equal(phaseForStatus('중지 사유 · 입력 오류').code,'stop');
  assert.equal(phaseForStatus('허용 구역의 표시 잔여석이 0석입니다 · 5.0초 후 16차 확인 · 확보 또는 중지까지 반복').code,'retry');
});
test('failure text can never claim a verified price screen, while explicit completion survives a late cancellation',()=>{
  assert.notEqual(diagnosisForRun({failureDetail:'사이트 안내를 확인해 주세요. 가격/할인 화면으로 이동할 수 없습니다.'}).level,'success');
  assert.notEqual(diagnosisForRun({failureDetail:'진입 확인 완료 불가'}).code,'entry-only');
  assert.equal(diagnosisForRun({outcome:'price-confirmed',stopReason:'중지했습니다.',diagnosis:observerDiagnosis('unknown')}).code,'price-confirmed');
});
test('price diagnostics describe standard-price criteria and point to logged decisions',()=>{
  const diagnosis=diagnosisForRun({failureDetail:'일반 가격 없음 [STANDARD_PRICE_UNAVAILABLE]'});
  assert.equal(diagnosis.code,'price-selection');assert.match(diagnosis.detail,/좌석 등급별 가격/);assert.match(diagnosis.nextAction,/price-selection/);
  const scope=buildPreflight({connected:true,target:true,pageStage:'seat',networkHealthy:true,extensionVersion:'0.9.30',httpCapability:{supported:true}}).checks.find(c=>c.id==='scope');
  assert.match(scope.detail,/조건을 충족하는 첫 일반 가격/);assert.doesNotMatch(scope.detail,/성인/);
  assert.match(diagnosisForRun({outcome:'booking-advanced'}).detail,/일반 가격/);
});
