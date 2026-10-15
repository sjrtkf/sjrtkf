'use strict';
window.entryTrace.onState(s=>{document.getElementById('state').textContent=s.message;document.getElementById('summary').textContent=JSON.stringify(s.summary,null,2);});
document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{try{await window.entryTrace.command(b.dataset.action);}catch{document.getElementById('state').textContent='요청을 처리하지 못했습니다. 창 상태를 확인해 주세요.';}});
