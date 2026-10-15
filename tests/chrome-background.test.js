'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function worker(){
  const messages=[],listeners={},tab={id:7,url:'https://tickets.interpark.com/onestop/seat',windowId:1};
  const event=name=>({addListener(fn){listeners[name]=fn;}});
  const chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.6.0'}),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:event('message'),sendMessage:async()=>({value:true})},tabs:{get:async()=>tab,query:async()=>[tab],sendMessage:async(id,msg,options)=>{messages.push({id,msg,options});return {value:true};},onUpdated:event('update'),onCreated:event('created'),onRemoved:event('removed')},webNavigation:{getFrame:async()=>({documentId:'doc1',url:tab.url}),onDOMContentLoaded:event('dom')},scripting:{executeScript:async()=>{}},storage:{session:{get:async()=>({}),remove:async()=>{},set:async()=>{}}},action:{setBadgeText:async()=>{}},alarms:{create(){},onAlarm:event('alarm')},windows:{update:async()=>{}}};
  const context=vm.createContext({chrome,URL,AbortSignal,Date,console,setInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({alive:true})}),importScripts(){},BaseballParsers:{},createBaseballNetworkObserver:()=>({detachAll:async()=>{},attach:async()=>true,detach:async()=>true,snapshot:()=>({healthy:true})})});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),context);vm.runInContext("connected=true; token='test-token'; tracked.set(7,{id:7,url:'https://tickets.interpark.com/onestop/seat',documentId:'doc1'});",context);
  return {context,chrome,messages,listeners,dispatch:vm.runInContext('dispatch',context),disconnect:vm.runInContext('disconnected',context)};
}
const command=(action,extra={})=>({action,tabId:7,documentId:'doc1',expiresAt:Date.now()+10000,...extra});
test('background pins each action to the native Chrome document ID',async()=>{const w=worker();await w.dispatch(command('flow.scene'));assert.equal(w.messages.at(-1).options.documentId,'doc1');assert.equal(w.messages.at(-1).msg.action,'flow.scene');});
test('background refuses expired and navigated commands before sending page actions',async()=>{const w=worker();await assert.rejects(w.dispatch(command('live.liveAction',{expiresAt:Date.now()-1})),/만료/);await assert.rejects(w.dispatch(command('live.liveAction',{documentId:'old'})),/페이지가 바뀌어/);assert.equal(w.messages.length,0);});
test('stop epoch cancels an older selection paused in a Chrome API await',async()=>{const w=worker();let release;const original=w.chrome.tabs.get;let first=true;w.chrome.tabs.get=async()=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return original();};const pending=w.dispatch(command('live.liveAction'));const rejected=assert.rejects(pending,/중지/);await w.dispatch(command('page.stopWatchers'));release(await original());await rejected;assert.equal(w.messages.some(m=>m.msg.action==='live.liveAction'),false);assert.equal(w.messages.some(m=>m.msg.action==='page.stopWatchers'),true);});
test('transport disconnect cancels awaited commands and sends page stop immediately',async()=>{const w=worker();let release;const original=w.chrome.tabs.get;w.chrome.tabs.get=()=>new Promise(resolve=>{release=resolve;});const pending=w.dispatch(command('entry.armGate'));const rejected=assert.rejects(pending,/중지/);await w.disconnect(Error('connection lost'));release(await original());await rejected;assert.equal(w.messages.some(m=>m.msg.type==='baseball-stop'),true);assert.equal(w.messages.some(m=>m.msg.action==='entry.armGate'),false);});
test('web content cannot send popup pairing or execute a desktop command',()=>{const w=worker();let replied=false;w.listeners.message({type:'baseball-pair',code:'bad'},{id:'a'.repeat(32),tab:{id:7},url:'https://tickets.interpark.com/onestop/seat',frameId:0},()=>{replied=true;});assert.equal(replied,false);assert.equal(w.messages.length,0);});

