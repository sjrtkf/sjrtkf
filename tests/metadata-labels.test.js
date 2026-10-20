'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMetadata,parseSeatLabels}=require('../src/metadata');

test('shared label parser normalizes numeric spelling without changing row identity',()=>{
  assert.deepEqual(parseSeatLabels('01열','007번'),{row:1,rowLabel:'1',rowKind:'numeric',number:7});
  assert.deepEqual(parseSeatLabels(2,3),{row:2,rowLabel:'2',rowKind:'numeric',number:3});
  assert.deepEqual(parseSeatLabels('A열','01'),{row:1,rowLabel:'A',rowKind:'alpha',number:1});
  assert.deepEqual(parseSeatLabels('W1구역 10열','4'),{row:10,rowLabel:'10',rowKind:'numeric',number:4,blockName:'W1구역'});
  assert.notDeepEqual(parseSeatLabels('A','1'),parseSeatLabels('1','1'));
});

test('opaque, unobserved and unsafe labels stay unresolved',()=>{
  for(const row of ['104블록','A1',' A','1열 뒤','9007199254740993',{},null])assert.equal(parseSeatLabels(row,'1').row,null);
  for(const number of ['W4-1','1-2',' 1','9007199254740993',{},null])assert.equal(parseSeatLabels('1',number).number,null);
});

test('football display block names are separate from numeric transport block codes',()=>{
 for(const name of ['WF','WG','W나']){
  const [seat]=parseMetadata([{blockKey:'001:004',seats:[{seatInfoId:'football',rowIdx:4,colIdx:9,rowNo:name+'구역 5열',seatNo:'14',seatGrade:'3',seatGradeName:'W1석(일반석)',isExposable:true}]}]);
  assert.equal(seat.block,'004');assert.equal(seat.blockKey,'001:004');assert.equal(seat.blockName,name+'구역');assert.equal(seat.row,5);assert.equal(seat.number,14);
 }
});

test('captured metadata and serialized validation share the exact same normalized labels',()=>{
  const parse=require('node:vm').runInNewContext('('+parseSeatLabels.toString()+')');
  for(const [rowNo,seatNo] of [['01','001'],['A열','02번'],['W1구역 12열','3'],['104블록','W4-1']]){
    const [seat]=parseMetadata([{blockKey:'001:104',seats:[{seatInfoId:'seat',rowNo,seatNo,rowIdx:0,colIdx:0,seatGrade:'1',isExposable:true}]}]);
    const expected=JSON.parse(JSON.stringify(parse(rowNo,seatNo)));
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k=>[k,seat[k]])),expected);
  }
});
