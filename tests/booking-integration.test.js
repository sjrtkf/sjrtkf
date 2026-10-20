'use strict';
// The production main loop, ChromeTarget dispatch, DOM readers, metadata join,
// ranking, HTTP state machine and navigation all run here. Only the browser,
// filesystem and remote site's responses are fixtures. No production action
// is replaced with a successful result.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {functionActions}=require('../src/chrome-target');
const {readBookingContext}=require('../src/booking-context');
const {planStandardPrices}=require('../src/http-booking');
const {resolveGradeNames}=require('../src/grade-names');
const {parseSeatLabels}=require('../src/metadata');
const {invokeSiteFunction,CODE_ACTIONS}=require('../src/site-code');

const ORIGIN='https://tickets.interpark.com',SEAT_URL=ORIGIN+'/onestop/seat';
const identity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
const normalPrice={seatGrade:'1',pgCode:'PG002',priceGrade:'A',priceGradeName:'예매가',discountName:'성인',salesPrice:'10000',discountSalesPrice:'10000',priceMaxCount:4,discountSeq:'0'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

// Small DOM environment for the Node runner. It interprets the real selectors;
// it does not precompute scene, availability or candidate results.
function element(tag,attrs={},text='',children=[]){
  const node={tagName:tag.toUpperCase(),nodeType:1,attrs:{...attrs},children,textContent:text,parentElement:null,isConnected:true,disabled:false,
    get id(){return this.attrs.id||'';},getAttribute(name){return this.attrs[name]??null;},setAttribute(name,value){this.attrs[name]=String(value);},
    getBoundingClientRect(){return {left:0,top:0,width:20,height:20};},
    matches(selector){return selector.split(',').some(part=>{
      let rest=part.trim();const tagMatch=rest.match(/^[\w-]+/);if(tagMatch&&tagMatch[0].toUpperCase()!==this.tagName)return false;
      rest=rest.replace(/^[\w-]+/,'');
      const attrs=[...rest.matchAll(/\[([\w-]+)(\*=|=)?(?:"([^"]*)")?\]/g)];
      for(const [,name,op,value] of attrs){const own=this.getAttribute(name);if(own===null||op==='='&&own!==value||op==='*='&&!own.includes(value))return false;}
      rest=rest.replace(/\[[^\]]*\]/g,'');
      const idMatch=rest.match(/#([\w:-]+)/);if(idMatch&&idMatch[1]!==this.id)return false;
      return [...rest.matchAll(/\.([\w-]+)/g)].every(m=>(this.attrs.class||'').split(/\s+/).includes(m[1]));
    });},
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;},contains(other){return this===other||this.children.some(child=>child.contains(other));},
    click(){throw Error('DOM click forbidden');},scrollIntoView(){},focus(){},
  };
  node.classList={contains:name=>(node.attrs.class||'').split(/\s+/).includes(name)};
  for(const child of children)child.parentElement=node;
  if(children.length)node.textContent+=children.map(child=>child.textContent).join('');
  return node;
}
function actionSource(){
  const actions=[...functionActions].map(([fn,name])=>JSON.stringify(name)+':'+fn.toString()).join(',');
  return `const readBookingContext=${readBookingContext.toString()};const parseSeatLabels=${parseSeatLabels.toString()};const planStandardPrices=${planStandardPrices.toString()};const resolveGradeNames=${resolveGradeNames.toString()};const siteInvoke=${invokeSiteFunction.toString()};globalThis.fixtureActions={${actions}};`;
}

async function bookingFixture(options={}){
  const contextData={sessionId:'fixture-session',channelType:'NOL',bizCode:'WEBBR',goods:{...identity,goodsName:'격리 통합 검증',reserved:true,reservedSeat:true,isInterlocking:false,kindOfGoods:'01007',ticketMaxCount:4},playSeq:{playSeq:'001'}};
  const maps=(options.maps||[{name:'중앙석',code:'1',block:'101',count:4}]).map((map,index)=>({...map,blockKey:'001:'+map.block,records:Array.from({length:map.count},(_,n)=>({seatInfoId:identity.goodsCode+':'+identity.placeCode+':001:'+(index*100+n),seatGrade:map.code,seatGradeName:map.name,rowIdx:0,colIdx:n,seatNo:String(n+1),rowNo:'1열',isExposable:true,seatGroupId:null}))}));
  const records=maps.flatMap(map=>map.records);
  if(options.resumePrice)contextData.seats=maps.flatMap(map=>map.records.map(record=>({...record,blockKey:map.blockKey}))).slice(0,options.preferences?.quantity||2);
  if(options.existingPrices)contextData.prices=structuredClone(options.existingPrices);
  // The response groups by grade, even when several map blocks share it. The
  // native request still carries one grade per seat (e.g. "1,1").
  const priceMaps=[...new Map(maps.map(map=>[map.code,map])).values()];
  const priceGroups=priceMaps.map(map=>({seatGrade:map.code,ticketMaxCount:4,priceList:(map.priceList||options.priceList||[{}]).map(price=>({...normalPrice,seatGrade:map.code,...options.price,...price}))}));
  const calls=[],actions=[],commands=[],begins=[],routes=[],logs=[],storage=new Map(),cache=new Map();
  let api,page,stopPromise,routePending=null,remainingProgressReads=options.delayedProgressReads||0;
  const tab={id:1,title:'Isolated booking integration',url:SEAT_URL+(options.resumePrice?'?step=price':''),documentId:'integration-document'};
  const state={phase:options.resumePrice?'price':options.maps?'grades':'map',mapIndex:0,records,context:contextData};
  const f={calls,actions,commands,begins,routes,logs,records,maps,tab,state,get api(){return api;},get stopPromise(){return stopPromise;}};
  const render=()=>{
    const script=element('script',{id:'__NEXT_DATA__'},JSON.stringify({props:{pageProps:{initData:contextData}}}));
    const activeMap=maps[state.mapIndex];
    let children;
    if(state.phase==='payment')children=[element('h1',{},'결제')];
    else if(state.phase==='price')children=priceMaps.map(map=>{
      const selected=contextData.seats.filter(seat=>seat.seatGrade===map.code);if(!selected.length)return null;
      return element('div',{class:'PriceGroup_group__fixture'},'',[
        element('h3',{class:'PriceGroup_title__fixture'},map.name),element('span',{class:'PriceGroup_countMax__fixture'},'/ '+selected.length),
        element('p',{class:'PriceGroup_seatInfo__fixture'},map.block+'블럭 1열 1번'),
        element('li',{class:'PriceItem_typeItem__fixture'},'',[element('span',{class:'PriceItem_name__fixture'},'일반'),element('input',{role:'spinbutton',value:'0'})]),
      ]);
    }).filter(Boolean);
    else if(state.phase==='grades')children=maps.map((map,index)=>{
      const button=element('button',{class:'SportsSeatGradeList_contentItem__fixture'},'',[element('span',{class:'SportsSeatGradeList_contentGradeName__fixture'},map.name),element('span',{class:'SportsSeatGradeList_contentRemainCount__fixture'},String(map.count))]);
      button.__reactProps$fixture={onClick(){state.phase='map';state.mapIndex=index;page.document=render();}};return button;
    });
    else{
      children=[element('svg',{},'',[element('g',{id:'seat_block_'+activeMap.blockKey},'',activeMap.records.map((r,i)=>element('circle',{id:'seat_block_'+r.seatInfoId,class:'js-seat',cx:String(20+i*20),cy:'20',fill:'#f00'})))])];
      if(options.maps){const back=element('button',{},'좌석도 전체보기');back.__reactProps$fixture={onClick(){state.phase='grades';page.document=render();}};children.push(back);}
    }
    const body=element('body',{},'',[script,...children]);
    return {body,querySelectorAll:selector=>body.querySelectorAll(selector),querySelector:selector=>body.querySelector(selector),getElementById:id=>body.querySelectorAll('[id]').find(e=>e.id===id)||null};
  };
  const storageContext=()=>JSON.parse(storage.get('interpark/context'));
  const request=async(url,opts={})=>{
    const parsed=new URL(url,ORIGIN);assert.equal(parsed.origin,ORIGIN,'No external origin is allowed');
    const body=opts.body?JSON.parse(opts.body):null,call={path:parsed.pathname,blockKeys:parsed.searchParams.getAll('blockKeys'),seatGrade:parsed.searchParams.get('seatGrade'),body,method:opts.method||'GET'};calls.push(call);
    let data;
    if(parsed.pathname==='/onestop/api/seatMeta')data=parsed.searchParams.getAll('blockKeys').map(key=>{const map=maps.find(m=>m.blockKey===key);assert.ok(map);return {blockKey:key,seats:map.records};});
    else if(parsed.pathname==='/onestop/api/seatStatus')data={data:parsed.searchParams.getAll('blockKeys').map(key=>'f'.repeat(Math.ceil(maps.find(m=>m.blockKey===key).records.length/4)))};
    else if(parsed.pathname==='/onestop/api/prices/'+identity.goodsCode)data={prices:priceGroups};
    else if(body?.operationName==='HelperSeatGradeNames')data={data:{getSeatGradePrices:maps.map(map=>({seatGrade:map.code,seatGradeName:map.name}))}};
    else if(body?.operationName==='PreselectSeat')data={data:{preselectSeat:true}};
    else if(body?.operationName==='DeselectSeat')data={data:{deselectSeat:true}};
    else if(body?.operationName==='ValidatePricingSelection')data={data:{validatePricingSelection:true}};
    else if(parsed.pathname==='/onestop/api/seats/select')data={unselectableSeatInfoIds:[]};
    else throw Error('Unexpected fixture HTTP request: '+parsed.pathname+' '+body?.operationName);
    if(options.reply)data=await options.reply(call,data,f);
    return {ok:true,status:200,text:async()=>JSON.stringify(data)};
  };
  storage.set('interpark/context',JSON.stringify(contextData));cache.set('/getContextData/undefined',{data:contextData});
  const pageWindow={webpackChunk_N_E:[]};
  pageWindow.webpackChunk_N_E.push=entry=>entry[2](id=>id===74133?{F:{getContextData:storageContext}}:{d:{cache,mutate:async(key,data)=>{
    cache.set(key,{data});for(const circle of page.document.querySelectorAll('circle.js-seat[id]'))circle.setAttribute('class','js-seat'+(data.seats?.some(seat=>'seat_block_'+seat.seatInfoId===circle.id)?' SeatMap_selected__fixture':''));
  }}});
  const applyRoute=route=>{state.phase='payment';page.location=new URL(ORIGIN+'/onestop'+route);page.document=render();tab.url=page.location.href;};
  pageWindow.next={router:{push:async route=>{
    assert.equal(JSON.stringify(cache.get('/getContextData/undefined').data),JSON.stringify(storageContext()),'navigation must synchronize the native cache');
    routes.push(route);if(remainingProgressReads)routePending=route;else applyRoute(route);return true;
  }}};
  page={window:pageWindow,document:render(),location:new URL(tab.url),sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    URL,URLSearchParams,Date,AbortSignal,crypto:require('node:crypto').webcrypto,getComputedStyle:()=>({display:'block',visibility:'visible'}),fetch:request,setTimeout,clearTimeout,console};
  vm.createContext(page);vm.runInContext(actionSource(),page);
  f.pageContext=async()=>storageContext();f.receipt=async()=>JSON.parse(storage.get('baseball/http-booking')||'null');
  f.changeRound=async()=>{const c=storageContext();c.playSeq.playSeq='002';storage.set('interpark/context',JSON.stringify(c));};
  f.invokePage=(action,arg)=>page.fixtureActions[action](arg);
  f.close=async()=>{};

  // The browser mode uses the same main bridge and scenarios, with an actual
  // hidden Chromium DOM and session storage. HTTPS is fully intercepted.
  if(options.electron){
    const {BrowserWindow,session}=options.electron;
    const partition=session.fromPartition('booking-integration-'+require('node:crypto').randomUUID());
    const html='<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{initData:contextData}}})+'</script><main></main></body></html>';
    await partition.protocol.handle('https',async req=>{
      const u=new URL(req.url);assert.equal(u.origin,ORIGIN);
      if(u.pathname==='/onestop/seat')return new Response(html,{headers:{'Content-Type':'text/html'}});
      if(u.pathname==='/favicon.ico')return new Response('',{status:204});
      const response=await request(req.url,{method:req.method,body:req.method==='POST'?await req.text():undefined});
      return new Response(await response.text(),{headers:{'Content-Type':'application/json'}});
    });
    await partition.protocol.handle('http',()=>{throw Error('External HTTP forbidden');});
    const win=new BrowserWindow({show:false,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),wc=win.webContents;
    await wc.loadURL(tab.url);
    await wc.executeJavaScript(`sessionStorage.setItem('interpark/context',${JSON.stringify(JSON.stringify(contextData))});
      window.integrationState={routes:[],progressReads:${remainingProgressReads},pending:null};
      const fixtureMaps=${JSON.stringify(maps)};
      function showGrades(){document.querySelector('main').innerHTML=fixtureMaps.map((map,i)=>'<button data-map="'+i+'" class="SportsSeatGradeList_contentItem__fixture"><span class="SportsSeatGradeList_contentGradeName__fixture">'+map.name+'</span><span class="SportsSeatGradeList_contentRemainCount__fixture">'+map.count+'</span></button>').join('');for(const button of document.querySelectorAll('button'))button.__reactProps$fixture={onClick(){showMap(Number(button.dataset.map));}};}
      function showMap(index){const map=fixtureMaps[index];document.querySelector('main').innerHTML='<svg width="200" height="100"><g id="seat_block_'+map.blockKey+'">'+map.records.map((r,i)=>'<circle class="js-seat" id="seat_block_'+r.seatInfoId+'" cx="'+(20+i*20)+'" cy="20" r="8" fill="#f00"></circle>').join('')+'</g></svg>';if(${options.maps?'true':'false'}){const button=document.createElement('button');button.textContent='좌석도 전체보기';button.__reactProps$fixture={onClick:showGrades};document.querySelector('main').append(button);}}
      function showPrices(){const context=JSON.parse(sessionStorage.getItem('interpark/context'));document.querySelector('main').innerHTML=${JSON.stringify(priceMaps)}.map(map=>{const seats=context.seats.filter(s=>s.seatGrade===map.code);return seats.length?'<div class="PriceGroup_group__fixture"><h3 class="PriceGroup_title__fixture">'+map.name+'</h3><span class="PriceGroup_countMax__fixture">/ '+seats.length+'</span><p class="PriceGroup_seatInfo__fixture">'+map.block+'블럭 1열 1번</p><li class="PriceItem_typeItem__fixture"><span class="PriceItem_name__fixture">일반</span><input role="spinbutton" value="0"></li></div>':'';}).join('');}
      ${options.resumePrice?'showPrices()':options.maps?'showGrades()':'showMap(0)'};
      const cache=new Map([['/getContextData/undefined',{data:JSON.parse(sessionStorage.getItem('interpark/context'))}]]);
      window.webpackChunk_N_E=[];window.webpackChunk_N_E.push=entry=>entry[2](id=>id===74133?{F:{getContextData:()=>JSON.parse(sessionStorage.getItem('interpark/context'))}}:{d:{cache,mutate:async(key,data)=>{cache.set(key,{data});for(const circle of document.querySelectorAll('circle.js-seat[id]'))circle.setAttribute('class','js-seat'+(data.seats?.some(seat=>'seat_block_'+seat.seatInfoId===circle.id)?' SeatMap_selected__fixture':''));}}});
      function applyRoute(route){history.pushState({},'','/onestop'+route);document.body.innerHTML='<h1>결제</h1>';}
      window.next={router:{push:async route=>{if(JSON.stringify(cache.get('/getContextData/undefined').data)!==sessionStorage.getItem('interpark/context'))throw Error('stale cache');integrationState.routes.push(route);if(integrationState.progressReads)integrationState.pending=route;else applyRoute(route);return true;}}};
      HTMLElement.prototype.click=function(){throw Error('DOM click forbidden');};
      ${actionSource()};void 0;`);
    await wc.executeJavaScriptInIsolatedWorld(999,[{code:actionSource()+"\nHTMLElement.prototype.click=function(){throw Error('Isolated DOM click forbidden');};void 0;"}]);
    f.invokePage=async(action,arg)=>{
      if(action==='pricePage.bookingProgress')await wc.executeJavaScript(`if(integrationState.pending&&--integrationState.progressReads<=0){applyRoute(integrationState.pending);integrationState.pending=null;}void 0;`);
      const code=`fixtureActions[${JSON.stringify(action)}](${arg===undefined?'undefined':JSON.stringify(arg)})`;
      // Match extension/background.js: native handlers/navigation run in MAIN,
      // HTTP and observation run in the content world, sharing only the DOM and
      // sessionStorage. Stop reaches both worlds.
      if(action==='page.stopWatchers'){await wc.executeJavaScript(code);return wc.executeJavaScriptInIsolatedWorld(999,[{code}]);}
      return action==='httpBooking.httpBookingNavigate'||CODE_ACTIONS.has(action)?wc.executeJavaScript(code):wc.executeJavaScriptInIsolatedWorld(999,[{code}]);
    };
    f.pageContext=()=>wc.executeJavaScript('JSON.parse(sessionStorage.getItem("interpark/context"))');
    f.receipt=()=>wc.executeJavaScript('JSON.parse(sessionStorage.getItem("baseball/http-booking")||"null")');
    f.changeRound=()=>wc.executeJavaScript('const c=JSON.parse(sessionStorage.getItem("interpark/context"));c.playSeq.playSeq="002";sessionStorage.setItem("interpark/context",JSON.stringify(c));void 0;');
    f.browserState=()=>wc.executeJavaScript('({routes:integrationState.routes,url:location.href})');
    f.close=async()=>{assert.equal(win.isVisible(),false);win.destroy();partition.protocol.unhandle('https');partition.protocol.unhandle('http');};
  }
  const network={healthy:true,sequence:0,pending:[],results:[]};
  const bridge={getState:()=>({connected:true}),request:async command=>{
    const {action,arg}=command;actions.push(action);commands.push(structuredClone(command));
    assert.ok(actions.length<500,'Integration must not spin without completing');
    if(action==='network.attach'||action==='network.snapshot')return structuredClone(network);
    assert.equal(command.tabId,tab.id);if(command.documentId)assert.equal(command.documentId,tab.documentId);
    if(action==='pricePage.bookingProgress'&&routePending&&--remainingProgressReads<=0){applyRoute(routePending);routePending=null;}
    if(action==='httpBooking.httpBookingAction'&&arg.action==='begin')begins.push(structuredClone(arg));
    const result=await f.invokePage(action,arg);
    if(options.afterAction)await options.afterAction(command,result,f);
    if(options.lostNavigationAck&&action==='httpBooking.httpBookingNavigate'&&!arg.checkOnly&&!arg.syncOnly)throw Error('Fixture transport acknowledgement lost');
    return result;
  }};
  const filename=path.resolve(__dirname,'../src/chrome-main.js'),load=createRequire(filename);
  const source=fs.readFileSync(filename,'utf8').split('app.whenReady().then')[0];
  const noFile=()=>{const error=Error('No persisted fixture settings');error.code='ENOENT';throw error;};
  const io={...fs,statSync:noFile,readFileSync:noFile,mkdirSync(){},readdirSync:()=>[],appendFileSync(_file,text){const events=text.trim().split('\n').filter(Boolean).map(JSON.parse);logs.push(...events);for(const event of events)options.afterLog?.(event,f);},writeFileSync(){}};
  const preferences={quantity:2,areas:['중앙석'],blocks:['101'],requireTogether:true,excludeObstructed:true,autoComplete:true,autoCaptcha:false,manualCaptchaAssist:false,...options.preferences};
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}},net:{fetch(){throw Error('Live network forbidden');}}};
  const main={require:name=>name==='electron'?electron:name==='node:fs'?io:name==='./browser-bridge'?{BrowserBridge:class{}}:load(name),__dirname:path.dirname(filename),process:{argv:[],pid:0},URL,URLSearchParams,Date,console,setTimeout,clearTimeout,fixtureBridge:bridge,fixturePreferences:preferences};
  vm.createContext(main);vm.runInContext(source+`
    bridge=fixtureBridge;globalThis.api={autoLoop,launch,stopRun,trackTabs,onBrowserEvent,current,ensureNetwork,runs,command,
      begin:()=>beginRun(current(),fixturePreferences,'auto')};`,main);
  api=main.api;api.trackTabs([{...tab}]);
  f.start=async()=>{const run=api.begin();await api.ensureNetwork(api.current());const task=api.launch(run,()=>api.autoLoop(run));task.catch(()=>{});return {run,task};};
  f.stop=()=>{stopPromise=api.stopRun('통합 검증 중지');return stopPromise;};
  f.mutations=()=>calls.filter(c=>c.body?.query?.startsWith('mutation'));
  f.destination=async()=>options.electron?(await f.browserState()).routes:routes;
  return f;
}

