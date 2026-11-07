// Actual popup markup/styles/script, including failed-write rollback.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'apb-popup-'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
const setup=`
 let stored={enabled:false,mode:'blur',names:'Keep this text'},writes=[],failNext=false;
 window.chrome={storage:{local:{
  get(defaults,cb){setTimeout(()=>cb({...defaults,...stored}),0);},
  async set(values){if(failNext){failNext=false;throw Error('Simulated write failure');}
   stored={...stored,...values};writes.push(values);}
 }}};
`;
const checks=`
 const results=[];
 const check=(value,label)=>{if(!value)throw Error(label);results.push(label);};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 (async()=>{
  const button=document.getElementById('enabled');
  check(button.disabled,'toggle waits for saved settings before accepting clicks');
  await settle();
  check(!button.disabled&&button.getAttribute('aria-pressed')==='false'&&
   document.getElementById('enabled-label').textContent==='保護オフ'&&
   getComputedStyle(document.querySelector('.eye-closed')).display==='none'&&
   getComputedStyle(document.querySelector('.eye-open')).display!=='none',
   'saved off state shows the open eye and explicit off label');
  const writeCount=writes.length;button.click();button.click();
  check(button.disabled&&writes.length===writeCount+1,'rapid clicks cannot enqueue duplicate toggle writes');
  await settle();
  check(stored.enabled&&stored.mode==='blur'&&stored.names==='Keep this text'&&
   button.getAttribute('aria-pressed')==='true'&&getComputedStyle(document.querySelector('.eye-open')).display==='none',
   'one click enables protection and shows the slashed eye without losing other settings');
  failNext=true;button.click();await settle();
  check(stored.enabled&&button.getAttribute('aria-pressed')==='true'&&!button.disabled&&
   document.getElementById('status').textContent.includes('保存できません'),
   'failed write restores the previous eye state and reports failure');
  button.click();await settle();
  check(!stored.enabled&&button.getAttribute('aria-pressed')==='false'&&button.getAttribute('aria-label').includes('オンにする'),
   'second successful click disables protection and labels the next action');
  const select=document.getElementById('mode');select.value='stars';select.dispatchEvent(new Event('change'));await settle();
  check(stored.mode==='stars'&&!stored.enabled&&stored.names==='Keep this text','changing mask mode keeps the eye state and optional text');
  document.getElementById('names').value='Updated text';document.getElementById('save').click();await settle();
  check(stored.names==='Updated text'&&!stored.enabled&&stored.mode==='stars','saving optional text keeps mode and protection state');
  const postal=document.getElementById('scan-postal');postal.checked=true;postal.dispatchEvent(new Event('change'));await settle();
  check(stored.scanPostal===true&&stored.names==='Updated text'&&!stored.enabled,'optional full-page postal search is saved separately');
  const output=document.createElement('pre');output.id='popup-result';
  output.textContent=JSON.stringify({ok:true,checks:results.length});document.body.append(output);
 })().catch(error=>{const output=document.createElement('pre');output.id='popup-result';
 output.textContent=JSON.stringify({ok:false,error:error.message,results});document.body.append(output);});
`;
let html=read('popup.html').replace('<link rel="stylesheet" href="popup.css">','<style>'+read('popup.css')+'</style>');
html=html.replace('<script src="popup.js"></script>',script(setup)+script(read('popup.js'))+script(checks));
const input=path.join(dir,'popup.html');fs.writeFileSync(input,html);
const chrome=process.env.APB_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),
 '--dump-dom','--virtual-time-budget=2000',pathToFileURL(input).href],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
const output=result.stdout.match(/<pre id="popup-result">([^<]*)<\/pre>/);assert.ok(output,'Popup test did not finish');
const report=JSON.parse(output[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
assert.equal(report.ok,true,JSON.stringify(report));console.log(JSON.stringify(report,null,2));
