'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {pageInfo}=require('../src/entry');
const image='https://ent-ticketimage.interparkcdn.net/display/articles/dde93f68007046eebe72bb7b5a7e91a7.jpg';
function read({text='',cards=[],images=[],title='2026 KBO 포스트시즌 - 와일드카드'}={}){
  const document={title:'NOL 티켓',body:{innerText:text},querySelector:()=>({textContent:title}),querySelectorAll:selector=>selector==='img[alt]'?images:cards};
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${pageInfo.toString()})()`,{document,location:{origin:'https://nol.yanolja.com',pathname:'/ticket/genre/sports/postseason'},Date,URL})));
}
test('공개 안내의 상품 없음과 정책을 읽으며 예매 시각은 만들지 않는다',()=>{
  const info=read({text:'예매 가능한 상품이 없어요 매수제한 : 회원별 4매 KBO 포스트시즌은 모바일티켓만 사용합니다. (신용카드 결제만 가능) 시야방해석이 아닌 경우에도 개인에 따라 시야에 방해가 될 수 있습니다.',images:[{alt:'26잠실경기장_좌석도.jpg',src:image}]});
  assert.equal(info.empty,true);assert.equal(info.cardCount,0);assert.equal(info.maxTickets,4);assert.equal(info.mobileOnly,true);assert.equal(info.cardOnly,true);
  assert.equal(info.notes.length,4);assert.equal(info.seatImages[0].url,image);assert.ok(Number.isFinite(info.checkedAt));
  assert.equal(Object.hasOwn(info,'openAt'),false);
});
test('빈 목록을 판매 없음으로 단정하지 않고 카드 존재와 명시적 문구를 구분한다',()=>{
  assert.equal(read({text:'경기 예매 로딩 중'}).empty,false);
  const info=read({text:'예매 가능한 상품이 없어요',cards:[{}]});
  assert.equal(info.empty,false);assert.equal(info.cardCount,1);
  assert.equal(read().maxTickets,null);
});
test('공식 좌석 이미지만 허용하고 토큰 링크·외부 호스트·중복을 제외한다',()=>{
  const imgs=[image,image,image+'?token=secret',image+'#secret',image.replace('ent-ticketimage.interparkcdn.net','evil.test'),image.replace('https://','https://user:pass@'),'javascript:alert(1)'];
  const info=read({text:'private unrelated account details',images:[...imgs.map(src=>({alt:'잠실_PS.jpg',src})),{alt:'두산_관람안내.jpg',src:image}]});
  assert.equal(info.seatImages.length,1);assert.equal(info.seatImages[0].label,'잠실_PS.jpg');
  assert.equal(JSON.stringify(info).includes('private unrelated'),false);assert.equal(JSON.stringify(info).includes('secret'),false);
});
test('다른 경기 안내를 이전 포스트시즌 정책으로 채우지 않는다',()=>{
  const info=read({title:'다른 구장 경기',text:'좌석 안내'});
  assert.equal(info.title,'다른 구장 경기');assert.equal(info.maxTickets,null);assert.equal(info.mobileOnly,false);assert.equal(info.cardOnly,false);assert.deepEqual(info.notes,[]);assert.deepEqual(info.seatImages,[]);
});
