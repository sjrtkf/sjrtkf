'use strict';
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'work','gate-disabled-experiment.json');
const fixture=pathToFileURL(path.join(__dirname,'gate-disabled-fixture.html')).href;
app.setPath('userData',path.join(root,'work',`gate-disabled-local-${process.pid}`));
let win;
const report={
  title:'공개 코드의 내부 상태 검사 최소 재현',
  generatedAt:new Date().toISOString(),
  source:'work/gate-source-20260918/BBM0aKjO.js: Ld 및 Ya',
  scope:'로컬 DOM 및 모의 요청 횟수. 실제 React나 실서비스 예매 동작 검증이 아님.',
  assumptions:[
    '일반 예매 분기의 captured disabled 검사와 finally의 1,000ms 대기를 최소 재현한다.',
    'Ya의 현재 함수 참조와 실행 중 재호출 차단을 최소 재현한다.',
    '실제 React가 DOM 클릭을 더 앞에서 차단하는 동작은 재현하지 않는다.',
    '내부 함수 호출은 로컬 fixture에서만 수행하며 실제 사이트에는 접속하지 않는다.'
  ],
  checks:[],passed:false
};
function save(){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
function check(name,fn){fn();report.checks.push({name,passed:true});}
app.whenReady().then(async()=>{
  const offline=session.fromPartition(`gate-disabled-local-${process.pid}`);
  offline.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  offline.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win=new BrowserWindow({show:false,width:700,height:450,webPreferences:{session:offline,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==fixture)event.preventDefault();});
  await win.loadURL(fixture);
  report.results=await win.webContents.executeJavaScript('window.runGateDisabledExperiment()');
  const [dom,lock,natural]=report.results;
  check('DOM 속성을 활성화해도 내부 disabled 검사에서 모의 진입을 막는다',()=>{
    assert.equal(dom.logicalDisabled,true);assert.equal(dom.domDisabled,false);
    assert.equal(dom.requestsImmediately,0);assert.equal(dom.guardReturns,1);
  });
  check('비활성 내부 함수를 실행하면 반환 분기에서도 약 1초 실행 잠금이 유지된다',()=>{
    assert.equal(lock.busyAfterDisabledInvocation,true);assert.equal(lock.requestsOnNaturalActivation,0);
    assert.equal(lock.blockedWhileBusy,1);assert.ok(lock.releasedAfterMs>=900);
    assert.equal(lock.requestsAfterRelease,1);
  });
  check('자연 활성화 후 정상 클릭은 동기적으로 모의 진입을 한 번 시작한다',()=>{
    assert.equal(natural.requestsSynchronously,1);assert.equal(natural.guardReturns,0);
    assert.equal(natural.blockedWhileBusy,0);
  });
  report.passed=true;
  save();
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,output}));
  app.exit(0);
}).catch(error=>{
  report.error={name:error.name,message:error.message};
  save();console.error(JSON.stringify(report.error));app.exit(1);
});
