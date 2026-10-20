'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {resolveGateEntry}=require('../src/entry-request');
const contractFixture=require('./fixtures/gate-entry-contract.cjs');
function fixture(options={}){
  const source=contractFixture(options),button={isConnected:true,disabled:true,textContent:'남은시간 00:01'};
  const root={tag:3},owner={type:source.owner,memoizedProps:{global:false},memoizedState:{memoizedState:[source.callback,[]],next:null},return:root},host={tag:5,stateNode:button,return:owner};
  root.stateNode={current:root};root.child=owner;owner.child=host;button.__reactFiber$test=host;
  const context=vm.createContext({location:new URL('https://tickets.interpark.com/gates/ticket/26014425'),button});
  const resolve=()=>vm.runInContext(`(${resolveGateEntry.toString()})(button)`,context);
  return {...source,button,root,owner,host,context,resolve};
}
test('compiled domestic gate callback is found without reading member data or changing the disabled UI',async()=>{
  const f=fixture(),result=f.resolve();assert.equal(result.invoke,f.callback);assert.equal(result.contract,'ticket-gate-2026-10-20');
  assert.equal(f.requests.length,0);assert.equal(f.button.disabled,true);
  await result.invoke();assert.equal(f.requests.length,1);assert.equal(f.requests[0].playSeq,'001');assert.deepEqual(f.redirects,['/waiting/test']);
});
test('the original authentication, access and in-flight guards remain in the invoked callback',async()=>{
  for(const flag of ['denied','busy','alertOpen']){const f=fixture({[flag]:true});await f.resolve().invoke();assert.equal(f.requests.length,0,flag);assert.equal(f.redirects.length,0,flag);}
});
test('a stale DOM fiber uses the committed root and cannot invoke its old closure',()=>{
  const f=fixture(),oldRoot={tag:3,stateNode:f.root.stateNode},oldOwner={...f.owner,return:oldRoot},oldHost={...f.host,return:oldOwner};
  oldRoot.child=oldOwner;oldOwner.child=oldHost;oldOwner.memoizedState={memoizedState:[()=>{throw Error('stale');},[]]};f.button.__reactFiber$test=oldHost;
  assert.equal(f.resolve().invoke,f.callback);
});
test('unknown deployment, global mode, absent or duplicate callbacks fail closed',()=>{
  for(const mode of ['owner','global','missing','duplicate']){
    const f=fixture();if(mode==='owner')f.owner.type=()=>{};if(mode==='global')f.owner.memoizedProps.global=true;
    if(mode==='missing')f.owner.memoizedState=null;if(mode==='duplicate')f.owner.memoizedState.next={memoizedState:[f.callback,[]]};
    assert.throws(f.resolve,/SITE_ENTRY_FUNCTION_/);assert.equal(f.requests.length,0);
  }
});
test('detached, wrong-origin, multiple root pointers and uncommitted controls fail closed',()=>{
  for(const mode of ['detached','origin','multiple','uncommitted']){
    const f=fixture();if(mode==='detached')f.button.isConnected=false;if(mode==='origin')f.context.location=new URL('https://example.com/gates/ticket/26014425');
    if(mode==='multiple')f.button.__reactFiber$other=f.host;if(mode==='uncommitted')f.owner.child=null;
    assert.throws(f.resolve,/SITE_ENTRY_/);assert.equal(f.requests.length,0);
  }
});
test('cyclic hook lists are rejected instead of hanging at the opening deadline',()=>{
  const f=fixture();f.owner.memoizedState.next=f.owner.memoizedState;assert.throws(f.resolve,/AMBIGUOUS/);
});
