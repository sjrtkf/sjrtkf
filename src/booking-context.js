'use strict';
// Internal page helper, serialized inside the static extension action closure.
// Its context contains session values and must never be exposed as an action.
function readBookingContext(){
  if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat')throw Error('WRONG_PAGE');
  let context,initial;
  try{
    context=JSON.parse(sessionStorage.getItem('interpark/context')||'{}');
    initial=JSON.parse(document.querySelector('#__NEXT_DATA__')?.textContent||'{}').props?.pageProps?.initData;
  }catch{throw Error('CONTEXT_UNREADABLE');}
  const identity=value=>({goodsCode:String(value?.goods?.goodsCode||''),placeCode:String(value?.goods?.placeCode||''),playSeq:String(value?.playSeq?.playSeq||''),playDate:String(value?.playSeq?.playDate||''),playTime:String(value?.playSeq?.playTime||'')});
  const normalizedTime=value=>{
    const m=String(value||'').replace(/\s/g,'').match(/^(\d{1,2}):(\d{2})(AM|PM)?$/i);
    if(!m)return null;let hour=Number(m[1]);const minute=Number(m[2]),half=m[3]?.toUpperCase();
    if(minute>59||hour>(half?12:23)||half&&hour<1)return null;
    if(half)hour=hour%12+(half==='PM'?12:0);
    return hour*60+minute;
  };
  const current=identity(context),keys=['goodsCode','placeCode','playSeq'];
  if(!keys.every(k=>/^\d{3,8}$/.test(current[k]))||typeof context.sessionId!=='string'||!context.sessionId)throw Error('CONTEXT_REQUIRED');
  if(initial!=null){
    const original=identity(initial);
    if(!keys.every(k=>original[k]===current[k])||original.playDate&&original.playDate!==current.playDate||original.playTime&&(normalizedTime(original.playTime)==null||normalizedTime(original.playTime)!==normalizedTime(current.playTime)))throw Error('BOOTSTRAP_CONTEXT_MISMATCH');
  }else{
    // Client navigation can render a complete booking page with pageProps:{}.
    // Require current session identity plus the visible event header and date/time.
    const clean=value=>String(value||'').replace(/\s+/g,'');
    const name=clean(context.goods?.goodsName),date=current.playDate,time=clean(current.playTime);
    if(!name||!/^\d{8}$/.test(date)||normalizedTime(time)==null)throw Error('BOOKING_HEADER_REQUIRED');
    const dateLabel=date.slice(0,4)+'.'+date.slice(4,6)+'.'+date.slice(6,8);
    const matches=[...document.querySelectorAll('h3')].filter(h=>{
      const r=h.getBoundingClientRect(),style=getComputedStyle(h);
      return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&clean(h.textContent)===name;
    });
    if(!matches.length||!matches.every(h=>{const text=clean(h.parentElement?.textContent);const dateAt=text.indexOf(dateLabel);if(dateAt<0)return false;
      const times=[...text.slice(dateAt+dateLabel.length).matchAll(/(?:^|[^\d])(\d{1,2}:\d{2}(?:AM|PM)?)(?![\dA-Za-z])/gi)];
      return times.length===1&&normalizedTime(times[0][1])===normalizedTime(time);}))throw Error('BOOKING_HEADER_MISMATCH');
  }
  return {context,identity:current};
}
module.exports={readBookingContext};