test('popup pairing reports installed extension version and supported page information action',async()=>{
  const w=worker(),requests=[];vm.runInContext("connected=false;token=null;poll=async()=>{}",w.context);
  w.context.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({token:'fixture-session'})};};
  const response=await new Promise(resolve=>w.listeners.message({type:'baseball-pair',code:'A'.repeat(32)},{id:w.chrome.runtime.id,url:w.chrome.runtime.getURL('popup.html')},resolve));
  assert.equal(response.connected,true);assert.equal(requests[0].body.version,'0.6.0');assert.deepEqual(requests[0].body.capabilities,['entry.pageInfo','entry.bookingNotice','captcha.ocr','captcha.manual']);assert.equal(requests[0].url,'http://127.0.0.1:43187/pair');
});

function captchaWorker({multiple=false}={}){
  const w=worker();
  let frames=[{frameId:0,documentId:'doc1',url:'https://ticket.interpark.com/Book/BookSession.asp'},{frameId:3,documentId:'child1',url:'https://ticket.interpark.com/Book/BookSeat.asp'},{frameId:4,documentId:'third-party',url:'https://example.com/captcha'}];
  w.chrome.tabs.get=async()=>({id:7,url:frames[0].url,windowId:1});w.chrome.webNavigation.getFrame=async()=>frames[0];w.chrome.webNavigation.getAllFrames=async()=>frames;
  w.chrome.tabs.sendMessage=async(id,msg,options)=>{w.messages.push({id,msg,options});if(msg.action==='captcha.captchaSnapshot')return {value:options.documentId==='child1'||multiple?{present:true,supported:true,status:'ready',challengeId:'challenge-'+options.documentId,imageDataUrl:'data:image/png;base64,QUJD'}:{present:false,supported:true,status:'absent'}};return {value:{submitted:true,status:'submitted'}};};
  return {...w,setFrames:value=>{frames=value;}};
}
test('CAPTCHA snapshots find an allowed legacy child frame and pin submission to that document',async()=>{
  const w=captchaWorker(),s=await w.dispatch(command('captcha.captchaSnapshot'));assert.equal(s.challengeId,'challenge-child1');
  const result=await w.dispatch(command('captcha.captchaSubmit',{arg:{challengeId:s.challengeId,text:'ABCDEF'}}));assert.equal(result.submitted,true);
  const submit=w.messages.find(m=>m.msg.action==='captcha.captchaSubmit');assert.equal(submit.options.documentId,'child1');assert.equal(w.messages.some(m=>m.options?.documentId==='third-party'),false);
});
test('CAPTCHA refuses multiple frames and removed/reloaded child frame identities',async()=>{
  const ambiguous=captchaWorker({multiple:true});assert.equal((await ambiguous.dispatch(command('captcha.captchaSnapshot'))).status,'unsupported');
  const w=captchaWorker(),s=await w.dispatch(command('captcha.captchaSnapshot'));w.setFrames([{frameId:0,documentId:'doc1',url:'https://ticket.interpark.com/Book/BookSession.asp'},{frameId:3,documentId:'child2',url:'https://ticket.interpark.com/Book/BookSeat.asp'}]);
  const result=await w.dispatch(command('captcha.captchaSubmit',{arg:{challengeId:s.challengeId,text:'ABCDEF'}}));assert.equal(result.status,'changed');assert.equal(w.messages.some(m=>m.msg.action==='captcha.captchaSubmit'),false);
});
test('CAPTCHA cancellation invalidates a pending browser command before input submission',async()=>{
  const w=captchaWorker(),s=await w.dispatch(command('captcha.captchaSnapshot'));let release;const original=w.chrome.tabs.get;let first=true;w.chrome.tabs.get=async()=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return original();};
  const pending=w.dispatch(command('captcha.captchaSubmit',{arg:{challengeId:s.challengeId,text:'ABCDEF'}})),rejected=assert.rejects(pending,/중지/);
  await w.dispatch(command('captcha.captchaCancel'));release(await original());await rejected;assert.equal(w.messages.some(m=>m.msg.action==='captcha.captchaSubmit'),false);assert.equal(w.messages.some(m=>m.msg.action==='captcha.captchaCancel'&&m.options.documentId==='child1'),true);
});
test('legacy windows expose only CAPTCHA actions rather than unverified entry and seat controls',async()=>{
  const w=captchaWorker();await assert.rejects(w.dispatch(command('live.liveAction')),/보안문자 단독 테스트/);assert.equal(w.messages.some(m=>m.msg.action==='live.liveAction'),false);
});
test('disconnect stops both the top and discovered CAPTCHA child documents',async()=>{
  const w=captchaWorker();await w.dispatch(command('captcha.captchaSnapshot'));await w.disconnect(Error('gone'));assert.equal(w.messages.some(m=>m.msg.type==='baseball-stop'&&m.options?.documentId==='child1'),true);
});

