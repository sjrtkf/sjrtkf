'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {startLiveBookingTest,cliOptions,validateConfig,inspectTargets,routeOf,identityOf}=require('../src/live-booking-test');
const NOW=Date.parse('2026-10-20T12:00:00+09:00');
const expected={goodsCode:'26014425',placeCode:'26000514',playSeq:'001',playDate:'20261023',playTime:'18:30'};
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ticket-live-booking-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[],invokes=[],runs={current:null};
  const config={testId:'ordinary-seat-one',tabId:7,expected,saleOpenAt:NOW-60000,expiresAt:NOW+60000,maxRunMs:5000,...options.config};
  const configPath=path.join(root,'config.json');fs.writeFileSync(configPath,JSON.stringify(config));
  const target={id:7,documentId:'stable',url:'https://tickets.interpark.com/onestop/seat',getURL(){return this.url;},getTitle(){return '경기 좌석';},isDestroyed(){return false;},async invoke(fn){
    invokes.push(fn.name);
    if(options.invoke)return options.invoke(fn,this);
    if(fn.name==='bookingIdentity')return expected;
    if(fn.name==='scene')return {selected:[],busy:false,captcha:false,grades:[]};
    if(fn.name==='bookingProgress')return {ready:true};
    throw Error('unexpected action '+fn.name);
  }};
  const targets=new Map([[7,target]]),bridge={getState:()=>({connected:true,extensionVersion:'0.9.28',...options.connection})};
  const command=async(action,payload)=>{
    calls.push({action,payload});
    if(action==='start'){
      const run={targetId:7};
      run.task=options.neverComplete?new Promise(()=>{}):new Promise((resolve,reject)=>setTimeout(()=>{target.url=options.finalUrl||'https://tickets.interpark.com/onestop/payment';runs.current=null;if(options.runError)reject(Error(options.runError));else resolve({completed:true,bookingAdvanced:true,standardPriceSelected:true,httpRequestCount:6,...options.result});},10));
      runs.current=run;
    }
    if(action==='stop')runs.current=null;
  };
  const args={mode:'run',configPath,configRoot:root,bridge,targets,command,runs,dataRoot:path.join(root,'reports'),getPreferences:()=>({quantity:3,areas:['3루 일반석'],blocks:['104'],tiers:[{name:'1순위',areas:['3루 일반석'],blocks:[]}],excludeRestricted:false,autoComplete:false}),version:'0.9.28',connectionWaitMs:0,now:()=>NOW};
  return {root,args,config,calls,invokes,target,targets,runs,bridge};
}
test('no explicit flag does not enable a live test; mixed flags are rejected',()=>{
  assert.equal(cliOptions(['app','--panel-smoke']),null);
  assert.deepEqual(cliOptions(['--live-booking-inspect']),{mode:'inspect'});
  assert.deepEqual(cliOptions(['--live-booking-test=F:\\source\\work\\run.json']),{mode:'run',configPath:'F:\\source\\work\\run.json'});
  assert.throws(()=>cliOptions(['--live-booking-inspect','--live-booking-test=a']),/FLAGS_INVALID/);
});
test('configuration requires exact game identity, an open sale and future event',()=>{
  const base={testId:'case-0001',tabId:7,expected,saleOpenAt:NOW-1,expiresAt:NOW+10000};
  assert.equal(validateConfig(base,NOW).maxRunMs,90000);
  for(const [patch,code] of [[{expected:{...expected,playSeq:''}},'IDENTITY_REQUIRED'],[{saleOpenAt:NOW+1},'SALE_NOT_OPEN'],[{expected:{...expected,playDate:'20261019'}},'EVENT_PAST'],[{expiresAt:NOW},'CONFIG_EXPIRED'],[{maxRunMs:121000},'CONFIG_INVALID']])assert.throws(()=>validateConfig({...base,...patch},NOW),new RegExp(code));
  assert.equal(identityOf({...expected,playDate:'20260230'}),null);
  assert.equal(identityOf({...expected,playTime:'6:30 PM'}).playTime,'18:30');
  assert.equal(identityOf({...expected,playTime:'13:00 PM'}),null);
});
test('inspection reads existing targets without target/start commands or API queries and omits secrets',async t=>{
  const f=fixture(t);
  f.target.url+='?signature=SECRET_TOKEN#COOKIE';
  const listing={id:8,documentId:'list',getURL:()=> 'https://nol.yanolja.com/ticket/genre/sports/postseason?token=SECRET_TOKEN',getTitle:()=> '포스트시즌',isDestroyed:()=>false,invoke:async fn=>{assert.equal(fn.name,'gameCards');return [{key:'10월 23일 18:30 | 팀A vs 팀B',label:'경기',schedule:'10월 20일 오픈',buttonText:'예매하기',cookie:'SECRET_TOKEN'}];}};
  f.targets.set(8,listing);
  const output=await startLiveBookingTest({...f.args,mode:'inspect',getActiveTargetId:()=>7});
  assert.equal(output.result.tabs[0].selected,true);
  assert.equal(output.result.tabs[0].identity.goodsCode,expected.goodsCode);
  assert.equal(output.result.tabs[1].games.length,1);
  assert.deepEqual(f.calls,[]);
  assert.equal(fs.readFileSync(output.file,'utf8').includes('SECRET_TOKEN'),false);
  assert.equal(output.result.paymentAttempted,false);
});
test('run uses production start once, retains priorities and forces one ordinary ticket through payment',async t=>{
  const f=fixture(t),output=await startLiveBookingTest(f.args);
  assert.equal(output.result.phase,'payment-confirmed');
  assert.equal(output.result.paymentAttempted,false);
  assert.deepEqual(f.calls.map(c=>c.action),['target','start']);
  const payload=f.calls[1].payload;
  assert.equal(payload.preferences.quantity,1);assert.equal(payload.preferences.excludeRestricted,true);assert.equal(payload.preferences.autoComplete,true);assert.equal(payload.preferences.selectionMethod,'api');
  assert.deepEqual(payload.preferences.areas,['3루 일반석']);assert.deepEqual(payload.preferences.blocks,['104']);assert.equal(payload.preferences.tiers.length,1);
  assert.deepEqual(payload.validationExpectedBooking,expected);
  await assert.rejects(startLiveBookingTest(f.args),/ALREADY_ATTEMPTED/);
  assert.equal(f.calls.filter(c=>c.action==='start').length,1);
});
test('wrong identity or a document change prevents all booking commands',async t=>{
  for(const changed of [false,true]){
    const f=fixture(t,{invoke:async(fn,target)=>{if(changed)target.documentId='new';return {...expected,goodsCode:'26019999'};}});
    const output=await startLiveBookingTest(f.args);
    assert.equal(output.result.error,changed?'LIVE_TEST_TARGET_CHANGED':'LIVE_TEST_IDENTITY_MISMATCH');assert.deepEqual(f.calls,[]);
  }
});
test('existing selections, captcha, notice and price pages stop before start',async t=>{
  for(const scene of [{selected:['seat_block_existing']},{selected:[],captcha:true},{selected:[],notice:{present:true}},{selected:[],completed:true}]){
    const f=fixture(t,{invoke:async fn=>fn.name==='bookingIdentity'?expected:scene});
    const output=await startLiveBookingTest(f.args);
    assert.equal(output.result.phase,'stopped');assert.deepEqual(f.calls,[]);
  }
  const f=fixture(t);f.target.url+='?step=price';
  assert.equal((await startLiveBookingTest(f.args)).result.error,'LIVE_TEST_SEAT_PAGE_REQUIRED');assert.deepEqual(f.calls,[]);
});
test('a disconnected or older extension and another active run cannot book',async t=>{
  for(const options of [{connection:{connected:false}},{connection:{extensionVersion:'0.9.27'}},{active:true}]){
    const f=fixture(t,options);if(options.active)f.runs.current={id:99};
    const output=await startLiveBookingTest(f.args);
    assert.equal(output.result.phase,'stopped');assert.deepEqual(f.calls,[]);
  }
});
test('uncertain server outcome never retries or reports payment success',async t=>{
  const f=fixture(t,{runError:'HTTP_OUTCOME_UNKNOWN'}),output=await startLiveBookingTest(f.args);
  assert.equal(output.result.error,'HTTP_OUTCOME_UNKNOWN');assert.equal(output.result.completed,false);
  assert.equal(f.calls.filter(c=>c.action==='start').length,1);
  await assert.rejects(startLiveBookingTest(f.args),/ALREADY_ATTEMPTED/);
});
test('search timeout stops its owned production run without a second start',async t=>{
  const f=fixture(t,{neverComplete:true,config:{maxRunMs:1000}}),output=await startLiveBookingTest(f.args);
  assert.equal(output.result.error,'LIVE_TEST_TIMEOUT');
  assert.deepEqual(f.calls.map(c=>c.action),['target','start','stop']);assert.equal(f.runs.current,null);
});
test('a claimed success on another route is rejected and preorder is distinguished',async t=>{
  const f=fixture(t,{finalUrl:'https://tickets.interpark.com/onestop/seat?step=price'});
  assert.equal((await startLiveBookingTest(f.args)).result.error,'LIVE_TEST_PAYMENT_NOT_CONFIRMED');
  const p=fixture(t,{finalUrl:'https://tickets.interpark.com/onestop/preorder'});
  assert.equal((await startLiveBookingTest(p.args)).result.phase,'preorder-confirmed');
});
test('configuration outside the specified local workspace is rejected',async t=>{
  const f=fixture(t),allowed=path.join(f.root,'allowed');fs.mkdirSync(allowed);
  await assert.rejects(startLiveBookingTest({...f.args,configRoot:allowed}),/CONFIG_PATH_INVALID/);assert.deepEqual(f.calls,[]);
});
test('unsupported and credential-bearing URLs are excluded from inspection',async()=>{
  assert.equal(routeOf('https://user:password@tickets.interpark.com/onestop/seat'),null);
  assert.equal(routeOf('https://example.com/?cookie=secret'),null);
  const snapshot=await inspectTargets({targets:new Map(),bridge:{getState:()=>({connected:false,pairCode:'secret',token:'secret'})}});
  assert.equal(JSON.stringify(snapshot).includes('secret'),false);
});
