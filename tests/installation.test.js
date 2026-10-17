'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {installExtension}=require('../src/extension-install'),{createPairingStore}=require('../src/pairing-store');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ticket-install-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function bundle(root,version){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({version,background:{service_worker:'background.js'},action:{default_popup:'popup.html'},content_scripts:[{js:['content.js']}]}));for(const name of ['background.js','popup.html','content.js'])fs.writeFileSync(path.join(root,name),version);}
test('extension updates keep one destination, skip unchanged files and refuse a downgrade',t=>{
  const root=fixture(t),source=path.join(root,'bundle'),destination=path.join(root,'fixed');bundle(source,'0.9.18');
  assert.equal(installExtension({source,destination}).changed,true);assert.equal(installExtension({source,destination}).changed,false);
  bundle(source,'0.9.19');assert.equal(installExtension({source,destination}).path,destination);assert.equal(fs.readFileSync(path.join(destination,'content.js'),'utf8'),'0.9.19');
  bundle(source,'0.9.18');assert.throws(()=>installExtension({source,destination}),/최신/);assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'))).version,'0.9.19');
});
test('an incomplete extension or failed update never replaces an installed version with partial files',t=>{
  const root=fixture(t),source=path.join(root,'bundle'),destination=path.join(root,'fixed');bundle(source,'0.9.18');installExtension({source,destination});bundle(source,'0.9.19');
  let writes=0;const io={...fs,renameSync(a,b){if(++writes===2)throw Error('fixture disk error');fs.renameSync(a,b);}};
  assert.throws(()=>installExtension({source,destination,io}),/업데이트/);
  for(const name of ['background.js','content.js','popup.html'])assert.equal(fs.readFileSync(path.join(destination,name),'utf8'),'0.9.18');
  fs.unlinkSync(path.join(source,'content.js'));assert.throws(()=>installExtension({source,destination}),/누락/);
});
test('pairing store encrypts persisted credentials, survives restart and revokes them explicitly',t=>{
  const root=fixture(t),file=path.join(root,'pair.bin'),value={origin:'chrome-extension://'+'a'.repeat(32),token:'b'.repeat(64)};
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...Buffer.from(s)].map(v=>v^0x5a)),decryptString:b=>Buffer.from([...b].map(v=>v^0x5a)).toString()};
  const store=createPairingStore({file,safeStorage});store.save(value);assert.ok(!fs.readFileSync(file).toString().includes(value.token));
  assert.deepEqual(createPairingStore({file,safeStorage}).load(),value);store.clear();assert.equal(store.load(),null);
  assert.throws(()=>createPairingStore({file,safeStorage:{isEncryptionAvailable:()=>false}}).save(value),/암호화/);assert.equal(fs.existsSync(file),false);
});
