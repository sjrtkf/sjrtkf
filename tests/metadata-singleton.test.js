'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMetadata,parseSeatLabels,enrich,assessSeatRead,isWheelchairSingleton}=require('../src/metadata');
const {rankGroups,gradePlan}=require('../src/preferences');

const grade='1루 K5 휠체어장애인석';
function raw(id='goods:place:001:1',extra={}){
  return {seatInfoId:id,rowNo:'104블록',seatNo:'W4-1',rowIdx:34,colIdx:8,seatGrade:'30',seatGradeName:grade,isExposable:true,seatGroupId:id+'::1::1',...extra};
}
function rows(blocks,available=()=>true){
  const meta=parseMetadata(blocks);
  return enrich(meta.map(s=>({kind:'seat',id:s.id,available:available(s)})),new Map(meta.map(s=>[s.id,s])),new Map([['30',grade]]));
}
const allowed={quantity:1,excludeRestricted:false};

test('observed wheelchair block labels retain opaque names and enable only the verified singleton group',()=>{
  const read=rows([{blockKey:'001:104',seats:[raw()]}]),seat=read[0];
  assert.equal(seat.singletonGroup,true);assert.equal(seat.labelFormat,'wheelchair-block');assert.equal(seat.groupSize,1);
  assert.equal(seat.seatGroupId,'goods:place:001:1::1::1');assert.equal(seat.row,null);assert.equal(seat.number,null);assert.equal(seat.rowLabel,null);
  assert.equal(seat.rawRowLabel,'104블록');assert.equal(seat.rawSeatNumber,'W4-1');assert.equal(seat.rowIdx,34);assert.equal(seat.colIdx,8);
  assert.equal(seat.label,grade+' · 104블록 W4-1번');assert.equal(seat.grouped,true);assert.equal(seat.exposable,true);assert.equal(seat.available,true);
  assert.equal(isWheelchairSingleton(seat),true);assert.equal(rankGroups(read,allowed).length,1);
  const diagnosis=assessSeatRead(read);assert.equal(diagnosis.unsupportedRowCount,0);assert.equal(diagnosis.unsupportedNumberCount,0);assert.equal(diagnosis.groupedCount,0);assert.deepEqual(diagnosis.seatSamples[0].reasons,[]);
});

test('a nearby non-exposed W suffix 2 is not silently treated as a companion or a selectable seat',()=>{
  const read=rows([{blockKey:'001:104',seats:[raw(),raw('goods:place:001:2',{seatNo:'W4-2',colIdx:7,seatGrade:null,seatGradeName:null,isExposable:false,seatGroupId:null})]}]);
  const exposed=read.find(s=>s.rawSeatNumber==='W4-1'),hidden=read.find(s=>s.rawSeatNumber==='W4-2');
  assert.equal(exposed.singletonGroup,true);assert.equal(hidden.singletonGroup,false);assert.equal(hidden.available,false);
  const groups=rankGroups(read,allowed);assert.equal(groups.length,1);assert.equal(groups[0].seats[0].rawSeatNumber,'W4-1');
});

test('all members of a group count even when a second member is hidden or cannot be parsed',()=>{
  const first=raw(),hidden=raw('goods:place:001:2',{rowIdx:null,isExposable:false,seatGroupId:first.seatGroupId});
  const read=rows([{blockKey:'001:104',seats:[first,hidden]}]);
  assert.equal(read.length,1);assert.equal(read[0].groupSize,2);assert.equal(read[0].singletonGroup,false);assert.equal(read[0].available,false);
  assert.equal(rankGroups(read,allowed).length,0);
  const cross=rows([{blockKey:'001:104',seats:[first]},{blockKey:'001:106',seats:[{...hidden,rowIdx:35,rowNo:'106블록'}]}]);
  assert.equal(cross[0].groupSize,2);assert.ok(cross.every(s=>!s.singletonGroup));assert.equal(rankGroups(cross,allowed).length,0);
});

