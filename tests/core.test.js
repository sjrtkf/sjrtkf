const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isHttps,isTicketOrigin,filterSeats,actionScript,DEMO_PROFILE}=require('../src/seat-core');
test('HTTPS만 허용하며 자격증명 삽입 URL을 거절한다',()=>{for(const url of ['javascript:alert(1)','file:///C:/secret','http://nol.yanolja.com','https://user:pw@nol.yanolja.com'])assert.equal(isHttps(url),false);assert.equal(isHttps('https://nol.yanolja.com/ticket'),true);});
test('유사 도메인을 공식 티켓 도메인으로 판단하지 않는다',()=>{assert.equal(isTicketOrigin('https://nol.yanolja.com/'),true);assert.equal(isTicketOrigin('https://yanolja.com.attacker.test'),false);assert.equal(isTicketOrigin('https://notyanolja.com'),false);});
test('가용 좌석만 검색하고 품절석을 제외한다',()=>{assert.deepEqual(filterSeats([{available:true,label:'A열 1번'},{available:false,label:'A열 2번'},{available:true,label:'B열 1번'}],'a열'),[{available:true,label:'A열 1번'}]);});
test('허용하지 않은 좌석 동작을 거절한다',()=>assert.throws(()=>actionScript(DEMO_PROFILE,{id:'1',label:'A'},'purchase')));
