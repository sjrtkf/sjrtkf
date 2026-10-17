'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function worker(){
  const messages=[],listeners={},tab={id:7,url:'https://tickets.interpark.com/onestop/seat',windowId:1};
  const event=name=>({addListener(fn){listeners[name]=fn;}});
  const chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.6.0'}),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:event('message'),sendMessage:async()=>({value:true})},tabs:{get:async()=>tab,query:async()=>[tab],sendMessage:async(id,msg,options)=>{messages.push({id,msg,options});return {value:true};},onUpdated:event('update'),onCreated:event('created'),onRemoved:event('removed')},webNavigation:{getFrame:async()=>({documentId:'doc1',url:tab.url}),onDOMContentLoaded:event('dom')},scripting:{executeScript:async()=>{}},storage:{session:{get:async()=>({}),remove:async()=>{},set:async()=>{}}},action:{setBadgeText:async()=>{}},alarms:{create(){},onAlarm:event('alarm')},windows:{update:async()=>{}}};
  chrome.storage.local={...chrome.storage.session,setAccessLevel:async()=>{}};
  const context=vm.createContext({chrome,URL,AbortSignal,Date,console,setInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>({ok:true,json:async()=>({alive:true})}),importScripts(){},BaseballCodeActions:require('../src/site-code').CODE_ACTIONS,BaseballCodeDispatch(){},BaseballParsers:{},createBaseballNetworkObserver:()=>({setBackground:async()=>true,detachAll:async()=>{},attach:async()=>true,detach:async()=>true,snapshot:()=>({healthy:true})})});
  chrome.scripting.executeScript=async options=>{const [action,arg]=options.args||[];const documentId=options.target.documentIds[0];const result=await chrome.tabs.sendMessage(options.target.tabId,{type:action==='lease'?'baseball-lease':action==='stop'?'baseball-stop':'baseball-action',action,arg},{documentId,world:options.world});return [{documentId,result:{ok:true,value:action==='lease'?{ready:true}:result.value||{ready:true}}}];};
  vm.runInContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),context);vm.runInContext("connected=true; token='test-token'; tracked.set(7,{id:7,url:'https://tickets.interpark.com/onestop/seat',documentId:'doc1'});",context);
  return {context,chrome,messages,listeners,dispatch:vm.runInContext('dispatch',context),disconnect:vm.runInContext('disconnected',context)};
}
const command=(action,extra={})=>({action,tabId:7,documentId:'doc1',expiresAt:Date.now()+10000,...extra});

test('worker restart restores persistent pairing and starts reconnecting without a pairing popup',async()=>{
  const w=worker(),writes=[];
  w.chrome.storage.local.get=async()=>({bridgeToken:'saved-credential'});
  w.chrome.storage.local.set=async value=>writes.push(value);
  vm.runInContext('poll=async()=>{globalThis.reconnected=true;}',w.context);
  await vm.runInContext('credentialsReady',w.context);await new Promise(r=>setImmediate(r));
  assert.equal(w.context.reconnected,true);assert.equal(vm.runInContext('token',w.context),'saved-credential');assert.equal(writes[0].bridgeToken,'saved-credential');
  await w.disconnect(Error('temporary app exit'));assert.equal(vm.runInContext('token',w.context),'saved-credential');
  let cleared=false;w.chrome.storage.local.remove=async()=>{cleared=true;};
  await w.disconnect(Object.assign(Error('revoked'),{status:401}));assert.equal(cleared,true);assert.equal(vm.runInContext('token',w.context),null);
});

test('extension reload is a fixed command that cleans up without navigating or injecting source',async()=>{
  const w=worker();const result=await w.dispatch(command('extension.reload',{tabId:undefined}));
  assert.equal(result.reload,true);assert.equal(w.messages.some(m=>m.msg.type==='baseball-action'),false);
});

test('argument-free page reads, heartbeat and stop pass Chrome serializable argument validation',async()=>{
  const w=worker(),scripts=[];
  w.chrome.scripting.executeScript=async options=>{
    for(const [index,value] of options.args.entries())if(JSON.stringify(value)===undefined)throw Error('Error at property args: Error at index '+index+': Value is unserializable.');
    scripts.push(options);return [{documentId:'doc1',result:{ok:true,value:{ready:true}}}];
  };
  await w.dispatch(command('flow.scene'));
  await w.dispatch(command('page.pageClock'));
  await vm.runInContext('pulse()',w.context);await new Promise(r=>setImmediate(r));
  await w.dispatch(command('page.stopWatchers'));
  await w.disconnect(Error('fixture disconnect'));
  for(const action of ['flow.scene','page.pageClock','lease','stop']){
    const calls=scripts.filter(s=>s.args[0]===action);assert.ok(calls.length>0,action);
    for(const call of calls)assert.equal(call.args[1],null);
  }
});
test('background pins each action to the native Chrome document ID',async()=>{const w=worker();await w.dispatch(command('flow.scene'));assert.equal(w.messages.at(-1).options.documentId,'doc1');assert.equal(w.messages.at(-1).msg.action,'flow.scene');});

test('remaining booking actions execute in MAIN world without an isolated action fallback',async()=>{
  for(const action of ['entry.prepareEntry','entry.armGate','live.liveAction','flow.clickKnown','flow.dismissEmptySelection']){
    const w=worker(),scripts=[];
    w.chrome.scripting.executeScript=async options=>{scripts.push(options);return [{documentId:'doc1',result:{ok:true,value:{ready:true}}}];};
    await w.dispatch(command(action));
    assert.equal(scripts.length,2);assert.equal(scripts[0].args[0],'lease');assert.equal(scripts[1].args[0],action);
    for(const script of scripts){assert.equal(script.world,'MAIN');assert.deepEqual([...script.target.documentIds],['doc1']);}
    assert.equal(w.messages.some(m=>m.msg.type==='baseball-action'),false);
  }
});

