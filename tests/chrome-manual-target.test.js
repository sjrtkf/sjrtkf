'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {ChromeTarget,pageActions,functionActions}=require('../src/chrome-target');
const manualCaptcha=require('../src/manual-captcha-page');

test('human-input functions have static Chrome actions and preserve native document binding',async()=>{
  const calls=[],target=new ChromeTarget({request:async command=>{calls.push(command);return true;}},{id:7,url:'https://tickets.interpark.com/onestop/seat',documentId:'native-document'});
  for(const [name,fn] of Object.entries(manualCaptcha)){
    assert.equal(functionActions.get(fn),'manualCaptcha.'+name);
    await target.invoke(fn,{challengeId:'human-challenge',text:'ABCDEF'});
    assert.equal(calls.at(-1).action,'manualCaptcha.'+name);assert.equal(calls.at(-1).documentId,'native-document');
  }
});

test('global page stop cancels manual pending state as well as existing watchers',()=>{
  const calls=[],context=vm.createContext({window:{__ticketManualCaptchaPage:{cancel:()=>calls.push('manual')}}});
  const stopped=vm.runInContext('('+pageActions.stopWatchers.toString()+')()',context);
  assert.equal(stopped,true);assert.deepEqual(calls,['manual']);
});

test('generated static extension code includes the human-only action group',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../extension/actions.js'),'utf8'),context);
  for(const name of Object.keys(manualCaptcha))assert.equal(typeof context.BaseballActions['manualCaptcha.'+name],'function');
});
