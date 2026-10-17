'use strict';
// Read-only public listing lookup. No credentials, signed entry URLs or queue requests.
async function resolveGame({key,keys,includeSchedule=false}){
  const match=location.pathname.match(/^\/ticket\/genre\/sports\/([a-z0-9-]+)$/);
  if(location.origin!=='https://nol.yanolja.com'||!match)throw Error('구단 또는 포스트시즌 경기 목록에서 시작해 주세요.');
  const batch=Array.isArray(keys),requested=batch?keys:[key];
  if(!requested.length||requested.length>100||new Set(requested).size!==requested.length||requested.some(k=>typeof k!=='string'||k.length>2000))throw Error('대상 경기 목록을 확인하지 못했습니다.');
  const elements=[...document.querySelectorAll('button.grid-area_cta')].map(b=>b.parentElement);
  const cards=requested.map(wanted=>{
    const found=elements.filter(card=>card.querySelector('.grid-area_info')?.textContent.trim()+' | '+[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt).join(' vs ')===wanted);
    if(found.length!==1)throw Error('대상 경기 카드가 한 개로 확인되지 않습니다.');
    const card=found[0],info=card.querySelector('.grid-area_info').textContent.trim(),date=info.match(/(\d{1,2})월\s*(\d{1,2})일/),time=info.match(/(\d{1,2}:\d{2})/),teams=[...card.querySelectorAll('.grid-area_match img[alt]')].map(i=>i.alt);
    if(!date||!time||![1,2].includes(teams.length)||teams.some(name=>!name.trim()))throw Error('경기 날짜·시각·주최 정보를 확인하지 못했습니다.');
    return {key:wanted,info,date,time,teams};
  });
  const base='/ticket/genre/sports/api/bff';
  const read=async url=>{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('공개 경기 정보 조회에 실패했습니다.');return r.json();};
  const org=await read(base+'/sports/display/organizations/'+match[1]);
  const links=(org.widgets||[]).filter(w=>w.widgetType==='GOODS_RESERVATION').flatMap(w=>w.contents||[]).filter(c=>c.contentType==='GOODS_RESERVATION'&&c.link?.type==='API_URL').map(c=>c.link.url);
  if(links.length!==1||!/^\/sports\/goods\?/.test(links[0])||/[#\r\n]/.test(links[0]))throw Error('공식 경기 조회 경로를 확인하지 못했습니다.');
  const data=await read(base+links[0]),goods=[...(data.content||[])];
  // Follow only the public response's explicit pagination, with a bounded count.
  if(data.totalPages>1){
    if(!Number.isInteger(data.totalPages)||data.totalPages>10||data.pageNumber!==0)throw Error('공개 경기 목록 범위를 확인하지 못했습니다.');
    for(let page=1;page<data.totalPages;page++){const url=new URL(base+links[0],location.origin);url.searchParams.set('page',String(page));const next=await read(url.pathname+url.search);if(next.pageNumber!==page||!Array.isArray(next.content))throw Error('공개 경기 목록 페이지가 일치하지 않습니다.');goods.push(...next.content);}
  }
  const saleTime=value=>{
    const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);if(!m)return null;
    const [,y,mo,d,h,mi,se]=m.map(Number),utc=Date.UTC(y,mo-1,d,h,mi,se);
    if(new Date(utc).toISOString().slice(0,19)!==value)return null;
    return utc-9*3600000;
  };
  const results=cards.map(({key,info,date,time,teams})=>{
    const matches=goods.filter(g=>{const d=String(g.sport?.playDate||'').split('-'),organizations=[g.sport?.homeOrganization?.name,g.sport?.awayOrganization?.name].filter(name=>typeof name==='string'&&name.trim());return Number(d[1])===Number(date[1])&&Number(d[2])===Number(date[2])&&g.sport?.playTime===time[1]&&organizations.length===teams.length&&organizations.every((name,i)=>name===teams[i])&&typeof g.placeName==='string'&&info.includes(g.placeName);});
    if(matches.length!==1){if(batch)return {key,openAt:null,openingSource:null,openingReason:'공식 경기 응답과 카드가 유일하게 일치하지 않습니다.'};throw Error('공개 응답과 경기 카드가 일치하지 않아 진입을 중지했습니다.');}
    const g=matches[0];if(!/^\d{8}$/.test(g.goodsCode)||!/^\d{8}$/.test(g.placeCode))throw Error('상품·구장 코드 형식이 변경되었습니다.');
    const identity={goodsCode:g.goodsCode,placeCode:g.placeCode,playDate:g.sport.playDate.replaceAll('-',''),playTime:g.sport.playTime};
    if(!batch&&!includeSchedule)return identity;
    const openAt=saleTime(g.bookingOpenTime),endAt=saleTime(g.bookingEndTime);
    return {key,...identity,openAt,endAt,openingSource:openAt==null?null:'공식 경기 API',openingReason:openAt==null?'공식 응답에 유효한 일반 예매 시작 시각이 없습니다.':null};
  });
  return batch?results:results[0];
}
module.exports={resolveGame};