test('opening the demo uses the refreshed tab instead of the incomplete tabs.create result',async()=>{
  const w=worker(),url=w.chrome.runtime.getURL('demo.html');
  w.chrome.tabs.create=async()=>({id:8,url:'',pendingUrl:url,windowId:1,active:true});
  w.chrome.tabs.query=async()=>[{id:8,url,title:'연습용 좌석',windowId:1,active:true}];
  w.chrome.webNavigation.getFrame=async()=>null;
  const row=await w.dispatch(command('tabs.demo'));
  assert.equal(row.id,8);assert.equal(row.url,url);assert.equal(row.title,'연습용 좌석');assert.equal(row.documentId,null);
});

test('opening a still-loading tab returns its validated requested URL without inventing a document',async()=>{
  for(const action of ['tabs.demo','tabs.open']){
    const w=worker(),url=action==='tabs.demo'?w.chrome.runtime.getURL('demo.html'):'https://nol.yanolja.com/ticket/genre/sports/postseason?fixture=private';
    w.chrome.tabs.create=async()=>({id:8,windowId:1,active:true});
    w.chrome.tabs.query=async()=>[{id:8,url:'',pendingUrl:url,windowId:1,active:true}];
    w.chrome.webNavigation.getFrame=async()=>{throw Error('No frame yet');};
    const row=await w.dispatch(command(action,{arg:{url}}));
    assert.equal(row.id,8);assert.equal(row.url,url.split('?')[0]);assert.equal(row.documentId,null);
  }
});

function demoWorker(){
  const w=worker(),url=w.chrome.runtime.getURL('demo.html'),documentId='demo:00000000-0000-4000-8000-000000000001';
  w.chrome.tabs.get=async()=>({id:7,url,windowId:1});w.chrome.tabs.query=async()=>[{id:7,url,windowId:1}];
  w.chrome.webNavigation.getFrame=async()=>null;
  w.chrome.runtime.sendMessage=async msg=>{w.messages.push({msg});return msg.type==='baseball-action'?{value:{selected:[]}}:{ready:true,documentId};};
  vm.runInContext(`tracked.set(7,{id:7,url:chrome.runtime.getURL('demo.html'),documentId:${JSON.stringify(documentId)}})`,w.context);
  return {...w,documentId};
}

test('demo commands use their runtime document identity when webNavigation has no frame',async()=>{
  const w=demoWorker(),result=await w.dispatch(command('flow.scene',{documentId:w.documentId}));
  assert.equal(result.selected.length,0);
  const action=w.messages.find(m=>m.msg.type==='baseball-action');assert.equal(action.msg.demoTabId,7);assert.equal(action.msg.demoDocumentId,w.documentId);
});

test('demo tab listings carry the runtime identity and reject commands from a previous reload',async()=>{
  const w=demoWorker(),rows=await w.dispatch(command('tabs.list'));
  assert.equal(rows[0].documentId,w.documentId);
  await assert.rejects(w.dispatch(command('flow.scene',{documentId:'demo:00000000-0000-4000-8000-000000000002'})),/페이지가 바뀌어/);
  assert.equal(w.messages.some(m=>m.msg.type==='baseball-action'),false);
});

