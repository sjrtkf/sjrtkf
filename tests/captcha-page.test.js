'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const captcha=require('../src/captcha-page');
function fixture({legacy=false,visible=true,duplicate=false,other=false,source='data:image/png;base64,QUJD',canvasError=false}={}){
  let clicks=0,observer,timeout;const listeners=new Map();
  class Element{
    constructor(){this.isConnected=true;this.hidden=false;this.parentElement=null;this.disabled=false;this.attributes={};this.textContent='';}
    getBoundingClientRect(){return {width:this.hidden?0:200,height:this.hidden?0:60};}
    getAttribute(name){return this.attributes[name]??null;}
    addEventListener(type,fn){const handlers=listeners.get(this)||{};(handlers[type]??=[]).push(fn);listeners.set(this,handlers);}
    dispatchEvent(event){for(const fn of listeners.get(this)?.[event.type]||[])fn(event);return true;}
  }
  class Input extends Element{constructor(){super();this.type='text';this._value='';}get value(){return this._value;}set value(v){this._value=v;}}
  const body=new Element(),image=new Element(),input=new Input(),button=new Element(),container=new Element(),error=new Element();
  image.src=source;image.complete=true;image.naturalWidth=240;image.naturalHeight=80;image.hidden=!visible;
  image.parentElement=input.parentElement=button.parentElement=container;container.parentElement=body;
  button.textContent='입력완료';button.click=()=>{clicks++;};
  container.querySelectorAll=selector=>selector.startsWith('input')?[input]:selector==='button'||selector.startsWith('.capchaBtns')?[button]:selector==='.alertNotice'||selector.includes('captchaError')?[error]:[];
  const document={body,querySelectorAll(selector){if(selector.startsWith('img[alt=')||selector==='#imgCaptcha')return duplicate?[image,image2]:[image];if(selector.includes('ModalCaptchaSlider'))return other?[new Element()]:[];return [];},createElement(tag){assert.equal(tag,'canvas');return {getContext:()=>({drawImage(){if(canvasError)throw Error('tainted');}}),toDataURL:()=>source};}};
  const image2=Object.assign(new Element(),image);
  const context=vm.createContext({window:{},document,location:{href:legacy?'https://ticket.interpark.com/Book/BookSeat.asp?session=private':'https://tickets.interpark.com/onestop/seat'},crypto:{randomUUID:()=> 'fixture-document'},URL,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;this.isTrusted=false;}},getComputedStyle:e=>({display:e.hidden?'none':'block',visibility:'visible'}),setTimeout(fn){timeout=fn;return 1;},clearTimeout(){timeout=null;},MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){observer=null;}}});
  const run=(fn,arg)=>vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context);
  return {context,image,input,button,error,run,clicks:()=>clicks,notify:()=>observer?.(),expire:()=>timeout?.(),setSource(value){image.src=source=value;}};
}

