'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{
  const {packager}=await import('@electron/packager');
  const root=path.resolve(__dirname,'..'),version=require('../package.json').version.replace(/\.0$/,'');
  const output=process.env.TICKET_PACKAGE_OUT?path.resolve(process.env.TICKET_PACKAGE_OUT):path.join(root,'outputs');
  if(!output.startsWith(root+path.sep))throw Error('배포 출력은 현재 작업 폴더 안에 있어야 합니다.');
  const worker=path.join(root,'outputs','CaptchaWorker-v0.1');
  if(!fs.existsSync(path.join(worker,'CaptchaWorker-v0.1.exe'))||!fs.existsSync(path.join(worker,'_internal','ocr','models','captcha_solver.onnx')))throw Error('먼저 scripts/package-ocr-worker.py로 OCR worker를 빌드해 주세요.');
  const destinations=await packager({dir:root,name:`BaseballTicketHelper-v${version}`,platform:'win32',arch:'x64',out:output,tmpdir:path.join(root,'work',`package-v${version}`),...(process.env.TICKET_ELECTRON_ZIP_DIR?{electronZipDir:process.env.TICKET_ELECTRON_ZIP_DIR}:{}),asar:true,ignore:/^\/(?:outputs|work|tests|ocr|ocr_ui|\.git)(?:$|\/)/});
  if(!destinations.length)throw Error('동일 버전 출력 폴더가 있어 빌드를 건너뛰었습니다. 기존 결과를 검증하거나 새 빌드 폴더를 준비해 주세요.');
  for(const destination of destinations)fs.cpSync(worker,path.join(destination,'resources','ocr-worker'),{recursive:true,errorOnExist:true,force:false});
  console.log('도우미와 보안문자 인식기를 함께 준비했습니다.');
})().catch(error=>{console.error(error);process.exitCode=1;});
