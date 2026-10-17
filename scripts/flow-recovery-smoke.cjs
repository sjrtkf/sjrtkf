'use strict';
// Isolated Chromium fixture: no Chrome profile, live booking or network access.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const captcha=require('../src/captcha-page'),price=require('../src/price-page'),flow=require('../src/flow');
const {CaptchaService}=require('../src/captcha-service');
app.setPath('userData',path.resolve(__dirname,'../work/recovery-smoke-profile'));
const watchdog=setTimeout(()=>{console.error('Recovery smoke timed out');app.exit(1);},25000);
app.whenReady().then(async()=>{
  const sandbox=session.fromPartition('recovery-smoke');
  await sandbox.protocol.handle('https',()=>new Response('<!doctype html><html><body><h3>Local fixture</h3></body></html>',{headers:{'content-type':'text/html'}}));
  const win=new BrowserWindow({show:false,webPreferences:{session:sandbox,contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('https://tickets.interpark.com/onestop/seat');
  const wc=win.webContents,js=(fn,arg)=>wc.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)??''})`);
  wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  win.minimize();
  const background=await wc.executeJavaScript('({hidden:document.hidden,focused:document.hasFocus()})');
  assert.equal(win.isVisible(),false);assert.equal(background.hidden,false);
  await wc.executeJavaScript(`
    document.body.innerHTML='<div id="captcha"><div><img alt="캡챠 이미지"></div><input type="text"><div class="ModalCaptchaText_captchaError__fixture"></div><button id="submit" disabled>입력완료</button><button class="ModalCaptchaText_buttonRefresh__fixture" aria-label="새로고침">새로고침</button></div>';
    window.fixture={image:1,submits:0,refreshes:0};
    const image=document.querySelector('img'),input=document.querySelector('input'),submit=document.getElementById('submit'),error=document.querySelector('[class*=captchaError]');
    const draw=()=>{const c=document.createElement('canvas');c.width=120;c.height=40;const ctx=c.getContext('2d');ctx.fillStyle=['red','blue','green'][fixture.image-1];ctx.fillRect(0,0,120,40);image.src=c.toDataURL();};draw();
    input.addEventListener('input',()=>{submit.disabled=input.value.length!==6;});
    submit.onclick=()=>{fixture.submits++;if(fixture.image===2)error.textContent='보안문자가 일치하지 않습니다.';else document.getElementById('captcha').remove();};
    document.querySelector('[aria-label="새로고침"]').onclick=()=>{fixture.refreshes++;fixture.image++;input.value='';submit.disabled=true;error.textContent='';draw();};void 0;
  `);
  await wc.executeJavaScript('new Promise(r=>{const img=document.querySelector("img");if(img.complete)r();else img.onload=()=>r();})');
  let reads=0;
  const service=new CaptchaService({ocr:{warmup:async()=>{},recognize:async()=>({valid:true,text:'WTCNBW',confidence:++reads===1?.1:.99}),close:async()=>{}},resultTimeoutMs:3000});
  const result=await service.execute({mode:'auto',scope:'fixture',adapter:{assertCurrent(){},snapshot:()=>js(captcha.captchaSnapshot),submit:a=>js(captcha.captchaSubmit,a),status:a=>js(captcha.captchaStatus,a),refresh:a=>js(captcha.captchaRefresh,a)}});
  assert.equal(result.status,'verified');assert.deepEqual(await wc.executeJavaScript('fixture'),{image:3,submits:2,refreshes:2});
  await wc.executeJavaScript(`history.replaceState({},'', '?step=price');document.body.innerHTML='<div role="alertdialog"><p id="dialogMessage">구매하실 좌석을 선택하세요.</p><button onclick="this.parentElement.remove()">확인</button></div>';`);
  assert.equal((await js(flow.scene)).completed,false);await js(flow.dismissEmptySelection);assert.equal((await js(flow.scene)).completed,false);
  await wc.executeJavaScript(`history.replaceState({},'', '/onestop/seat');document.body.innerHTML='<svg width="100" height="100"><circle class="js-seat" id="return-fixture" cx="20" cy="20" r="8"></circle></svg>';`);
  assert.equal((await js(price.returnToSeats)).returned,true);
  await wc.executeJavaScript(`history.replaceState({},'', '?step=price');document.body.innerHTML='<div class="PriceGroup_group__fixture"><h3 class="PriceGroup_title__fixture">W석</h3><span class="PriceGroup_countMax__fixture">/ 2</span><p class="PriceGroup_seatInfo__fixture">W1구역 10열 12번 외 1석</p><ul><li class="PriceItem_typeItem__fixture"><div class="PriceItem_name__fixture">[예매가] 성인</div><input role="spinbutton" value="0" readonly><button class="nds-stepper__incrementButton">+</button></li></ul></div>';window.priceClicks=0;document.querySelector('button').onclick=()=>{priceClicks++;setTimeout(()=>{document.querySelector('input').value=String(Number(document.querySelector('input').value)+1);},30);};var priceState=${price.priceState.toString()};void 0;`);
  assert.equal((await js(flow.scene)).completed,true);
  let priceResult;
  for(let i=0;i<30;i++){priceResult=await js(price.adultPriceStep,{quantity:2});if(priceResult.status==='complete')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(priceResult.status,'complete');assert.equal(await wc.executeJavaScript('priceClicks'),2);
  await wc.executeJavaScript(`window.bookingClicks=0;const book=document.createElement('button');book.textContent='2매 예매하기';book.onclick=()=>{bookingClicks++;setTimeout(()=>{history.pushState({},'', '/onestop/payment');document.body.innerHTML='<h2>예매자 정보</h2><button>결제하기</button>';},30);};document.body.append(book);void 0;`);
  assert.equal((await js(price.proceedBooking,{quantity:2})).dispatched,true);
  assert.equal((await js(price.proceedBooking,{quantity:2})).dispatched,false);
  let progressed=false;for(let i=0;i<30;i++){if((await js(price.bookingProgress)).ready){progressed=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert.equal(progressed,true);assert.equal(await wc.executeJavaScript('bookingClicks'),1);
  const live=require('../src/live-adapter');
  await wc.executeJavaScript(`history.replaceState({},'', '/onestop/seat');document.body.innerHTML='<svg width="300" height="200"><g id="seat_block_001:118"><circle class="js-seat" id="fixture-seat" cx="20" cy="20" r="8" fill="red"></circle></g></svg><div style="position:fixed;inset:0;background:white">다른 패널</div>';window.seatEvents=0;document.querySelector('circle').addEventListener('pointerup',()=>seatEvents++);void 0;`);
  const rows=(await js(live.liveRead)).rows;assert.equal(rows.length,1);
  await js(live.liveAction,{row:rows[0],action:'click'});assert.equal(await wc.executeJavaScript('seatEvents'),1);
  const report={passed:true,scope:'Isolated hidden/minimized Electron Chromium fixture; no live ticket requests',background,captcha:{reads,refreshes:2,submits:2},emptySeatDialogDismissed:true,urlOnlySuccessRejected:true,adultQuantity:2,priceClicks:2,bookingClicks:1,nextPageConfirmed:true,occludedSeatCodeDispatch:true,completedAt:new Date().toISOString()};
  fs.writeFileSync(path.resolve(__dirname,'../work/flow-recovery-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));await service.close();win.destroy();clearTimeout(watchdog);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(watchdog);app.exit(1);});
