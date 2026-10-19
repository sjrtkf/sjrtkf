'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCatalog}=require('../src/seat-catalog');
test('current metadata joins grade and block codes without inventing unseen blocks',()=>{
  const catalog=buildCatalog({rows:[{kind:'grade',name:'블루존',count:'10'}],grades:[{code:'B',name:'블루존'}],metadata:[{id:'seat_block_one',gradeCode:'B',block:'3-5',blockKey:'001:3-5',displayRow:'13열',number:2}],title:'현재 경기'});
  assert.deepEqual(catalog.areas,[{name:'블루존',code:'B',count:'10'}]);assert.equal(catalog.blocks.length,1);
  assert.deepEqual(catalog.blocks[0].areas,['블루존']);assert.equal(catalog.blocks[0].code,'001:3-5');assert.equal(catalog.seats[0].id,'seat_block_one');assert.equal(catalog.partial,true);
});
test('opaque wheelchair labels remain visible instead of becoming missing or invented numbers',()=>{
  const catalog=buildCatalog({metadata:[{id:'s',grade:'장애인석',block:'104',blockKey:'001:104',rawRowLabel:'104블록',rawSeatNumber:'W4-1',row:null,number:null}]});
  assert.equal(catalog.seats[0].row,'104블록');assert.equal(catalog.seats[0].number,'W4-1');
  const regular=buildCatalog({metadata:[{id:'n',grade:'일반석',block:'104',row:1,number:1,rawSeatNumber:'01'}]});
  assert.equal(regular.seats[0].number,1);
});