test('official pages still require native document IDs even when runtime demo messaging is available',async()=>{
  const w=worker();w.chrome.webNavigation.getFrame=async()=>null;
  w.chrome.runtime.sendMessage=async()=>({ready:true,documentId:'demo:00000000-0000-4000-8000-000000000001'});
  await assert.rejects(w.dispatch(command('flow.scene')),/Chrome 화면을 준비/);
  assert.equal(w.messages.length,0);
});

function manualWorker(){
  const w=worker();
  let frames=[{frameId:0,documentId:'doc1',url:'https://ticket.interpark.com/Book/BookSession.asp'},{frameId:3,documentId:'child1',url:'https://ticket.interpark.com/Book/BookSeat.asp'},{frameId:4,documentId:'third-party',url:'https://example.com/captcha'}];
  let present=new Set(['child1']),challenge='human-challenge-1';
  w.chrome.tabs.get=async()=>({id:7,url:frames[0].url,windowId:1});w.chrome.webNavigation.getFrame=async()=>frames[0];w.chrome.webNavigation.getAllFrames=async()=>frames;
  w.chrome.tabs.sendMessage=async(id,msg,options)=>{
    w.messages.push({id,msg,options});
    if(msg.action==='manualCaptcha.manualCaptchaPrepare')return {value:present.has(options.documentId)?{present:true,supported:true,status:'ready',challengeId:challenge+'-'+options.documentId,imageDataUrl:'data:image/png;base64,QUJD',focused:msg.arg?.focus===true}:{present:false,supported:true,status:'absent'}};
    if(msg.action==='manualCaptcha.manualCaptchaCancel')return {value:{cancelled:true}};
    return {value:{submitted:true,status:'submitted'}};
  };
  return {...w,setFrames:value=>{frames=value;},setPresent:value=>{present=new Set(value);},setChallenge:value=>{challenge=value;}};
}

test('manual CAPTCHA probes frames without focus, then focuses and submits only to the single prepared document',async()=>{
  const w=manualWorker(),prepared=await w.dispatch(command('manualCaptcha.manualCaptchaPrepare',{arg:{focus:true}}));
  assert.equal(prepared.challengeId,'human-challenge-1-child1');assert.equal(prepared.focused,true);
  const focus=w.messages.filter(m=>m.msg.action==='manualCaptcha.manualCaptchaPrepare'&&m.msg.arg?.focus);
  assert.equal(focus.length,1);assert.equal(focus[0].options.documentId,'child1');
  const result=await w.dispatch(command('manualCaptcha.manualCaptchaSubmit',{arg:{challengeId:prepared.challengeId,text:'ABCDEF'}}));
  assert.equal(result.submitted,true);
  const submit=w.messages.filter(m=>m.msg.action==='manualCaptcha.manualCaptchaSubmit');
  assert.equal(submit.length,1);assert.equal(submit[0].options.documentId,'child1');assert.equal(submit[0].msg.arg.text,'ABCDEF');
  assert.equal(w.messages.some(m=>m.options?.documentId==='third-party'||m.msg.action?.startsWith('captcha.')),false);
  assert.equal((await w.dispatch(command('manualCaptcha.manualCaptchaSubmit',{arg:{challengeId:prepared.challengeId,text:'ABCDEF'}}))).status,'changed');
});

test('manual CAPTCHA rejects ambiguity before focusing and rechecks new ambiguity before submission',async()=>{
  const w=manualWorker();w.setPresent(['doc1','child1']);
  assert.equal((await w.dispatch(command('manualCaptcha.manualCaptchaPrepare',{arg:{focus:true}}))).status,'unsupported');
  assert.equal(w.messages.some(m=>m.msg.arg?.focus===true),false);
  w.setPresent(['child1']);const prepared=await w.dispatch(command('manualCaptcha.manualCaptchaPrepare',{arg:{focus:false}}));
  w.setPresent(['doc1','child1']);
  assert.equal((await w.dispatch(command('manualCaptcha.manualCaptchaSubmit',{arg:{challengeId:prepared.challengeId,text:'ABCDEF'}}))).status,'unsupported');
  assert.equal(w.messages.some(m=>m.msg.action==='manualCaptcha.manualCaptchaSubmit'),false);
});

