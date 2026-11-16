// Small reminder window opened by the extension. Content arrives in the URL fragment and is shown as plain text.
let details = {};
try { details = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch { /* keep defaults */ }
if (typeof details.title === 'string') { document.getElementById('title').textContent = details.title.slice(0, 120); document.title = details.title.slice(0, 120); }
if (typeof details.message === 'string') document.getElementById('message').textContent = details.message.slice(0, 400);
for (const id of ['dismiss', 'open']) if (typeof details[id] === 'string') document.getElementById(id).textContent = details[id].slice(0, 40);
// Look the browser window up in advance so the side panel can open directly from the click.
let browserWindow;
chrome.windows.getAll({ windowTypes: ['normal'] }).then(all => { browserWindow = (all.find(w => w.focused) || all[0])?.id; }).catch(() => {});
document.getElementById('dismiss').addEventListener('click', () => window.close());
document.getElementById('open').addEventListener('click', () => {
  const done = () => window.close();
  if (browserWindow === undefined) { done(); return; }
  chrome.windows.update(browserWindow, { focused: true }).catch(() => {});
  chrome.sidePanel.open({ windowId: browserWindow }).then(done, done);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
