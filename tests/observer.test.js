const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {attachMetadata}=require('../src/metadata');
test('정상적으로 받은 좌석 메타 응답만 읽고 회원 응답은 읽지 않는다',async()=>{
 const wc=new EventEmitter();wc.isDestroyed=()=>false;wc.debugger=new EventEmitter();wc.debugger.attach=()=>{};const read=[];wc.debugger.sendCommand=async(method,args)=>{if(method==='Network.getResponseBody'){read.push(args.requestId);return {body:JSON.stringify([{blockKey:'001:118',seats:[{seatInfoId:'test:1',rowIdx:0,colIdx:0,rowNo:'1',seatNo:'1',seatGrade:'R',isExposable:true}]}])};}};let result;
 attachMetadata(wc,rows=>result=rows,()=>{},message=>assert.fail(message));
 for(const [requestId,url] of [['member','https://tickets.interpark.com/onestop/api/member'],['seat','https://tickets.interpark.com/onestop/api/seatMeta']]){wc.debugger.emit('message',{},'Network.requestWillBeSent',{requestId,request:{url}});wc.debugger.emit('message',{},'Network.responseReceived',{requestId,response:{url,status:200}});wc.debugger.emit('message',{},'Network.loadingFinished',{requestId,encodedDataLength:100});}
 await new Promise(r=>setImmediate(r));assert.deepEqual(read,['seat']);assert.equal(result[0].row,1);
});
test('화면 이동 뒤 도착한 이전 좌석 응답은 새 저장소에 섞이지 않는다',async()=>{
 const wc=new EventEmitter();wc.isDestroyed=()=>false;wc.debugger=new EventEmitter();wc.debugger.attach=()=>{};let respond,decoded=0,reset=0,data=0;
 wc.debugger.sendCommand=async(method)=>{if(method==='Network.getResponseBody'){decoded++;return new Promise(r=>respond=r);}return {};};
 attachMetadata(wc,()=>data++,()=>{},()=>{},()=>reset++);
 const event=(name,p)=>wc.debugger.emit('message',{},name,p),request={url:'https://tickets.interpark.com/onestop/api/seatMeta'};
 event('Network.requestWillBeSent',{requestId:'old',request});event('Network.loadingFinished',{requestId:'old',encodedDataLength:10});
 wc.emit('did-start-navigation',{},'https://tickets.interpark.com/onestop/seat',false,true);
 respond({body:JSON.stringify([{blockKey:'001:118',seats:[{seatInfoId:'old',rowIdx:0,colIdx:0,rowNo:'1',seatNo:'1'}]}])});await new Promise(r=>setImmediate(r));
 assert.equal(reset,1);assert.equal(data,0);
 event('Network.responseReceived',{requestId:'old',response:{url:request.url,status:200}});event('Network.loadingFinished',{requestId:'old',encodedDataLength:10});
 assert.equal(decoded,1);
});
test('같은 화면에서 경기 회차 조회 변수가 바뀌면 저장소 범위를 초기화한다',()=>{
 const wc=new EventEmitter();wc.isDestroyed=()=>false;wc.debugger=new EventEmitter();wc.debugger.attach=()=>{};wc.debugger.sendCommand=async()=>({});let reset=0;
 attachMetadata(wc,()=>{},()=>{},()=>{},()=>reset++);
 for(const playSeq of ['001','001','002'])wc.debugger.emit('message',{},'Network.requestWillBeSent',{requestId:'q'+playSeq,request:{url:'https://tickets.interpark.com/onestop/gql',postData:JSON.stringify({query:'query GetRemainSeats { getRemainSeats }',variables:{playSeq}})}});
 assert.equal(reset,1);
});
test('GetRemainSeats 응답의 등급 코드와 이름만 보관한다',async()=>{
 const wc=new EventEmitter();wc.isDestroyed=()=>false;wc.debugger=new EventEmitter();wc.debugger.attach=()=>{};wc.debugger.sendCommand=async(method)=>method==='Network.getResponseBody'?{body:JSON.stringify({data:{getRemainSeats:[{seatGrade:'R',seatGradeName:'3루 레드석',salePrice:31000}]}})}:{};let result;
 attachMetadata(wc,()=>{},rows=>result=rows,message=>assert.fail(message));wc.debugger.emit('message',{},'Network.requestWillBeSent',{requestId:'g',request:{url:'https://tickets.interpark.com/onestop/graphql',postData:JSON.stringify({query:'query GetRemainSeats { getRemainSeats { seatGrade seatGradeName } }'})}});wc.debugger.emit('message',{},'Network.loadingFinished',{requestId:'g',encodedDataLength:100});await new Promise(r=>setImmediate(r));assert.deepEqual(result,[{code:'R',name:'3루 레드석'}]);
});
