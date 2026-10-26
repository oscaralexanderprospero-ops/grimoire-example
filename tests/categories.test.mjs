import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './app-harness.mjs';
test('Dreams, Astral Travel and Trance are usable shared create categories',()=>{
 const app=loadApp(); const html=app.show('#/capture');
 for(const [id,name] of [['dreams','Dreams'],['astral-travel','Astral Travel'],['trance','Trance']]) {
  assert.ok(app.S.categories.some(c=>c.id===id&&c.name===name&&!c.hideEmpty));
  assert.ok(html.includes(`value="${id}"`));
 }
});



