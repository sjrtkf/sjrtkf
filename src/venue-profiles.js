'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {normalizePreferences}=require('./preferences');

// These are empty, independent settings containers, not a seat map/catalogue.
// Exact grade/block labels must come from the specific event's official guide.
const BUILTINS=Object.freeze([
  {id:'legacy',name:'기존 공통 설정',description:'이전에 저장한 좌석 조건입니다. 구장별 설정과 별도로 보존됩니다.'},
  {id:'lions-park',name:'대구 삼성 라이온즈파크',description:'최종 목표 구장 · 구역·블록은 해당 경기 공식 안내의 이름으로 입력하세요.'},
  {id:'champions-field',name:'광주 기아챔피언스필드',description:'광주 경기 준비용 · 구역·블록은 해당 경기 공식 안내의 이름으로 입력하세요.'},
  {id:'jamsil',name:'잠실야구장',description:'잠실 경기 준비용 · 구역·블록은 해당 경기 공식 안내의 이름으로 입력하세요.'},
  {id:'gangwon-fc',name:'강원 FC 경기 테스트',description:'축구 경기 적용 확인용 · 실제 경기장과 구역명은 대상 경기에서 확인하세요.'},
]);
const LIONS_REFERENCE=Object.freeze({
  title:'2025년 라이온즈파크 구역 참고',
  source:'사용자 Google Drive의 2025년 config.json · 매크로 좌석목록표 B4:B46',
  sourceUrl:'https://docs.google.com/spreadsheets/d/1tls6a_04OQcpbUOhhsx5czPxWPNLSxgSR_m5TR45o1E/edit',
  verifiedCurrent:false,
  note:'과거 자료입니다. 현재 경기의 공식 구역명·판매 단위와 대조한 뒤 선택하세요. 블록·통로 번호와 과거 선호 설정은 가져오지 않습니다.',
  areas:['VIP석','중앙테이블석(2인)','중앙테이블석(3인)','중앙테이블석(4인)','3루 테이블석(2인)','3루 테이블석(3인)','3루 테이블석(4인)','1루 테이블석(2인)','1루 테이블석(3인)','1루 테이블석(4인)','3루 익사이팅석','1루 익사이팅석','블루존','원정응원석','3루 내야지정석','1루 내야지정석','SKY요기보패밀리존(4인)','3루 SKY 지정석¹','3루 SKY 지정석²','중앙 SKY 지정석','1루 SKY 지정석','캠핑존(6인)','파티플로어라이브','루프탑 테이블석(4인)','3루 외야지정석','1루 외야지정석','외야패밀리석(2인)','외야패밀리석(3인)','외야패밀리석(4인)','외야테이블석(4인)','외야테이블석(8인)','3루 외야커플테이블석(2인)','1루 외야커플테이블석(2인)','3루 스윗박스(15인)²','3루 스윗박스(15인)³','1루 스윗박스(15인)','1루 스윗박스(25인)','1루 스윗박스(30인)','1루 테이블휠체어장애인석','블루 휠체어장애인석','원정응원 휠체어장애인석','3루 내야휠체어장애인석','잔디그린존'],
});
const LIMIT=40;
const clone=value=>JSON.parse(JSON.stringify(value));
function cleanName(value){
  const name=String(value??'').trim();
  if(!name||name.length>64||/[\u0000-\u001f\u007f]/.test(name))throw Error('구장 이름은 줄바꿈 없이 1~64자로 입력해 주세요.');
  return name;
}
function cleanPreferences(input){
  if(JSON.stringify(input??{}).length>65536)throw Error('좌석 조건이 너무 깁니다. 구역·블록 이름을 간단히 정리해 주세요.');
  return normalizePreferences(input);
}
function initialState(preferences){
  return {version:1,activeId:'legacy',profiles:BUILTINS.map(item=>({id:item.id,name:item.name,builtin:true,preferences:cleanPreferences(item.id==='legacy'?preferences:{}),updatedAt:null}))};
}
function normalizeVenueState(input,initialPreferences={}){
  if(input==null)return initialState(initialPreferences);
  if(input.version!==1||!Array.isArray(input.profiles)||input.profiles.length>LIMIT)throw Error('저장된 구장 설정 형식을 확인할 수 없습니다.');
  const state=initialState(initialPreferences),seen=new Set();
  for(const row of input.profiles){
    if(!row||typeof row!=='object'||typeof row.id!=='string'||seen.has(row.id))throw Error('구장 설정에 중복되거나 잘못된 항목이 있습니다.');
    const builtin=BUILTINS.find(item=>item.id===row.id);
    if(!builtin&&!/^custom-[a-z0-9-]{1,64}$/.test(row.id))throw Error('구장 설정 ID가 올바르지 않습니다.');
    seen.add(row.id);
    const profile={id:row.id,name:builtin?.name||cleanName(row.name),builtin:Boolean(builtin),preferences:cleanPreferences(row.preferences),updatedAt:Number.isFinite(row.updatedAt)&&row.updatedAt>=0?row.updatedAt:null};
    const index=state.profiles.findIndex(item=>item.id===row.id);
    if(index<0)state.profiles.push(profile);else state.profiles[index]=profile;
  }
  if(state.profiles.length>LIMIT)throw Error('구장 설정은 최대 '+LIMIT+'개까지 저장할 수 있습니다.');
  if(!state.profiles.some(item=>item.id===input.activeId))throw Error('선택된 구장 설정이 존재하지 않습니다.');
  state.activeId=input.activeId;
  return state;
}
function createVenueStore({filePath,initialPreferences={},now=Date.now}={}){
  if(typeof filePath!=='string'||!filePath)throw Error('구장 설정 저장 경로가 필요합니다.');
  let state=initialState(initialPreferences),warning='',recoveryBytes=null;
  try{
    const info=fs.statSync(filePath);
    if(info.size>2*1024*1024)throw Error('구장 설정 파일의 크기가 너무 큽니다.');
    const raw=fs.readFileSync(filePath);
    try{state=normalizeVenueState(JSON.parse(raw.toString('utf8')),initialPreferences);}
    catch(error){recoveryBytes=raw;warning='기존 구장 설정을 읽지 못했습니다. 기존 좌석 조건으로 시작하며, 다음 저장 전에 원본을 복구 파일로 보존합니다.';}
  }catch(error){if(error.code!=='ENOENT')throw error;}
  function getState(){
    const result=clone(state);
    for(const profile of result.profiles){
      profile.description=BUILTINS.find(item=>item.id===profile.id)?.description||'직접 만든 구장 설정 · 구역·블록은 해당 경기 안내의 이름으로 입력하세요.';
      if(profile.id==='lions-park')profile.reference=clone(LIONS_REFERENCE);
    }
    if(warning)result.warning=warning;
    return result;
  }
  function persist(next){
    const clean=normalizeVenueState(next,initialPreferences);
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    if(recoveryBytes){
      fs.writeFileSync(filePath+'.recovery-'+randomUUID()+'.json',recoveryBytes,{flag:'wx'});
      recoveryBytes=null;
    }
    const temporary=filePath+'.tmp-'+randomUUID();
    try{fs.writeFileSync(temporary,JSON.stringify(clean,null,2),{flag:'wx'});fs.renameSync(temporary,filePath);}
    finally{try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
    state=clean;warning='';return getState();
  }
  function updateCurrent(next,input){
    const profile=next.profiles.find(item=>item.id===next.activeId);
    profile.preferences=cleanPreferences(input);profile.updatedAt=now();
  }
  return {
    getState,
    getPreferences(){return clone(state.profiles.find(item=>item.id===state.activeId).preferences);},
    saveActive(input){const next=clone(state);updateCurrent(next,input);persist(next);return this.getPreferences();},
    select(id,currentPreferences){
      if(!state.profiles.some(item=>item.id===id))throw Error('불러올 구장 설정을 찾지 못했습니다.');
      const next=clone(state);if(currentPreferences!=null)updateCurrent(next,currentPreferences);next.activeId=id;persist(next);return this.getPreferences();
    },
    create(name,currentPreferences){
      name=cleanName(name);
      if(state.profiles.some(item=>item.name===name))throw Error('같은 이름의 구장 설정이 있습니다. 다른 이름을 입력해 주세요.');
      if(state.profiles.length>=LIMIT)throw Error('구장 설정은 최대 '+LIMIT+'개까지 저장할 수 있습니다.');
      const prefs=cleanPreferences(currentPreferences),next=clone(state),id='custom-'+randomUUID();
      updateCurrent(next,prefs);next.profiles.push({id,name,builtin:false,preferences:prefs,updatedAt:now()});next.activeId=id;persist(next);return this.getPreferences();
    },
    remove(id){
      const profile=state.profiles.find(item=>item.id===id);
      if(!profile)throw Error('삭제할 구장 설정을 찾지 못했습니다.');
      if(profile.builtin)throw Error('기본 구장 설정은 삭제할 수 없습니다.');
      if(id===state.activeId)throw Error('사용 중인 구장 설정은 삭제할 수 없습니다. 다른 구장을 선택한 뒤 삭제해 주세요.');
      return persist({...clone(state),profiles:state.profiles.filter(item=>item.id!==id)});
    },
  };
}
module.exports={BUILTINS,LIONS_REFERENCE,normalizeVenueState,createVenueStore};
