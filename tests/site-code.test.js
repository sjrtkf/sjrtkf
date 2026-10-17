'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {invokeSiteFunction,CODE_ACTIONS}=require('../src/site-code');
const {codeRuntime}=require('../src/code-runtime');
function fixture(){
  let now=1000,callbackCalls=0,eventCalls=0,timer;
  class Input{get value(){return this._value||'';}set value(v){this._value=v;}}
  const context=vm.createContext({window:{},location:new URL('https://tickets.interpark.com/onestop/seat'),URL,HTMLInputElement:Input,Date:{now:()=>now},setInterval:fn=>{timer=fn;return 1;},clearInterval(){}});
  vm.runInContext('const site='+invokeSiteFunction.toString()+';globalThis.runtime='+codeRuntime.toString(),context);
  const element=new Input();Object.assign(element,{isConnected:true,disabled:false,getAttribute:()=>null,click(){eventCalls++;throw Error('No DOM click');},dispatchEvent(){eventCalls++;throw Error('No event');},__reactProps$fixture:{onClick:()=>{callbackCalls++;},onChange:e=>{callbackCalls++;assert.equal(e.target.value,'ABCDEF');}}});
  const meta={connection:'first',epoch:0,expiresAt:10000};
  const run=(action='invoke',arg,options={})=>context.runtime(action,arg,{...meta,...options},vm.runInContext('site',context),siteInvoke=>({invoke:()=>{siteInvoke(element);return {ok:true};},change:()=>{siteInvoke(element,'change','ABCDEF');return {ok:true};},watch:()=>{context.later=()=>siteInvoke(element);return true;}}));
  return {context,element,run,meta,counts:()=>({callbacks:callbackCalls,events:eventCalls}),advance:n=>{now+=n;},timer:()=>timer()};
}
test('registered site functions run directly with zero DOM events',()=>{const f=fixture();f.run();f.run('change');assert.deepEqual(f.counts(),{callbacks:2,events:0});});

test('null transport arguments retain default parameters and provided payloads remain intact',()=>{
  const f=fixture(),actions=()=>({read:({goodsCode='default'}={})=>goodsCode});
  assert.equal(f.context.runtime('read',null,f.meta,()=>{},actions),'default');
  assert.equal(f.context.runtime('read',{goodsCode:'26009123'},f.meta,()=>{},actions),'26009123');
});
test('missing or ambiguous React functions never fall back to DOM clicks or attribute evaluation',()=>{
  for(const mode of ['missing','ambiguous','string']){const f=fixture();if(mode==='missing')delete f.element.__reactProps$fixture;if(mode==='ambiguous')f.element.__reactProps$other={onClick(){throw Error();}};if(mode==='string')f.element.__reactProps$fixture.onClick='alert(1)';assert.throws(()=>f.run(),/SITE_FUNCTION/);assert.deepEqual(f.counts(),{callbacks:0,events:0});}
});
test('disabled, detached and readonly controls stop before state changes',()=>{
  for(const flag of ['disabled','isConnected','readOnly']){const f=fixture();f.element[flag]=flag!=='isConnected';assert.throws(()=>f.run(flag==='readOnly'?'change':'invoke'),/SITE_/);assert.equal(f.counts().callbacks,0);}
});
test('a stopped epoch invalidates scheduled callbacks and late queued commands',()=>{
  const f=fixture();f.run('watch');f.run('stop',null,{epoch:1});assert.throws(()=>f.context.later(),/STOPPED/);assert.throws(()=>f.run(),/STOPPED/);assert.equal(f.counts().callbacks,0);
  f.run('invoke',null,{epoch:1});assert.equal(f.counts().callbacks,1);
});
test('autonomous callbacks cannot renew an expired connection lease',()=>{
  const f=fixture();f.run('watch');f.advance(5001);assert.throws(()=>f.context.later(),/STOPPED/);f.timer();assert.equal(f.context.window.__ticketSiteCode.stopped,true);assert.equal(f.counts().callbacks,0);
});
test('heartbeat refreshes the lease but never restarts a stopped watcher',()=>{
  const f=fixture();f.run('watch');f.advance(4000);f.run('lease');f.advance(4000);f.context.later();assert.equal(f.counts().callbacks,1);
  f.run('stop',null,{epoch:1});f.run('lease',null,{epoch:1});assert.throws(()=>f.context.later(),/STOPPED/);
});
test('reconnecting cancels old closures before the new connection may execute',()=>{
  const f=fixture();f.run('watch');assert.throws(()=>f.run('invoke',null,{connection:'next'}),/CONNECTION_CHANGED/);
  f.run('lease',null,{connection:'next'});assert.throws(()=>f.context.later(),/STOPPED/);f.run('invoke',null,{connection:'next'});assert.equal(f.counts().callbacks,1);
});
test('expired commands and unrelated origins never execute a function',()=>{
  const f=fixture();assert.throws(()=>f.run('invoke',null,{expiresAt:999}),/EXPIRED/);f.context.location=new URL('https://example.com/onestop/seat');assert.throws(()=>f.run(),/SCOPE/);assert.equal(f.counts().callbacks,0);
});
test('synchronous and asynchronous site failures latch the result and prevent re-execution',async()=>{
  for(const asyncError of [false,true]){const f=fixture();f.element.__reactProps$fixture.onClick=()=>{if(asyncError)return Promise.reject(Error('private data'));throw Error('private data');};if(asyncError){f.run();await new Promise(r=>setImmediate(r));}else assert.throws(()=>f.run());assert.throws(()=>f.run(),/SITE_FUNCTION_FAILED/);assert.equal(f.context.window.__ticketSiteCode.error,'SITE_FUNCTION_FAILED');}
});
test('every active extension interaction is static code with no click/input-event dispatch',()=>{
  const code=fs.readFileSync(require.resolve('../extension/code-actions.js'),'utf8'),actions=fs.readFileSync(require.resolve('../extension/actions.js'),'utf8');
  for(const text of [code,actions]){assert.doesNotMatch(text,/\.click\s*\(|\.dispatchEvent\s*\(|new\s+(?:Mouse|Pointer|Keyboard|Input)Event\s*\(|\beval\s*\(|new\s+Function\s*\(/);}
  const sandbox=vm.createContext({Set});vm.runInContext(code,sandbox);assert.equal(typeof sandbox.BaseballCodeDispatch,'function');assert.deepEqual([...sandbox.BaseballCodeActions],[...CODE_ACTIONS]);
});

test('late rejected site functions from a previous run cannot stop the next run',async()=>{
  for(const reconnect of [false,true]){
    const f=fixture();let reject;
    f.element.__reactProps$fixture.onClick=()=>new Promise((_,r)=>{reject=r;});f.run();
    const next=reconnect?{connection:'second'}:{epoch:1};
    f.run('stop',null,{epoch:1});if(reconnect)f.run('lease',null,next);
    f.element.__reactProps$fixture.onClick=()=>{};f.run('watch',null,next);
    reject(Error('late previous request'));await new Promise(r=>setImmediate(r));
    assert.equal(f.context.window.__ticketSiteCode.error,null);
    assert.equal(f.context.window.__ticketSiteCode.stopped,false);
    assert.doesNotThrow(()=>f.context.later());
  }
});
