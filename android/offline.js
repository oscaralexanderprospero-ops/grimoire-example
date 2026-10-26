/* Packaged Android storage. Never loaded by the desktop page. */

(function (root) {

'use strict';

const copy = x => JSON.parse(JSON.stringify(x));

const uuid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');

function seedRecord(Model, existing, seed) {

 if (existing) return existing;

 const m=Model.migrate(seed); if(m.errors.length) throw Error('Packaged owner data invalid');

 return {envelope:Model.envelope(m.state),etag:uuid(),savedAt:new Date().toISOString()};

}

function transition(Model, current, body, now = new Date().toISOString()) {

 const errors = Model.validate(body.state).errors;

 if(errors.length) return {status:400, value:{error:'Not saved: invalid grimoire',details:errors}};

 if(current && Model.migrate(current.envelope).errors.length) return {status:500,value:{error:'Stored grimoire is unreadable. Restore a backup.',corrupt:true}};

 if((current?.etag || null)!==(body.baseEtag || null) && body.reason!=='conflict-overwrite') return {status:409,value:{error:'Changed since loaded',state:current?.envelope.state,etag:current?.etag},rejected:copy(body.state)};

 const record={envelope:Model.envelope(copy(body.state)),etag:now+'-'+uuid(),savedAt:now};

 return {status:200,value:{etag:record.etag,savedAt:now},record,backup:current};

}

// Sync metadata stays separate from user exports and is committed with the content.

function syncMetadata(Core, Model, current, metadata) {

 const m=metadata ? copy(metadata) : {replica:Core.createReplica(uuid(),Model.normalize({entries:[],journal:[]})),pendingReceipts:[],lastAttempt:null,lastSuccess:null,error:null};

 m.replica=Core.queue(m.replica,current);

 return m;

}

function syncReply(Core, Model, metadata, state, response, sentReceipts) {

 if(!response || !Array.isArray(response.operations)||!Array.isArray(response.receipts)||response.operations.length>1000||response.receipts.length>1000)throw Error('Invalid sync response');

 const m=syncMetadata(Core,Model,state,metadata);

 for(const operation of response.operations){

  if(Model.attachmentRefs(operation.state||{}).length)throw Error('Photo transfer is not configured; incoming content retained by sender');

  const got=Core.receive(m.replica,operation);m.replica=got.replica;

  if(!m.pendingReceipts.some(r=>r.id===got.receipt.id))m.pendingReceipts.push(got.receipt);

 }

 for(const receipt of response.receipts)m.replica=Core.acknowledge(m.replica,receipt);

 m.pendingReceipts=m.pendingReceipts.filter(r=>!sentReceipts.some(sent=>JSON.stringify(sent)===JSON.stringify(r)));

 m.lastSuccess=new Date().toISOString();m.error=null;

 return m;

}

if(typeof module !== 'undefined') { module.exports={transition,seedRecord,syncMetadata,syncReply}; return; }

if(!root.GrimoireApp || !root.GrimoireApp.offlineMode()) return;

const Model=root.GrimoireModel, Core=root.GrimoireSync, nativeFetch=root.fetch.bind(root);

const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});

const dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('grimoire-offline',1);r.onupgradeneeded=()=>{for(const n of ['state','backups','photos'])r.result.createObjectStore(n);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});

