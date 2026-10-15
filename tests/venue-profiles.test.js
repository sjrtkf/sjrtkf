'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BUILTINS,LIONS_REFERENCE,normalizeVenueState,createVenueStore}=require('../src/venue-profiles');
const {normalizePreferences}=require('../src/preferences');
function fixture(t,initialPreferences={}){
  const parent=path.resolve(os.tmpdir()),directory=fs.mkdtempSync(path.join(parent,'venue-profiles-'));
  t.after(()=>{assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('venue-profiles-'));fs.rmSync(directory,{recursive:true,force:true});});
  const filePath=path.join(directory,'venue-profiles.json');
  return {filePath,directory,store:createVenueStore({filePath,initialPreferences,now:()=>1234})};
}
test('existing common preferences are preserved without inventing venue seat labels',t=>{
  const old={quantity:4,areas:['사용자 기존 구역'],blocks:['기존 블록'],tiers:[{name:'앞쪽',areas:['다른 구역'],maxRow:5}]};
  const {store,filePath}=fixture(t,old),state=store.getState();
  assert.equal(state.activeId,'legacy');assert.equal(fs.existsSync(filePath),false);
  assert.deepEqual(store.getPreferences(),normalizePreferences(old));
  for(const profile of state.profiles.filter(row=>row.id!=='legacy')){
    assert.deepEqual(profile.preferences.areas,[]);assert.deepEqual(profile.preferences.blocks,[]);assert.deepEqual(profile.preferences.tiers,[]);
  }
  assert.deepEqual(state.profiles.map(row=>row.id),BUILTINS.map(row=>row.id));
});
test('switching saves unsaved inputs under the previous venue and reloads independent priorities after restart',t=>{
  const {store,filePath}=fixture(t);
  store.select('lions-park',{quantity:1,areas:['기존 사용자 설정']});
  const lions={quantity:4,areas:['외부 공식 안내와 대조할 구역'],blocks:['A','B'],tiers:[{name:'통로 앞열',areas:['직접 입력'],blocks:['1'],minRow:1,maxRow:5,aisle:'required'},{name:'앞열',maxRow:5,aisle:'any'}]};
  store.select('champions-field',lions);
  const gwangju={quantity:2,areas:['광주 직접 입력'],blocks:['가'],priority:'aisle'};
  store.select('jamsil',gwangju);store.saveActive({quantity:3,blocks:['잠실 직접 입력']});
  const reopened=createVenueStore({filePath});
  assert.equal(reopened.getState().activeId,'jamsil');assert.equal(reopened.getPreferences().quantity,3);
  assert.deepEqual(reopened.select('lions-park'),normalizePreferences(lions));
  assert.deepEqual(reopened.select('champions-field'),normalizePreferences(gwangju));
  assert.equal(reopened.select('legacy').quantity,1);
});
test('invalid preferences prevent switching and leave persisted bytes unchanged',t=>{
  const {store,filePath}=fixture(t);store.saveActive({quantity:2});
  const before=fs.readFileSync(filePath,'utf8');
  for(const prefs of [{quantity:0},{quantity:5},{quantity:2,tiers:[{minRow:9,maxRow:1}]}]){
    assert.throws(()=>store.select('jamsil',prefs));assert.equal(store.getState().activeId,'legacy');assert.equal(fs.readFileSync(filePath,'utf8'),before);
  }
  assert.throws(()=>store.select('../other',{quantity:3}),/찾지 못/);assert.equal(fs.readFileSync(filePath,'utf8'),before);
});
test('custom venue creation copies inputs and does not share mutable preference objects',t=>{
  const {store}=fixture(t);store.select('gangwon-fc');
  const prefs={quantity:2,areas:['강원 테스트 사용자 입력'],tiers:[{name:'우선',maxRow:5}]};
  store.create('축구 · 원정 응원',prefs);const state=store.getState(),custom=state.profiles.find(row=>row.id===state.activeId);
  assert.equal(custom.builtin,false);assert.equal(custom.name,'축구 · 원정 응원');
  prefs.areas.push('외부 수정');custom.preferences.quantity=4;state.profiles.length=0;
  assert.equal(store.getPreferences().quantity,2);assert.equal(store.getPreferences().areas.length,1);
  store.saveActive({quantity:3});assert.equal(store.select('gangwon-fc').quantity,2);
});
test('duplicate names, malformed names, active custom deletion and builtin deletion are rejected',t=>{
  const {store,filePath}=fixture(t);store.create('보조 구장',{quantity:3});const id=store.getState().activeId,before=fs.readFileSync(filePath,'utf8');
  for(const name of ['', ' ', 'x'.repeat(65),'줄\n바꿈','보조 구장','잠실야구장'])assert.throws(()=>store.create(name,{}));
  assert.throws(()=>store.remove(id),/사용 중/);assert.throws(()=>store.remove('jamsil'),/기본/);assert.equal(fs.readFileSync(filePath,'utf8'),before);
  store.select('jamsil');store.remove(id);assert.equal(store.getState().profiles.some(row=>row.id===id),false);
  assert.equal(store.getState().profiles.length,BUILTINS.length);
});
test('saved settings discard unknown data and builtin name spoofing without importing browser sessions',()=>{
  const state=normalizeVenueState({version:1,activeId:'jamsil',cookie:'private',profiles:[{id:'jamsil',name:'임의 이름',builtin:false,token:'private',preferences:{quantity:2,cookie:'private',tiers:[{name:'앞열',secret:'private'}]}}]});
  assert.equal(state.profiles.find(row=>row.id==='jamsil').name,'잠실야구장');assert.doesNotMatch(JSON.stringify(state),/private|cookie|token|secret/);
  assert.throws(()=>normalizeVenueState({version:1,activeId:'__proto__',profiles:[{id:'__proto__',preferences:{}}]}),/ID/);
  assert.throws(()=>normalizeVenueState({version:1,activeId:'jamsil',profiles:[{id:'jamsil'},{id:'jamsil'}]}),/중복/);
});
test('corrupt profile data is retained in a recovery file before replacement',t=>{
  const {filePath,directory}=fixture(t),broken='{"profiles":BROKEN';fs.writeFileSync(filePath,broken);
  const store=createVenueStore({filePath,initialPreferences:{quantity:4}});
  assert.match(store.getState().warning,/원본/);assert.equal(fs.readFileSync(filePath,'utf8'),broken);assert.equal(store.getPreferences().quantity,4);
  store.saveActive({quantity:3});const recovery=fs.readdirSync(directory).filter(name=>name.includes('.recovery-'));
  assert.equal(recovery.length,1);assert.equal(fs.readFileSync(path.join(directory,recovery[0]),'utf8'),broken);assert.equal(store.getState().warning,undefined);
  assert.equal(createVenueStore({filePath}).getPreferences().quantity,3);
});
test('oversized profile files are not overwritten or read as empty defaults',t=>{
  const {filePath}=fixture(t);fs.writeFileSync(filePath,' '.repeat(2*1024*1024+1));
  assert.throws(()=>createVenueStore({filePath}),/크기가 너무/);assert.equal(fs.statSync(filePath).size,2*1024*1024+1);
});
test('historical Lions Park catalogue is labelled unverified and never becomes active preferences automatically',t=>{
  const {store}=fixture(t),state=store.getState(),lions=state.profiles.find(profile=>profile.id==='lions-park');
  assert.equal(LIONS_REFERENCE.areas.length,43);assert.equal(new Set(LIONS_REFERENCE.areas).size,43);
  assert.equal(lions.reference.verifiedCurrent,false);assert.match(lions.reference.note,/과거 자료/);assert.match(lions.reference.source,/2025/);
  assert.equal(lions.reference.areas.includes('3루 2층 215~225블럭 휠체어석(동반O)'),false);
  assert.deepEqual(store.select('lions-park').areas,[]);assert.deepEqual(store.getPreferences().blocks,[]);
  lions.reference.areas.length=0;assert.equal(store.getState().profiles.find(profile=>profile.id==='lions-park').reference.areas.length,43);
});
