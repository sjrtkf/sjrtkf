'use strict';
// Real Chromium + isolated extension world + HTTP protocol fixture. No live
// profile or server is used; every HTTPS request is intercepted in this partition.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {parseSeatLabels}=require('../src/metadata');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'work/http-smoke-profile'));
const watchdog=setTimeout(()=>app.exit(1),25000);
app.whenReady().then(async()=>{
  const identity={goodsCode:'26009123',placeCode:'25001730',playSeq:'001'};
  const context={sessionId:'fixture-session',channelType:'NOL',bizCode:'WEBBR',goods:{...identity,goodsName:'격리 테스트',reserved:true,reservedSeat:true,isInterlocking:false,kindOfGoods:'01007',ticketMaxCount:4},playSeq:{playSeq:'001'}};
  const seats=[0,1].map(n=>({id:'seat_block_26009123:25001730:001:'+n,blockKey:'001:101',gradeCode:'1',grade:'일반석',rowIdx:0,colIdx:n,...parseSeatLabels('1열',String(n+1))}));
  const records=seats.map(v=>({seatInfoId:v.id.slice(11),seatGrade:'1',rowIdx:v.rowIdx,colIdx:v.colIdx,seatNo:String(v.number),rowNo:'1열',isExposable:true}));
  const calls=[],partition=session.fromPartition('http-booking-smoke');
  await partition.protocol.handle('https',async request=>{
    const url=new URL(request.url);assert.equal(url.origin,'https://tickets.interpark.com');
    if(url.pathname==='/onestop/seat')return new Response('<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{initData:context}}})+'</script><svg width="100" height="100"><g id="seat_block_001:101">'+seats.map((s,i)=>'<circle class="js-seat" id="'+s.id+'" cx="'+(20+i*25)+'" cy="20" r="8"></circle>').join('')+'</g></svg></body></html>',{headers:{'Content-Type':'text/html'}});
    const body=request.method==='POST'?await request.json():null;calls.push({path:url.pathname,body});
    let data;
    if(url.pathname==='/onestop/api/seatMeta')data=[{blockKey:'001:101',seats:records}];
    else if(url.pathname==='/onestop/api/seatStatus'){
      assert.equal(request.method,'GET');assert.deepEqual(url.searchParams.getAll('blockKeys'),['001:101']);
      for(const [key,value] of Object.entries(identity))assert.equal(url.searchParams.get(key),value);
      data={data:['c']};
    }
    else if(url.pathname==='/onestop/api/prices/'+identity.goodsCode)data={prices:[{seatGrade:'1',ticketMaxCount:4,priceList:[{seatGrade:'1',pgCode:'PG002',priceGrade:'A',priceGradeName:'일반가',discountName:'',salesPrice:10000,discountSalesPrice:10000,priceMaxCount:4}]}]};
    else if(url.pathname==='/onestop/api/seats/select')data={unselectableSeatInfoIds:[]};
    else if(url.pathname==='/onestop/gql'&&body.operationName==='PreselectSeat')data={data:{preselectSeat:true}};
    else if(url.pathname==='/onestop/gql'&&body.operationName==='ValidatePricingSelection')data={data:{validatePricingSelection:true}};
    else throw Error('Unexpected HTTP request: '+url.pathname);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  });
  const win=new BrowserWindow({show:false,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:true}}),wc=win.webContents;
  await wc.loadURL('https://tickets.interpark.com/onestop/seat');
  await wc.executeJavaScript(`sessionStorage.setItem('interpark/context',${JSON.stringify(JSON.stringify(context))});
    window.fixture={clicks:0,routes:[],cache:new Map([['/getContextData/undefined',{data:JSON.parse(sessionStorage.getItem('interpark/context'))}]])};
    HTMLElement.prototype.click=function(){fixture.clicks++;throw Error('Click forbidden');};
    window.webpackChunk_N_E=[];window.webpackChunk_N_E.push=entry=>entry[2](id=>id===74133?{F:{getContextData:()=>JSON.parse(sessionStorage.getItem('interpark/context'))}}:{d:{cache:fixture.cache,mutate:async(k,data)=>fixture.cache.set(k,{data})}});
    window.next={router:{push:async route=>{if(JSON.stringify(fixture.cache.get('/getContextData/undefined').data)!==sessionStorage.getItem('interpark/context'))throw Error('stale cache');fixture.routes.push(route);history.pushState({},'','/onestop'+route);document.body.innerHTML='<h1>결제</h1>';return true;}}};void 0;`);
  const invoke=arg=>wc.executeJavaScriptInIsolatedWorld(999,[{code:`BaseballActions['httpBooking.httpBookingAction'](${JSON.stringify(arg)})`}]);
  await wc.executeJavaScriptInIsolatedWorld(999,[{code:fs.readFileSync(path.join(root,'extension/actions.js'),'utf8')+"\nHTMLElement.prototype.click=function(){throw Error('Isolated click forbidden');};void 0;"}]);
  let status=await invoke({action:'begin',runId:'smoke',expected:identity,seats,quantity:2,expiresAt:Date.now()+15000});
  for(let i=0;i<15&&status.stage!=='ready';i++){assert.equal(status.status,'pending');status=await invoke({action:'step',runId:'smoke'});}
  assert.equal(status.stage,'ready');assert.equal(status.requestCount,7);assert.equal(calls.length,7);
  assert.equal(calls.filter(call=>call.path==='/onestop/api/seatStatus').length,1);
  await wc.executeJavaScript(fs.readFileSync(path.join(root,'extension/http-navigation.js'),'utf8')+'\nvoid 0;');
  await wc.executeJavaScript(`BaseballHttpNavigate(${JSON.stringify({runId:'smoke',expected:identity,expiresAt:Date.now()+10000})})`);
  const result=await wc.executeJavaScript('({clicks:fixture.clicks,routes:fixture.routes,hidden:document.hidden,context:JSON.parse(sessionStorage.getItem("interpark/context"))})');
  assert.equal(result.clicks,0);assert.deepEqual(result.routes,['/payment']);assert.equal(win.isVisible(),false);assert.equal(result.context.prices[0].selectedSeatCount,2);
  assert.equal(result.context.prices[0].pgPrice.priceGradeName,'일반가');assert.equal(status.priceAssessment.groups[0].selectedIndex,0);
  const report={passed:true,version:require('../package.json').version,windowHidden:true,pageHidden:result.hidden,httpRequests:calls.length,seatStatusRequests:1,clicks:0,selectedSeats:2,standardQuantity:2,destination:'/payment',liveSite:false};
  fs.writeFileSync(path.join(root,'work/http-booking-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  win.destroy();clearTimeout(watchdog);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
