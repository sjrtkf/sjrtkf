'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {liveRead,waitForChange}=require('../src/live-adapter');
function fixture(){
  let observer;const state={count:'0',timer:'9:59',seat:null,notice:false,gradeDisabled:false},box={width:10,height:10};
  const element=fields=>Object.defineProperties({getBoundingClientRect:()=>box,getAttribute:()=>null},Object.getOwnPropertyDescriptors(fields));
  const grade=element({get disabled(){return state.gradeDisabled;},textContent:'일반석',querySelector:selector=>({textContent:selector.includes('GradeName')?'일반석':state.count})});
  const notice=element({textContent:'확인하고 예매하기'}),timer=element({get textContent(){return '좌석 선택 시간 '+state.timer;}});
  const document={body:{},querySelector:()=>null,querySelectorAll:selector=>selector==='circle.js-seat[id]'?(state.seat?[state.seat]:[]):selector.startsWith('button[class*="SportsSeatGradeList_contentItem__"]')?[grade]:selector==='button'?[grade,timer,...state.notice?[notice]:[]]:[]};
  const context=vm.createContext({window:{},document,getComputedStyle:()=>({display:'block',visibility:'visible'}),setTimeout,clearTimeout,MutationObserver:class{constructor(fn){observer=this;this.fn=fn;}observe(){}disconnect(){this.closed=true;}}});
  const read=()=>vm.runInContext(`(${liveRead})()`,context);
  const wait=(revision,timeoutMs=100)=>vm.runInContext(`(${waitForChange})(${JSON.stringify({revision,timeoutMs})})`,context);
  return {context,state,read,wait,change:()=>{state.count=String(Number(state.count)+1);observer.fn();},mutate:records=>observer.fn(records),seat:()=>{state.seat=element({id:'seat_block_fixture',parentElement:{id:'seat_block_001:101'},getAttribute:key=>({class:'js-seat',fill:'#fff',cx:'1',cy:'2'}[key]??null)});observer.fn();},stop:()=>context.window.__ticketSeatChanges.stop()};
}
test('unchanged seats suspend reads; a grade inventory change wakes the pending wait immediately',async()=>{
  const f=fixture(),r=f.read();let resolved=false;const task=f.wait(r.revision).then(r=>{resolved=true;return r;});await Promise.resolve();assert.equal(resolved,false);f.change();assert.equal((await task).changed,true);
});
test('a change between snapshot and wait is not lost',async()=>{const f=fixture(),r=f.read();f.change();assert.equal((await f.wait(r.revision)).changed,true);});
test('stop resolves waits and the next run gets a fresh observer',async()=>{const f=fixture(),r=f.read(),task=f.wait(r.revision);f.stop();assert.equal((await task).stopped,true);assert.equal(f.read().revision,0);});
test('no-change fallback is bounded and releases listener resources',async()=>{const f=fixture(),r=f.read();assert.equal((await f.wait(r.revision,1)).changed,false);assert.equal(f.context.window.__ticketSeatChanges.listeners.size,0);});

test('countdown updates and identical rerenders do not wake an inventory wait',async()=>{
  const f=fixture(),r=f.read();let resolved=false;const task=f.wait(r.revision).then(result=>{resolved=true;return result;});
  for(let i=0;i<20;i++){f.state.timer='9:'+String(i);f.mutate();}
  await Promise.resolve();assert.equal(resolved,false);assert.equal(f.read().revision,r.revision);
  f.change();assert.equal((await task).changed,true);
});

test('new visible seats, grade availability and booking notices wake the waiting loop',async()=>{
  for(const change of [f=>f.seat(),f=>{f.state.gradeDisabled=true;f.mutate();},f=>{f.state.notice=true;f.mutate();}]){
    const f=fixture(),r=f.read(),task=f.wait(r.revision);change(f);assert.equal((await task).changed,true);
  }
});

test('the advertised five-second fallback is not silently shortened to four seconds',async()=>{
  const f=fixture(),r=f.read();let delay;
  f.context.setTimeout=(_callback,ms)=>{delay=ms;return 1;};f.context.clearTimeout=()=>{};
  const task=f.wait(r.revision,5000);assert.equal(delay,5000);f.stop();assert.equal((await task).stopped,true);
});

test('unrelated countdown text mutations avoid scanning the seat map again',()=>{
  const f=fixture();f.read();let scans=0;const query=f.context.document.querySelectorAll;
  f.context.document.querySelectorAll=selector=>{scans++;return query(selector);};
  const clockLabel={nodeType:1,closest:()=>null,querySelector:()=>null};
  f.mutate([{type:'characterData',target:{parentElement:clockLabel},addedNodes:[],removedNodes:[]}]);
  assert.equal(scans,0);
  const gradeLabel={nodeType:1,closest:()=>({}),querySelector:()=>null};f.state.count='1';
  f.mutate([{type:'characterData',target:{parentElement:gradeLabel},addedNodes:[],removedNodes:[]}]);
  assert.ok(scans>0);assert.equal(f.read().revision,1);
});
