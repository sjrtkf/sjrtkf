'use strict';

// Human-entered text only. This controller never loads or calls an OCR model.
class ManualCaptcha {
  constructor({onState=()=>{}}={}){
    this.onState=onState;this.context=null;this.pending=false;this.preparing=null;this.epoch=0;
    this.status={present:false,supported:false,busy:false,message:'이미지를 보고 보안문자를 직접 입력하세요.'};
  }
  publish(value){this.status={...value,busy:this.pending};this.onState(this.status);return this.status;}
  clear(message='대상 화면이 바뀌었습니다. 이미지를 다시 확인해 주세요.'){
    this.epoch++;this.context=null;this.publish({present:false,supported:false,message});
  }
  invalidateIfStale(){if(this.context)try{this.context.assertCurrent();}catch{this.clear();}}
  async prepare(adapter,{focus=true,background=false}={}){
    if(this.pending)return this.status;
    if(this.preparing)return this.preparing;
    const epoch=this.epoch;if(!background){this.pending=true;this.publish(this.status);}
    const task=(async()=>{
      try{
        adapter.assertCurrent();const result=await adapter.prepare({focus});adapter.assertCurrent();
        if(epoch!==this.epoch)throw Error('보안문자 준비가 취소되었습니다. 다시 확인해 주세요.');
        this.context=result?.supported&&result.challengeId?{...adapter,challengeId:result.challengeId}:null;
        return this.publish({...result,targetId:adapter.targetId});
      }catch(error){this.context=null;this.publish({present:false,supported:false,message:error.message});throw error;}
      finally{this.pending=false;this.publish(this.status);}
    })();
    this.preparing=task;
    try{await task;return this.status;}finally{if(this.preparing===task)this.preparing=null;}
  }
  async submit({challengeId,text}={}){
    if(this.preparing)await this.preparing;
    if(this.pending)throw Error('직접 입력한 보안문자를 처리하고 있습니다. 결과를 기다려 주세요.');
    // Only normalize casing; do not guess, complete, or correct human input.
    text=typeof text==='string'?text.trim():'';
    if(!/^[A-Za-z]{6}$/.test(text))throw Error('화면에 보이는 영문 6자리를 직접 입력해 주세요.');
    text=text.toUpperCase();
    const context=this.context;
    if(!context||context.challengeId!==challengeId||this.status.submitted||this.status.status==='submitted')throw Error('보안문자가 바뀌었거나 이미 확인했습니다. 이미지를 다시 확인해 주세요.');
    try{context.assertCurrent();}catch(error){this.clear(error.message);throw error;}
    this.pending=true;this.publish({...this.status,message:'작성한 문자를 전달하고 있습니다.'});
    try{
      const result=await context.submit({challengeId,text});context.assertCurrent();
      if(this.context!==context)throw Error('보안문자 입력 중 대상 화면이 바뀌었습니다. 사이트 결과를 확인해 주세요.');
      if(['changed','absent','unsupported','cancelled'].includes(result?.status))this.context=null;
      this.publish({...this.status,...result,...(!this.context?{supported:false,imageDataUrl:null}:{}),targetId:context.targetId});
      return result;
    }catch(error){this.context=null;this.publish({present:false,supported:false,message:error.message});throw error;}
    finally{this.pending=false;this.publish(this.status);}
  }
}
module.exports={ManualCaptcha};
