'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCatalog}=require('../src/seat-catalog');
test('current metadata joins grade and block codes without inventing unseen blocks',()=>{
  const catalog=buildCatalog({rows:[{kind:'grade',name:'블루존',count:'10'}],grades:[{code:'B',name:'블루존'}],metadata:[{id:'seat_block_one',gradeCode:'B',block:'3-5',blockKey:'001:3-5',displayRow:'13열',number:2}],title:'현재 경기'});
  assert.deepEqual(catalog.areas,[{name:'블루존',code:'B',count:'10'}]);assert.equal(catalog.blocks.length,1);
  assert.deepEqual(catalog.blocks[0].areas,['블루존']);assert.equal(catalog.blocks[0].code,'001:3-5');assert.equal(catalog.seats[0].id,'seat_block_one');assert.equal(catalog.partial,true);
});
