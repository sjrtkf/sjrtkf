'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const price=require('../src/price-page'),flow=require('../src/flow');
test('known price rejection unlocks dispatch only through observed seat recovery',()=>{
  const f=fixture();f.setCount(2);f.run(price.proceedBooking,{quantity:2});
  const rejected=fixture({modal:true});
  f.context.document.querySelectorAll=rejected.context.document.querySelectorAll;
  f.run(flow.dismissEmptySelection);
  assert.equal(f.context.window.__ticketBookingDispatch,undefined);
  assert.equal(f.context.window.__ticketPriceRecovery.kind,'empty-selection');
  // No second booking request is allowed while stale price groups remain.
  f.setCount(2);assert.throws(()=>f.run(price.proceedBooking,{quantity:2}));assert.equal(f.bookingClicks,1);
  let backs=0;
  f.context.document.querySelectorAll=s=>s.includes('PriceContent_headerBack')?[{getBoundingClientRect:()=>({width:20,height:20}),getAttribute:()=>null,click(){backs++;}}]:[];
  f.run(price.returnToSeats);f.run(price.returnToSeats);assert.equal(backs,1);
  f.context.location.href='https://tickets.interpark.com/onestop/seat';
  f.context.document.querySelectorAll=s=>s.includes('circle.js-seat')?[{getBoundingClientRect:()=>({width:20,height:20})}]:[];
  assert.equal(f.run(price.returnToSeats).returned,true);assert.equal(f.context.window.__ticketPriceRecovery,undefined);
});
test('stop cleanup preserves an uncertain dispatch; a confirmed completed booking allows a new attempt',()=>{
  const f=fixture(),{pageActions}=require('../src/chrome-target');f.setCount(2);
  f.run(price.proceedBooking,{quantity:2});f.run(pageActions.stopWatchers);
  assert.equal(f.run(price.proceedBooking,{quantity:2}).dispatched,false);
  f.context.location.href='https://tickets.interpark.com/onestop/payment';assert.equal(f.run(price.bookingProgress).ready,true);
  f.context.location.href='https://tickets.interpark.com/onestop/seat?step=price';assert.equal(f.run(price.proceedBooking,{quantity:2}).dispatched,true);
  assert.equal(f.bookingClicks,2);
});
test('price selection waits behind the same loading overlays as the seat flow',()=>{
  for(const loading of ['EntLoading_wrap__','EntEntryLoading_wrap__']){
    const f=fixture(),query=f.context.document.querySelectorAll;
    f.context.document.querySelectorAll=s=>s.includes(loading)?[{getBoundingClientRect:()=>({width:10,height:10})}]:query(s);
    assert.equal(f.run(price.priceState).ready,false);assert.equal(f.run(flow.scene).busy,true);
    assert.throws(()=>f.run(price.adultPriceStep,{quantity:2}));assert.equal(f.clicks,0);
  }
});
test('adult rejected increment can recover while uncertain increment remains single dispatch',()=>{
  const f=fixture({delayed:true});f.run(price.adultPriceStep,{quantity:2});f.run(price.adultPriceStep,{quantity:2});assert.equal(f.clicks,1);
  const modal=fixture({modal:true}),query=f.context.document.querySelectorAll;
  f.context.document.querySelectorAll=modal.context.document.querySelectorAll;f.run(flow.dismissEmptySelection);
  assert.equal(f.context.window.__ticketAdultPrice,undefined);
  // A new seat screen, then a new verified price selection.
  f.context.location.href='https://tickets.interpark.com/onestop/seat';f.context.document.querySelectorAll=s=>s.includes('circle.js-seat')?[{getBoundingClientRect:()=>({width:10,height:10})}]:[];
  f.run(price.returnToSeats);f.context.location.href='https://tickets.interpark.com/onestop/seat?step=price';f.context.document.querySelectorAll=query;
  f.run(price.adultPriceStep,{quantity:2});assert.equal(f.clicks,2);
});
function fixture({name='[예매가] 성인',max=2,delayed=false,empty=false,modal=false}={}){
  let count=0,clicks=0,bookingClicks=0;
  const el=text=>({textContent:text,getBoundingClientRect:()=>({width:100,height:30}),getAttribute:()=>null});
  const input={get value(){return String(count);}};
  const button={...el(''),disabled:false,click(){clicks++;if(!delayed)count++;}};
  const item={...el(name),querySelector:s=>s.includes('PriceItem_name')?el(name):s.includes('spinbutton')?input:null,querySelectorAll:()=>[button]};
  const group={...el('W석'),querySelector:s=>s.includes('countMax')?el('/ '+max):s.includes('seatInfo')?el('W1구역 10열 12번'):s.includes('title')?el('W석'):s.includes('PriceItem')?item:null,querySelectorAll:()=>[item]};
  const dialog={...el('구매하실 좌석을 선택하세요.'),querySelector:()=>el('구매하실 좌석을 선택하세요.'),querySelectorAll:()=>[{...el('확인'),disabled:false,click(){modal=false;clicks++;}}]};
  const bookingButton={...el(max+'매 예매하기'),disabled:false,click(){bookingClicks++;}};
  const document={body:{dataset:{}},querySelector:()=>null,querySelectorAll:s=>s.includes('PriceGroup_group')?(empty?[]:[group]):s.includes('alertdialog')?(modal?[dialog]:[]):s==='button'?[bookingButton]:s==='h1,h2,h3,button,label'?[el('결제하기')]:[]};
  const context=vm.createContext({siteInvoke:(e,kind,value)=>{if(kind==='change'){e.value=value;e.siteChange?.(value);return;}return e.click();},document,window:{},location:{href:'https://tickets.interpark.com/onestop/seat?step=price'},URL,getComputedStyle:()=>({display:'block',visibility:'visible'})});
  vm.runInContext('var priceState='+price.priceState.toString(),context);
  const run=(fn,arg)=>vm.runInContext(`(${fn.toString()})(${JSON.stringify(arg)??''})`,context);
  return {run,context,input,button,bookingButton,setCount:n=>count=n,get count(){return count;},get clicks(){return clicks;},get bookingClicks(){return bookingClicks;}};
}
test('a price URL alone, empty seat list or blocking rejection cannot indicate success',()=>{
  for(const options of [{empty:true},{modal:true}]){
    const f=fixture(options);assert.equal(f.run(price.priceState).ready,false);assert.equal(f.run(flow.scene).completed,false);
    assert.throws(()=>f.run(price.adultPriceStep,{quantity:2}));assert.equal(f.clicks,0);
  }
  const f=fixture({modal:true});f.run(flow.dismissEmptySelection);assert.equal(f.clicks,1);
});
test('booking button uses exact quantity, only after adult counts and only once',()=>{
  const f=fixture();assert.throws(()=>f.run(price.proceedBooking,{quantity:2}),/수량/);assert.equal(f.bookingClicks,0);
  f.setCount(2);f.bookingButton.disabled=true;assert.equal(f.run(price.proceedBooking,{quantity:2}).dispatched,false);
  f.bookingButton.disabled=false;assert.equal(f.run(price.proceedBooking,{quantity:2}).dispatched,true);
  for(let i=0;i<5;i++)assert.equal(f.run(price.proceedBooking,{quantity:2}).dispatched,false);
  assert.equal(f.bookingClicks,1);
  const g=fixture();g.setCount(2);g.bookingButton.textContent='3매 예매하기';assert.throws(()=>g.run(price.proceedBooking,{quantity:2}));
});
test('booking outcome needs the next route, rendered content and no error modal',()=>{
  const f=fixture();assert.equal(f.run(price.bookingProgress).ready,false);
  f.context.location.href='https://tickets.interpark.com/onestop/payment';assert.equal(f.run(price.bookingProgress).ready,true);
  f.context.document.querySelectorAll=()=>[];assert.equal(f.run(price.bookingProgress).ready,false);
  const g=fixture({modal:true});g.context.location.href='https://tickets.interpark.com/onestop/payment';assert.equal(g.run(price.bookingProgress).blocked,true);
});
test('adult quantities are selected through site handlers and confirmed with no order action',()=>{
  const f=fixture();assert.equal(f.run(flow.scene).completed,true);
  assert.equal(f.run(price.adultPriceStep,{quantity:2}).status,'pending');
  assert.equal(f.run(price.adultPriceStep,{quantity:2}).status,'pending');
  assert.equal(f.run(price.adultPriceStep,{quantity:2}).status,'complete');
  assert.equal(f.count,2);assert.equal(f.clicks,2);
});
test('delayed React quantity updates cannot cause duplicate increment requests',()=>{
  const f=fixture({delayed:true});f.run(price.adultPriceStep,{quantity:2});
  for(let i=0;i<10;i++)assert.equal(f.run(price.adultPriceStep,{quantity:2}).status,'pending');
  assert.equal(f.clicks,1);f.setCount(1);f.run(price.adultPriceStep,{quantity:2});assert.equal(f.clicks,2);
  f.setCount(2);assert.equal(f.run(price.adultPriceStep,{quantity:2}).status,'complete');
});
test('unexpected discounts, quantities or disabled controls never get selected',()=>{
  const f=fixture({name:'[회원 할인] 성인'});assert.equal(f.run(price.adultPriceStep,{quantity:2}).status,'manual');assert.equal(f.clicks,0);
  const g=fixture();assert.throws(()=>g.run(price.adultPriceStep,{quantity:1}));g.button.disabled=true;assert.equal(g.run(price.adultPriceStep,{quantity:2}).status,'pending');assert.equal(g.clicks,0);g.button.disabled=false;g.run(price.adultPriceStep,{quantity:2});assert.equal(g.clicks,1);
});
