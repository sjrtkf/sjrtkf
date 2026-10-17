const {createEntryHttp,classifyEntryResponse}=require('../src/entry-http');
const entryObservation=require('../src/entry-observation');
const directApi=require('../src/direct-seat-api'),publicGame=require('../src/public-game');
const pricePage=require('../src/price-page');
const seatDetails=require('../src/seat-details');
const {readBookingContext}=require('../src/booking-context');
const {resolveGradeNames}=require('../src/grade-names');
const httpBooking=require('../src/http-booking');
const {invokeSiteFunction,CODE_ACTIONS}=require('../src/site-code');
const {codeRuntime}=require('../src/code-runtime');
'use strict';
// Build-time source copying produces static MV3 code. The extension never evaluates
// received JavaScript, accepts function source, or loads remotely hosted code.
const fs=require('node:fs'),path=require('node:path');
const entry=require('../src/entry'),live=require('../src/live-adapter'),flow=require('../src/flow'),captcha=require('../src/captcha-page'),manualCaptcha=require('../src/manual-captcha-page');
const observation=require('../src/booking-observation');
const {pageActions}=require('../src/chrome-target');
const {ACTIONS}=require('../src/browser-bridge');
const metadata=require('../src/metadata'),seatNetwork=require('../src/seat-network'),entryNetwork=require('../src/entry-network');
const lines=["'use strict';",'globalThis.BaseballActions=(()=>{',`const siteInvoke=${invokeSiteFunction.toString()};`,`const readBookingContext=${readBookingContext.toString()};`,`const resolveGradeNames=${resolveGradeNames.toString()};`,`const planAdultPrices=${httpBooking.planAdultPrices.toString()};`,`const priceState=${pricePage.priceState.toString()};`,'return Object.freeze({'];
for(const [group,functions] of Object.entries({entry,live,flow,captcha,manualCaptcha,observation,directApi,publicGame,seatDetails,pricePage,httpBooking:{httpBookingAction:httpBooking.httpBookingAction},page:pageActions}))for(const [name,fn] of Object.entries(functions))if(ACTIONS.has(`${group}.${name}`))lines.push(`${JSON.stringify(`${group}.${name}`)}:${fn.toString()},`);
lines.push('});})();');
fs.writeFileSync(path.join(__dirname,'actions.js'),lines.join('\n')+'\n');
fs.writeFileSync(path.join(__dirname,'http-navigation.js'),'globalThis.BaseballHttpNavigate='+httpBooking.httpBookingNavigate.toString()+';\n');
const codeLines=["'use strict';",`globalThis.BaseballCodeActions=new Set(${JSON.stringify([...CODE_ACTIONS])});`,
  'globalThis.BaseballCodeDispatch=async function(action,arg,meta){',`const invokeSiteFunction=${invokeSiteFunction.toString()};`,`const runtime=${codeRuntime.toString()};`,
  `const classifyEntryResponse=${classifyEntryResponse.toString()};`,`const createEntryHttp=${createEntryHttp.toString()};`,'const makeActions=siteInvoke=>{',`const priceState=${pricePage.priceState.toString()};`,'return {'];
for(const [group,functions] of Object.entries({entry,live,flow,captcha,manualCaptcha,pricePage,page:pageActions}))for(const [name,fn] of Object.entries(functions))if(CODE_ACTIONS.has(`${group}.${name}`))codeLines.push(`${JSON.stringify(`${group}.${name}`)}:${fn.toString()},`);
codeLines.push('};};try{return {ok:true,value:(await runtime(action,arg,meta,invokeSiteFunction,makeActions))??null};}catch(error){return {ok:false,code:/^SITE_[A-Z_]+$/.test(error?.message||"")?error.message:"SITE_ACTION_FAILED"};}};');
fs.writeFileSync(path.join(__dirname,'code-actions.js'),codeLines.join('\n')+'\n');
const parserLines=["'use strict';",'globalThis.BaseballParsers=(()=>{',"const ORIGIN='https://tickets.interpark.com',ENTRY_ORIGIN='https://ent-waiting-api.interpark.com',ENTRY_PATH='/waiting/api/secure-url';", "const CONFLICT_CODES=new Set(['P40054','P41150','P41149','P40021']);", "const OPERATIONS={PreselectSeat:['select','preselectSeat'],BulkPreselectSeats:['select','bulkPreselectSeats'],DeselectSeat:['deselect','deselectSeat'],BulkDeselectSeats:['deselect','bulkDeselectSeats']};", "const seatIds=values=>[...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==='string'&&v.length<=200).map(v=>v.startsWith('seat_block_')?v:'seat_block_'+v))];",'return {'];
for(const [group,functions] of Object.entries({metadata:{parseMetadata:metadata.parseMetadata,metadataUrl:metadata.metadataUrl},seatNetwork:{classifyRequest:seatNetwork.classifyRequest,classifyResponse:seatNetwork.classifyResponse},entryNetwork:{isEntryRequest:entryNetwork.isEntryRequest,classifyEntryResponse,...entryObservation}})){parserLines.push(`${group}:{`);for(const [name,fn] of Object.entries(functions))parserLines.push(`${name}:${fn.toString()},`);parserLines.push('},');}
parserLines.push('};})();');fs.writeFileSync(path.join(__dirname,'network-parsers.js'),parserLines.join('\n')+'\n');
for(const name of ['demo.css','demo.js'])fs.copyFileSync(path.join(__dirname,'../src',name),path.join(__dirname,name));
fs.writeFileSync(path.join(__dirname,'demo.html'),fs.readFileSync(path.join(__dirname,'../src/demo.html'),'utf8').replace('<script src="demo.js"></script>','<script src="demo.js"></script><script src="actions.js"></script><script src="content.js"></script>'));
console.log('Chrome 확장 보조 동작 준비 완료');
