// Durable isolated sync ledger. No transport, credentials or production-store mutation.

import {promises as fs} from 'node:fs';

import {join} from 'node:path';

import {randomBytes} from 'node:crypto';

import {createRequire} from 'node:module';

const Sync=createRequire(import.meta.url)('./sync.js');

export function createSyncStore(dir,deviceId,initialState){

 const file=join(dir,'sync-ledger.json');let chain=Promise.resolve();

 async function read(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return Sync.createReplica(deviceId,initialState);throw e;}}

 async function commit(value){await fs.mkdir(dir,{recursive:true});const temp=file+'.'+randomBytes(8).toString('hex');const h=await fs.open(temp,'wx');try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}await fs.rename(temp,file);}

 function change(fn){const result=chain.then(async()=>{await fs.mkdir(dir,{recursive:true});const lock=await fs.open(file+'.lock','wx');try{const before=await read();const result=fn(before);await commit(result.replica);return result;}finally{await lock.close();await fs.unlink(file+'.lock');}});chain=result.catch(()=>{});return result;}

 return {read,queue:state=>change(r=>({replica:Sync.queue(r,state)})),receive:op=>change(r=>Sync.receive(r,op)),acknowledge:receipt=>change(r=>({replica:Sync.acknowledge(r,receipt)}))};

}

