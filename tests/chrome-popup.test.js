'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(send){
  const elements=new Map();for(const id of ['status','badge','pair','code','connect','refresh','codeError','ready','help'])elements.set(id,{id,value:'',dataset:{},handlers:{},attributes:{},addEventListener(name,callback){this.handlers[name]=callback;},setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused=true;}});
  const calls=[],context={document:{getElementById:id=>elements.get(id)},chrome:{runtime:{sendMessage:async message=>{calls.push(message);return send(message);}}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8'),context);
  return {elements,calls,context,submit:()=>elements.get('pair').handlers.submit({preventDefault(){}})};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('popup rejects incomplete code locally and sends no pairing attempt',async()=>{
  const {elements,calls,submit}=setup(()=>({connected:false}));await flush();elements.get('code').value='1234';await submit();
  assert.equal(calls.filter(c=>c.type==='baseball-pair').length,0);assert.equal(elements.get('code').attributes['aria-invalid'],'true');assert.equal(elements.get('code').focused,true);
});
test('popup normalizes pasted whitespace and lowercase, then clears code after successful pairing',async()=>{
  const {elements,calls,submit}=setup(m=>({connected:m.type==='baseball-pair'}));await flush();elements.get('code').value='  abcdabcdabcdabcd\n abcdabcdabcdabcd  ';await submit();
  assert.equal(calls.find(c=>c.type==='baseball-pair').code,'ABCDABCDABCDABCDABCDABCDABCDABCD');assert.equal(elements.get('code').value,'');assert.equal(elements.get('pair').hidden,true);assert.equal(elements.get('badge').textContent,'연결됨');
});
test('popup holds one pairing request at a time and exposes recovery help on expiration',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const {elements,calls,submit}=setup(m=>m.type==='baseball-pair'?wait:{connected:false});await flush();elements.get('code').value='A'.repeat(32);
  const first=submit();await submit();assert.equal(calls.filter(c=>c.type==='baseball-pair').length,1);assert.equal(elements.get('connect').disabled,true);
  release({error:'프로그램 연결 코드로 다시 연결해 주세요.'});await first;assert.match(elements.get('status').textContent,/새 연결 코드/);assert.equal(elements.get('help').open,true);assert.equal(elements.get('connect').disabled,false);
});
test('a late initial status response cannot overwrite a completed pairing',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const {elements,submit}=setup(m=>m.type==='baseball-status'?wait:{connected:true});elements.get('code').value='A'.repeat(32);await submit();release({connected:false});await flush();assert.equal(elements.get('badge').textContent,'연결됨');
});
test('popup network errors provide an executable recovery step and connected status hides pairing form',async()=>{
  const failed=setup(()=>Promise.reject(Error('Failed to fetch')));await flush();assert.match(failed.elements.get('status').textContent,/도우미를 실행/);
  const connected=setup(()=>({connected:true}));await flush();assert.equal(connected.elements.get('pair').hidden,true);assert.equal(connected.elements.get('ready').hidden,false);
});
