'use strict';
const byId=id=>document.getElementById(id);
const status=byId('status'),badge=byId('badge'),form=byId('pair'),code=byId('code'),button=byId('connect'),refresh=byId('refresh'),codeError=byId('codeError');
let busy=false,connected=false,requestId=0;
const normalizedCode=value=>String(value||'').replace(/\s/g,'').toUpperCase();
function showError(message){codeError.textContent=message;codeError.hidden=!message;code.setAttribute('aria-invalid',message?'true':'false');}
function render(state,message){
  connected=state==='connected';badge.dataset.state=state;
  badge.textContent=connected?'연결됨':state==='busy'?'연결 중':state==='error'?'연결 확인 필요':'연결 전';
  status.textContent=message;form.hidden=connected;byId('ready').hidden=!connected;
}
function friendlyError(error){
  const message=String(error?.message||error||'');
  if(/fetch|network|timeout|abort|Failed to|Load failed/i.test(message))return '도우미에 연결하지 못했어요. 도우미를 실행한 뒤 다시 시도해 주세요.';
  if(/코드|만료|403|401/.test(message))return '연결 코드가 만료되었거나 맞지 않아요. 도우미에서 새 연결 코드를 만들고 다시 붙여 넣으세요.';
  return message||'연결 상태를 확인하지 못했어요. 확장 팝업을 다시 열어 주세요.';
}
async function refreshStatus(){
  if(busy)return;
  const id=++requestId;refresh.disabled=true;
  try{
    const result=await chrome.runtime.sendMessage({type:'baseball-status'});if(id!==requestId)return;
    if(result?.connected){render('connected','이 Chrome과 도우미가 연결되어 있어요. 도우미에서 예매할 탭을 선택하세요.');showError('');}
    else render(result?.error?'error':'idle',result?.error?friendlyError(result.error):'도우미를 켜고 아래에 연결 코드를 붙여 넣으세요.');
  }catch(error){if(id===requestId)render('error',friendlyError(error));}
  finally{if(id===requestId)refresh.disabled=false;}
}
code.addEventListener('input',()=>showError(''));
refresh.addEventListener('click',refreshStatus);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||connected)return;
  const value=normalizedCode(code.value);
  if(!/^[0-9A-F]{32}$/.test(value)){showError('32자리 연결 코드를 그대로 복사해 붙여 넣어 주세요.');code.focus();return;}
  busy=true;requestId++;button.disabled=true;refresh.disabled=true;code.disabled=true;showError('');render('busy','도우미와 연결하고 있어요.');
  try{
    const result=await chrome.runtime.sendMessage({type:'baseball-pair',code:value});
    if(result?.error)throw Error(result.error);if(result?.connected!==true)throw Error('연결 결과를 확인하지 못했어요. 상태 새로 확인을 눌러 주세요.');
    code.value='';render('connected','연결 완료 · 도우미 창에서 예매할 탭을 선택하세요.');
  }catch(error){render('error',friendlyError(error));byId('help').open=true;}
  finally{busy=false;button.disabled=false;refresh.disabled=false;code.disabled=false;}
});
void refreshStatus();
