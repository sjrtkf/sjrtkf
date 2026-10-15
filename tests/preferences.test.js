const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizePreferences,rankGroups,gradePlan,groupKey}=require('../src/preferences');
const {parseMetadata,enrich,metadataUrl}=require('../src/metadata');
const make=(row,number,extra={})=>({id:`${row}-${number}`,available:true,grade:'3루 레드석',block:'118',row,number,colIdx:number,segment:`118-${row}`,obstructed:false,aisle:number===1,neighbors:[`${row}-${number-1}`,`${row}-${number+1}`],...extra});
test('설정 매수 범위를 검증한다',()=>{for(const n of [0,5,1.5,NaN])assert.throws(()=>normalizePreferences({quantity:n}));assert.equal(normalizePreferences().quantity,2);});
test('직접 입력 편의 기능은 이전 설정에도 기본 적용하며 명시적 해제는 보존한다',()=>{
  assert.equal(normalizePreferences({autoCaptcha:true}).manualCaptchaAssist,true);
  const prefs=normalizePreferences({manualCaptchaAssist:false});
  assert.equal(normalizePreferences(JSON.parse(JSON.stringify(prefs))).manualCaptchaAssist,false);
});
test('보안문자 자동 진행은 기존 설정에도 기본 적용하며 직접 입력 선택은 보존한다',()=>{
  assert.equal(normalizePreferences().autoCaptcha,true);
  assert.equal(normalizePreferences({quantity:3,autoNotice:false}).autoCaptcha,true);
  const manual=normalizePreferences({autoCaptcha:false});
  assert.equal(manual.autoCaptcha,false);
  assert.equal(normalizePreferences(JSON.parse(JSON.stringify(manual))).autoCaptcha,false);
});
test('구역과 블럭 우선순위는 앞열보다 우선한다',()=>{const seats=[make(1,1,{grade:'3루 네이비석'}),make(1,2,{grade:'3루 네이비석'}),make(10,1),make(10,2)];assert.equal(rankGroups(seats,{areas:['3루 레드석','3루 네이비석']})[0].seats[0].row,10);});
test('앞열 우선과 통로 우선이 각각 적용된다',()=>{const seats=[make(1,5),make(1,6),make(3,1),make(3,2)];assert.equal(rankGroups(seats,{priority:'front'})[0].seats[0].row,1);assert.equal(rankGroups(seats,{priority:'aisle'})[0].seats[0].row,3);});
test('시야방해 및 미확인 좌석은 기본 제외한다',()=>{const seats=[make(1,1,{obstructed:true}),make(1,2),make(2,1,{obstructed:null}),make(2,2)];assert.equal(rankGroups(seats,{}).length,0);});
test('번호가 연속이어도 인접 정보상 통로를 건너면 연석으로 보지 않는다',()=>{assert.equal(rankGroups([make(1,1,{neighbors:[]}),make(1,2,{neighbors:[]})],{}).length,0);});
test('반드시 연석 옵션은 분산 좌석으로 대체하지 않는다',()=>{const seats=[make(1,1),make(2,1)];assert.equal(rankGroups(seats,{}).length,0);assert.equal(rankGroups(seats,{requireTogether:false})[0].together,false);});
test('다른 블럭과 행을 합친 연석은 생성하지 않는다',()=>{assert.equal(rankGroups([make(1,1),make(1,2,{block:'119'})],{}).length,0);});
test('실제 클라이언트 형식의 colIdx 간격과 행 끝을 파싱한다',()=>{const raw=[{blockKey:'001:118',seats:[1,2,5].map(n=>({seatInfoId:`test:${n}`,rowIdx:0,colIdx:n,rowNo:'1',seatNo:String(n),seatGrade:'R',isExposable:true,seatGroupId:null}))}];const meta=parseMetadata(raw);assert.equal(meta[0].aisle,true);assert.deepEqual(meta[1].neighbors,['seat_block_test:1']);assert.notEqual(meta[1].segment,meta[2].segment);});
test('등급명 연결이 안 된 좌석은 정상 시야라고 추측하지 않는다',()=>{const m=new Map([['s',{gradeCode:'R',row:1,number:1,exposable:true,grouped:false}]]);assert.equal(enrich([{id:'s',available:true}],m,new Map())[0].obstructed,null);assert.equal(enrich([{id:'s',available:true}],m,new Map([['R','[시야방해] 3루 레드석']]))[0].obstructed,true);});
test('메타데이터 응답 경로를 제한한다',()=>{assert.equal(metadataUrl('https://tickets.interpark.com/onestop/api/seatMeta?blockKeys=001:118'),true);assert.equal(metadataUrl('https://tickets.interpark.com/onestop/api/member'),false);assert.equal(metadataUrl('https://evil.test/onestop/api/seatMeta'),false);});
test('조건 묶음의 열 범위·통로 조건을 검증하고 기존 설정을 보존한다',()=>{
  assert.deepEqual(normalizePreferences({areas:'A, B',tiers:[]}).areas,['A','B']);
  const p=normalizePreferences({tiers:[{enabled:false,minRow:-1},{name:'앞열 통로',areas:'A,B,A',blocks:'118,117',minRow:'1',maxRow:'5',aisle:'required'}]});
  assert.equal(p.tiers.length,1);assert.deepEqual(p.tiers[0].areas,['A','B']);assert.equal(p.tiers[0].maxRow,5);assert.equal(p.tiers[0].aisle,'required');
  for(const t of [{minRow:0},{maxRow:1.5},{minRow:6,maxRow:5}])assert.throws(()=>normalizePreferences({tiers:[t]}));
});
test('같은 묶음의 구역·블럭은 나열 순서 대신 좌석 선호로 비교한다',()=>{
  const seats=[make(4,1,{grade:'A',block:'118'}),make(4,2,{grade:'A',block:'118'}),make(1,1,{grade:'B',block:'117'}),make(1,2,{grade:'B',block:'117'})];
  const groups=rankGroups(seats,{tiers:[{name:'1순위',areas:['A','B'],blocks:['118','117'],maxRow:5,aisle:'required'}]});
  assert.equal(groups[0].seats[0].grade,'B');assert.equal(groups[0].tierName,'1순위');assert.equal(groups[0].tierIndex,0);
});
test('조건 묶음 순서가 앞열보다 우선하며 특정 묶음만 탐색할 수 있다',()=>{
  const seats=[make(4,1,{grade:'A'}),make(4,2,{grade:'A'}),make(1,1,{grade:'B'}),make(1,2,{grade:'B'})],p={tiers:[{name:'우선',areas:['A']},{name:'대안',areas:['B']}]};
  assert.deepEqual(rankGroups(seats,p).map(g=>g.tierIndex),[0,1]);assert.equal(rankGroups(seats,p,{tierIndex:1})[0].seats[0].grade,'B');assert.equal(rankGroups(seats,p,{tierIndex:4}).length,0);
});
test('열 범위 양 끝을 포함하고 추정 통로 필수 조건은 미확인 좌석을 허용하지 않는다',()=>{
  const seats=[make(1,1),make(1,2),make(5,1),make(5,2),make(6,1),make(6,2),make(3,1,{aisle:null}),make(3,2,{aisle:false})];
  const groups=rankGroups(seats,{tiers:[{minRow:1,maxRow:5,aisle:'required'}]});assert.deepEqual(groups.map(g=>g.seats[0].row),[1,5]);
});
test('통로 제한 없음은 통로 점수에 영향을 받지 않는다',()=>{
  const seats=[make(1,1,{aisle:false}),make(1,2,{aisle:false}),make(2,1),make(2,2)];
  assert.equal(rankGroups(seats,{tiers:[{aisle:'any',priority:'aisle'}]})[0].seats[0].row,1);
});
test('좌석 번호가 뒤섞여 있어도 물리적 colIdx 순서로 연석을 찾는다',()=>{
  const seats=[make(1,9,{id:'a',colIdx:1,neighbors:['b']}),make(1,2,{id:'b',colIdx:2,neighbors:['a','c']}),make(1,7,{id:'c',colIdx:3,neighbors:['b']})];
  const groups=rankGroups(seats,{quantity:3});assert.equal(groups.length,1);assert.deepEqual(groups[0].seats.map(s=>s.id),['a','b','c']);
  assert.equal(rankGroups(seats.map(s=>({...s,colIdx:null})),{quantity:3}).length,0);
});
test('실패한 좌석·조합을 제외하고 안정적인 키로 다음 후보를 유지한다',()=>{
  const seats=[1,2,3,4].map(n=>make(1,n)),all=rankGroups(seats,{});
  assert.equal(all.length,3);assert.equal(groupKey([...all[0].seats].reverse()),all[0].key);
  const byGroup=rankGroups(seats,{}, {excludedGroups:new Set([all[0].key])});assert.equal(byGroup.length,2);assert.equal(byGroup[0].key,all[1].key);
  const bySeat=rankGroups(seats,{}, {excludedIds:['1-2']});assert.equal(bySeat.length,1);assert.deepEqual(bySeat[0].seats.map(s=>s.number),[3,4]);
});
test('20개 이후의 후보도 유지하며 중복 조건 묶음은 같은 조합을 반복하지 않는다',()=>{
  const seats=Array.from({length:35},(_,i)=>make(1,i+1)),groups=rankGroups(seats,{tiers:[{},{}]});
  assert.equal(groups.length,34);assert.ok(groups.every(g=>g.tierIndex===0));
});
test('구역 작업 계획은 한 순위의 모든 구역을 먼저 방문하고 그다음 순위로 진행한다',()=>{
  const grades=[{name:'B',count:10},{name:'A',count:9},{name:'[시야방해] C',count:100},{name:'D',count:1}];
  const plan=gradePlan(grades,{tiers:[{name:'앞열',areas:['A','B']},{name:'뒤열',areas:['A']}]});
  assert.deepEqual(plan.map(p=>[p.name,p.tierIndex]),[['B',0],['A',0],['A',1]]);
  assert.deepEqual(gradePlan(grades,{areas:['A','B']}).map(p=>p.name),['A','B']);
});
