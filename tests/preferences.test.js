const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizePreferences,rankGroups,gradePlan,assessGradePlan,groupKey}=require('../src/preferences');
const {parseMetadata,enrich,metadataUrl}=require('../src/metadata');
const make=(row,number,extra={})=>({id:`${row}-${number}`,available:true,grade:'3루 레드석',block:'118',row,number,colIdx:number,segment:`118-${row}`,obstructed:false,aisle:number===1,neighbors:[`${row}-${number-1}`,`${row}-${number+1}`],...extra});
test('같은 통로의 3연석은 19열보다 13열을 먼저 고른다',()=>{
  const seats=[19,13].flatMap(row=>[1,2,3].map(n=>make(row,n)));
  assert.equal(rankGroups(seats,{quantity:3})[0].seats[0].row,13);
});
test('통로석이 없어도 앞열을 먼저 고르고 같은 열에서 통로 거리를 비교한다',()=>{
  const seats=[make(19,2,{aisleDistance:1}),make(19,3,{aisleDistance:2}),make(13,4,{aisleDistance:3}),make(13,5,{aisleDistance:4})];
  assert.equal(rankGroups(seats,{quantity:2})[0].seats[0].row,13);
  assert.equal(rankGroups([make(1,5,{aisleDistance:4}),make(1,2,{aisleDistance:1})],{quantity:1})[0].seats[0].number,2);
});
test('통로 거리는 잔여석이 아닌 전체 좌석 배열로 계산한다',()=>{
  const meta=parseMetadata([{blockKey:'001:118',seats:Array.from({length:9},(_,i)=>({seatInfoId:'s'+i,rowIdx:0,colIdx:i,rowNo:'1',seatNo:String(i+1),seatGrade:'B',isExposable:true}))}]);
  assert.deepEqual(meta.map(s=>s.aisleDistance),[0,1,2,3,4,3,2,1,0]);
});
test('정확한 이름·코드로 구역과 블록을 제한하고 빈 블록은 구역 전체를 허용한다',()=>{
  const seats=[make(1,1,{grade:'블루존',gradeCode:'B',block:'3-5',blockKey:'001:3-5'}),make(1,2,{grade:'블루존',gradeCode:'B',block:'3-7',blockKey:'001:3-7'}),make(2,1,{grade:'블루존 테이블',gradeCode:'T',block:'3-5',blockKey:'002:3-5'})];
  assert.equal(rankGroups(seats,{quantity:1,areas:['블루 존'],fallbackAnywhere:false}).length,2);
  assert.equal(rankGroups(seats,{quantity:1,areas:['블루'],fallbackAnywhere:false}).length,0);
  assert.equal(rankGroups(seats,{quantity:1,areas:['B'],blocks:['001:3-5'],fallbackAnywhere:false}).length,1);
  assert.equal(rankGroups(seats,{quantity:1,areas:['블루존'],blocks:['3-7']})[0].seats[0].number,2);
  assert.equal(gradePlan([{name:'블루존',code:'B',count:4}],{areas:['B'],fallbackAnywhere:false}).length,1);
});

