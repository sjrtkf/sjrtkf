'use strict';
// Self-contained content-script functions for human-entered text only.
// No recognition, model, authentication request, polling, or retry is performed.
function manualCaptchaPrepare(arg){
  if(!window.__ticketManualCaptchaPage){
    const state={current:null,sequence:0,documentKey:crypto.randomUUID(),generation:0};
    const shown=e=>{if(!e||!e.isConnected)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.display!=='none'&&s.opacity!=='0';};
    const enabled=e=>shown(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
    const fail=(status,message,extra={})=>({present:true,supported:false,status,message,...extra});
    const locate=()=>{
      const u=new URL(location.href),modern=u.origin==='https://tickets.interpark.com'&&/^\/onestop(?:\/|$)/.test(u.pathname),legacy=u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname);
      if(!modern&&!legacy)return {result:{present:false,supported:false,status:'unsupported',message:'직접 입력 도움은 NOL 예매창에서만 지원합니다.'}};
      if([...document.querySelectorAll('[class*="ModalCaptchaSlider_layerWrap__"],.captchSliderLayer,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')].some(shown))return {result:fail('unsupported','문자 이미지 이외의 인증은 해당 화면에서 직접 진행해 주세요.')};
      const images=[...new Set(document.querySelectorAll(modern?'img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"] img':'#imgCaptcha'))].filter(shown);
      if(!images.length)return {result:{present:false,supported:true,status:'absent',message:'보안문자 창이 보이지 않습니다.'}};
      if(images.length!==1)return {result:fail('unsupported','보안문자 이미지가 여러 개여서 입력 대상을 정할 수 없습니다.')};
      const image=images[0];let container=image.parentElement,inputs=[],buttons=[];
      while(container&&container!==document.body){
        inputs=[...container.querySelectorAll(legacy?'input#txtCaptcha':'input')].filter(e=>shown(e)&&['text',''].includes(String(e.type||'').toLowerCase()));
        buttons=[...container.querySelectorAll(legacy?'.capchaBtns a,.capchaBtns button':'button')].filter(e=>shown(e)&&e.textContent.replace(/\s+/g,'').trim()==='입력완료');
        if(inputs.length===1&&buttons.length===1)break;
        container=container.parentElement;
      }
      if(!container||container===document.body||inputs.length!==1||buttons.length!==1)return {result:fail('unsupported','이미지와 입력칸·입력완료 버튼 한 쌍을 확인하지 못했습니다.')};
      const input=inputs[0],button=buttons[0];
      if(input.disabled||input.readOnly)return {result:fail('unsupported','보안문자 입력칸을 사용할 수 없습니다.')};
      if(!image.complete||!image.naturalWidth||!image.naturalHeight)return {result:fail('pending','보안문자 이미지가 로딩 중입니다.')};
      if(image.naturalWidth>1600||image.naturalHeight>1000)return {result:fail('unsupported','보안문자 이미지 크기를 확인해 주세요.')};
      return {image,input,button,container,adapter:modern?'onestop':'legacy'};
    };
    const readImage=image=>{
      const src=image.currentSrc||image.src||'';
      if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(src)&&src.length<=2000000)return src;
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');if(!context)throw Error('canvas');context.drawImage(image,0,0);
      const value=canvas.toDataURL('image/png');if(value.length>2000000)throw Error('size');return value;
    };
    const sameDom=(a,b)=>a&&a.image===b.image&&a.input===b.input&&a.button===b.button&&a.container===b.container;
    const inspect=({includeImage=false,expected,renewCancelled=false}={})=>{
      const found=locate();if(found.result)return found.result;
      let data;try{data=readImage(found.image);}catch{return fail('unsupported','이미지를 표시할 수 없습니다. 예매 화면에서 직접 입력해 주세요.');}
      let current=state.current;
      if(!sameDom(current,found)||current.data!==data||(renewCancelled&&current.cancelled)){
        const keepTouched=current?.input===found.input&&current.data===data&&current.manualTouched;
        if(current){current.input.removeEventListener('input',current.remember);current.input.removeEventListener('change',current.remember);}
        current=state.current={...found,data,id:state.documentKey+':'+(++state.sequence),submitted:false,locked:false,cancelled:false,focusAttempted:false,manualTouched:!!keepTouched};
        current.remember=e=>{if(e.isTrusted&&state.current===current)current.manualTouched=true;};
        current.input.addEventListener('input',current.remember);current.input.addEventListener('change',current.remember);
      }
      const existingText=String(found.input.value||'');
      const status=expected&&expected!==current.id?'changed':current.cancelled?'cancelled':current.submitted?'submitted':current.locked?'pending':current.manualTouched||existingText?'manual':'ready';
      return {present:true,supported:true,status,challengeId:current.id,existingText,adapter:found.adapter,submitEnabled:enabled(found.button),message:status==='manual'?'예매창에 직접 입력한 내용은 덮어쓰지 않습니다.':status==='changed'?'이미지 또는 입력 화면이 바뀌었습니다. 다시 확인해 주세요.':status==='submitted'?'입력완료 버튼을 한 번 눌렀습니다. 실제 인증 결과는 예매창에서 확인해 주세요.':status==='cancelled'?'입력 전달을 취소했습니다.':'이미지를 보고 직접 입력해 주세요.',...(includeImage?{imageDataUrl:data}:{}),imageWidth:found.image.naturalWidth,imageHeight:found.image.naturalHeight};
    };
    const editable=e=>e&&(e.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(String(e.tagName||'').toUpperCase())||e.getAttribute?.('contenteditable')==='true');
    const prepare=options=>{
      const result=inspect({includeImage:true,renewCancelled:true});result.focused=false;
      const current=state.current;
      if(options?.focus===true&&result.supported&&result.present&&current&&!current.focusAttempted){
        // Even a skipped first attempt is remembered: background refreshes must
        // never steal focus after the user leaves another editable field.
        current.focusAttempted=true;
        const active=document.activeElement;
        if(result.status==='ready'&&(!editable(active)||active===current.input)){
          try{current.input.focus({preventScroll:true});result.focused=document.activeElement===current.input;}catch{}
        }
      }
      return result;
    };
    const submit=async options=>{
      if(typeof options?.challengeId!=='string'||typeof options?.text!=='string'||!/^[A-Z]{6}$/.test(options.text))return {submitted:false,status:'unsupported',message:'직접 작성한 영문 대문자 6자리와 현재 이미지 확인 정보가 필요합니다.'};
      const before=inspect({expected:options.challengeId});
      if(!before.supported||before.status!=='ready')return {...before,submitted:false};
      const current=state.current,generation=state.generation;
      current.locked=true;
      const stop=(status,message)=>({submitted:false,status,challengeId:current.id,message});
      try{
        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
        if(!setter)return stop('unsupported','입력칸에 값을 전달할 수 없습니다. 예매창에서 직접 입력해 주세요.');
        setter.call(current.input,options.text);
        siteInvoke(current.input,'change',options.text);
        // One bounded event/microtask turn lets a controlled input update its
        // button. There is no timer, observer, polling, or delayed retry.
        await Promise.resolve();
        if(current.cancelled||state.generation!==generation)return stop('cancelled','입력 전달을 취소하여 확인 버튼을 누르지 않았습니다.');
        const found=locate();if(found.result)return {...found.result,submitted:false};
        let data;try{data=readImage(found.image);}catch{return stop('unsupported','이미지를 다시 확인할 수 없어 확인 버튼을 누르지 않았습니다.');}
        if(state.current!==current||!sameDom(current,found)||data!==current.data)return stop('changed','이미지 또는 입력 화면이 바뀌어 확인 버튼을 누르지 않았습니다.');
        if(current.manualTouched||String(found.input.value)!==options.text)return stop('manual','다른 입력이 감지되어 확인 버튼을 누르지 않았습니다.');
        if(!enabled(found.button))return stop('disabled','입력완료 버튼이 아직 비활성 상태입니다. 예매창에서 직접 확인해 주세요.');
        current.submitted=true;
        siteInvoke(found.button);
        return {submitted:true,status:'submitted',challengeId:current.id,message:'직접 작성한 문자를 전달하고 입력완료 버튼을 한 번 눌렀습니다. 실제 인증 결과는 예매창에서 확인해 주세요.'};
      }catch{return stop('unsupported','입력 전달 중 오류가 발생했습니다. 예매창의 내용을 확인해 주세요.');}
      finally{current.locked=false;}
    };
    const cancel=()=>{state.generation++;if(state.current)state.current.cancelled=true;return {cancelled:true};};
    window.__ticketManualCaptchaPage={prepare,submit,cancel};
  }
  return window.__ticketManualCaptchaPage.prepare(arg);
}
function manualCaptchaSubmit(arg){return window.__ticketManualCaptchaPage?.submit(arg)||{submitted:false,status:'changed',message:'이미지를 먼저 확인해 주세요.'};}
function manualCaptchaCancel(){return window.__ticketManualCaptchaPage?.cancel()||{cancelled:true};}
module.exports={manualCaptchaPrepare,manualCaptchaSubmit,manualCaptchaCancel};
