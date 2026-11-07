// A large page must use CSS-only protection with the default settings.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'apb-default-'));
const css=fs.readFileSync(path.join(root,'content.css'),'utf8');
let source=fs.readFileSync(path.join(root,'content.js'),'utf8');
source=source.replace(/\}\)\(\);\s*$/, 'window.__apbDefault=()=>({masks:masks.size,ranges:highlight?.size||0});})();');
const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
const setup=`
 let visits=0,observers=0,activeObservers=0,callbacks=0,highlightObjects=0,changeSettings;
 const NativeObserver=MutationObserver;
 window.MutationObserver=class extends NativeObserver{
  constructor(cb){super(records=>{callbacks++;cb(records);});observers++;this.active=false;}
  observe(...args){if(!this.active){activeObservers++;this.active=true;}return super.observe(...args);}
  disconnect(){if(this.active){activeObservers--;this.active=false;}return super.disconnect();}
 };
 const NativeHighlight=Highlight;
 window.Highlight=class extends NativeHighlight{constructor(...args){super(...args);highlightObjects++;}};
 const factory=document.createTreeWalker.bind(document);
 document.createTreeWalker=(...args)=>{visits++;return factory(...args);};
 window.chrome={storage:{local:{get(defaults,cb){cb(defaults);}},onChanged:{addListener(cb){changeSettings=cb;}}}};
 const host=document.getElementById('host');
 for(let i=0;i<30000;i++){const p=document.createElement('p');p.textContent='Ordinary product description';host.append(p);}
 const heap=()=>{if(window.gc)window.gc();return performance.memory?.usedJSHeapSize||0;};
 const heapBefore=heap();
`;
const checks=`
 const results=[];
 const check=(condition,label)=>{if(!condition)throw Error(label);results.push(label);};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 const privateStyle=()=>getComputedStyle(document.getElementById('private-name'));
 (async()=>{
  await settle();
  check(visits===0&&observers===0&&highlightObjects===0,'default mode creates no walker observer or Highlight on a 30000-node page');
  check(privateStyle().webkitTextFillColor==='rgba(0, 0, 0, 0)'&&privateStyle().backgroundImage.includes('data:image/png'),
   'default address and recipient protection uses a static PNG without text scanning');
  const heapAfter=heap();
  check(!heapBefore||heapAfter-heapBefore<1024*1024,'additional default JavaScript heap is below 1 MiB in the local fixture');
  for(let i=0;i<1000;i++){const p=document.createElement('p');p.textContent='Reference 123-4567';host.append(p);}
  await settle();
  check(callbacks===0&&visits===0&&!document.querySelector('[data-apb-mask]'),
   '1000 product updates allocate no masks and cause no callbacks or scans by default');
  const newField=document.createElement('div');newField.className='displayAddressDiv';newField.textContent='New Recipient';host.append(newField);
  check(getComputedStyle(newField).backgroundImage.includes('data:image/png'),'new private fields are protected immediately by CSS');
  for(let i=0;i<4;i++){
   changeSettings({enabled:{newValue:false}},'local');
   changeSettings({enabled:{newValue:true},mode:{newValue:i%2?'blur':'stars'}},'local');
  }
  await settle();
  check(visits===0&&observers===0&&highlightObjects===0,'default ON OFF and mode changes never start the optional scanner');
  changeSettings({mode:{newValue:'stars'},scanPostal:{newValue:true}},'local');await settle();
  check(visits>0&&activeObservers===1&&__apbDefault().masks>0,'explicit postal opt-in starts the bounded scanner');
  changeSettings({scanPostal:{newValue:false}},'local');await settle();
  check(activeObservers===0&&__apbDefault().masks===0&&__apbDefault().ranges===0,
   'disabling optional postal search releases observers masks and ranges');
  changeSettings({names:{newValue:'UniqueToken'}},'local');await settle();
  check(document.querySelector('#optional-name [data-apb-mask]')?.textContent==='UniqueToken',
   'explicit optional text still works without enabling postal scanning');
  changeSettings({names:{newValue:''}},'local');await settle();
  check(activeObservers===0&&__apbDefault().masks===0&&__apbDefault().ranges===0,
   'clearing optional text returns to CSS-only protection');
  const output=document.createElement('pre');output.id='footprint-result';
  output.textContent=JSON.stringify({ok:true,checks:results.length,initialNodes:30000,defaultObserverCallbacks:0,
   defaultWalkerCreations:0,defaultHighlightCreations:0,heapBefore,heapAfter,additionalJSBytes:heapAfter-heapBefore});document.body.append(output);
 })().catch(error=>{const output=document.createElement('pre');output.id='footprint-result';
 output.textContent=JSON.stringify({ok:false,error:error.stack,results});document.body.append(output);});
`;
const input=path.join(dir,'test.html');
fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><body>'+
 '<div id="private-name" class="recipient">Private Person</div><p id="optional-name">UniqueToken</p><div id="host"></div>'+script(setup)+script(source)+script(checks));
const chrome=process.env.APB_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--enable-precise-memory-info','--js-flags=--expose-gc',
 '--user-data-dir='+path.join(dir,'profile'),'--dump-dom','--virtual-time-budget=10000',pathToFileURL(input).href],
 {encoding:'utf8',timeout:30000,maxBuffer:6*1024*1024});
assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
const output=result.stdout.match(/<pre id="footprint-result">([^<]*)<\/pre>/);assert.ok(output,'Default footprint test did not complete');
const report=JSON.parse(output[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
console.log(JSON.stringify(report,null,2));assert.equal(report.ok,true,'Default footprint regression failed');
