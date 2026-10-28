// The blank-screen guard. Inlined into index.html by vite.config.ts (the `boot-guard` plugin, which also adds its hash to the
// Content-Security-Policy in dist/_headers), so it runs even when every file of the app fails to load. Plain ES5-ish on purpose:
// it is not part of the bundle and nothing here may depend on the app.
//
// If the entry script fails, or #root is still empty after BOOT_MS, it shows a plain message with Reload, Reset app cache and
// Sign in again. Reset unregisters the service workers and deletes the caches; it never touches localStorage or IndexedDB,
// where the teams and matches live. docs/SYNC.md → "A blank screen".
(function () {
  var BOOT_MS = 8000;
  var panel = null;
  var tauri = '__TAURI_INTERNALS__' in window;

  function rootEl() { return document.getElementById('root'); }
  function booted() { var r = rootEl(); return !!(r && r.firstElementChild); }

  function button(label, hint, run) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = hint;
    b.setAttribute('style', 'font:600 16px system-ui,sans-serif;min-height:44px;padding:0 16px;margin:6px 8px 0 0;border-radius:10px;border:1px solid #6b7280;background:#2a2e38;color:#fff;cursor:pointer');
    b.onclick = function () { b.disabled = true; run(b); };
    return b;
  }

  // Where the app lives: the root, not a deeper address it happened to be opened at (e.g. one Cloudflare Access sent the browser to).
  function home() { return location.origin + '/'; }

  function resetCache() {
    var work = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      work.push(navigator.serviceWorker.getRegistrations().then(function (list) {
        return Promise.all(list.map(function (r) { return r.unregister(); }));
      }));
    }
    if (window.caches && caches.keys) {
      work.push(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }));
    }
    return Promise.all(work).then(function () {}, function () {});
  }

  function show(why) {
    if (panel || booted()) return;
    panel = document.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.setAttribute('id', 'boot-guard');
    panel.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#15171d;color:#f3f4f6;font:16px/1.5 system-ui,sans-serif');
    var box = document.createElement('div');
    box.setAttribute('style', 'max-width:440px');
    var h = document.createElement('h1');
    h.textContent = "Team Builder didn't start";
    h.setAttribute('style', 'font:700 20px system-ui,sans-serif;margin:0 0 8px');
    var p = document.createElement('p');
    p.textContent = 'The app could not load. Your teams and matches are stored on this device and are not affected. Try Reload first; if the screen stays like this, Reset app cache fetches a fresh copy of the app' + (tauri ? '.' : ', and Sign in again renews an expired login.');
    p.setAttribute('style', 'margin:0 0 8px');
    var d = document.createElement('p');
    d.textContent = why + ' (' + location.pathname + ')';
    d.setAttribute('style', 'margin:0 0 12px;font-size:13px;color:#9ca3af;word-break:break-all');
    box.appendChild(h); box.appendChild(p); box.appendChild(d);
    box.appendChild(button('Reload', 'Try again', function () {
      if (location.pathname !== '/' && !tauri) location.replace(home()); else location.reload();
    }));
    box.appendChild(button('Reset app cache', 'Unregister the service worker and delete the cached app; keeps your teams', function (b) {
      b.textContent = 'Resetting…';
      resetCache().then(function () { location.replace(tauri ? location.href : home()); });
    }));
    if (!tauri) {
      box.appendChild(button('Sign in again', 'Go through the Cloudflare Access login again', function () { location.href = '/api/session/renew'; }));
    }
    panel.appendChild(box);
    (document.body || document.documentElement).appendChild(panel);
    var r = rootEl();
    if (r && window.MutationObserver) {
      new MutationObserver(function (_, obs) {
        if (booted() && panel) { panel.remove(); panel = null; obs.disconnect(); }
      }).observe(r, { childList: true });
    }
  }

  // A file of the app failed to load (404, a login page in place of the script, a blocked redirect...). Resource errors do not
  // bubble, hence the capture phase.
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window && (t.tagName === 'SCRIPT' || (t.tagName === 'LINK' && t.rel === 'stylesheet'))) {
      var src = t.src || t.href || '';
      show('A file did not load: ' + src.replace(location.origin, ''));
    }
  }, true);

  setTimeout(function () { if (!booted()) show('Nothing was drawn after ' + BOOT_MS / 1000 + ' seconds'); }, BOOT_MS);
})();
