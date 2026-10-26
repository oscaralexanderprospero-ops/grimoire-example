from pathlib import Path
import subprocess,zipfile,shutil,json,sys,struct
root=Path.cwd();b=Path(sys.argv[1]);java=b/'jdk-17.0.20.1/bin';bt=b/'sdk/build-tools/35.0.0';android=b/'sdk/platforms/android-35/android.jar';log=[]
def run(args):
 r=subprocess.run([str(x) for x in args],capture_output=True,text=True);log.append({'command':[str(x) for x in args],'exit':r.returncode,'output':r.stdout+r.stderr});(root/'apk-build-results.json').write_text(json.dumps(log,indent=2));
 if r.returncode:raise RuntimeError(r.stderr)
for name in ['grimoire-example']:
 src=root;out=root/'build'/name;out.mkdir(parents=True,exist_ok=True);res=out/'res/drawable';res.mkdir(parents=True,exist_ok=True)
 (res/'example_icon.xml').write_text('<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48"><path android:fillColor="#345678" android:pathData="M4,4h40v40h-40z"/><path android:fillColor="#FFFFFF" android:pathData="M12,12h24v4h-24zM12,22h24v4h-24zM12,32h16v4h-16z"/></vector>')
 assets=out/'assets';assets.mkdir(exist_ok=True);isg=name.startswith('grimoire');source=src/'android' if isg else src/'app/src/main';manifest=(source/'AndroidManifest.xml').read_text();manifest=manifest.replace('@mipmap/ic_launcher','@drawable/example_icon');manifest=manifest.replace(' android:networkSecurityConfig="@xml/network_security_config"','');manifest=manifest.replace('<manifest xmlns:', '<manifest package="local.audiowriter" xmlns:') if not isg else manifest
 (out/'AndroidManifest.xml').write_text(manifest)
 if isg:
  shutil.copytree(src/'preview',assets/'web',dirs_exist_ok=True);shutil.copyfile(source/'offline.js',assets/'web/offline.js');p=assets/'web/index.html';t=p.read_text();t=t.replace('<script src="app.js"></script>','<script src="offline.js"></script><script src="app.js"></script>');p.write_text(t)
  seed="const fs=require('fs'),vm=require('vm'),M=require('./preview/model.js');const c={window:{}};vm.runInNewContext(fs.readFileSync('./preview/data.js','utf8'),c);fs.writeFileSync(process.argv[1],JSON.stringify(M.normalize({entries:c.window.GRIMOIRE_SAMPLE.entries,journal:[]})));"
  run(['node','-e',seed,assets/'web/owner-seed.json'])
 else:shutil.copytree(source/'assets',assets,dirs_exist_ok=True)
 shutil.copytree(src/'third-party',assets/'third-party',dirs_exist_ok=True) if (src/'third-party').exists() else None
 shutil.copyfile(src/'LICENSE',assets/'LICENSE');shutil.copyfile(src/'LICENSING.md',assets/'LICENSING.md')
 jars=[]
 if not isg:
  vendor=Path(sys.argv[2])
  for dep in ['vosk-android-0.3.75','jna-5.18.1']:
   with zipfile.ZipFile(vendor/(dep+'.aar')) as z:
    jar=out/(dep+'.jar');jar.write_bytes(z.read('classes.jar'));jars.append(jar)
    for n in z.namelist():
     if n.startswith('jni/') and not n.endswith('/'):
      q=out/'native'/n.replace('jni/','lib/',1);q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(z.read(n))
  with zipfile.ZipFile(vendor/'vosk-model-small-en-us-0.15.zip') as z:
   for n in z.namelist():
    rel=Path(*Path(n).parts[1:]);
    if not n.endswith('/') and '..' not in rel.parts:
     q=assets/'vosk-model'/rel;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(z.read(n))
 run([bt/'aapt2.exe','compile','--dir',out/'res','-o',out/'res.zip'])
 run([bt/'aapt2.exe','link','-o',out/'unsigned.apk','-I',android,'--manifest',out/'AndroidManifest.xml','-A',assets,'--min-sdk-version','26','--target-sdk-version','35',out/'res.zip'])
 classes=out/'classes';classes.mkdir(exist_ok=True);sources=list((source/('src' if isg else 'java')).rglob('*.java'));run([java/'javac.exe','-source','17','-target','17','-encoding','UTF-8','-classpath',';'.join(str(x) for x in [android]+jars),'-d',classes]+sources)
 dex=out/'dex';dex.mkdir(exist_ok=True);run([java/'java.exe','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--lib',android,'--min-api','26','--output',dex]+list(classes.rglob('*.class'))+jars)
 with zipfile.ZipFile(out/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
  for p in dex.glob('*.dex'):z.write(p,p.name)
  for p in (out/'native').rglob('*') if (out/'native').exists() else []:
   if p.is_file():z.write(p,p.relative_to(out/'native').as_posix())

 normalized=out/'normalized.apk'
 with zipfile.ZipFile(out/'unsigned.apk') as z,zipfile.ZipFile(normalized,'w',zipfile.ZIP_DEFLATED) as fixed:
  for item in z.infolist():
   z.fp.seek(item.header_offset+26); ln,extra=struct.unpack('<HH',z.fp.read(4)); item.orig_filename=z.fp.read(ln).decode('utf-8'); fixed.writestr(item.orig_filename.replace('\\','/'),z.read(item))
 run([bt/'zipalign.exe','-f','-p','4',normalized,out/(name+'-unsigned.apk')]);run([bt/'zipalign.exe','-c','4',out/(name+'-unsigned.apk')]);run([bt/'aapt2.exe','dump','badging',out/(name+'-unsigned.apk')]);print(name,'unsigned APK built')
