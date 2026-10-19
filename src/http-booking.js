'use strict';
const {readBookingContext}=require('./booking-context');
const {parseSeatLabels}=require('./metadata');

// Mirrors the normal price-page data contract, not a DOM quantity control.
// Ordinary adult prices only; membership, voucher and certified discounts stop.
function planAdultPrices(payload,seats){
  const groups=Array.isArray(payload)?payload:payload?.prices;
  if(!Array.isArray(groups)||!groups.length||groups.length>500||payload?.toping?.code)throw Error('PRICE_RESPONSE_UNSUPPORTED');
  const counts=new Map();for(const seat of seats)counts.set(String(seat.seatGrade),(counts.get(String(seat.seatGrade))||0)+1);
  const plan=[];
  for(const [grade,count] of counts){
    const matches=groups.filter(g=>String(g?.seatGrade)===grade);
    if(matches.length!==1||!Array.isArray(matches[0].priceList))throw Error('PRICE_GRADE_AMBIGUOUS');
    const group=matches[0],clean=v=>String(v??'').normalize('NFKC').replace(/[\s/·\[\]]/g,'');
    const adult=group.priceList.filter(p=>p&&String(p.seatGrade)===grade&&['PG002','PG004','PG007'].includes(p.pgCode)&&clean(String(p.priceGradeName||'')+String(p.discountName||''))==='예매가성인');
    if(adult.length!==1)throw Error('ADULT_PRICE_AMBIGUOUS');
    const p=adult[0];
    if(typeof p.priceGrade!=='string'||!p.priceGrade||p.isMembership||p.isHPointCertify||p.isRandomCertifyOnce||p.randomCertifySeq&&String(p.randomCertifySeq)!=='0'||p.kindOfDiscount&&String(p.kindOfDiscount)!=='0'||p.dblDiscountOrNot||p.kindOfSettle||p.issueCode||p.cardKind)throw Error('PRICE_REQUIRES_CERTIFICATION');
    if(p.priceSettingType){
      const type=p.priceSettingType,n=Number(p.priceSettingCount);
      if(!['L8003','L8004','L8005','L8006'].includes(type)||!Number.isInteger(n)||n<1)throw Error('PRICE_RULE_UNSUPPORTED');
      if(type==='L8003'&&count%n||type==='L8004'&&count<n||type==='L8005'&&count>n||type==='L8006'&&count!==n)throw Error('PRICE_QUANTITY_LIMIT');
    }
    const amount=Number(p.discountSalesPrice),original=Number(p.salesPrice);
    if(p.discountSalesPrice==null||p.salesPrice==null||!Number.isFinite(amount)||amount<0||amount!==original||Number(p.discountValue||0)!==0)throw Error('ADULT_PRICE_UNSUPPORTED');
    if(!Number.isInteger(Number(p.priceMaxCount))||Number(p.priceMaxCount)<count||!Number.isInteger(Number(group.ticketMaxCount))||Number(group.ticketMaxCount)<count||p.remainCount!=null&&Number(p.remainCount)<count)throw Error('PRICE_QUANTITY_LIMIT');
    plan.push({selectedSeatCount:count,pgPrice:{...p,priceMaxCount:Math.min(Number(p.priceMaxCount),Number(group.ticketMaxCount))}});
  }
  return plan;
}

