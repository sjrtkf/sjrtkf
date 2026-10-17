'use strict';
globalThis.BaseballParsers=(()=>{
const ORIGIN='https://tickets.interpark.com',ENTRY_ORIGIN='https://ent-waiting-api.interpark.com',ENTRY_PATH='/waiting/api/secure-url';
const CONFLICT_CODES=new Set(['P40054','P41150','P41149','P40021']);
const OPERATIONS={PreselectSeat:['select','preselectSeat'],BulkPreselectSeats:['select','bulkPreselectSeats'],DeselectSeat:['deselect','deselectSeat'],BulkDeselectSeats:['deselect','bulkDeselectSeats']};
const seatIds=values=>[...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==='string'&&v.length<=200).map(v=>v.startsWith('seat_block_')?v:'seat_block_'+v))];
return {
metadata:{
parseMetadata:function parseMetadata(body){
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
},
metadataUrl:function metadataUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&u.origin===ORIGIN&&['/onestop/api/seatMeta','/onestop/api/externalSeatMeta'].includes(u.pathname);}catch{return false;}},
},
seatNetwork:{
classifyRequest:function classifyRequest(request) {
  let url, body;
  try { url = new URL(request.url); } catch { return null; }
  if (url.origin !== ORIGIN || request.method !== 'POST') return null;
  const gql = url.pathname === '/onestop/gql';
  const complete = ['/onestop/api/seats/select', '/onestop/api/seats/select-external'].includes(url.pathname);
  if (!gql && !complete) return null;
  try { body = JSON.parse(request.postData); } catch { return complete ? {kind: 'complete', seatIds: []} : null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return complete ? {kind: 'complete', seatIds: []} : null;
  if (complete) return {kind: 'complete', seatIds: seatIds(Array.isArray(body.seats) ? body.seats.map(s => s?.seatInfoId) : [])};
  const name = body.operationName || /\bmutation\s+(\w+)/.exec(body.query || '')?.[1];
  const operation = OPERATIONS[name];
  if (!operation || !new RegExp('\\bmutation\\s+' + name + '\\b').test(body.query || '')) return null;
  const command = body.variables?.command;
  return {kind: operation[0], field: operation[1], seatIds: seatIds(command?.seatInfoIds || [command?.seatInfoId])};
},
classifyResponse:function classifyResponse(record, statusCode, text) {
  let body;
  try { body = JSON.parse(text); } catch { return {status: 'uncertain', seatIds: []}; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body.errors != null && !Array.isArray(body.errors))) return {status: 'uncertain', seatIds: []};
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const codes = errors.map(e => e?.extensions?.backendErrorCode);
  codes.push(body?.backendErrorCode, body?.data?.backendErrorCode, body?.properties?.backendErrorCode);
  const conflict = codes.some(c => CONFLICT_CODES.has(c));
  const rejectedIds = seatIds(body?.data?.unselectableSeatInfoIds || body?.data?.data?.unselectableSeatInfoIds || body?.unselectableSeatInfoIds);
  if (conflict) return {status: 'conflict', seatIds: rejectedIds.length ? rejectedIds : record.kind === 'select' && record.seatIds.length === 1 ? record.seatIds : []};
  if (statusCode < 200 || statusCode >= 300 || errors.length || codes.some(Boolean) || body?.success === false || body?.data?.success === false) return {status: 'uncertain', seatIds: []};
  if (record.field && (!body?.data || !Object.hasOwn(body.data, record.field) || body.data[record.field] == null || body.data[record.field] === false)) return {status: 'uncertain', seatIds: []};
  // Completion HTTP success is never proof of entering the next booking stage.
  return {status: 'ok', seatIds: record.seatIds};
},
},
entryNetwork:{
isEntryRequest:function isEntryRequest(request){
  if(!request||request.method!=='POST'||typeof request.url!=='string')return false;
  try{
    const url=new URL(request.url);
    return url.origin===ENTRY_ORIGIN&&url.pathname===ENTRY_PATH&&!url.username&&!url.password;
  }catch{return false;}
},
classifyEntryResponse:function classifyEntryResponse(status,body){
  let data;try{data=typeof body==='string'?JSON.parse(body):body;}catch{return {outcome:'unknown',code:'INVALID_RESPONSE'};}
  if(!data||typeof data!=='object'||Array.isArray(data))return {outcome:'unknown',code:'INVALID_RESPONSE'};
  const code=typeof data.error==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(data.error)?data.error:null;
  if(status===429)return {outcome:'blocked',code:'RATE_LIMITED'};
  if(status>=200&&status<300&&!data.error){
    try{const u=new URL(data.redirectUrl);if(u.origin==='https://tickets.interpark.com'&&!u.username&&!u.password&&!u.hash&&!/\/(?:error|fail)(?:\/|$)/i.test(u.pathname)&&!u.searchParams.has('errorCode')&&!u.searchParams.has('error')&&/^\/(?:waiting(?:\/|$)|onestop(?:\/|$))/.test(u.pathname))return {outcome:'redirect-ready',code:'VALID_REDIRECT'};}catch{}
    return {outcome:'unknown',code:'INVALID_REDIRECT'};
  }
  // P40057 is the published onestop PRODUCT_NOT_OPEN code. Only an explicit
  // rejection carrying that exact code qualifies; never infer it from HTTP 403.
  // Its occurrence on secure-url has not yet been observed in a live opening.
  if(status>=400&&status<500&&![401,429].includes(status)&&code==='P40057'&&!data.redirectUrl)return {outcome:'not-open',code};
  return {outcome:status>=400&&status<500?'blocked':'unknown',code:code||'UNCLASSIFIED_RESPONSE'};
},
},
};})();
