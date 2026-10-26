import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('APK validator rejects raw backslash names even when Windows ZIP readers normalize them',()=>{
 const code = `import importlib.util,tempfile,pathlib,zipfile
s=importlib.util.spec_from_file_location('assets','android/apk-assets.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'bad.apk'; q=pathlib.Path(d)/'normalized.apk'
 with zipfile.ZipFile(p,'w') as z: z.writestr('assets/web/index.html','test')
 p.write_bytes(p.read_bytes().replace(b'assets/web/index.html',b'assets/web'+bytes([92])+b'index.html'))
 try: m.verify(p); raise AssertionError('Backslash accepted')
 except ValueError as e: assert 'Backslash' in str(e)
 m.normalize(p,q)
 with zipfile.ZipFile(q) as z:
  assert [i.orig_filename for i in z.infolist()]==['assets/web/index.html']
  assert z.read('assets/web/index.html')==b'test'
 print('RAW ZIP PATH REGRESSION OK')
`;
 const r=spawnSync('python',['-c',code],{encoding:'utf8'});
 assert.equal(r.status,0,r.stdout+r.stderr); assert.match(r.stdout,/RAW ZIP PATH REGRESSION OK/);
});

