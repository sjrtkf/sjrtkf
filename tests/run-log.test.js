'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRunLog,safeDetail,MAX_BYTES,MAX_FILES}=require('../src/run-log');
function fixture(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ticket-log-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}

test('pre-run failures are persisted without redirecting an active run or recording arguments',t=>{
  const directory=fixture(t),log=createRunLog({directory,version:'fixture'});
  log.diagnostic('command-error',{action:'refresh',message:'Value is unserializable',arg:{text:'ABCDEF'}});
  log.start(7);log.diagnostic('command-error',{action:'inspect',message:'fixture'});log.event('stage',{stage:'seats'});log.finish({id:7,durationMs:1});
  const files=fs.readdirSync(directory),active=fs.readFileSync(path.join(directory,files.find(f=>f.endsWith('-7.jsonl'))),'utf8');
  const diagnostics=files.filter(f=>f.endsWith('-0.jsonl')).map(f=>fs.readFileSync(path.join(directory,f),'utf8')).join('');
  assert.match(diagnostics,/Value is unserializable/);assert.doesNotMatch(diagnostics,/ABCDEF/);assert.match(active,/seats/);assert.match(active,/run-finish/);assert.doesNotMatch(active,/inspect/);
});
test('run history survives replacement of the last summary and incomplete runs remain inspectable',t=>{
  const directory=fixture(t),log=createRunLog({directory,version:'test'});
  log.start(1);log.event('stage',{stage:'search',message:'좌석 확인'});log.finish({id:1,durationMs:2,message:'완료'});
  log.start(2);log.event('command-error',{action:'readDetails',message:'등급 이름 충돌'});
  const files=fs.readdirSync(directory);assert.equal(files.length,2);
  const events=files.flatMap(f=>fs.readFileSync(path.join(directory,f),'utf8').trim().split('\n').map(JSON.parse));
  assert.equal(events.filter(e=>e.event==='run-start').length,2);assert.equal(events.filter(e=>e.event==='run-finish').length,1);assert.ok(events.some(e=>e.action==='readDetails'));
});
test('logs allowlist evidence and redact credential-shaped text without storing bodies or captcha',()=>{
  const result=safeDetail({message:'token=hidden secureData="hidden value" captcha=ABCDEF https://host/?secret=hidden',body:'secret',headers:{Cookie:'secret'},text:'ABCDEF',previewDataUrl:'private',gradeConflicts:[{code:'1',names:['A','B'],sessionId:'private'}]});
  assert.ok(!JSON.stringify(result).includes('hidden'));assert.ok(!JSON.stringify(result).includes('ABCDEF'));assert.ok(!JSON.stringify(result).includes('private'));assert.deepEqual(result.gradeConflicts,[{code:'1',names:['A','B']}]);
});
test('rotation and per-run size are bounded without deleting unrelated files',t=>{
  const directory=fixture(t),log=createRunLog({directory});fs.writeFileSync(path.join(directory,'keep.txt'),'keep');
  for(let i=1;i<=MAX_FILES+5;i++){log.start(i);log.finish({id:i,durationMs:0});}
  assert.equal(fs.readdirSync(directory).filter(f=>f.endsWith('.jsonl')).length,MAX_FILES);assert.equal(fs.readFileSync(path.join(directory,'keep.txt'),'utf8'),'keep');
  log.start(100);for(let i=0;i<2500;i++)log.event('stage',{message:'가'.repeat(500)});
  const latest=fs.readdirSync(directory).find(f=>f.endsWith('-100.jsonl'));const text=fs.readFileSync(path.join(directory,latest),'utf8');assert.ok(Buffer.byteLength(text)<MAX_BYTES+500);assert.ok(text.includes('log-limit'));
});
test('filesystem failures report diagnostics without aborting booking work',()=>{
  const warnings=[],log=createRunLog({directory:'fixture',io:{mkdirSync(){throw Error('denied');}},onError:m=>warnings.push(m)});
  assert.doesNotThrow(()=>{log.start(1);log.event('stage');log.finish({id:1,durationMs:0});});assert.equal(log.failed,true);assert.equal(warnings.length,1);
});
