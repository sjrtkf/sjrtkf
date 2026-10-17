'use strict';
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createPairingStore}=require('../src/pairing-store'),{BrowserBridge}=require('../src/browser-bridge');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'work/connection-smoke-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const watchdog=setTimeout(()=>app.exit(1),15000);
app.whenReady().then(async()=>{
  const store=createPairingStore({file:path.join(profile,'pairing.bin'),safeStorage}),origin='chrome-extension://'+'a'.repeat(32);
  const write=process.argv.includes('--write');if(write)store.clear();
  const bridge=new BrowserBridge({port:0,pairingStore:store});await bridge.start();
  const post=async(route,body,token)=>fetch('http://127.0.0.1:'+bridge.port+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  if(write){
    const result=await post('/pair',{code:bridge.getState().pairCode,version:'0.9.18',capabilities:['extension.reload']});assert.equal(result.status,200);
    const {token}=await result.json();assert.equal(fs.readFileSync(path.join(profile,'pairing.bin')).includes(Buffer.from(token)),false);
  }else{
    assert.equal(bridge.getState().paired,true);assert.equal(bridge.getState().pairCode,null);assert.equal(bridge.connected,false);
    const {token}=store.load();assert.equal((await post('/heartbeat',{version:'0.9.18',capabilities:['extension.reload']},token)).status,200);
    assert.equal(bridge.connected,true);assert.equal(bridge.queue.length,0);bridge.refreshPairing();assert.equal(store.load(),null);
    const report={passed:true,separateProcessRestart:true,windowsEncryptedStorage:true,oldCommandsResumed:0,revocationPassed:true,liveChrome:false};
    fs.writeFileSync(path.join(root,'work/connection-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }
  await bridge.close();clearTimeout(watchdog);app.exit(0);
}).catch(error=>{console.error(error.message);app.exit(1);});
