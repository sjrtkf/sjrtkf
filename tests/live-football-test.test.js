'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const directApi=require('../src/direct-seat-api'),version=require('../package.json').version;
function fixture(identity){
  let tick,status;const calls=[],run={windowIds:new Set([1]),task:Promise.resolve({completed:true,message:'price'})};
  const context={module:{exports:{}},require:name=>name==='node:fs'?{mkdirSync(){},writeFileSync(_p,value){status=JSON.parse(value);}}:name==='node:path'?path:name==='../package.json'?{version}:name==='./direct-seat-api'?directApi:null,Date,setInterval(fn){tick=fn;return {unref(){}};},clearInterval(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/live-football-test.js'),'utf8'),context);
  const target={id:1,getURL:()=> 'https://tickets.interpark.com/onestop/seat',getTitle:()=> '수원삼성 vs 화성FC (10.18)',invoke:async fn=>{assert.equal(fn,directApi.bookingIdentity);calls.push('identity');return identity;}};
  context.module.exports({bridge:{getState:()=>({connected:true,extensionVersion:version}),request:async q=>calls.push(q.action)},targets:new Map([[1,target]]),command:async(action,payload)=>{calls.push({action,payload});},runs:{current:run},dataRoot:'fixture',state(){}});
  return {calls,tick:()=>tick(),status:()=>status};
}
test('one-shot football continuation verifies the exact open game before a one-seat API run',async()=>{
  const f=fixture({goodsCode:'26009123',placeCode:'25001730',playSeq:'001',playDate:'20261018'});await f.tick();
  const start=f.calls.find(c=>c.action==='start');assert.ok(start);assert.equal(start.payload.preferences.quantity,1);assert.equal(start.payload.preferences.autoCaptcha,false);
  assert.equal(start.payload.preferences.selectionMethod,'api');assert.ok(f.calls.indexOf('identity')<f.calls.indexOf(start));
  assert.ok(!f.calls.some(c=>c.action==='games'));
});
test('one-shot football continuation cannot start a different game despite a matching title',async()=>{
  const f=fixture({goodsCode:'26009124',placeCode:'25001730',playSeq:'001',playDate:'20261018'});await f.tick();
  assert.ok(!f.calls.some(c=>c.action==='start'));assert.equal(f.status().phase,'stopped');
});
