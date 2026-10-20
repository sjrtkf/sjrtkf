'use strict';
// The public domestic gate's original waiting-entry callback, before the UI
// countdown guard. Fingerprints are from the 2026-10-20 public deployment:
// /gates/assets/Cm0ActnS.js (YL and pj.enterTicketWaitingPage).
// This resolver never reads, copies or serializes member/session data. The
// site's callback keeps its own authentication, product and in-flight checks.
function resolveGateEntry(button){
  if(location.origin!=='https://tickets.interpark.com'||!/^\/gates\/ticket\/\d{8}\/?$/.test(location.pathname)||!button||button.isConnected===false)throw Error('SITE_ENTRY_CONTROL_CHANGED');
  const fingerprint=fn=>{
    if(typeof fn!=='function')return '';
    const source=Function.prototype.toString.call(fn);let hash=2166136261;
    for(let index=0;index<source.length;index++)hash=Math.imul(hash^source.charCodeAt(index),16777619);
    return source.length+':'+(hash>>>0).toString(16);
  };
  const keys=Object.keys(button).filter(key=>key.startsWith('__reactFiber$'));
  if(keys.length!==1)throw Error(keys.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_FUNCTION_UNAVAILABLE');
  let root=button[keys[0]],steps=0;
  while(root?.return&&++steps<=100)root=root.return;
  if(!root||steps>100||root.tag!==3||!root.stateNode?.current)throw Error('SITE_ENTRY_FUNCTION_UNAVAILABLE');
  // A DOM node's fiber pointer may refer to the alternate tree. Search only
  // the committed root, so an old render can never supply the callback.
  const pending=[root.stateNode.current],seen=new Set(),matches=[];
  while(pending.length){
    const fiber=pending.pop();if(!fiber||seen.has(fiber))continue;
    seen.add(fiber);if(seen.size>10000)throw Error('SITE_ENTRY_FUNCTION_UNAVAILABLE');
    if(fiber.stateNode===button)matches.push(fiber);
    if(fiber.sibling)pending.push(fiber.sibling);
    if(fiber.child)pending.push(fiber.child);
  }
  if(matches.length!==1)throw Error(matches.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_CONTROL_CHANGED');
  const owners=[];steps=0;
  for(let fiber=matches[0].return;fiber&&++steps<=100;fiber=fiber.return){
    if(fingerprint(fiber.type)==='1128:15e3cb9e')owners.push(fiber);
  }
  if(owners.length!==1)throw Error(owners.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_FUNCTION_UNSUPPORTED');
  const owner=owners[0];
  if(owner.memoizedProps?.global!==false)throw Error('SITE_ENTRY_FUNCTION_UNSUPPORTED');
  const callbacks=[];steps=0;const hooks=new Set();
  for(let hook=owner.memoizedState;hook;hook=hook.next){
    if(hooks.has(hook)||++steps>200)throw Error('SITE_ENTRY_FUNCTION_AMBIGUOUS');
    hooks.add(hook);
    const state=hook.memoizedState;
    if(Array.isArray(state)&&state.length===2&&Array.isArray(state[1])&&fingerprint(state[0])==='807:8d8ae4e')callbacks.push(state[0]);
  }
  if(callbacks.length!==1)throw Error(callbacks.length?'SITE_ENTRY_FUNCTION_AMBIGUOUS':'SITE_ENTRY_FUNCTION_UNAVAILABLE');
  return {invoke:callbacks[0],contract:'ticket-gate-2026-10-20'};
}
module.exports={resolveGateEntry};
