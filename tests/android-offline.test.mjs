import test from 'node:test';

import assert from 'node:assert/strict';

import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),Model=require('../preview/model.js'),{transition,seedRecord}=require('../android/offline.js');

const state=()=>Model.normalize({entries:[],journal:[]});

test('offline save validates before mutation and preserves previous record for backup',()=>{const original=transition(Model,null,{state:state(),baseEtag:null}).record;const unchanged=JSON.stringify(original);const invalid=transition(Model,original,{state:{entries:'invalid'},baseEtag:original.etag});assert.equal(invalid.status,400);assert.equal(JSON.stringify(original),unchanged);const next=transition(Model,original,{state:state(),baseEtag:original.etag});assert.equal(next.status,200);assert.deepEqual(next.backup,original);assert.notEqual(next.record.etag,original.etag);});

test('offline stale writers are refused and rejected edits remain recoverable',()=>{const original=transition(Model,null,{state:state(),baseEtag:null}).record;const pending=state();pending.writer='Zephyr';const result=transition(Model,original,{state:pending,baseEtag:'stale'});assert.equal(result.status,409);assert.equal(result.record,undefined);assert.equal(result.rejected.writer,'Zephyr');assert.equal(result.value.etag,original.etag);});

test('offline state survives serialize/reopen and export/import without version loss',()=>{const first=transition(Model,null,{state:state(),baseEtag:null}).record;const reopened=JSON.parse(JSON.stringify(first));assert.deepEqual(Model.migrate(reopened.envelope).state,first.envelope.state);const imported=Model.parseImport(JSON.stringify(first.envelope));assert.deepEqual(imported.state,first.envelope.state);assert.equal(transition(Model,reopened,{state:imported.state,baseEtag:reopened.etag,reason:'import'}).status,200);});



test('upgrade initialization preserves saved phone changes instead of replacing with packaged seed',()=>{const seed=state();const initial=seedRecord(Model,null,seed);initial.envelope.state.writer='Zephyr';const reopened=JSON.parse(JSON.stringify(initial));const replacementSeed=state();replacementSeed.writer='Kimi';const preserved=seedRecord(Model,reopened,replacementSeed);assert.deepEqual(preserved,reopened);assert.equal(preserved.envelope.state.writer,'Zephyr');assert.throws(()=>seedRecord(Model,null,{entries:'bad'}));});


import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Transactional browser-storage stand-in: committed maps persist across fresh JS contexts.
function idbFixture() {
 const disk=new Map();let created=false;
 const clone=x=>structuredClone(x);
 const database={createObjectStore(n){disk.set(n,new Map());},transaction(names,mode){
  const staged=new Map(names.map(n=>[n,new Map([...disk.get(n)].map(([k,v])=>[k,clone(v)]))]));let pending=0,aborted=false;
  const t={objectStore(n){const map=staged.get(n);const operation=fn=>{pending++;const r={};setImmediate(()=>{try{r.result=clone(fn());r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();}pending--;finish();});return r;};return {get:k=>operation(()=>map.get(k)),getAll:()=>operation(()=>[...map.values()]),getAllKeys:()=>operation(()=>[...map.keys()]),put:(v,k)=>operation(()=>{map.set(k,clone(v));return k;})};},abort(){aborted=true;t.onabort?.();}};
  function finish(){setImmediate(()=>{if(!pending&&!aborted){aborted=true;if(mode==='readwrite')for(const [n,map] of staged)disk.set(n,map);t.oncomplete?.();}});} finish();return t;
 }};
 return {disk,indexedDB:{open(){const r={};setImmediate(()=>{r.result=database;if(!created){created=true;r.onupgradeneeded?.();}r.onsuccess?.();});return r;}}};
}
async function launch(fixture,seed) {
 const context={GrimoireApp:{offlineMode:()=>true},GrimoireModel:Model,indexedDB:fixture.indexedDB,crypto:globalThis.crypto,Response,Blob,URL,Uint8Array,Date,JSON,console,setTimeout,location:{href:'https://grimoire.invalid/',origin:'https://grimoire.invalid'},document:{documentElement:{},querySelectorAll:()=>[]},MutationObserver:class{observe(){}},fetch:async path=>{assert.equal(path,'owner-seed.json');return new Response(JSON.stringify(seed));}};
 vm.runInNewContext(readFileSync(new URL('../android/offline.js',import.meta.url),'utf8'),context);
 return async (path,body)=>{const r=await context.fetch(path,body?{method:'PUT',body:JSON.stringify(body)}:{});return {status:r.status,...await r.json()};};
}
test('offline adapter commits, reopens without reseeding, rejects invalid imports and lists retained backups',async()=>{
 const fixture=idbFixture(),api=await launch(fixture,state());let loaded=await api('api/state');assert.equal(loaded.status,200);const edited=loaded.state;edited.writer='Zephyr';const saved=await api('api/state',{state:edited,baseEtag:loaded.etag});assert.equal(saved.status,200);
 const replacement=state();replacement.writer='Kimi';const reopened=await launch(fixture,replacement);loaded=await reopened('api/state');assert.equal(loaded.state.writer,'Zephyr');assert.equal(loaded.etag,saved.etag);
 const rejected=await reopened('api/state',{state:{entries:'broken'},baseEtag:saved.etag,reason:'import'});assert.equal(rejected.status,400);assert.equal((await reopened('api/state')).state.writer,'Zephyr');const backups=await reopened('api/backups');assert.equal(backups.backups.length,1);assert.equal(backups.backups[0].summary.entries,0);
});


test('offline persistence and import/export retain nonempty version history and Undo',async()=>{
 const legacy=Model.parseImport(readFileSync(new URL('./fixtures/legacy-preview-export-2026-10-13.json',import.meta.url),'utf8'));assert.equal(legacy.errors.length,0);assert.ok(legacy.state.entries.length>0);const entry=legacy.state.entries[0];const original=structuredClone(entry.versions[entry.versions.length-1]);entry.versions.push({...original,v:original.v+1,title:original.title+' offline revision'});
 const originalState=JSON.parse(JSON.stringify(legacy.state));const fixture=idbFixture();const api=await launch(fixture,legacy.state);const loaded=await api('api/state');assert.deepEqual(loaded.state.entries,originalState.entries);const reopened=await launch(fixture,state());assert.deepEqual((await reopened('api/state')).state.entries,originalState.entries);const exported=Model.envelope(loaded.state);assert.deepEqual(Model.parseImport(JSON.stringify(exported)).state.entries,originalState.entries);assert.deepEqual(Model.parseImport(JSON.stringify(exported)).state.undo,originalState.undo);
});

