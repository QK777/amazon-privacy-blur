// Render code-native SVG assets and real extension code in local demo fixtures.
// Run: node scripts/store-assets.cjs (Chrome; no dependencies or network required).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'apb-store-'));
const chrome = process.env.APB_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const script = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
const icon = read('icons/icon.svg');
const source = read('content.js');
const contentCss = read('content.css');

function render(name, html, width, height, dump = false) {
  const input = path.join(work, name + '.html');
  fs.writeFileSync(input, html);
  const args = ['--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--disable-background-networking',
    `--user-data-dir=${path.join(work, name + '-profile')}`,
    `--window-size=${width},${height}`, '--virtual-time-budget=2000'];
  args.push(dump ? '--dump-dom' : `--screenshot=${path.join(root, 'store', name + '.png')}`);
  args.push(pathToFileURL(input).href);
  const result = spawnSync(chrome, args, {encoding:'utf8', timeout:30000, maxBuffer:4*1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function pngSize(file, width, height, opaque = false) {
  const data = fs.readFileSync(path.join(root, file));
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  assert.equal(data.readUInt32BE(16), width, file);
  assert.equal(data.readUInt32BE(20), height, file);
  // Chrome screenshots are RGB PNGs; icons intentionally use RGBA transparency.
  if (opaque) assert.equal(data[25], 2, 'Listing images must be RGB PNGs: ' + file);
}

const dump = render('icons', '<!doctype html><meta charset="utf-8"><pre id="result"></pre>' + script(`
  (async()=>{
    const image = new Image(); image.src = 'data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}';
    await image.decode();
    const result = {};
    for (const size of [16,32,48,128]) {
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=size;
      canvas.getContext('2d').drawImage(image,0,0,size,size);
      result[size]=canvas.toDataURL('image/png').split(',')[1];
    }
    document.getElementById('result').textContent=JSON.stringify(result);
  })();
`), 800, 600, true);
const icons = JSON.parse(dump.match(/<pre id="result">([^<]+)<\/pre>/)[1]);
for (const size of [16,32,48,128]) {
  fs.writeFileSync(path.join(root, 'icons', `icon${size}.png`), Buffer.from(icons[size], 'base64'));
  pngSize(`icons/icon${size}.png`, size, size);
}

const common = `*{box-sizing:border-box}body{margin:0;background:#eef5f4;color:#123d49;font-family:"Segoe UI","Yu Gothic UI",sans-serif}
main{width:1280px;height:800px;padding:48px 56px;overflow:hidden}header{display:flex;align-items:center;gap:16px;font-size:18px;font-weight:700}
header svg{width:56px;height:56px;margin:-7px}.eyebrow{letter-spacing:2px;font-size:14px;color:#387566}
h1{font-size:46px;line-height:1.3;letter-spacing:-1px;margin:30px 0 12px}p{font-size:19px;line-height:1.8;margin:0}
.columns{display:flex;gap:24px;margin-top:28px}.panel{background:white;border:1px solid #cadbd7;border-radius:18px;overflow:hidden;flex:1}
.bar{height:48px;padding:14px 20px;background:#e2ece9;color:#325c56;font-size:14px;display:flex;justify-content:space-between}
iframe{display:block;border:0;width:100%;height:294px}.label{font-size:16px;margin-bottom:10px;font-weight:700}
footer{font-size:14px;line-height:1.7;color:#50716a;margin-top:24px}.pill{background:#123d49;color:white;border-radius:20px;padding:8px 16px;display:inline-block;font-size:15px;margin-top:22px}
`;
const head = '<!doctype html><html lang="ja"><meta charset="utf-8"><style>' + common + '</style><main>';
const brand = `<header>${icon}<span>Amazon 名前・住所マスク</span></header>`;
function fixture(enabled) {
  const markup = `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
  body{margin:0;padding:24px;color:#243d47;font:17px/1.7 "Segoe UI","Yu Gothic UI",sans-serif;background:white}
  .top{display:flex;justify-content:space-between;border-bottom:1px solid #dce7e3;padding-bottom:16px}
  small{display:block;color:#647b7b;font-size:12px}.item{margin-top:22px;display:flex;gap:20px}
  .photo{background:#e7eeed;border-radius:12px;width:88px;height:112px;display:grid;place-items:center;font-size:36px;color:#315954}
  p{margin:0 0 8px}b{font-weight:600}${contentCss}</style>
  <div class="top"><div><small>お届け先</small><span id="glow-ingress-line2">〒123-4567 テスト市</span></div>
  <div><small>アカウント名</small><span id="nav-link-accountList-nav-line-1">山田 太郎</span></div></div>
  <div class="item"><div class="photo">▤</div><div><small>注文履歴の表示例</small><b>デスク用ノート</b>
  <div class="displayAddressDiv"><div>山田 太郎</div><div>テスト市 サンプル町 1-2-3</div><div>架空ビル 402号室</div></div></div></div>`;
  const mock = `window.chrome={storage:{local:{get(defaults,cb){cb({enabled:${enabled},names:''});}},onChanged:{addListener(){}}}};`;
  return markup + script(mock) + script(source) + '</html>';
}
function frame(enabled) { return `<iframe title="${enabled ? 'オン' : 'オフ'}の動作デモ" srcdoc="${escapeHtml(fixture(enabled))}"></iframe>`; }
render('screenshot-1', head + brand + '<h1>共有する前に、名前を隠す。</h1>' +
  '<p>Amazon.co.jpの名前・住所欄を、登録なしで「*」表示にします。</p><div class="columns">' +
  `<section style="flex:1"><div class="label">OFF ／ 通常の表示</div><div class="panel"><div class="bar"><span>動作デモ</span><span>架空データ</span></div>${frame(false)}</div></section>` +
  `<section style="flex:1"><div class="label">ON ／ 標準の「*」表示</div><div class="panel"><div class="bar"><span>動作デモ</span><span>架空データ</span></div>${frame(true)}</div></section></div>` +
  '<span class="pill">外部送信なし・設定はブラウザー内に保存</span>' +
  '<footer>架空データを使ったデモ画面です。実際のぼかしコードを使用しています。<br>見た目の加工です。すべての個人情報を隠す保証はありません。共有前に画面を確認してください。</footer></main></html>', 1280, 800);

let popup = read('popup.html').replace('<link rel="stylesheet" href="popup.css">', '<style>' + read('popup.css') + '</style>');
popup = popup.replace('<script src="popup.js"></script>', script(`
 window.chrome={storage:{local:{get(defaults,cb){cb({enabled:true,names:''});},set(){return Promise.resolve();}}}};
`) + script(read('popup.js')));
render('screenshot-2', head + brand + '<div style="width:650px"><h1 style="margin-top:94px">基本は「*」。<br>ぼかしも選べる。</h1><p>注文履歴・注文詳細・住所帳の対応欄を自動で隠します。</p>' +
  '<div style="margin-top:36px"><div class="eyebrow">シンプルな設定</div>' +
  '<p style="line-height:2.2;margin-top:10px">標準は「*」表示、設定でぼかしに変更<br>名前や住所の登録は不要<br>住所入力欄の実データは変更しない</p>' +
  '<span class="pill">外部サービスへの登録は不要</span></div></div>' +
  '<div class="panel" style="position:absolute;right:56px;top:160px;width:374px">' +
  '<div class="bar">実際の設定画面 ／ 架空データ</div>' +
  `<iframe style="width:374px;height:510px" title="設定画面" srcdoc="${escapeHtml(popup)}"></iframe></div>` +
  '<footer style="position:absolute;left:56px;bottom:50px">名前・住所欄をページの構造から判定します。<br>すべての表示を隠す保証はありません。共有前に実際の画面を確認してください。</footer></main></html>', 1280, 800);

render('promo-440x280', `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;width:440px;height:280px;background:#123d49;overflow:hidden}
 .orb{position:absolute;left:165px;top:-100px;width:360px;height:360px;border:1px solid #397f7d;border-radius:50%}
 .orb.two{left:240px;top:90px}svg{position:absolute;left:20px;top:25px;width:230px;height:230px}
 .lines{position:absolute;left:265px;top:92px;width:130px;display:grid;gap:15px}
 .lines i{height:12px;background:#81e2cf;border-radius:8px}.lines i:nth-child(2){width:85px;opacity:.6}.lines i:nth-child(3){opacity:.3}
 </style><div class="orb"></div><div class="orb two"></div>${icon}<div class="lines"><i></i><i></i><i></i></div>`, 440, 280);
for (const name of ['screenshot-1','screenshot-2']) pngSize('store/' + name + '.png',1280,800,true);
pngSize('store/promo-440x280.png',440,280,true);
console.log('Verified: 4 PNG icons, 2 screenshots (1280x800), 1 promotional image (440x280).');
console.log('Local render fixtures: ' + work);