test('captcha snapshot reads only the visible supported image and does not submit',()=>{
  const f=fixture(),s=f.run(captcha.captchaSnapshot);assert.equal(s.status,'ready');assert.equal(s.imageDataUrl,'data:image/png;base64,QUJD');assert.equal(s.adapter,'onestop');assert.equal(s.existingText,'');assert.equal(f.clicks(),0);assert.equal(JSON.stringify(s).includes('session'),false);
});
test('captcha is absent without installing a timer and slider is explicitly unsupported',()=>{
  const f=fixture({visible:false});f.context.setTimeout=()=>{throw Error('must not wait');};assert.equal(f.run(captcha.captchaSnapshot).status,'absent');
  const slider=fixture({visible:false,other:true});assert.equal(slider.run(captcha.captchaSnapshot).status,'unsupported');
});
test('captcha submits exactly one time through the native setter and page button',async()=>{
  const f=fixture(),s=f.run(captcha.captchaSnapshot),events=[];f.input.addEventListener('input',e=>events.push(e.type));f.input.addEventListener('change',e=>events.push(e.type));
  const result=await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'});assert.equal(result.submitted,true);assert.equal(f.input.value,'ABCDEF');assert.deepEqual(events,['input','change']);assert.equal(f.clicks(),1);
  assert.equal((await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'})).submitted,false);assert.equal(f.clicks(),1);assert.equal(f.run(captcha.captchaStatus,{challengeId:s.challengeId}).status,'submitted');
});
test('captcha old image, invalid code and previous document tokens never submit',async()=>{
  const f=fixture(),s=f.run(captcha.captchaSnapshot);f.setSource('data:image/png;base64,REVG');
  assert.equal((await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'})).status,'changed');
  assert.equal((await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'abc'})).status,'unsupported');
  const fresh=fixture();assert.equal((await fresh.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'})).status,'changed');assert.equal(f.clicks()+fresh.clicks(),0);
});
test('captcha protects existing and newly typed manual text including an erased value',async()=>{
  const f=fixture();f.input.value='USER';const s=f.run(captcha.captchaSnapshot);assert.equal(s.status,'manual');assert.equal((await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'})).submitted,false);assert.equal(f.input.value,'USER');
  const g=fixture(),g0=g.run(captcha.captchaSnapshot);g.input.value='';g.input.dispatchEvent({type:'input',isTrusted:true});assert.equal((await g.run(captcha.captchaSubmit,{challengeId:g0.challengeId,text:'ABCDEF'})).status,'manual');assert.equal(g.clicks(),0);
});
test('captcha disabled confirmation waits for DOM activation without polling sleeps',async()=>{
  const f=fixture(),s=f.run(captcha.captchaSnapshot);f.button.disabled=true;
  const pending=f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'});assert.equal(f.clicks(),0);f.button.disabled=false;f.notify();assert.equal((await pending).submitted,true);assert.equal(f.clicks(),1);
});
test('captcha pending confirmation stops on cancellation, manual typing, image change or timeout',async()=>{
  for(const reason of ['cancel','manual','image','timeout']){
    const f=fixture(),s=f.run(captcha.captchaSnapshot);f.button.disabled=true;const pending=f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'});
    if(reason==='cancel')f.run(captcha.captchaCancel);
    if(reason==='manual')f.input.dispatchEvent({type:'input',isTrusted:true});
    if(reason==='image'){f.setSource('data:image/png;base64,REVG');f.notify();}
    if(reason==='timeout')f.expire();
    assert.equal((await pending).submitted,false,reason);f.button.disabled=false;f.notify();assert.equal(f.clicks(),0,reason);
  }
});
test('captcha result distinguishes visible failure and disappearance without asserting payment success',async()=>{
  const f=fixture(),s=f.run(captcha.captchaSnapshot);await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'});f.error.textContent='보안문자가 일치하지 않습니다.';
  assert.equal(f.run(captcha.captchaStatus,{challengeId:s.challengeId}).status,'incorrect');f.image.hidden=true;assert.equal(f.run(captcha.captchaStatus,{challengeId:s.challengeId}).status,'absent');
});
test('captcha ambiguous, unloaded, tainted and disabled input cases do not expose a usable image',()=>{
  const fixtures=[fixture({duplicate:true}),fixture({source:'https://cdn.example/image.png',canvasError:true})];
  const loading=fixture();loading.image.complete=false;fixtures.push(loading);const disabled=fixture();disabled.input.disabled=true;fixtures.push(disabled);
  for(const f of fixtures){const s=f.run(captcha.captchaSnapshot);assert.equal(s.supported,false);assert.equal(s.imageDataUrl,undefined);assert.equal(f.clicks(),0);}
});
test('legacy uses the locally evidenced imgCaptcha/txtCaptcha/capchaBtns controls',async()=>{
  const f=fixture({legacy:true}),s=f.run(captcha.captchaSnapshot);assert.equal(s.adapter,'legacy');assert.equal((await f.run(captcha.captchaSubmit,{challengeId:s.challengeId,text:'ABCDEF'})).submitted,true);assert.equal(f.clicks(),1);
  const hidden=fixture({legacy:true});hidden.input.hidden=true;assert.equal(hidden.run(captcha.captchaSnapshot).status,'unsupported');assert.equal(hidden.clicks(),0);
});
test('captcha page functions reject unrelated websites despite copied selectors',()=>{
  const f=fixture();f.context.location.href='https://example.com/onestop/seat';assert.equal(f.run(captcha.captchaSnapshot).status,'unsupported');assert.equal(f.clicks(),0);
});
