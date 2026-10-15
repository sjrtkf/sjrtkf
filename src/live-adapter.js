'use strict';
// Observed 2026-09-10 on tickets.interpark.com/onestop/seat.
// The current DOM is the authority for availability and pointer targeting.
function liveRead() {
  const visible = el => {const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&s.visibility==='visible'&&s.display!=='none';};
  if(document.querySelector('img[alt="캡챠 이미지"]')) return {rows:[],message:'보안문자를 먼저 입력해 주세요.'};
  const circles=[...document.querySelectorAll('circle.js-seat[id]')];
  if(circles.length){
    const candidates=circles.filter(el=>!el.getAttribute('class').includes('SeatMap_disabled')&&!el.getAttribute('class').includes('SeatMap_selected')&&visible(el));
    const rows=candidates.map((el,i)=>({kind:'seat',id:el.id,label:`${el.parentElement.id.split(':').pop()}블럭 · 후보 ${i+1}`,available:true,group:el.parentElement.id,fill:el.getAttribute('fill'),cx:el.getAttribute('cx'),cy:el.getAttribute('cy')}));
    return {rows,message:`현재 보이는 지도에서 ${candidates.length}개 후보 · 열·번호·시야방해 정보가 연결된 좌석만 자동 추천`};
  }
  const rows=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].map(el=>{
    const name=el.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim();
    const count=el.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent?.trim();
    return {kind:'grade',id:name,label:`${name} · ${count}석`,available:!!name&&Number(count?.replaceAll(',',''))>0,name,count};
  }).filter(r=>r.available);
  return {rows,message:rows.length?'사이트에 표시된 구역별 잔여석 · 구역을 연 뒤 직접 좌석 선택으로 진입하세요.':'구역 또는 직접 좌석 선택 화면을 열어 주세요. 화면 구조가 변경된 경우 연동 확인이 필요합니다.'};
}
function liveAction({row,action}) {
  if(!['focus','click'].includes(action)) throw new Error('지원하지 않는 동작입니다.');
  let el;
  if(row.kind==='grade') {
    const matches=[...document.querySelectorAll('button[class*="SportsSeatGradeList_contentItem__"]')].filter(e=>e.querySelector('[class*="SportsSeatGradeList_contentGradeName__"]')?.textContent?.trim()===row.name);
    if(matches.length!==1) throw new Error('구역 목록이 변경되었습니다. 다시 확인해 주세요.');
    el=matches[0];
    if(el.querySelector('[class*="SportsSeatGradeList_contentRemainCount__"]')?.textContent?.trim()!==row.count) throw new Error('잔여석 수가 변경되었습니다. 다시 확인해 주세요.');
    el.scrollIntoView({block:'center'});el.focus();if(action==='click')el.click();return true;
  }
  el=document.getElementById(row.id);
  if(el?.matches('circle.js-seat[id]')&&el.getAttribute('class').includes('SeatMap_disabled')&&!el.getAttribute('class').includes('SeatMap_selected'))throw new Error('SEAT_UNAVAILABLE: 사이트에서 해당 좌석이 선택 불가 상태로 바뀌었습니다.');
  if(!el||!el.matches('circle.js-seat[id]')||el.parentElement.id!==row.group||el.getAttribute('fill')!==row.fill||el.getAttribute('cx')!==row.cx||el.getAttribute('cy')!==row.cy||el.getAttribute('class').includes('SeatMap_disabled')||el.getAttribute('class').includes('SeatMap_selected')) throw new Error('좌석 상태가 변경되었습니다. 다시 확인해 주세요.');
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  if(r.width<=0||r.height<=0||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)throw new Error('지도가 이동했습니다. 현재 화면의 좌석을 다시 확인해 주세요.');
  const hit=document.elementFromPoint(x,y);
  if(hit!==el&&hit!==el.previousElementSibling)throw new Error('좌석 위에 다른 화면이 열려 있습니다. 닫은 뒤 다시 시도해 주세요.');
  if(action==='focus') {el.animate([{strokeWidth:'1',stroke:'#ff2670'},{strokeWidth:'5',stroke:'#ff2670'},{strokeWidth:'1',stroke:'#ff2670'}],{duration:1200,iterations:2});return true;}
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,buttons:1,isPrimary:true}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,pointerId:1,pointerType:'mouse',button:0,buttons:0,isPrimary:true}));
  return true;
}
const readScript=()=>`(${liveRead.toString()})()`;
const clickScript=(row,action)=>`(${liveAction.toString()})(${JSON.stringify({row,action})})`;
function supportedUrl(value){try{const u=new URL(value);return u.origin==='https://tickets.interpark.com'&&u.pathname==='/onestop/seat';}catch{return false;}}
module.exports={liveRead,liveAction,readScript,clickScript,supportedUrl};