// One HTTP request per step keeps the extension's command timeout bounded.
// Browser session values and full server price records never leave the document.
async function httpBookingAction(arg={}){
  const KEY='baseball/http-booking',CONTEXT='interpark/context';
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const context=()=>readBookingContext().context;
  const identity=c=>['goodsCode','placeCode'].map(k=>c.goods?.[k]).concat(c.playSeq?.playSeq).join(':');
  const fingerprint=c=>JSON.stringify([c.goods,c.playSeq,c.sessionId,c.channelType,c.bizCode,c.seats||[],c.prices||[]]);
  const receipt=s=>sessionStorage.setItem(KEY,JSON.stringify({runId:s.runId,identity:s.identity,sessionId:s.context.sessionId,contextSignature:s.expected,stage:s.stage,held:s.held.map(v=>v.seatInfoId),seatsSignature:JSON.stringify(s.held),pricesSignature:JSON.stringify(s.prices||[]),confirmed:s.confirmed===true,validated:s.validated===true,route:s.route||null,cancelled:s.cancelled===true,mutationStarted:s.mutationStarted,at:Date.now()}));
  const summary=s=>({stage:s.stage,status:s.status||'pending',code:s.code||null,httpStatus:s.httpStatus||null,apiCode:s.apiCode||null,heldCount:s.held.length,confirmed:s.confirmed===true,validated:s.validated===true,requestCount:s.requestCount,route:s.route||null,...(s.changedIds?{changedIds:s.changedIds}:{}),...(s.unavailableIds?{unavailableIds:s.unavailableIds}:{})});
  let s=window.__ticketHttpBooking;
  if(arg.action==='begin'){
    if(typeof arg.runId!=='string'||arg.runId.length>120||!Number.isFinite(arg.expiresAt)||Date.now()>arg.expiresAt)throw Error('HTTP_COMMAND_EXPIRED');
    if(s?.runId===arg.runId)return summary(s);
    let old;try{old=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch{throw Error('HTTP_RECEIPT_UNREADABLE');}
    const c=context();
    const resumeSelected=arg.resumeSelected===true;
    const selectedReceipt=resumeSelected&&old?.stage==='selected'&&old.sessionId===c.sessionId&&old.seatsSignature===JSON.stringify(c.seats);
    // Only an explicit persisted proof that no mutation started permits a
    // cancelled read-only attempt to restart. Older/unknown receipts stay locked.
    const cancelledReadOnly=old?.cancelled===true&&old.mutationStarted===false&&Array.isArray(old.held)&&old.held.length===0&&old.confirmed===false&&old.validated===false&&['metadata','prices','status','preselect'].includes(old.stage);
    if(s?.pending||!selectedReceipt&&(s?.held?.length&&s.context.sessionId===c.sessionId||old&&old.sessionId===c.sessionId&&!cancelledReadOnly&&!['released','rejected'].includes(old.stage)))throw Error('HTTP_PREVIOUS_RESULT_PENDING');
    if(!arg.expected||identity(c)!==[arg.expected.goodsCode,arg.expected.placeCode,arg.expected.playSeq].join(':'))throw Error('HTTP_IDENTITY_CHANGED');
    if(c.goods?.isInterlocking!==false||c.goods?.reserved!==true||c.goods?.reservedSeat===false||c.nonReservedSeatGrade||c.channelType&&c.channelType!=='NOL'||c.partnerInfo&&Object.keys(c.partnerInfo).length||c.goods?.nonReservedGoodsCode)throw Error('HTTP_SEAT_SYSTEM_UNSUPPORTED');
    if((c.prices||[]).some(p=>p.selectedSeatCount>0))throw Error('HTTP_EXISTING_PRICE_SELECTION');
    const resume=arg.resumePrice===true;
    const seats=resume?(c.seats||[]).map(v=>({id:'seat_block_'+v.seatInfoId,blockKey:v.blockKey,gradeCode:v.seatGrade})):arg.seats;
    if(!Array.isArray(seats)||seats.length!==arg.quantity||seats.length<1||seats.length>4||new Set(seats.map(v=>v.id)).size!==seats.length)throw Error('HTTP_SEAT_COUNT_INVALID');
    if(Number.isFinite(Number(c.goods.ticketMaxCount))&&seats.length>Number(c.goods.ticketMaxCount))throw Error('HTTP_TICKET_LIMIT');
    if(!resume&&!resumeSelected&&(c.seats?.length||document.querySelector('circle.js-seat[class*="SeatMap_selected"]')))throw Error('HTTP_EXISTING_SELECTION');
    if(resume&&new URL(location.href).searchParams.get('step')!=='price')throw Error('HTTP_PRICE_PAGE_REQUIRED');
    for(const v of seats)if(typeof v.id!=='string'||!v.id.startsWith('seat_block_'+c.goods.goodsCode+':'+c.goods.placeCode+':')||typeof v.blockKey!=='string'||!/^\d+$/.test(String(v.gradeCode)))throw Error('HTTP_SEAT_CODE_INVALID');
    if(resumeSelected&&(!Array.isArray(c.seats)||c.seats.length!==seats.length||c.seats.some(v=>!seats.some(w=>w.id==='seat_block_'+v.seatInfoId&&String(w.gradeCode)===String(v.seatGrade)))))throw Error('HTTP_EXISTING_SELECTION_MISMATCH');
    s={runId:arg.runId,identity:identity(c),context:c,expected:fingerprint(c),expiresAt:arg.expiresAt,seats,blocks:[...new Set(seats.map(v=>v.blockKey))],metadataOrder:{},records:[],held:resume||resumeSelected?[...c.seats]:[],resume,resumeSelected,stopAfterSeats:arg.stopAfterSeats===true,confirmed:resume,stage:resume?'prices':'metadata',requestCount:0,cancelled:false,mutationStarted:resume||resumeSelected};
    window.__ticketHttpBooking=s;receipt(s);return summary(s);
  }
  if(!s||s.runId!==arg.runId)throw Error('HTTP_RUN_MISMATCH');
  if(arg.action==='status')return summary(s);
  if(arg.action==='cancel'){s.cancelled=true;if(!s.pending&&s.mutationStarted===false&&!s.held.length){s.stage='rejected';s.status='blocked';s.code='HTTP_CANCELLED';}receipt(s);return summary(s);}
  if(arg.action!=='step')throw Error('HTTP_ACTION_UNSUPPORTED');
  if(s.pending)return summary(s);
  if(s.status||['ready','selected'].includes(s.stage))return summary(s);
  const check=(cleanup=false)=>{
    const c=context();
    if(identity(c)!==s.identity||fingerprint(c)!==s.expected)throw Error('HTTP_CONTEXT_CHANGED');
    if(!cleanup&&(s.cancelled||Date.now()>s.expiresAt))throw Error('HTTP_CANCELLED');
    const sessionExpiry=Number(sessionStorage.getItem('interpark/bsRef'));
    const seatExpiry=Number(sessionStorage.getItem(s.confirmed?'interpark/reserveExpireTime':'interpark/preReserveExpireTime'));
    if(sessionExpiry>0&&Date.now()>=sessionExpiry||seatExpiry>0&&Date.now()>=seatExpiry)throw Error('HTTP_SESSION_EXPIRED');
    if(!cleanup){
      if([...document.querySelectorAll('img[alt="캡챠 이미지"],[role="alertdialog"],[role="dialog"][aria-modal="true"],[aria-busy="true"],[class*="EntLoading_wrap__"]')].some(shown)||[...document.querySelectorAll('button')].some(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기'))throw Error('HTTP_PAGE_BLOCKED');
      if(c.goods?.checkCaptcha===true&&!sessionStorage.getItem('interpark/captchaVerify'))throw Error('HTTP_CAPTCHA_REQUIRED');
    }
    return c;
  };
  const saveSeats=()=>{const c=check(true);c.seats=[...s.held];sessionStorage.setItem(CONTEXT,JSON.stringify(c));s.expected=fingerprint(c);if(fingerprint(context())!==s.expected)throw Error('HTTP_STORAGE_WRITE_FAILED');};
  const gql=(operation,field,type,command)=>({operationName:operation,query:`mutation ${operation}($command: ${type}!) { ${field}(command: $command) }`,variables:{command}});
  const request=async(url,body,{field,cleanup=false,mutation=false}={})=>{
    const c=check(cleanup),headers={'Content-Type':'application/json','X-Onestop-Channel':c.channelType||'NOL','X-Onestop-Session':c.sessionId,'X-Ticket-BFF-Language':({ko:'KO',en:'EN',ja:'JA',zh:'ZH'})[c.lang||'ko']||'KO','X-OneStop-Trace-ID':crypto.randomUUID().replaceAll('-','').slice(0,16)};
    if(url==='/onestop/gql'&&c.goods.preOpt)headers.Authorization='Bearer '+c.goods.preOpt;else headers['X-Requested-With']='XMLHttpRequest';
    s.requestCount++;s.inFlightMutation=mutation;if(mutation)s.mutationStarted=true;s.httpStatus=null;s.apiCode=null;receipt(s);
    let response,data;
    try{response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7500)});const text=await response.text();if(text.length>12000000)throw Error();data=JSON.parse(text);}catch{throw Error(mutation?'HTTP_OUTCOME_UNKNOWN':'HTTP_READ_FAILED');}
    s.httpStatus=response.status;
    const codes=[...(data?.errors||[]).map(e=>e?.extensions?.backendErrorCode),data?.backendErrorCode,data?.data?.backendErrorCode,data?.data?.data?.backendErrorCode,data?.properties?.backendErrorCode].filter(Boolean);
    s.apiCode=codes.filter(v=>typeof v==='string'&&/^[A-Z]\d{4,8}$/.test(v)).slice(0,3).join(',')||null;
    // A rejection is recoverable only when every reported error is a known
    // seat conflict. Mixed errors, HTTP failures and unknown shapes stop.
    const known=new Set(['P40054','P41150','P41149','P40021']);
    if(response.status<500&&!cleanup&&mutation&&codes.length&&codes.every(v=>known.has(v))&&(!data.errors||data.errors.every(e=>known.has(e?.extensions?.backendErrorCode))))return {conflict:true};
    if(!response.ok||codes.length||data?.errors?.length||data?.success===false||field&&data?.data?.[field]!==true)throw Error(mutation?'HTTP_OUTCOME_UNKNOWN':'HTTP_RESPONSE_REJECTED');
    return {data};
  };
  s.pending=true;
  try{
    check(s.stage==='release');
    if(s.stage==='metadata'){
      const blocks=s.blocks.splice(0,2),c=s.context,params=new URLSearchParams({goodsCode:c.goods.goodsCode,placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,bizCode:c.bizCode||'WEBBR'});blocks.forEach(k=>params.append('blockKeys',k));
      const {data}=await request('/onestop/api/seatMeta?'+params);check();const list=Array.isArray(data)?data:data?.data;
      if(!Array.isArray(list)||list.length!==blocks.length||new Set(list.map(b=>b.blockKey)).size!==blocks.length)throw Error('HTTP_METADATA_MISMATCH');
      for(const blockKey of blocks){const block=list.find(v=>v.blockKey===blockKey);if(!Array.isArray(block?.seats)||!block.seats.length||block.seats.some(v=>typeof v?.seatInfoId!=='string')||new Set(block.seats.map(v=>v.seatInfoId)).size!==block.seats.length)throw Error('HTTP_METADATA_MISMATCH');s.metadataOrder[blockKey]=block.seats.map(v=>v.seatInfoId);}
      for(const wanted of s.seats.filter(v=>blocks.includes(v.blockKey))){
        const block=list.find(v=>v.blockKey===wanted.blockKey),found=block?.seats?.filter(v=>v.seatInfoId===wanted.id.slice(11));
        if(found?.length!==1){s.changedIds=[wanted.id];throw Error('HTTP_METADATA_CHANGED');}const v=found[0];
        // The observed wheelchair map uses block / Wn-1 labels and a group
        // containing exactly one seat. Recheck the complete returned metadata;
        // neither a cached flag nor the group ID suffix alone authorizes it.
        const blockLabel=wanted.blockKey.split(':').pop();
        const singleton=s.seats.length===1&&wanted.singletonGroup===true&&wanted.labelFormat==='wheelchair-block'&&wanted.groupSize===1&&wanted.grouped===true&&wanted.exposable===true
          &&typeof v.seatGradeName==='string'&&/휠체어|장애인/.test(v.seatGradeName)&&/^\d+$/.test(blockLabel)&&wanted.block===blockLabel
          &&wanted.rawRowLabel===v.rowNo&&v.rowNo===blockLabel+'블록'&&wanted.rawSeatNumber===v.seatNo&&typeof v.seatNo==='string'&&v.seatNo.length<=80&&/^W[1-9]\d*-1$/.test(v.seatNo)
          &&wanted.row===null&&wanted.number===null&&wanted.seatGroupId===v.seatGroupId&&v.seatGroupId===v.seatInfoId+'::1::1'
          &&Number.isSafeInteger(v.rowIdx)&&v.rowIdx>=0&&Number.isSafeInteger(v.colIdx)&&v.colIdx>=0
          &&list.flatMap(b=>Array.isArray(b?.seats)?b.seats:[]).filter(member=>member?.seatGroupId===v.seatGroupId).length===1;
        const labels=parseSeatLabels(v.rowNo,v.seatNo),sameLabels=Number.isSafeInteger(labels.row)&&Number.isSafeInteger(labels.number)&&labels.row===wanted.row&&labels.rowLabel===wanted.rowLabel&&labels.rowKind===wanted.rowKind&&labels.number===wanted.number;
        // A per-seat name overrides a shared grade-code label. Preserve the
        // established missing-name fallback, but re-rank a changed explicit
        // name so restricted/obstructed and area filters run on fresh metadata.
        const gradeKey=value=>typeof value==='string'?value.normalize('NFKC').replace(/\s+/g,'').toLowerCase():null;
        const nameChanged=v.seatGradeName!=null&&v.seatGradeName!==''&&(!gradeKey(v.seatGradeName)||gradeKey(v.seatGradeName)!==gradeKey(wanted.grade));
        if(String(v.seatGrade)!==String(wanted.gradeCode)||v.isExposable!==true||v.rowIdx!==wanted.rowIdx||v.colIdx!==wanted.colIdx
          ||nameChanged||(v.seatGroupId!=null?!singleton:wanted.singletonGroup===true||!sameLabels)){s.changedIds=[wanted.id];throw Error('HTTP_METADATA_CHANGED');}
        const fields=['seatInfoId','seatGrade','seatGradeName','salesPrice','floor','rowNo','seatNo','posLeft','posTop','isExposable','rowIdx','colIdx','seatGroupId'];
        s.records.push({...Object.fromEntries(fields.filter(k=>v[k]!==undefined).map(k=>[k,v[k]])),blockKey:wanted.blockKey,seatGrade:String(v.seatGrade),seatGradeName:v.seatGradeName||wanted.grade,isSelectable:true});
      }
      if(!s.blocks.length)s.stage=s.resumeSelected?'prices':s.stopAfterSeats?'status':'prices';
    }else if(s.stage==='prices'){
      const c=s.context,params=new URLSearchParams({placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,bizCode:c.bizCode||'',entMemberCode:c.entMemberCode||'',seatType:c.goods.kindOfGoods==='01007'&&c.goods.isSportsGroup?'SPORTS':'DEFAULT',seatGrade:s.seats.map(v=>v.gradeCode).join(',')});
      const {data}=await request('/onestop/api/prices/'+c.goods.goodsCode+'?'+params);check();s.prices=planAdultPrices(data,s.resume?s.held:s.records);s.stage=s.resume?'validate':s.resumeSelected?'confirm':'status';
    }else if(s.stage==='status'){
      // The native client indexes MSB-first hex status bits by the complete,
      // unfiltered seatMeta order. This also validates seats outside the viewport.
      const remaining=s.records.filter(v=>!s.held.some(h=>h.seatInfoId===v.seatInfoId)),blocks=[...new Set(remaining.map(v=>v.blockKey))],c=s.context;
      const params=new URLSearchParams({goodsCode:c.goods.goodsCode,placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,bizCode:c.bizCode||'WEBBR'});blocks.forEach(k=>params.append('blockKeys',k));
      const {data}=await request('/onestop/api/seatStatus?'+params);check();
      if(!Array.isArray(data?.data)||data.data.length!==blocks.length)throw Error('HTTP_SEAT_STATUS_INVALID');
      const unavailable=[];
      for(let i=0;i<blocks.length;i++){
        const blockKey=blocks[i],ids=s.metadataOrder[blockKey],hex=data.data[i];
        if(!Array.isArray(ids)||typeof hex!=='string'||!/^[0-9a-f]+$/i.test(hex)||hex.length!==Math.ceil(ids.length/4))throw Error('HTTP_SEAT_STATUS_INVALID');
        const bits=[...hex].map(v=>parseInt(v,16).toString(2).padStart(4,'0')).join('');
        for(const v of remaining.filter(v=>v.blockKey===blockKey)){const index=ids.indexOf(v.seatInfoId);if(index<0)throw Error('HTTP_SEAT_STATUS_INVALID');if(bits[index]!=='1')unavailable.push('seat_block_'+v.seatInfoId);}
      }
      if(unavailable.length){s.unavailableIds=unavailable;s.code='HTTP_SEAT_CHANGED';s.stage='release';}
      else{s.statusCheckedAt=Date.now();s.stage='preselect';}
    }else if(s.stage==='preselect'){
      const v=s.records[s.held.length],el=document.getElementById('seat_block_'+v.seatInfoId);
      if(!Number.isFinite(s.statusCheckedAt)||Date.now()-s.statusCheckedAt>20000)s.stage='status';
      else if(el&&(!el.matches('circle.js-seat[id]')||el.parentElement?.id!=='seat_block_'+v.blockKey||/SeatMap_(?:disabled|selected)/.test(el.getAttribute('class')||''))){s.stage='release';s.code='HTTP_SEAT_CHANGED';s.unavailableIds=['seat_block_'+v.seatInfoId];}
      else{
        const grouped=v.seatGroupId!=null,field=grouped?'bulkPreselectSeats':'preselectSeat';
        const r=await request('/onestop/gql',gql(grouped?'BulkPreselectSeats':'PreselectSeat',field,grouped?'BulkPreselectSeatsCommand':'PreselectSeatCommand',{playSeq:s.context.playSeq.playSeq,blockKey:v.blockKey,seatGrade:v.seatGrade,...(grouped?{seatInfoIds:[v.seatInfoId]}:{seatInfoId:v.seatInfoId})}),{field,mutation:true});
        if(r.conflict){s.stage='release';s.code='HTTP_SEAT_CONFLICT';}
        else{s.held.push(v);check(true);saveSeats();if(s.held.length===1)sessionStorage.setItem('interpark/preReserveExpireTime',String(Date.now()+420000));check();if(s.held.length===s.records.length)s.stage=s.stopAfterSeats?'selected':'confirm';}
      }
    }else if(s.stage==='confirm'){
      const c=s.context,r=await request('/onestop/api/seats/select',{goodsCode:c.goods.goodsCode,placeCode:c.goods.placeCode,playSeq:c.playSeq.playSeq,seatType:c.goods.kindOfGoods==='01007'&&c.goods.isSportsGroup?'SPORTS':'DEFAULT',sessionId:c.sessionId,seats:s.held.map(v=>({seatGrade:v.seatGrade,seatInfoId:v.seatInfoId})),autoAssign:false},{mutation:true});
      if(r.conflict){s.stage='release';s.code='HTTP_CONFIRM_CONFLICT';}
      else{if(!Array.isArray(r.data?.unselectableSeatInfoIds)||r.data.unselectableSeatInfoIds.length)throw Error('HTTP_CONFIRMATION_UNKNOWN');s.confirmed=true;check(true);sessionStorage.setItem('interpark/reserveExpireTime',String(Date.now()+420000));check();s.stage='validate';}
    }else if(s.stage==='validate'){
      const c=s.context;await request('/onestop/gql',{operationName:'ValidatePricingSelection',query:'query ValidatePricingSelection($playSeq: String!, $upperBizCode: String, $selectedPrices: [PricingSelectionItemInput!]!) { validatePricingSelection(playSeq: $playSeq, upperBizCode: $upperBizCode, selectedPrices: $selectedPrices) }',variables:{playSeq:c.playSeq.playSeq,upperBizCode:c.goods.upperBizCode,selectedPrices:s.prices.map(v=>({seatGrade:v.pgPrice.seatGrade,priceGrade:v.pgPrice.priceGrade,selectCnt:v.selectedSeatCount}))}},{field:'validatePricingSelection'});
      check();s.validated=true;const current=context();current.prices=s.prices;sessionStorage.setItem(CONTEXT,JSON.stringify(current));s.expected=fingerprint(current);if(fingerprint(context())!==s.expected)throw Error('HTTP_STORAGE_WRITE_FAILED');
      const discount=s.prices.some(v=>Number(v.pgPrice.discountSeq||0)>0&&!['PG003'].includes(v.pgPrice.pgCode)&&v.pgPrice.kindOfDiscount!=='34020'&&!(v.pgPrice.pgCode==='PG001'&&v.pgPrice.kindOfDiscount==='34004'));
      s.route=['26003282','26003294'].includes(c.goods.goodsCode)||c.goods.isPreOrder&&!discount?'/preorder':'/payment';s.stage='ready';
    }else if(s.stage==='release'){
      if(s.held.length){const v=s.held.at(-1),grouped=v.seatGroupId!=null,field=grouped?'bulkDeselectSeats':'deselectSeat';await request('/onestop/gql',gql(grouped?'BulkDeselectSeats':'DeselectSeat',field,grouped?'BulkDeselectSeatsCommand':'DeselectSeatCommand',grouped?{seatInfoIds:[v.seatInfoId]}:{seatInfoId:v.seatInfoId}),{field,cleanup:true,mutation:true});check(true);s.held.pop();saveSeats();}
      if(!s.held.length){sessionStorage.removeItem('interpark/preReserveExpireTime');s.stage='released';s.status='conflict';}
    }else throw Error('HTTP_STAGE_INVALID');
    receipt(s);
  }catch(error){s.status=s.inFlightMutation||s.held.length?'uncertain':'blocked';s.code=/^[A-Z_]+$/.test(error.message)?error.message:'HTTP_UNEXPECTED_ERROR';if(s.status==='blocked')s.stage='rejected';receipt(s);}
  finally{s.pending=false;s.inFlightMutation=false;}
  return summary(s);
}

