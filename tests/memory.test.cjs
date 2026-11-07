// Repeated updates, tab suspension, bounded wrappers and address-free frame checks.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let source=fs.readFileSync(process.env.APB_TEST_SOURCE || path.join(root,'content.js'),'utf8');
source=source.replace(/\}\)\(\);\s*$/, 'window.__apbMemory=()=>({masks:masks.size,ranges:highlight?.size||0});})();');
const css=fs.readFileSync(path.join(root,'content.css'),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apb-memory-'));
const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
const setup=`
 let hidden=false,visits=0,callbacks=0,fontLoads=0,settingsChange;
 Object.defineProperty(document,'hidden',{get:()=>hidden});
 const NativeObserver=MutationObserver;
 window.MutationObserver=class extends NativeObserver{constructor(cb){super(records=>{callbacks++;cb(records);});}};
 const walkerFactory=document.createTreeWalker.bind(document);
 document.createTreeWalker=(...args)=>{const walker=walkerFactory(...args),next=walker.nextNode.bind(walker);
 walker.nextNode=()=>{const node=next();if(node)visits++;return node;};return walker;};
 const NativeFont=FontFace;
 window.FontFace=class extends NativeFont{constructor(...args){super(...args);fontLoads++;}};
 window.chrome={storage:{local:{get(defaults,cb){cb({...defaults,scanPostal:true});}},onChanged:{addListener(cb){settingsChange=cb;}}}};
 const host=document.getElementById('host');
 for(let i=0;i<400;i++){const p=document.createElement('p');p.textContent='Postal 123-4567';host.append(p);}
`;
const checks=`
 const source=${JSON.stringify(source)};
 const results=[];
 const record=(condition,label)=>results.push({ok:!!condition,label});
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 const heap=()=>{if(window.gc)window.gc();return performance.memory?.usedJSHeapSize||0;};
 (async()=>{
  await settle();await settle();
  record(host.querySelectorAll('[data-apb-mask]').length===400,'initial traversal masks every sibling, not just the first text');
  const before=heap();
  for(let i=0;i<100;i++){host.textContent='Update '+i+' 123-4567';await settle();}
  const active=__apbMemory();
  record(active.masks===1,'100 replacements retain only the current mask');
  hidden=true;document.dispatchEvent(new Event('visibilitychange'));await settle();
  const suspended=__apbMemory();
  record(suspended.masks===0&&suspended.ranges===0,'hidden tab releases wrappers and highlight ranges');
  visits=0;const beforeCallbacks=callbacks;
  for(let i=0;i<100;i++){host.textContent='Background '+i+' 987-6543';await settle();}
  record(visits===0&&callbacks===beforeCallbacks,'hidden updates perform no traversal and deliver no observer callbacks');
  const hiddenMetrics={visits,callbacks:callbacks-beforeCallbacks};
  hidden=false;document.dispatchEvent(new Event('visibilitychange'));await settle();
  record(host.querySelector('[data-apb-mask]')?.textContent==='987-6543','visible tab protects the latest background update');
  host.textContent=Array(2000).fill('123-4567').join(' ');await settle();
  const large=__apbMemory();
  record(large.masks<=512&&large.ranges>=1,'large match counts use bounded wrappers and a highlight fallback');
  host.textContent='After burst 123-4567';await settle();
  record(__apbMemory().masks===1&&__apbMemory().ranges===0,'large update resources are released after replacement');
  const after=heap();
  record(!before||after-before<12*1024*1024,'forced-GC JavaScript heap stays within 12 MiB of the initial page');
  let frameFonts=0;
  for(let i=0;i<12;i++){
   const frame=document.createElement('iframe');document.body.append(frame);
   const win=frame.contentWindow,doc=frame.contentDocument;
   doc.body.textContent='An embedded frame without any private address fields';
   const NativeFrameFont=win.FontFace;
   win.FontFace=class extends NativeFrameFont{constructor(...args){super(...args);frameFonts++;}};
   win.chrome={storage:{local:{get(defaults,cb){cb(defaults);}},onChanged:{addListener(){}}}};
   win.eval(source);await settle();frame.remove();
  }
  record(frameFonts===0,'12 address-free frames allocate no mask fonts');
  settingsChange({enabled:{newValue:false}},'local');await settle();
  record(__apbMemory().masks===0&&__apbMemory().ranges===0,'off releases all tracked display resources');
  const output=document.createElement('pre');output.id='memory-result';
  output.textContent=JSON.stringify({ok:results.every(r=>r.ok),checks:results.length,results,
   hidden:hiddenMetrics,frameFonts,heapBefore:before,heapAfter:after,large});document.body.append(output);
 })().catch(error=>{const output=document.createElement('pre');output.id='memory-result';
 output.textContent=JSON.stringify({ok:false,error:error.stack,results});document.body.append(output);});
`;
const input=path.join(dir,'test.html');
fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><div id="host"></div>'+script(setup)+script(source)+script(checks));
const chrome=process.env.APB_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--enable-precise-memory-info','--js-flags=--expose-gc',
 '--user-data-dir='+path.join(dir,'profile'),'--dump-dom','--virtual-time-budget=20000',pathToFileURL(input).href],
 {encoding:'utf8',timeout:30000,maxBuffer:5*1024*1024});
assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
const output=result.stdout.match(/<pre id="memory-result">([^<]*)<\/pre>/);
assert.ok(output,'Memory test did not complete');
const report=JSON.parse(output[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
console.log(JSON.stringify(report,null,2));
assert.equal(report.ok,true,'Memory regression checks failed');
