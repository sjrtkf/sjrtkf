'use strict';
exports.run=async({app,BrowserWindow,ses,track,setEndpoint,arm,observe,getResults})=>{
  const http=require('node:http'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const received=[],opened=[];let win;let reject=false;
  const server=http.createServer((req,res)=>{
    if(req.url==='/enter'){
      let body='';req.on('data',b=>body+=b);req.on('end',()=>{received.push({body,cookie:req.headers.cookie});res.writeHead(reject?403:200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:!reject}));});
    }else{res.writeHead(200,{'Content-Type':'text/html','Set-Cookie':'probe_session=synthetic; SameSite=Lax; Path=/'});res.end('<!doctype html><title>Local probe fixture</title><button id="send">Send</button><script>document.getElementById("send").onclick=async()=>{const r=await fetch("/enter",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({signature:"synthetic-test-only",secureData:"local-fixture"})});document.body.dataset.status=String(r.status);}</script>');}
  });
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
    const make=()=>{const w=new BrowserWindow({show:false,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true}});opened.push(w);track(w.webContents);return w;};
    setEndpoint(origin+'/enter');win=make();
    await win.loadURL(origin);
    const wait=async count=>{const start=Date.now();while(getResults().length<count){if(Date.now()-start>6000)throw Error('result timeout');await new Promise(r=>setTimeout(r,20));}};
    await win.webContents.executeJavaScript('document.getElementById("send").click()');await wait(1);
    arm();await win.webContents.executeJavaScript('document.getElementById("send").click()');await wait(2);
    reject=true;arm();await win.webContents.executeJavaScript('document.getElementById("send").click()');await wait(3);
    assert.equal(await win.webContents.executeJavaScript('document.body.dataset.status'),'403');
    assert.equal(await win.webContents.executeJavaScript('typeof window.probe'),'undefined');
    reject=false;const second=make();await second.loadURL(origin);arm();
    await win.webContents.executeJavaScript('document.getElementById("send").click()');await wait(4);
    await second.webContents.executeJavaScript('document.getElementById("send").click()');await wait(5);
    arm();const third=make();await third.loadURL(origin);
    await third.webContents.executeJavaScript('document.getElementById("send").click()');await wait(6);
    arm();observe();await third.webContents.executeJavaScript('document.getElementById("send").click()');await wait(7);
    assert.equal(received.length,7);assert.ok(received.every(r=>r.cookie==='probe_session=synthetic'));assert.equal(new Set(received.map(r=>r.body)).size,1);
    assert.deepEqual(getResults().map(r=>r.mode),['일반 버튼','직접 전송','직접 전송','일반 버튼','직접 전송','일반 버튼','일반 버튼']);
    assert.deepEqual(getResults().map(r=>r.status),[200,200,403,200,200,200,200]);
    assert.equal(new Set(getResults().map(r=>r.attemptId)).size,7);
    assert.equal(getResults()[0].runId,getResults()[3].runId);assert.notEqual(getResults()[3].runId,getResults()[4].runId);
    assert.ok(getResults().every(r=>!('body'in r)&&!('headers'in r)&&!('seatDocumentMs'in r)));
    const report={localOnly:true,passed:true,checks:['정상 요청 관찰','직접 전송당 서버 수신 1건','세션 쿠키 유지','본문 동일','응답을 원래 페이지에 전달','403 응답 재시도 없음','원격 페이지에 IPC 없음','이전 창이 최신 창 직접 전송 예약을 소비하지 않음','새 창/일반 모드 전환으로 예약 취소','시도 ID 유일성/창 귀속','인증 본문 미기록'],results:getResults()};
    fs.writeFileSync(path.join(__dirname,'../work/probe-smoke-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    for(const w of opened)if(!w.isDestroyed())w.destroy();server.close();app.exit(0);
  }catch(e){console.error('Probe smoke failed:',e.message);for(const w of opened)if(!w.isDestroyed())w.destroy();server.close();app.exit(1);}
};
