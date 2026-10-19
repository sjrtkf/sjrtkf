'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {validPair}=require('./pairing-store');
const HOST='127.0.0.1',PORT=43187;
const ACTIONS=new Set(['tabs.list','tabs.open','tabs.demo','tabs.focus','tabs.zoom','network.attach','network.detach','network.snapshot','entry.pageInfo','entry.gameCards','entry.prepareEntry','entry.armListing','entry.setListingClock','entry.listingState','entry.stopListing','entry.gateStatus','entry.armGate','entry.setGateClock','entry.noteGateRequest','live.waitForChange','live.liveRead','live.liveAction','flow.scene','flow.clickKnown','flow.enterCode','flow.deselect','flow.dismissConflict','flow.dismissEmptySelection','pricePage.priceState','pricePage.adultPriceStep','pricePage.proceedBooking','pricePage.bookingProgress','pricePage.returnToSeats','observation.bookingObservation','directApi.bookingIdentity','publicGame.resolveGame','captcha.captchaSnapshot','captcha.captchaSubmit','captcha.captchaStatus','captcha.captchaCancel','captcha.captchaRefresh','page.stopWatchers','page.pageClock','page.gateSnapshot','page.gateState','page.showAll','page.showAllGames']);
for(const name of ['manualCaptchaPrepare','manualCaptchaSubmit','manualCaptchaCancel'])ACTIONS.add('manualCaptcha.'+name);
ACTIONS.add('extension.reload');ACTIONS.add('seatDetails.readDetails');
ACTIONS.add('httpBooking.httpBookingAction');ACTIONS.add('httpBooking.httpBookingNavigate');
function allowedUrl(value){try{const u=new URL(value);return !u.username&&!u.password&&((u.origin==='https://nol.yanolja.com'&&(u.pathname==='/ticket'||u.pathname.startsWith('/ticket/')))||(u.origin==='https://tickets.interpark.com'&&/^\/(?:gates\/ticket\/\d{8}\/?$|goods\/\d+\/?$|onestop(?:\/|$)|waiting(?:\/|$))/.test(u.pathname))||(u.origin==='https://ticket.interpark.com'&&/^\/(?:Book|SportsBook)\/[\w-]+\.asp$/i.test(u.pathname)));}catch{return false;}}
function safeUrl(value){if(!allowedUrl(value)&&!/^chrome-extension:\/\/[a-p]{32}\/demo.html$/.test(value))return null;const u=new URL(value);const step=u.searchParams.get('step');u.search='';u.hash='';if(u.pathname==='/onestop/seat'&&['seat','price'].includes(step))u.searchParams.set('step',step);return u.href;}
function safeTab(t){if(!Number.isInteger(t?.id)||t.id<0)return null;const url=safeUrl(t.url);if(!url)return null;return {id:t.id,url,title:String(t.title||'예매 페이지').slice(0,200),openerTabId:Number.isInteger(t.openerTabId)?t.openerTabId:null,windowId:Number.isInteger(t.windowId)?t.windowId:null,active:t.active===true,documentId:typeof t.documentId==='string'?t.documentId.slice(0,100):null};}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const EXTENSION_UPDATE_MESSAGE='이전 Chrome 확장이 연결되어 있어요. 직접 입력 보조를 사용하려면 v0.9.3 배포 폴더의 chrome-extension을 등록하고 새 코드로 연결해 주세요.';
class BrowserBridge extends EventEmitter{
  constructor({port=PORT,requestTimeoutMs=12000,pairingStore=null}={}){super();this.port=port;this.requestTimeoutMs=requestTimeoutMs;this.tabs=new Map();this.pending=new Map();this.queue=[];this.next=0;this.instance=crypto.randomBytes(12).toString('hex');this.pairingStore=pairingStore;this.connected=false;this.closed=false;this.extensionVersion=null;this.capabilities=new Set();this.regeneratePairCode();const saved=pairingStore?.load();if(validPair(saved)){this.origin=saved.origin;this.token=saved.token;this.extensionVersion=saved.version||null;this.capabilities=new Set(saved.capabilities||[]);this.pairCode=null;this.expiresAt=null;}}
  regeneratePairCode(){this.pairCode=crypto.randomBytes(16).toString('hex').toUpperCase();this.expiresAt=Date.now()+20*60000;this.pairAttempts=0;return this.getState();}
  refreshPairing(){this.pairingStore?.clear();this.disconnect('새 연결 코드를 발급했습니다.',{revoked:true});this.token=null;this.origin=null;this.extensionVersion=null;this.capabilities.clear();return this.regeneratePairCode();}
  getState(){const bookingNoticeSupported=this.capabilities.has('entry.bookingNotice'),captchaSupported=this.capabilities.has('captcha.ocr'),manualCaptchaSupported=this.capabilities.has('captcha.manual'),extensionUpdateRequired=!!this.token&&(!this.capabilities.has('entry.pageInfo')||!bookingNoticeSupported||!captchaSupported||!manualCaptchaSupported);return {connected:this.connected,paired:!!this.token,extensionReloadSupported:this.capabilities.has('extension.reload'),port:this.port,pairCode:this.pairCode,expiresAt:this.expiresAt,extensionVersion:this.extensionVersion,bookingNoticeSupported,captchaSupported,manualCaptchaSupported,extensionUpdateRequired,...(extensionUpdateRequired?{message:EXTENSION_UPDATE_MESSAGE}:{}),tabs:this.listTabs()};}
  listTabs(){return [...this.tabs.values()];}
  async start(){if(this.server)return this.getState();this.server=http.createServer((req,res)=>{void this.handle(req,res).catch(()=>{if(!res.headersSent)this.reply(res,400,{error:'잘못된 연결 요청입니다.'});else res.destroy();});});this.server.requestTimeout=25000;this.server.headersTimeout=10000;this.server.maxHeadersCount=24;await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,HOST,()=>{this.server.removeListener('error',reject);this.port=this.server.address().port;resolve();});});this.healthTimer=setInterval(()=>{if(this.connected&&Date.now()-this.lastSeen>45000)this.disconnect('Chrome 연결이 끊겼습니다.');},5000);this.healthTimer.unref();return this.getState();}
  reply(res,status,value){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  async body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8000000)throw Error('limit');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
  async handle(req,res){
    const origin=req.headers.origin,validOrigin=typeof origin==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if(req.socket.remoteAddress!==HOST||req.headers.host!==`${HOST}:${this.port}`||!validOrigin)return this.reply(res,403,{error:'연결 출처를 확인하지 못했습니다.'});
    const path=req.url;if(!['/pair','/poll','/result','/event','/heartbeat'].includes(path))return this.reply(res,404,{});
    if(path!=='/pair'&&origin!==this.origin)return this.reply(res,403,{});
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Max-Age','600');return this.reply(res,204,null);}
    if(req.method!=='POST'||!String(req.headers['content-type']||'').startsWith('application/json'))return this.reply(res,405,{});
    if(path!=='/pair'&&(!this.token||!equal(req.headers.authorization,`Bearer ${this.token}`)))return this.reply(res,401,{});
    const data=await this.body(req);
    if(path==='/pair'){
      if(this.token||Date.now()>this.expiresAt||this.pairAttempts++>=10||!equal(String(data.code||'').trim().toUpperCase(),this.pairCode))return this.reply(res,403,{error:'연결 코드가 일치하지 않거나 만료되었습니다. 프로그램에서 새 코드를 받으세요.'});
      this.extensionVersion=typeof data.version==='string'&&/^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(data.version)?data.version:null;
      this.capabilities=new Set(Array.isArray(data.capabilities)?data.capabilities.filter(value=>['entry.pageInfo','entry.bookingNotice','captcha.ocr','captcha.manual','extension.reload'].includes(value)):[]);
      const token=crypto.randomBytes(32).toString('hex');this.pairingStore?.save({origin,token,version:this.extensionVersion,capabilities:[...this.capabilities]});this.origin=origin;this.token=token;this.pairCode=null;this.lastSeen=Date.now();this.connected=true;this.reply(res,200,{token:this.token});this.emit('connected',this.getState());return;
    }
    let changed=false;if(path==='/heartbeat'&&typeof data.version==='string'&&/^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(data.version)&&Array.isArray(data.capabilities)){const capabilities=data.capabilities.filter(v=>['entry.pageInfo','entry.bookingNotice','captcha.ocr','captcha.manual','extension.reload'].includes(v));changed=this.extensionVersion!==data.version||JSON.stringify([...this.capabilities])!==JSON.stringify(capabilities);this.extensionVersion=data.version;this.capabilities=new Set(capabilities);if(changed)this.pairingStore?.save({origin:this.origin,token:this.token,version:this.extensionVersion,capabilities});}this.lastSeen=Date.now();if(!this.connected||changed){this.connected=true;this.emit('connected',this.getState());}
    if(path==='/heartbeat')return this.reply(res,200,{alive:true});
    if(path==='/poll'){
      if(this.poll)this.reply(this.poll.res,409,{error:'duplicate-poll'});clearTimeout(this.pollTimer);this.poll={res};
      res.on('close',()=>{if(this.poll?.res===res){this.poll=null;clearTimeout(this.pollTimer);}});
      this.pollTimer=setTimeout(()=>{if(this.poll?.res===res){this.poll=null;this.reply(res,200,{commands:[]});}},20000);this.flush();return;
    }
    if(path==='/result'){
      const item=this.pending.get(data.id);if(item){this.pending.delete(data.id);clearTimeout(item.timer);if(typeof data.error==='string')item.reject(Error(data.error.slice(0,700)));else item.resolve(data.value);}
      return this.reply(res,200,{});
    }
    if(path==='/event'){
      if(data.type==='tabs'&&Array.isArray(data.tabs)){this.tabs=new Map(data.tabs.slice(0,200).map(safeTab).filter(t=>t&&(!t.url.startsWith('chrome-extension:')||t.url===this.origin+'/demo.html')).map(t=>[t.id,t]));this.emit('tabs',this.listTabs());}
      else if(Number.isInteger(data.tabId)&&this.tabs.has(data.tabId)&&['document','metadata','grades','network','entry','metadata-reset','metadata-error','observer-error'].includes(data.type)){if(data.type==='document')this.emit('document',data);else this.emit('event',data);}
      return this.reply(res,200,{});
    }
  }
  flush(){if(!this.poll||!this.queue.length)return;const res=this.poll.res;this.poll=null;clearTimeout(this.pollTimer);const commands=this.queue.splice(0,20);this.reply(res,200,{commands});}
  request({action,tabId,arg,documentId}={}){if(!ACTIONS.has(action))return Promise.reject(Error('허용되지 않은 Chrome 동작입니다.'));if(this.closed||!this.connected)return Promise.reject(Error('Chrome 확장을 먼저 연결해 주세요.'));if(!action.startsWith('tabs.')&&action!=='extension.reload'&&(!Number.isInteger(tabId)||!this.tabs.has(tabId)))return Promise.reject(Error('연결된 NOL 예매 탭을 먼저 선택해 주세요.'));if(action==='tabs.open'&&!allowedUrl(arg?.url))return Promise.reject(Error('NOL 예매 주소만 열 수 있습니다.'));const id=this.instance+':'+String(++this.next);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.queue=this.queue.filter(c=>c.id!==id);reject(Error('Chrome 응답을 기다리는 시간이 지났습니다. 실제 화면을 확인해 주세요.'));},this.requestTimeoutMs);this.pending.set(id,{resolve,reject,timer});this.queue.push({id,action,tabId,arg,documentId:documentId??this.tabs.get(tabId)?.documentId,expiresAt:Date.now()+this.requestTimeoutMs});this.flush();});}
  disconnect(reason,{revoked=false}={}){this.connected=false;clearTimeout(this.pollTimer);if(this.poll)this.reply(this.poll.res,revoked?401:503,{error:'연결이 종료되었습니다.'});this.poll=null;this.tabs.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(reason));}this.pending.clear();this.queue=[];this.emit('disconnected',reason);this.emit('tabs',[]);}
  async close(){if(this.closed)return;this.closed=true;clearInterval(this.healthTimer);clearTimeout(this.pollTimer);if(this.poll)this.reply(this.poll.res,503,{});this.poll=null;this.disconnect('프로그램 연결을 종료했습니다.');this.token=null;if(this.server){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));this.server=null;}}
}
module.exports={BrowserBridge,allowedUrl,safeUrl,safeTab,ACTIONS,PORT};