test('구역·블록 코드 1과 10을 혼동하지 않고 복합 블록 키 전체를 구분한다',()=>{
  const seats=[
    make(4,1,{id:'wanted',grade:'내야석',gradeCode:'1',block:'1',blockKey:'001:1'}),
    make(1,1,{id:'other-grade',grade:'내야 특별석',gradeCode:'10',block:'1',blockKey:'001:1'}),
    make(1,1,{id:'other-block',grade:'내야석',gradeCode:'1',block:'10',blockKey:'001:10'}),
    make(1,1,{id:'other-map',grade:'내야석',gradeCode:'1',block:'1',blockKey:'002:1'})
  ];
  for(const requireTogether of [true,false]){
    const prefs={quantity:1,requireTogether,fallbackAnywhere:false,tiers:[{areas:['1'],blocks:['001:1']}]};
    assert.deepEqual(rankGroups(seats,prefs).map(g=>g.seats[0].id),['wanted']);
    assert.deepEqual(rankGroups(seats,{...prefs,tiers:[{areas:['1'],blocks:['1']}]}).map(g=>g.seats[0].id),['other-map','wanted']);
  }
  assert.deepEqual(gradePlan([{name:'내야 특별석',code:'10',count:10},{name:'내야석',code:'1',count:10}],{areas:['1'],fallbackAnywhere:false}).map(g=>g.name),['내야석']);
});
test('설정 매수 범위를 검증한다',()=>{for(const n of [0,5,1.5,NaN])assert.throws(()=>normalizePreferences({quantity:n}));assert.equal(normalizePreferences().quantity,2);});
test('이전 직접 입력 설정도 자동 입력으로 전환한다',()=>{
  assert.equal(normalizePreferences({autoCaptcha:true,manualCaptchaAssist:true}).manualCaptchaAssist,false);
  const prefs=normalizePreferences({manualCaptchaAssist:false});
  assert.equal(normalizePreferences(JSON.parse(JSON.stringify(prefs))).manualCaptchaAssist,false);
});
test('보안문자는 이전 자동 해제 설정과 저장·복원에도 항상 자동 적용한다',()=>{
  assert.equal(normalizePreferences().autoCaptcha,true);
  assert.equal(normalizePreferences({quantity:3,autoNotice:false}).autoCaptcha,true);
  const manual=normalizePreferences({autoCaptcha:false});
  assert.equal(manual.autoCaptcha,true);
  assert.equal(normalizePreferences(JSON.parse(JSON.stringify(manual))).autoCaptcha,true);
});
test('기본 구역 목록은 동등한 허용 범위로 통로·앞열을 비교한다',()=>{const seats=[make(1,1,{grade:'3루 네이비석'}),make(1,2,{grade:'3루 네이비석'}),make(10,1),make(10,2)];assert.equal(rankGroups(seats,{areas:['3루 레드석','3루 네이비석']})[0].seats[0].row,1);});
test('이전 통로 설정도 앞열 다음 통로 거리 순서로 통일한다',()=>{const seats=[make(1,5),make(1,6),make(3,1),make(3,2)];assert.equal(rankGroups(seats,{priority:'front'})[0].seats[0].row,1);assert.equal(rankGroups(seats,{priority:'aisle'})[0].seats[0].row,1);assert.equal(normalizePreferences({priority:'aisle'}).priority,'front');});
test('시야방해 및 미확인 좌석은 기본 제외한다',()=>{const seats=[make(1,1,{obstructed:true}),make(1,2),make(2,1,{obstructed:null}),make(2,2)];assert.equal(rankGroups(seats,{}).length,0);});

