/* Pure sync engine. Transport and authorization are deliberately outside this module. */
(function(root){
'use strict';
const Model=typeof module!=='undefined'?require('./model.js'):root.GrimoireModel;
const copy=x=>JSON.parse(JSON.stringify(x));
const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?Object.keys(x).sort().reduce((a,k)=>(a[k]=canon(x[k]),a),{}):x;
const equal=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
const valid=s=>{const r=Model.validate(s);if(r.errors.length)throw Error('Invalid sync state: '+r.errors.join('; '));};
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
function createReplica(deviceId,state){if(!id(deviceId))throw Error('Invalid device ID');valid(state);return {deviceId,sequence:0,state:copy(state),base:copy(state),outbox:[],receipts:{},conflicts:[],audit:[]};}
function queue(replica,state){valid(state);const r=copy(replica);if(equal(r.state,state))return r;const previous=copy(r.state);r.sequence++;const op={id:r.deviceId+'-'+r.sequence,deviceId:r.deviceId,sequence:r.sequence,base:previous,state:copy(state)};r.outbox.push(op);r.state=copy(state);r.audit.push({type:'queued',id:op.id,at:new Date().toISOString()});return r;}
function merge(base,local,remote){const conflicts=[];const choose=(b,l,r,path)=>{if(equal(l,r)||equal(r,b))return copyOr(l);if(equal(l,b))return copyOr(r);conflicts.push({path,base:copyOr(b),local:copyOr(l),remote:copyOr(r)});return copyOr(l);};const copyOr=x=>x===undefined?null:copy(x);const state={};
for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
 if(['entries','journal','correspondences','templates'].includes(key)&&[base[key],local[key],remote[key]].every(Array.isArray)){
  const maps=[base,local,remote].map(s=>new Map(s[key].map(x=>[x.id,x])));const result=[];
  for(const entityId of new Set([...maps[1].keys(),...maps[2].keys(),...maps[0].keys()])){const v=choose(...maps.map(m=>m.get(entityId)),key+'/'+entityId);if(v!==null)result.push(v);}state[key]=result;
 }else state[key]=choose(base[key],local[key],remote[key],key);
}
valid(state);return {state,conflicts};}
function receive(replica,operation){if(!operation||!id(operation.deviceId)||!id(operation.id)||!Number.isSafeInteger(operation.sequence)||operation.sequence<1||operation.id!==operation.deviceId+'-'+operation.sequence)throw Error('Invalid operation identity');valid(operation.base);valid(operation.state);const r=copy(replica);const serialized=JSON.stringify(canon(operation));const prior=r.receipts[operation.id];if(prior){if(prior.operation!==serialized)throw Error('Operation ID reused with different payload');return {replica:r,receipt:copy(prior.receipt)};}
const merged=merge(operation.base,r.state,operation.state);r.state=merged.state;const receipt={id:operation.id,deviceId:operation.deviceId,status:merged.conflicts.length?'conflict':'accepted',operation:serialized};r.receipts[operation.id]={operation:serialized,receipt};if(merged.conflicts.length)r.conflicts.push({id:operation.id,at:new Date().toISOString(),changes:merged.conflicts});r.audit.push({type:'received',id:operation.id,status:receipt.status,at:new Date().toISOString()});return {replica:r,receipt};}
function acknowledge(replica,receipt){const r=copy(replica);const op=r.outbox.find(o=>o.id===receipt?.id);if(!op)return r;if(receipt.deviceId!==r.deviceId||!['accepted','conflict'].includes(receipt.status)||receipt.operation!==JSON.stringify(canon(op)))throw Error('Receipt does not match queued operation');r.outbox=r.outbox.filter(o=>o.id!==op.id);r.audit.push({type:'acknowledged',id:op.id,status:receipt.status,at:new Date().toISOString()});return r;}
const api={createReplica,queue,receive,acknowledge,merge};if(typeof module!=='undefined')module.exports=api;else root.GrimoireSync=api;
})(typeof globalThis!=='undefined'?globalThis:this);

