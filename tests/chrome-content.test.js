'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function content({demo=true,uuid='00000000-0000-4000-8000-000000000001'}={}){
  const id='a'.repeat(32),url='chrome-extension://'+id+'/demo.html',sent=[],calls=[],intervals=[];let listener,resolveTab,now=100;
  const chrome={runtime:{id,getURL:p=>'chrome-extension://'+id+'/'+p,onMessage:{addListener(fn){listener=fn;}},sendMessage:async msg=>{sent.push(msg);}},tabs:{getCurrent:()=>new Promise(resolve=>{resolveTab=resolve;})}};
  const context=vm.createContext({chrome,location:{href:demo?url:'https://tickets.interpark.com/onestop/seat'},crypto:{randomUUID:()=>uuid},performance:{timeOrigin:123,now:()=>now},Date,document:{readyState:'complete'},window:{},setInterval(fn){intervals.push(fn);},BaseballActions:{'flow.scene':()=>{calls.push('scene');return {selected:[]};}}});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/content.js'),'utf8'),context);
  return {sent,calls,context,expireLease:()=>{now+=6000;for(const tick of intervals)tick();},documentId:'demo:'+uuid,ready:async()=>{resolveTab?.({id:7});await new Promise(setImmediate);},ask:(message,sender={id})=>new Promise(resolve=>{let answered=false;const asynchronous=listener(message,sender,value=>{answered=true;resolve(value);});if(asynchronous!==true&&!answered)resolve(undefined);})};
}

test('demo announces readiness only after obtaining its tab ID and returns its per-load identity',async()=>{
  const c=content();assert.equal(c.sent.length,0);await c.ready();
  assert.equal(c.sent[0].demoTabId,7);assert.equal(c.sent[0].documentId,c.documentId);
  const ping=await c.ask({type:'baseball-ping',demoTabId:7});assert.equal(ping.documentId,c.documentId);
  assert.equal(await c.ask({type:'baseball-ping',demoTabId:8}),undefined);
});

test('demo actions require a lease and the identity of this exact tab load',async()=>{
  const c=content();await c.ready();const action={type:'baseball-action',demoTabId:7,demoDocumentId:c.documentId,action:'flow.scene',expiresAt:Date.now()+10000};
  assert.match((await c.ask(action)).error,/연결 상태/);
  await c.ask({type:'baseball-lease',demoTabId:7,demoDocumentId:c.documentId});
  assert.equal((await c.ask(action)).value.selected.length,0);assert.equal(c.calls.length,1);
  for(const demoDocumentId of ['demo:00000000-0000-4000-8000-000000000002',undefined])assert.match((await c.ask({...action,demoDocumentId})).error,/페이지가 바뀌어/);
  assert.equal(c.calls.length,1);
});

test('new demo documents reject actions pinned to the page before reload',async()=>{
  const old=content(),fresh=content({uuid:'00000000-0000-4000-8000-000000000002'});await old.ready();await fresh.ready();
  await fresh.ask({type:'baseball-lease',demoTabId:7,demoDocumentId:fresh.documentId});
  const result=await fresh.ask({type:'baseball-action',demoTabId:7,demoDocumentId:old.documentId,action:'flow.scene',expiresAt:Date.now()+10000});
  assert.match(result.error,/페이지가 바뀌어/);assert.equal(fresh.calls.length,0);
});

test('official content retains the native-document transport contract without a demo identity',async()=>{
  const c=content({demo:false});await c.ready();
  assert.equal(Object.hasOwn(c.sent[0],'demoTabId'),false);assert.equal((await c.ask({type:'baseball-ping'})).documentId,undefined);
  await c.ask({type:'baseball-lease'});assert.equal((await c.ask({type:'baseball-action',action:'flow.scene',expiresAt:Date.now()+10000})).value.selected.length,0);
});

test('explicit stop and expired lease cancel pending human-input state without submitting',async()=>{
  for(const reason of ['stop','lease']){
    const c=content({demo:false});let cancelled=0;c.context.window.__ticketManualCaptchaPage={cancel(){cancelled++;}};await c.ready();
    await c.ask({type:'baseball-lease'});
    if(reason==='stop')assert.equal((await c.ask({type:'baseball-stop'})).stopped,true);else c.expireLease();
    assert.equal(cancelled,1,reason);assert.equal(c.calls.length,0);
  }
});
