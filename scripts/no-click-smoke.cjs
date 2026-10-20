'use strict';
const {app,BrowserWindow,session}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {CaptchaService}=require('../src/captcha-service');
const {parseSeatLabels}=require('../src/metadata');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const output=path.join(root,'work/no-click-smoke.json');
const report={passed:false,version,startedAt:new Date().toISOString(),liveSite:false,scope:'Isolated local renderer and HTTP fixtures; static source installation is fixture setup, not an extension transport latency test.',commandTimings:[],windowStates:[]};
app.setPath('userData',path.join(root,'work/no-click-smoke-profile-'+process.pid));
let win,finished=false;
function finish(error){
 if(finished)return;finished=true;clearTimeout(watchdog);
 if(error)report.error=error.stack||String(error);
 if(win&&!win.isDestroyed()){report.minimized=win.isMinimized();report.visible=win.isVisible();}
 report.completedAt=new Date().toISOString();fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));win?.destroy();app.exit(report.passed?0:1);
}
const watchdog=setTimeout(()=>finish(Error('No-click smoke timeout')),35000);
app.whenReady().then(async()=>{
 const identity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
 const context={sessionId:'fixture-session',channelType:'NOL',bizCode:'WEBBR',goods:{...identity,goodsName:'격리 테스트',checkCaptcha:true,reserved:true,reservedSeat:true,isInterlocking:false,kindOfGoods:'01007',ticketMaxCount:4},playSeq:{playSeq:'001'}};
 const seats=[0,1].map(n=>({id:'seat_block_26009123:25001730:001:'+n,blockKey:'001:101',gradeCode:'1',grade:'일반석',rowIdx:0,colIdx:n,...parseSeatLabels('1열',String(n+1))}));
 const records=seats.map(v=>({seatInfoId:v.id.slice(11),seatGrade:'1',rowIdx:v.rowIdx,colIdx:v.colIdx,seatNo:String(v.number),rowNo:'1열',isExposable:true}));
 const html=fs.readFileSync(path.join(root,'tests/no-click-fixture.html'),'utf8').replace('__FIXTURE_DATA__',JSON.stringify({context,seats}));
 const requests=[],partition=session.fromPartition('no-click-smoke');let images=0,verifications=0;
 await partition.protocol.handle('https',async request=>{
  const u=new URL(request.url),p=u.pathname;
  assert.ok(['https://nol.yanolja.com','https://tickets.interpark.com','https://ent-waiting-api.interpark.com'].includes(u.origin));
  if(['/ticket/genre/sports/test','/gates/ticket/26009123','/waiting','/onestop/seat'].includes(p))return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  const body=request.method==='POST'?await request.json():null;requests.push({path:p,operation:body?.operationName});let result;
  if(p==='/fixture/preparation')result={ok:true};
  else if(p==='/waiting/api/secure-url')result={redirectUrl:'https://tickets.interpark.com/waiting'};
  else if(p==='/onestop/api/captcha/image')result={sequence:++images};
  else if(p==='/onestop/api/captcha/verify')result={result:++verifications===1?'N':'Y'};
  else if(p==='/onestop/api/seatMeta')result=[{blockKey:'001:101',seats:records}];
  else if(p==='/onestop/api/seatStatus'){
   assert.equal(request.method,'GET');assert.deepEqual(u.searchParams.getAll('blockKeys'),['001:101']);
   for(const [key,value] of Object.entries(identity))assert.equal(u.searchParams.get(key),value);
   result={data:['c']};
  }
  else if(p==='/onestop/api/prices/'+identity.goodsCode)result={prices:[{seatGrade:'1',ticketMaxCount:4,priceList:[{seatGrade:'1',pgCode:'PG002',priceGrade:'A',priceGradeName:'일반가',discountName:'',salesPrice:10000,discountSalesPrice:10000,priceMaxCount:4}]}]};
  else if(p==='/onestop/api/seats/select')result={unselectableSeatInfoIds:[]};
  else if(p==='/onestop/gql'&&body?.operationName==='PreselectSeat')result={data:{preselectSeat:true}};
  else if(p==='/onestop/gql'&&body?.operationName==='ValidatePricingSelection')result={data:{validatePricingSelection:true}};
  else throw Error('Unexpected fixture request: '+p);
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
 });
 win=new BrowserWindow({show:false,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:true}});const wc=win.webContents;
 const verifyWindow=stage=>{const state={stage,minimized:win.isMinimized(),visible:win.isVisible()};report.windowStates.push(state);assert.equal(state.minimized,true,stage+': fixture must stay minimized');assert.equal(state.visible,false,stage+': fixture must stay hidden');};
 const code=fs.readFileSync(path.join(root,'extension/code-actions.js'),'utf8'),actions=fs.readFileSync(path.join(root,'extension/actions.js'),'utf8');
 const call=async(action,arg)=>{
  // Installing the static fixture dispatcher is setup. Issue the same 5-second
  // production lease only after that setup has finished; never renew a command
  // inside the renderer or replay an expired command.
  const preparingAt=Date.now();await wc.executeJavaScript(code+';void 0;');
  const sentAt=Date.now(),meta={connection:'smoke',epoch:0,expiresAt:sentAt+5000};
  const response=await wc.executeJavaScript(`(async()=>{const enteredAt=Date.now();return {enteredAt,result:await BaseballCodeDispatch(${JSON.stringify(action)},${JSON.stringify(arg)??'null'},${JSON.stringify(meta)})};})()`);
  report.commandTimings.push({action,sourceBytes:Buffer.byteLength(code),preparationMs:sentAt-preparingAt,sentAt,enteredAt:response.enteredAt,dispatchDelayMs:response.enteredAt-sentAt,totalMs:Date.now()-sentAt,ok:response.result.ok,error:response.result.code||null});
  if(!response.result.ok)throw Error(response.result.code);return response.result.value;
 };
 const waitFor=async predicate=>{const deadline=Date.now()+6000;while(!await predicate()){if(Date.now()>deadline)throw Error('Fixture transition timed out: '+wc.getURL());await new Promise(r=>setTimeout(r,30));}};
 const arrived=pathname=>waitFor(()=>new URL(wc.getURL()).pathname===pathname&&!wc.isLoading());
 await wc.loadURL('https://nol.yanolja.com/ticket/genre/sports/test');win.minimize();if(win.isVisible())win.hide();
 await waitFor(()=>win.isMinimized()&&!win.isVisible());verifyWindow('listing ready');
 const expired=await wc.executeJavaScript(code+`;BaseballCodeDispatch('entry.prepareEntry',{key:'10월 17일 | 홈 vs 원정',runId:'expired-fixture'},${JSON.stringify({connection:'smoke',epoch:0,expiresAt:Date.now()-1})})`);
 assert.equal(expired.ok,false);assert.equal(expired.code,'SITE_CODE_EXPIRED');assert.equal(requests.length,0);report.expiredCommandRejected=true;
 await call('entry.prepareEntry',{key:'10월 17일 | 홈 vs 원정',runId:'smoke'});await arrived('/gates/ticket/26009123');
 verifyWindow('gate arrived');
 await call('entry.armGate',{goodsCode:identity.goodsCode,runId:'smoke'});
 await wc.executeJavaScript('activate();');await arrived('/waiting');
 assert.equal(requests.filter(r=>r.path==='/waiting/api/secure-url').length,1);
 await wc.executeJavaScript('queueAdmitted();');await arrived('/onestop/seat');
 verifyWindow('seat arrived');
 await call('flow.clickKnown','확인하고 예매하기');await waitFor(async()=>!!await wc.executeJavaScript('document.querySelector("#captcha img")?.complete'));
 const service=new CaptchaService({ocr:{warmup:async()=>{},recognize:async()=>({valid:true,text:'ABCDEF',confidence:.99})},resultTimeoutMs:4000});
 // The recognizer's supported alphabet excludes B/F; use a known accepted
 // six-letter fixture result. The fixture server deliberately rejects round 1.
 service.ocr.recognize=async()=>({valid:true,text:'WTCNBW',confidence:.99});
 const result=await service.execute({mode:'auto',scope:'smoke',adapter:{assertCurrent(){},snapshot:()=>call('captcha.captchaSnapshot'),submit:arg=>call('captcha.captchaSubmit',arg),status:arg=>call('captcha.captchaStatus',arg),refresh:arg=>call('captcha.captchaRefresh',arg)}});
 assert.equal(result.status,'verified');assert.equal(images,2);assert.equal(verifications,2);
 await call('live.liveAction',{row:{kind:'grade',name:'일반석'},action:'click'});await call('flow.clickKnown','직접 좌석 선택하기');
 await call('flow.clickKnown','좌석도 전체보기');await call('live.liveAction',{row:{kind:'grade',name:'일반석'},action:'click'});await call('flow.clickKnown','직접 좌석 선택하기');
 await wc.executeJavaScript('emptyNotice();');await call('flow.dismissEmptySelection');assert.equal((await call('flow.scene')).dialog,null);
 await wc.executeJavaScriptInIsolatedWorld(999,[{code:actions+"\nHTMLElement.prototype.click=function(){throw Error('Isolated click forbidden');};EventTarget.prototype.dispatchEvent=function(){throw Error('Isolated event forbidden');};void 0;"}]);
 const http=arg=>wc.executeJavaScriptInIsolatedWorld(999,[{code:`BaseballActions['httpBooking.httpBookingAction'](${JSON.stringify({runId:'http-smoke',...arg})})`}]);
 let status=await http({action:'begin',expected:identity,seats,quantity:2,expiresAt:Date.now()+15000});
 for(let i=0;i<15&&status.stage!=='ready';i++){assert.equal(status.status,'pending');status=await http({action:'step'});}
 assert.equal(status.stage,'ready');assert.equal(status.requestCount,7);assert.equal(requests.filter(r=>r.path==='/onestop/api/seatStatus').length,1);
 assert.equal(status.priceAssessment.groups[0].selectedIndex,0);assert.equal(status.priceAssessment.groups[0].options[0].priceGradeName,'일반가');
 await wc.executeJavaScript(fs.readFileSync(path.join(root,'extension/http-navigation.js'),'utf8')+'\nvoid 0;');
 await wc.executeJavaScript(`BaseballHttpNavigate(${JSON.stringify({runId:'http-smoke',expected:identity,expiresAt:Date.now()+5000})})`);
 assert.equal(new URL(wc.getURL()).pathname,'/onestop/payment');assert.equal(await wc.executeJavaScript('fixture.events'),0);
 verifyWindow('fixture payment destination');
 Object.assign(report,{passed:true,minimized:win.isMinimized(),visible:win.isVisible(),domInputEvents:0,preparationRequests:1,queueEntryRequests:1,captchaImages:images,captchaVerifications:verifications,seatPriceRequests:7,seatStatusRequests:1,standardPriceName:'일반가',requests:requests.length,liveSite:false,destination:'/payment'});
}).then(()=>finish(),finish);