test('manual CAPTCHA refuses replaced images, unknown tokens, and child document reloads',async()=>{
  for(const change of ['image','child','unknown']){
    const w=manualWorker(),prepared=await w.dispatch(command('manualCaptcha.manualCaptchaPrepare'));
    if(change==='image')w.setChallenge('new-image');
    if(change==='child')w.setFrames([{frameId:0,documentId:'doc1',url:'https://ticket.interpark.com/Book/BookSession.asp'},{frameId:3,documentId:'child2',url:'https://ticket.interpark.com/Book/BookSeat.asp'}]);
    const result=await w.dispatch(command('manualCaptcha.manualCaptchaSubmit',{arg:{challengeId:change==='unknown'?'unknown':prepared.challengeId,text:'ABCDEF'}}));
    assert.equal(result.status,'changed',change);assert.equal(w.messages.some(m=>m.msg.action==='manualCaptcha.manualCaptchaSubmit'),false,change);
  }
});

test('manual cancellation targets its prepared frame and refuses a replaced image',async()=>{
  const w=manualWorker(),prepared=await w.dispatch(command('manualCaptcha.manualCaptchaPrepare'));
  assert.equal((await w.dispatch(command('manualCaptcha.manualCaptchaCancel',{arg:{challengeId:prepared.challengeId}}))).cancelled,true);
  const cancelled=w.messages.find(m=>m.msg.action==='manualCaptcha.manualCaptchaCancel');assert.equal(cancelled.options.documentId,'child1');
  const fresh=manualWorker(),old=await fresh.dispatch(command('manualCaptcha.manualCaptchaPrepare'));fresh.setChallenge('new-image');
  assert.equal((await fresh.dispatch(command('manualCaptcha.manualCaptchaCancel',{arg:{challengeId:old.challengeId}}))).status,'changed');
  assert.equal(fresh.messages.some(m=>m.msg.action==='manualCaptcha.manualCaptchaCancel'),false);
});

test('manual cancellation stops a pending browser submission before page input',async()=>{
  const w=manualWorker(),prepared=await w.dispatch(command('manualCaptcha.manualCaptchaPrepare'));let release,first=true;const original=w.chrome.tabs.get;
  w.chrome.tabs.get=async()=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return original();};
  const pending=w.dispatch(command('manualCaptcha.manualCaptchaSubmit',{arg:{challengeId:prepared.challengeId,text:'ABCDEF'}}));const rejected=assert.rejects(pending,/중지/);
  await w.dispatch(command('manualCaptcha.manualCaptchaCancel',{arg:{challengeId:prepared.challengeId}}));release(await original());await rejected;
  assert.equal(w.messages.some(m=>m.msg.action==='manualCaptcha.manualCaptchaSubmit'),false);
});

test('manual preparation keeps the legacy child lease alive while the person reads and types',async()=>{
  const w=manualWorker();await w.dispatch(command('manualCaptcha.manualCaptchaPrepare'));w.messages.length=0;
  await vm.runInContext('pulse()',w.context);await new Promise(setImmediate);
  assert.equal(w.messages.some(m=>m.msg.type==='baseball-lease'&&m.options?.documentId==='child1'),true);
});

test('page stop and disconnect cancel manual state in the prepared legacy child document',async()=>{
  for(const action of ['stop','disconnect']){
    const w=manualWorker(),prepared=await w.dispatch(command('manualCaptcha.manualCaptchaPrepare'));
    if(action==='stop')await w.dispatch(command('page.stopWatchers'));else await w.disconnect(Error('gone'));
    assert.equal(w.messages.some(m=>m.msg.type==='baseball-stop'&&m.options?.documentId==='child1'),true,action);
    if(action==='stop')assert.equal((await w.dispatch(command('manualCaptcha.manualCaptchaSubmit',{arg:{challengeId:prepared.challengeId,text:'ABCDEF'}}))).status,'changed');
  }
});
