'use strict';
// Real Chromium DOM, local fixtures only. No OCR model or real website is used.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const archive=path.join(root,'outputs',`BaseballTicketHelper-v${version}-win32-x64`,'resources','app.asar');
const page=require(path.join(archive,'src/manual-captcha-page.js'));
app.setPath('userData',path.join(root,'work',`manual-integration-${process.pid}`));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const report={passed:false,checks:[],realSiteRequests:0,fixtureRequests:0,ocrInvocations:0};let win;
  try{
    const local=session.fromPartition('manual-local-'+process.pid);let legacy=false;
    local.protocol.handle('https',request=>{
      report.fixtureRequests++;
      if(!['https://tickets.interpark.com/onestop/seat','https://ticket.interpark.com/Book/BookSeat.asp'].includes(request.url))return new Response('Blocked',{status:403});
      const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>img{display:block;width:260px;height:80px}input,button,a{display:inline-block;padding:10px}</style><div id="dialog"><img ${legacy?'id="imgCaptcha"':'alt="캡챠 이미지"'}><input id="txtCaptcha" type="text">${legacy?'<div class="capchaBtns"><a id="confirm" href="#">입력완료</a></div>':'<button id="confirm" disabled>입력완료</button>'}</div><script>const canvas=document.createElement('canvas');canvas.width=260;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,260,80);ctx.fillStyle='black';ctx.font='32px sans-serif';ctx.fillText('ABCDEF',20,50);document.querySelector('img').src=canvas.toDataURL();window.fixtureClicks=0;document.getElementById('txtCaptcha').addEventListener('input',()=>queueMicrotask(()=>document.getElementById('confirm').disabled=false));document.getElementById('confirm').addEventListener('click',e=>{e.preventDefault();window.fixtureClicks++;window.fixtureText=document.getElementById('txtCaptcha').value;document.getElementById('dialog').style.display='none';});window.changeImage=()=>{ctx.fillText('X',220,50);document.querySelector('img').src=canvas.toDataURL();return document.querySelector('img').decode();};</script>`;
      return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
    });
    win=new BrowserWindow({show:false,webPreferences:{session:local,contextIsolation:true,sandbox:true,nodeIntegration:false}});
    const invoke=(fn,arg)=>win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)??''})`);
    const load=async()=>{await win.loadURL(legacy?'https://ticket.interpark.com/Book/BookSeat.asp':'https://tickets.interpark.com/onestop/seat');await win.webContents.executeJavaScript('Promise.all(Array.from(document.images).map(img=>img.decode()))');};
    for(const mode of ['onestop','legacy']){
      legacy=mode==='legacy';await load();
      let ready=await invoke(page.manualCaptchaPrepare,{focus:true});
      assert.equal(ready.supported,true);assert.ok(ready.imageDataUrl);assert.equal(ready.focused,true);
      assert.deepEqual(await win.webContents.executeJavaScript('({clicks:fixtureClicks,text:document.getElementById("txtCaptcha").value})'),{clicks:0,text:''});
      report.checks.push(mode+': prepare focuses input without entering text or clicking');
      const result=await invoke(page.manualCaptchaSubmit,{challengeId:ready.challengeId,text:'ABCDEF'});
      assert.equal(result.submitted,true);
      await invoke(page.manualCaptchaSubmit,{challengeId:ready.challengeId,text:'ABCDEF'});
      assert.deepEqual(await win.webContents.executeJavaScript('({clicks:fixtureClicks,text:fixtureText})'),{clicks:1,text:'ABCDEF'});
      report.checks.push(mode+': explicit human text submitted exactly once');
      await load();ready=await invoke(page.manualCaptchaPrepare,{focus:true});await win.webContents.executeJavaScript('changeImage()');
      const stale=await invoke(page.manualCaptchaSubmit,{challengeId:ready.challengeId,text:'ABCDEF'});
      assert.equal(stale.status,'changed');assert.equal(stale.submitted,false);
      assert.deepEqual(await win.webContents.executeJavaScript('({clicks:fixtureClicks,text:document.getElementById("txtCaptcha").value})'),{clicks:0,text:''});
      report.checks.push(mode+': refreshed challenge rejects old human text');
    }
    report.passed=true;
  }catch(error){report.error=error.stack||String(error);}
  finally{
    if(win&&!win.isDestroyed())win.destroy();report.completedAt=new Date().toISOString();
    fs.writeFileSync(path.join(root,'work',`manual-captcha-integration-v${version}.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));app.exit(report.passed?0:1);
  }
}).catch(error=>{console.error(error);app.exit(1);});
