'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const manual=require('../src/manual-captcha-page');
function fixture({legacy=false,visible=true,duplicate=false,other=false,source='data:image/png;base64,QUJD',canvasError=false}={}){
  let clicks=0,focuses=0;const listeners=new Map();let document;
  class Element{
    constructor(tagName='DIV'){this.tagName=tagName;this.isConnected=true;this.hidden=false;this.parentElement=null;this.disabled=false;this.attributes={};this.textContent='';}
    getBoundingClientRect(){return {width:this.hidden?0:200,height:this.hidden?0:60};}
    getAttribute(name){return this.attributes[name]??null;}
    addEventListener(type,fn){const handlers=listeners.get(this)||{};(handlers[type]??=[]).push(fn);listeners.set(this,handlers);}
    removeEventListener(type,fn){const handlers=listeners.get(this)||{};handlers[type]=(handlers[type]||[]).filter(value=>value!==fn);}
    dispatchEvent(event){for(const fn of listeners.get(this)?.[event.type]||[])fn(event);return true;}
    focus(){focuses++;document.activeElement=this;}
  }
  class Input extends Element{constructor(){super('INPUT');this.type='text';this._value='';}get value(){return this._value;}set value(v){this._value=v;}}
  const body=new Element('BODY'),container=new Element(),outside=new Input();
  let image=new Element('IMG'),input=new Input(),button=new Element('BUTTON');
  image.src=source;image.complete=true;image.naturalWidth=210;image.naturalHeight=70;image.hidden=!visible;
  image.parentElement=input.parentElement=button.parentElement=container;container.parentElement=body;
  button.textContent='입력완료';button.click=()=>{clicks++;};
  container.querySelectorAll=selector=>selector.startsWith('input')?[input]:selector==='button'||selector.startsWith('.capchaBtns')?[button]:[];
  document={body,activeElement:body,querySelectorAll(selector){if(selector.startsWith('img[alt=')||selector==='#imgCaptcha')return duplicate?[image,Object.assign(new Element('IMG'),image)]:[image];if(selector.includes('ModalCaptchaSlider'))return other?[new Element()]:[];return [];},createElement(tag){assert.equal(tag,'canvas');return {getContext:()=>({drawImage(){if(canvasError)throw Error('tainted');}}),toDataURL:()=>source};}};
  const context=vm.createContext({window:{},document,location:{href:legacy?'https://ticket.interpark.com/Book/BookSeat.asp?session=private':'https://tickets.interpark.com/onestop/seat'},crypto:{randomUUID:()=> 'manual-fixture-document'},URL,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;this.isTrusted=false;}},getComputedStyle:e=>({display:e.hidden?'none':'block',visibility:'visible',opacity:'1'}),setTimeout(){throw Error('No waiting timers allowed');},MutationObserver:class{constructor(){throw Error('No observers allowed');}}});
  const run=(fn,arg)=>vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context);
  return {context,document,container,outside,get image(){return image;},get input(){return input;},get button(){return button;},run,clicks:()=>clicks,focuses:()=>focuses,setSource(value){image.src=source=value;},replace(kind){if(kind==='button'){button=Object.assign(new Element('BUTTON'),button);}if(kind==='input'){input=Object.assign(new Input(),input);}if(kind==='image'){image=Object.assign(new Element('IMG'),image);}}};
}
const prepare=(f,arg)=>f.run(manual.manualCaptchaPrepare,arg);
const submit=(f,s,text='ABCDEF')=>f.run(manual.manualCaptchaSubmit,{challengeId:s.challengeId,text});

