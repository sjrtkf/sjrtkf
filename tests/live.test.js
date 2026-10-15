const {test}=require('node:test');
const assert=require('node:assert/strict');
const {supportedUrl,clickScript,readScript}=require('../src/live-adapter');
test('실제 확인한 좌석 페이지에서만 전용 연동을 활성화한다',()=>{assert.equal(supportedUrl('https://tickets.interpark.com/onestop/seat'),true);for(const u of ['https://tickets.interpark.com.evil.test/onestop/seat','http://tickets.interpark.com/onestop/seat','https://tickets.interpark.com/onestop/payment'])assert.equal(supportedUrl(u),false);});
test('좌석 이름의 문자열을 실행 코드로 해석하지 않는다',()=>{const code=clickScript({id:'x";throw new Error("bad")//'},'focus');assert.doesNotThrow(()=>new Function('return '+code));assert.doesNotThrow(()=>new Function('return '+readScript()));});
test('401번째 이후에 있는 선호석도 전체 후보 풀에서 추천한다',()=>{
  const vm=require('node:vm'),{rankGroups}=require('../src/preferences');
  const circles=Array.from({length:450},(_,i)=>({id:'seat-'+i,parentElement:{id:'block:118'},getBoundingClientRect:()=>({left:1,top:1,right:3,bottom:3,width:2,height:2}),getAttribute:key=>({class:'js-seat',fill:'#f00',cx:String(i),cy:'1'})[key]}));
  const result=vm.runInNewContext(readScript(),{document:{querySelector:()=>null,querySelectorAll:selector=>selector==='circle.js-seat[id]'?circles:[]},getComputedStyle:()=>({visibility:'visible',display:'block'}),innerWidth:1000,innerHeight:1000});
  assert.equal(result.rows.length,450);
  const rows=Array.from(result.rows,(s,i)=>({...s,grade:i>=400?'선호 구역':'다른 구역',block:'118',row:1,number:i+1,colIdx:i,segment:'same',obstructed:false,aisle:i===400,neighbors:['seat-'+(i-1),'seat-'+(i+1)]}));
  const groups=rankGroups(rows,{areas:['선호 구역']});assert.equal(groups.length,49);assert.equal(groups[0].seats[0].id,'seat-400');
});
