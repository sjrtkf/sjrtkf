'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const search=require('../src/seat-search');
const state=()=>({triedJobs:new Set(),excludedIds:new Set(),metadataCooldown:new Map(),jobVisits:new Map()});
const seat=(id,grade)=>({kind:'seat',id,grade,blockKey:'001:104',available:true});
test('Pooled maps deduplicate seats, preserve other grades in the same block and replace revisited maps',()=>{
  const run=state();run.currentJob={name:'A'};search.rememberMap(run,[seat('1','A'),seat('2','A')]);
  run.currentJob={name:'B'};search.rememberMap(run,[seat('3','B'),{...seat('2','A'),number:9}]);
  assert.deepEqual(search.pooledSeats(run).map(s=>s.id),['1','3','2']);assert.equal(search.pooledSeats(run).find(s=>s.id==='2').number,9);
  search.rememberMap(run,[]);assert.deepEqual(search.pooledSeats(run).map(s=>s.id),['1']);
  run.excludedIds.add('1');assert.deepEqual(search.pooledSeats(run),[]);
});
test('A new search round discards pooled observations and expired metadata jobs',()=>{
  const run=state(),job={name:'A',tierIndex:0};run.currentJob=job;search.rememberMap(run,[seat('1','A')]);run.jobVisits.set(search.jobKey(job),10);run.metadataCooldown.set(search.jobKey(job),20);
  search.resetSearch(run);assert.equal(run.jobVisits.size,0);assert.equal(run.metadataCooldown.size,0);assert.deepEqual(search.pooledSeats(run),[]);
});

test('Price-ineligible grades are reconsidered on the next search round',()=>{
  const run=state();run.priceExcludedGrades=new Set(['30']);
  search.resetSearch(run);assert.equal(run.priceExcludedGrades.size,0);
  assert.ok(run.priceExcludedGrades instanceof Set);
});
test('Metadata wakeups do not override same-tier fresh jobs, and expired repeats use oldest visit order',()=>{
  const run=state(),plan=[{name:'A',tierIndex:0},{name:'B',tierIndex:0},{name:'C',tierIndex:1}];
  run.jobVisits.set(search.jobKey(plan[0]),10);run.metadataCooldown.set(search.jobKey(plan[0]),0);
  assert.equal(search.nextJob(plan,run,20),plan[1]);
  for(const [i,job] of plan.entries()){const key=search.jobKey(job);run.jobVisits.set(key,30-i);run.triedJobs.add(key);run.metadataCooldown.set(key,35);}
  assert.equal(search.nextJob(plan,run,40),plan[2]);
});
test('A changed higher-priority grade is rechecked before a lower-priority fresh grade',()=>{
  const run=state(),plan=[{name:'A',tierIndex:0},{name:'B',tierIndex:1}],key=search.jobKey(plan[0]);
  run.jobVisits.set(key,10);run.metadataCooldown.set(key,0);
  assert.equal(search.nextJob(plan,run,20),plan[0]);
  run.metadataCooldown.set(key,15);
  assert.equal(search.nextJob(plan,run,20),plan[1]);
});
test('When all tiers receive changed data, the earliest tier precedes older lower-tier visits',()=>{
  const run=state(),plan=[{name:'A',tierIndex:0},{name:'B',tierIndex:0},{name:'C',tierIndex:1}];
  for(const [i,job] of plan.entries()){const key=search.jobKey(job);run.jobVisits.set(key,30-i);run.triedJobs.add(key);run.metadataCooldown.set(key,0);}
  assert.equal(search.nextJob(plan,run,40),plan[1]);
});
