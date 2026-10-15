'use strict';
const defaults=Object.freeze({quantity:2,requireTogether:true,excludeObstructed:true,priority:'front',areas:[],blocks:[],tiers:[],autoComplete:true,autoNotice:true,autoCaptcha:true,manualCaptchaAssist:true});
const list=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[\n,]/)).map(x=>String(x).trim()).filter(Boolean))];
function normalizePreferences(input={}) {
  const quantity=Number(input.quantity??defaults.quantity);
  if(!Number.isInteger(quantity)||quantity<1||quantity>4)throw new Error('좌석 수는 1~4매로 설정해 주세요.');
  if(input.tiers!=null&&!Array.isArray(input.tiers))throw new Error('조건 묶음 형식이 올바르지 않습니다.');
  const row=(value,label)=>{if(value==null||String(value).trim()==='')return null;const n=Number(value);if(!Number.isInteger(n)||n<1||n>9999)throw new Error(label+'은 1~9999 사이의 정수로 입력해 주세요.');return n;};
  const tiers=(input.tiers||[]).filter(t=>t?.enabled!==false).map((t,i)=>{
    if(!t||typeof t!=='object')throw new Error('조건 묶음 형식이 올바르지 않습니다.');
    const minRow=row(t.minRow,(i+1)+'순위 시작 열'),maxRow=row(t.maxRow,(i+1)+'순위 마지막 열');
    if(minRow!=null&&maxRow!=null&&minRow>maxRow)throw new Error((i+1)+'순위 시작 열은 마지막 열보다 클 수 없습니다.');
    return {name:String(t.name||((i+1)+'순위')).trim()||((i+1)+'순위'),areas:list(t.areas),blocks:list(t.blocks),minRow,maxRow,aisle:['any','prefer','required'].includes(t.aisle)?t.aisle:'prefer',priority:t.priority==='aisle'?'aisle':'front'};
  });
  return {quantity,areas:list(input.areas),blocks:list(input.blocks),tiers,priority:input.priority==='aisle'?'aisle':'front',requireTogether:input.requireTogether!==false,excludeObstructed:input.excludeObstructed!==false,autoComplete:input.autoComplete!==false,autoNotice:input.autoNotice!==false,autoCaptcha:input.autoCaptcha!==false,manualCaptchaAssist:input.manualCaptchaAssist!==false};
}
const priorityIndex=(value,values)=>{const i=values.indexOf(value);return i<0?Infinity:i;};
const effectiveTiers=p=>p.tiers.length?p.tiers:[{name:'기본 조건',areas:p.areas,blocks:p.blocks,minRow:null,maxRow:null,aisle:'prefer',priority:p.priority,legacy:true}];
const groupKey=seats=>JSON.stringify(seats.map(s=>String(s.id)).sort());
function gradePlan(grades,input={}) {
  const p=normalizePreferences(input),plan=[];
  for(const [tierIndex,tier] of effectiveTiers(p).entries()){
    const seen=new Set();
    const eligible=grades.filter(g=>g&&typeof g.name==='string'&&Number(String(g.count??0).replaceAll(',',''))>=p.quantity&&(!p.excludeObstructed||!/시야\s*방해/.test(g.name))&&(!tier.areas.length||tier.areas.includes(g.name)));
    if(tier.legacy&&tier.areas.length)eligible.sort((a,b)=>priorityIndex(a.name,tier.areas)-priorityIndex(b.name,tier.areas));
    for(const grade of eligible)if(!seen.has(grade.name)){seen.add(grade.name);plan.push({name:grade.name,tierIndex,tierName:tier.name});}
  }
  return plan;
}
function rankGroups(seats,input={},options={}) {
  const p=normalizePreferences(input),excludedIds=new Set(options.excludedIds||[]),excludedGroups=new Set(options.excludedGroups||[]),seenKeys=new Set(),result=[];
  for(const [tierIndex,tier] of effectiveTiers(p).entries()){
    if(options.tierIndex!=null&&options.tierIndex!==tierIndex)continue;
    // A tier's lists are equally allowed ranges. Only legacy lists encode an order.
    const usable=seats.filter(s=>s.available&&!excludedIds.has(s.id)&&Number.isInteger(s.row)&&Number.isInteger(s.number)&&s.grade&&s.block
      &&(!p.excludeObstructed||s.obstructed===false)&&(!tier.areas.length||tier.areas.includes(s.grade))&&(!tier.blocks.length||tier.blocks.includes(s.block))
      &&(tier.minRow==null||s.row>=tier.minRow)&&(tier.maxRow==null||s.row<=tier.maxRow));
    const byRow=new Map();
    for(const s of usable){const key=JSON.stringify([s.grade,s.block,s.row,s.rowKind||'numeric',s.segment]);if(!byRow.has(key))byRow.set(key,new Map());byRow.get(key).set(s.id,s);}
    const candidates=[];
    const add=(batch,together)=>{const key=groupKey(batch);if(excludedGroups.has(key)||seenKeys.has(key)||batch.length!==p.quantity)return;if(tier.aisle==='required'&&!batch.some(s=>s.aisle===true))return;candidates.push({seats:batch,together,key,tierIndex,tierName:tier.name});};
    for(const seatMap of byRow.values()){
      const group=[...seatMap.values()].sort((a,b)=>(a.colIdx??a.number)-(b.colIdx??b.number));
      for(let i=0;i+p.quantity<=group.length;i++){
        const batch=group.slice(i,i+p.quantity);
        // Seat labels can run in reverse or odd/even order; only physical adjacency counts.
        if(batch.length>1&&batch.some(s=>s.segment==null||!Number.isInteger(s.colIdx)))continue;
        if(batch.some((s,j)=>j>0&&(s.colIdx!==batch[j-1].colIdx+1||!s.neighbors?.includes(batch[j-1].id)||!batch[j-1].neighbors?.includes(s.id))))continue;
        add(batch,true);
      }
    }
    const score=g=>{const first=g.seats[0],row=Math.max(...g.seats.map(s=>s.row)),aisle=g.seats.some(s=>s.aisle===true)?0:g.seats.every(s=>s.aisle===false)?1:2;
      const within=tier.aisle==='any'?[row]:(tier.priority==='aisle'?[aisle,row]:[row,aisle]);
      return [...(tier.legacy?[tier.areas.length?priorityIndex(first.grade,tier.areas):0,tier.blocks.length?priorityIndex(first.block,tier.blocks):0]:[]),...within,first.colIdx??first.number];};
    const compare=(a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return a.key.localeCompare(b.key);};
    if(!candidates.length&&!p.requireTogether&&usable.length>=p.quantity){
      const singles=usable.map(s=>({seats:[s],key:groupKey([s])})).sort(compare);
      // Keep several ranked fallback batches without enumerating exponential combinations.
      for(let i=0;i+p.quantity<=singles.length;i++)add(singles.slice(i,i+p.quantity).map(x=>x.seats[0]),false);
    }
    candidates.sort(compare);
    for(const group of candidates)if(!seenKeys.has(group.key)){seenKeys.add(group.key);result.push(group);}
  }
  // UI display limits must not truncate the candidate pool used for recovery.
  return result;
}
module.exports={defaults,normalizePreferences,rankGroups,gradePlan,groupKey};