test('manual preparation displays the supported image without recognition or submission',()=>{
  const f=fixture(),s=prepare(f);assert.equal(s.status,'ready');assert.equal(s.imageDataUrl,'data:image/png;base64,QUJD');assert.equal(s.existingText,'');assert.equal(s.adapter,'onestop');assert.equal(s.focused,false);assert.equal(f.clicks(),0);assert.equal(JSON.stringify(s).includes('session'),false);
});
test('manual focus is attempted only once per challenge and never reclaims focus',()=>{
  const f=fixture();assert.equal(prepare(f,{focus:true}).focused,true);assert.equal(f.focuses(),1);f.document.activeElement=f.outside;
  assert.equal(prepare(f,{focus:true}).focused,false);assert.equal(f.document.activeElement,f.outside);assert.equal(f.focuses(),1);
});
test('non-focusing frame discovery keeps a stable token and allows the first explicit focus',()=>{
  const f=fixture(),first=prepare(f,{focus:false}),second=prepare(f,{focus:false});
  assert.equal(first.challengeId,second.challengeId);assert.equal(f.focuses(),0);
  const focused=prepare(f,{focus:true});assert.equal(focused.challengeId,first.challengeId);assert.equal(focused.focused,true);assert.equal(f.focuses(),1);
});
test('another editable field or existing captcha text prevents even a later repeated focus attempt',()=>{
  for(const mode of ['other-field','existing-text']){
    const f=fixture();if(mode==='other-field')f.document.activeElement=f.outside;else f.input.value='USER';
    assert.equal(prepare(f,{focus:true}).focused,false);f.document.activeElement=f.document.body;f.input.value='';
    assert.equal(prepare(f,{focus:true}).focused,false);assert.equal(f.focuses(),0);
  }
});
test('human text is delivered once using native input events and one immediate confirmation',async()=>{
  const f=fixture(),s=prepare(f),events=[];f.input.addEventListener('input',e=>events.push(e.type));f.input.addEventListener('change',e=>events.push(e.type));
  const result=await submit(f,s);assert.equal(result.submitted,true);assert.equal(f.input.value,'ABCDEF');assert.deepEqual(events,['input','change']);assert.equal(f.clicks(),1);
  assert.equal((await submit(f,s)).submitted,false);assert.equal(f.clicks(),1);
});
test('stale image, replaced DOM controls and absent preparation reject submission',async()=>{
  for(const kind of ['source','image','input','button']){
    const f=fixture(),s=prepare(f);if(kind==='source')f.setSource('data:image/png;base64,REVG');else f.replace(kind);
    assert.equal((await submit(f,s)).status,'changed',kind);assert.equal(f.input.value,'');assert.equal(f.clicks(),0);
  }
  const fresh=fixture();assert.equal((await submit(fresh,{challengeId:'previous:1'})).status,'changed');assert.equal(fresh.clicks(),0);
});
test('existing text and trusted typing including erased text are preserved',async()=>{
  const f=fixture();f.input.value='USER';const s=prepare(f);assert.equal((await submit(f,s)).status,'manual');assert.equal(f.input.value,'USER');
  const g=fixture(),g0=prepare(g);g.input.dispatchEvent({type:'input',isTrusted:true});assert.equal((await submit(g,g0)).status,'manual');assert.equal(g.input.value,'');assert.equal(g.clicks(),0);
});
test('a new displayed image gets a new token while old manual text remains protected',async()=>{
  const f=fixture(),first=prepare(f);f.input.dispatchEvent({type:'input',isTrusted:true});f.setSource('data:image/png;base64,REVG');
  const next=prepare(f);assert.notEqual(next.challengeId,first.challengeId);assert.equal(next.status,'ready');
  assert.equal((await submit(f,first)).status,'changed');f.input.value='USER';assert.equal((await submit(f,next)).status,'manual');assert.equal(f.input.value,'USER');assert.equal(f.clicks(),0);
});
test('disabled confirmation returns without timers, waiting or later automatic clicks',async()=>{
  const f=fixture(),s=prepare(f);f.button.disabled=true;
  assert.equal((await submit(f,s)).status,'disabled');assert.equal(f.clicks(),0);f.button.disabled=false;
  await Promise.resolve();assert.equal(f.clicks(),0);assert.equal(f.input.value,'ABCDEF');
});
test('a controlled button may enable during the one input-event microtask',async()=>{
  const f=fixture(),s=prepare(f);f.button.disabled=true;
  f.input.addEventListener('input',()=>{Promise.resolve().then(()=>{f.button.disabled=false;});});
  assert.equal((await submit(f,s)).submitted,true);assert.equal(f.clicks(),1);
});
test('changed image, replaced button, manual edit or cancellation during events prevent a click',async()=>{
  for(const reason of ['image','button','manual','cancel']){
    const f=fixture(),s=prepare(f);
    f.input.addEventListener('change',()=>{if(reason==='image')f.setSource('data:image/png;base64,REVG');if(reason==='button')f.replace('button');if(reason==='manual'){f.input.value='USER';f.input.dispatchEvent({type:'input',isTrusted:true});}if(reason==='cancel')f.run(manual.manualCaptchaCancel);});
    assert.equal((await submit(f,s)).submitted,false,reason);assert.equal(f.clicks(),0,reason);if(reason==='manual')assert.equal(f.input.value,'USER');
  }
});
test('concurrent submit and synchronous handler errors cannot cause a duplicate click',async()=>{
  const f=fixture(),s=prepare(f);const first=submit(f,s),second=submit(f,s);assert.equal((await second).submitted,false);assert.equal((await first).submitted,true);assert.equal(f.clicks(),1);
  const g=fixture(),g0=prepare(g);let calls=0;g.button.click=()=>{calls++;throw Error('site failure');};assert.equal((await submit(g,g0)).submitted,false);assert.equal((await submit(g,g0)).submitted,false);assert.equal(calls,1);
});
test('only six explicit uppercase letters are accepted without automatic rewriting',async()=>{
  for(const text of ['abcdef','ABCDE','ABCDEFG','ABC12D',' ABCDEF','ABCDEF ']){
    const f=fixture(),s=prepare(f);assert.equal((await submit(f,s,text)).status,'unsupported');assert.equal(f.input.value,'');assert.equal(f.clicks(),0);
  }
});
test('ambiguous, unsupported, hidden, unloaded and unreadable challenges are untouched',()=>{
  const cases=[fixture({duplicate:true}),fixture({other:true}),fixture({source:'https://cdn.example/img.png',canvasError:true})];
  const loading=fixture();loading.image.complete=false;cases.push(loading);const disabled=fixture();disabled.input.disabled=true;cases.push(disabled);
  for(const f of cases){const s=prepare(f,{focus:true});assert.equal(s.supported,false);assert.equal(s.imageDataUrl,undefined);assert.equal(f.clicks(),0);assert.equal(f.focuses(),0);}
  assert.equal(prepare(fixture({visible:false})).status,'absent');
  const unrelated=fixture();unrelated.context.location.href='https://example.com/onestop/seat';assert.equal(prepare(unrelated).status,'unsupported');
});
test('legacy uses the one evidenced image, input and confirmation pair',async()=>{
  const f=fixture({legacy:true}),s=prepare(f);assert.equal(s.adapter,'legacy');assert.equal((await submit(f,s)).submitted,true);assert.equal(f.clicks(),1);
});
