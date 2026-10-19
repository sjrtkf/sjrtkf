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

test('seat diagnostics retain rejection counts and bounded grade reasons but exclude arbitrary payloads',()=>{
  const result=safeDetail({cycle:3,planCount:0,reason:'inventory-empty',missingRowCount:2,grades:[{name:'일반석',code:'1',count:0,eligible:false,reasons:['inventory-empty'],body:'private'}, {name:'unknown',count:'token=hidden',reasons:['token=hidden']}],preferences:{autoNotice:true,fallbackAnywhere:true,excludeRestricted:false,priority:'front'},body:'private'});
  assert.equal(result.grades[0].count,0);assert.equal(result.grades[1].count,null);
  assert.equal(result.missingRowCount,2);assert.equal(result.preferences.autoNotice,true);
  assert.equal(result.preferences.fallbackAnywhere,true);assert.equal(result.preferences.excludeRestricted,false);assert.equal(result.preferences.priority,'front');
  assert.doesNotMatch(JSON.stringify(result),/private|hidden/);
  assert.equal(safeDetail({grades:Array.from({length:100},()=>({name:'grade'}))}).grades.length,60);
});
test('rotation and per-run size are bounded without deleting unrelated files',t=>{
  const directory=fixture(t),log=createRunLog({directory});fs.writeFileSync(path.join(directory,'keep.txt'),'keep');
  for(let i=1;i<=MAX_FILES+5;i++){log.start(i);log.finish({id:i,durationMs:0});}
  assert.equal(fs.readdirSync(directory).filter(f=>f.endsWith('.jsonl')).length,MAX_FILES);assert.equal(fs.readFileSync(path.join(directory,'keep.txt'),'utf8'),'keep');
  log.start(100);for(let i=0;i<2500;i++)log.event('stage',{message:'가'.repeat(500)});
  const latest=fs.readdirSync(directory).find(f=>f.endsWith('-100.jsonl'));const text=fs.readFileSync(path.join(directory,latest),'utf8');assert.ok(Buffer.byteLength(text)<MAX_BYTES+500);assert.ok(text.includes('log-limit'));
});

test('seat format diagnostics keep bounded labels and flags without session or raw response fields',()=>{
  const row={grade:'휠체어장애인석',rawRowLabel:'휠체어석',rawSeatNumber:'W-1',rowIdx:0,colIdx:2,hasMetadata:true,domAvailable:true,exposable:false,grouped:true,reasons:['unsupported-row','non-exposable','grouped'],sessionId:'private',seatGroupId:'private',body:'private',raw:'private'};
  const result=safeDetail({missingMetadataCount:1,unsupportedRowCount:4,unsupportedNumberCount:4,nonExposableCount:3,groupedCount:2,seatSamples:[null,...Array.from({length:20},()=>row)],headers:{Cookie:'private'}});
  assert.equal(result.seatSamples.length,8);assert.equal(result.unsupportedRowCount,4);
  assert.deepEqual(result.seatSamples[0],{grade:'휠체어장애인석',rawRowLabel:'휠체어석',rawSeatNumber:'W-1',rowIdx:0,colIdx:2,hasMetadata:true,exposable:false,grouped:true,domAvailable:true,reasons:row.reasons});
  assert.doesNotMatch(JSON.stringify(result),/private|seatGroupId|sessionId|headers/);
  const limited=safeDetail({seatSamples:[{rawRowLabel:'가'.repeat(200),rawSeatNumber:'token=hidden',rowIdx:-1,colIdx:Infinity,grouped:'yes'}]}).seatSamples[0];
  assert.equal(limited.rawRowLabel.length,80);assert.doesNotMatch(JSON.stringify(limited),/hidden/);assert.equal('rowIdx' in limited,false);assert.equal('colIdx' in limited,false);assert.equal('grouped' in limited,false);
});
test('filesystem failures report diagnostics without aborting booking work',()=>{
  const warnings=[],log=createRunLog({directory:'fixture',io:{mkdirSync(){throw Error('denied');}},onError:m=>warnings.push(m)});
  assert.doesNotThrow(()=>{log.start(1);log.event('stage');log.finish({id:1,durationMs:0});});assert.equal(log.failed,true);assert.equal(warnings.length,1);
});
test('price assessment logs only bounded public choices and rejection reasons',()=>{
  const option={index:0,priceGrade:'01',pgCode:'00',priceGradeName:'일반',discountName:'예매가',amount:35000,eligible:true,reasons:[],sessionId:'private-session',member:{name:'private-name'},headers:{Cookie:'private-cookie'},body:'private-body'};
  const result=safeDetail({priceAssessment:{sessionId:'private-session',groups:[{seatGrade:'30',seatCount:1,selectedIndex:0,options:[option],priceRecords:'private-body'}]}});
  assert.deepEqual(result.priceAssessment,{groups:[{seatGrade:'30',seatCount:1,selectedIndex:0,options:[{index:0,priceGrade:'01',pgCode:'00',priceGradeName:'일반',discountName:'예매가',amount:35000,eligible:true,reasons:[]}]}]});
  assert.doesNotMatch(JSON.stringify(result),/private|member|headers|sessionId|body/);
  const dirty=safeDetail({priceAssessment:{groups:[{seatGrade:{secret:'private'},seatCount:-1,selectedIndex:-1,options:[{...option,priceGradeName:'가'.repeat(150),discountName:'token=hidden',amount:Infinity,eligible:'yes',reasons:['secret=hidden',...Array(20).fill('배'.repeat(150))]}]}]}}).priceAssessment.groups[0];
  assert.equal(dirty.seatGrade,null);assert.equal(dirty.seatCount,null);assert.equal(dirty.selectedIndex,null);
  assert.equal(dirty.options[0].priceGradeName.length,100);assert.equal(dirty.options[0].amount,null);assert.equal(dirty.options[0].eligible,false);assert.equal(dirty.options[0].reasons.length,8);
  assert.ok(dirty.options[0].reasons.every(reason=>reason.length<=100));assert.doesNotMatch(JSON.stringify(dirty),/hidden|private/);
});
test('price diagnostics sample at most eight groups and thirty options while retaining the selected original index',()=>{
  const options=Array.from({length:50},(_,index)=>({index,priceGrade:String(index),eligible:index===49}));
  const result=safeDetail({priceAssessment:{groups:Array.from({length:12},()=>({seatGrade:'1',seatCount:1,selectedIndex:49,options}))}});
  assert.equal(result.priceAssessment.groups.length,8);
  for(const group of result.priceAssessment.groups){assert.equal(group.options.length,30);assert.equal(group.selectedIndex,49);assert.equal(group.options.at(-1).index,49);}
});