test('site code errors preserve only their code and never fall back to clicking',async()=>{
  const w=worker();w.chrome.scripting.executeScript=async options=>[{documentId:'doc1',result:options.args[0]==='lease'?{ok:true,value:{ready:true}}:{ok:false,code:'SITE_FUNCTION_UNAVAILABLE'}}];
  await assert.rejects(w.dispatch(command('flow.clickKnown')),/SITE_FUNCTION_UNAVAILABLE/);
  assert.equal(w.messages.some(m=>m.msg.type==='baseball-action'),false);
});

test('stop invalidates a site action suspended during the initial MAIN handshake',async()=>{
  const w=worker(),scripts=[];let release;
  w.chrome.scripting.executeScript=async options=>{scripts.push(options);if(options.args[0]==='lease')await new Promise(r=>{release=r;});return [{documentId:'doc1',result:{ok:true,value:{ready:true}}}];};
  const pending=w.dispatch(command('entry.prepareEntry'));
  while(!release)await new Promise(r=>setImmediate(r));
  await w.dispatch(command('page.stopWatchers'));release();await pending;
  const before=scripts.find(s=>s.args[0]==='entry.prepareEntry').args[2].epoch,stop=scripts.find(s=>s.args[0]==='stop').args[2].epoch;
  assert.ok(before<stop); // The page runtime rejects this older epoch before invoking a handler.
});

test('HTTP navigation uses the static MAIN-world function in exactly the pinned document',async()=>{
  const w=worker(),scripts=[];w.context.BaseballHttpNavigate=require('../src/http-booking').httpBookingNavigate;
  w.chrome.scripting.executeScript=async options=>{scripts.push(options);return [{documentId:'doc1',result:{supported:true}}];};
  const result=await w.dispatch(command('httpBooking.httpBookingNavigate',{arg:{runId:'test',checkOnly:true}}));
  assert.equal(result.supported,true);assert.equal(scripts.length,1);assert.equal(scripts[0].world,'MAIN');assert.deepEqual([...scripts[0].target.documentIds],['doc1']);
  assert.equal(scripts[0].func,w.context.BaseballHttpNavigate);assert.equal(scripts[0].args[0].checkOnly,true);
  assert.equal(w.messages.some(m=>m.msg.action==='httpBooking.httpBookingNavigate'),false);
});

test('HTTP navigation never accepts an acknowledgement from another document',async()=>{
  const w=worker();w.context.BaseballHttpNavigate=require('../src/http-booking').httpBookingNavigate;
  w.chrome.scripting.executeScript=async()=>[{documentId:'old',result:{dispatched:true}}];
  await assert.rejects(w.dispatch(command('httpBooking.httpBookingNavigate',{arg:{runId:'test'}})),/화면|확인/);
});
test('background refuses expired and navigated commands before sending page actions',async()=>{const w=worker();await assert.rejects(w.dispatch(command('live.liveAction',{expiresAt:Date.now()-1})),/만료/);await assert.rejects(w.dispatch(command('live.liveAction',{documentId:'old'})),/페이지가 바뀌어/);assert.equal(w.messages.length,0);});
test('stop epoch cancels an older selection paused in a Chrome API await',async()=>{const w=worker();let release;const original=w.chrome.tabs.get;let first=true;w.chrome.tabs.get=async()=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return original();};const pending=w.dispatch(command('live.liveAction'));const rejected=assert.rejects(pending,/중지/);await w.dispatch(command('page.stopWatchers'));release(await original());await rejected;assert.equal(w.messages.some(m=>m.msg.action==='live.liveAction'),false);assert.equal(w.messages.some(m=>m.msg.action==='page.stopWatchers'),true);});
test('transport disconnect cancels awaited commands and sends page stop immediately',async()=>{const w=worker();let release;const original=w.chrome.tabs.get;w.chrome.tabs.get=()=>new Promise(resolve=>{release=resolve;});const pending=w.dispatch(command('entry.armGate'));const rejected=assert.rejects(pending,/중지/);await w.disconnect(Error('connection lost'));release(await original());await rejected;assert.equal(w.messages.some(m=>m.msg.type==='baseball-stop'),true);assert.equal(w.messages.some(m=>m.msg.action==='entry.armGate'),false);});
test('web content cannot send popup pairing or execute a desktop command',()=>{const w=worker();let replied=false;w.listeners.message({type:'baseball-pair',code:'bad'},{id:'a'.repeat(32),tab:{id:7},url:'https://tickets.interpark.com/onestop/seat',frameId:0},()=>{replied=true;});assert.equal(replied,false);assert.equal(w.messages.length,0);});

test('popup pairing reports installed extension version and supported page information action',async()=>{
  const w=worker(),requests=[];vm.runInContext("connected=false;token=null;poll=async()=>{}",w.context);
  w.context.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({token:'fixture-session'})};};
  const response=await new Promise(resolve=>w.listeners.message({type:'baseball-pair',code:'A'.repeat(32)},{id:w.chrome.runtime.id,url:w.chrome.runtime.getURL('popup.html')},resolve));
  assert.equal(response.connected,true);assert.equal(requests[0].body.version,'0.6.0');assert.deepEqual(requests[0].body.capabilities,['entry.pageInfo','entry.bookingNotice','captcha.ocr','captcha.manual','extension.reload']);assert.equal(requests[0].url,'http://127.0.0.1:43187/pair');
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
