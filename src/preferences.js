'use strict';
const {isWheelchairSingleton}=require('./metadata');
const defaults=Object.freeze({quantity:2,requireTogether:true,excludeObstructed:true,priority:'front',areas:[],blocks:[],tiers:[],fallbackAnywhere:true,autoComplete:true,autoNotice:true,autoCaptcha:true,manualCaptchaAssist:false,stopAfterCaptcha:false,excludeRestricted:true,selectionMethod:'click'});
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
    return {name:String(t.name||((i+1)+'순위')).trim()||((i+1)+'순위'),areas:list(t.areas),blocks:list(t.blocks),minRow,maxRow,aisle:'prefer',priority:'front'};
  });
  return {quantity,areas:list(input.areas),blocks:list(input.blocks),tiers,priority:'front',fallbackAnywhere:input.fallbackAnywhere!==false,requireTogether:input.requireTogether!==false,excludeObstructed:input.excludeObstructed!==false,autoComplete:input.autoComplete!==false,autoNotice:input.autoNotice!==false,autoCaptcha:true,manualCaptchaAssist:false,stopAfterCaptcha:input.stopAfterCaptcha===true,selectionMethod:input.selectionMethod==='api'?'api':'click',excludeRestricted:input.excludeRestricted!==false};
}
const labelKey=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const matchesArea=(value,seat)=>[seat.grade,seat.gradeCode,seat.name,seat.code].some(v=>v!=null&&labelKey(v)===labelKey(value));
const matchesBlock=(value,seat)=>{
  const key=v=>labelKey(v).replace(/(?:구역|블록|블럭)$/,'');
  return [seat.block,seat.blockKey,seat.blockName].some(v=>v!=null&&key(v)===key(value));
};
const unrestricted=tier=>!tier.areas.length&&!tier.blocks.length&&tier.minRow==null&&tier.maxRow==null;
const coversWholeGrade=(tier,grade)=>!tier.blocks.length&&tier.minRow==null&&tier.maxRow==null&&(!tier.areas.length||tier.areas.some(v=>matchesArea(v,grade)));
function effectiveTiers(p){
  const tiers=p.tiers.length?[...p.tiers]:[{name:p.areas.length||p.blocks.length?'기본 조건':'전체 구역',areas:p.areas,blocks:p.blocks,minRow:null,maxRow:null,aisle:'prefer',priority:p.priority,legacy:true}];
  // Explicit conditions are preferences. The final pass relaxes only location/row limits.
  if(p.fallbackAnywhere&&!tiers.some(unrestricted))tiers.push({name:'전체 구역 대안',areas:[],blocks:[],minRow:null,maxRow:null,aisle:'prefer',priority:p.priority,fallback:true});
  return tiers;
}
function locationScore(value){
  const label=labelKey(value);
  // Use confirmed labels only: block numbers and VIP/table prices do not identify distance.
  const side=/3루|삼루|중앙/.test(label)?0:1;
  const near=/필드|그라운드|익사이팅|덕아웃/.test(label)?0:/내야/.test(label)?1:2;
  return [side,near];
}
const compareScore=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
const groupKey=seats=>JSON.stringify(seats.map(s=>String(s.id)).sort());
function assessGradePlan(grades,input={}) {
  const p=normalizePreferences(input),tiers=effectiveTiers(p),plan=[];
  const assessed=(Array.isArray(grades)?grades:[]).filter(g=>g&&typeof g.name==='string').map(g=>{
    const parsed=g.count==null||String(g.count).trim()===''?null:Number(String(g.count).replaceAll(',',''));
    const count=Number.isFinite(parsed)?parsed:null,reasons=[];
    if(count!=null&&(count<=0||p.requireTogether&&count<p.quantity))reasons.push(count<=0?'inventory-empty':'inventory-insufficient');
    if(p.excludeRestricted&&/휠체어|장애인/.test(g.name))reasons.push('restricted');
    if(p.excludeObstructed&&/시야\s*방해/.test(g.name))reasons.push('obstructed');
    const allowedTiers=tiers.map((tier,i)=>(!tier.areas.length||tier.areas.some(v=>matchesArea(v,g)))&&(!tier.fallback||!tiers.slice(0,i).some(previous=>coversWholeGrade(previous,g)))?i:null).filter(i=>i!=null);
    if(!allowedTiers.length)reasons.push('area-mismatch');
    return {name:g.name,code:g.code==null?null:String(g.code),count,reasons,allowedTiers,eligible:!reasons.length};
  });
  for(const [tierIndex,tier] of tiers.entries()){
    const seen=new Set();
    const eligible=assessed.filter(g=>g.eligible&&g.allowedTiers.includes(tierIndex)).sort((a,b)=>compareScore(locationScore(a.name),locationScore(b.name)));
    for(const grade of eligible)if(!seen.has(grade.name)){seen.add(grade.name);plan.push({name:grade.name,tierIndex,tierName:tier.name,fallback:!!tier.fallback});}
  }
  const countReason=reason=>assessed.filter(g=>g.reasons.includes(reason)).length;
  const summary={gradeCount:assessed.length,eligibleGradeCount:assessed.filter(g=>g.eligible).length,emptyCount:countReason('inventory-empty'),insufficientCount:countReason('inventory-insufficient'),restrictedCount:countReason('restricted'),obstructedCount:countReason('obstructed'),areaMismatchCount:countReason('area-mismatch'),unknownCount:assessed.filter(g=>g.count==null).length};
  const allowed=assessed.filter(g=>!g.reasons.some(r=>['restricted','obstructed','area-mismatch'].includes(r)));
  const reason=plan.length?'ready':!assessed.length?'no-grades':!allowed.length?'conditions-excluded':allowed.every(g=>g.count!=null&&g.count<=0)?'inventory-empty':allowed.every(g=>g.count!=null&&g.count<p.quantity)?'inventory-insufficient':'conditions-excluded';
  return {plan,grades:assessed.map(({allowedTiers,...g})=>g),summary,reason};
}
function gradePlan(grades,input={}) {return assessGradePlan(grades,input).plan;}
const rowNumber=s=>isWheelchairSingleton(s)?s.rowIdx:s.row;
const aisleDistance=s=>s.aisle===true?0:Number.isInteger(s.aisleDistance)&&s.aisleDistance>=0?s.aisleDistance:Infinity;
const seatScore=s=>[...locationScore(s.grade),rowNumber(s),aisleDistance(s),s.colIdx??s.number];
const batchScore=seats=>[...locationScore(seats[0].grade),Math.max(...seats.map(rowNumber)),Math.min(...seats.map(aisleDistance)),seats[0].colIdx??seats[0].number];
const compareCounts=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return b[i]-a[i];return 0;};
function isTogether(seats){
  if(seats.length<2)return true;
  const first=seats[0],sameRow=s=>s.grade===first.grade&&s.block===first.block&&s.row===first.row&&(s.rowKind||'numeric')===(first.rowKind||'numeric')&&s.segment===first.segment;
  if(first.segment==null||!seats.every(s=>sameRow(s)&&Number.isInteger(s.colIdx)))return false;
  const ordered=[...seats].sort((a,b)=>a.colIdx-b.colIdx);
  return ordered.every((s,i)=>!i||s.colIdx===ordered[i-1].colIdx+1&&s.neighbors?.includes(ordered[i-1].id)&&ordered[i-1].neighbors?.includes(s.id));
}
function rankDispersed(seats,p,tiers,options,excludedIds,excludedGroups){
  const maximum=options.maxTierIndex??tiers.length-1;
  if(!Number.isInteger(maximum)||maximum<0)return [];
  const entries=[];
  // A seat belongs to its first matching tier, even if the same map was read
  // again while exploring a lower tier. Keep the newest duplicate observation.
  for(const s of new Map(seats.filter(Boolean).map(s=>[s.id,s])).values()){
    if(!s.available||excludedIds.has(s.id)||!s.grade||!s.block||p.excludeRestricted&&/휠체어|장애인/.test(s.grade)||p.excludeObstructed&&s.obstructed!==false)continue;
    const numbered=Number.isInteger(s.row)&&Number.isInteger(s.number),singleton=p.quantity===1&&isWheelchairSingleton(s);
    if(!numbered&&!singleton)continue;
    const tierIndex=tiers.findIndex(t=>(!t.areas.length||t.areas.some(v=>matchesArea(v,s)))&&(!t.blocks.length||t.blocks.some(v=>matchesBlock(v,s)))
      &&(t.minRow==null||numbered&&s.row>=t.minRow)&&(t.maxRow==null||numbered&&s.row<=t.maxRow));
    if(tierIndex<0||tierIndex>maximum||options.tierIndex!=null&&tierIndex!==options.tierIndex)continue;
    entries.push({seat:s,tierIndex});
  }
  entries.sort((a,b)=>a.tierIndex-b.tierIndex||compareScore(seatScore(a.seat),seatScore(b.seat))||String(a.seat.id).localeCompare(String(b.seat.id)));
  if(entries.length<p.quantity)return [];
  const candidate=indices=>{
    const chosen=indices.map(i=>entries[i]),batch=chosen.map(e=>e.seat),tierCounts=tiers.map(()=>0);
    for(const e of chosen)tierCounts[e.tierIndex]++;
    const tierIndex=chosen[chosen.length-1].tierIndex,tier=tiers[tierIndex];
    return {indices,rankSum:indices.reduce((sum,i)=>sum+i,0),tierCounts,group:{seats:batch,together:isTogether(batch),key:groupKey(batch),tierIndex,tierName:tier.name,fallback:chosen.some(e=>tiers[e.tierIndex].fallback===true),tierCounts}};
  };
  const compare=(a,b)=>compareCounts(a.tierCounts,b.tierCounts)||a.rankSum-b.rankSum||compareScore(a.indices,b.indices);
  const heap=[],seen=new Set();
  const push=indices=>{
    const key=indices.join(',');if(seen.has(key))return;seen.add(key);
    const node=candidate(indices);let i=heap.length;heap.push(node);
    while(i){const parent=(i-1)>>1;if(compare(heap[parent],node)<=0)break;heap[i]=heap[parent];i=parent;}heap[i]=node;
  };
  const pop=()=>{
    const first=heap[0],last=heap.pop();if(!heap.length)return first;
    let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&compare(heap[child+1],heap[child])<0)child++;if(compare(last,heap[child])<=0)break;heap[i]=heap[child];i=child;}heap[i]=last;return first;
  };
  const result=[],limit=p.quantity===1?entries.length:256;
  push(Array.from({length:p.quantity},(_,i)=>i));
  // Every q-combination is reachable by increasing its sorted indices. This
  // bounded best-first frontier includes non-sliding alternatives; excluded
  // groups still expand, so reranking continues beyond a failed result page.
  while(heap.length&&result.length<limit){
    const current=pop();
    if(!excludedGroups.has(current.group.key))result.push(current);
    for(let i=0;i<p.quantity;i++)if(current.indices[i]+1<(i+1<p.quantity?current.indices[i+1]:entries.length)){
      const next=[...current.indices];next[i]++;push(next);
    }
  }
  // A shared higher-priority back-row seat can make the aggregate row/aisle
  // score equal. Preserve each contributing seat's rank before any ID tie-break
  // so that lower tiers still prefer their front rows and aisle positions.
  result.sort((a,b)=>compareCounts(a.tierCounts,b.tierCounts)||compareScore(batchScore(a.group.seats),batchScore(b.group.seats))||a.rankSum-b.rankSum||compareScore(a.indices,b.indices)||a.group.key.localeCompare(b.group.key));
  return result.map(node=>node.group);
}
function rankGroups(seats,input={},options={}) {
  const p=normalizePreferences(input),excludedIds=new Set(options.excludedIds||[]),excludedGroups=new Set(options.excludedGroups||[]),seenKeys=new Set(),result=[];
  const tiers=effectiveTiers(p);
  if(!p.requireTogether)return rankDispersed(seats,p,tiers,options,excludedIds,excludedGroups);
  for(const [tierIndex,tier] of tiers.entries()){
    if(options.tierIndex!=null&&options.tierIndex!==tierIndex)continue;
    if(options.maxTierIndex!=null&&tierIndex>options.maxTierIndex)continue;
    // Explicit tiers come first, followed by the unrestricted alternative when enabled.
    const usable=seats.filter(s=>s.available&&!excludedIds.has(s.id)&&(Number.isInteger(s.row)&&Number.isInteger(s.number)||p.quantity===1&&isWheelchairSingleton(s)&&tier.minRow==null&&tier.maxRow==null)&&s.grade&&s.block
      &&(!p.excludeRestricted||!/휠체어|장애인/.test(s.grade))&&(!p.excludeObstructed||s.obstructed===false)&&(!tier.areas.length||tier.areas.some(v=>matchesArea(v,s)))&&(!tier.blocks.length||tier.blocks.some(v=>matchesBlock(v,s)))
      &&(tier.minRow==null||s.row>=tier.minRow)&&(tier.maxRow==null||s.row<=tier.maxRow)
      &&(!tier.fallback||!tiers.slice(0,tierIndex).some(previous=>coversWholeGrade(previous,s))));
    const byRow=new Map();
    for(const s of usable){const key=JSON.stringify([s.grade,s.block,s.row,s.rowKind||'numeric',s.segment]);if(!byRow.has(key))byRow.set(key,new Map());byRow.get(key).set(s.id,s);}
    const candidates=[];
    const add=(batch,together)=>{const key=groupKey(batch);if(excludedGroups.has(key)||seenKeys.has(key)||batch.length!==p.quantity)return;if(tier.aisle==='required'&&!batch.some(s=>s.aisle===true))return;candidates.push({seats:batch,together,key,tierIndex,tierName:tier.name,fallback:!!tier.fallback});};
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
    const score=g=>{const first=g.seats[0],row=Math.max(...g.seats.map(s=>isWheelchairSingleton(s)?s.rowIdx:s.row)),distance=Math.min(...g.seats.map(s=>s.aisle===true?0:Number.isInteger(s.aisleDistance)&&s.aisleDistance>=0?s.aisleDistance:Infinity));
      return [...locationScore(first.grade),row,distance,first.colIdx??first.number];};
    const compare=(a,b)=>compareScore(score(a),score(b))||a.key.localeCompare(b.key);
    candidates.sort(compare);
    for(const group of candidates)if(!seenKeys.has(group.key)){seenKeys.add(group.key);result.push(group);}
  }
  // UI display limits must not truncate the candidate pool used for recovery.
  return result;
}
module.exports={defaults,normalizePreferences,rankGroups,gradePlan,assessGradePlan,groupKey,labelKey,matchesArea,matchesBlock};
