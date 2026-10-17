'use strict';
const {readBookingContext}=require('./booking-context');

// Contract observed in the public NOL onestop bundles on 2026-10-16.
// Runs inside the selected document. Credentials never leave that document.
async function reserveByCode({expected, seats, runId, expiresAt}) {
  const fail=(status,code)=>({status,code});
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const keys=['goodsCode','placeCode','playSeq'];
  if(!expected||!keys.every(k=>typeof expected[k]==='string'&&/^\d{3,8}$/.test(expected[k])))return fail('blocked','IDENTITY_REQUIRED');
  if(typeof runId!=='string'||!Number.isFinite(expiresAt)||Date.now()>expiresAt)return fail('blocked','EXPIRED_COMMAND');
  if(!Array.isArray(seats)||seats.length<1||seats.length>4||new Set(seats.map(s=>s.id)).size!==seats.length)return fail('blocked','INVALID_SEATS');
  let context;
  try {context=readBookingContext().context;}catch(error){return fail('blocked',error.message);}
  const identity=c=>({goodsCode:String(c?.goods?.goodsCode||''),placeCode:String(c?.goods?.placeCode||''),playSeq:String(c?.playSeq?.playSeq||'')});
  const matches=c=>keys.every(k=>identity(c)[k]===expected[k]);
  const ready=()=>{
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat'||new URL(location.href).searchParams.get('step')==='price')throw Error('WRONG_PAGE');
    const current=readBookingContext().context;
    if(!matches(current)||current.sessionId!==context.sessionId)throw Error('IDENTITY_CHANGED');
    if(typeof current.sessionId!=='string'||!current.sessionId)throw Error('SESSION_REQUIRED');
    if(current.goods?.isInterlocking!==false||current.goods?.reserved!==true)throw Error('UNSUPPORTED_SEAT_SYSTEM');
    if([...document.querySelectorAll('img[alt="캡챠 이미지"],[class*="ModalCaptchaText_captchaImage__"], [aria-busy="true"], [role="alertdialog"], [role="dialog"][aria-modal="true"]')].some(shown))throw Error('PAGE_NOT_READY');
    if([...document.querySelectorAll('button')].some(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기'))throw Error('NOTICE_PENDING');
    if(current.goods?.checkCaptcha===true&&!sessionStorage.getItem('interpark/captchaVerify'))throw Error('CAPTCHA_REQUIRED');
    if(document.querySelector('circle.js-seat[class*="SeatMap_selected"]'))throw Error('EXISTING_SELECTION');
    const expiry=Number(sessionStorage.getItem('interpark/preReserveExpireTime'));
    if(expiry>0&&Date.now()>=expiry)throw Error('SESSION_EXPIRED');
    if(window.__ticketDirectApi?.cancelled||Date.now()>expiresAt)throw Error('CANCELLED');
  };
  const old=window.__ticketDirectApi;
  if(old?.pending||old?.uncertain||old?.held?.length)return fail('blocked','PREVIOUS_RESULT_PENDING');
  const state={runId,pending:true,uncertain:false,held:[],cancelled:false};window.__ticketDirectApi=state;
  const knownConflicts=new Set(['P40054','P41150','P41149','P40021']);
  const request=async(path,body,field)=>{
    ready();
    const headers={'Content-Type':'application/json','X-Onestop-Channel':context.channelType||'NOL','X-Onestop-Session':context.sessionId,'X-Ticket-BFF-Language':({ko:'KO',en:'EN',ja:'JA',zh:'ZH'})[context.lang||'ko']||'KO','X-OneStop-Trace-ID':crypto.randomUUID().replaceAll('-','').slice(0,16)};
    if(field&&context.goods?.preOpt)headers.Authorization='Bearer '+context.goods.preOpt;
    if(!field)headers['X-Requested-With']='XMLHttpRequest';
    let response,data;
    try {response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'error',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});data=await response.json();}catch{state.uncertain=true;throw Error('REQUEST_OUTCOME_UNKNOWN');}
    const codes=[...(Array.isArray(data?.errors)?data.errors.map(e=>e?.extensions?.backendErrorCode):[]),data?.backendErrorCode,data?.data?.backendErrorCode,data?.properties?.backendErrorCode].filter(Boolean);
    if(codes.some(c=>knownConflicts.has(c)))return {conflict:true};
    if(!response.ok||data?.errors?.length||codes.length||data?.success===false||data?.data?.success===false||(field&&data?.data?.[field]!==true)){
      state.uncertain=true;throw Error('RESPONSE_NOT_CONFIRMED');
    }
    if(!field){
      // REST envelope success and no rejected seats are required. An arbitrary
      // 200 response, HTML, null or empty object must not authorize navigation.
      const rejected=data?.unselectableSeatInfoIds;
      if(!Array.isArray(rejected)||rejected.length!==0){
        state.uncertain=true;throw Error('COMPLETION_NOT_CONFIRMED');
      }
    }
    return {ok:true};
  };
  const gql=(operation,field,type,command)=>request('/onestop/gql',{operationName:operation,query:`mutation ${operation}($command: ${type}!) { ${field}(command: $command) }`,variables:{command}},field);
  const release=async()=>{for(const id of [...state.held]){const result=await gql('DeselectSeat','deselectSeat','DeselectSeatCommand',{seatInfoId:id});if(!result.ok)throw Error('RELEASE_NOT_CONFIRMED');state.held=state.held.filter(x=>x!==id);}};
  try {
    ready();
    for(const seat of seats){
      if(!/^seat_block_/.test(seat.id)||typeof seat.blockKey!=='string'||typeof seat.gradeCode!=='string'||!/^\d+$/.test(seat.gradeCode))throw Error('INVALID_SEAT_CODE');
      const id=seat.id.slice(11);
      if(!id.startsWith(expected.goodsCode+':'+expected.placeCode+':'))throw Error('FOREIGN_SEAT');
      const el=document.getElementById(seat.id);
      if(!el?.matches('circle.js-seat[id]')||el.parentElement.id!=='seat_block_'+seat.blockKey||!shown(el)||/SeatMap_(?:disabled|selected)/.test(el.getAttribute('class')||''))return fail('conflict','SEAT_CHANGED');
    }
    for(const seat of seats){
      const id=seat.id.slice(11);
      const result=await gql('PreselectSeat','preselectSeat','PreselectSeatCommand',{playSeq:expected.playSeq,blockKey:seat.blockKey,seatGrade:seat.gradeCode,seatInfoId:id});
      if(result.conflict){await release();return {status:'conflict',code:'SEAT_TAKEN',seatIds:[seat.id]};}
      state.held.push(id);
    }
    const result=await request('/onestop/api/seats/select',{...expected,seatType:context.goods.kindOfGoods==='01007'&&context.goods.isSportsGroup?'SPORTS':'DEFAULT',seats:seats.map(s=>({seatGrade:s.gradeCode,seatInfoId:s.id.slice(11)})),sessionId:context.sessionId,autoAssign:false});
    if(result.conflict){await release();return fail('conflict','COMPLETION_CONFLICT');}
    state.completed=true;
    // Do not fabricate the site's selected DOM or a checkout success. The
    // caller must observe the normal price page after this server response.
    return {status:'server-completed',seatIds:seats.map(s=>s.id),identity:expected};
  } catch(error){return fail(state.uncertain||state.held.length?'uncertain':'blocked',String(error.message).match(/^[A-Z_]+$/)?error.message:'UNEXPECTED_ERROR');}
  finally {state.pending=false;}
}

