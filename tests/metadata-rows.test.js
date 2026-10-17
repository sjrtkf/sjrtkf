'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMetadata,enrich}=require('../src/metadata');
const {rankGroups}=require('../src/preferences');
function seat(id,rowNo,rowIdx,colIdx,extra={}){
  return {seatInfoId:id,rowNo,rowIdx,colIdx,seatNo:String(colIdx+1),seatGrade:'W',isExposable:true,seatGroupId:null,...extra};
}
function read(seats){
  const parsed=parseMetadata([{blockKey:'W:본부석',seats}]);
  return enrich(parsed.map(s=>({id:s.id,available:true,label:'좌석'})),new Map(parsed.map(s=>[s.id,s])),new Map([['W','본부석 일반']]));
}
test('uppercase letter metadata produces ranked adjacent seats and retains the original row label',()=>{
  const rows=read([seat('b1','B',1,0),seat('b2','B',1,1),seat('a1','A',0,0),seat('a2','A',0,1)]);
  const groups=rankGroups(rows,{quantity:2,tiers:[{minRow:1,maxRow:2}]});
  assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.seats[0].rowLabel),['A','B']);
  assert.equal(groups[0].seats[0].row,1);assert.equal(groups[0].seats[0].rowKind,'alpha');
  assert.equal(groups[0].seats[0].label,'본부석 일반 · 본부석블럭 A열 1번');
  assert.equal(groups.every(group=>group.together),true);
});
test('A through Z use one-based ordinals and optional Korean row suffix without inventing other formats',()=>{
  const labels=Array.from({length:26},(_,i)=>String.fromCharCode(65+i));
  const rows=read(labels.map((label,i)=>seat('row'+i,label+(i%2?'열':''),i,0)));
  assert.deepEqual(rows.map(s=>s.row),Array.from({length:26},(_,i)=>i+1));
  assert.deepEqual(rows.map(s=>s.rowLabel),labels);
  const groups=rankGroups(rows,{quantity:1,tiers:[{minRow:21,maxRow:26}]});
  assert.deepEqual(groups.map(g=>g.seats[0].rowLabel),['U','V','W','X','Y','Z']);
});
test('unknown or mixed label formats remain ineligible instead of being guessed',()=>{
  const labels=['AA','A1','1A','A-1','A/B','A석','a','a열',' A','A ','Ａ','열A','1.5',null,''];
  const rows=read(labels.map((label,i)=>seat('bad'+i,label,i,0)));
  assert.ok(rows.every(s=>s.row===null&&s.rowLabel===null&&s.rowKind===null));
  assert.equal(rankGroups(rows,{quantity:1}).length,0);
});

test('observed football area-qualified rows rank by row, not the digits in the area code',()=>{
  const rows=read([seat('back','W1구역 10열',9,34),seat('front','W1구역 2열',1,34)]);
  const groups=rankGroups(rows,{quantity:1,priority:'front'});
  assert.deepEqual(groups.map(g=>g.seats[0].row),[2,10]);
  assert.deepEqual(rows.map(s=>s.rowLabel),['10','2']);
  const bad=read(['W1구역 10열 5번','W1 10','W1구역 10~12열','10열 뒤쪽'].map((s,i)=>seat('bad'+i,s,i,0)));
  assert.equal(rankGroups(bad,{quantity:1}).length,0);
});
test('the A ordinal never merges alphabetic and numeric rows into one adjacent group',()=>{
  const rows=read([seat('alpha','A',0,0),seat('number','1',0,1)]);
  assert.deepEqual(rows.map(s=>s.row),[1,1]);
  assert.equal(rows[0].neighbors.includes(rows[1].id),true);
  assert.equal(rankGroups(rows,{quantity:2}).length,0);
});
test('alphabetic row labels cannot create adjacency across a gap or a different physical row',()=>{
  const gap=read([seat('a','A',0,0),seat('b','A',0,2)]);
  assert.notEqual(gap[0].segment,gap[1].segment);assert.equal(rankGroups(gap,{quantity:2}).length,0);
  const differentRows=read([seat('a','A',0,0),seat('b','A',1,1)]);
  assert.equal(rankGroups(differentRows,{quantity:2}).length,0);
  const contiguous=read([seat('a','A',0,0),seat('b','A',0,1)]);
  assert.equal(rankGroups(contiguous.map(s=>({...s,neighbors:[]})),{quantity:2}).length,0);
});
test('existing numeric rows and legacy metadata keep their previous ranking and display behavior',()=>{
  const rows=read([seat('front1','01',0,0),seat('front2','1열',0,1),seat('back1',2,1,0),seat('back2','2',1,1)]);
  const groups=rankGroups(rows,{quantity:2});
  assert.deepEqual(groups.map(g=>g.seats[0].row),[1,2]);assert.ok(rows.every(s=>s.rowKind==='numeric'));
  assert.equal(groups[0].seats[0].label,'본부석 일반 · 본부석블럭 1열 1번');
  assert.equal(rankGroups(rows.map(({rowKind,rowLabel,...rest})=>rest),{quantity:2}).length,2);
  const legacy=enrich([{id:'legacy',available:true}],new Map([['legacy',{row:3,number:7,block:'1',grade:'일반',exposable:true,grouped:false}]]));
  assert.equal(legacy[0].label,'일반 · 1블럭 3열 7번');
});
test('the metadata parser remains self-contained when serialized for the Chrome extension',()=>{
  const vm=require('node:vm'),parse=vm.runInNewContext('('+parseMetadata.toString()+')');
  const result=parse([{blockKey:'W:본부석',seats:[seat('alpha','A',0,0)]}]);
  assert.equal(result[0].row,1);assert.equal(result[0].rowLabel,'A');assert.equal(result[0].rowKind,'alpha');
});
