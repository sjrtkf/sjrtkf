'use strict';
// Build-time source copying produces static MV3 code. The extension never evaluates
// received JavaScript, accepts function source, or loads remotely hosted code.
const fs=require('node:fs'),path=require('node:path');
const entry=require('../src/entry'),live=require('../src/live-adapter'),flow=require('../src/flow'),captcha=require('../src/captcha-page'),manualCaptcha=require('../src/manual-captcha-page');
const {pageActions}=require('../src/chrome-target');
const {ACTIONS}=require('../src/browser-bridge');
const metadata=require('../src/metadata'),seatNetwork=require('../src/seat-network'),entryNetwork=require('../src/entry-network');
const lines=["'use strict';",'globalThis.BaseballActions=Object.freeze({'];
for(const [group,functions] of Object.entries({entry,live,flow,captcha,manualCaptcha,page:pageActions}))for(const [name,fn] of Object.entries(functions))if(ACTIONS.has(`${group}.${name}`))lines.push(`${JSON.stringify(`${group}.${name}`)}:${fn.toString()},`);
lines.push('});');
fs.writeFileSync(path.join(__dirname,'actions.js'),lines.join('\n')+'\n');
const parserLines=["'use strict';",'globalThis.BaseballParsers=(()=>{',"const ORIGIN='https://tickets.interpark.com',ENTRY_ORIGIN='https://ent-waiting-api.interpark.com',ENTRY_PATH='/waiting/api/secure-url';", "const CONFLICT_CODES=new Set(['P40054','P41150','P41149','P40021']);", "const OPERATIONS={PreselectSeat:['select','preselectSeat'],BulkPreselectSeats:['select','bulkPreselectSeats'],DeselectSeat:['deselect','deselectSeat'],BulkDeselectSeats:['deselect','bulkDeselectSeats']};", "const seatIds=values=>[...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==='string'&&v.length<=200).map(v=>v.startsWith('seat_block_')?v:'seat_block_'+v))];",'return {'];
for(const [group,functions] of Object.entries({metadata:{parseMetadata:metadata.parseMetadata,metadataUrl:metadata.metadataUrl},seatNetwork:{classifyRequest:seatNetwork.classifyRequest,classifyResponse:seatNetwork.classifyResponse},entryNetwork:{isEntryRequest:entryNetwork.isEntryRequest}})){parserLines.push(`${group}:{`);for(const [name,fn] of Object.entries(functions))parserLines.push(`${name}:${fn.toString()},`);parserLines.push('},');}
parserLines.push('};})();');fs.writeFileSync(path.join(__dirname,'network-parsers.js'),parserLines.join('\n')+'\n');
for(const name of ['demo.css','demo.js'])fs.copyFileSync(path.join(__dirname,'../src',name),path.join(__dirname,name));
fs.writeFileSync(path.join(__dirname,'demo.html'),fs.readFileSync(path.join(__dirname,'../src/demo.html'),'utf8').replace('<script src="demo.js"></script>','<script src="demo.js"></script><script src="actions.js"></script><script src="content.js"></script>'));
console.log('Chrome 확장 보조 동작 준비 완료');
