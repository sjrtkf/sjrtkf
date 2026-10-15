'use strict';
// Real Chromium DOM + packaged OCR worker, with every HTTPS request served from
// an in-memory fixture. This never connects to or controls a real ticket site.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version.replace(/\.0$/,'');
const folder=path.join(root,'outputs',`BaseballTicketHelper-v${version}-win32-x64`);
const packaged=path.join(folder,'resources','app.asar');
const {OcrClient}=require(path.join(packaged,'src','ocr-client.js'));
const {CaptchaService}=require(path.join(packaged,'src','captcha-service.js'));
const page=require(path.join(packaged,'src','captcha-page.js'));
app.setPath('userData',path.join(root,'work',`captcha-integration-settings-${process.pid}`));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const ocr=new OcrClient({executable:path.join(folder,'resources','ocr-worker','CaptchaWorker-v0.1.exe')});
  const service=new CaptchaService({ocr}),checks=[];let win;
  const report={passed:false,checks,realSiteRequests:0,fixtureRequests:0};
  try{
    const local=session.fromPartition('captcha-local-'+process.pid);
    let expected='WTCNBW',legacy=false;
    local.protocol.handle('https',request=>{
      report.fixtureRequests++;
      const permitted=['https://tickets.interpark.com/onestop/seat','https://ticket.interpark.com/Book/BookSeat.asp'];
      if(!permitted.includes(request.url))return new Response('Blocked local fixture route',{status:403});
      const image=fs.readFileSync(path.join(root,'outputs','CaptchaReader-v0.1','sample-images',expected+'.png')).toString('base64');
      // The live onestop page labels PNG bytes as JPEG. Preserve that mismatch
      // here so the complete DOM-to-worker path protects against regressions.
      const declaredMime=legacy?'image/png':'image/jpeg';
      const button=legacy?'<div class="capchaBtns"><a id="confirm" href="#">입력완료</a></div>':'<button id="confirm" disabled>입력완료</button>';
      const html=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>body{padding:20px}img{display:block}input,button,a{display:inline-block;padding:10px}</style><div id="dialog"><img ${legacy?'id="imgCaptcha"':'alt="캡챠 이미지"'} src="data:${declaredMime};base64,${image}"><input id="txtCaptcha" type="text">${button}</div><script>window.fixtureClicks=0;document.getElementById('txtCaptcha').addEventListener('input',()=>{queueMicrotask(()=>document.getElementById('confirm').disabled=false)});document.getElementById('confirm').addEventListener('click',e=>{e.preventDefault();window.fixtureClicks++;window.fixtureText=document.getElementById('txtCaptcha').value;document.getElementById('dialog').style.display='none';});</script>`;
      return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
    });
    win=new BrowserWindow({show:false,width:500,height:400,webPreferences:{session:local,contextIsolation:true,sandbox:true,nodeIntegration:false}});
    const invoke=(fn,arg)=>win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)??''})`);
    await service.warmup();assert.equal(service.status.ready,true);
    for(const mode of ['onestop','legacy']){
      legacy=mode==='legacy';expected=legacy?'TXCBPQ':'WTCNBW';
      await win.loadURL(legacy?'https://ticket.interpark.com/Book/BookSeat.asp':'https://tickets.interpark.com/onestop/seat');
      await win.webContents.executeJavaScript('Promise.all(Array.from(document.images).map(img=>img.decode()))');
      const adapter={assertCurrent(){},snapshot:()=>invoke(page.captchaSnapshot),submit:arg=>invoke(page.captchaSubmit,arg),status:arg=>invoke(page.captchaStatus,arg)};
      const read=await service.execute({mode:'read',scope:mode,adapter});assert.equal(read.text,expected);
      assert.deepEqual(await win.webContents.executeJavaScript('({clicks:window.fixtureClicks,text:document.getElementById("txtCaptcha").value})'),{clicks:0,text:''});
      const result=await service.execute({mode:'submit',scope:mode,adapter});assert.equal(result.status,'verified');
      assert.deepEqual(await win.webContents.executeJavaScript('({clicks:window.fixtureClicks,text:window.fixtureText})'),{clicks:1,text:expected});
      checks.push({adapter:mode,declaredMime:legacy?'image/png':'image/jpeg',actualFormat:'PNG',readOnlyPreservedInput:true,recognized:expected,submittedOnce:true,disappearanceConfirmed:true});
    }
    assert.equal(win.isVisible(),false);report.passed=true;
  }catch(error){report.error=error.stack||String(error);process.exitCode=1;}
  finally{
    await service.close();if(win&&!win.isDestroyed())win.destroy();report.completedAt=new Date().toISOString();
    fs.writeFileSync(path.join(root,'work',`captcha-integration-v${version}.json`),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));app.exit(report.passed?0:1);
  }
}).catch(error=>{console.error(error);app.exit(1);});
