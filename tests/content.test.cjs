// Real Chromium DOM/Highlight API regression and traversal check.
// Run: node tests/content.test.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'content.css'), 'utf8');
assert.equal(css.replace(/\r\n/g, '\n'), require('../scripts/generate-css.cjs').generateCSS(), 'Regenerate content.css after changing automatic fields');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-incremental-'));
const script = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
const setup = `
  let settings = {enabled:true, mode:'blur', scanPostal:true, names:'Sample Person\\nSample Person\\nA+B'};
  let changeSettings;
  let storageReads = 0, observerCalls = 0, registryWrites = 0;
  const NativeObserver = MutationObserver;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(records => { observerCalls++; callback(records); }); }
  };
  const register = CSS.highlights.set.bind(CSS.highlights);
  CSS.highlights.set = (...args) => { registryWrites++; return register(...args); };
  window.chrome = {storage:{local:{get(defaults, cb){ storageReads++; cb(settings); }},
    onChanged:{addListener(cb){ changeSettings = cb; }}}};
  let visits = 0;
  const createWalker = document.createTreeWalker.bind(document);
  document.createTreeWalker = (...args) => {
    const walker = createWalker(...args);
    const next = walker.nextNode.bind(walker);
    walker.nextNode = () => { const node = next(); if(node) visits++; return node; };
    return walker;
  };
  const list = document.getElementById('list');
  for(let i=0;i<5000;i++) {
    const p = document.createElement('p'); p.textContent = 'Ordinary product description'; list.append(p);
  }
`;
const checks = `
  const extensionSource = ${JSON.stringify(source)};
  const results = [];
  const check = (condition, label) => { if(!condition) throw Error(label); results.push(label); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const ranges = () => [...(CSS.highlights.get('apb-private-text') || [])];
  const forNode = node => ranges().filter(r => r.startContainer === node);
  const update = values => {
    const changes = Object.fromEntries(Object.entries(values).map(([key,value]) =>
      [key, {oldValue:settings[key], newValue:value}]));
    settings = {...settings,...values}; changeSettings(changes, 'local');
  };
  (async () => {
    await settle();
    check(ranges().length === 5, 'initial names, escaped name, postal codes and private field');
    const initialVisits = visits;
    const stable = forNode(document.getElementById('name').firstChild)[0];
    visits = 0;
    const p = document.createElement('p'); p.textContent = 'New 123-4567'; list.append(p);
    await settle();
    check(forNode(p.firstChild).length === 1, 'new subtree protected');
    check(visits === 1, 'single insertion visits only one text node');
    check(forNode(document.getElementById('name').firstChild)[0] === stable, 'unchanged ranges reused');
    const insertionVisits = visits;
    check(registryWrites === 1, 'highlight registry is not rewritten for mutations');
    visits = 0;
    const ignoredBranch = document.createElement('div');
    ignoredBranch.setAttribute('contenteditable', 'true');
    for (let i=0; i<1000; i++) {
      const item = document.createElement('p'); item.textContent = 'Sample Person 123-4567'; ignoredBranch.append(item);
    }
    list.append(ignoredBranch); await settle();
    check(visits === 0 && forNode(ignoredBranch.firstChild.firstChild).length === 0,
      'ignored added subtree skips all 1000 text nodes');
    const ignoredChild = document.createElement('p'); ignoredChild.textContent='Sample Person';
    ignoredBranch.append(ignoredChild); await settle();
    check(visits === 0, 'mutation inside ignored ancestor skips traversal');
    const unchanged = forNode(document.getElementById('name').firstChild)[0];
    update({names: settings.names}); await settle();
    check(visits === 0 && forNode(document.getElementById('name').firstChild)[0] === unchanged,
      'unchanged settings preserve ranges without traversal');
    p.id = 'irrelevant-id'; await settle();
    check(visits === 0, 'unrelated id change skips traversal');
    p.firstChild.data = p.firstChild.data; await settle();
    check(forNode(p.firstChild)[0]?.toString() === '123-4567', 'identical text assignment restores native ranges');
    p.firstChild.data = 'No private text'; await settle();
    check(forNode(p.firstChild).length === 0, 'text edit clears old ranges');
    p.id = 'glow-ingress-line2'; await settle();
    check(forNode(p.firstChild)[0]?.toString() === 'No private text', 'id change protects full field');
    p.setAttribute('contenteditable','true'); await settle();
    check(forNode(p.firstChild).length === 0, 'editable ancestor clears ranges');
    p.removeAttribute('contenteditable'); await settle();
    check(forNode(p.firstChild).length === 1, 'editable removal restores protection');
    p.removeAttribute('id'); p.setAttribute('autocomplete','name'); await settle();
    check(forNode(p.firstChild).length === 1, 'autocomplete change protects field');
    const beforeRemoval = ranges().length;
    p.remove(); await settle();
    check(ranges().length === beforeRemoval - 1, 'removed subtree releases ranges');
    list.append(p); p.firstChild.data = 'Moved text'; list.prepend(p); await settle();
    check(forNode(p.firstChild).length === 1, 'move and overlapping mutations avoid duplicate ranges');
    const wrapper = document.createElement('div'); list.append(wrapper); wrapper.append(p); await settle();
    wrapper.setAttribute('contenteditable','true'); await settle();
    check(forNode(p.firstChild).length === 0, 'ancestor attribute rescans descendants');
    wrapper.removeAttribute('contenteditable'); await settle();
    check(forNode(p.firstChild).length === 1, 'ancestor attribute removal restores descendants');
    update({enabled:false}); visits=0;
    const callsWhenDisabled = observerCalls;
    p.firstChild.data = '123-4567'; await settle();
    check(ranges().length === 0 && visits === 0 && document.documentElement.hasAttribute('data-apb-off'), 'disabled mode performs no traversal');
    check(observerCalls === callsWhenDisabled, 'disabled observer receives no mutation callbacks');
    update({enabled:true, names:'Replacement'}); await settle();
    check(!document.documentElement.hasAttribute('data-apb-off') && forNode(p.firstChild).length === 1, 'reenabling rescans current DOM');
    check(forNode(document.getElementById('name').firstChild).length === 0, 'name changes clear previous matches');
    document.getElementById('name').firstChild.data = 'Replacement'; await settle();
    check(forNode(document.getElementById('name').firstChild).length === 1, 'updated names detected');
    visits = 0;
    ignoredBranch.removeAttribute('contenteditable'); await settle();
    check(forNode(ignoredBranch.firstChild.firstChild)[0]?.toString() === '123-4567',
      'previously pruned subtree is protected when editable attribute is removed');
    check(storageReads === 1, 'settings changes require no additional storage reads');
    document.getElementById('name').setAttribute('autocomplete', 'name'); await settle();
    const sameRange = forNode(document.getElementById('name').firstChild)[0];
    document.getElementById('name').setAttribute('autocomplete', 'postal-code'); await settle();
    check(forNode(document.getElementById('name').firstChild)[0] === sameRange,
      'unchanged matching text reuses ranges during attribute rescans');
    const scriptNode = document.createElement('script'); scriptNode.type='application/json';
    scriptNode.textContent = '123-4567';
    const styleNode = document.createElement('style'); styleNode.textContent='/* 123-4567 */';
    const selectNode = document.createElement('select');
    selectNode.innerHTML='<option>123-4567</option>';
    visits = 0;
    const ignoredContainer = document.createElement('div');
    ignoredContainer.append(scriptNode, styleNode, selectNode); list.append(ignoredContainer); await settle();
    check(visits === 0, 'nested script style and select subtrees are pruned');
    const moving = document.createElement('div'); moving.textContent='123-4567'; list.append(moving); await settle();
    ignoredBranch.setAttribute('contenteditable', 'true');
    ignoredBranch.append(moving); await settle();
    check(forNode(moving.firstChild).length === 0, 'move into newly editable ancestor releases old ranges');
    list.append(moving); await settle();
    check(forNode(moving.firstChild)[0]?.toString() === '123-4567', 'move out of ignored ancestor restores protection');
    const outer = document.createElement('div'), inner = document.createElement('div');
    inner.textContent='123-4567'; outer.append(inner); list.append(outer); await settle();
    inner.remove(); outer.append(inner); outer.remove(); await settle();
    check(forNode(inner.firstChild).length === 0, 'nested removals release all detached ranges');

    // Exercise document_start before <html>, independently of the parent fixture.
    const frame = document.createElement('iframe'); document.body.append(frame);
    const win = frame.contentWindow, doc = frame.contentDocument;
    doc.documentElement.remove();
    let frameChange;
    win.chrome = {storage:{local:{get(defaults, cb){cb({enabled:false,names:'',mode:'blur',scanPostal:true});}},
      onChanged:{addListener(cb){frameChange=cb;}}}};
    win.eval(extensionSource);
    const html = doc.createElement('html');
    html.innerHTML='<body><p>123-4567</p></body>'; doc.append(html); await settle();
    check(html.hasAttribute('data-apb-off') && !win.CSS.highlights.has('apb-private-text'),
      'initial disabled state handles document_start before html exists');
    frameChange({enabled:{newValue:true}}, 'local'); await settle();
    check(!html.hasAttribute('data-apb-off') && [...win.CSS.highlights.get('apb-private-text')][0]?.toString() === '123-4567',
      'early disabled document can be enabled normally');
    frame.remove();
    const pendingFrame = document.createElement('iframe'); document.body.append(pendingFrame);
    let finishRead, pendingChange;
    pendingFrame.contentWindow.chrome = {storage:{local:{get(defaults,cb){finishRead=cb;}},
      onChanged:{addListener(cb){pendingChange=cb;}}}};
    pendingFrame.contentWindow.eval(extensionSource);
    pendingChange({enabled:{newValue:false}}, 'local');
    finishRead({enabled:true,names:''}); await settle();
    check(pendingFrame.contentDocument.documentElement.hasAttribute('data-apb-off'),
      'settings event during initial storage read wins over stale initial values');
    pendingFrame.remove();
    // No registered names and no content script: known fields must be hidden by CSS itself.
    const autoFrame = document.createElement('iframe');
    const autoReady = new Promise(resolve => autoFrame.onload = resolve);
    autoFrame.srcdoc = '<!doctype html><meta charset="utf-8"><style>' + ${JSON.stringify(css)} + '</style>' +
      '<section class="order-card"><div class="yohtmlc-recipient"><span id="auto-name" style="color:blue">Unregistered Recipient</span></div>' +
      '<h2 id="auto-product" itemprop="name">Useful Notebook</h2><div id="auto-total">Total: 2,000 yen</div></section>' +
      '<div class="a-popover-content"><ul class="displayAddressUL"><li class="displayAddressFullName" id="auto-popup-name">Different Recipient</li>' +
      '<li class="displayAddressAddressLine1" id="auto-street">Example city 9-8-7</li><li id="auto-building">Example Building 402</li></ul></div>' +
      '<section data-component="shippingAddress"><b id="auto-detail">Other Name</b><p id="auto-detail-street">Another city 4-5-6</p></section>' +
      '<section data-component="billingAddress"><span id="auto-billing">Billing Name and Address</span></section>' +
      '<div id="address-book-entry-3-address"><span id="auto-book">Book Address</span></div><button id="auto-edit">Edit address</button>' +
      '<div class="a-popover-content"><span id="auto-unrelated-popover">Price breakdown</span></div>' +
      '<input id="auto-input" autocomplete="shipping street-address" value="Input Address">' +
      '<textarea id="auto-textarea" autocomplete="billing address-line1">Billing input</textarea>' +
      '<select id="auto-select" autocomplete="shipping address-level1"><option>Test prefecture</option></select>' +
      '<div id="dynamic-auto"><span id="auto-late-class">Late Recipient</span></div>';
    document.body.append(autoFrame); await autoReady;
    const autoDoc=autoFrame.contentDocument, autoWin=autoFrame.contentWindow;
    const isMasked = id => autoWin.getComputedStyle(autoDoc.getElementById(id)).webkitTextFillColor === 'rgba(0, 0, 0, 0)';
    check(isMasked('auto-name'), 'order history recipient is hidden without saved names or content JS');
    check(['auto-popup-name','auto-street','auto-building'].every(isMasked), 'address popover protects name street and building');
    check(isMasked('auto-detail') && isMasked('auto-detail-street'), 'order details protect full shipping address');
    check(isMasked('auto-billing'), 'billing address is automatically hidden');
    check(isMasked('auto-book') && !isMasked('auto-edit'), 'address book value hidden while edit button stays readable');
    check(!isMasked('auto-product') && !isMasked('auto-total') && !isMasked('auto-unrelated-popover'),
      'product name price and unrelated popover stay readable');
    check(['auto-input','auto-textarea','auto-select'].every(isMasked), 'shipping and billing autocomplete tokens mask native form values');
    const late = autoDoc.createElement('div'); late.className='displayAddressDiv';
    late.innerHTML='<span id="auto-late-address">New address from popover</span>'; autoDoc.body.append(late);
    check(isMasked('auto-late-address'), 'new address popover is hidden immediately without an observer');
    autoDoc.getElementById('dynamic-auto').className='recipient';
    check(isMasked('auto-late-class'), 'class change hides recipient immediately without traversal');
    autoDoc.getElementById('dynamic-auto').className='ordinary';
    check(!isMasked('auto-late-class'), 'removing field class restores nonprivate text');
    const beforeRect=autoDoc.getElementById('auto-street').getBoundingClientRect().toJSON();
    let automaticChange;
    autoWin.chrome={storage:{local:{get(defaults,cb){cb({enabled:false,names:'',mode:'blur'});}},
      onChanged:{addListener(cb){automaticChange=cb;}}}};
    autoWin.eval(extensionSource);
    check(!isMasked('auto-name') && !isMasked('auto-street') && !isMasked('auto-input'), 'off disables automatic text and native input masking');
    check(JSON.stringify(autoDoc.getElementById('auto-street').getBoundingClientRect().toJSON()) === JSON.stringify(beforeRect),
      'automatic masking preserves element position and size');
    automaticChange({enabled:{newValue:true}}, 'local');
    check(isMasked('auto-name') && isMasked('auto-street') && isMasked('auto-input'),
      'reenabling automatically masks addresses with an empty name list');
    autoFrame.remove();
    const starFrame=document.createElement('iframe');
    const starReady=new Promise(resolve=>starFrame.onload=resolve);
    starFrame.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="font-src &#39;none&#39;"><style>'+
      ${JSON.stringify(css)}+'</style><form id="star-form"><div class="displayAddressDiv"><span id="star-name">日本 Sample 太郎 🙂</span></div>'+
      '<input id="star-address" name="address" autocomplete="shipping street-address" value="実際の住所 1-2-3">'+
      '<textarea name="notes" autocomplete="billing address-line1">Original Building</textarea></form>'+
      '<p id="star-postal">Ship to 〒123-4567 today</p><h2 id="star-product">Ordinary Notebook</h2>';
    document.body.append(starFrame);await starReady;
    const sw=starFrame.contentWindow, sd=starFrame.contentDocument;
    let starCallbacks=0,starVisits=0;
    const StarObserver=sw.MutationObserver;
    sw.MutationObserver=class extends StarObserver{constructor(cb){super(records=>{starCallbacks++;cb(records);});}};
    const starWalker=sd.createTreeWalker.bind(sd);
    sd.createTreeWalker=(...args)=>{const walker=starWalker(...args),next=walker.nextNode.bind(walker);
      walker.nextNode=()=>{const node=next();if(node)starVisits++;return node;};return walker;};
    const starList=sd.createElement('div');
    for(let i=0;i<5000;i++){const item=sd.createElement('p');item.textContent='Ordinary description';starList.append(item);}
    sd.body.append(starList);
    const NativeFont=sw.FontFace;
    let fontLoads=0;
    sw.FontFace=class extends NativeFont {constructor(...args){super(...args);fontLoads++;}};
    let starChange;
    sw.chrome={storage:{local:{get(defaults,cb){cb({...defaults,enabled:true,names:'',scanPostal:true});}},
      onChanged:{addListener(cb){starChange=cb;}}}};
    const originalBody=sd.body.textContent;
    const originalForm=JSON.stringify([...new sw.FormData(sd.getElementById('star-form'))]);
    const originalFamily=sw.getComputedStyle(sd.getElementById('star-name')).fontFamily;
    const originalInputWidth=sd.getElementById('star-address').getBoundingClientRect().width;
    sw.eval(extensionSource);
    await settle();
    check(sd.documentElement.getAttribute('data-apb-mode')==='stars','missing saved mode defaults to stars');
    check(fontLoads===0,'star mode loads no fonts even with font-src none');
    check(sw.getComputedStyle(sd.querySelector('.displayAddressDiv')).backgroundImage.includes('data:image/png')&&
      sw.getComputedStyle(sd.getElementById('star-address')).backgroundImage.includes('data:image/png'),
      'automatic name and native input use a star paint pattern');
    check(sd.body.textContent===originalBody,'star masking preserves original textContent');
    check(JSON.stringify([...new sw.FormData(sd.getElementById('star-form'))])===originalForm,
      'star masking preserves submitted address and textarea values');
    check(sd.querySelector('#star-postal [data-apb-mask]')?.textContent==='〒123-4567'&&
      !sd.querySelector('#star-product [data-apb-mask]'),'standalone postal match is masked without wrapping product text');
    check(sw.getComputedStyle(sd.getElementById('star-name')).fontFamily===originalFamily&&
      sd.getElementById('star-address').getBoundingClientRect().width===originalInputWidth,
      'star mode preserves original font family and native input width');
    starVisits=0;
    const starInsertion=sd.createElement('p');starInsertion.textContent='New 123-4567';starList.append(starInsertion);
    await settle();const afterInsertion=starCallbacks;await settle();
    check(starVisits===1&&starCallbacks===afterInsertion&&!!starInsertion.querySelector('[data-apb-mask]'),
      'star mode visits only the inserted text and never loops on its own wrappers among 5000 items');
    const maskedText=sd.querySelector('#star-postal [data-apb-mask]').firstChild;
    maskedText.data='No private data';await settle();
    check(!sd.querySelector('#star-postal [data-apb-mask]')&&sd.getElementById('star-postal').textContent==='Ship to No private data today',
      'site text updates clear stale masks and keep the latest text');
    sd.getElementById('star-postal').textContent='〒987-6543';await settle();
    check(sd.querySelector('#star-postal [data-apb-mask]')?.textContent==='〒987-6543','new postal text is masked after a site update');
    starChange({mode:{newValue:'blur'}},'local');await settle();
    check(sd.documentElement.getAttribute('data-apb-mode')==='blur'&&!sd.querySelector('[data-apb-mask]')&&
      sw.CSS.highlights.get('apb-private-text').size>0,'switching to blur restores wrappers and uses highlights');
    starChange({mode:{newValue:'stars'}},'local');await settle();
    check(!!sd.querySelector('[data-apb-mask]'),'switching back to stars reapplies matches');
    const currentText=sd.body.textContent;
    starChange({enabled:{newValue:false}},'local');await settle();
    check(!sd.querySelector('[data-apb-mask]')&&sd.body.textContent===currentText&&
      JSON.stringify([...new sw.FormData(sd.getElementById('star-form'))])===originalForm,
      'off removes masks without restoring stale site text or modifying form data');
    starFrame.remove();
    const failureFrame=document.createElement('iframe');document.body.append(failureFrame);
    const fw=failureFrame.contentWindow,fd=failureFrame.contentDocument;
    fd.head.innerHTML='<style>'+${JSON.stringify(css)}+'</style>';
    fd.body.innerHTML='<div class="displayAddressDiv"><span id="fallback-name">Private Person</span></div>';
    fw.FontFace=class{constructor(){throw Error('Simulated font failure');}};
    fw.chrome={storage:{local:{get(defaults,cb){cb(defaults);}},onChanged:{addListener(){}}}};
    fw.eval(extensionSource);await settle();
    check(fw.getComputedStyle(fd.getElementById('fallback-name')).webkitTextFillColor==='rgba(0, 0, 0, 0)'&&
      fw.getComputedStyle(fd.querySelector('.displayAddressDiv')).backgroundImage.includes('data:image/png'),
      'star masking works without font APIs and keeps original text invisible');
    failureFrame.remove();
    const earlyFrame=document.createElement('iframe');document.body.append(earlyFrame);
    const ew=earlyFrame.contentWindow,ed=earlyFrame.contentDocument;ed.documentElement.remove();
    ew.chrome={storage:{local:{get(defaults,cb){cb(defaults);}},onChanged:{addListener(){}}}};
    ew.eval(extensionSource);await settle();
    const earlyHtml=ed.createElement('html');earlyHtml.innerHTML='<body><div class="recipient">Early Person</div></body>';
    ed.append(earlyHtml);
    await settle();
    check(earlyHtml.getAttribute('data-apb-mode')==='stars',
      'star mode is synchronized when the document root arrives');
    earlyFrame.remove();
    const output = document.createElement('pre'); output.id='test-result';
    output.textContent = JSON.stringify({ok:true, checks:results.length, initialVisits, insertionVisits});
    document.body.append(output);
  })().catch(error => {
    const output=document.createElement('pre'); output.id='test-result';
    output.textContent=JSON.stringify({ok:false,error:error.message,results}); document.body.append(output);
  });
`;
const input = path.join(dir, 'test.html');
fs.writeFileSync(input, '<!doctype html><meta charset="utf-8"><style>' + css + '</style><body>' +
  '<div id="name">Sample Person</div><p>〒123-4567 / １２３－４５６７ / A+B</p>' +
  '<div id="glow-ingress-line1">Delivery city</div><textarea>123-4567</textarea>' +
  '<div contenteditable>Sample Person</div><div id="list"></div>' +
  script(setup) + script(source) + script(checks));
const executable = process.env.APB_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result = spawnSync(executable, ['--headless', '--disable-gpu', '--no-first-run', '--enable-logging=stderr',
  `--user-data-dir=${path.join(dir, 'profile')}`, '--dump-dom', '--virtual-time-budget=10000',
  pathToFileURL(input).href], {encoding:'utf8', timeout:30000, maxBuffer:4*1024*1024});
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const output = result.stdout.match(/<pre id="test-result">([^<]*)<\/pre>/);
assert.ok(output, 'Browser did not return a test result');
const report = JSON.parse(output[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (!report.ok) fs.writeFileSync(path.join(dir, 'browser.stderr.log'), result.stderr);
assert.equal(report.ok, true, JSON.stringify(report));
console.log(JSON.stringify(report, null, 2));