// Static MAIN-world action. Routing is local code, with no simulated click and
// no additional seat/price mutation. A validated receipt authorizes one route.
async function httpBookingNavigate({runId,expected,expiresAt,syncOnly=false,checkOnly=false}={}){
  if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat'||!Number.isFinite(expiresAt)||Date.now()>expiresAt)throw Error('HTTP_NAVIGATION_EXPIRED');
  const key='baseball/http-booking',r=JSON.parse(sessionStorage.getItem(key)||'null'),c=JSON.parse(sessionStorage.getItem('interpark/context')||'{}');
  if([c.goods?.goodsCode,c.goods?.placeCode,c.playSeq?.playSeq].join(':')!==[expected?.goodsCode,expected?.placeCode,expected?.playSeq].join(':'))throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  if(checkOnly){
    let runtime;
    if(typeof window.next?.router?.push!=='function'||!Array.isArray(window.webpackChunk_N_E))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
    window.webpackChunk_N_E.push([['baseball-http-check-'+runId],{},require=>{runtime=require;}]);
    const storage=runtime?.(74133)?.F,cache=runtime?.(25019)?.d;
    if(typeof storage?.getContextData!=='function'||JSON.stringify(storage.getContextData())!==JSON.stringify(c)||typeof cache?.mutate!=='function'||typeof cache?.cache?.keys!=='function'||![...cache.cache.keys()].some(k=>typeof k==='string'&&k.startsWith('/getContextData/')))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
    return {supported:true};
  }
  if(!r||r.runId!==runId||(syncOnly?r.stage!=='selected':r.stage!=='ready'||!r.confirmed||!r.validated)||r.cancelled||Date.now()-r.at>15000||r.identity!==[expected?.goodsCode,expected?.placeCode,expected?.playSeq].join(':')||r.identity!==[c.goods?.goodsCode,c.goods?.placeCode,c.playSeq?.playSeq].join(':'))throw Error('HTTP_NAVIGATION_NOT_CONFIRMED');
  if(r.contextSignature!==JSON.stringify([c.goods,c.playSeq,c.sessionId,c.channelType,c.bizCode,c.seats||[],c.prices||[]]))throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  if(!syncOnly&&!['/payment','/preorder'].includes(r.route)||c.sessionId!==r.sessionId||JSON.stringify(c.seats)!==r.seatsSignature||!syncOnly&&JSON.stringify(c.prices)!==r.pricesSignature||!Array.isArray(c.seats)||JSON.stringify(c.seats.map(v=>v.seatInfoId))!==JSON.stringify(r.held)||!syncOnly&&c.prices?.reduce((n,v)=>n+v.selectedSeatCount,0)!==r.held.length)throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  if(typeof window.next?.router?.push!=='function')throw Error('HTTP_ROUTER_UNAVAILABLE');
  // The native context hook uses SWR. Storage alone leaves a mounted route's
  // cached seats/prices stale. Use the inspected client's local cache updater;
  // no control events or price/seat requests are dispatched by this sync.
  let runtime;
  if(!Array.isArray(window.webpackChunk_N_E))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
  window.webpackChunk_N_E.push([['baseball-http-context-'+runId],{},require=>{runtime=require;}]);
  const storage=runtime?.(74133)?.F,cache=runtime?.(25019)?.d;
  if(typeof storage?.getContextData!=='function'||typeof cache?.mutate!=='function'||typeof cache?.cache?.keys!=='function'||JSON.stringify(storage.getContextData())!==JSON.stringify(c))throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
  if(!syncOnly)r.stage='navigating';sessionStorage.setItem(key,JSON.stringify(r));
  const keys=[...cache.cache.keys()].filter(k=>typeof k==='string'&&k.startsWith('/getContextData/'));
  if(!keys.length)throw Error('HTTP_CONTEXT_SYNC_UNAVAILABLE');
  for(const k of keys)await cache.mutate(k,c,{revalidate:false});
  if(JSON.stringify(storage.getContextData())!==JSON.stringify(c)||keys.some(k=>JSON.stringify(cache.cache.get(k)?.data)!==JSON.stringify(c)))throw Error('HTTP_NAVIGATION_CONTEXT_CHANGED');
  const latest=JSON.parse(sessionStorage.getItem(key)||'null');
  if(latest?.runId!==runId||latest.cancelled||Date.now()>expiresAt)throw Error('HTTP_NAVIGATION_EXPIRED');
  for(const k of ['interpark/bsRef',syncOnly?'interpark/preReserveExpireTime':'interpark/reserveExpireTime']){const expiry=Number(sessionStorage.getItem(k));if(expiry>0&&Date.now()>=expiry)throw Error('HTTP_SESSION_EXPIRED');}
  if(syncOnly)return {synchronized:true};
  const moved=await window.next.router.push(r.route);if(!moved)throw Error('HTTP_NAVIGATION_NOT_CONFIRMED');return {dispatched:true};
}
module.exports={planAdultPrices,httpBookingAction,httpBookingNavigate};
