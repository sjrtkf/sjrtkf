'use strict';
const {labelKey}=require('./preferences');
// Only current-event observed metadata is accepted. Historical venue presets
// never manufacture a mapping between a grade name and a block code.
function buildCatalog({rows=[],metadata=[],grades=[],title=''}){
  const areas=new Map(),blocks=new Map(),seats=new Map(),available=new Set(rows.filter(r=>r.kind==='seat'&&r.available).map(r=>r.id));
  const area=(name,code='')=>{if(!name)return;const key=labelKey(name),old=areas.get(key);areas.set(key,{name,code:code||old?.code||'',count:old?.count??null});};
  for(const g of grades)area(g.name,String(g.code));
  for(const r of rows)if(r.kind==='grade'){area(r.name);areas.get(labelKey(r.name)).count=r.count;}
  const names=new Map(grades.map(g=>[String(g.code),g.name]));
  for(const s of metadata){
    const name=s.grade||names.get(s.gradeCode)||'',code=s.blockKey||s.block;
    area(name,s.gradeCode);if(!code)continue;
    if(!blocks.has(code))blocks.set(code,{code,name:s.block,areas:[],areaCodes:[],seatCount:0});
    const b=blocks.get(code);if(name&&!b.areas.includes(name))b.areas.push(name);if(s.gradeCode&&!b.areaCodes.includes(s.gradeCode))b.areaCodes.push(s.gradeCode);b.seatCount++;
    seats.set(s.id,{id:s.id,block:code,area:name,row:s.displayRow||s.rowLabel||s.row,number:s.number,available:available.has(s.id)});
  }
  return {title,areas:[...areas.values()],blocks:[...blocks.values()].sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})),seats:[...seats.values()],partial:true,
    message:'현재 경기에서 읽은 구역·블록입니다. 아직 열지 않았거나 수신하지 않은 블록은 목록에 없을 수 있습니다.'};
}
module.exports={buildCatalog};