test('unverified group labels and shapes are not granted singleton support',()=>{
  const invalid=[
    {rowNo:'105블록'},{rowNo:'104구역'},{seatNo:'W4-2'},{seatNo:'W4'},{seatNo:'W0-1'},
    {seatGroupId:'other-seat::1::1'},{seatGroupId:'goods:place:001:1::2::1'},{seatGroupId:null},
    {seatGradeName:'일반 테이블석'},{seatGradeName:null},{seatGrade:null},{isExposable:false},{rowIdx:-1},{colIdx:-1}
  ];
  for(const extra of invalid){const read=rows([{blockKey:'001:104',seats:[raw(undefined,extra)]}]);assert.equal(read[0].singletonGroup,false,JSON.stringify(extra));assert.equal(rankGroups(read,allowed).length,0,JSON.stringify(extra));}
  const regularGroup=rows([{blockKey:'001:104',seats:[raw(undefined,{rowNo:'1',seatNo:'1',seatGradeName:'일반석'})]}]);
  assert.equal(regularGroup[0].available,false);assert.equal(rankGroups(regularGroup,allowed).length,0);
});

test('restricted option, live availability and one-ticket limit remain mandatory for singleton selection',()=>{
  const read=rows([{blockKey:'001:104',seats:[raw(),raw('goods:place:001:3',{seatNo:'W5-1',colIdx:4})]}]);
  assert.equal(rankGroups(read,{quantity:1}).length,0);
  for(const requireTogether of [true,false])assert.equal(rankGroups(read,{quantity:2,excludeRestricted:false,requireTogether}).length,0);
  assert.equal(rankGroups(read,{quantity:1,excludeRestricted:false}).length,2);
  const unavailable=rows([{blockKey:'001:104',seats:[raw()]}],()=>false);
  assert.equal(unavailable[0].domAvailable,false);assert.equal(unavailable[0].available,false);assert.equal(rankGroups(unavailable,allowed).length,0);
});

test('unknown numbered rows cannot satisfy explicit row limits and are eligible only in the unrestricted alternative',()=>{
  const read=rows([{blockKey:'001:104',seats:[raw()]}]),p={...allowed,tiers:[{areas:[grade],minRow:1,maxRow:100}]};
  assert.equal(rankGroups(read,p,{tierIndex:0}).length,0);
  const all=rankGroups(read,p);assert.equal(all.length,1);assert.equal(all[0].tierIndex,1);assert.equal(all[0].fallback,true);
  assert.equal(rankGroups(read,{...p,fallbackAnywhere:false}).length,0);
  assert.deepEqual(gradePlan([{name:grade,count:1}],p).map(g=>g.tierIndex),[0,1]);
});

test('physical row and column indices rank verified singletons without converting block or W labels to row numbers',()=>{
  const read=rows([
    {blockKey:'001:106',seats:[raw('goods:place:001:12',{rowNo:'106블록',seatNo:'W12-1',rowIdx:35,colIdx:8}),raw('goods:place:001:13',{rowNo:'106블록',seatNo:'W13-1',rowIdx:35,colIdx:4})]},
    {blockKey:'001:104',seats:[raw()]}
  ]);
  const ranked=rankGroups(read,allowed);assert.deepEqual(ranked.map(g=>g.seats[0].rawSeatNumber),['W4-1','W13-1','W12-1']);
  assert.ok(ranked.every(g=>g.seats[0].row===null&&g.seats[0].number===null));
});

test('a forged singleton flag cannot bypass mismatched metadata fields',()=>{
  const [seat]=rows([{blockKey:'001:104',seats:[raw()]}]);
  for(const bad of [{groupSize:2},{seatGroupId:'wrong'},{labelFormat:'table'},{rawRowLabel:'105블록'},{rawSeatNumber:'W4-2'},{grade:'일반석'},{rowIdx:-1},{exposable:false}]){
    assert.equal(isWheelchairSingleton({...seat,...bad}),false);
    assert.equal(rankGroups([{...seat,...bad}],allowed).length,0);
  }
});

test('standalone extension parser retains verified singleton evidence and rejects duplicate members',()=>{
  const parse=require('node:vm').runInNewContext('const parseSeatLabels='+parseSeatLabels.toString()+';('+parseMetadata.toString()+')');
  const result=parse([{blockKey:'001:104',seats:[raw()]}]);assert.equal(result[0].singletonGroup,true);assert.equal(result[0].row,null);assert.equal(result[0].number,null);
  const duplicate=parse([{blockKey:'001:104',seats:[raw(),raw('goods:place:001:2',{seatGroupId:raw().seatGroupId})]}]);
  assert.ok(duplicate.every(s=>s.groupSize===2&&!s.singletonGroup));
});
