'use strict';
const enabled = document.getElementById('enabled');
const names = document.getElementById('names');
const mode = document.getElementById('mode');
const scanPostal = document.getElementById('scan-postal');
const status = document.getElementById('status');
let enabledState = true;

function renderEnabled(value) {
  enabledState = value;
  enabled.setAttribute('aria-pressed', String(value));
  enabled.setAttribute('aria-label', value ? '名前・住所の保護をオフにする' : '名前・住所の保護をオンにする');
  enabled.title = value ? 'クリックして名前・住所を表示' : 'クリックして名前・住所を隠す';
  document.getElementById('enabled-label').textContent = value ? '保護オン' : '保護オフ';
  document.getElementById('enabled-hint').textContent = value ? '名前・住所を隠しています' : '名前・住所を表示しています';
}

chrome.storage.local.get({enabled: true, names: '', mode: 'stars', scanPostal: false}, settings => {
  renderEnabled(settings.enabled !== false);
  names.value = settings.names;
  mode.value = settings.mode === 'blur' ? 'blur' : 'stars';
  scanPostal.checked = settings.scanPostal === true;
  enabled.disabled = false;
});
async function save() {
  try {
    await chrome.storage.local.set({enabled: enabledState, names: names.value, mode: mode.value, scanPostal: scanPostal.checked});
    status.textContent = '保存しました';
    return true;
  } catch {
    status.textContent = '保存できませんでした。もう一度お試しください。';
    return false;
  }
}
enabled.addEventListener('click', async () => {
  const previous = enabledState;
  enabled.disabled = true;
  renderEnabled(!previous);
  if (await save()) status.textContent = enabledState ? '保護をオンにしました' : '保護をオフにしました';
  else renderEnabled(previous);
  enabled.disabled = false;
});
mode.addEventListener('change', save);
scanPostal.addEventListener('change', save);
document.getElementById('save').addEventListener('click', save);