function bookingIdentity(){
  try{return readBookingContext().identity;}
  catch(error){throw Error('현재 예매 세션과 화면의 경기 정보를 대조하지 못했습니다. '+error.message);}
}
function assertIdentity(expected,actual){
  if(!actual||!['goodsCode','placeCode','playSeq'].every(k=>typeof actual[k]==='string'&&/^\d{3,8}$/.test(actual[k])))throw Error('상품·구장·회차를 확인하지 못해 중지했습니다.');
  const time=v=>{const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);return m?String((Number(m[1])%12)+(m[3]?.toUpperCase()==='PM'?12:!m[3]&&Number(m[1])>=12?12:0)).padStart(2,'0')+':'+m[2]:String(v||'');};
  if(expected&&Object.keys(expected).some(k=>expected[k]&&(k==='playTime'?time(expected[k])!==time(actual[k]):expected[k]!==actual[k])))throw Error('선택한 경기와 상품·구장·회차가 달라 중지했습니다.');
  return {...actual};
}
function openConfirmedPrice({expected,runId}){
  const state=window.__ticketDirectApi;
  if(!state?.completed||state.runId!==runId||state.cancelled||state.opened)throw Error('확인된 API 선택 완료 결과가 없습니다.');
  const c=readBookingContext().context;
  if(c.goods?.goodsCode!==expected.goodsCode||c.goods?.placeCode!==expected.placeCode||c.playSeq?.playSeq!==expected.playSeq)throw Error('경기가 변경되었습니다.');
  if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat')throw Error('예매 화면이 변경되었습니다.');
  state.opened=true;location.assign('/onestop/seat?step=price');return true;
}
module.exports={reserveByCode,bookingIdentity,assertIdentity,openConfirmedPrice};
