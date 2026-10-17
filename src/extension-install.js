'use strict';
const fs=require('node:fs'),path=require('node:path');
function installExtension({source,destination,io=fs}){
  source=path.resolve(source);destination=path.resolve(destination);
  if(source===destination)throw Error('확장 원본과 설치 폴더가 같습니다.');
  const manifest=JSON.parse(io.readFileSync(path.join(source,'manifest.json'),'utf8'));
  const versionParts=v=>/^\d+(?:\.\d+){2}$/.test(v)?v.split('.').map(Number):null;
  if(!versionParts(manifest.version))throw Error('확장 버전 형식이 올바르지 않습니다.');
  const priorManifest=path.join(destination,'manifest.json');
  if(io.existsSync(priorManifest)){
    const installed=versionParts(JSON.parse(io.readFileSync(priorManifest,'utf8')).version),next=versionParts(manifest.version);
    if(installed){const different=installed.findIndex((v,i)=>v!==next[i]);if(different>=0&&installed[different]>next[different])throw Error('더 최신 확장이 설치되어 있습니다. 최신 도우미를 실행해 주세요.');}
  }
  const files=io.readdirSync(source,{withFileTypes:true}).filter(e=>e.isFile()&&e.name!=='build.js').map(e=>e.name);
  for(const name of ['manifest.json',manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(s=>s.js)])if(!files.includes(name))throw Error('배포 확장 파일이 누락되었습니다.');
  const changed=files.filter(name=>!io.existsSync(path.join(destination,name))||!io.readFileSync(path.join(source,name)).equals(io.readFileSync(path.join(destination,name))));
  if(!changed.length)return {changed:false,version:manifest.version,path:destination};
  io.mkdirSync(destination,{recursive:true});
  const backup=new Map(),written=[];
  // Commit the manifest last; roll back every replaced file on write failure.
  changed.sort((a,b)=>(a==='manifest.json')-(b==='manifest.json'));
  try{for(const name of changed){const target=path.join(destination,name);backup.set(name,io.existsSync(target)?io.readFileSync(target):null);const temp=target+'.updating';io.writeFileSync(temp,io.readFileSync(path.join(source,name)));io.renameSync(temp,target);written.push(name);}}
  catch(error){for(const name of written.reverse()){const target=path.join(destination,name),old=backup.get(name);if(old)io.writeFileSync(target,old);else io.unlinkSync(target);}throw Error('확장 업데이트를 완료하지 못했습니다. 도우미를 다시 실행해 주세요.');}
  return {changed:true,version:manifest.version,path:destination};
}
module.exports={installExtension};
