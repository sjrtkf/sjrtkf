'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
(async()=>{
  const {extractFile,listPackage}=await import('@electron/asar');
  const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),version=pkg.version.replace(/\.0$/,'');
  const output=path.join(process.env.TICKET_PACKAGE_OUT?path.resolve(process.env.TICKET_PACKAGE_OUT):path.join(root,'outputs'),`BaseballTicketHelper-v${version}-win32-x64`),archive=path.join(output,'resources','app.asar');
  const panel=JSON.parse(fs.readFileSync(path.join(root,`work/panel-smoke-result-v${version}.json`),'utf8'));
  const testLog=fs.readFileSync(path.join(root,`work/tests-v${version}.txt`),'utf8');
  const passed=Number(testLog.match(/ℹ pass (\d+)/)?.[1]),failed=Number(testLog.match(/ℹ fail (\d+)/)?.[1]);
  if(!panel.passed||!passed||failed!==0)throw Error('검증 결과가 없거나 실패가 남아 있습니다.');
  const report={version:pkg.version,unitTests:{passed,failed},panel,checkedFiles:0,liveChromeValidated:false,realOpeningValidated:false};
  const noClick=JSON.parse(fs.readFileSync(path.join(root,'work/no-click-smoke.json'),'utf8'));
  if(!noClick.passed||noClick.version!==pkg.version||!noClick.minimized||noClick.domInputEvents!==0||noClick.captchaVerifications!==2||noClick.seatStatusRequests!==1||noClick.standardPriceName!=='일반가'||noClick.destination!=='/payment')throw Error('일반 가격을 포함한 최소화·클릭 없는 전체 흐름 검증이 필요합니다.');
  report.noClickFlow=noClick;
  const entry=JSON.parse(fs.readFileSync(path.join(root,`work/entry-http-smoke-v${version}.json`),'utf8'));
  if(!entry.passed||entry.checks.length<13||!entry.checks.some(c=>c.name.includes('countdown UI remains disabled')&&c.calls===1)||!entry.checks.some(c=>c.name.includes('early request waits')&&c.calls===1&&c.functions===0)||!entry.checks.some(c=>c.name.includes('waiting for the deadline')&&c.calls===0))throw Error('비활성 버튼에서 정시 API 호출·조기 전송 차단·중복·중지 검증이 필요합니다.');
  if(entry.window?.beforeMs!==2000||entry.window?.afterMs!==2000||entry.window?.intervalMs!==30||!entry.checks.some(c=>c.name.includes('not-open responses retry')&&c.calls>=4)||!entry.checks.some(c=>c.name.includes('real browser navigation')))throw Error('재시도 구간 및 다음 페이지 이동 검증이 필요합니다.');
  if(!entry.checks.some(c=>c.name.includes('document-start guard holds')&&c.functions===0))throw Error('문서 시작 단계의 자동 진입 차단 검증이 필요합니다.');
  report.entry=entry;
  const listing=JSON.parse(fs.readFileSync(path.join(root,`work/listing-entry-smoke-v${version}.json`),'utf8'));
  if(!listing.passed||listing.checks.length<9)throw Error('목록 활성화·중지·예약 시각 검증이 필요합니다.');
  report.listing=listing;
  const noticeSeat=JSON.parse(fs.readFileSync(path.join(root,`work/notice-seat-smoke-v${version}.json`),'utf8'));
  if(!noticeSeat.passed||noticeSeat.checks.length<7||noticeSeat.liveRequests!==0)throw Error('예매 안내·좌석 변경 감지 브라우저 검증이 필요합니다.');
  report.noticeSeat=noticeSeat;
  const integration=JSON.parse(fs.readFileSync(path.join(root,`work/booking-integration-v${version}.json`),'utf8'));
  if(!integration.passed||integration.version!==pkg.version||integration.checks?.length<23||integration.liveRequests!==0)throw Error('일반 가격·자동 탐색·여러 구역 합산·HTTP·다음 화면 연결 검증이 필요합니다.');
  report.bookingIntegration=integration;
  const connection=JSON.parse(fs.readFileSync(path.join(root,'work/connection-smoke.json'),'utf8'));
  if(!connection.passed||!connection.separateProcessRestart||!connection.windowsEncryptedStorage||!connection.revocationPassed)throw Error('자동 재연결·암호화 저장 검증이 필요합니다.');
  report.connection=connection;
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
  const removedFiles=['src/venue-profiles.js','src/seat-catalog.js','src/smoke.js'];
  const packagedPaths=new Set(listPackage(archive).map(p=>p.replace(/\\/g,'/').replace(/^\//,'')));
  for(const file of removedFiles)if(fs.existsSync(path.join(root,file))||packagedPaths.has(file))throw Error('삭제한 기능 파일이 남아 있습니다: '+file);
  report.removedFeatureFilesAbsent=removedFiles;
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