const scenarios=[];
const scenario=(name,run)=>scenarios.push({name,run});

scenario('real main joins missing metadata, ranks adjacent seats and completes the actual HTTP/navigation state machines',async engine=>{
  const f=await bookingFixture(engine);try{
    const {run,task}=await f.start(),result=await task;
    assert.equal(result.completed,true);assert.equal(result.bookingAdvanced,true);assert.equal(run.retry.attempted,1);
    assert.equal(f.begins.length,1);assert.deepEqual(f.begins[0].seats.map(s=>s.id),f.records.slice(0,2).map(r=>'seat_block_'+r.seatInfoId));
    assert.ok(f.begins[0].seats.every(s=>s.row===1&&s.grade==='중앙석'&&s.block==='101'));
    assert.ok(f.begins[0].seats[0].neighbors.includes(f.begins[0].seats[1].id));
    assert.ok(f.actions.includes('seatDetails.readDetails'));assert.ok(f.actions.includes('live.liveRead'));assert.ok(f.actions.includes('flow.scene'));
    assert.deepEqual(f.mutations().map(c=>c.body.operationName),['PreselectSeat','PreselectSeat']);
    assert.equal(f.calls.filter(c=>c.path==='/onestop/api/seats/select').length,1);
    assert.equal(f.calls.filter(c=>c.body?.operationName==='ValidatePricingSelection').length,1);
    assert.equal((await f.pageContext()).prices[0].selectedSeatCount,2);assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

for(const completedReads of [0,1,2])scenario(`stopping after ${completedReads} HTTP reads allows a fresh run without any earlier hold`,async engine=>{
  let stopped=false;const f=await bookingFixture({...engine,afterAction(command,result,fixture){
    if(!stopped&&command.action==='httpBooking.httpBookingAction'&&result.requestCount===completedReads){stopped=true;void fixture.stop();}
  }});try{
    const first=await f.start();await assert.rejects(first.task,/중지/);await f.stopPromise;
    assert.equal(f.mutations().length,0);assert.equal((await f.receipt()).held.length,0);
    const second=await f.start();assert.equal((await second.task).completed,true);
    assert.equal(f.begins.length,2);assert.equal(f.mutations().length,2);assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('lost navigation acknowledgement observes a delayed destination without replaying navigation or seat requests',async engine=>{
  const f=await bookingFixture({...engine,delayedProgressReads:3,lostNavigationAck:true});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.actions.filter(a=>a==='pricePage.bookingProgress').length,3);
    assert.equal(f.actions.filter(a=>a==='httpBooking.httpBookingNavigate').length,2); // capability + one dispatch
    assert.equal(f.mutations().length,2);assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('a seat conflict releases the acknowledged hold before the main loop tries its next ranked candidate',async engine=>{
  let rejected=false;const f=await bookingFixture({...engine,reply(call,data){
    if(!rejected&&call.body?.operationName==='PreselectSeat'&&call.body.variables.command.seatInfoId.endsWith(':1')){rejected=true;return {errors:[{extensions:{backendErrorCode:'P41150'}}]};}return data;
  }});try{
    const {run,task}=await f.start();assert.equal((await task).completed,true);assert.equal(run.retry.attempted,2);
    assert.equal(f.begins.length,2);assert.deepEqual(f.mutations().map(c=>c.body.operationName),['PreselectSeat','PreselectSeat','DeselectSeat','PreselectSeat','PreselectSeat']);
    assert.deepEqual((await f.pageContext()).seats.map(s=>s.seatInfoId),f.begins[1].seats.map(s=>s.id.slice(11)));
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('a price list containing only membership pricing waits for seat changes without holding or retrying the same grade',async engine=>{
  let waits=0;const f=await bookingFixture({...engine,price:{isMembership:true},afterLog(event,fixture){
    if(event.event==='stage'&&event.message.includes('좌석 데이터 변경 대기')&&++waits===1)void fixture.stop();
  }});try{
    const {run,task}=await f.start();await assert.rejects(task,/중지/);await f.stopPromise;
    assert.equal(waits,1);assert.ok(run.priceExcludedGrades.has('1'));assert.equal(f.begins.length,1);
    assert.equal(f.mutations().length,0);assert.deepEqual(await f.destination(),[]);assert.equal((await f.pageContext()).seats,undefined);
    const evidence=f.logs.filter(event=>event.event==='price-selection');assert.equal(evidence.length,1);
    const group=evidence[0].priceAssessment.groups[0];assert.equal(group.selectedIndex,null);assert.equal(group.seatCount,2);
    assert.equal(group.options[0].eligible,false);assert.ok(group.options[0].reasons.includes('PRICE_REQUIRES_CERTIFICATION'));
  }finally{await f.close();}
});

scenario('a hold acknowledgement arriving after stop is recorded once and cannot confirm, navigate or be resent',async engine=>{
  const reached=deferred(),release=deferred();let intercepted=false;
  const f=await bookingFixture({...engine,reply:async(call,data)=>{
    if(!intercepted&&call.body?.operationName==='PreselectSeat'){intercepted=true;reached.resolve();await release.promise;}return data;
  }});try{
    const {task}=await f.start();await Promise.race([reached.promise,task.then(()=>{throw Error('Flow completed before the pending hold');})]);const stopped=f.stop();release.resolve();
    await assert.rejects(task,/중지/);await stopped;
    assert.equal(f.mutations().length,1);assert.equal((await f.pageContext()).seats.length,1);assert.equal((await f.receipt()).held.length,1);
    assert.equal(f.calls.filter(c=>c.path==='/onestop/api/seats/select').length,0);assert.deepEqual(await f.destination(),[]);
    const restart=await f.start();await assert.rejects(restart.task,/HTTP_PREVIOUS_RESULT_PENDING/);assert.equal(f.mutations().length,1);
  }finally{release.resolve();await f.close();}
});

scenario('a round change during metadata hydration prevents all selection and navigation',async engine=>{
  let changed=false;const f=await bookingFixture({...engine,reply:async(call,data,fixture)=>{
    if(!changed&&call.path==='/onestop/api/seatMeta'){changed=true;await fixture.changeRound();}return data;
  }});try{
    const {task}=await f.start();await assert.rejects(task,/CONTEXT_MISMATCH|회차|세션|화면/);
    assert.equal(f.begins.length,0);assert.equal(f.mutations().length,0);assert.deepEqual(await f.destination(),[]);
  }finally{await f.close();}
});

scenario('split seating preserves a first-priority seat while filling from the next map instead of replacing it with a lower-priority pair',async engine=>{
  const f=await bookingFixture({...engine,maps:[{name:'1순위 중앙석',code:'1',block:'101',count:1},{name:'2순위 내야석',code:'2',block:'102',count:2}],preferences:{quantity:2,areas:[],blocks:[],tiers:[{name:'우선',areas:['1순위 중앙석']},{name:'다음',areas:['2순위 내야석']}],fallbackAnywhere:false,requireTogether:false}});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.begins.length,1);assert.deepEqual(f.begins[0].seats.map(s=>s.grade).sort(),['1순위 중앙석','2순위 내야석']);
    assert.equal(new Set(f.begins[0].seats.map(s=>s.blockKey)).size,2);
    assert.equal(f.calls.filter(c=>c.path==='/onestop/api/seatStatus').length,1);
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('three map tiers accumulate a complete split group while HTTP revalidates every contributing block',async engine=>{
  const maps=[{name:'A석',code:'1',block:'101',count:1},{name:'B석',code:'2',block:'102',count:1},{name:'C석',code:'3',block:'103',count:2}];
  const f=await bookingFixture({...engine,maps,preferences:{quantity:4,areas:[],blocks:[],tiers:maps.map(map=>({areas:[map.name]})),fallbackAnywhere:false,requireTogether:false}});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.begins.length,1);assert.deepEqual(f.begins[0].seats.map(s=>s.grade).sort(),['A석','B석','C석','C석']);
    assert.equal(f.mutations().length,4);assert.equal((await f.pageContext()).prices.reduce((sum,p)=>sum+p.selectedSeatCount,0),4);
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('fresh metadata moving a previous-map priority seat from row 1 to 99 refreshes that off-map block and selects only the eligible replacement',async engine=>{
  let reads=0;const f=await bookingFixture({...engine,maps:[{name:'우선석',code:'1',block:'101',count:1},{name:'다음석',code:'2',block:'102',count:2}],
    preferences:{quantity:2,areas:[],blocks:[],maxRow:1,tiers:[{areas:['우선석'],maxRow:1},{areas:['다음석'],maxRow:1}],fallbackAnywhere:false,requireTogether:false},
    reply(call,data,fixture){if(call.path==='/onestop/api/seatMeta'&&call.blockKeys.includes('001:101')&&++reads>=2)fixture.maps[0].records[0].rowNo='99열';return data;}
  });try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.begins.length,2);assert.ok(f.begins[0].seats.some(s=>s.block==='101'));
    assert.ok(f.begins[1].seats.every(s=>s.block==='102'&&s.row===1));
    const holds=f.mutations().filter(c=>c.body.operationName==='PreselectSeat');
    assert.equal(holds.length,2);assert.ok(holds.every(c=>!c.body.variables.command.seatInfoId.endsWith(':0')));
    assert.ok(f.commands.filter(c=>c.action==='seatDetails.readDetails'&&c.arg.blockKeys.includes('001:101')).length>=2,'the old map must actually be refreshed after HTTP detects its changed label');
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('an unavailable status bit excludes its seat before trying the next real ranked pair',async engine=>{
  const f=await bookingFixture({...engine,reply(call,data){return call.path==='/onestop/api/seatStatus'?{data:['7']}:data;}});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.begins.length,2);assert.ok(f.begins[0].seats.some(s=>s.id.endsWith(':0')));
    assert.ok(f.begins[1].seats.every(s=>!s.id.endsWith(':0')));assert.equal(f.mutations().length,2);
    assert.ok(f.mutations().every(c=>!c.body.variables.command.seatInfoId.endsWith(':0')));assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('a stale first-priority seat on the previous map is excluded by server status while a lower map can supply the full replacement group',async engine=>{
  const f=await bookingFixture({...engine,maps:[{name:'우선석',code:'1',block:'101',count:1},{name:'다음석',code:'2',block:'102',count:2}],
    preferences:{quantity:2,areas:[],blocks:[],tiers:[{areas:['우선석']},{areas:['다음석']}],fallbackAnywhere:false,requireTogether:false},
    reply(call,data){return call.path==='/onestop/api/seatStatus'?{data:call.blockKeys.map(key=>key==='001:101'?'0':'f')}:data;}
  });try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.begins.length,2);assert.ok(f.begins[0].seats.some(s=>s.block==='101'));assert.ok(f.begins[1].seats.every(s=>s.block==='102'));
    assert.equal(f.mutations().length,2);assert.ok(f.mutations().every(c=>c.body.variables.command.blockKey==='001:102'));
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('the first eligible ordinary price is used without requiring an adult label or preferring a later adult row',async engine=>{
  const f=await bookingFixture({...engine,priceList:[{priceGrade:'BASIC',priceGradeName:'기본요금',discountName:''},{priceGrade:'ADULT',priceGradeName:'예매가',discountName:'성인'}]});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    const selected=(await f.pageContext()).prices;
    assert.equal(selected.length,1);assert.equal(selected[0].pgPrice.priceGrade,'BASIC');assert.equal(selected[0].selectedSeatCount,2);
    assert.deepEqual(f.calls.find(c=>c.body?.operationName==='ValidatePricingSelection').body.variables.selectedPrices,[{seatGrade:'1',priceGrade:'BASIC',selectCnt:2}]);
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('membership, discount, insufficient quantity and age-qualified rows are skipped before the first eligible ordinary row',async engine=>{
  const f=await bookingFixture({...engine,priceList:[
    {priceGrade:'MEMBER',priceGradeName:'회원',discountName:'',isMembership:true},
    {priceGrade:'DISCOUNT',priceGradeName:'할인가',discountName:'',discountSalesPrice:'9000'},
    {priceGrade:'ONE',priceGradeName:'기본요금',discountName:'',priceMaxCount:1},
    {priceGrade:'YOUTH',priceGradeName:'청소년',discountName:''},
    {priceGrade:'GENERAL',priceGradeName:'일반',discountName:''},
  ]});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal((await f.pageContext()).prices[0].pgPrice.priceGrade,'GENERAL');assert.equal(f.mutations().length,2);
    const evidence=f.logs.filter(event=>event.event==='price-selection');assert.equal(evidence.length,1);
    const group=evidence[0].priceAssessment.groups[0];assert.equal(group.selectedIndex,4);assert.equal(group.options[4].priceGrade,'GENERAL');
    assert.equal(group.options[4].eligible,true);assert.deepEqual(group.options[4].reasons,[]);
    for(const [index,reason] of ['PRICE_REQUIRES_CERTIFICATION','PRICE_DISCOUNT_UNSUPPORTED','PRICE_QUANTITY_LIMIT','PRICE_REQUIRES_QUALIFICATION'].entries())assert.ok(group.options[index].reasons.includes(reason));
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('two map blocks sharing a grade request duplicate grade codes but receive one price group with the full quantity',async engine=>{
  const f=await bookingFixture({...engine,maps:[{name:'A구역',code:'1',block:'101',count:1},{name:'B구역',code:'1',block:'102',count:1}],
    preferences:{quantity:2,areas:[],blocks:[],tiers:[{areas:['A구역']},{areas:['B구역']}],fallbackAnywhere:false,requireTogether:false},price:{priceGradeName:'일반',discountName:''}});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.calls.find(c=>c.path.includes('/api/prices/')).seatGrade,'1,1');
    const selected=(await f.pageContext()).prices;assert.equal(selected.length,1);assert.equal(selected[0].selectedSeatCount,2);
    assert.equal(f.begins[0].seats.length,2);assert.equal(new Set(f.begins[0].seats.map(s=>s.blockKey)).size,2);
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('ordinary prices from two grades keep independent price records and the exact per-grade quantities',async engine=>{
  const f=await bookingFixture({...engine,maps:[
    {name:'A석',code:'1',block:'101',count:2,priceList:[{priceGrade:'ABASE',priceGradeName:'기본요금',discountName:''}]},
    {name:'B석',code:'2',block:'102',count:1,priceList:[{priceGrade:'BBASE',priceGradeName:'일반',discountName:'',salesPrice:'12000',discountSalesPrice:'12000'}]},
  ],preferences:{quantity:3,areas:[],blocks:[],tiers:[{areas:['A석']},{areas:['B석']}],fallbackAnywhere:false,requireTogether:false}});try{
    const {task}=await f.start();assert.equal((await task).completed,true);
    const selected=(await f.pageContext()).prices;
    assert.deepEqual(selected.map(p=>[p.pgPrice.seatGrade,p.pgPrice.priceGrade,p.selectedSeatCount,p.pgPrice.discountSalesPrice]),[['1','ABASE',2,'10000'],['2','BBASE',1,'12000']]);
    assert.deepEqual(f.calls.find(c=>c.body?.operationName==='ValidatePricingSelection').body.variables.selectedPrices,[{seatGrade:'1',priceGrade:'ABASE',selectCnt:2},{seatGrade:'2',priceGrade:'BBASE',selectCnt:1}]);
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('a qualification-only grade is replaced while preserving the higher-priority ordinary seat in a split group',async engine=>{
  const f=await bookingFixture({...engine,maps:[
    {name:'A석',code:'1',block:'101',count:1,priceList:[{priceGradeName:'일반',discountName:''}]},
    {name:'B석',code:'2',block:'102',count:1,priceList:[{priceGradeName:'청소년',discountName:''}]},
    {name:'C석',code:'3',block:'103',count:2,priceList:[{priceGradeName:'일반',discountName:''}]},
  ],preferences:{quantity:2,areas:[],blocks:[],tiers:[{areas:['A석']},{areas:['B석']},{areas:['C석']}],fallbackAnywhere:false,requireTogether:false}});try{
    const {run,task}=await f.start();assert.equal((await task).completed,true);
    assert.ok(run.priceExcludedGrades.has('2'));assert.equal(f.begins.length,2);assert.equal(f.mutations().length,2);
    assert.deepEqual((await f.pageContext()).seats.map(seat=>seat.seatGrade),['1','3']);
    assert.ok(f.mutations().every(call=>!f.maps[1].records.some(seat=>seat.seatInfoId===call.body.variables.command.seatInfoId)));
    assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('an existing price page resumes ordinary pricing and validation without selecting or confirming its seats again',async engine=>{
  const f=await bookingFixture({...engine,resumePrice:true,price:{priceGrade:'REGULAR',priceGradeName:'일반',discountName:''}});try{
    const initial=(await f.pageContext()).seats,{task}=await f.start();assert.equal((await task).completed,true);
    assert.equal(f.begins.length,1);assert.equal(f.begins[0].resumePrice,true);
    assert.deepEqual(f.calls.map(c=>c.body?.operationName||c.path),['/onestop/api/prices/'+identity.goodsCode,'ValidatePricingSelection']);
    assert.equal(f.mutations().length,0);assert.deepEqual((await f.pageContext()).seats,initial);
    assert.equal((await f.pageContext()).prices[0].pgPrice.priceGrade,'REGULAR');assert.deepEqual(await f.destination(),['/payment']);
  }finally{await f.close();}
});

scenario('a seat-only automatic run finishes after the requested holds without applying prices or navigating',async engine=>{
  const f=await bookingFixture({...engine,preferences:{autoComplete:false},price:{priceGrade:'REGULAR',priceGradeName:'일반',discountName:''}});try{
    const {task}=await f.start();const selected=await task;assert.equal(selected.completed,false);assert.equal(selected.selectedIds.length,2);
    assert.equal(f.mutations().length,2);assert.equal(f.calls.filter(c=>c.path.includes('/api/prices/')).length,0);assert.deepEqual(await f.destination(),[]);
    assert.equal(f.begins.length,1);assert.equal(f.calls.filter(c=>c.path==='/onestop/api/seats/select').length,0);
  }finally{await f.close();}
});

scenario('a pre-existing manual price choice is preserved and never replaced by the ordinary-price rule',async engine=>{
  const existing=[{selectedSeatCount:1,pgPrice:{...normalPrice,priceGrade:'MANUAL',priceGradeName:'직접 선택',discountName:''}}];
  const f=await bookingFixture({...engine,resumePrice:true,existingPrices:existing,price:{priceGradeName:'일반',discountName:''}});try{
    const {task}=await f.start();await assert.rejects(task,/HTTP_EXISTING_PRICE_SELECTION/);
    assert.equal(f.calls.length,0);assert.deepEqual((await f.pageContext()).prices,existing);assert.deepEqual(await f.destination(),[]);
  }finally{await f.close();}
});

if(process.versions.electron){
  const electron=require('electron');
  electron.app.setPath('userData',path.resolve(__dirname,'../work/booking-integration-profile'));
  electron.app.on('window-all-closed',()=>{}); // The next scenario owns a new isolated window.
  const watchdog=setTimeout(()=>{console.error('Booking integration browser watchdog expired');electron.app.exit(1);},90000);
  const report={version:require('../package.json').version,engine:'hidden Chromium',windowHidden:true,mainAndIsolatedWorlds:true,liveRequests:0,checks:[],scenarios:[],passed:false};
  const reportPath=path.resolve(__dirname,'../work/booking-integration-v'+report.version+'.json');
  const saveReport=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  electron.app.whenReady().then(async()=>{
    const filter=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7),selected=filter?scenarios.filter(s=>s.name.includes(filter)):scenarios;
    assert.ok(selected.length,'Browser case filter must match a scenario');
    for(const {name,run} of selected){const began=Date.now();try{await run({electron});report.checks.push(name);report.scenarios.push({name,passed:true,durationMs:Date.now()-began});console.log('PASS hidden Chromium: '+name);}catch(error){report.scenarios.push({name,passed:false,durationMs:Date.now()-began,error:error.message});throw error;}finally{saveReport();}}
    report.passed=true;report.scenarioCount=report.scenarios.length;saveReport();
    clearTimeout(watchdog);electron.app.exit(0);
  }).catch(error=>{report.error=error.message;saveReport();console.error(error);clearTimeout(watchdog);electron.app.exit(1);});
}else{
  const {test}=require('node:test');
  for(const {name,run} of scenarios)test(name,{timeout:15000},()=>run({}));
}
