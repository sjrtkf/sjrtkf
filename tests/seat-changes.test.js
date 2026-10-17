'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {liveRead,waitForChange}=require('../src/live-adapter');
function fixture(){
  let observer;const context=vm.createContext({window:{},document:{body:{},querySelector:()=>null,querySelectorAll:()=>[]},setTimeout,clearTimeout,MutationObserver:class{constructor(fn){observer=this;this.fn=fn;}observe(){}disconnect(){this.closed=true;}}});
  const read=()=>vm.runInContext(`(${liveRead})()`,context);
  const wait=(revision,timeoutMs=100)=>vm.runInContext(`(${waitForChange})(${JSON.stringify({revision,timeoutMs})})`,context);
  return {context,read,wait,change:()=>observer.fn(),stop:()=>context.window.__ticketSeatChanges.stop()};
}
test('unchanged seats suspend reads; a DOM change wakes the pending wait immediately',async()=>{
  const f=fixture(),r=f.read();let resolved=false;const task=f.wait(r.revision).then(r=>{resolved=true;return r;});await Promise.resolve();assert.equal(resolved,false);f.change();assert.equal((await task).changed,true);
});
test('a change between snapshot and wait is not lost',async()=>{const f=fixture(),r=f.read();f.change();assert.equal((await f.wait(r.revision)).changed,true);});
test('stop resolves waits and the next run gets a fresh observer',async()=>{const f=fixture(),r=f.read(),task=f.wait(r.revision);f.stop();assert.equal((await task).stopped,true);assert.equal(f.read().revision,0);});
test('no-change fallback is bounded and releases listener resources',async()=>{const f=fixture(),r=f.read();assert.equal((await f.wait(r.revision,1)).changed,false);assert.equal(f.context.window.__ticketSeatChanges.listeners.size,0);});
