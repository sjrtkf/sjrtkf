'use strict';
// Runs in the site's MAIN world. Invoke the registered function directly;
// never dispatch browser input events, evaluate attributes, or guess a parent
// handler. The caller identifies and revalidates the exact supported control.
function invokeSiteFunction(element,kind='activate',value){
  const gateEntry=kind==='entry'&&location.origin==='https://tickets.interpark.com'&&/^\/gates\/ticket\/\d{8}\/?$/.test(location.pathname)&&/^(?:예매하기|남은시간\s*\d{1,2}:\d{2})$/.test(element?.textContent?.trim()||'');
  if(!element||element.isConnected===false||(!gateEntry&&(element.disabled||element.getAttribute?.('aria-disabled')==='true')))throw Error('SITE_CONTROL_CHANGED');
  if(!['activate','change'].includes(kind)&&!gateEntry)throw Error('SITE_FUNCTION_UNSUPPORTED');
  const keys=Object.keys(element).filter(k=>k.startsWith('__reactProps$'));
  if(keys.length>1)throw Error('SITE_FUNCTION_AMBIGUOUS');
  const props=keys.length?element[keys[0]]:null;
  const legacy=location.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(location.pathname);
  const demo=['file:','chrome-extension:'].includes(location.protocol)&&location.pathname.endsWith('/demo.html');
  let fn=props?.[kind==='change'?'onChange':'onClick'];
  if(!fn&&(legacy||demo))fn=element[kind==='change'?'onchange':'onclick'];
  if(kind==='change'){
    if(typeof value!=='string'||!/^[A-Z]{6}$/.test(value)||element.readOnly)throw Error('SITE_INPUT_INVALID');
    if(typeof fn!=='function'&&!legacy)throw Error('SITE_INPUT_FUNCTION_UNAVAILABLE');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if(!setter)throw Error('SITE_INPUT_UNAVAILABLE');
    setter.call(element,value);
    if(!fn)return; // Legacy validation reads the native input value directly.
  }else if(typeof fn!=='function')throw Error('SITE_FUNCTION_UNAVAILABLE');
  // A plain argument for a component function, not a DOM/SyntheticEvent. This
  // supports handlers that call preventDefault without emitting an input event.
  const argument={target:element,currentTarget:element,preventDefault(){},stopPropagation(){}};
  return fn.call(element,argument);
}

const CODE_ACTIONS=new Set([
  'entry.prepareEntry','entry.gateStatus','entry.armGate','entry.setGateClock','entry.noteGateRequest',
  'live.liveAction','flow.scene','flow.clickKnown','flow.enterCode','flow.deselect','flow.dismissConflict','flow.dismissEmptySelection',
  'pricePage.adultPriceStep','pricePage.proceedBooking','pricePage.returnToSeats',
  'captcha.captchaSnapshot','captcha.captchaSubmit','captcha.captchaStatus','captcha.captchaCancel','captcha.captchaRefresh',
  'manualCaptcha.manualCaptchaPrepare','manualCaptcha.manualCaptchaSubmit','manualCaptcha.manualCaptchaCancel',
  'page.pageClock','page.gateSnapshot','page.gateState','page.showAll','page.showAllGames','page.stopWatchers'
]);
function siteCodeMessage(code){
  if(typeof code!=='string'||!/^SITE_[A-Z_]+$/.test(code))return code;
  const reason=/STOPPED|EXPIRED|CONNECTION_CHANGED/.test(code)?'중지·연결 변경 또는 실행 기한 만료로 취소했습니다.':/UNAVAILABLE|UNSUPPORTED|AMBIGUOUS/.test(code)?'사이트 함수나 화면 구조를 확인하지 못했습니다.':/CONTROL_CHANGED|INPUT_INVALID/.test(code)?'처리 대상이 바뀌었거나 입력할 수 없는 상태입니다.':'사이트 코드 실행 결과를 확인하지 못했습니다.';
  return reason+' 중복 실행하지 않고 중지합니다. ['+code+']';
}
module.exports={invokeSiteFunction,CODE_ACTIONS,siteCodeMessage};
