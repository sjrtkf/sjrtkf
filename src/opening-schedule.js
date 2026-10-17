'use strict';
function openingPlan({requested,official,strategy,now=Date.now()}){
  const supplied=requested!=null&&requested!=='';
  const openAt=supplied?Number(requested):official??null;
  if(openAt!=null&&(!Number.isFinite(openAt)||openAt<=0||openAt>now+15*86400000))throw Error('15일 이내의 올바른 예매 시작 시각을 입력해 주세요.');
  if(strategy==='clock'&&openAt==null)throw Error('예매 시작 시각을 확인하지 못했습니다. 예약 시각을 입력하거나 경기 목록에서 시작해 주세요.');
  return {openAt:openAt??now,clockEligible:strategy==='clock'&&openAt!=null};
}
async function readPostseasonOpening(goodsCode,fetcher){
  if(!/^\d{8}$/.test(goodsCode))throw Error('상품 코드를 확인하지 못했습니다.');
  const base='https://nol.yanolja.com/ticket/genre/sports/api/bff';
  const read=async url=>{const r=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('공식 시작 시각 조회 실패');return r.json();};
  const org=await read(base+'/sports/display/organizations/postseason');
  const links=(org.widgets||[]).filter(w=>w.widgetType==='GOODS_RESERVATION').flatMap(w=>w.contents||[]).filter(c=>c.contentType==='GOODS_RESERVATION'&&c.link?.type==='API_URL').map(c=>c.link.url);
  if(links.length!==1||!/^\/sports\/goods\?/.test(links[0])||/[#\r\n]/.test(links[0]))return null;
  const data=await read(base+links[0]),rows=[...(data.content||[])];
  if(data.totalPages>1){if(!Number.isInteger(data.totalPages)||data.totalPages>10||data.pageNumber!==0)return null;for(let page=1;page<data.totalPages;page++){const u=new URL(base+links[0]);u.searchParams.set('page',String(page));const part=await read(u.href);if(part.pageNumber!==page||!Array.isArray(part.content))return null;rows.push(...part.content);}}
  const matches=rows.filter(g=>g.goodsCode===goodsCode);if(matches.length!==1)return null;
  const g=matches[0],value=g.bookingOpenTime;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value))return null;
  const stamp=Date.parse(value+'Z');if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,19)!==value)return null;
  return {openAt:stamp-9*3600000,goodsCode:g.goodsCode,placeCode:g.placeCode};
}
module.exports={openingPlan,readPostseasonOpening};
