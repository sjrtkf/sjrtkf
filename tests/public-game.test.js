'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {resolveGame}=require('../src/public-game');
const wrestling={goodsCode:'26011907',placeCode:'26000694',placeName:'PWS STUDIO',sport:{playDate:'2026-10-25',playTime:'16:00',homeOrganization:{name:'PWS 프로레슬링'},awayOrganization:null}};
function fixture({teams=['PWS 프로레슬링'],info='평택 NextStep+PWS공식사인회10월 25일(일) 16:00PWS STUDIO',games=[wrestling],duplicateCard=false}={}){
  const key=info+' | '+teams.join(' vs '),card={querySelector:()=>({textContent:info}),querySelectorAll:()=>teams.map(alt=>({alt}))},calls=[];
  const sandbox={URL,AbortSignal,location:{origin:'https://nol.yanolja.com',pathname:'/ticket/genre/sports/pws'},document:{querySelectorAll:()=>Array.from({length:duplicateCard?2:1},()=>({parentElement:card}))},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{widgets:[{widgetType:'GOODS_RESERVATION',contents:[{contentType:'GOODS_RESERVATION',link:{type:'API_URL',url:'/sports/goods?page=0&size=10&homeTeamCode=PF010'}}]}]}:{content:games}};}};
  vm.createContext(sandbox);return {calls,key,run:(args={})=>vm.runInContext(`(${resolveGame.toString()})(${JSON.stringify({key,...args})})`,sandbox)};
}
test('wrestling one-organization cards resolve to the exact official product without an opponent',async()=>{
  const f=fixture(),result=await f.run();assert.deepEqual(JSON.parse(JSON.stringify(result)),{goodsCode:'26011907',placeCode:'26000694',playDate:'20261025',playTime:'16:00'});assert.equal(f.calls.length,2);
});
test('two-team postseason cards retain home/away and date-time-place verification',async()=>{
  const game={...wrestling,goodsCode:'26014425',placeCode:'26000514',placeName:'잠실야구장',sport:{playDate:'2026-10-23',playTime:'18:30',homeOrganization:{name:'KIA 타이거즈'},awayOrganization:{name:'LG 트윈스'}}};
  const result=await fixture({teams:['KIA 타이거즈','LG 트윈스'],info:'2026 준플레이오프 5차전 10월 23일(금) 18:30 잠실야구장',games:[game]}).run();assert.equal(result.goodsCode,game.goodsCode);
});
test('single-organization support never accepts a missing opponent or different date, time, venue or organization',async()=>{
  for(const changed of [{placeName:'다른 구장'},{sport:{...wrestling.sport,playDate:'2026-10-26'}},{sport:{...wrestling.sport,playTime:'17:00'}},{sport:{...wrestling.sport,awayOrganization:{name:'다른 팀'}}},{sport:{...wrestling.sport,homeOrganization:{name:'다른 주최'}}}])await assert.rejects(fixture({games:[{...wrestling,...changed}]}).run(),/일치하지 않아/);
});
test('ambiguous products or cards cannot select an arbitrary event',async()=>{
  await assert.rejects(fixture({games:[wrestling,{...wrestling,goodsCode:'26014115'}]}).run(),/일치하지 않아/);
  const f=fixture({duplicateCard:true});await assert.rejects(f.run(),/한 개/);assert.equal(f.calls.length,0);
});
test('missing date/time or host stops before any public request',async()=>{
  for(const options of [{teams:[]},{teams:['']},{info:'PWS STUDIO'}]){const f=fixture(options);await assert.rejects(f.run(),/날짜·시각·주최/);assert.equal(f.calls.length,0);}
});

test('a live sale retains its original opening and closing times from the official API in KST',async()=>{
  const f=fixture({games:[{...wrestling,bookingOpenTime:'2026-10-15T15:00:00',bookingEndTime:'2026-10-25T17:00:59'}]});
  const result=await f.run({includeSchedule:true});assert.equal(result.openAt,Date.parse('2026-10-15T15:00:00+09:00'));assert.equal(result.endAt,Date.parse('2026-10-25T17:00:59+09:00'));assert.equal(result.openingSource,'공식 경기 API');
});
test('batch listing lookup shares one public schedule fetch and reports ambiguous matches explicitly',async()=>{
  const f=fixture({games:[wrestling,{...wrestling,goodsCode:'26000000'}]});const result=await f.run({keys:[f.key]});assert.equal(result[0].openAt,null);assert.match(result[0].openingReason,/유일하게/);assert.equal(f.calls.length,2);
});
test('missing, impossible and timezone-ambiguous schedule values never fabricate an opening time',async()=>{
  for(const value of [undefined,'2026-02-30T15:00:00','2026-10-15T25:00:00','2026-10-15T15:00:00Z']){const result=await fixture({games:[{...wrestling,bookingOpenTime:value}]}).run({includeSchedule:true});assert.equal(result.openAt,null);assert.match(result.openingReason,/유효한/);}
});
