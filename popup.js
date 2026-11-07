'use strict';
const enabled = document.getElementById('enabled');
const names = document.getElementById('names');
const status = document.getElementById('status');
chrome.storage.local.get({enabled: true, names: ''}, settings => {
  enabled.checked = settings.enabled;
  names.value = settings.names;
});
async function save() {
  try {
    await chrome.storage.local.set({enabled: enabled.checked, names: names.value});
    status.textContent = '保存しました';
  } catch {
    status.textContent = '保存できませんでした。もう一度お試しください。';
  }
}
enabled.addEventListener('change', save);
document.getElementById('save').addEventListener('click', save);
