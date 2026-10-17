'use strict';
// DOM contracts observed in the public onestop bundle on 2026-10-17.
// These functions stop after the price page's booking button, before payment.
function priceState(){
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const u=new URL(location.href);
  const route=u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat'&&u.searchParams.get('step')==='price';
  if(!route)return {route:false,ready:false,groups:[],quantity:0};
  const blocked=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"],img[alt="캡챠 이미지"]')].some(shown);
  const groups=[...document.querySelectorAll('[class*="PriceGroup_group__"]')].filter(shown).map(group=>{
    const text=selector=>group.querySelector(selector)?.textContent.trim()||'';
    const max=text('[class*="PriceGroup_countMax__"]').match(/^\/\s*(\d+)$/);
    const items=[...group.querySelectorAll('li[class*="PriceItem_typeItem__"]')].filter(shown).map(item=>({
      name:item.querySelector('[class*="PriceItem_name__"]')?.textContent.replace(/\s+/g,' ').trim()||'',
      count:Number(item.querySelector('input[role="spinbutton"]')?.value??NaN)
    }));
    return {grade:text('[class*="PriceGroup_title__"]'),seat:text('[class*="PriceGroup_seatInfo__"]'),max:max?Number(max[1]):0,items};
  });
  const quantity=groups.reduce((n,g)=>n+g.max,0);
  return {route,rejected:!!window.__ticketPriceRecovery,ready:!blocked&&groups.length>0&&quantity>0&&quantity<=4&&groups.every(g=>g.max>0&&g.seat&&g.items.length&&g.items.every(i=>Number.isInteger(i.count)&&i.count>=0)),groups,quantity};
}
function adultPriceStep({quantity}){
  const state=priceState();
  if(!state.ready||state.quantity!==quantity||state.rejected)throw Error('가격 화면의 선택 좌석 수를 확인하지 못했습니다.');
  const adult=name=>/^\[?예매가\]?[\/·]?성인$/.test(name.replace(/\s/g,''));
  // Inspect every group before making any change; discounts and mixed manual
  // selections must not be silently replaced.
  const plan=state.groups.map(g=>{
    const indexes=g.items.map((v,i)=>adult(v.name)?i:-1).filter(i=>i>=0);
    if(indexes.length!==1||g.items.some((v,i)=>i!==indexes[0]&&v.count>0))return null;
    const index=indexes[0];return g.items[index].count<=g.max?{index,count:g.items[index].count,max:g.max}:null;
  });
  if(plan.some(p=>!p))return {status:'manual',message:'좌석 선택과 가격 화면을 확인했습니다. 예매가/성인 항목을 하나로 확인하지 못해 가격은 직접 선택해 주세요.'};
  const signature=JSON.stringify(state.groups);
  const old=window.__ticketAdultPrice;
  const groupIndex=plan.findIndex(p=>p.count<p.max);
  if(groupIndex<0){delete window.__ticketAdultPrice;return {status:'complete',quantity,message:`좌석 ${quantity}매와 예매가/성인 ${quantity}매 선택을 확인했습니다. 주문·결제는 진행하지 않았습니다.`};}
  if(old?.signature===signature)return {status:'pending'};
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const group=[...document.querySelectorAll('[class*="PriceGroup_group__"]')].filter(shown)[groupIndex];
  const item=[...group.querySelectorAll('li[class*="PriceItem_typeItem__"]')].filter(shown)[plan[groupIndex].index];
  const buttons=[...item.querySelectorAll('button[class*="stepper__incrementButton"]')].filter(shown);
  if(buttons.length!==1)throw Error('성인 가격 수량 버튼을 하나로 확인하지 못했습니다.');
  if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {status:'pending'};
  window.__ticketAdultPrice={signature};siteInvoke(buttons[0]);
  return {status:'pending'};
}
function proceedBooking({quantity}){
  const state=priceState();
  if(!state.ready||state.quantity!==quantity)throw Error('예매하기 전에 좌석 수를 다시 확인하지 못했습니다.');
  const adult=name=>/^\[?예매가\]?[\/·]?성인$/.test(name.replace(/\s/g,''));
  if(state.groups.some(g=>g.items.filter(i=>adult(i.name)).length!==1||g.items.some(i=>i.count!==(adult(i.name)?g.max:0))))throw Error('예매가/성인 수량이 선택 좌석 수와 다릅니다.');
  if(state.rejected)throw Error('좌석 선택 거절 후 좌석 화면 복구가 필요합니다.');
  if(window.__ticketBookingDispatch?.completed)delete window.__ticketBookingDispatch;
  if(window.__ticketBookingDispatch)return {status:'pending',dispatched:false};
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const buttons=[...document.querySelectorAll('button')].filter(e=>shown(e)&&e.textContent.replace(/\s/g,'')===quantity+'매예매하기');
  if(buttons.length!==1)throw Error('가격 화면의 '+quantity+'매 예매하기 버튼을 하나로 확인하지 못했습니다.');
  if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {status:'pending',dispatched:false};
  window.__ticketBookingDispatch={quantity,at:Date.now()};
  siteInvoke(buttons[0]);return {status:'pending',dispatched:true};
}
function bookingProgress(){
  const u=new URL(location.href),route=u.origin==='https://tickets.interpark.com'&&['/onestop/payment','/onestop/preorder'].includes(u.pathname);
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const dialogs=[...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"]')].filter(shown);
  if(dialogs.length)return {ready:false,blocked:true,message:dialogs.map(e=>(e.querySelector('#dialogMessage')||e).textContent.trim()).join(' ').slice(0,500)};
  const busy=[...document.querySelectorAll('[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"],img[alt="캡챠 이미지"]')].some(shown);
  const content=[...document.querySelectorAll('h1,h2,h3,button,label')].filter(shown).some(e=>/결제|주문자|예매자|티켓\s*수령|배송/.test(e.textContent));
  const ready=route&&!busy&&content;
  if(ready&&window.__ticketBookingDispatch)window.__ticketBookingDispatch.completed=true;
  return {ready,route,busy};
}
function returnToSeats(){
  const recovery=window.__ticketPriceRecovery;
  if(!recovery)throw Error('확인된 좌석 거절 없이 이전 단계로 이동하지 않습니다.');
  const u=new URL(location.href),shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  if(u.origin!=='https://tickets.interpark.com'||u.pathname!=='/onestop/seat')throw Error('좌석 복구 중 다른 화면으로 이동했습니다.');
  if([...document.querySelectorAll('[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"],[class*="EntEntryLoading_wrap__"]')].some(shown))return {pending:true};
  if(u.searchParams.get('step')!=='price'){
    if(![...document.querySelectorAll('circle.js-seat[id],button[class*="SportsSeatGradeList_contentItem__"]')].some(shown))return {pending:true};
    delete window.__ticketPriceRecovery;return {returned:true};
  }
  if(recovery.backSent)return {pending:true};
  // This exact price header's site handler returns to the seat phase.
  const buttons=[...document.querySelectorAll('button[class*="PriceContent_headerBack__"]')].filter(shown);
  if(buttons.length!==1)throw Error('좌석으로 돌아가는 가격 화면의 이전 버튼을 확인하지 못했습니다.');
  if(buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {pending:true};
  recovery.backSent=true;siteInvoke(buttons[0]);return {pending:true};
}
module.exports={priceState,adultPriceStep,proceedBooking,bookingProgress,returnToSeats};
