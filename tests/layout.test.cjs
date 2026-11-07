// Keep the purchase column's geometry stable across fonts, widths and repeated toggles.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'apb-layout-'));
const source=fs.readFileSync(path.join(root,'content.js'),'utf8');
const css=fs.readFileSync(path.join(root,'content.css'),'utf8');
const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
const fonts=['Arial','"Times New Roman"','Consolas','"Yu Gothic UI"','Meiryo','"Segoe UI"'];
let fixtures='';
for(const [fontIndex,font] of fonts.entries())for(const width of [140,180,240]){
 const key=fontIndex+'-'+width;
 fixtures+=`<section data-case="${key}" style='width:${width}px;font-family:${font};font-size:${12+fontIndex}px;line-height:normal'>
  <div data-track class="price">￥2,480</div>
  <div data-track class="recipient" style="display:flex;gap:4px"><i data-track>Location</i><span data-track>山田 太郎 - Tokyo 123-4567 サンプル町1-2-3</span></div>
  <div data-track class="displayAddressDiv">Sample Person / 京都府 テスト市 テストビル402</div>
  <p data-track>配送情報 123-4567 / ref 765-4321</p><button data-track>カートに入れる</button>
 </section>`;
}
const setup=`
 let changeSettings;window.chrome={storage:{local:{get(defaults,cb){cb({...defaults,enabled:false});}},
 onChanged:{addListener(cb){changeSettings=cb;}}}};
`;
const checks=`
 const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
 const snapshot=()=>[...document.querySelectorAll('[data-track]')].map(node=>{
  const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100);});
 (async()=>{
  const differences=[];let comparisons=0;
  for(let cycle=0;cycle<3;cycle++)for(const mode of ['stars','blur']){
   changeSettings({enabled:{newValue:false},mode:{newValue:mode}},'local');await settle();
   const before=snapshot();
   changeSettings({enabled:{newValue:true}},'local');await settle();await settle();await document.fonts.ready;
   const after=snapshot();comparisons+=18;
   for(let i=0;i<before.length;i++)if(JSON.stringify(before[i])!==JSON.stringify(after[i])){
    const node=document.querySelectorAll('[data-track]')[i];
    differences.push({cycle,mode,fixture:node.closest('[data-case]').dataset.case,node:node.tagName,before:before[i],after:after[i]});
   }
  }
  const output=document.createElement('pre');output.id='layout-result';
  output.textContent=JSON.stringify({ok:!differences.length,fixtures:18,comparisons,differenceCount:differences.length,examples:differences.slice(0,4)});
  document.body.append(output);
 })().catch(error=>{const output=document.createElement('pre');output.id='layout-result';
 output.textContent=JSON.stringify({ok:false,error:error.stack});document.body.append(output);});
`;
const input=path.join(dir,'test.html');
fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>body{margin:20px;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}section{border:1px solid;padding:8px;box-sizing:border-box}button{max-width:100%}'+css+'</style><body>'+fixtures+script(setup)+script(source)+script(checks));
const chrome=process.env.APB_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result=spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--user-data-dir='+path.join(dir,'profile'),
 '--dump-dom','--virtual-time-budget=10000',pathToFileURL(input).href],{encoding:'utf8',timeout:30000,maxBuffer:3*1024*1024});
assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
const output=result.stdout.match(/<pre id="layout-result">([^<]*)<\/pre>/);assert.ok(output,'Layout test did not finish');
const report=JSON.parse(output[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
console.log(JSON.stringify(report,null,2));assert.equal(report.ok,true,'Purchase-column layout changed');
