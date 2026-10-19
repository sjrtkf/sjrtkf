'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseMetadata,parseSeatLabels,enrich,assessSeatRead}=require('../src/metadata');
const {rankGroups}=require('../src/preferences');

function rawSeat(id,extra={}){return {seatInfoId:id,rowNo:'1',seatNo:'1',rowIdx:0,colIdx:0,seatGrade:'29',isExposable:true,seatGroupId:null,...extra};}
function read(raw,dom={}){
  const parsed=parseMetadata([{blockKey:'29:K9',seats:raw}]);
  return enrich(parsed.map(s=>({kind:'seat',id:s.id,available:true,...dom})),new Map(parsed.map(s=>[s.id,s])),new Map([['29','1루 K9 휠체어장애인석']]));
}

test('unsupported seat labels are retained for diagnosis without inventing a row or seat number',()=>{
  const rows=read([rawSeat('wheelchair',{rowNo:'휠체어 A',seatNo:'동반 1',isExposable:false,seatGroupId:'private-group-id'})]);
  const row=rows[0];
  assert.equal(row.hasMetadata,true);assert.equal(row.rawRowLabel,'휠체어 A');assert.equal(row.rawSeatNumber,'동반 1');
  assert.equal(row.row,null);assert.equal(row.number,null);assert.equal(row.domAvailable,true);assert.equal(row.available,false);
  assert.equal(row.exposable,false);assert.equal(row.grouped,true);
  assert.equal(rankGroups(rows,{quantity:1,excludeRestricted:false,excludeObstructed:false}).length,0);
  const result=assessSeatRead(rows);
  assert.deepEqual({...result,seatSamples:undefined},{missingMetadataCount:0,unsupportedRowCount:1,unsupportedNumberCount:1,nonExposableCount:1,groupedCount:1,seatSamples:undefined});
  assert.deepEqual(result.seatSamples[0].reasons,['row-format-unsupported','number-format-unsupported','non-exposable','grouped-seat']);
  assert.ok(!JSON.stringify(result).includes('private-group-id'));
});

test('missing metadata is distinct from metadata whose labels cannot be parsed',()=>{
  const missing=enrich([{kind:'seat',id:'missing',available:true}],new Map(),new Map())[0];
  const unsupported=read([rawSeat('unsupported',{rowNo:'미확인',seatNo:'미확인'})])[0];
  const result=assessSeatRead([missing,unsupported,{kind:'grade',available:true}]);
  assert.equal(missing.hasMetadata,false);assert.equal(missing.domAvailable,true);
  assert.equal(result.missingMetadataCount,1);assert.equal(result.unsupportedRowCount,1);assert.equal(result.unsupportedNumberCount,1);
  assert.equal(result.nonExposableCount,0);assert.equal(result.groupedCount,0);
  assert.deepEqual(result.seatSamples[0].reasons,['metadata-missing']);
  assert.deepEqual(result.seatSamples[1].reasons,['row-format-unsupported','number-format-unsupported']);
});

test('diagnostic raw fields are at most 80 characters and never serialize objects or unrelated fields',()=>{
  const parsed=parseMetadata([{blockKey:'29:K9',seats:[
    rawSeat('long',{rowNo:'R'.repeat(120),seatNo:'N'.repeat(120),sessionId:'session-secret',Authorization:'auth-secret',salesPrice:'price-secret'}),
    rawSeat('object',{colIdx:1,rowNo:{sessionId:'nested-secret'},seatNo:{token:'nested-token'}}),
    rawSeat('numeric',{colIdx:2,rowNo:4,seatNo:7})
  ]}]);
  assert.equal(parsed[0].rawRowLabel.length,80);assert.equal(parsed[0].rawSeatNumber.length,80);
  assert.equal(parsed[0].row,null);assert.equal(parsed[0].number,null);
  assert.equal(parsed[1].rawRowLabel,null);assert.equal(parsed[1].rawSeatNumber,null);
  assert.equal(parsed[2].rawRowLabel,'4');assert.equal(parsed[2].rawSeatNumber,'7');
  for(const secret of ['session-secret','auth-secret','price-secret','nested-secret','nested-token'])assert.ok(!JSON.stringify(parsed).includes(secret));
});

