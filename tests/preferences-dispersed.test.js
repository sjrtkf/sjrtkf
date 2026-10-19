'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {rankGroups,gradePlan,assessGradePlan,groupKey}=require('../src/preferences');
const seat=(id,grade,row,number,extra={})=>({id,grade,block:grade,available:true,obstructed:false,row,number,colIdx:number,segment:grade+':'+row,neighbors:[],...extra});
const dispersed={quantity:2,requireTogether:false};

test('dispersed alternatives remain available when an adjacent pair exists and later conflicts',()=>{
  const seats=[seat('a','A',1,1,{neighbors:['b']}),seat('b','A',1,2,{neighbors:['a']}),seat('c','A',3,1)];
  const groups=rankGroups(seats,dispersed);
  assert.equal(groups.length,3);assert.equal(groups[0].together,true);
  assert.ok(groups.some(g=>g.key===groupKey([seats[1],seats[2]])&&!g.together));
  const retry=rankGroups(seats,dispersed,{excludedGroups:[groups[0].key]});
  assert.equal(retry.length,2);assert.ok(retry.every(g=>!g.together));
});

test('positive per-grade inventory can contribute to a cross-grade dispersed group',()=>{
  const grades=[{name:'A',count:1},{name:'B',count:1},{name:'C',count:0}];
  assert.deepEqual(gradePlan(grades,dispersed).map(g=>g.name),['A','B']);
  assert.equal(assessGradePlan(grades,dispersed).summary.insufficientCount,0);
  assert.equal(gradePlan(grades,{quantity:2,requireTogether:true}).length,0);
  const groups=rankGroups([seat('a','A',1,1),seat('b','B',1,1)],dispersed);
  assert.equal(groups.length,1);assert.equal(groups[0].together,false);assert.deepEqual(groups[0].tierCounts,[2]);
});

test('each seat uses its earliest matching tier and incomplete higher-tier totals fill from the next tier',()=>{
  const p={...dispersed,quantity:3,fallbackAnywhere:false,tiers:[{areas:['A']},{areas:['A','B']},{areas:['C']}]};
  const seats=[seat('a','A',9,1),seat('b','B',1,1),seat('c','C',1,1),seat('d','C',1,2)];
  assert.equal(rankGroups(seats,p,{maxTierIndex:1}).length,0);
  const groups=rankGroups(seats,p,{maxTierIndex:2});
  assert.deepEqual(groups[0].tierCounts,[1,1,1]);assert.equal(groups[0].tierIndex,2);
  assert.deepEqual(groups.map(g=>g.tierCounts),[[1,1,1],[1,1,1],[1,0,2],[0,1,2]]);
  assert.equal(rankGroups(seats,p,{tierIndex:1}).length,0);
});

test('tier count vector outranks low-tier front seats and fills only the missing quantity',()=>{
  const p={...dispersed,quantity:4,tiers:[{areas:['A']},{areas:['B']}],fallbackAnywhere:false};
  const seats=[seat('a','A',50,1),seat('b','A',51,1),seat('c','A',52,1),...Array.from({length:5},(_,i)=>seat('low'+i,'B',1,i+1))];
  const groups=rankGroups(seats,p,{maxTierIndex:1});
  assert.deepEqual(groups[0].tierCounts,[3,1]);assert.equal(groups[0].seats.filter(s=>s.grade==='A').length,3);
  assert.ok(groups.slice(0,5).every(g=>g.tierCounts[0]===3));
});

test('exclusions remove individual seats and non-sliding conflicting combinations without discarding other mixtures',()=>{
  const seats=['a','b','c','d'].map((id,i)=>seat(id,'A',i+1,1));
  const groups=rankGroups(seats,dispersed,{excludedIds:['d'],excludedGroups:[groupKey([seats[0],seats[1]]),groupKey([seats[1],seats[2]])]});
  assert.equal(groups.length,1);assert.deepEqual(groups[0].seats.map(s=>s.id),['a','c']);
});

test('bounded four-seat frontier yields fresh alternatives after an entire page fails',()=>{
  const seats=Array.from({length:1000},(_,i)=>seat('s'+i,'A',i+1,1)),p={...dispersed,quantity:4};
  const first=rankGroups(seats,p);assert.equal(first.length,256);
  const excludedGroups=new Set(first.map(g=>g.key)),second=rankGroups(seats,p,{excludedGroups});
  assert.equal(second.length,256);assert.ok(second.every(g=>!excludedGroups.has(g.key)));
  assert.equal(new Set([...first,...second].map(g=>g.key)).size,512);
});

test('fallback tiers retain restricted, sightline and explicit row settings for each contributing seat',()=>{
  const p={...dispersed,tiers:[{areas:['A'],maxRow:2}]};
  const seats=[seat('a','A',1,1),seat('back','A',5,1),seat('b','B',1,1),seat('restricted','휠체어장애인석',1,1),seat('blocked','B',1,2,{obstructed:true})];
  assert.equal(rankGroups(seats,p,{maxTierIndex:0}).length,0);
  const groups=rankGroups(seats,p,{maxTierIndex:1});
  assert.deepEqual(groups[0].tierCounts,[1,1]);assert.equal(groups[0].fallback,true);
  assert.ok(groups.every(g=>g.seats.every(s=>!['restricted','blocked'].includes(s.id))));
  assert.equal(rankGroups(seats,{...p,fallbackAnywhere:false}).length,0);
});

test('newest duplicate observation wins and cannot contribute the same seat twice',()=>{
  const a=seat('a','A',1,1),b=seat('b','B',1,1);
  assert.equal(rankGroups([a,a],dispersed).length,0);
  assert.equal(rankGroups([a,b,{...a,available:false}],dispersed).length,0);
});
