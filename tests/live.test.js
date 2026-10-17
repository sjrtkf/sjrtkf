const {test}=require('node:test');
const assert=require('node:assert/strict');
const {supportedUrl,clickScript,readScript}=require('../src/live-adapter');
test('normal remaining count updates do not change grade identity or stop opening it',()=>{
  const vm=require('node:vm'),{liveAction}=require('../src/live-adapter');let clicks=0;
  const grade={querySelector:s=>({textContent:s.includes('Name')?'블루존':'19'}),click(){clicks++;}};
  const document={querySelectorAll:s=>s.includes('SportsSeatGradeList_contentItem')?[grade]:[]};
  const result=vm.runInNewContext(`(${liveAction})(${JSON.stringify({row:{kind:'grade',name:'블루존',count:'20'},action:'click'})})`,{document,siteInvoke:e=>e.click()});
  assert.equal(result,true);assert.equal(clicks,1);
  grade.disabled=true;assert.equal(vm.runInNewContext(`(${liveAction})(${JSON.stringify({row:{kind:'grade',name:'블루존',count:'20'},action:'click'})})`,{document,siteInvoke:e=>e.click()}).retry,true);assert.equal(clicks,1);
});
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
test('seat dispatch ignores occlusion and viewport clipping but honors real modals',()=>{
  const vm=require('node:vm'),{liveAction}=require('../src/live-adapter');let events=[],blocked=false;
  const seat={id:'s',parentElement:{id:'seat_block_001:118'},matches:()=>true,getAttribute:k=>({class:'js-seat',fill:'red',cx:'1',cy:'2'})[k],getBoundingClientRect:()=>({left:-20,top:100,right:-10,bottom:110,width:10,height:10}),dispatchEvent:e=>events.push(e.type)};
  const document={getElementById:()=>seat,querySelectorAll:()=>blocked?[seat]:[],elementFromPoint(){throw Error('must not depend on hit testing');}};
  const context={document,window:{},PointerEvent:class{constructor(type){this.type=type;}},getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const row={id:'s',kind:'seat',group:'seat_block_001:118',fill:'red',cx:'1',cy:'2'};
  assert.throws(()=>vm.runInNewContext(`(${liveAction})(${JSON.stringify({row,action:'click'})})`,context),/HTTP/);assert.deepEqual(events,[]);
  blocked=true;assert.throws(()=>vm.runInNewContext(`(${liveAction})(${JSON.stringify({row,action:'click'})})`,context),/사이트 안내/);assert.equal(events.length,0);
});
test('grade list is retained when map circles coexist and seats outside viewport remain readable',()=>{
  const vm=require('node:vm');const rect=()=>({left:-500,top:1,right:-490,bottom:11,width:10,height:10});
  const seat={id:'s',parentElement:{id:'seat_block_001:118'},getBoundingClientRect:rect,getAttribute:()=>''};
  const grade={getBoundingClientRect:rect,querySelector:s=>({textContent:s.includes('Name')?'블루존':'20'})};
  const result=vm.runInNewContext(readScript(),{document:{querySelector:()=>null,querySelectorAll:s=>s==='circle.js-seat[id]'?[seat]:[grade]},getComputedStyle:()=>({visibility:'visible',display:'block'})});
  assert.deepEqual(Array.from(result.rows,r=>r.kind),['seat','grade']);
});