test('seat samples whitelist bounded diagnostics and omit seat identities, authentication and prices',()=>{
  const row={kind:'seat',id:'private-seat-id',hasMetadata:true,gradeCode:'C'.repeat(120),grade:'G'.repeat(120),block:'B'.repeat(120),rowLabel:'L'.repeat(120),rawRowLabel:'R'.repeat(120),rawSeatNumber:'N'.repeat(120),row:1,number:1,rowIdx:2,colIdx:3,exposable:true,grouped:false,domAvailable:true,sessionId:'session-secret',token:'token-secret',prices:{salesPrice:'price-secret'},cookie:'cookie-secret'};
  const result=assessSeatRead([row]),sample=result.seatSamples[0];
  assert.deepEqual(Object.keys(sample).sort(),['gradeCode','grade','block','rowLabel','rawRowLabel','rawSeatNumber','rowIdx','colIdx','hasMetadata','exposable','grouped','domAvailable','reasons'].sort());
  for(const key of ['gradeCode','grade','block','rowLabel','rawRowLabel','rawSeatNumber'])assert.equal(sample[key].length,80);
  assert.deepEqual(sample.reasons,[]);
  for(const secret of ['private-seat-id','session-secret','token-secret','price-secret','cookie-secret'])assert.ok(!JSON.stringify(result).includes(secret));
});

test('samples cap at eight and prioritize excluded seats while counts include the whole map',()=>{
  const valid=Array.from({length:12},(_,i)=>({kind:'seat',hasMetadata:true,grade:'일반',gradeCode:'1',block:'A',row:1,number:i+1,rowIdx:0,colIdx:i,exposable:true,grouped:false,domAvailable:true}));
  const invalid=Array.from({length:10},(_,i)=>({...valid[0],rawRowLabel:'unknown-'+i,row:null,number:null,exposable:false,grouped:true}));
  const result=assessSeatRead([...valid,...invalid]);
  assert.equal(result.seatSamples.length,8);assert.equal(result.unsupportedRowCount,10);assert.equal(result.unsupportedNumberCount,10);assert.equal(result.nonExposableCount,10);assert.equal(result.groupedCount,10);
  assert.ok(result.seatSamples.every(s=>s.reasons.includes('row-format-unsupported')));
});

test('DOM unavailability and unresolved grade names remain distinct diagnostic reasons',()=>{
  const parsed=parseMetadata([{blockKey:'29:K9',seats:[rawSeat('seat')]}]);
  const rows=enrich([{kind:'seat',id:parsed[0].id,available:false}],new Map(parsed.map(s=>[s.id,s])),new Map());
  assert.equal(rows[0].available,false);assert.equal(rows[0].domAvailable,false);
  const result=assessSeatRead(rows);
  assert.equal(result.missingMetadataCount,0);assert.equal(result.unsupportedRowCount,0);assert.equal(result.unsupportedNumberCount,0);
  assert.deepEqual(result.seatSamples[0].reasons,['grade-unresolved','dom-unavailable']);
});

test('diagnostic parser fields survive standalone extension serialization',()=>{
  const parse=require('node:vm').runInNewContext('const parseSeatLabels='+parseSeatLabels.toString()+';('+parseMetadata.toString()+')');
  const parsed=parse([{blockKey:'29:K9',seats:[rawSeat('serialized',{rowNo:'A열',seatNo:'2번'})]}]);
  assert.equal(parsed[0].hasMetadata,true);assert.equal(parsed[0].rawRowLabel,'A열');assert.equal(parsed[0].rawSeatNumber,'2번');
  assert.equal(parsed[0].row,1);assert.equal(parsed[0].number,2);
});

test('empty inputs and malformed diagnostic values remain bounded and serializable',()=>{
  assert.deepEqual(assessSeatRead(null),{missingMetadataCount:0,unsupportedRowCount:0,unsupportedNumberCount:0,nonExposableCount:0,groupedCount:0,seatSamples:[]});
  const sample=assessSeatRead([{kind:'seat',hasMetadata:false,grade:{token:'private'},rawRowLabel:{session:'private'},rawSeatNumber:Infinity,rowIdx:Infinity,colIdx:2**60,exposable:'private',grouped:{private:true},domAvailable:'private'}]).seatSamples[0];
  assert.equal(sample.grade,null);assert.equal(sample.rawRowLabel,null);assert.equal(sample.rawSeatNumber,null);assert.equal(sample.rowIdx,null);assert.equal(sample.colIdx,null);assert.equal(sample.exposable,null);assert.equal(sample.grouped,null);assert.equal(sample.domAvailable,null);
  assert.ok(!JSON.stringify(sample).includes('private'));
});
