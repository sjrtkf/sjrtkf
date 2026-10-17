'use strict';
// Self-contained: copied into the static extension bundle at build time.
function resolveGradeNames(rows){
  if(!Array.isArray(rows)||rows.length>10000)throw Error('좌석 등급 목록 형식을 확인하지 못했습니다.');
  const groups=new Map();let duplicateCount=0;
  for(const row of rows){
    if(row===null)continue;
    const code=row?.seatGrade??row?.code,raw=row?.seatGradeName??row?.name;
    if(!['string','number'].includes(typeof code)||!String(code).trim()||String(code).length>100||typeof raw!=='string'||!raw.trim()||raw.length>300)throw Error('좌석 등급 코드·이름 형식을 확인하지 못했습니다.');
    const name=raw.normalize('NFKC').replace(/\s+/g,' ').trim(),key=name.replace(/\s+/g,'').toLowerCase(),id=String(code).trim();
    if(!groups.has(id))groups.set(id,new Map());
    const names=groups.get(id);if(names.has(key))duplicateCount++;else names.set(key,name);
  }
  const grades=[],gradeConflicts=[];
  for(const [code,names] of groups){
    if(names.size===1)grades.push({code,name:[...names.values()][0]});
    else gradeConflicts.push({code,names:[...names.values()]});
  }
  return {grades,gradeConflicts,duplicateCount};
}
module.exports={resolveGradeNames};
