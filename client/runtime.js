  // ======================================================================
  // PWA runtime: local store (localStorage), server API, backup sync,
  // push notifications, service worker. Replaces the claude.ai runtime the
  // first version of the app ran on; the rest of the app code is unchanged
  // because `state.db`, `state.sample` and `state.downloads` keep their shape.
  // ======================================================================
  const DATA_KEY = 'kd.data', TOKEN_KEY = 'kd.token', SEED_KEY = 'kd.seeded', NUDGE_KEY = 'kd.nudge';
  const nowISO = () => new Date().toISOString();
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const stamp = (w) => (w && (w.updatedAt || w.createdAt)) || '';
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} };

  // ---------- local store ----------
  const data = { words: [], days: {}, deleted: {} };
  try {
    const raw = JSON.parse(lsGet(DATA_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.words)) data.words = raw.words.filter((w) => w && w.id);
      if (raw.days && typeof raw.days === 'object') data.days = raw.days;
      if (raw.deleted && typeof raw.deleted === 'object') data.deleted = raw.deleted;
    }
  } catch (e) {}

  const listeners = { words: [], days: [] };
  function snapshot(col) {
    if (col === 'words') {
      const arr = data.words.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return { docs: arr.map((w) => ({ id: w.id, data: () => { const c = Object.assign({}, w); delete c.id; return c; } })) };
    }
    return { docs: Object.keys(data.days).map((k) => ({ id: k, data: () => Object.assign({}, data.days[k]) })) };
  }
  function emit(col) { listeners[col].forEach((cb) => { try { cb(snapshot(col)); } catch (e) {} }); }
  function writeLocal() { try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); return true; } catch (e) { toast('Yerel depolama dolu; kelime kaydedilemedi.'); return false; } }
  function persist(col) { writeLocal(); if (col) emit(col); scheduleSync(); }
  function docRef(col, id) {
    return {
      async update(patch) {
        const w = data.words.find((x) => x.id === id); if (!w) throw { code: 'not_found' };
        Object.assign(w, patch, { updatedAt: nowISO() }); persist('words');
      },
      async set(obj) {
        if (col === 'days') { data.days[id] = Object.assign({ date: id }, obj); persist('days'); return; }
        const i = data.words.findIndex((x) => x.id === id);
        const doc = Object.assign({}, obj, { id, updatedAt: nowISO() });
        if (i >= 0) data.words[i] = doc; else data.words.unshift(doc);
        delete data.deleted[id]; persist('words');
      },
      async delete() { data.words = data.words.filter((x) => x.id !== id); data.deleted[id] = nowISO(); persist('words'); },
    };
  }
  state.db = {
    collection(col) {
      return {
        async add(doc) { const id = genId(); data.words.unshift(Object.assign({}, doc, { id, updatedAt: nowISO() })); persist('words'); return { id }; },
        doc: (id) => docRef(col, id),
        orderBy() { return { limit() { return { onSnapshot(cb) { listeners[col].push(cb); cb(snapshot(col)); } }; } }; },
      };
    },
    doc(path) { const i = path.indexOf('/'); return docRef(path.slice(0, i), path.slice(i + 1)); },
  };

  // ---------- server API ----------
  const getToken = () => lsGet(TOKEN_KEY);
  async function api(method, path, body) {
    const t = getToken(); if (!t) throw { code: 'no_token' };
    let res;
    try {
      res = await fetch(path, { method, headers: Object.assign({ authorization: 'Bearer ' + t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw { code: 'network' }; }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw { code: (j && j.error) || (res.status === 401 ? 'unauthorized' : 'http_' + res.status), message: j && j.message, status: res.status };
    return j;
  }
  state.sample = { json: async (p) => { const r = await api('POST', '/api/translate', { prompt: p }); return r.result; } };
  state.downloads = {
    async save({ filename, data: text }) {
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return { status: 'saved' };
    },
  };
  $('#csvBtn').hidden = false;

  // ---------- backup sync (phone is the source of truth; server keeps a mirror for the morning push) ----------
  let syncTimer = null, syncing = false, dirty = false, lastPull = 0;
  function setSyncHint(msg) { const el = $('#syncHint'); if (el) el.textContent = msg; }
  function scheduleSync() { dirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }
  async function syncNow() {
    if (syncing) return;
    if (!getToken()) { setSyncHint('Yedek için erişim şifresi gerekli.'); return; }
    syncing = true; dirty = false;
    try {
      const r = await api('POST', '/api/sync', { words: data.words, days: data.days, deleted: data.deleted });
      setSyncHint('Yedeklendi · ' + fmtTime(r.syncedAt) + ' · ' + r.words + ' kelime');
    } catch (err) {
      dirty = true; setSyncHint('Yedeklenemedi: ' + apiCopy(err.code));
    } finally {
      syncing = false;
      if (dirty) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 20000); }
    }
  }
  // Union by id; the newer copy of a word wins; tombstones beat older copies; day counters take the max.
  function merge(remote) {
    let changed = false;
    const rdel = remote.deleted || {};
    Object.keys(rdel).forEach((id) => { if (!data.deleted[id] || rdel[id] > data.deleted[id]) { data.deleted[id] = rdel[id]; changed = true; } });
    const byId = new Map(data.words.map((w) => [w.id, w]));
    (remote.words || []).forEach((rw) => {
      if (!rw || !rw.id) return;
      const lw = byId.get(rw.id);
      if (!lw) { if (!(data.deleted[rw.id] && data.deleted[rw.id] >= stamp(rw))) { data.words.push(rw); byId.set(rw.id, rw); changed = true; } }
      else if (stamp(rw) > stamp(lw)) { Object.assign(lw, rw); changed = true; }
    });
    const before = data.words.length;
    data.words = data.words.filter((w) => !(data.deleted[w.id] && data.deleted[w.id] >= stamp(w)));
    if (data.words.length !== before) changed = true;
    Object.keys(remote.days || {}).forEach((k) => {
      const rd = remote.days[k] || {}; const ld = data.days[k] || { date: k };
      ['reviewed', 'ok', 'hard', 'miss', 'added'].forEach((f) => { const v = Math.max(ld[f] || 0, rd[f] || 0); if (v !== (ld[f] || 0)) { ld[f] = v; changed = true; } });
      if (!data.days[k]) { data.days[k] = ld; changed = true; }
    });
    return changed;
  }
  async function pullFromServer() {
    if (!getToken()) return 'no_token';
    try {
      const r = await api('GET', '/api/sync'); lastPull = Date.now();
      const remote = r && r.data;
      if (!remote) { if (data.words.length) scheduleSync(); return 'empty'; }
      const changed = merge(remote);
      if (changed) { writeLocal(); emit('words'); emit('days'); }
      setSyncHint('Yedek · ' + fmtTime(remote.syncedAt) + ' · ' + (remote.words || []).length + ' kelime');
      scheduleSync();
      return 'merged';
    } catch (err) { setSyncHint('Yedeğe ulaşılamadı: ' + apiCopy(err.code)); return 'error'; }
  }
  async function maybeSeed() {
    if (data.words.length || lsGet(SEED_KEY)) return;
    try {
      const r = await fetch('/seed.json', { cache: 'no-store' }); if (!r.ok) return;
      const s = await r.json();
      if (Array.isArray(s.words) && s.words.length) {
        data.words = s.words.filter((w) => w && w.id && !data.deleted[w.id]);
        data.days = Object.assign({}, s.days || {}, data.days);
        persist(); emit('words'); emit('days');
        toast(data.words.length + ' kelime eski defterden aktarıldı');
      }
      lsSet(SEED_KEY, '1');
    } catch (e) {}
  }
  $('#syncBtn').addEventListener('click', async () => { if (!getToken()) { showTokenCard(); return; } setSyncHint('Yedekleniyor…'); await pullFromServer(); await syncNow(); });

  // ---------- access token ----------
  function apiCopy(code) {
    switch (code) {
      case 'no_token': return 'erişim şifresi girilmedi';
      case 'unauthorized': return 'erişim şifresi yanlış';
      case 'setup': return 'sunucuda APP_TOKEN ayarlanmamış';
      case 'no_api_key': return 'ANTHROPIC_API_KEY ayarlanmamış';
      case 'bad_api_key': return 'Anthropic anahtarı geçersiz';
      case 'network': return 'bağlantı yok';
      case 'rate_limited': return 'çok sık istek';
      default: return 'sunucu hatası' + (code ? ' (' + code + ')' : '');
    }
  }
  function showTokenCard(msg) {
    $('#tokenCard').hidden = false; $('#tokenMsg').textContent = msg || '';
    if (location.hash !== '#ekle' && location.hash !== '') location.hash = '#ekle';
    $('#tokenInput').focus();
  }
  function refreshTokenHint() { $('#tokenHint').textContent = getToken() ? 'Bağlı' : 'Girilmedi'; }
  $('#tokenForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = $('#tokenInput').value.trim(); if (!t) return;
    const prev = getToken(); lsSet(TOKEN_KEY, t);
    const btn = $('#tokenForm button'); btn.disabled = true; $('#tokenMsg').textContent = 'Kontrol ediliyor…';
    try {
      const me = await api('GET', '/api/me');
      $('#tokenCard').hidden = true; $('#tokenInput').value = ''; $('#tokenMsg').textContent = '';
      state.sampleOff = false; refreshTokenHint();
      toast(me.anthropic ? 'Bağlandı' : 'Bağlandı. Çeviri için ANTHROPIC_API_KEY de gerekli.');
      await pullFromServer(); await maybeSeed(); refreshSettings();
    } catch (err) {
      lsSet(TOKEN_KEY, prev); $('#tokenMsg').textContent = apiCopy(err.code).replace(/^./, (c) => c.toUpperCase()) + '.';
    } finally { btn.disabled = false; }
  });
  $('#tokenBtn').addEventListener('click', () => showTokenCard(''));

  // ---------- push notifications ----------
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64ToBytes = (s) => { const pad = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function pushState() {
    if (!pushSupported) return 'unsupported';
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) return 'on'; }
    catch (e) {}
    return Notification.permission === 'denied' ? 'denied' : 'off';
  }
  async function enablePush() {
    if (!pushSupported) { if (isIOS && !standalone) { $('#iosNotice').hidden = false; toast('Önce ana ekrana ekle.'); } else toast('Bu tarayıcı bildirim desteklemiyor.'); return; }
    if (!getToken()) { showTokenCard('Bildirim için önce erişim şifresini gir.'); return; }
    let perm = Notification.permission;
    if (perm !== 'granted') perm = await Notification.requestPermission();   // must stay inside the tap
    if (perm !== 'granted') { toast('Bildirim izni verilmedi.'); refreshSettings(); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const me = await api('GET', '/api/me');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(me.vapid) });
      await api('POST', '/api/subscribe', { subscription: sub.toJSON(), tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'Europe/Istanbul' });
      lsSet(NUDGE_KEY, '1');
      toast('Bildirimler açık: her sabah 08:35.');
    } catch (err) { toast('Bildirim açılamadı: ' + apiCopy(err.code)); }
    refreshSettings();
  }
  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
      if (sub) { await api('DELETE', '/api/subscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      toast('Bildirimler kapatıldı.');
    } catch (e) { toast('Kapatılamadı.'); }
    refreshSettings();
  }
  $('#pushBtn').addEventListener('click', async () => { (await pushState()) === 'on' ? disablePush() : enablePush(); });
  $('#nudgeBtn').addEventListener('click', enablePush);
  $('#nudgeClose').addEventListener('click', () => { lsSet(NUDGE_KEY, '1'); $('#pushNudge').hidden = true; });
  $('#testPushBtn').addEventListener('click', async () => {
    const btn = $('#testPushBtn'); btn.disabled = true;
    try { const r = await api('POST', '/api/test-push'); toast(r.sent ? 'Test bildirimi gönderildi (' + r.sent + ')' : 'Gönderilemedi: ' + JSON.stringify(r.results && r.results[0] && r.results[0].status)); }
    catch (err) { toast('Gönderilemedi: ' + apiCopy(err.code)); }
    btn.disabled = false;
  });

  async function refreshSettings(me) {
    refreshTokenHint();
    const ps = await pushState();
    const btn = $('#pushBtn'), hint = $('#pushHint');
    $('#iosNotice').hidden = !(isIOS && !standalone);
    if (ps === 'unsupported') { btn.hidden = true; hint.textContent = isIOS && !standalone ? 'iPhone\'da bildirim için uygulamayı ana ekrana eklemen gerekir.' : 'Bu tarayıcı bildirim desteklemiyor.'; }
    else if (ps === 'denied') { btn.hidden = true; hint.textContent = 'Bildirim izni reddedilmiş; tarayıcı/uygulama ayarlarından aç.'; }
    else { btn.hidden = false; btn.textContent = ps === 'on' ? 'Kapat' : 'Bildirimleri aç'; hint.textContent = ps === 'on' ? 'Açık. Her sabah 08:35\'te tekrar edilecek kelimeleri hatırlatır.' : 'Her sabah 08:35\'te tekrar edilecek kelimeleri hatırlatır.'; }
    $('#testPushBtn').hidden = ps !== 'on';
    $('#pushNudge').hidden = !(ps === 'off' && getToken() && !lsGet(NUDGE_KEY)) ;
    if (me && me.lastRemind && me.lastRemind.at) $('#lastRemind').textContent = 'Son gönderim: ' + fmtTime(me.lastRemind.at) + ' · ' + me.lastRemind.sent + ' bildirim';
  }

  // ---------- service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Yeni sürüm hazır', { label: 'Yenile', onClick: () => location.reload() }); });
        });
      }).catch(() => {});
    });
  }

  // ---------- boot ----------
  route();
  renderAll();
  emit('words'); emit('days');
  state.db.collection('words').orderBy().limit().onSnapshot((snap) => { state.words = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())); renderAll(); });
  state.db.collection('days').orderBy().limit().onSnapshot((snap) => {
    const m = {}; snap.docs.forEach((d) => { m[d.id] = d.data(); }); state.days = m;
    renderStreak(); if (!$('#view-tekrar').hidden && !rev.active) renderReview();
  });
  (async () => {
    if (!getToken()) { $('#tokenCard').hidden = false; await maybeSeed(); refreshSettings(); return; }
    let me = null; try { me = await api('GET', '/api/me'); } catch (err) { if (err.code === 'unauthorized' || err.code === 'setup') showTokenCard(apiCopy(err.code).replace(/^./, (c) => c.toUpperCase()) + '.'); else setSyncHint(apiCopy(err.code)); }
    await pullFromServer(); await maybeSeed(); refreshSettings(me);
  })();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && getToken() && Date.now() - lastPull > 60000) pullFromServer(); });
