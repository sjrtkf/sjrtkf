'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
  const {extractFile,listPackage}=await import('@electron/asar');
  const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),version=pkg.version.replace(/\.0$/,'');
  const output=path.join(root,'outputs',`BaseballTicketHelper-v${version}-win32-x64`),archive=path.join(output,'resources','app.asar');
  const panel=JSON.parse(fs.readFileSync(path.join(root,`work/panel-smoke-result-v${version}.json`),'utf8'));
  const testLog=fs.readFileSync(path.join(root,`work/tests-v${version}.txt`),'utf8');
  const passed=Number(testLog.match(/ℹ pass (\d+)/)?.[1]),failed=Number(testLog.match(/ℹ fail (\d+)/)?.[1]);
  if(!panel.passed||!passed||failed!==0)throw Error('검증 결과가 없거나 실패가 남아 있습니다.');
  const report={version:pkg.version,unitTests:{passed,failed},panel,checkedFiles:0,liveChromeValidated:false,realOpeningValidated:false};
  for(const file of ['README.md',...fs.readdirSync(path.join(root,'src')).filter(n=>fs.statSync(path.join(root,'src',n)).isFile()).map(n=>'src/'+n)]){
    if(!extractFile(archive,file).equals(fs.readFileSync(path.join(root,file))))throw Error('패키지 파일 불일치: '+file);report.checkedFiles++;
  }
  const packaged=JSON.parse(extractFile(archive,'package.json'));
  if(packaged.version!==pkg.version||packaged.main!=='src/chrome-main.js')throw Error('패키지 버전 또는 실행점 불일치');
  for(const name of fs.readdirSync(path.join(root,'extension')).filter(n=>n!=='build.js')){
    const source=fs.readFileSync(path.join(root,'extension',name));
    if(!source.equals(fs.readFileSync(path.join(output,'chrome-extension',name))))throw Error('확장 파일 불일치: '+name);report.checkedFiles++;
  }
  if(listPackage(archive).some(p=>/^[/\\](?:work|outputs|tests|user-data|settings)(?:[/\\]|$)/.test(p)))throw Error('사용자 설정 또는 테스트 자료가 패키지에 포함되었습니다.');
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'chrome-extension','manifest.json')));
  if(manifest.version!==pkg.version)throw Error('앱과 확장 버전 불일치');
  for(const name of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(s=>s.js)])if(!fs.existsSync(path.join(output,'chrome-extension',name)))throw Error('확장 파일 누락: '+name);
  report.ocrWorkerFilesMatched=0;
  for(const name of ['CaptchaWorker-v0.1.exe','_internal/ocr/models/captcha_solver.onnx','_internal/ocr/models/labels.json','_internal/ocr/models/model-info.json']){
    if(!fs.readFileSync(path.join(root,'outputs','CaptchaWorker-v0.1',name)).equals(fs.readFileSync(path.join(output,'resources','ocr-worker',name))))throw Error('OCR worker 배포 파일 불일치: '+name);
    report.ocrWorkerFilesMatched++;
  }
  report.archiveSha256=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');report.completedAt=new Date().toISOString();
  fs.writeFileSync(path.join(root,`work/validation-v${version}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({version:pkg.version,checkedFiles:report.checkedFiles,unitTests:report.unitTests,panelChecks:panel.checks?.length,passed:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
