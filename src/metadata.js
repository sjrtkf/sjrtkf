'use strict';
const ORIGIN='https://tickets.interpark.com';
function metadataUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&u.origin===ORIGIN&&['/onestop/api/seatMeta','/onestop/api/externalSeatMeta'].includes(u.pathname);}catch{return false;}}
// Shared by captured metadata and the fresh HTTP validation. The extension
// serializes this pure helper beside both consumers.
function parseSeatLabels(rowNo,seatNo){
  const raw=typeof rowNo==='string'||typeof rowNo==='number'?String(rowNo):'';
  const qualified=raw.match(/^([A-Z0-9가-힣]{1,24})구역\s+(\d+|[A-Z])열$/),text=qualified?qualified[2]:raw;
  const numeric=text.match(/^(\d+)(?:열)?$/),alpha=text.match(/^([A-Z])(?:열)?$/);
  let row=null,rowLabel=null,rowKind=null;
  if(numeric&&Number.isSafeInteger(Number(numeric[1]))){row=Number(numeric[1]);rowLabel=String(row);rowKind='numeric';}
  else if(alpha){row=alpha[1].charCodeAt(0)-64;rowLabel=alpha[1];rowKind='alpha';}
  const rawNumber=typeof seatNo==='string'||typeof seatNo==='number'?String(seatNo):'',numberMatch=rawNumber.match(/^(\d+)(?:번)?$/);
  const number=numberMatch&&Number.isSafeInteger(Number(numberMatch[1]))?Number(numberMatch[1]):null;
  return {row,rowLabel,rowKind,number,...(qualified?{blockName:qualified[1]+'구역'}:{})};
}
function parseMetadata(body){
  const diagnosticLabel=value=>typeof value==='string'?value.slice(0,80):typeof value==='number'&&Number.isFinite(value)?String(value).slice(0,80):null;
  const payload=typeof body==='string'?JSON.parse(body):body;
  const blocks=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:[];
  // Count every returned member, including hidden or unparseable seats. A
  // self-labelled one-member group is the only observed grouped format we use.
  const groupSizes=new Map();
  for(const block of blocks)for(const seat of Array.isArray(block?.seats)?block.seats:[])if(typeof seat?.seatGroupId==='string')groupSizes.set(seat.seatGroupId,(groupSizes.get(seat.seatGroupId)||0)+1);
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
        const rowInfo=parseSeatLabels(s.rowNo,s.seatNo);
        const blockLabel=block.blockKey.split(':').pop(),groupSize=typeof s.seatGroupId==='string'?groupSizes.get(s.seatGroupId):0;
        const singletonGroup=s.isExposable===true&&typeof s.seatGradeName==='string'&&/휠체어|장애인/.test(s.seatGradeName)&&/^\d+$/.test(String(s.seatGrade??''))&&/^\d+$/.test(blockLabel)
          &&s.rowNo===blockLabel+'블록'&&typeof s.seatNo==='string'&&s.seatNo.length<=80&&/^W[1-9]\d*-1$/.test(s.seatNo)
          &&Number.isSafeInteger(s.rowIdx)&&s.rowIdx>=0&&Number.isSafeInteger(s.colIdx)&&s.colIdx>=0&&groupSize===1&&s.seatGroupId===s.seatInfoId+'::1::1';
        result.push({id:'seat_block_'+s.seatInfoId,block:block.blockKey.split(':').pop(),blockKey:block.blockKey,gradeCode:String(s.seatGrade??''),grade:typeof s.seatGradeName==='string'?s.seatGradeName:null,
          hasMetadata:true,rawRowLabel:diagnosticLabel(s.rowNo),rawSeatNumber:diagnosticLabel(s.seatNo),
          singletonGroup,labelFormat:singletonGroup?'wheelchair-block':null,groupSize,seatGroupId:singletonGroup?s.seatGroupId:null,
          ...rowInfo,displayRow:typeof s.rowNo==='string'?s.rowNo:rowInfo.rowLabel+'열',floor:typeof s.floor==='string'?s.floor:'',rowIdx:s.rowIdx,colIdx:s.colIdx,
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
  const m=metadata?.get(row.id);if(!m)return row.kind==='grade'?row:{...row,hasMetadata:false,domAvailable:row.available===true};
  const grade=m.grade||grades?.get(m.gradeCode)||null;
  const singleton=isWheelchairSingleton({...m,grade});
  return {...row,...m,grade,hasMetadata:true,domAvailable:row.available===true,available:row.available&&m.exposable&&(!m.grouped||singleton),obstructed:grade?/시야\s*방해/.test(grade):null,label:singleton?`${grade} · ${m.rawRowLabel} ${m.rawSeatNumber}번`:grade&&m.row!=null&&m.number!=null?`${grade} · ${m.block}블럭 ${m.rowLabel??m.row}열 ${m.number}번`:row.label};
});}
function isWheelchairSingleton(seat){
  return seat?.singletonGroup===true&&seat.labelFormat==='wheelchair-block'&&seat.groupSize===1&&seat.grouped===true&&seat.exposable===true
    &&typeof seat.grade==='string'&&/휠체어|장애인/.test(seat.grade)&&typeof seat.gradeCode==='string'&&/^\d+$/.test(seat.gradeCode)
    &&typeof seat.id==='string'&&seat.id.startsWith('seat_block_')&&seat.seatGroupId===seat.id.slice(11)+'::1::1'
    &&typeof seat.block==='string'&&/^\d+$/.test(seat.block)&&seat.rawRowLabel===seat.block+'블록'
    &&typeof seat.rawSeatNumber==='string'&&seat.rawSeatNumber.length<=80&&/^W[1-9]\d*-1$/.test(seat.rawSeatNumber)
    &&Number.isSafeInteger(seat.rowIdx)&&seat.rowIdx>=0&&Number.isSafeInteger(seat.colIdx)&&seat.colIdx>=0;
}
function assessSeatRead(rows){
  const result={missingMetadataCount:0,unsupportedRowCount:0,unsupportedNumberCount:0,nonExposableCount:0,groupedCount:0,seatSamples:[]};
  const text=value=>typeof value==='string'?value.slice(0,80):typeof value==='number'&&Number.isFinite(value)?String(value).slice(0,80):null;
  const flags=value=>typeof value==='boolean'?value:null,integer=value=>Number.isSafeInteger(value)?value:null;
  const issues=[],supported=[];
  for(const row of Array.isArray(rows)?rows:[]){
    if(row?.kind!=='seat')continue;
    const reasons=[],hasMetadata=row.hasMetadata===true,singleton=isWheelchairSingleton(row);
    if(!hasMetadata){result.missingMetadataCount++;reasons.push('metadata-missing');}
    else{
      if(!Number.isInteger(row.row)&&!singleton){result.unsupportedRowCount++;reasons.push('row-format-unsupported');}
      if(!Number.isInteger(row.number)&&!singleton){result.unsupportedNumberCount++;reasons.push('number-format-unsupported');}
      if(row.exposable===false){result.nonExposableCount++;reasons.push('non-exposable');}
      if(row.grouped===true&&!singleton){result.groupedCount++;reasons.push('grouped-seat');}
      if(typeof row.grade!=='string'||!row.grade.trim())reasons.push('grade-unresolved');
    }
    if(row.domAvailable===false)reasons.push('dom-unavailable');
    const samples=reasons.length?issues:supported;
    if(samples.length<8)samples.push({gradeCode:text(row.gradeCode),grade:text(row.grade),block:text(row.block),blockName:text(row.blockName),rowLabel:text(row.rowLabel),rawRowLabel:text(row.rawRowLabel),rawSeatNumber:text(row.rawSeatNumber),rowIdx:integer(row.rowIdx),colIdx:integer(row.colIdx),hasMetadata,exposable:flags(row.exposable),grouped:flags(row.grouped),domAvailable:flags(row.domAvailable),reasons});
  }
  result.seatSamples=[...issues,...supported].slice(0,8);
  return result;
}
module.exports={metadataUrl,parseSeatLabels,parseMetadata,attachMetadata,enrich,assessSeatRead,isWheelchairSingleton};
