'use strict';
const ORIGIN='https://tickets.interpark.com';
function metadataUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&u.origin===ORIGIN&&['/onestop/api/seatMeta','/onestop/api/externalSeatMeta'].includes(u.pathname);}catch{return false;}}
function parseMetadata(body){
  // Keep this helper inside the parser: extension/build.js serializes the
  // parser as a standalone function into the static extension bundle.
  function parseRow(value){
    // Football seatMeta observed 2026-10-16 uses e.g. "W1구역 10열".
    // Strip only this explicit area prefix; never infer a row from arbitrary text.
    const raw=String(value??''),qualified=raw.match(/^([A-Z]\d{1,2})구역\s+(\d+|[A-Z])열$/);
    const text=qualified?qualified[2]:raw,numeric=text.match(/^(\d+)(?:열)?$/);
    if(numeric){const row=Number(numeric[1]);return {row,rowLabel:String(row),rowKind:'numeric'};}
    // Support the observed single uppercase-letter labels only. A is ordinal
    // 1 for filtering; rowIdx/colIdx and neighbors still decide adjacency.
    const alpha=text.match(/^([A-Z])(?:열)?$/);
    if(alpha)return {row:alpha[1].charCodeAt(0)-64,rowLabel:alpha[1],rowKind:'alpha'};
    return {row:null,rowLabel:null,rowKind:null};
  }
  const payload=typeof body==='string'?JSON.parse(body):body;
  const blocks=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:[];
  const result=[];
  for(const block of blocks){
    if(typeof block.blockKey!=='string'||!Array.isArray(block.seats))continue;
    const byRow=new Map();
    for(const seat of block.seats){
      if(!seat||typeof seat.seatInfoId!=='string'||!Number.isInteger(seat.rowIdx)||!Number.isInteger(seat.colIdx))continue;
      const rowKey=seat.rowIdx;
      if(!byRow.has(rowKey))byRow.set(rowKey,[]);
      byRow.get(rowKey).push(seat);
    }
    for(const rowSeats of byRow.values()){
      rowSeats.sort((a,b)=>a.colIdx-b.colIdx);
      const cols=new Set(rowSeats.map(s=>s.colIdx));
      const edges=rowSeats.filter(s=>!cols.has(s.colIdx-1)||!cols.has(s.colIdx+1)).map(s=>s.colIdx);
      let segment=0;
      for(let i=0;i<rowSeats.length;i++){
        const s=rowSeats[i];if(i&&s.colIdx>rowSeats[i-1].colIdx+1)segment++;
        const rowInfo=parseRow(s.rowNo),rawNumber=String(s.seatNo??'').match(/^(\d+)(?:번)?$/);
        result.push({id:'seat_block_'+s.seatInfoId,block:block.blockKey.split(':').pop(),blockKey:block.blockKey,gradeCode:String(s.seatGrade??''),grade:typeof s.seatGradeName==='string'?s.seatGradeName:null,
          ...rowInfo,displayRow:typeof s.rowNo==='string'?s.rowNo:rowInfo.rowLabel+'열',floor:typeof s.floor==='string'?s.floor:'',number:rawNumber?Number(rawNumber[1]):null,rowIdx:s.rowIdx,colIdx:s.colIdx,
          segment:`${block.blockKey}:${s.rowIdx}:${segment}`,
          aisle:!cols.has(s.colIdx-1)||!cols.has(s.colIdx+1),
          aisleDistance:Math.min(...edges.map(col=>Math.abs(col-s.colIdx))),
          neighbors:rowSeats.filter(x=>Math.abs(x.colIdx-s.colIdx)===1).map(x=>'seat_block_'+x.seatInfoId),
          exposable:s.isExposable===true,grouped:s.seatGroupId!=null});
      }
    }
  }
  return result;
}
function attachMetadata(wc,onData,onGrades,onError,onReset=()=>{}){
  const pending=new Map();
  let generation=0,contextKey=null;
  const reset=()=>{generation++;pending.clear();onReset();};
  wc.on('did-start-navigation',(_e,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace){contextKey=null;reset();}});
  try{wc.debugger.attach('1.3');}catch{onError('좌석 상세 정보 연결을 시작하지 못했습니다.');return;}
  wc.debugger.sendCommand('Network.enable',{maxTotalBufferSize:16000000,maxResourceBufferSize:12000000}).catch(()=>onError('좌석 상세 정보 읽기를 활성화하지 못했습니다.'));
  wc.debugger.on('message',async(_event,method,params)=>{
    if(method==='Network.requestWillBeSent'){
      let u;try{u=new URL(params.request.url);}catch{}
      if(metadataUrl(params.request.url))pending.set(params.requestId,{kind:'meta',generation});
      if(u?.origin===ORIGIN&&u.pathname.startsWith('/onestop/')&&/\bquery\s+(GetRemainSeats|GetSeatGradePrices)\b/.test(params.request.postData||'')){
        let variables;try{variables=JSON.parse(params.request.postData).variables;}catch{}
        if(variables){const key=JSON.stringify(variables);if(contextKey!==null&&contextKey!==key)reset();contextKey=key;}
        pending.set(params.requestId,{kind:'grades',generation,field:/\bquery\s+GetSeatGradePrices\b/.test(params.request.postData)?'getSeatGradePrices':'getRemainSeats'});
      }
    }
    if(method==='Network.responseReceived'&&metadataUrl(params.response.url)&&params.response.status!==200)pending.delete(params.requestId);
    if(method==='Network.loadingFailed')pending.delete(params.requestId);
    if(method!=='Network.loadingFinished'||!pending.has(params.requestId))return;
    const record=pending.get(params.requestId);pending.delete(params.requestId);
    try{if(params.encodedDataLength>12000000)throw Error('좌석 정보 크기 초과');const response=await wc.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});if(record.generation!==generation)return;const body=response.base64Encoded?Buffer.from(response.body,'base64').toString('utf8'):response.body;if(body.length>12000000)throw Error('좌석 정보 크기 초과');if(record.kind==='meta'){const rows=parseMetadata(body);if(rows.length)onData(rows);}else {const rows=JSON.parse(body)?.data?.[record.field];if(Array.isArray(rows))onGrades(rows.filter(s=>s&&s.seatGrade!=null&&typeof s.seatGradeName==='string').map(s=>({code:String(s.seatGrade),name:s.seatGradeName})));}}catch{if(record.generation===generation&&!wc.isDestroyed())onError('좌석 상세 정보를 읽지 못했습니다. 자동 선택을 대기합니다.');}
  });
  wc.once('destroyed',()=>pending.clear());
}
function enrich(rows,metadata,grades){return rows.map(row=>{
  const m=metadata?.get(row.id);if(!m)return row;
  const grade=m.grade||grades?.get(m.gradeCode)||null;
  return {...row,...m,grade,available:row.available&&m.exposable&&!m.grouped,obstructed:grade?/시야\s*방해/.test(grade):null,label:grade&&m.row!=null&&m.number!=null?`${grade} · ${m.block}블럭 ${m.rowLabel??m.row}열 ${m.number}번`:row.label};
});}
module.exports={metadataUrl,parseMetadata,attachMetadata,enrich};
