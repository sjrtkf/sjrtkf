'use strict';
// These functions are copied as static MV3 content-script code. They only read
// the displayed image and invoke the site's state/verification functions in
// the MAIN world. No DOM input or click events are emitted.
function captchaSnapshot(){
  if(!window.__bearsCaptchaPage||window.__bearsCaptchaPage.version!==3){
    window.__bearsCaptchaPage?.cancel();
    const state={current:null,sequence:0,documentKey:crypto.randomUUID(),cancelPending:null};
    const shown=e=>{if(!e||!e.isConnected)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const enabled=e=>shown(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
    const fail=(status,message,extra={})=>({present:true,supported:false,status,message,...extra});
    const locate=()=>{
      const u=new URL(location.href),modern=u.origin==='https://tickets.interpark.com'&&/^\/onestop(?:\/|$)/.test(u.pathname),legacy=u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname);
      if(!modern&&!legacy)return {result:{present:false,supported:false,status:'unsupported',message:'보안문자 검사는 NOL 예매창에서만 지원합니다.'}};
      const selector=modern?'img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"] img':'#imgCaptcha';
      const images=[...new Set(document.querySelectorAll(selector))].filter(shown);
      if(!images.length){
        const other=[...document.querySelectorAll('[class*="ModalCaptchaSlider_layerWrap__"],.captchSliderLayer,iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')].some(shown);
        return {result:other?fail('unsupported','문자 이미지 이외의 인증은 직접 진행해 주세요.'):{present:false,supported:true,status:'absent',message:'보안문자 창이 보이지 않습니다.'}};
      }
      if(images.length!==1)return {result:fail('unsupported','보안문자 이미지가 여러 개여서 자동 입력을 중지했습니다.')};
      const image=images[0];let container=image.parentElement,inputs=[],buttons=[];
      while(container&&container!==document.body){
        inputs=[...container.querySelectorAll(legacy?'input#txtCaptcha':'input')].filter(e=>shown(e)&&['text',''].includes(String(e.type||'').toLowerCase()));
        buttons=[...container.querySelectorAll(legacy?'.capchaBtns a,.capchaBtns button':'button')].filter(e=>shown(e)&&e.textContent.replace(/\s+/g,'').trim()==='입력완료');
        if(inputs.length===1&&buttons.length===1)break;
        container=container.parentElement;
      }
      if(!container||container===document.body||inputs.length!==1||buttons.length!==1)return {result:fail('unsupported','보안문자 입력칸과 입력완료 버튼을 하나로 확인하지 못했습니다. 입력칸이 접혀 있다면 직접 펼쳐 주세요.')};
      const input=inputs[0],button=buttons[0];
      if(input.readOnly)return {result:fail('unsupported','보안문자 입력칸이 읽기 전용입니다.')};
      if(input.disabled)return {result:fail('pending','보안문자 입력칸 활성화를 기다립니다.')};
      if(!image.complete||!image.naturalWidth||!image.naturalHeight)return {result:fail('pending','보안문자 이미지가 로딩 중입니다.')};
      if(image.naturalWidth>1600||image.naturalHeight>1000)return {result:fail('unsupported','보안문자 이미지 크기를 확인해 주세요.')};
      const error=[...container.querySelectorAll(legacy?'.alertNotice':'[class*="ModalCaptchaText_captchaError__"]')].filter(shown).map(e=>e.textContent.trim()).filter(Boolean).join(' ').slice(0,300);
      return {image,input,button,container,error,adapter:modern?'onestop':'legacy'};
    };
    const readImage=image=>{
      const src=image.currentSrc||image.src||'';
      if(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(src)&&src.length<=2000000)return src;
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');if(!context)throw Error('canvas');context.drawImage(image,0,0);
      const value=canvas.toDataURL('image/png');if(value.length>2000000)throw Error('size');return value;
    };
    const inspect=({includeImage=false,expected}={})=>{
      const found=locate();if(found.result)return found.result;
      let data=null;try{data=readImage(found.image);}catch{}
      const imageSource=found.image.currentSrc||found.image.src||'';
      let current=state.current;
      if(!current||current.image!==found.image||current.input!==found.input||current.data!==data||current.imageSource!==imageSource){
        state.cancelPending?.();
        current=state.current={...found,data,imageSource,id:state.documentKey+':'+(++state.sequence),submitted:false,locked:false,manualTouched:false};
        const remember=e=>{if(e.isTrusted&&state.current===current){current.manualTouched=true;state.cancelPending?.();}};
        current.input.addEventListener('input',remember);current.input.addEventListener('change',remember);
      }else Object.assign(current,found);
      const existingText=String(found.input.value||'');
      let status=current.submitted?(found.error?'incorrect':'submitted'):(current.manualTouched||existingText?'manual':'ready');
      if(!data&&status==='ready')status='retry';
      if(expected&&expected!==current.id)status='changed';
      return {present:true,supported:true,status,challengeId:current.id,existingText,adapter:found.adapter,submitEnabled:enabled(found.button),message:found.error||(status==='retry'?'브라우저에서 이미지를 읽지 못해 새 이미지가 필요합니다.':status==='manual'?'직접 입력한 문자가 있어 자동으로 덮어쓰지 않습니다.':status==='changed'?'보안문자 이미지가 바뀌었습니다.':status==='submitted'?'입력완료를 눌렀으며 사이트 응답을 확인 중입니다.':'보안문자 이미지를 확인했습니다.'),...(includeImage?{imageDataUrl:data}:{}),imageWidth:found.image.naturalWidth,imageHeight:found.image.naturalHeight};
    };
    const submit=async arg=>{
      if(typeof arg?.challengeId!=='string'||!/^[A-Z]{6}$/.test(arg?.text||''))return {submitted:false,status:'unsupported',message:'보안문자 6자리와 현재 이미지 확인 정보가 필요합니다.'};
      const before=inspect({expected:arg.challengeId});
      if(!before.supported||before.status!=='ready')return {...before,submitted:false};
      const current=state.current;
      if(current.locked||current.submitted)return {submitted:false,status:'pending',message:'이미 처리 중인 보안문자입니다.'};
      current.locked=true;
      return new Promise(resolve=>{
        let done=false,observer,timer;
        const finish=result=>{if(done)return;done=true;clearTimeout(timer);observer?.disconnect();if(state.cancelPending===cancel)state.cancelPending=null;resolve(result);};
        const cancel=()=>finish({submitted:false,status:'cancelled',message:'보안문자 자동 입력을 중지했습니다.'});
        state.cancelPending=cancel;
        const check=()=>{
          if(done)return;
          const found=locate();
          if(found.result)return finish({...found.result,submitted:false});
          let data;try{data=readImage(found.image);}catch{return finish({submitted:false,status:'unsupported',message:'보안문자 이미지를 다시 확인할 수 없습니다.'});}
          if(state.current!==current||found.image!==current.image||found.input!==current.input||data!==current.data)return finish({submitted:false,status:'changed',message:'입력 중 이미지가 바뀌어 확인을 누르지 않았습니다.'});
          if(current.manualTouched||String(found.input.value)!==arg.text)return finish({submitted:false,status:'manual',message:'입력값이 바뀌어 자동 확인을 중지했습니다.'});
          if(!enabled(found.button))return;
          // Latch before the site's handler runs, including synchronous errors.
          current.submitted=true;
          try{siteInvoke(found.button);finish({submitted:true,status:'submitted',challengeId:current.id,message:'보안문자를 전달하고 사이트 확인 함수를 실행했습니다.'});}
          catch{finish({submitted:false,status:'uncertain',message:'사이트 확인 함수의 실행 결과를 확인하지 못했습니다. 재전송하지 않습니다.'});}
        };
        observer=new MutationObserver(check);observer.observe(current.container,{subtree:true,childList:true,attributes:true});
        timer=setTimeout(()=>finish({submitted:false,status:'retry',message:'입력완료 버튼이 활성화되지 않아 새 이미지가 필요합니다.'}),1500);
        try{
          const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
          if(!setter)return finish({submitted:false,status:'unsupported',message:'보안문자 입력칸에 값을 전달하지 못했습니다.'});
          setter.call(current.input,arg.text);
          siteInvoke(current.input,'change',arg.text);
          check();
        }catch{return finish({submitted:false,status:'unsupported',message:'보안문자 입력 중 오류가 발생했습니다. 실제 화면을 확인해 주세요.'});}
      });
    };
    const refresh=arg=>{
      if(typeof arg?.challengeId!=='string')return {refreshed:false,status:'changed'};
      const info=inspect({expected:arg?.challengeId}),current=state.current;
      if(info.status==='changed'||info.status==='absent')return {refreshed:false,status:info.status};
      if(!info.supported||!current||current.manualTouched||(!current.locked&&info.existingText))return {refreshed:false,status:'manual',message:'직접 입력 또는 다른 인증 상태를 확인해 주세요.'};
      if(current.refreshRequested)return {refreshed:true,status:'pending'};
      const buttons=[...current.container.querySelectorAll('button')].filter(e=>shown(e)&&(e.matches?.('[class*="ModalCaptchaText_buttonRefresh__"]')||/^(?:새로고침|보안문자 새로고침)$/.test(e.getAttribute('aria-label')||e.textContent.trim())));
      if(buttons.length!==1)return {refreshed:false,status:'manual',message:'캡챠 팝업의 새로고침 버튼을 확인하지 못했습니다.'};
      if(!enabled(buttons[0]))return {refreshed:false,status:'pending',message:'캡챠 새로고침 버튼 활성화 대기'};
      state.cancelPending?.();current.refreshRequested=true;siteInvoke(buttons[0]);return {refreshed:true,status:'pending'};
    };
    window.__bearsCaptchaPage={version:3,snapshot:()=>inspect({includeImage:true}),status:arg=>inspect({expected:arg?.challengeId}),submit,refresh,cancel:()=>{state.cancelPending?.();return {cancelled:true};}};
  }
  return window.__bearsCaptchaPage.snapshot();
}
function captchaSubmit(arg){return window.__bearsCaptchaPage?.submit(arg)||{submitted:false,status:'changed',message:'페이지가 바뀌었습니다. 보안문자 이미지를 다시 확인해 주세요.'};}
function captchaStatus(arg){return window.__bearsCaptchaPage?.status(arg)||{present:false,supported:false,status:'changed',message:'페이지가 바뀌어 이전 보안문자의 결과를 확인할 수 없습니다.'};}
function captchaCancel(){return window.__bearsCaptchaPage?.cancel()||{cancelled:true};}
function captchaRefresh(arg){return window.__bearsCaptchaPage?.refresh(arg)||{refreshed:false,status:'changed'};}
module.exports={captchaSnapshot,captchaSubmit,captchaStatus,captchaCancel,captchaRefresh};
