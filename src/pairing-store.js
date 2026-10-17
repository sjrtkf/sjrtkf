'use strict';
const fs=require('node:fs'),path=require('node:path');
function validPair(value){return value&&typeof value.origin==='string'&&typeof value.token==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(value.origin)&&/^[a-f0-9]{64}$/.test(value.token);}
function createPairingStore({file,safeStorage,io=fs,onError=()=>{}}){
  return {
    load(){try{if(!io.existsSync(file))return null;if(!safeStorage.isEncryptionAvailable()||io.statSync(file).size>16384)throw Error();const value=JSON.parse(safeStorage.decryptString(io.readFileSync(file)));if(!validPair(value))throw Error();return value;}catch{onError('저장된 연결을 읽지 못했습니다. 새 연결 코드로 다시 연결해 주세요.');return null;}},
    save(value){
      if(!validPair(value)||!safeStorage.isEncryptionAvailable())throw Error('연결 정보를 암호화해 저장하지 못했습니다.');
      const encrypted=safeStorage.encryptString(JSON.stringify(value));io.mkdirSync(path.dirname(file),{recursive:true});
      const temporary=file+'.tmp';io.writeFileSync(temporary,encrypted,{mode:0o600});io.renameSync(temporary,file);
    },
    clear(){if(io.existsSync(file))io.unlinkSync(file);}
  };
}
module.exports={createPairingStore,validPair};
