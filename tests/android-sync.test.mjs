import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),Model=require('../preview/model.js'),Core=require('../preview/sync.js');
const {syncMetadata,syncReply}=require('../android/offline.js');
const fresh=()=>Model.normalize({entries:[],journal:[]});

test('phone sync identity and queued IDs survive restart and are not seeded across devices',()=>{
 const a=syncMetadata(Core,Model,fresh(),null),b=syncMetadata(Core,Model,fresh(),null);assert.notEqual(a.replica.deviceId,b.replica.deviceId);
 const state=fresh();state.writer='Zephyr';const changed=syncMetadata(Core,Model,state,a);const reopened=syncMetadata(Core,Model,state,JSON.parse(JSON.stringify(changed)));
 assert.equal(reopened.replica.deviceId,a.replica.deviceId);assert.deepEqual(reopened.replica.outbox,changed.replica.outbox);assert.equal(reopened.replica.outbox.length,1);
});

test('phone exchange retries are idempotent and acknowledges only the exact sent operation',()=>{
 let phone=syncMetadata(Core,Model,fresh(),null);const state=fresh();state.writer='Zephyr';phone=syncMetadata(Core,Model,state,phone);
 const op=phone.replica.outbox[0];let laptop=Core.createReplica('laptop-test',fresh());const receipt=Core.receive(laptop,op).receipt;
 const received=syncReply(Core,Model,phone,state,{operations:[],receipts:[receipt]},[]);assert.equal(received.replica.outbox.length,0);assert.equal(phone.replica.outbox.length,1);
 const repeated=syncReply(Core,Model,received,state,{operations:[],receipts:[receipt]},[]);assert.equal(repeated.replica.outbox.length,0);
 assert.throws(()=>syncReply(Core,Model,phone,state,{operations:[],receipts:[{...receipt,operation:'forged'}]},[]));
});

test('phone two-way exchange preserves concurrent full versions and queues acknowledgments',()=>{
 const state=Model.parseImport(readFileSync(new URL('./fixtures/legacy-preview-export-2026-10-13.json',import.meta.url),'utf8')).state;
 let phone={replica:Core.createReplica('phone-test',state),pendingReceipts:[]};let laptop=Core.createReplica('laptop-test',state);
 const local=structuredClone(state),remote=structuredClone(state);local.entries[0].versions.at(-1).title='Local version';remote.entries[0].versions.at(-1).title='Remote version';
 phone=syncMetadata(Core,Model,local,phone);laptop=Core.queue(laptop,remote);
 const merged=syncReply(Core,Model,phone,local,{operations:laptop.outbox,receipts:[]},[]);
 assert.equal(merged.replica.state.entries[0].versions.at(-1).title,'Local version');assert.equal(merged.replica.conflicts.length,1);
 assert.equal(merged.replica.conflicts[0].changes[0].remote.versions.at(-1).title,'Remote version');assert.equal(merged.pendingReceipts[0].status,'conflict');
 const repeat=syncReply(Core,Model,merged,merged.replica.state,{operations:laptop.outbox,receipts:[]},[]);assert.equal(repeat.replica.conflicts.length,1);assert.equal(repeat.pendingReceipts.length,1);
});

test('malformed exchange leaves durable queue unchanged and cannot turn failure into success',()=>{
 const state=fresh();state.writer='Zephyr';const phone=syncMetadata(Core,Model,state,null),before=JSON.stringify(phone);
 assert.throws(()=>syncReply(Core,Model,phone,state,{operations:'bad',receipts:[]},[]));assert.equal(JSON.stringify(phone),before);
 assert.throws(()=>syncReply(Core,Model,phone,state,{operations:[{id:'bad'}],receipts:[]},[]));assert.equal(JSON.stringify(phone),before);
});

