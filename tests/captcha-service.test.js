'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CaptchaService}=require('../src/captcha-service');
const png='data:image/png;base64,aGVsbG8=';
test('automatic retry refreshes low confidence, incorrect and disabled-submit images until verified',async()=>{
  let image=1,submits=0;const refreshed=[];
  const f=setup({ocr:{recognize:async()=>({valid:true,text:'WTCNBW',confidence:image===1?.1:.99})},adapter:{
    snapshot:async()=>({present:true,supported:true,challengeId:String(image),imageDataUrl:png}),
    submit:async()=>{submits++;return image===3?{submitted:false,status:'retry'}:{submitted:true};},
    refresh:async({challengeId})=>{refreshed.push(challengeId);image++;return {refreshed:true};},
    status:async({challengeId})=>challengeId!==String(image)?{status:'changed'}:image===2?{status:'incorrect'}:{status:'absent',supported:true}
  }});
  assert.equal((await f.execute('auto',{single:false})).status,'verified');
  assert.deepEqual(refreshed,['1','2','3']);assert.equal(submits,3);
});
test('automatic refresh stops when cancelled and never refreshes a manual edit or uncertain request',async()=>{
  const f=setup({ocr:{recognize:async()=>({valid:false})},adapter:{refresh:async()=>{f.service.cancel();return {refreshed:true};}}});
  await assert.rejects(f.execute('auto',{single:false}),/중지/);
  for(const status of ['manual','submitted']){
    let refreshed=0;const g=setup({adapter:{status:async()=>({present:true,status}),refresh:async()=>{refreshed++;}}});
    const result=await g.execute('auto',{single:false});assert.ok(['manual','uncertain'].includes(result.status));assert.equal(refreshed,0);
  }
});
function setup(overrides={}){
  const calls=[],states=[];let time=0;
  const ocr={warmup:async()=>calls.push('warmup'),recognize:async()=>{calls.push('recognize');return {valid:true,text:'WTCNBW',confidence:.99};},close:async()=>calls.push('close'),...overrides.ocr};
  const adapter={assertCurrent(){},snapshot:async()=>{calls.push('snapshot');return {present:true,supported:true,challengeId:'a',imageDataUrl:png,existingText:''};},submit:async arg=>{calls.push(['submit',arg]);return {submitted:true};},status:async()=>{calls.push('status');return {present:false,status:'absent'};},...overrides.adapter};
  const service=new CaptchaService({ocr,onState:s=>states.push(s),now:()=>time,wait:async ms=>{calls.push(['wait',ms]);time+=ms;},resultTimeoutMs:200,...overrides.options});
  const execute=(mode='submit',extra={})=>service.execute({mode,adapter,scope:'tab:document',single:true,...extra});
  return {calls,states,service,adapter,execute};
}
test('OCR reads and submits immediately, then confirms the captcha disappeared',async()=>{
  const {execute,calls,service}=setup();const result=await execute();
  assert.equal(result.status,'verified');assert.deepEqual(calls,['snapshot','warmup','recognize',['submit',{challengeId:'a',text:'WTCNBW'}],'status']);assert.equal(service.status.busy,false);
});
test('read-only CAPTCHA test never inputs or submits',async()=>{
  const {execute,calls}=setup();assert.equal((await execute('read')).text,'WTCNBW');assert.equal(calls.includes('status'),false);assert.equal(calls.some(c=>Array.isArray(c)),false);
});
test('absent or unsupported CAPTCHA never invokes OCR or submits',async()=>{
  for(const snapshot of [{present:false},{present:true,supported:false,message:'fixture unsupported'}]){
    const {execute,calls}=setup({adapter:{snapshot:async()=>snapshot}});const result=await execute();assert.equal(result.status,snapshot.present?'manual':'absent');assert.deepEqual(calls,[]);
  }
});
test('existing manual text is protected, but can be inspected with read-only',async()=>{
  const {execute,calls}=setup({adapter:{snapshot:async()=>({present:true,supported:true,challengeId:'a',imageDataUrl:png,existingText:'ABC'})}});
  assert.equal((await execute()).status,'manual');assert.deepEqual(calls,[]);assert.equal((await execute('read')).status,'read');
});
test('invalid recognition and low confidence do not submit',async()=>{
  for(const result of [{valid:false,text:'ABCDEF',confidence:1},{valid:true,text:'ABCDEF',confidence:1},{valid:true,text:'WTCNBW',confidence:.2},{valid:true,text:'WTCNBW',confidence:NaN}]){
    const {execute,calls}=setup({ocr:{recognize:async()=>result}});assert.equal((await execute()).status,'manual');assert.equal(calls.some(c=>Array.isArray(c)&&c[0]==='submit'),false);
  }
});
test('repeated auto loops never recognize or submit an already attempted challenge',async()=>{
  const {execute,calls}=setup({adapter:{status:async()=>({present:true,status:'incorrect',message:'wrong'})}});
  await execute('auto');await execute('auto');assert.equal(calls.filter(c=>c==='recognize').length,1);assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==='submit').length,1);
});
test('an uncertain lost submit response is not replayed by auto loop',async()=>{
  let count=0;const {execute}=setup({adapter:{submit:async()=>{count++;throw Error('lost reply');}}});
  await assert.rejects(execute('auto'),/lost reply/);assert.equal((await execute('auto')).status,'uncertain');assert.equal(count,1);
});
test('changed challenge permits another attempt but total auto attempts are bounded',async()=>{
  let challenge=0;const {execute,calls}=setup({options:{maxAutoAttempts:3},adapter:{snapshot:async()=>({present:true,supported:true,challengeId:String(++challenge),imageDataUrl:png}),status:async()=>({present:true,status:'changed'})}});
  for(let i=0;i<3;i++)assert.equal((await execute('auto')).status,'changed');assert.equal((await execute('auto')).status,'manual');assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==='submit').length,3);
});
test('submit stale/manual protection errors are exposed without a verification claim',async()=>{
  const {execute,calls}=setup({adapter:{submit:async()=>({submitted:false,status:'changed',message:'changed before submit'})}});
  const result=await execute();assert.equal(result.status,'manual');assert.match(result.message,/changed/);assert.equal(calls.includes('status'),false);
});
test('cancel during OCR prevents input and clears busy state',async()=>{
  let release;const {execute,service,calls}=setup({ocr:{recognize:()=>new Promise(r=>release=r)}});
  const task=execute();await new Promise(r=>setImmediate(r));service.cancel();release({valid:true,text:'WTCNBW',confidence:1});await assert.rejects(task,/중지/);assert.equal(calls.some(c=>Array.isArray(c)&&c[0]==='submit'),false);assert.equal(service.status.busy,false);
});
test('scope change during inference prevents submitting to a new page',async()=>{
  let changed=false;const {execute,calls}=setup({adapter:{assertCurrent:()=>{if(changed)throw Error('new document');}},ocr:{recognize:async()=>{changed=true;return {valid:true,text:'WTCNBW',confidence:1};}}});
  await assert.rejects(execute(),/new document/);assert.equal(calls.some(c=>Array.isArray(c)&&c[0]==='submit'),false);
});
test('result timeout does not resubmit and reports uncertain',async()=>{
  const {execute,calls}=setup({adapter:{status:async()=>({present:true,status:'submitted'})}});assert.equal((await execute()).status,'uncertain');assert.equal(calls.filter(c=>Array.isArray(c)&&c[0]==='submit').length,1);
});
test('disappeared iframe or lost page context is a changed challenge, never verification',async()=>{
  const {execute}=setup({adapter:{status:async()=>({present:false,supported:false,status:'changed'})}});assert.equal((await execute()).status,'changed');
});
test('overlapping test requests are rejected while recognition is in flight',async()=>{
  let release;const {execute}=setup({ocr:{recognize:()=>new Promise(r=>release=r)}});const first=execute('read');await new Promise(r=>setImmediate(r));await assert.rejects(execute(),/진행 중/);release({valid:true,text:'WTCNBW',confidence:1});await first;
});
test('external abort and closing stop pending processing; warmup errors remain visible',async()=>{
  const {service,execute,calls}=setup({ocr:{warmup:async()=>{throw Error('missing worker');}}});assert.equal(await service.warmup(),false);assert.equal(service.status.available,false);assert.match(service.status.message,/missing worker/);
  const controller=new AbortController();controller.abort();await assert.rejects(execute('submit',{signal:controller.signal}),/중지/);await service.close();assert.ok(calls.includes('close'));
});

