'use strict';
const {pause}=require('./run-control');

// Coordinates one local OCR operation. Browser reads/submissions are supplied by
// the caller so this service cannot navigate, select seats, or start a booking.
class CaptchaService {
  constructor({ocr,onState=()=>{},wait=pause,now=Date.now,resultTimeoutMs=8000,minConfidence=.75,maxAutoAttempts=3}){
    this.ocr=ocr;this.onState=onState;this.wait=wait;this.now=now;
    this.resultTimeoutMs=resultTimeoutMs;this.minConfidence=minConfidence;this.maxAutoAttempts=maxAutoAttempts;
    this.status={available:true,ready:false,busy:false,mode:null,errorCode:null,message:'보안문자 모델 준비 전',text:'',confidence:null,previewDataUrl:null};
    this.job=null;this.autoResults=new Map();this.autoAttempts=0;
  }
  publish(update){this.status={...this.status,...update};this.onState({...this.status});}
  async warmup(){
    this.publish({errorCode:null,message:'보안문자 모델을 미리 준비하고 있습니다.'});
    try{await this.ocr.warmup();this.publish({available:true,ready:true,message:'보안문자 인식 준비 완료'});return true;}
    catch(error){this.publish({available:false,ready:false,errorCode:error.code||'OCR_START_FAILED',message:'보안문자 모델 준비 실패 · '+error.message});return false;}
  }
  resetAuto(){this.autoResults.clear();this.autoAttempts=0;}
  cancel(){this.job?.controller.abort();}
  async close(){this.cancel();await this.ocr.close();}
  async execute({mode='read',scope,adapter,signal}){
    if(this.job)throw Error('보안문자 처리가 진행 중입니다. 먼저 중지하거나 결과를 기다려 주세요.');
    if(!['read','submit','auto'].includes(mode))throw Error('잘못된 보안문자 동작입니다.');
    if(signal?.aborted)throw Error('보안문자 처리가 중지되었습니다.');
    const controller=new AbortController(),job={controller},abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});this.job=job;
    const assert=()=>{if(controller.signal.aborted)throw Error('보안문자 처리가 중지되었습니다.');adapter.assertCurrent();};
    let key,challengeId;
    const done=(result)=>{result={...result,...(challengeId?{challengeId}:{})};if(mode==='auto'&&key)this.autoResults.set(key,result);this.publish({message:result.message});return result;};
    this.publish({busy:true,mode,errorCode:null,...(mode==='auto'?{}:{text:'',confidence:null,previewDataUrl:null}),message:'현재 예매창의 보안문자를 확인합니다.'});
    try{
      assert();const snapshot=await adapter.snapshot();assert();
      if(snapshot?.status==='unsupported')return done({status:'manual',message:snapshot.message||'이 화면의 보안문자를 지원하지 않습니다.'});
      if(!snapshot?.present)return done({status:'absent',message:'현재 선택한 창에 보안문자가 없습니다. 보안문자가 보이는 예매창을 선택해 주세요.'});
      if(!snapshot.supported||!snapshot.challengeId||!snapshot.imageDataUrl)return done({status:snapshot.status==='pending'?'pending':'manual',message:snapshot.message||'이 보안문자 화면의 이미지·입력칸을 확인하지 못했습니다. 직접 입력해 주세요.'});
      challengeId=snapshot.challengeId;
      key=String(scope)+':'+snapshot.challengeId;
      if(mode==='auto'&&this.autoResults.has(key)){
        const previous=this.autoResults.get(key);this.publish({message:previous.message});return previous;
      }
      if(mode!=='read'&&String(snapshot.existingText||'').trim())return done({status:'manual',message:'입력칸에 문자가 있어 덮어쓰지 않았습니다. Chrome에서 직접 확인해 주세요.'});
      if(mode==='auto'&&this.autoAttempts>=this.maxAutoAttempts)return done({status:'manual',message:'자동 확인을 3회 시도했습니다. 현재 보안문자는 직접 입력해 주세요.'});
      if(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(snapshot.imageDataUrl)||snapshot.imageDataUrl.length>3*1024*1024)return done({status:'manual',message:'보안문자 이미지 형식이나 크기를 확인하지 못했습니다.'});
      this.publish({text:'',confidence:null,previewDataUrl:snapshot.imageDataUrl,message:'보안문자를 이 PC에서 인식하고 있습니다.'});
      if(!this.status.ready){await this.ocr.warmup();assert();this.publish({available:true,ready:true});}
      const result=await this.ocr.recognize(snapshot.imageDataUrl,{signal:controller.signal});assert();
      const valid=result?.valid===true&&/^[ABCDEKLMNPQRSTUWXZ]{6}$/.test(result.text||'');
      const confidence=Number.isFinite(result?.confidence)?result.confidence:null;
      this.publish({text:valid?result.text:'',confidence});
      if(!valid)return done({status:'manual',message:'글자 6개를 확인하지 못해 자동 입력하지 않았습니다. 직접 입력해 주세요.'});
      if(mode==='read')return done({status:'read',text:result.text,confidence,message:'인식 완료 · 입력과 확인은 누르지 않았습니다.'});
      if(confidence==null||confidence<this.minConfidence)return done({status:'manual',text:result.text,confidence,message:'모델 점수가 낮아 자동 입력하지 않았습니다. 이미지와 인식 결과를 비교해 직접 입력해 주세요.'});
      assert();this.publish({message:'현재 이미지가 같은지 확인한 뒤 입력·확인을 전달합니다.'});
      // Mark before dispatch: a lost reply must never turn into a duplicate POST.
      if(mode==='auto'){
        this.autoAttempts++;
        this.autoResults.set(key,{status:'uncertain',message:'이미 확인을 전달했습니다. 결과가 불명확하여 같은 이미지에 재전송하지 않습니다.'});
      }
      const submitted=await adapter.submit({challengeId:snapshot.challengeId,text:result.text});assert();
      if(!submitted?.submitted)return done({status:'manual',message:submitted?.message||'입력·확인을 전달하지 못했습니다. 현재 화면을 확인해 주세요.'});
      this.publish({message:'확인 클릭 전달 · 보안문자 창의 응답을 확인합니다.'});
      const deadline=this.now()+this.resultTimeoutMs;
      while(true){
        assert();const status=await adapter.status({challengeId:snapshot.challengeId});assert();
        if(status?.status==='absent'&&status?.supported!==false)return done({status:'verified',text:result.text,confidence,message:'확인 후 보안문자 창이 사라졌습니다.'});
        if(status?.status==='changed')return done({status:'changed',message:'보안문자 이미지가 바뀌었습니다. '+(mode==='auto'?'새 이미지를 다시 확인합니다.':'현재 화면에서 다시 테스트할 수 있습니다.')});
        if(['incorrect','manual','unsupported'].includes(status?.status))return done({status:'manual',message:status.message||'사이트에서 보안문자를 확인하지 못했습니다. 직접 입력해 주세요.'});
        if(this.now()>=deadline)return done({status:'uncertain',message:'확인 후 응답을 확인하지 못했습니다. 같은 이미지를 다시 제출하지 않고 직접 확인을 기다립니다.'});
        // Only response waiting is paced; capture → OCR → submit has no sleep.
        await this.wait(Math.min(100,Math.max(1,deadline-this.now())),controller.signal);
      }
    }catch(error){
      if(mode==='auto'&&key&&!this.autoResults.has(key))this.autoResults.set(key,{status:'manual',message:error.message});
      this.publish({errorCode:controller.signal.aborted?null:error.code||'CAPTCHA_FAILED',message:controller.signal.aborted?'보안문자 처리를 중지했습니다. 이미 전달한 확인은 취소되지 않습니다.':error.message});
      throw error;
    }finally{
      signal?.removeEventListener('abort',abort);if(this.job===job)this.job=null;this.publish({busy:false});
    }
  }
}
module.exports={CaptchaService};
