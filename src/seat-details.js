'use strict';
const {readBookingContext}=require('./booking-context');
const {resolveGradeNames}=require('./grade-names');
// Read-only hydration for a helper attached after the site's network requests.
// Contracts observed in the site's public bundles on 2026-10-16. Session values
// stay inside this document; only whitelisted seat/grade fields are returned.
async function readDetails({expected,blockKeys=[],includeGrades=false,expiresAt}){
  const started=Date.now(),timings={metadataMs:0,gradesMs:0,totalMs:0};
  const keys=['goodsCode','placeCode','playSeq'];
  if(!expected||!keys.every(k=>typeof expected[k]==='string'&&/^\d{3,8}$/.test(expected[k]))||
    !Array.isArray(blockKeys)||blockKeys.length>2||new Set(blockKeys).size!==blockKeys.length||
    !Number.isFinite(expiresAt)||Date.now()>expiresAt)throw Error('상세 정보 요청 범위를 확인하지 못했습니다.');
  const shown=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const readContext=()=>readBookingContext().context;
  const c=readContext();
  const matches=x=>x?.goods?.goodsCode===expected.goodsCode&&x?.goods?.placeCode===expected.placeCode&&x?.playSeq?.playSeq===expected.playSeq;
  const check=()=>{
    const current=readContext();
    if(location.origin!=='https://tickets.interpark.com'||location.pathname!=='/onestop/seat'||new URL(location.href).searchParams.get('step')==='price'||
      !matches(current)||!c.sessionId||current.sessionId!==c.sessionId||Date.now()>expiresAt)throw Error('상세 정보를 읽는 동안 예매 화면 또는 세션이 바뀌었습니다.');
    if(c.goods.isInterlocking!==false||c.goods.reserved!==true)throw Error('확인된 일반 지정석만 상세 조회할 수 있습니다.');
    if([...document.querySelectorAll('img[alt="캡챠 이미지"],[role="alertdialog"],[role="dialog"][aria-modal="true"]')].some(shown)||
      [...document.querySelectorAll('button')].some(e=>shown(e)&&e.textContent.trim()==='확인하고 예매하기')||
      document.querySelector('circle.js-seat[class*="SeatMap_selected"]'))throw Error('안내·인증 또는 기존 선택을 먼저 확인해 주세요.');
    const expiry=Number(sessionStorage.getItem('interpark/preReserveExpireTime'));
    if(expiry>0&&Date.now()>=expiry)throw Error('좌석 선택 시간이 만료되었습니다.');
  };
  check();
  const observed=new Set([...document.querySelectorAll('circle.js-seat[id]')].map(e=>e.parentElement.id).filter(id=>id.startsWith('seat_block_')).map(id=>id.slice(11)));
  if(blockKeys.some(k=>typeof k!=='string'||k.length>100||!observed.has(k)))throw Error('현재 지도에 없는 구역은 조회하지 않습니다.');
  const baseHeaders={'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest','X-Onestop-Channel':c.channelType||'NOL','X-Onestop-Session':c.sessionId};
  const request=async(url,options)=>{
    check();const response=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000),...options});
    if(!response.ok)throw Error('좌석 상세 정보 응답을 확인하지 못했습니다.');
    const text=await response.text();if(text.length>12000000)throw Error('좌석 상세 정보 응답이 너무 큽니다.');
    const data=JSON.parse(text);check();return data;
  };
  let blocks=[],grades=[],gradeConflicts=[],duplicateCount=0;
  const blockTask=(async()=>{if(blockKeys.length){
    const began=Date.now();
    const params=new URLSearchParams({...expected,bizCode:c.bizCode||'WEBBR'});for(const key of blockKeys)params.append('blockKeys',key);
    const data=await request('/onestop/api/seatMeta?'+params,{method:'GET',headers:baseHeaders});
    const raw=Array.isArray(data)?data:data?.data;
    if(!Array.isArray(raw)||raw.length!==blockKeys.length||new Set(raw.map(b=>b.blockKey)).size!==blockKeys.length)throw Error('좌석 상세 정보의 구역 목록이 다릅니다.');
    blocks=raw.map(b=>{
      if(!blockKeys.includes(b.blockKey)||!Array.isArray(b.seats)||b.seats.length>20000)throw Error('좌석 상세 정보 형식이 다릅니다.');
      return {blockKey:b.blockKey,seats:b.seats.map(s=>{
        if(typeof s.seatInfoId!=='string'||!s.seatInfoId.startsWith(expected.goodsCode+':'+expected.placeCode+':'))throw Error('다른 상품의 좌석 상세 정보입니다.');
        return Object.fromEntries(['seatInfoId','rowIdx','colIdx','rowNo','floor','seatNo','seatGrade','seatGradeName','isExposable','seatGroupId'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
      })};
    });
    timings.metadataMs=Date.now()-began;
  }})();
  const gradeTask=(async()=>{if(includeGrades){
    const began=Date.now();
    const headers={...baseHeaders,'X-Ticket-BFF-Language':({ko:'KO',en:'EN',ja:'JA',zh:'ZH'})[c.lang||'ko']||'KO'};
    if(c.goods.preOpt)headers.Authorization='Bearer '+c.goods.preOpt;
    const data=await request('/onestop/gql',{method:'POST',headers,body:JSON.stringify({operationName:'HelperSeatGradeNames',query:'query HelperSeatGradeNames($input: GetRemainSeatSortInput) { getSeatGradePrices(input: $input) { seatGrade seatGradeName } }',variables:{input:{sort:'SEAT_GRADE_ASC',playSeq:expected.playSeq}}})});
    if(data?.errors?.length||!Array.isArray(data?.data?.getSeatGradePrices))throw Error('좌석 등급 이름을 확인하지 못했습니다.');
    // Match the site's seat label resolver: GetSeatGradePrices is shared by
    // map views and sports group views. GetRemainSeats is enabled only for
    // sports-group products, so it cannot serve as a universal name lookup.
    // Grade-price rows have no booking identity fields. The session/round and
    // current document are pinned before and after this uncached query.
    // Price rows may repeat a grade. Harmless spacing variants are one label;
    // genuinely different labels stay unresolved instead of aborting all grades
    // or silently assigning the last label to every seat with that code.
    ({grades,gradeConflicts,duplicateCount}=resolveGradeNames(data.data.getSeatGradePrices));
    timings.gradesMs=Date.now()-began;
  }})();
  // Independent read-only requests, bounded to two. Join both before returning
  // even after one fails, so no late result leaks into a subsequent run.
  const results=await Promise.allSettled([blockTask,gradeTask]);
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  check();timings.totalMs=Date.now()-started;return {blocks,grades,gradeConflicts,duplicateCount,timings};
}
module.exports={readDetails};