test('image errors show a failed state with preview and a later successful read clears it',async()=>{
  let fail=true;
  const {service,execute,calls}=setup({ocr:{recognize:async()=>{
    if(fail)throw Object.assign(Error('이미지 파일을 열지 못했습니다.'),{code:'IMAGE_DECODE_FAILED'});
    return {valid:true,text:'WTCNBW',confidence:.99};
  }}});
  await assert.rejects(execute('read'),{code:'IMAGE_DECODE_FAILED'});
  assert.equal(service.status.errorCode,'IMAGE_DECODE_FAILED');
  assert.equal(service.status.ready,true);
  assert.equal(service.status.busy,false);
  assert.equal(service.status.previewDataUrl,png);
  assert.equal(calls.some(c=>Array.isArray(c)&&c[0]==='submit'),false);
  fail=false;assert.equal((await execute('read')).status,'read');
  assert.equal(service.status.errorCode,null);
});

test('browser image read failure refreshes without passing unusable data to OCR',async()=>{let image=0,refreshes=0,reads=0;const f=setup({ocr:{recognize:async()=>{reads++;return {valid:true,text:'WTCNBW',confidence:.99};}},adapter:{snapshot:async()=>image?{present:true,supported:true,challengeId:'new',imageDataUrl:png}:{present:true,supported:true,status:'retry',challengeId:'bad',message:'image unreadable'},refresh:async()=>{image++;refreshes++;return {status:'changed'};}}});assert.equal((await f.execute('auto',{single:false})).status,'verified');assert.equal(refreshes,1);assert.equal(reads,1);});
test('temporarily disabled refresh waits, sends once, and accepts popup disappearance',async()=>{let calls=0;const f=setup({ocr:{recognize:async()=>({valid:false})},adapter:{refresh:async()=>++calls===1?{status:'pending',refreshed:false}:{refreshed:true},status:async()=>({status:'absent',supported:true})}});assert.equal((await f.execute('auto',{single:false})).status,'absent');assert.equal(calls,2);});

test('automatic CAPTCHA waits for image readiness and then recognizes without a manual mode',async()=>{
  let reads=0;const f=setup({adapter:{snapshot:async()=>++reads<3?{present:true,status:'pending',supported:true}:{present:true,supported:true,challengeId:'ready',imageDataUrl:png}}});
  assert.equal((await f.execute('auto',{single:false})).status,'verified');assert.equal(f.calls.filter(c=>c==='recognize').length,1);
});
test('an indefinitely pending CAPTCHA ends with a precise readiness error and no input',async()=>{
  const f=setup({adapter:{snapshot:async()=>({present:true,status:'pending',supported:true})}});
  const result=await f.execute('auto',{single:false});assert.equal(result.status,'uncertain');assert.match(result.message,/준비가 지연/);assert.equal(f.calls.some(c=>c==='recognize'||Array.isArray(c)&&c[0]==='submit'),false);
});