test('휠체어·장애인석은 기본 제외하며 명시적 해제만 허용한다',()=>{
  const seats=[make(1,1,{grade:'1루 휠체어장애인석'}),make(2,1)];
  assert.equal(rankGroups(seats,{quantity:1}).length,1);
  assert.equal(rankGroups(seats,{quantity:1,excludeRestricted:false}).length,2);
  const grades=[{name:'1루 휠체어장애인석',count:1},{name:'3루 레드석',count:1}];
  assert.deepEqual(gradePlan(grades,{quantity:1}).map(g=>g.name),['3루 레드석']);
  assert.equal(gradePlan(grades,{quantity:1,excludeRestricted:false}).length,2);
});
test('번호가 연속이어도 인접 정보상 통로를 건너면 연석으로 보지 않는다',()=>{assert.equal(rankGroups([make(1,1,{neighbors:[]}),make(1,2,{neighbors:[]})],{}).length,0);});
test('반드시 연석 옵션은 분산 좌석으로 대체하지 않는다',()=>{const seats=[make(1,1),make(2,1)];assert.equal(rankGroups(seats,{}).length,0);assert.equal(rankGroups(seats,{requireTogether:false})[0].together,false);});
test('다른 블럭과 행을 합친 연석은 생성하지 않는다',()=>{assert.equal(rankGroups([make(1,1),make(1,2,{block:'119'})],{}).length,0);});
test('실제 클라이언트 형식의 colIdx 간격과 행 끝을 파싱한다',()=>{const raw=[{blockKey:'001:118',seats:[1,2,5].map(n=>({seatInfoId:`test:${n}`,rowIdx:0,colIdx:n,rowNo:'1',seatNo:String(n),seatGrade:'R',isExposable:true,seatGroupId:null}))}];const meta=parseMetadata(raw);assert.equal(meta[0].aisle,true);assert.deepEqual(meta[1].neighbors,['seat_block_test:1']);assert.notEqual(meta[1].segment,meta[2].segment);});
test('등급명 연결이 안 된 좌석은 정상 시야라고 추측하지 않는다',()=>{const m=new Map([['s',{gradeCode:'R',row:1,number:1,exposable:true,grouped:false}]]);assert.equal(enrich([{id:'s',available:true}],m,new Map())[0].obstructed,null);assert.equal(enrich([{id:'s',available:true}],m,new Map([['R','[시야방해] 3루 레드석']]))[0].obstructed,true);});
test('메타데이터 응답 경로를 제한한다',()=>{assert.equal(metadataUrl('https://tickets.interpark.com/onestop/api/seatMeta?blockKeys=001:118'),true);assert.equal(metadataUrl('https://tickets.interpark.com/onestop/api/member'),false);assert.equal(metadataUrl('https://evil.test/onestop/api/seatMeta'),false);});
test('조건 묶음의 열 범위·통로 조건을 검증하고 기존 설정을 보존한다',()=>{
  assert.deepEqual(normalizePreferences({areas:'A, B',tiers:[]}).areas,['A','B']);
  const p=normalizePreferences({tiers:[{enabled:false,minRow:-1},{name:'앞열 통로',areas:'A,B,A',blocks:'118,117',minRow:'1',maxRow:'5',aisle:'required'}]});
  assert.equal(p.tiers.length,1);assert.deepEqual(p.tiers[0].areas,['A','B']);assert.equal(p.tiers[0].maxRow,5);assert.equal(p.tiers[0].aisle,'prefer');
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
test('열 범위 양 끝을 포함하고 이전 통로 필수도 거리 선호로 변환한다',()=>{
  const seats=[make(1,1),make(1,2),make(5,1),make(5,2),make(6,1),make(6,2),make(3,1,{aisle:null}),make(3,2,{aisle:false})];
  const groups=rankGroups(seats,{fallbackAnywhere:false,tiers:[{minRow:1,maxRow:5,aisle:'required'}]});assert.deepEqual(groups.map(g=>g.seats[0].row),[1,3,5]);
});
test('이전 통로 제한 없음 설정에도 고정 앞열 선호를 적용한다',()=>{
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
  const plan=gradePlan(grades,{fallbackAnywhere:false,tiers:[{name:'앞열',areas:['A','B']},{name:'뒤열',areas:['A']}]});
  assert.deepEqual(plan.map(p=>[p.name,p.tierIndex]),[['B',0],['A',0],['A',1]]);
  assert.deepEqual(gradePlan(grades,{areas:['A','B'],fallbackAnywhere:false}).map(p=>p.name),['B','A']);
});
test('unknown grade inventory is explored while explicit zero remains excluded',()=>{
  const {gradePlan}=require('../src/preferences');
  for(const count of [null,undefined,'','잔여석 미표시'])assert.equal(gradePlan([{name:'블루존',count}],{quantity:2}).length,1);
  for(const count of [0,'0',1])assert.equal(gradePlan([{name:'블루존',count}],{quantity:2}).length,0);
});

test('grade assessment distinguishes sold-out allowed inventory from restricted stock',()=>{
  const result=assessGradePlan([{name:'일반석',count:'0'},{name:'휠체어석',count:'5'}],{quantity:1});
  assert.equal(result.reason,'inventory-empty');assert.equal(result.plan.length,0);
  assert.deepEqual(result.grades.map(g=>g.reasons),[['inventory-empty'],['restricted']]);
  assert.equal(result.summary.emptyCount,1);assert.equal(result.summary.restrictedCount,1);
});

test('grade assessment identifies quantity shortage, missing area and unknown inventory separately',()=>{
  assert.equal(assessGradePlan([{name:'일반석',count:1}],{quantity:2}).reason,'inventory-insufficient');
  const excluded=assessGradePlan([{name:'일반석',count:5}],{quantity:1,areas:['테이블석'],fallbackAnywhere:false});
  assert.equal(excluded.reason,'conditions-excluded');assert.deepEqual(excluded.grades[0].reasons,['area-mismatch']);
  const unknown=assessGradePlan([{name:'일반석',count:'미표시'}],{quantity:2});
  assert.equal(unknown.reason,'ready');assert.equal(unknown.grades[0].count,null);assert.equal(unknown.summary.unknownCount,1);
});

test('grade diagnostic eligibility and actual plans use the same tier and exclusion rules',()=>{
  const grades=[{name:'블루 존',code:'B',count:'1,000'},{name:'시야방해석',code:'C',count:100},{name:'레드석',code:'R',count:4}];
  const preferences={quantity:2,fallbackAnywhere:false,tiers:[{areas:['B']},{areas:['레드석','시야방해석']},{areas:['블루존']}]};
  const result=assessGradePlan(grades,preferences);
  assert.deepEqual(result.plan,gradePlan(grades,preferences));
  assert.deepEqual(result.plan.map(g=>[g.name,g.tierIndex]),[['블루 존',0],['레드석',1],['블루 존',2]]);
  assert.equal(result.summary.eligibleGradeCount,2);assert.equal(result.summary.obstructedCount,1);
  assert.equal(assessGradePlan([],preferences).reason,'no-grades');
});

test('전체 구역 대안은 기본 켜짐이고 장애인석 제외와 별도로 저장·복원된다',()=>{
  const defaults=normalizePreferences();
  assert.equal(defaults.fallbackAnywhere,true);assert.equal(defaults.excludeRestricted,true);
  for(const fallbackAnywhere of [true,false])for(const excludeRestricted of [true,false]){
    const restored=normalizePreferences(JSON.parse(JSON.stringify(normalizePreferences({fallbackAnywhere,excludeRestricted}))));
    assert.equal(restored.fallbackAnywhere,fallbackAnywhere);assert.equal(restored.excludeRestricted,excludeRestricted);
  }
});

test('우선순위가 없으면 제한 없는 단일 순위로 전체 구역을 탐색한다',()=>{
  const grades=[{name:'1루 일반석',count:3},{name:'3루 내야지정석',count:3},{name:'중앙석',count:3}];
  const plan=gradePlan(grades,{});
  assert.deepEqual(plan.map(g=>g.name),['3루 내야지정석','중앙석','1루 일반석']);
  assert.ok(plan.every(g=>g.tierIndex===0&&!g.fallback));
  assert.equal(rankGroups([make(1,1),make(1,2)],{})[0].fallback,false);
});

test('명시 우선순위를 먼저 탐색한 뒤 전체 구역 대안을 마지막에 추가한다',()=>{
  const grades=[{name:'3루 익사이팅석',count:3},{name:'1루 지정석',count:3},{name:'중앙 내야석',count:3}];
  const p={quantity:1,tiers:[{name:'원래 선호',areas:['1루 지정석']},{name:'두 번째',areas:['중앙 내야석']}]};
  const plan=gradePlan(grades,p);
  assert.deepEqual(plan.map(g=>[g.name,g.tierIndex,g.fallback]),[
    ['1루 지정석',0,false],['중앙 내야석',1,false],
    ['3루 익사이팅석',2,true]
  ]);
  const seats=grades.map((g,i)=>make(i+1,1,{grade:g.name})),groups=rankGroups(seats,p);
  assert.deepEqual(groups.map(g=>[g.seats[0].grade,g.tierIndex,g.fallback]),[
    ['1루 지정석',0,false],['중앙 내야석',1,false],['3루 익사이팅석',2,true]
  ]);
  assert.equal(groups[2].tierName,'전체 구역 대안');
});

test('대안은 구역·블록·열 범위를 함께 완화하며 실제 계획의 tierIndex로 탐색한다',()=>{
  const seats=[make(2,1,{grade:'3루 내야석',block:'120'})];
  const p={quantity:1,tiers:[{areas:['1루 지정석'],blocks:['101'],minRow:10,maxRow:20}]};
  const plan=gradePlan([{name:'3루 내야석',count:2}],p);
  assert.equal(plan.length,1);assert.equal(plan[0].tierIndex,1);assert.equal(plan[0].fallback,true);
  assert.equal(rankGroups(seats,p,{tierIndex:0}).length,0);
  assert.equal(rankGroups(seats,p,{tierIndex:plan[0].tierIndex})[0].seats[0].id,seats[0].id);
  assert.equal(rankGroups(seats,{...p,fallbackAnywhere:false}).length,0);
  assert.equal(gradePlan([{name:'3루 내야석',count:2}],{...p,fallbackAnywhere:false}).length,0);
});

test('구형 구역·블록 설정에도 전체 구역 대안이 적용된다',()=>{
  const p={quantity:1,areas:['1루 지정석'],blocks:['101']};
  const group=rankGroups([make(1,1)],p)[0];
  assert.equal(group.tierIndex,1);assert.equal(group.fallback,true);
  assert.equal(assessGradePlan([{name:'3루 레드석',count:1}],p).reason,'ready');
});

test('명시 순위에 이미 제한 없는 항목이 있으면 중복 전체 구역 순위를 만들지 않는다',()=>{
  const p={quantity:1,tiers:[{areas:['1루 지정석']},{name:'모든 좌석'}]};
  const plan=gradePlan([{name:'3루 지정석',count:2}],p);
  assert.equal(plan.length,1);assert.equal(plan[0].tierIndex,1);assert.equal(plan[0].fallback,false);
  const groups=rankGroups([make(1,1)],p);assert.equal(groups.length,1);assert.equal(groups[0].tierIndex,1);
});

test('전체 구역 대안에서도 매수·연석·시야 및 장애인석 제외는 유지된다',()=>{
  const p={quantity:2,tiers:[{areas:['없는 선호 구역']}]};
  const seats=[make(1,1),make(2,1),make(3,1,{obstructed:true}),make(3,2,{obstructed:true}),make(4,1,{grade:'중앙 휠체어장애인석'}),make(4,2,{grade:'중앙 휠체어장애인석'})];
  assert.equal(rankGroups(seats,p).length,0);
  const dispersed=rankGroups(seats,{...p,requireTogether:false})[0];
  assert.equal(dispersed.seats.length,2);assert.equal(dispersed.together,false);assert.ok(dispersed.seats.every(s=>s.grade==='3루 레드석'&&!s.obstructed));
  const accessible=rankGroups(seats,{...p,excludeRestricted:false})[0];
  assert.equal(accessible.seats.length,2);assert.equal(accessible.together,true);assert.equal(accessible.seats[0].grade,'중앙 휠체어장애인석');
  const obstructed=rankGroups(seats,{...p,excludeObstructed:false})[0];
  assert.ok(obstructed.seats.every(s=>s.obstructed));
});

test('일반석 매진 때 장애인석은 포함 설정을 켰을 때만 대안으로 탐색한다',()=>{
  const grades=[{name:'일반석',count:0},{name:'3루 내야휠체어장애인석',count:2}],p={quantity:1,areas:['일반석']};
  assert.equal(gradePlan(grades,p).length,0);
  const plan=gradePlan(grades,{...p,excludeRestricted:false});
  assert.equal(plan.length,1);assert.equal(plan[0].name,'3루 내야휠체어장애인석');assert.equal(plan[0].fallback,true);
  assert.equal(gradePlan(grades,{...p,quantity:3,excludeRestricted:false}).length,0);
});

test('기본 구역 선호는 이름에 있는 방향과 가까운 구역 표기만 사용한다',()=>{
  const names=['VIP석','3루 외야석','중앙 내야석','1루 익사이팅석','3루 익사이팅석','중앙석','블루존','3루 내야석'];
  const plan=gradePlan(names.map(name=>({name,count:1})),{quantity:1});
  assert.deepEqual(plan.map(g=>g.name),['3루 익사이팅석','중앙 내야석','3루 내야석','3루 외야석','중앙석','1루 익사이팅석','VIP석','블루존']);
  const unknown=rankGroups([make(2,1,{grade:'일반석',block:'101'}),make(1,1,{grade:'일반석',block:'999'})],{quantity:1});
  assert.equal(unknown[0].seats[0].block,'999');
});

test('명시 선호 구역 안에서도 앞열·통로 순서이며 전체 구역 대안보다 항상 앞선다',()=>{
  const p={quantity:1,tiers:[{areas:['1루 지정석']}]};
  const groups=rankGroups([make(10,1,{grade:'1루 지정석'}),make(5,5,{grade:'1루 지정석',aisleDistance:4}),make(1,1,{grade:'3루 익사이팅석'})],p);
  assert.deepEqual(groups.map(g=>[g.seats[0].row,g.tierIndex]),[[5,0],[10,0],[1,1]]);
});

test('전체 구역 대안은 실패한 좌석·조합을 재선택하지 않는다',()=>{
  const p={quantity:1,areas:['없는 구역']},seats=[make(1,1),make(2,1),make(3,1)];
  const groups=rankGroups(seats,p,{tierIndex:1,excludedIds:[seats[0].id],excludedGroups:[groupKey([seats[1]])]});
  assert.equal(groups.length,1);assert.equal(groups[0].seats[0].id,seats[2].id);assert.equal(groups[0].fallback,true);
});

test('이미 전체를 확인한 구역은 대안에서 다시 열지 않고 행·블록 제한 구역만 재확인한다',()=>{
  const grades=[{name:'A',count:4},{name:'B',count:4},{name:'C',count:4}],p={quantity:1,tiers:[{areas:['A'],maxRow:5},{areas:['B'],blocks:['101']},{areas:['C']}]};
  const plan=gradePlan(grades,p);
  assert.deepEqual(plan.map(g=>[g.name,g.tierIndex]),[['A',0],['B',1],['C',2],['A',3],['B',3]]);
  const seats=[make(10,1,{grade:'A',block:'102'}),make(10,2,{grade:'B',block:'102'}),make(10,3,{grade:'C',block:'102'})];
  assert.deepEqual(rankGroups(seats,p,{tierIndex:3}).map(g=>g.seats[0].grade),['A','B']);
});

test('기본 구역 목록 전체를 확인했다면 대안은 목록 밖 구역만 추가한다',()=>{
  const p={quantity:1,areas:['A','B']};
  assert.deepEqual(gradePlan([{name:'A',count:3},{name:'B',count:3}],p).map(g=>[g.name,g.tierIndex]),[['A',0],['B',0]]);
  assert.deepEqual(gradePlan([{name:'A',count:3},{name:'C',count:3}],p).map(g=>[g.name,g.tierIndex]),[['A',0],['C',1]]);
  assert.equal(rankGroups([make(1,1,{grade:'A'})],p,{tierIndex:1}).length,0);
});
