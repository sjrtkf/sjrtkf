'use strict';
const ENDPOINT='https://ent-waiting-api.interpark.com/waiting/api/secure-url';
function matches(request,endpoint=ENDPOINT){return request?.url===endpoint&&request.method==='POST';}
function forwardHeaders(headers){
  return Object.fromEntries(Object.entries(headers||{}).filter(([key])=>!['host','content-length','connection','accept-encoding','cookie'].includes(key.toLowerCase())));
}
async function transmit(fetcher,request){
  if(typeof request.postData!=='string'||request.postData.length>65536)throw Error('REQUEST_BODY_UNAVAILABLE');
  const start=performance.now();
  const response=await fetcher(request.url,{method:'POST',headers:forwardHeaders(request.headers),body:request.postData,credentials:'include',redirect:'manual',signal:AbortSignal.timeout(10000)});
  const reader=response.body?.getReader();const chunks=[];let size=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw Error('RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}
  const body=Buffer.concat(chunks);
  const headers=[...response.headers].filter(([key])=>!['content-length','content-encoding','transfer-encoding'].includes(key.toLowerCase())).map(([name,value])=>({name,value}));
  return {responseCode:response.status,responseHeaders:headers,body:body.toString('base64'),elapsedMs:Math.round((performance.now()-start)*10)/10};
}
module.exports={ENDPOINT,matches,forwardHeaders,transmit};