async function transaction(stores,mode,fn){const db=await dbPromise;const t=db.transaction(stores,mode); const done=new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Save aborted'));});try {const value=await fn(t);await done;return value;} catch(e){try{t.abort();}catch{} await done.catch(()=>{});throw e;}}

const backupName=()=>new Date().toISOString().replace(/[^0-9TZ]/g,'')+'-'+uuid()+'.json';

const ready=(async()=>{const existing=await transaction(['state'],'readonly',t=>req(t.objectStore('state').get('current')));if(existing)return;const r=await nativeFetch('owner-seed.json');if(!r.ok)throw Error('Packaged owner data unavailable');const seed=Model.migrate(await r.json());if(seed.errors.length)throw Error('Packaged owner data invalid');await transaction(['state'],'readwrite',async t=>{const s=t.objectStore('state');if(!await req(s.get('current')))s.put(seedRecord(Model,null,seed.state),'current');});})();

const syncReady=ready.then(()=>Core && transaction(['state'],'readwrite',async t=>{const store=t.objectStore('state');const current=await req(store.get('current'));const metadata=await req(store.get('sync'));store.put(syncMetadata(Core,Model,current.envelope.state,metadata),'sync');}));

let syncing=false;

const transport=()=>root.GrimoireSyncTransport && root.GrimoireSyncTransport.authorized===true && typeof root.GrimoireSyncTransport.exchange==='function' ? root.GrimoireSyncTransport : null;

async function syncOnce(){

 await syncReady;if(!Core||!transport()||syncing)return;

 syncing=true;

 try{

  const outgoing=await transaction(['state'],'readwrite',async t=>{const store=t.objectStore('state');const m=await req(store.get('sync'));m.lastAttempt=new Date().toISOString();store.put(m,'sync');return m;});

  if(outgoing.replica.outbox.some(o=>Model.attachmentRefs(o.state).length))throw Error('Photo transfer is not configured. Edits stay queued on this phone.');

  const response=await transport().exchange({deviceId:outgoing.replica.deviceId,operations:copy(outgoing.replica.outbox),receipts:copy(outgoing.pendingReceipts)});

  await transaction(['state','backups'],'readwrite',async t=>{const store=t.objectStore('state');const current=await req(store.get('current'));const latest=await req(store.get('sync'));const m=syncReply(Core,Model,latest,current.envelope.state,response,outgoing.pendingReceipts);

   if(JSON.stringify(m.replica.state)!==JSON.stringify(current.envelope.state)){t.objectStore('backups').put(current,backupName());store.put({envelope:Model.envelope(m.replica.state),etag:uuid(),savedAt:new Date().toISOString()},'current');}

   store.put(m,'sync');

  });

  if(root.dispatchEvent && root.Event)root.dispatchEvent(new Event('grimoire-sync-update'));

 }catch(e){await transaction(['state'],'readwrite',async t=>{const store=t.objectStore('state');const m=await req(store.get('sync'));m.error=e.message;m.replica.audit.push({type:'retry-pending',at:new Date().toISOString(),message:e.message});store.put(m,'sync');}).catch(()=>{});

 }finally{syncing=false;}

}

// No transport is shipped. An authorized packaged/native integration must supply it.

async function syncLoop(){await syncOnce();if(transport())setTimeout(syncLoop,60000);}

syncReady.then(()=>{if(transport())setTimeout(syncLoop,60000);}).catch(()=>{});

function validId(id){return /^[0-9a-f]{32}\.(jpg|png|webp|gif)$/.test(id);}

async function photo(id){if(!validId(id))return null;return transaction(['photos'],'readonly',t=>req(t.objectStore('photos').get(id)));}

root.fetch=async function(input,options={}){try{await syncReady;const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin!==location.origin)return reply({error:'Offline app: remote requests disabled'},403);const path=url.pathname.replace(/^\//,'');const method=options.method||'GET';

if(path.startsWith('attachments/')){const p=await photo(path.slice(12));return p?new Response(p):reply({error:'Photo not found'},404);}

if(!path.startsWith('api/'))return nativeFetch(input,options);

if(path==='api/sync/now'&&method==='POST'){await syncOnce();return reply({enabled:!!transport()});}

if(path==='api/sync/status'){const m=await transaction(['state'],'readonly',t=>req(t.objectStore('state').get('sync')));return reply({enabled:!!transport(),intervalSeconds:60,reason:transport()?null:'Private sync access has not been activated. Edits are kept locally and queued.',deviceId:m?.replica.deviceId,queued:m?.replica.outbox.length||0,audit:m?.replica.audit||[],conflicts:m?.replica.conflicts||[],lastAttempt:m?.lastAttempt,lastSuccess:m?.lastSuccess,error:m?.error});}

if(path==='api/phone')return reply({enabled:false,error:'This app saves on this phone. Transfer changes using export/import; automatic sync is unavailable.'});

if(path==='api/attachments'&&method==='POST'){const blob=options.body;if(!(blob instanceof Blob)||blob.size>20*1024*1024)return reply({error:'Photo too large or invalid'},400);const bytes=new Uint8Array(await blob.arrayBuffer());let type=null;const chars=(a,b)=>String.fromCharCode(...bytes.slice(a,b));if(bytes.length>=12){if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';else if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))type='image/png';else if(chars(0,4)==='GIF8')type='image/gif';else if(chars(0,4)==='RIFF'&&chars(8,12)==='WEBP')type='image/webp';}if(!type||blob.type&&blob.type!==type)return reply({error:'Invalid image content'},400);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');const id=hash.slice(0,32)+'.'+({'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp'}[type]);if(url.searchParams.has('expect')&&url.searchParams.get('expect')!==id)return reply({error:'Photo identity mismatch'},400);await transaction(['photos'],'readwrite',t=>{t.objectStore('photos').put(new Blob([bytes],{type}),id);});return reply({id});}

return await transaction(['state','backups'],'readwrite',async t=>{const s=t.objectStore('state'),b=t.objectStore('backups');const current=await req(s.get('current'));

if(path==='api/state'&&method==='GET'){const m=Model.migrate(current.envelope);return m.errors.length?reply({error:'Stored data invalid',corrupt:true},500):reply({state:m.state,etag:current.etag,savedAt:current.savedAt,dataDir:'Private storage on this phone',warnings:m.warnings});}

if(path==='api/backups'){const keys=await req(b.getAllKeys()),values=await req(b.getAll());return reply({dir:'Private phone backups',backups:keys.map((name,i)=>({name,reason:'Before save',modified:values[i].savedAt,size:JSON.stringify(values[i]).length,summary:Model.summarize(values[i].envelope.state)})).reverse()});}

if(path==='api/restore'&&method==='POST'){const body=JSON.parse(options.body);if(typeof body.name!=='string'||! /^[0-9TZ]+-[0-9a-f-]+\.json$/.test(body.name))return reply({error:'Unknown backup'},400);const saved=await req(b.get(body.name));if(!saved||Model.migrate(saved.envelope).errors.length)return reply({error:'Invalid backup'},400);b.put(current,backupName());const record={...saved,etag:uuid(),savedAt:new Date().toISOString()};s.put(record,'current');if(Core)s.put(syncMetadata(Core,Model,record.envelope.state,await req(s.get('sync'))),'sync');return reply({state:record.envelope.state,etag:record.etag});}

if(path==='api/state'&&method==='PUT'){const result=transition(Model,current,JSON.parse(options.body));if(result.backup)b.put(result.backup,backupName());if(result.rejected){const name=backupName();b.put({envelope:Model.envelope(result.rejected),savedAt:new Date().toISOString()},name);result.value.keptAs=name;}if(result.record){s.put(result.record,'current');if(Core)s.put(syncMetadata(Core,Model,result.record.envelope.state,await req(s.get('sync'))),'sync');}return reply(result.value,result.status);}

return reply({error:'Offline operation unavailable'},404);});

}catch(e){return reply({error:'Phone storage operation failed: '+e.message,corrupt:true},500);}};

// The same existing renderers use attachment URLs; resolve only validated local image ids.

const urls=new Map();async function resolveImages(){for(const el of document.querySelectorAll('img[src^="attachments/"],a[href^="attachments/"]')){const attr=el.tagName==='IMG'?'src':'href',id=el.getAttribute(attr).slice(12);if(!validId(id))continue;if(!urls.has(id)){const p=await photo(id);if(!p)continue;urls.set(id,URL.createObjectURL(p));}if(el.getAttribute(attr)==='attachments/'+id)el.setAttribute(attr,urls.get(id));}}

ready.then(()=>{new MutationObserver(resolveImages).observe(document.documentElement,{childList:true,subtree:true});resolveImages();}).catch(()=>{});

})(globalThis);

