const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const {createRequire}=require('node:module');
function setup(){
  const sourcePath=path.resolve(__dirname,'../src/main.js'),load=createRequire(sourcePath),source=fs.readFileSync(sourcePath,'utf8').split('app.whenReady().then')[0];
  let release,armCount=0;const calls=[];
  const wc={id:1,isDestroyed:()=>false,getURL:()=> 'file://'+path.resolve(__dirname,'entry-fixture.html').replaceAll('\\','/'),executeJavaScriptInIsolatedWorld:async(_world,scripts)=>{const code=scripts[0].code;calls.push(code);if(code.startsWith('(function gameCards')){await new Promise(r=>release=r);return [{key:'fixture',schedule:''}];}if(code.startsWith('(function armEntry'))armCount++;return true;}};
  const electron={app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..'),setPath(){}},powerSaveBlocker:{start:()=>1,isStarted:()=>true,stop(){}}};
  const mockFs={...fs,readFileSync:()=>{throw Error('no preferences');},writeFileSync(){},mkdirSync(){}};
  const context={require:n=>n==='electron'?electron:n==='node:fs'?mockFs:load(n),__dirname:path.dirname(sourcePath),process:{argv:['node','--smoke-test'],pid:0},URL,Date,console,setTimeout,clearTimeout};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.audit={command,getRunner:()=>runner,init:wc=>{targets.set(1,wc);active=1;mainId=1;},setFixture:()=>{}};',context);context.audit.init(wc);
  // Use the same file URL encoder as the app on Windows.
  wc.getURL=()=>require('node:url').pathToFileURL(path.resolve(__dirname,'entry-fixture.html')).href;
  return {api:context.audit,release:()=>release(),armed:()=>armCount,calls};
}
test('main 시작 준비 중 중지는 카드 클릭을 막고 정리 완료 후 잠금을 푼다',async()=>{const t=setup();await t.api.command('start',{key:'fixture',openAt:Date.now()+10000});const stop=t.api.command('stop');assert.equal(t.api.getRunner().cancelled,true);await assert.rejects(t.api.command('start',{key:'fixture'}),/진행 중/);t.release();await stop;assert.equal(t.armed(),0);assert.equal(t.api.getRunner(),null);});
test('main 실행 중 대상창·수동선택·설정 변경은 서버 호출 전 거절한다',async()=>{const t=setup();await t.api.command('start',{key:'fixture'});for(const action of ['target','choose','complete','preferences','seat','home'])await assert.rejects(t.api.command(action,2),/진행 중/);const stop=t.api.command('stop');t.release();await stop;assert.equal(t.armed(),0);});
