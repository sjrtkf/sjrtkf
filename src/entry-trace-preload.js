'use strict';
const {ipcRenderer}=require('electron');
// Passive DOM timing marks in an isolated world. No bridge is exposed to sites.
const send=kind=>ipcRenderer.send('entry-trace:mark',{kind,at:performance.timeOrigin+performance.now()});
addEventListener('DOMContentLoaded',()=>{
  send('page-ready');
  document.addEventListener('click',event=>{const button=event.target?.closest?.('button');const label=button?.textContent?.trim();if(label==='예매하기')send('booking-click');else if(label==='확인하고 예매하기')send('notice-click');},true);
  let ready=false,enabled=false,seat=false;
  const observe=()=>{
    if(location.origin!=='https://tickets.interpark.com')return;
    if(location.pathname==='/onestop/seat'&&!seat){seat=true;send('seat-page');}
    if(!/^\/gates\/ticket\/\d+$/.test(location.pathname))return;
    const main=document.querySelector('main');if(!main)return;
    if(!ready&&main.textContent.replace(/\s/g,'').includes('예매준비가완료됐어요')){ready=true;send('gate-ready');}
    const buttons=[...main.querySelectorAll('button')].filter(b=>b.textContent.trim()==='예매하기'&&!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&b.getBoundingClientRect().width>0);
    if(ready&&!enabled&&buttons.length===1){enabled=true;send('gate-enabled');}
  };
  new MutationObserver(observe).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});observe();
});
