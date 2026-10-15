'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version.replace(/\.0$/,'');
const appName=`BaseballTicketHelper-v${version}`,output=path.join(root,'outputs',`${appName}-win32-x64`);
if(!fs.existsSync(path.join(output,`${appName}.exe`)))throw Error('패키징된 실행 파일이 없습니다.');
const destination=path.join(output,'chrome-extension');fs.mkdirSync(destination,{recursive:true});
for(const entry of fs.readdirSync(path.join(root,'extension'),{withFileTypes:true})){
  if(entry.isFile()&&entry.name!=='build.js')fs.copyFileSync(path.join(root,'extension',entry.name),path.join(destination,entry.name));
}
fs.copyFileSync(path.join(root,'README.md'),path.join(output,'사용안내.md'));
console.log('Chrome 확장과 사용 안내를 실행 파일 옆에 준비했습니다.');
