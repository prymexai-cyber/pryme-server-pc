/* Pryme Server PC — dashboard */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const ico = n => `<svg><use href="#i-${n}"/></svg>`;

function fmtBytes(n, d = 1) {
  if (n == null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? Math.round(n) : n.toFixed(n >= 100 ? 0 : d)) + ' ' + u[i];
}
const fmtRate = n => fmtBytes(n) + '/s';
function fmtDur(s) {
  s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}
const fmtDate = ms => new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ---------------- API ---------------- */
async function call(url, opts = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...opts });
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && d && d.login) { showAuth(); }
    throw new Error((d && d.error) || 'Request failed (' + r.status + ')');
  }
  return d || {};
}
const get = u => call(u);
const post = (u, b) => call(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

/* ---------------- UI helpers ---------------- */
function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
}
function modal({ title, text = '', input = null, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise(res => {
    const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${input !== null ? `<input id="mIn" value="${esc(input)}">` : ''}
      <div class="acts"><button class="btn" id="mNo">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="mOk">${esc(ok)}</button></div>`;
    m.classList.remove('hidden');
    const inp = $('#mIn');
    if (inp) { inp.focus(); const dot = input.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : input.length); } else $('#mOk').focus();
    const done = v => { m.classList.add('hidden'); document.removeEventListener('keydown', key); res(v); };
    const key = e => { if (e.key === 'Escape') done(null); if (e.key === 'Enter') done(inp ? inp.value : true); };
    document.addEventListener('keydown', key);
    $('#mNo').onclick = () => done(null);
    $('#mOk').onclick = () => done(inp ? inp.value : true);
    m.onclick = e => { if (e.target === m) done(null); };
  });
}

/* ---------------- Theme ---------------- */
function applyTheme(pref) {
  try { localStorage.setItem('pryme-theme', pref); } catch {}
  const d = pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = d;
  $('#themeBtn').innerHTML = ico(d === 'dark' ? 'sun' : 'moon');
  $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.theme === pref));
}
const themePref = () => { try { return localStorage.getItem('pryme-theme') || 'system'; } catch { return 'system'; } };
$('#themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$$('#themeSeg button').forEach(b => (b.onclick = () => applyTheme(b.dataset.theme)));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => themePref() === 'system' && applyTheme('system'));
applyTheme(themePref());

/* ---------------- State ---------------- */
const S = {
  st: null, tab: 'home', phase: 'offline', prevPhase: null, stats: null,
  path: '/', entries: [], drives: [], sel: new Set(), filter: '',
  view: (() => { try { return localStorage.getItem('pryme-view') || 'list'; } catch { return 'list'; } })(),
  uploads: [], jobs: [], goLiveOnBoot: false, discSel: null,
};
const PHASE = {
  offline: { pill: 'Offline', title: 'Offline', sub: 'Server is sleeping. Press the power button to wake it.' },
  booting: { pill: 'Starting…', title: 'Starting up…', sub: 'Wake signal sent. Your server is booting.' },
  online: { pill: 'Online', title: 'Online', sub: 'Your server is running and ready.' },
  'shutting-down': { pill: 'Shutting down…', title: 'Shutting down…', sub: 'Power off command sent.' },
  restarting: { pill: 'Restarting…', title: 'Restarting…', sub: 'Your server will be back in a moment.' },
};
const TITLES = {
  home: ['Home', 'Overview & power control'], files: ['Files', 'All drives on your server'], live: ['Live Screen', 'See your server screen in real time'],
  transfers: ['Transfers', 'Uploads and copies to this PC'], settings: ['Settings', 'Theme, connections and account'],
  photos: ['Photos', 'Every photo on your server, newest first'], cloud: ['Cloud Backup', 'Back up Google Drive, Google Photos, OneDrive and iCloud to your server'], trash: ['Trash', 'Restore deleted files'],
};

/* ---------------- Auth screens ---------------- */
let authMode = null;
function showAuth() {
  const setup = !!(S.st && !S.st.configured);
  if (authMode === setup && !$('#auth').classList.contains('hidden')) { if (setup) renderDisc(); return; }
  authMode = setup;
  $('#app').classList.add('hidden'); $('#boot').classList.add('hidden'); $('#auth').classList.remove('hidden');
  $('#screenImg').removeAttribute('src');
  $('#loginForm').classList.toggle('hidden', !!setup);
  $('#setupForm').classList.toggle('hidden', !setup);
  if (setup) renderDisc(); else setTimeout(() => $('#loginForm [name=username]').focus(), 50);
}
function showApp() {
  authMode = null;
  $('#auth').classList.add('hidden'); $('#boot').classList.add('hidden'); $('#app').classList.remove('hidden');
}
function renderDisc() {
  const list = (S.st && S.st.discovered) || [];
  if (!S.discSel && list[0]) S.discSel = list[0].id;
  $('#discList').innerHTML = list.length ? list.map(d => `<button type="button" class="disc ${d.id === S.discSel ? 'sel' : ''}" data-id="${esc(d.id)}">${ico('drive')}<div><b>${esc(d.name)}</b><small>${esc(d.ip)}:${esc(d.port)} · found on your network</small></div></button>`).join('')
    : `<div class="disc-wait"><div class="spinner" style="width:18px;height:18px;border-width:2px;border-color:var(--border2);border-top-color:var(--accent)"></div>Searching for your server on the network…</div>`;
  $$('#discList .disc').forEach(b => (b.onclick = () => { S.discSel = b.dataset.id; renderDisc(); }));
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target; $('#loginErr').textContent = '';
  try { await post('/local/login', { username: f.username.value.trim(), password: f.password.value }); f.password.value = ''; await refreshState(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
$('#setupForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target; $('#setupErr').textContent = '';
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Linking…';
  try {
    await post('/local/setup', { serverId: f.ip.value.trim() ? null : S.discSel, ip: f.ip.value.trim(), username: f.username.value.trim(), password: f.password.value });
    toast('Linked to your server!', 'ok'); await refreshState();
  } catch (err) { $('#setupErr').textContent = err.message; }
  btn.disabled = false; btn.textContent = 'Link & sign in';
};
$('#logoutBtn').onclick = async () => { await post('/local/logout').catch(() => {}); S.st = null; await refreshState(); };

/* ---------------- Tabs ---------------- */
function setTab(t) {
  S.tab = t;
  $$('#nav button[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  { const m = $('#moreBtn'); if (m) m.classList.toggle('active', ['live', 'trash', 'transfers', 'settings'].includes(t)); }
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + t));
  $('#pageTitle').textContent = TITLES[t][0]; $('#pageSub').textContent = TITLES[t][1];
  $('#main').classList.toggle('on-home', t === 'home');
  if (t === 'photos') loadPhotos();
  if (t === 'cloud') loadCloud();
  if (t === 'trash') loadTrash();
  if (t === 'home') pollHealth(true);
  if (t === 'files') loadDir(S.path);
  if (t === 'transfers') pollJobs();
  if (t === 'settings') { renderSettings(); renderPlug(); }
  if (t !== 'live') setCtl(false);
  if (t === 'home') pollStats();
  updateLive();
}
$$('#nav button').forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
$$('[data-goto]').forEach(b => (b.onclick = () => setTab(b.dataset.goto)));

/* ---------------- State polling ---------------- */
function setPhase(ph) {
  const prev = S.phase; S.phase = ph;
  if (prev !== ph) onPhaseChange(prev, ph);
  renderStatus();
}
let stateBusy = false;
async function refreshState() {
  if (stateBusy) return; stateBusy = true;
  let st;
  try { st = await call('/local/state', { signal: AbortSignal.timeout(2500) }); }
  catch (e) {
    stateBusy = false;
    // Dashboard served by the server itself: no answer = server is off / restarting / booting
    if (S.serverMode && S.st && S.st.loggedIn && !/sign in/i.test(e.message)) {
      S.fails = (S.fails || 0) + 1;
      if (S.fails >= 2) {
        const now = Date.now();
        setPhase(S.powerCmd === 'restart' && now - S.powerAt < 240000 ? 'restarting' : S.wakeAt && now - S.wakeAt < 180000 ? 'booting' : 'offline');
      }
    }
    return;
  }
  stateBusy = false; S.fails = 0; S.st = st; S.serverMode = st.mode === 'server'; S.cloudMode = st.mode === 'cloud';
  if (!st.loggedIn) return showAuth();
  if ($('#app').classList.contains('hidden')) { showApp(); applyMode(); setTab(S.tab); }
  if (S.cloudMode) { renderFast(); renderUpdateBanner(); }
  if (st.user) { $('#whoName').textContent = st.user; $('#avatar').textContent = st.user[0].toUpperCase(); $('#whoSub').textContent = S.cloudMode ? 'Pryme Cloud · signed in from anywhere' : 'Local owner account'; }
  if (S.serverMode && st.plug) { try { localStorage.setItem('pryme-plug', JSON.stringify(st.plug)); } catch {} }
  if (st.phase === 'online') { S.powerCmd = null; S.wakeAt = 0; S.cycleAsked = false; }
  setPhase(st.phase);
}
setInterval(refreshState, 1000);

// Parts that only make sense when the Pryme client app runs on this PC
function applyMode() {
  const sm = S.serverMode || S.cloudMode, cm = S.cloudMode;
  $('#dlDir').closest('.tile').classList.toggle('hidden', sm);
  $('#unlinkBtn').classList.toggle('hidden', sm);
  $('#jobList').closest('.tile').classList.toggle('hidden', sm);
  $('#plugCard').classList.toggle('hidden', cm);       // in the cloud the plug is set in Render
  $('#pwCard').classList.toggle('hidden', cm);         // cloud password = Render setting
  $('#cloudNote').classList.toggle('hidden', !cm);
  $('#cloudCard').classList.toggle('hidden', !S.serverMode && !cm);
  $('[data-tab=transfers]').classList.toggle('hidden', cm);
  document.title = cm ? 'Pryme Cloud · Server PC' : 'Pryme Server PC';
  $('#plType option[value=sonoff]').classList.toggle('hidden', sm);
  $('#plCut').closest('label').querySelector('span').textContent = sm ? 'Cut power 45s after Shut Down (needed for Power On from this page)' : 'Cut power 20s after shutdown (saves electricity)';
  $('#upList').closest('.tile').querySelector('h4').lastChild.textContent = sm ? 'This device → server' : 'This PC → server';
}
function lanUrl() { const s = S.st || {}; return s.lanUrl || (s.server && s.server.ip ? 'http://' + s.server.ip : null); }
function renderFast() {
  const u = lanUrl(), b = $('#fastBtn');
  b.classList.toggle('hidden', !S.cloudMode || !u); if (u) { b.href = u; $('#cloudNoteLink').href = u; }
}
function fastModal(what) {
  const u = lanUrl();
  return modal({ title: 'Use Fast mode for this', text: `${what} goes straight between your device and the server at full speed — no cloud limits. Connect to your home Wi-Fi, then open ${u || 'your server address'}.`, ok: u ? 'Open Fast mode' : 'OK', cancel: 'Close' })
    .then(ok => { if (ok && u) window.open(u, '_blank', 'noopener'); });
}
function plugUrl(p, on) {
  p = p || {}; const ip = String(p.ip || '').trim();
  switch (p.type) {
    case 'shelly1': return ip && `http://${ip}/relay/0?turn=${on ? 'on' : 'off'}`;
    case 'shelly2': return ip && `http://${ip}/rpc/Switch.Set?id=0&on=${on}`;
    case 'tasmota': return ip && `http://${ip}/cm?cmnd=Power%20${on ? 'On' : 'Off'}`;
    case 'custom': return on ? p.onUrl : p.offUrl;
  }
  return null;
}
const savedPlug = () => (S.st && S.st.plug) || (() => { try { return JSON.parse(localStorage.getItem('pryme-plug')); } catch { return null; } })();
async function plugFetch(on) { const u = plugUrl(savedPlug(), on); if (!u) throw new Error('Smart plug is not set up'); await fetch(u, { mode: 'no-cors', cache: 'no-store' }); }
// If the plug was already ON (power not cut), switching it on does nothing — offer a power cycle
setInterval(async () => {
  if (!S.serverMode || S.phase !== 'booting' || S.cycleAsked || Date.now() - S.wakeAt < 40000) return;
  S.cycleAsked = true;
  if (await modal({ title: 'Server did not start yet', text: 'If the server is really OFF, Pryme can switch the smart plug OFF and ON again so the BIOS starts it. Do this only if the server is off.', ok: 'Power-cycle plug', cancel: 'Wait' })) {
    try { await plugFetch(false); await new Promise(r => setTimeout(r, 5000)); await plugFetch(true); S.wakeAt = Date.now(); toast('Plug power-cycled — starting…'); } catch (e) { toast(e.message, 'err'); }
  }
}, 2000);

function onPhaseChange(from, to) {
  if (to === 'online' && (from === 'booting' || from === 'restarting')) {
    toast('Server is online', 'ok');
    if (S.goLiveOnBoot) { S.goLiveOnBoot = false; if (S.tab !== 'live') setTab('live'); }
    pollStats(); if (S.tab === 'files') loadDir(S.path);
  }
  if (to === 'online') { pollStats(); pollHealth(true); if (S.tab === 'files') loadDir(S.path); if (S.tab === 'photos') loadPhotos(); if (S.tab === 'trash') loadTrash(); if (S.tab === 'cloud') loadCloud(); }
  if (to !== 'online') renderHealth();
  if (to === 'offline' && (from === 'shutting-down' || from === 'online')) { S.stats = null; renderStats(); }
  if (to !== 'online') { if (S.tab === 'files') renderFiles(); }
  updateLive();
}

function renderStatus() {
  const ph = S.phase, info = PHASE[ph] || PHASE.offline, srv = (S.st && S.st.server) || {};
  $('#statusPill').dataset.phase = ph; $('#pillText').textContent = info.pill;
  $('#hero').dataset.phase = ph; $('#heroTitle').textContent = info.title;
  let sub = info.sub;
  if (ph === 'booting' && S.wakeAt) sub = `Wake signal sent · ${Math.round((Date.now() - S.wakeAt) / 1000)}s — screen opens automatically when ready.`;
  $('#heroSub').textContent = sub;
  $('#heroName').textContent = srv.name || 'Pryme Server PC';
  $('#sideName').textContent = srv.ip ? srv.ip : '';
  $('#sideState').textContent = ph === 'online' ? (S.cloudMode ? 'Cloud connection' : 'Local connection') : info.pill;
  $('#sideDot').className = 'dot ' + ({ online: 'online', booting: 'booting', restarting: 'booting', 'shutting-down': 'stopping' }[ph] || '');
  $('#mIp').textContent = srv.ip || '—'; $('#mMac').textContent = (srv.mac || '—').toUpperCase();
  const on = ph === 'online', busy = ph === 'booting' || ph === 'restarting' || ph === 'shutting-down';
  $('#btnOn').classList.toggle('hidden', on); $('#btnOn').disabled = busy;
  $('#btnRestart').classList.toggle('hidden', !on); $('#btnOff').classList.toggle('hidden', !on);
  const n = S.st.activeJobs + S.uploads.filter(u => u.status === 'uploading' || u.status === 'queued').length;
  $('#tBadge').textContent = n; $('#tBadge').classList.toggle('hidden', !n);
  if (!on) { $('#mUp').textContent = '—'; $('#mLink').textContent = '—'; }
}

/* ---------------- Power ---------------- */
async function powerOn() {
  if (S.serverMode) {
    if (S.phase === 'online') return toast('Server is already on', 'ok');
    if (!plugUrl(savedPlug(), true)) {
      if (S.st && S.st.cloudUrl) { window.open(S.st.cloudUrl, '_blank', 'noopener'); return toast('Opened Pryme Cloud — press Power On there'); }
      return modal({ title: 'Turn the server on', text: 'A web page cannot send a wake signal by itself. Press the power button on the server PC, or set up a smart plug in Settings (with BIOS "Restore on AC Power Loss = Power On") to switch it on from here.', ok: 'OK', cancel: 'Close' });
    }
    try { await plugFetch(true); } catch (e) { return toast('Smart plug not reachable — same Wi-Fi?', 'err'); }
    S.wakeAt = Date.now(); S.goLiveOnBoot = true; S.cycleAsked = false;
    toast('Power plug ON — starting server…'); setPhase('booting'); setTab('live');
    return;
  }
  if (S.cloudMode) {
    if (S.phase === 'online') return toast('Server is already on', 'ok');
    try {
      const r = await post('/local/wake');
      if (r.already) return toast('Server is already on', 'ok');
      if (r.openUrl) window.open(r.openUrl, '_blank', 'noopener'); // home-Wi-Fi plug link
      S.wakeAt = Date.now(); S.goLiveOnBoot = true;
      toast(r.waker ? `Wake signal sent through “${r.waker}” — server is starting…` : 'Smart plug ON — server is starting…');
      if (r.plugErr) toast('Smart plug: ' + r.plugErr, 'err');
      setTab('live'); refreshState();
    } catch (e) {
      if (/No Pryme Waker|No smart plug/i.test(e.message)) return showWakerSetup();
      toast(e.message, 'err');
    }
    return;
  }
  try {
    const r = await post('/local/wake'); S.wakeAt = Date.now(); S.goLiveOnBoot = true;
    if (r.already) toast('Server is already on', 'ok');
    else toast(r.plug === 'on' ? 'Power plug ON + wake signal sent — starting server…' : 'Wake signal sent — starting server…');
    if (r.plug && r.plug !== 'on') toast('Smart plug: ' + r.plug, 'err');
    setTab('live'); refreshState();
  } catch (e) { toast(e.message, 'err'); }
}
async function powerCmd(action) {
  const restart = action === 'restart';
  const ok = await modal({ title: restart ? 'Restart server?' : 'Shut down server?', text: restart ? 'The server will restart now. Transfers in progress will stop.' : 'The server will power off now. You can turn it back on from here anytime.', ok: restart ? 'Restart' : 'Shut down', danger: !restart });
  if (!ok) return;
  try {
    await post('/api/power', { action });
    S.powerCmd = action; S.powerAt = Date.now();
    toast(restart ? 'Restarting…' : 'Shutting down…');
    if (restart) S.goLiveOnBoot = true;
    refreshState();
  } catch (e) { toast(e.message, 'err'); }
}
$('#btnOn').onclick = powerOn; $('#ovOn').onclick = powerOn;
$('#btnOff').onclick = () => powerCmd('shutdown'); $('#btnRestart').onclick = () => powerCmd('restart');
$('#powerBtn').onclick = () => { if (S.phase === 'offline') powerOn(); else if (S.phase === 'online') powerCmd('shutdown'); };

/* ---------------- Stats ---------------- */
let statsBusy = false;
async function pollStats() {
  if (statsBusy || S.phase !== 'online' || !S.st || !S.st.loggedIn) return;
  statsBusy = true;
  try { S.stats = await get('/api/stats'); renderStats(); } catch {} finally { statsBusy = false; }
}
setInterval(() => { if (S.tab === 'home' || S.tab === 'settings') pollStats(); }, 2000);
function setBar(id, pct, hot) { const el = $(id); if (!el) return; el.style.width = Math.max(0, Math.min(100, pct || 0)) + '%'; el.classList.toggle('hot', !!hot); }
// Dotted ring gauge (like a NAS dashboard)
function ring(pct, color) {
  const n = 28, on = Math.round(Math.max(0, Math.min(100, pct || 0)) / 100 * n);
  let c = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2, x = 50 + 40 * Math.cos(a), y = 50 + 40 * Math.sin(a);
    c += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.1" fill="${i < on ? color : 'var(--dot)'}"/>`;
  }
  return `<svg viewBox="0 0 100 100">${c}</svg>`;
}
function dots(pct, n = 34) {
  const on = Math.max(pct > 0 ? 1 : 0, Math.round(Math.max(0, Math.min(100, pct || 0)) / 100 * n));
  return Array.from({ length: n }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
}
const linkTxt = n => (n.link ? (n.link >= 1000 ? n.link / 1000 + ' Gbps' : n.link + ' Mbps') : n.iface);
function renderStats() {
  const s = S.stats;
  if (!s) {
    ['#sCpu', '#sMem', '#sTemp', '#sNet', '#sRx', '#sTx', '#sysFree', '#sMemT', '#sCpuM', '#sCpuW', '#sMemM', '#sNetM', '#sysName'].forEach(i => ($(i).textContent = '—'));
    $('#rCpu').innerHTML = ring(0); $('#rMem').innerHTML = ring(0); $('#dSys').innerHTML = dots(0, 20);
    setBar('#bTx', 0); setBar('#bRx', 0); $('#tTemp').className = 'tile t-temp';
    $('#drives').innerHTML = `<div class="empty-sm">${S.phase === 'online' ? 'Loading…' : 'Turn the server on to see its drives.'}</div>`;
    return;
  }
  $('#sCpu').innerHTML = s.cpu + '<small>%</small>'; $('#sCpuM').textContent = s.cpuModel || 'CPU';
  $('#sCpuW').textContent = `${s.cores} threads · load ${(s.load && s.load[0] || 0).toFixed(2)}`;
  $('#rCpu').innerHTML = ring(s.cpu, s.cpu > 85 ? 'var(--warn)' : 'var(--blue)');
  const mp = s.mem.total ? Math.round(s.mem.used / s.mem.total * 100) : 0;
  $('#sMem').innerHTML = mp + '<small>%</small>'; $('#sMemT').textContent = fmtBytes(s.mem.total, 0);
  $('#sMemM').textContent = fmtBytes(s.mem.used) + ' in use'; $('#rMem').innerHTML = ring(mp, mp > 90 ? 'var(--warn)' : 'var(--blue)');
  if (s.temp != null) { $('#sTemp').textContent = s.temp; $('#sTempM').textContent = s.temp > 85 ? 'Too hot — check the fan' : s.temp > 70 ? 'Warm' : 'Normal'; }
  else { $('#sTemp').textContent = 'n/a'; $('#sTempM').textContent = 'Sensor not available'; }
  $('#tTemp').className = 'tile t-temp' + (s.temp > 85 ? ' burn' : s.temp > 70 ? ' hot' : '');
  if (s.net) {
    const max = s.net.link ? s.net.link * 125000 : 12.5e6, sc = v => Math.min(100, Math.max(v > 0 ? 2 : 0, Math.sqrt(v / max) * 100));
    $('#sNet').textContent = linkTxt(s.net); $('#sNetM').textContent = s.net.iface;
    $('#sRx').textContent = fmtRate(s.net.rx); $('#sTx').textContent = fmtRate(s.net.tx);
    setBar('#bRx', sc(s.net.rx)); setBar('#bTx', sc(s.net.tx)); $('#mLink').textContent = linkTxt(s.net);
  }
  $('#mUp').textContent = fmtDur(s.uptime);
  const sys = s.system || { total: 0, free: 0 }, sp = sys.total ? Math.round((sys.total - sys.free) / sys.total * 100) : 0;
  const sd = ((S.health && S.health.disks) || []).find(d => d.system);
  $('#sysName').textContent = sd ? sd.model : (s.hostname || 'System');
  $('#sysFree').textContent = fmtBytes(sys.free); $('#dSys').innerHTML = dots(sp, 20); $('#dSys').classList.toggle('hot', sp > 90);
  S.drives = s.drives;
  $('#drives').innerHTML = s.drives.length ? s.drives.map(driveCard).join('')
    : `<div class="empty-sm">No drives yet. On the server run <code>sudo bash /opt/pryme/mount-drives.sh</code></div>`;
  bindDriveCards($('#drives'));
}
function diskFor(d) {
  const h = S.health && S.health.disks; if (!h) return null;
  return h.find(x => x.mounts.some(m => m === '/srv/pryme/' + d.name)) || h.find(x => x.system) || null;
}
const HS = { healthy: 'Healthy', warning: 'Warning', failing: 'Failing!', unknown: 'Health n/a' };
function driveCard(d) {
  const used = d.total - d.free, pct = d.total ? Math.round(used / d.total * 100) : 0, k = diskFor(d);
  const st = k ? k.status : null;
  const sub = k ? `${k.usb ? 'USB' : k.ssd ? 'SSD' : 'HDD'} · ${esc(k.model)}` : 'Drive';
  const meta = k ? [k.temp != null && `🌡 ${k.temp}°C`, k.hours != null && `⏱ ${k.hours.toLocaleString()} h on`, k.unsafe != null && `⚡ ${k.unsafe} power cuts`].filter(Boolean).join('</span><span>') : '';
  return `<button class="tile drive" data-path="${esc(d.path)}"><div class="drive-h"><div><b>${esc(d.name)}</b><small>${sub}</small></div>${st ? `<span class="hbadge ${st}">${HS[st]}</span>` : ''}</div>
    <span class="dots ${pct > 90 ? 'hot' : ''}">${dots(pct, 40)}</span>
    <div class="drive-f"><div><span class="lbl">Available</span><span class="big">${fmtBytes(d.free)}</span></div><small>${fmtBytes(used)} used / ${fmtBytes(d.total)}</small></div>
    ${meta ? `<div class="disk-meta"><span>${meta}</span></div>` : ''}</button>`;
}
function bindDriveCards(root) { $$('.drive', root).forEach(b => (b.onclick = () => { S.path = b.dataset.path; setTab('files'); })); }


/* ---------------- Health · power-cut shield · services ---------------- */
let healthBusy = false, healthAt = 0;
async function pollHealth(force) {
  if (healthBusy || S.phase !== 'online' || !S.st || !S.st.loggedIn) { if (S.phase !== 'online') renderHealth(); return; }
  if (!force && Date.now() - healthAt < 30000) return;
  healthBusy = true;
  try {
    const [h, t] = await Promise.all([get('/api/health'), get('/api/trash').catch(() => null)]);
    S.health = h; S.trash = t; healthAt = Date.now(); renderHealth(); renderStats();
  } catch {} finally { healthBusy = false; }
}
setInterval(() => { if (S.tab === 'home') pollHealth(); }, 5000);
const APP_IC = { cbackup: '☁️', samba: '🗂️', smart: '🩺', backup: '🔁', jellyfin: '🎬', cloud: '☁️', wol: '⚡', ssh: '⌨️' };
const APP_TXT = { cbackup: 'Google Drive · OneDrive · iCloud', samba: 'Map as a network drive in File Explorer', smart: 'Warns before a disk fails', backup: 'Copies a folder to another drive every day', jellyfin: 'Watch movies & music on TV / phone', cloud: 'Open Pryme from anywhere', wol: 'Power On over the network', ssh: 'Command line from your laptop' };
function renderHealth() {
  const h = S.health, online = S.phase === 'online';
  const binTxt = S.trash ? fmtBytes(S.trash.size) : '—';
  $('#binSize').textContent = online ? binTxt : '—';
  if (!h || !online) {
    $('#shieldChip').textContent = '—'; $('#shieldChip').className = 'chip';
    $('#shieldTitle').textContent = online ? 'Checking…' : 'Server is off'; $('#shieldChecks').innerHTML = '';
    $('#apps').innerHTML = `<div class="empty-sm">${online ? 'Loading services…' : 'Turn the server on to see its services.'}</div>`;
    return;
  }
  const sf = h.safety || {}, cuts = sf.powercuts || [];
  $('#shieldChip').textContent = sf.score + '% protected';
  $('#shieldChip').className = 'chip ' + (sf.score >= 100 ? 'good' : sf.score >= 60 ? 'mid' : 'bad');
  $('#shieldTitle').textContent = sf.recovered ? '⚠ Recovered after a power cut' : cuts.length ? `${cuts.length} power cut${cuts.length > 1 ? 's' : ''} survived` : 'No power cuts recorded';
  $('#shieldSub').textContent = sf.recovered && sf.recovered.at ? `Power was lost around ${fmtDate(sf.recovered.at)} — disks were checked automatically` : cuts[0] && cuts[0].at ? `Last one: ${fmtDate(cuts[0].at)} · No UPS — software protection is on` : 'No UPS · software protection keeps your files safe';
  $('#shieldChecks').innerHTML = (sf.checks || []).map(c => `<li class="${c.ok ? 'ok' : ''}" title="${esc(c.info || '')}">${esc(c.label)}${c.optional ? ' <span class="muted">(optional)</span>' : ''}</li>`).join('');
  $('#apps').innerHTML = (h.services || []).map(a => `<div class="tile app-tile"><div class="app-h"><span class="app-ic">${APP_IC[a.id] || '•'}</span><span class="dot ${a.on ? 'on' : 'off'}"></span></div>
    <b>${esc(a.name)}</b><span class="sub">${a.on ? ((a.id === 'backup' || a.id === 'cbackup') && a.last ? 'Last backup: ' + fmtDate(a.last.at) + (a.last.ok ? ' ✓' : ' ✗') : APP_TXT[a.id] || 'Running') : a.on === null ? 'Unknown' : 'Not set up · see README'}</span>
    ${a.url && a.on ? (a.url.startsWith('http') ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">Open ↗</a>` : `<a title="Copy" data-copy="${esc(a.url)}" href="#">${esc(a.url)}</a>`) : ''}</div>`).join('');
  $$('#apps [data-copy]').forEach(x => (x.onclick = ev => { ev.preventDefault(); navigator.clipboard && navigator.clipboard.writeText(x.dataset.copy).then(() => toast('Copied — paste it in File Explorer', 'ok')); }));
}

/* ---------------- Trash ---------------- */
S.trSel = new Set();
async function loadTrash() {
  if (S.phase !== 'online') { $('#trList').innerHTML = `<div class="fempty">${ico('power')}<b>Server is off</b>Turn it on to see the trash.</div>`; return; }
  try { S.trash = await get('/api/trash'); } catch (e) { $('#trList').innerHTML = `<div class="fempty"><b>${esc(e.message)}</b></div>`; return; }
  S.trSel.clear(); renderTrash();
}
function renderTrash() {
  const t = S.trash || { items: [], size: 0 };
  $('#trInfo').textContent = t.items.length ? `${t.items.length} item${t.items.length > 1 ? 's' : ''} · ${fmtBytes(t.size)}` : 'Trash is empty';
  $('#trRestore').disabled = $('#trDelete').disabled = !S.trSel.size; $('#trEmpty').disabled = !t.items.length;
  $('#trList').innerHTML = t.items.length ? t.items.map(i => `<div class="tr-row ${S.trSel.has(i.id) ? 'sel' : ''}" data-id="${esc(i.id)}"><input type="checkbox" ${S.trSel.has(i.id) ? 'checked' : ''}>
      <div style="min-width:0"><b>${esc(i.name)}</b><small>From ${esc(i.from)} · deleted ${fmtDate(i.at)}</small></div><span class="sz">${i.dir ? 'Folder · ' : ''}${fmtBytes(i.size)}</span>
      <button class="btn sm" data-r="${esc(i.id)}">${ico('restore')}Restore</button></div>`).join('')
    : `<div class="fempty">${ico('trash')}<b>Nothing here</b>Files you delete in Pryme come here first, so you can get them back.</div>`;
  $$('#trList .tr-row').forEach(r => { const id = r.dataset.id; $('input', r).onchange = () => { S.trSel.has(id) ? S.trSel.delete(id) : S.trSel.add(id); renderTrash(); }; });
  $$('#trList [data-r]').forEach(b => (b.onclick = () => trashAct('restore', [b.dataset.r])));
}
async function trashAct(kind, ids) {
  try {
    if (kind === 'restore') { const r = await post('/api/trash/restore', { ids }); toast(`Restored ${r.restored} item(s)`, 'ok'); }
    else {
      const all = !ids;
      if (!(await modal({ title: all ? 'Empty the trash?' : 'Delete forever?', text: 'These files will be permanently deleted. This cannot be undone.', ok: 'Delete forever', danger: true }))) return;
      const r = await post('/api/trash/empty', all ? {} : { ids }); toast(`Deleted ${r.deleted} item(s) forever`, 'ok');
    }
    loadTrash(); healthAt = 0;
  } catch (e) { toast(e.message, 'err'); }
}
$('#trRestore').onclick = () => trashAct('restore', [...S.trSel]);
$('#trDelete').onclick = () => trashAct('delete', [...S.trSel]);
$('#trEmpty').onclick = () => trashAct('delete', null);

/* ---------------- Photos ---------------- */
async function loadPhotos(force) {
  const g = $('#phGrid');
  if (S.cloudMode) { g.innerHTML = `<div class="fempty">${ico('photo')}<b>Photos open in Fast mode</b>Photos load straight from your server on home Wi-Fi (no cloud limits).<br><br>${lanUrl() ? `<a class="btn primary" href="${esc(lanUrl())}" target="_blank" rel="noopener">${ico('bolt')}Open Fast mode</a>` : ''}</div>`; return; }
  if (S.phase !== 'online') { g.innerHTML = `<div class="fempty">${ico('power')}<b>Server is off</b>Turn it on to see your photos.</div>`; return; }
  const sel = $('#phRoot'), cur = sel.value || '/';
  sel.innerHTML = `<option value="/">All drives</option>` + (S.drives || []).map(d => `<option value="${esc(d.path)}">${esc(d.name)}</option>`).join('');
  sel.value = cur;
  g.innerHTML = `<div class="fempty"><div class="spinner" style="margin:0 auto;border-color:var(--border2);border-top-color:var(--accent)"></div></div>`;
  let d; try { d = await get('/api/photos?path=' + enc(cur) + (force ? '&t=' + Date.now() : '')); } catch (e) { g.innerHTML = `<div class="fempty"><b>${esc(e.message)}</b></div>`; return; }
  $('#phCount').textContent = d.total ? `${d.total.toLocaleString()} photo${d.total > 1 ? 's' : ''}` : '';
  if (!d.photos.length) { g.innerHTML = `<div class="fempty">${ico('photo')}<b>No photos yet</b>Upload photos in Files — they show up here automatically.</div>`; return; }
  let html = '', month = '';
  for (const ph of d.photos) {
    const m = new Date(ph.mtime).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    if (m !== month) { month = m; html += `<h4 class="ph-month">${esc(m)}</h4>`; }
    html += `<button class="ph-item" data-p="${esc(ph.path)}" title="${esc(ph.name)}"><img loading="lazy" alt="" src="/api/thumb?w=360&path=${enc(ph.path)}"></button>`;
  }
  g.innerHTML = html;
  $$('.ph-item', g).forEach(b => (b.onclick = () => openFile(b.dataset.p)));
}
$('#phRoot').onchange = () => loadPhotos();
$('#phRefresh').onclick = () => loadPhotos(true);

/* ---------------- Files ---------------- */
const CAT = [
  [/^(jpe?g|png|gif|webp|bmp|svg|heic|tiff?|raw|cr2|nef)$/, '#ec4899', 'img'], [/^(mp4|mkv|avi|mov|webm|wmv|flv|m4v|3gp|ts)$/, '#8b5cf6', 'vid'],
  [/^(mp3|wav|flac|aac|ogg|m4a|wma|opus)$/, '#f59e0b', 'aud'], [/^(zip|rar|7z|tar|gz|bz2|xz|iso)$/, '#64748b', 'zip'],
  [/^(pdf)$/, '#ef4444', 'pdf'], [/^(docx?|odt|rtf|txt|md)$/, '#3b82f6', 'doc'], [/^(xlsx?|csv|ods)$/, '#16a34a', 'xls'],
  [/^(pptx?|odp)$/, '#ea580c', 'ppt'], [/^(js|ts|py|java|c|cpp|cs|html|css|json|php|go|rs|sh|bat|ps1)$/, '#0ea5e9', 'code'],
  [/^(exe|msi|apk|deb|dmg)$/, '#475569', 'app'],
];
const extOf = n => (n.lastIndexOf('.') > 0 ? n.slice(n.lastIndexOf('.') + 1).toLowerCase() : '');
function fileIcon(e) {
  if (e.dir) return `<div class="ficon" style="background:linear-gradient(135deg,#dcfce7,#4ade80 45%,#16a34a)">${ico('files')}</div>`;
  const x = extOf(e.name), c = CAT.find(([r]) => r.test(x));
  return `<div class="ficon" style="background:${c ? c[1] : '#94a3b8'}">${esc((x || 'file').slice(0, 4))}</div>`;
}
const kind = n => { const x = extOf(n); return /^(jpe?g|png|gif|webp|bmp|svg)$/.test(x) ? 'image' : /^(mp4|webm|mov|m4v|mkv)$/.test(x) ? 'video' : /^(mp3|wav|ogg|m4a|flac|opus)$/.test(x) ? 'audio' : /^(pdf|txt|md|log|json)$/.test(x) ? 'doc' : null; };
const joinP = (a, b) => (a === '/' ? '' : a) + '/' + b;

async function loadDir(p) {
  S.path = p; S.sel.clear();
  if (S.phase !== 'online') return renderFiles();
  $('#fArea').innerHTML = `<div class="fempty"><div class="spinner" style="margin:0 auto;border-color:var(--border2);border-top-color:var(--accent)"></div></div>`;
  try { const d = await get('/api/list?path=' + enc(p)); S.entries = d.entries; S.drives = d.drives || []; S.path = d.path; }
  catch (e) { S.entries = []; toast(e.message, 'err'); if (p !== '/') return loadDir('/'); }
  renderFiles();
}
function renderCrumbs() {
  const parts = S.path.split('/').filter(Boolean);
  let acc = '';
  const html = [`<button data-p="/">All drives</button>`].concat(parts.map(x => { acc += '/' + x; return `<i>›</i><button data-p="${esc(acc)}">${esc(x)}</button>`; }));
  $('#crumbs').innerHTML = html.join('');
  $$('#crumbs button').forEach(b => (b.onclick = () => loadDir(b.dataset.p)));
}
function renderFiles() {
  renderCrumbs();
  $('#fView').innerHTML = ico(S.view === 'list' ? 'grid' : 'list');
  const atRoot = S.path === '/';
  ['#fUp', '#fUpDir', '#fNew'].forEach(i => ($(i).disabled = atRoot || S.phase !== 'online'));
  if (S.cloudMode) ['#fUp', '#fUpDir'].forEach(i => ($(i).disabled = true));
  const area = $('#fArea');
  if (S.phase !== 'online') {
    area.innerHTML = `<div class="fempty">${ico('power')}<b>Server is ${PHASE[S.phase].pill.toLowerCase()}</b>Files appear when the server is online.<br><br><button class="btn primary" id="fOn">${ico('power')}Power On</button></div>`;
    const b = $('#fOn'); if (b) { b.disabled = S.phase !== 'offline'; b.onclick = powerOn; }
    renderSel(); return;
  }
  if (atRoot) {
    area.innerHTML = S.drives.length ? `<div class="drives drive-cards">${S.drives.map(driveCard).join('')}</div>`
      : `<div class="fempty">${ico('drive')}<b>No drives found</b>Mount your hard drives on the server:<br><code>sudo bash /opt/pryme/mount-drives.sh</code></div>`;
    bindDriveCards(area); renderSel(); return;
  }
  const f = S.filter.toLowerCase();
  const list = S.entries.filter(e => !e.hidden && (!f || e.name.toLowerCase().includes(f)));
  if (!list.length) {
    area.innerHTML = `<div class="fempty">${ico('upload')}<b>${f ? 'No matches' : 'This folder is empty'}</b>${f ? '' : 'Drag &amp; drop files here, or use Upload.'}</div>`;
    renderSel(); return;
  }
  if (S.view === 'grid') {
    area.innerHTML = `<div class="fgrid">${list.map(e => { const p = joinP(S.path, e.name); return `<div class="gitem ${S.sel.has(p) ? 'sel' : ''}" data-p="${esc(p)}" data-dir="${e.dir ? 1 : 0}">
      <input type="checkbox" ${S.sel.has(p) ? 'checked' : ''}>${!e.dir && !S.cloudMode && kind(e.name) === 'image' ? `<div class="ficon"><img loading="lazy" alt="" src="/api/thumb?w=300&path=${enc(p)}"></div>` : fileIcon(e)}<b title="${esc(e.name)}">${esc(e.name)}</b><small>${e.dir ? 'Folder' : fmtBytes(e.size)}</small></div>`; }).join('')}</div>`;
    $$('.gitem', area).forEach(g => {
      const p = g.dataset.p, isDir = g.dataset.dir === '1';
      $('input', g).onclick = ev => { ev.stopPropagation(); toggleSel(p); };
      g.onclick = () => (S.sel.size ? toggleSel(p) : isDir ? loadDir(p) : openFile(p));
    });
  } else {
    const all = list.every(e => S.sel.has(joinP(S.path, e.name)));
    area.innerHTML = `<table class="ftable"><thead><tr><th class="c-chk"><input type="checkbox" id="selAll" ${all ? 'checked' : ''}></th><th>Name</th><th class="c-size">Size</th><th class="c-date">Modified</th><th class="c-act"></th></tr></thead><tbody>
      ${list.map(e => { const p = joinP(S.path, e.name); return `<tr class="row ${S.sel.has(p) ? 'sel' : ''}" data-p="${esc(p)}" data-dir="${e.dir ? 1 : 0}">
        <td class="c-chk"><input type="checkbox" ${S.sel.has(p) ? 'checked' : ''}></td>
        <td><div class="fname ${e.dir ? 'dir' : 'file'}">${fileIcon(e)}<span title="${esc(e.name)}">${esc(e.name)}</span></div></td>
        <td class="c-size">${e.dir ? '—' : fmtBytes(e.size)}</td><td class="c-date">${fmtDate(e.mtime)}</td>
        <td class="c-act"><div class="rowact"><button data-a="fetch" title="Get to this PC">${ico('pc')}</button><button data-a="download" title="Download">${ico('download')}</button><button data-a="rename" title="Rename">${ico('edit')}</button><button data-a="delete" class="del" title="Delete">${ico('trash')}</button></div></td></tr>`; }).join('')}</tbody></table>`;
    $('#selAll').onchange = ev => { list.forEach(e => { const p = joinP(S.path, e.name); ev.target.checked ? S.sel.add(p) : S.sel.delete(p); }); renderFiles(); };
    $$('tr.row', area).forEach(tr => {
      const p = tr.dataset.p, isDir = tr.dataset.dir === '1';
      $('input', tr).onclick = ev => { ev.stopPropagation(); toggleSel(p); };
      $('.fname span', tr).onclick = () => (isDir ? loadDir(p) : openFile(p));
      tr.ondblclick = () => (isDir ? loadDir(p) : openFile(p));
      $$('.rowact button', tr).forEach(b => (b.onclick = ev => { ev.stopPropagation(); doAction(b.dataset.a, [p]); }));
    });
  }
  renderSel();
}
function toggleSel(p) { S.sel.has(p) ? S.sel.delete(p) : S.sel.add(p); renderFiles(); }
function renderSel() {
  const n = S.sel.size; $('#selbar').classList.toggle('hidden', !n);
  $('#selCount').textContent = n + ' selected';
  $('#selbar [data-act=rename]').disabled = n !== 1;
}
$$('#selbar [data-act]').forEach(b => (b.onclick = () => (b.dataset.act === 'clear' ? (S.sel.clear(), renderFiles()) : doAction(b.dataset.act, [...S.sel]))));
$('#fSearch').oninput = e => { S.filter = e.target.value; renderFiles(); };
$('#fRefresh').onclick = () => loadDir(S.path);
$('#fView').onclick = () => { S.view = S.view === 'list' ? 'grid' : 'list'; try { localStorage.setItem('pryme-view', S.view); } catch {} renderFiles(); };
$('#fNew').onclick = async () => {
  const name = await modal({ title: 'New folder', input: 'New folder', ok: 'Create' });
  if (!name) return;
  try { await post('/api/mkdir', { path: S.path, name: name.trim() }); toast('Folder created', 'ok'); loadDir(S.path); } catch (e) { toast(e.message, 'err'); }
};

async function doAction(a, paths) {
  if (!paths.length) return;
  if (S.cloudMode && (a === 'fetch' || a === 'download')) return fastModal('Downloading');
  if (a === 'fetch' && S.serverMode) {
    toast(`Downloading ${paths.length} item(s) to this device — folders come as .zip`, 'ok');
    a = 'download'; S.sel.clear(); renderFiles();
  }
  if (a === 'fetch') {
    try { const r = await post('/local/fetch', { paths }); toast(`Copying ${paths.length} item(s) to ${r.downloadDir}`, 'ok'); S.sel.clear(); renderFiles(); pollJobs(); }
    catch (e) { toast(e.message, 'err'); }
  } else if (a === 'download') {
    paths.forEach((p, i) => setTimeout(() => { const l = document.createElement('a'); l.href = '/api/download?path=' + enc(p); l.download = ''; document.body.appendChild(l); l.click(); l.remove(); }, i * 400));
  } else if (a === 'rename') {
    const old = paths[0].split('/').pop();
    const nn = await modal({ title: 'Rename', input: old, ok: 'Rename' });
    if (!nn || nn === old) return;
    try { await post('/api/rename', { path: paths[0], newName: nn.trim() }); toast('Renamed', 'ok'); loadDir(S.path); } catch (e) { toast(e.message, 'err'); }
  } else if (a === 'delete') {
    const ok = await modal({ title: `Move ${paths.length === 1 ? '"' + paths[0].split('/').pop() + '"' : paths.length + ' items'} to Trash?`, text: 'You can restore it from Trash for 30 days.', ok: 'Move to Trash', danger: true });
    if (!ok) return;
    try { await post('/api/delete', { paths }); toast('Moved to Trash', 'ok'); loadDir(S.path); healthAt = 0; } catch (e) { toast(e.message, 'err'); }
  }
}

function openFile(p) {
  if (S.cloudMode) return fastModal('Opening files');
  const name = p.split('/').pop(), k = kind(name), url = '/api/download?path=' + enc(p) + '&inline=1';
  if (!k) return doAction('download', [p]);
  const v = $('#viewer');
  const body = k === 'image' ? `<img src="${url}">` : k === 'video' ? `<video src="${url}" controls autoplay></video>` : k === 'audio' ? `<audio src="${url}" controls autoplay></audio>` : `<iframe src="${url}"></iframe>`;
  v.innerHTML = `<div class="viewer-bar"><b>${esc(name)}</b><button class="btn sm primary" id="vFetch">${ico('pc')}Get to this PC</button><button class="icon-btn" id="vDl" title="Download">${ico('download')}</button><button class="icon-btn" id="vX" title="Close">${ico('x')}</button></div><div class="viewer-body">${body}</div>`;
  v.classList.remove('hidden');
  const close = () => { v.classList.add('hidden'); v.innerHTML = ''; document.removeEventListener('keydown', key); };
  const key = e => e.key === 'Escape' && close();
  document.addEventListener('keydown', key);
  $('#vX').onclick = close; $('#vDl').onclick = () => doAction('download', [p]); $('#vFetch').onclick = () => doAction('fetch', [p]);
}

/* ---------------- Uploads ---------------- */
$('#fUp').onclick = () => $('#fileInput').click();
$('#fUpDir').onclick = () => $('#dirInput').click();
$('#fileInput').onchange = e => { queueUploads([...e.target.files].map(f => ({ file: f, name: f.name })), S.path); e.target.value = ''; };
$('#dirInput').onchange = e => { queueUploads([...e.target.files].map(f => ({ file: f, name: f.webkitRelativePath || f.name })), S.path); e.target.value = ''; };

function queueUploads(items, dest) {
  if (S.cloudMode) return fastModal('Uploading');
  if (dest === '/') return toast('Open a drive first, then upload', 'err');
  for (const it of items) S.uploads.unshift({ id: Math.random().toString(36).slice(2), file: it.file, name: it.name, dest, after: it.after, loaded: 0, total: it.file.size, status: 'queued', speed: 0 });
  toast(`Uploading ${items.length} file(s)…`); pumpUploads(); renderUploads();
}
function pumpUploads() {
  let active = S.uploads.filter(u => u.status === 'uploading').length;
  for (const u of [...S.uploads].reverse()) { if (active >= 3) break; if (u.status === 'queued') { startUpload(u); active++; } }
}
let refreshT;
function startUpload(u) {
  u.status = 'uploading'; u.t0 = Date.now(); u.lastT = u.t0; u.lastB = 0;
  const x = new XMLHttpRequest(); u.xhr = x;
  x.open('PUT', `/api/upload?path=${enc(u.dest)}&name=${enc(u.name)}`);
  x.upload.onprogress = e => {
    u.loaded = e.loaded; const now = Date.now();
    if (now - u.lastT > 400) { u.speed = (e.loaded - u.lastB) / ((now - u.lastT) / 1000); u.lastT = now; u.lastB = e.loaded; }
    throttleRenderUploads();
  };
  x.onload = () => {
    if (x.status < 300) { u.status = 'done'; u.loaded = u.total; if (u.after === 'unzip') { u.status = 'uploading'; u.info = 'Unpacking…'; cloudCall('importZip', { path: u.dest + '/' + u.name }).then(() => { u.status = 'done'; toast(u.name + ' unpacked into Google Photos', 'ok'); }, e => { u.status = 'error'; u.error = e.message; }).finally(() => { u.info = null; renderUploads(); }); } }
    else { u.status = 'error'; try { u.error = JSON.parse(x.responseText).error; } catch { u.error = 'Failed (' + x.status + ')'; } }
    finish();
  };
  x.onerror = () => { u.status = 'error'; u.error = 'Connection lost'; finish(); };
  x.onabort = () => { u.status = 'cancelled'; finish(); };
  x.send(u.file);
  function finish() {
    u.speed = 0; u.xhr = null; pumpUploads(); renderUploads(); renderStatus && S.st && renderStatus();
    if (S.tab === 'files' && S.path === u.dest) { clearTimeout(refreshT); refreshT = setTimeout(() => loadDir(S.path), 500); }
    if (!S.uploads.some(v => v.status === 'uploading' || v.status === 'queued')) toast('Uploads finished', 'ok');
  }
}
let upT = 0;
function throttleRenderUploads() { const n = Date.now(); if (n - upT > 250) { upT = n; renderUploads(); } }
function renderUploads() {
  const el = $('#upList');
  if (!S.uploads.length) { el.innerHTML = `<div class="tempty">No uploads yet. Go to Files → Upload, or drag &amp; drop.</div>`; return; }
  el.innerHTML = S.uploads.slice(0, 150).map(u => {
    const pct = u.total ? Math.round(u.loaded / u.total * 100) : 100;
    const info = u.info ? u.info : u.status === 'uploading' ? `${fmtBytes(u.loaded)} / ${fmtBytes(u.total)} · ${fmtRate(u.speed)}` : u.status === 'error' ? esc(u.error) : `${fmtBytes(u.total)} → ${esc(u.dest)}`;
    return `<div class="titem">${fileIcon({ name: u.name })}<div style="min-width:0"><b title="${esc(u.name)}">${esc(u.name)}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${info}</small></div>
      <div>${u.status === 'uploading' || u.status === 'queued' ? `<button class="btn sm" data-cancel="${u.id}">Cancel</button>` : `<span class="st ${u.status}">${u.status === 'done' ? 'Done' : u.status === 'error' ? 'Failed' : 'Cancelled'}</span>`}</div></div>`;
  }).join('');
  $$('[data-cancel]', el).forEach(b => (b.onclick = () => { const u = S.uploads.find(x => x.id === b.dataset.cancel); if (!u) return; if (u.xhr) u.xhr.abort(); else { u.status = 'cancelled'; renderUploads(); } }));
}
$('#clearUps').onclick = () => { S.uploads = S.uploads.filter(u => u.status === 'uploading' || u.status === 'queued'); renderUploads(); };

/* drag & drop (files and whole folders) */
let dragN = 0;
const filesCard = $('#filesCard');
filesCard.addEventListener('dragenter', e => { if (!e.dataTransfer.types.includes('Files') || S.path === '/' || S.phase !== 'online') return; e.preventDefault(); dragN++; $('#dropTo').textContent = 'to ' + S.path; $('#drop').classList.add('on'); });
filesCard.addEventListener('dragover', e => { if (S.path !== '/' && S.phase === 'online') e.preventDefault(); });
filesCard.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').classList.remove('on'); } });
filesCard.addEventListener('drop', async e => {
  e.preventDefault(); dragN = 0; $('#drop').classList.remove('on');
  const dest = S.path, out = await dropItems(e);
  if (out.length) queueUploads(out, dest);
});
async function dropItems(e) {
  const items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) { const f = await new Promise((ok, bad) => entry.file(ok, bad)); out.push({ file: f, name: prefix + f.name }); }
    else if (entry.isDirectory) {
      const r = entry.createReader();
      let batch; do { batch = await new Promise((ok, bad) => r.readEntries(ok, bad)); for (const c of batch) await walk(c, prefix + entry.name + '/'); } while (batch.length);
    }
  }
  if (items.length) { for (const it of items) await walk(it, ''); } else out.push(...[...e.dataTransfer.files].map(f => ({ file: f, name: f.name })));
  return out;
}
// Google Photos drop box: files go to <drive>/Cloud Backup/Google Photos/Imported <date>/, .zip files are unpacked there
function gpImport(items, drive) {
  if (!items.length) return;
  if (S.cloudMode) return fastModal('Uploading');
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dest = `/${drive}/Cloud Backup/Google Photos/Imported ${day}`;
  for (const it of items) if (/\.(zip|tgz)$/i.test(it.name)) it.after = 'unzip';
  queueUploads(items, dest);
}

/* ---------------- Jobs (server -> this PC) ---------------- */
let jobsBusy = false;
async function pollJobs() {
  if (jobsBusy) return; jobsBusy = true;
  try { const d = await get('/local/jobs'); S.jobs = d.jobs; S.dlDir = d.downloadDir; renderJobs(); } catch {} finally { jobsBusy = false; }
}
setInterval(() => { if (S.tab === 'transfers' || (S.st && S.st.activeJobs)) pollJobs(); }, 1000);
let lastDone = new Set();
function renderJobs() {
  $('#dlDirTxt').textContent = 'Saving to: ' + (S.dlDir || '');
  for (const j of S.jobs) if (j.status === 'done' && !lastDone.has(j.id)) { if (lastDone.size) toast(`"${j.name}" is now on this PC`, 'ok'); lastDone.add(j.id); }
  if (!lastDone.size) lastDone.add('_');
  const el = $('#jobList');
  if (!S.jobs.length) { el.innerHTML = `<div class="tempty">Select files in <b>Files</b> and press <b>Get to this PC</b> — they are saved here automatically.</div>`; return; }
  el.innerHTML = S.jobs.map(j => {
    const pct = j.total ? Math.round(j.done / j.total * 100) : (j.status === 'done' ? 100 : 0);
    const info = j.status === 'running' ? `${fmtBytes(j.done)} / ${fmtBytes(j.total)} · ${fmtRate(j.speed)} · ${j.filesDone}/${j.files} files`
      : j.status === 'error' ? esc(j.error) : j.status === 'queued' ? 'Waiting…' : `${fmtBytes(j.total)} · ${j.files} file(s)`;
    const right = j.status === 'running' || j.status === 'queued' ? `<button class="btn sm" data-jc="${j.id}">Cancel</button>`
      : j.status === 'done' ? `<button class="btn sm" data-jo="${esc(j.dest)}">${ico('open')}Open</button>` : `<span class="st ${j.status}">${j.status === 'error' ? 'Failed' : 'Cancelled'}</span>`;
    return `<div class="titem">${fileIcon({ name: j.name, dir: j.files > 1 })}<div style="min-width:0"><b>${esc(j.name)}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${info}</small></div><div>${right}</div></div>`;
  }).join('');
  $$('[data-jc]', el).forEach(b => (b.onclick = () => post('/local/jobs/cancel', { id: b.dataset.jc }).then(pollJobs)));
  $$('[data-jo]', el).forEach(b => (b.onclick = () => post('/local/open', { path: b.dataset.jo })));
}
$('#openDl').onclick = () => post('/local/open', {});
$('#clearJobs').onclick = () => post('/local/jobs/clear').then(pollJobs);

/* ---------------- Live screen ---------------- */
let liveOn = false;
function updateLive() {
  const want = S.tab === 'live' && S.phase === 'online';
  const img = $('#screenImg'), ov = $('#ov');
  $('#liveTag').classList.toggle('on', want && liveOn);
  if (want && !img.dataset.on) {
    img.dataset.on = '1'; liveOn = false;
    setOv(true, 'Connecting to screen…', 'Starting live capture', false);
    img.onload = () => { if (!liveOn) { liveOn = true; ov.classList.add('hidden'); $('#liveTag').classList.add('on'); $('#liveInfo').textContent = (S.st.server.name || 'Server') + ' · live'; } };
    img.onerror = async () => {
      liveOn = false; delete img.dataset.on;
      let msg = 'Screen capture is not available.';
      try { const s = await get('/api/screen/status'); if (s.error) msg = s.error; } catch {}
      setOv(true, 'Live screen unavailable', msg + ' Retrying…', false);
      setTimeout(updateLive, 4000);
    };
    if (S.cloudMode) {
      // low-bandwidth preview: one picture at a time (saves Render bandwidth)
      const base = img.onload;
      img.onload = () => { base(); $('#liveInfo').textContent = (S.st.server.name || 'Server') + ' · cloud preview (~1 fps)'; setTimeout(() => { if (img.dataset.on) img.src = '/api/screen/snap?t=' + Date.now(); }, 900); };
      img.src = '/api/screen/snap?t=' + Date.now();
    } else img.src = '/api/screen?t=' + Date.now();
  } else if (!want && img.dataset.on) {
    delete img.dataset.on; liveOn = false; setCtl(false); img.onload = img.onerror = null; img.removeAttribute('src'); img.src = 'data:,';
  }
  if (!want) {
    const ph = S.phase;
    if (ph === 'booting') setOv(true, 'Starting your server…', 'Wake signal sent. The live screen appears here automatically once the server is up.', false, true);
    else if (ph === 'restarting') setOv(true, 'Restarting…', 'The live screen comes back automatically.', false, true);
    else if (ph === 'shutting-down') setOv(true, 'Shutting down…', 'Power off in progress.', false, true);
    else if (ph === 'offline') setOv(true, 'Server is offline', 'Press Power On — the screen appears here automatically.', true, false);
    $('#liveInfo').textContent = 'Server screen';
  }
}
function setOv(show, title, sub, btn, spin = !btn) {
  $('#ov').classList.toggle('hidden', !show); $('#ovTitle').textContent = title; $('#ovSub').textContent = sub;
  $('#ovOn').classList.toggle('hidden', !btn); $('#ovSpin').classList.toggle('hidden', !spin);
}
$('#liveFull').onclick = () => { const b = $('#screenBox'); document.fullscreenElement ? document.exitFullscreen() : b.requestFullscreen && b.requestFullscreen(); };
$('#liveSnap').onclick = () => { if (!liveOn) return toast('Screen not live yet', 'err'); const a = document.createElement('a'); a.href = '/api/screen/snap' + (S.cloudMode ? '?dl=1' : ''); a.download = 'pryme-screen.jpg'; a.click(); };

/* ---------------- Remote control (mouse + keyboard) ---------------- */
let ctlOn = false;
const box = $('#screenBox');
function setCtl(on) {
  ctlOn = on;
  $('#liveCtl').classList.toggle('on', on); box.classList.toggle('ctl', on); $('#ctlHint').classList.toggle('hidden', !on);
  if (on) box.focus();
}
$('#liveCtl').onclick = async () => {
  if (ctlOn) return setCtl(false);
  if (!liveOn) return toast('Wait until the live screen is showing', 'err');
  try {
    const s = await get('/api/screen/status');
    if (s.mode !== 'desktop') return toast('Control needs a desktop on the server (Xubuntu). Console mode is view-only.', 'err');
    if (!s.control) return toast('Install xdotool on the server: sudo apt install xdotool', 'err');
  } catch {}
  setCtl(true);
};
const inQ = []; let inBusy = false, inErrAt = 0;
function sendInput(ev) {
  const last = inQ[inQ.length - 1];
  if (last && ev.t === 'move' && last.t === 'move') inQ[inQ.length - 1] = ev;
  else if (last && ev.t === 'type' && last.t === 'type' && last.s.length < 150) last.s += ev.s;
  else inQ.push(ev);
  flushInput();
}
async function flushInput() {
  if (inBusy || !inQ.length) return;
  inBusy = true;
  const evs = inQ.splice(0);
  try { await post('/api/input', { events: evs }); }
  catch (e) { if (Date.now() - inErrAt > 4000) { inErrAt = Date.now(); toast('Control: ' + e.message, 'err'); } }
  inBusy = false; flushInput();
}
function norm(e) {
  const img = $('#screenImg'), r = img.getBoundingClientRect(), nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const s = Math.min(r.width / nw, r.height / nh), w = nw * s, h = nh * s;
  const x = (e.clientX - (r.left + (r.width - w) / 2)) / w, y = (e.clientY - (r.top + (r.height - h) / 2)) / h;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x: +x.toFixed(4), y: +y.toFixed(4) };
}
const BTN = { 0: 1, 1: 2, 2: 3 };
let lastMove = 0;
box.addEventListener('pointermove', e => {
  if (!ctlOn || Date.now() - lastMove < 45) return;
  const p = norm(e); if (!p) return; lastMove = Date.now(); sendInput({ t: 'move', ...p });
});
box.addEventListener('pointerdown', e => {
  if (!ctlOn) return; e.preventDefault(); box.focus();
  const p = norm(e); if (!p) return;
  try { box.setPointerCapture(e.pointerId); } catch {}
  sendInput({ t: 'down', b: BTN[e.button] || 1, ...p });
});
box.addEventListener('pointerup', e => {
  if (!ctlOn) return; e.preventDefault();
  const p = norm(e) || { x: 0.5, y: 0.5 };
  sendInput({ t: 'up', b: BTN[e.button] || 1, ...p });
});
box.addEventListener('contextmenu', e => { if (ctlOn) e.preventDefault(); });
let wheelAcc = 0, wheelT = null;
box.addEventListener('wheel', e => {
  if (!ctlOn) return; e.preventDefault();
  wheelAcc += e.deltaY; const p = norm(e) || { x: 0.5, y: 0.5 };
  clearTimeout(wheelT);
  wheelT = setTimeout(() => { const n = Math.max(1, Math.round(Math.abs(wheelAcc) / 100)); sendInput({ t: 'scroll', dy: wheelAcc, n, ...p }); wheelAcc = 0; }, 60);
}, { passive: false });
const KM = { Enter: 'Return', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', Insert: 'Insert', ' ': 'space', CapsLock: 'Caps_Lock' };
const SYM = { '-': 'minus', '=': 'equal', '.': 'period', ',': 'comma', '/': 'slash', ';': 'semicolon', "'": 'apostrophe', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash', '`': 'grave' };
box.addEventListener('keydown', e => {
  if (!ctlOn || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;
  e.preventDefault();
  const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.metaKey && 'super'].filter(Boolean);
  if (e.key.length === 1 && !mods.length) return sendInput({ t: 'type', s: e.key });
  const k = KM[e.key] || (/^F\d{1,2}$/.test(e.key) ? e.key : null) || (e.key.length === 1 ? SYM[e.key] || e.key.toLowerCase() : null);
  if (!k) return;
  if (e.shiftKey && e.key.length !== 1) mods.push('shift');
  sendInput({ t: 'key', k: [...mods, k].join('+') });
});

/* ---------------- Smart plug settings ---------------- */
function plugFields() {
  const t = $('#plType').value;
  $$('.pl-ip').forEach(x => x.classList.toggle('hidden', t === 'none' || t === 'custom'));
  $$('.pl-son').forEach(x => x.classList.toggle('hidden', t !== 'sonoff'));
  $$('.pl-cus').forEach(x => x.classList.toggle('hidden', t !== 'custom'));
  $('#plCut').closest('label').classList.toggle('hidden', t === 'none');
  $('#plTestOn').disabled = $('#plTestOff').disabled = t === 'none';
  renderPlugBm();
}
function renderPlug() {
  const p = (S.st && S.st.plug) || { type: 'none' };
  $('#plType').value = p.type || 'none'; $('#plIp').value = p.ip || ''; $('#plDev').value = p.deviceId || '';
  $('#plOn').value = p.onUrl || ''; $('#plOff').value = p.offUrl || ''; $('#plCut').checked = !!p.cutAfterShutdown;
  plugFields();
}
$('#plType').onchange = plugFields;
const plugBody = () => ({ type: $('#plType').value, ip: $('#plIp').value, deviceId: $('#plDev').value, onUrl: $('#plOn').value, offUrl: $('#plOff').value, cutAfterShutdown: $('#plCut').checked });
$('#plSave').onclick = async () => { try { await post('/local/settings', { plug: plugBody() }); if (S.st) S.st.plug = plugBody(); toast('Smart plug saved', 'ok'); renderPlugBm(); refreshState(); } catch (e) { toast(e.message, 'err'); } };
async function plugTest(action) {
  try {
    await post('/local/settings', { plug: plugBody() });
    if (S.serverMode) { S.st.plug = plugBody(); await plugFetch(action === 'on'); toast('Sent ' + action.toUpperCase() + ' to the smart plug', 'ok'); }
    else { await post('/local/plug', { action }); toast('Smart plug turned ' + action.toUpperCase(), 'ok'); }
    renderPlugBm();
  } catch (e) { toast(e.message, 'err'); }
}
function renderPlugBm() {
  const u = S.serverMode && plugUrl(plugBody(), true);
  $('#plBmWrap').classList.toggle('hidden', !u); if (u) $('#plBm').href = u;
}
$('#plTestOn').onclick = () => plugTest('on');
$('#plTestOff').onclick = async () => {
  if (S.phase === 'online') return toast('Server is ON — shut it down first, then cut power', 'err');
  if (await modal({ title: 'Cut power to the server?', text: 'Only do this when the server is already shut down.', ok: 'Turn OFF', danger: true })) plugTest('off');
};
['#plIp', '#plOn'].forEach(i => $(i).addEventListener('input', renderPlugBm));

/* ---------------- Settings ---------------- */
function renderCloudCard() {
  const s = S.st || {}, body = $('#cloudCardBody');
  if (S.cloudMode) {
    $('#cloudCardH').textContent = 'Connections';
    const plugTxt = { tuya: 'Tuya / Smart Life cloud', 'shelly-cloud': 'Shelly Cloud', webhook: 'Webhook', 'local-url': 'Home Wi-Fi plug link', none: 'Not set — Power On needs a smart plug' }[s.plugType] || s.plugType;
    body.innerHTML = `<p>⚡ <b>Fast mode (home Wi-Fi):</b> ${lanUrl() ? `<a href="${esc(lanUrl())}" target="_blank" rel="noopener">${esc(lanUrl())}</a>` : 'appears when the server is online'}${s.mdnsUrl ? ` · <a href="${esc(s.mdnsUrl)}" target="_blank" rel="noopener">${esc(s.mdnsUrl)}</a>` : ''}</p>
      <p>🔌 <b>Power On:</b> ${esc(plugTxt)}${s.plugCut ? ' · power is cut after Shut Down' : ''}</p><p class="muted">Change these in Render → your service → Environment.</p>`;
  } else {
    $('#cloudCardH').textContent = 'Pryme Cloud (Render)';
    body.innerHTML = s.cloudUrl
      ? `<p>${s.cloudOk ? '🟢 Connected' : '🟠 Connecting…'} — <a href="${esc(s.cloudUrl)}" target="_blank" rel="noopener">${esc(s.cloudUrl)}</a></p><p class="muted">Bookmark this link: it opens from anywhere, even when the server is OFF.</p>`
      : `<p>Not set up. On the server run <code>sudo bash ~/pryme-server-pc/server-agent/install.sh</code> and paste your Render URL (README section 7).</p>`;
  }
}
function renderSettings() {
  renderCloudCard(); renderWakerCard();
  const wb = $('#cloudCardBody');
  if (wb && !$('#wolLine')) wb.insertAdjacentHTML('beforeend', `<p id="wolLine">💡 <b>Wake-on-LAN Power On:</b> <a href="/local/wol.bat">download "Pryme Power On" for Windows</a> — keep it on your laptop Desktop and double-click it on home Wi-Fi.</p>`);
  const s = S.st || {}, srv = s.server || {};
  if (document.activeElement !== $('#dlDir')) $('#dlDir').value = s.downloadDir || '';
  const st = S.stats;
  $('#srvInfo').innerHTML = [['Name', srv.name], ['IP', srv.ip ? srv.ip + (srv.port && srv.port !== 80 ? ':' + srv.port : '') : null], ['MAC', (srv.mac || '').toUpperCase()], ['Status', (PHASE[S.phase] || {}).pill],
    ['OS', st && st.os], ['Agent', st && 'v' + st.version]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('#aboutTxt').textContent = `${S.cloudMode ? 'Pryme Cloud' : 'Pryme Server PC'} v${s.version || ''} · signed in as ${s.user || ''}`;
}
$('#saveDl').onclick = async () => { try { const r = await post('/local/settings', { downloadDir: $('#dlDir').value.trim() }); toast('Saved: ' + r.downloadDir, 'ok'); refreshState(); } catch (e) { toast(e.message, 'err'); } };
$('#pwSave').onclick = async () => {
  if ($('#pwNew').value.length < 6) return toast('New password: min 6 characters', 'err');
  try { await post('/local/settings', { oldPassword: $('#pwOld').value, newPassword: $('#pwNew').value }); $('#pwOld').value = $('#pwNew').value = ''; toast('Password updated', 'ok'); } catch (e) { toast(e.message, 'err'); }
};
$('#unlinkBtn').onclick = async () => {
  if (!(await modal({ title: 'Unlink this PC?', text: 'You will need to link again with your server username & password.', ok: 'Unlink', danger: true }))) return;
  await post('/local/unlink').catch(() => {}); location.reload();
};

const UPDATE_HTML = `Your server is running an older Pryme version. Update it once — on the server run:<div class="code" style="text-align:left;margin:10px auto 0;max-width:520px">cd ~/pryme-server-pc && git pull\nsudo bash server-agent/install.sh</div>`;
function renderUpdateBanner() {
  const s = S.st || {}, b = $('#updBanner'); if (!b) return;
  const mm = v => String(v || '').split('.').slice(0, 2).join('.');
  const old = S.cloudMode && s.agentVersion && s.online && mm(s.agentVersion) !== mm(s.version);
  b.classList.toggle('hidden', !old);
  if (old) b.innerHTML = `⬆️ <b>Server update available</b> — the server runs Pryme v${esc(s.agentVersion)}, this page is v${esc(s.version)}. <a href="#" id="updHow">How to update</a>`;
  const h = $('#updHow'); if (h) h.onclick = ev => { ev.preventDefault(); sheet(`<div class="sheet-h"><h3>Update your server</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b"><p class="muted" style="margin-top:0">On the server (Terminal, or <code>ssh pryme@SERVER-IP</code> from your laptop):</p><div class="code">cd ~/pryme-server-pc && git pull\nsudo bash server-agent/install.sh\nsudo reboot</div><p class="muted small">Installer: change password → N · Render URL → Enter · key → Enter · the rest as before.</p></div><div class="sheet-f"><button class="btn" data-close>OK</button></div>`); };
}

/* ---------------- Sheet (big dialog) ---------------- */
function sheet(html) { $('#sheetCard').innerHTML = html; $('#sheet').classList.remove('hidden'); $('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); }; $$('[data-close]', $('#sheetCard')).forEach(b => (b.onclick = closeSheet)); }
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetCard').innerHTML = ''; }

/* ---------------- Power On button (Pryme Waker) ---------------- */
function wakerBase() { return S.cloudMode ? location.origin : (S.st && S.st.cloudUrl) || ''; }
function showWakerSetup() {
  const base = wakerBase();
  sheet(`<div class="sheet-h"><h3>⚡ Make the Power On button work</h3><button class="icon-btn" data-close>${ico('x')}</button></div>
  <div class="sheet-b">
    <p class="muted" style="margin-top:0">When the server is off, something <b>at home that is always on</b> has to send the wake signal. Set it up once — then <b>Power On</b> works from anywhere.</p>
    <div class="note"><b>Option 1 · A Windows PC at home that stays on</b> (e.g. the CCTV PC)
      <ol class="steps" style="margin-top:8px"><li>${base ? `<a class="btn sm primary" href="${esc(base)}/waker.ps1">${ico('download')}Download Pryme Waker for Windows</a>` : 'Set up Pryme Cloud first (Settings).'}</li>
      <li>On that PC: right-click the file → <b>Run with PowerShell</b> → type your Pryme username &amp; password.</li>
      <li>Done. It starts hidden with Windows. Keep the PC on and connected to the router.</li></ol></div>
    <div class="note"><b>Option 2 · An old Android phone on its charger</b> (free)
      <ol class="steps" style="margin-top:8px"><li>Install <b>Termux</b> from F-Droid, open it and run:</li></ol>
      <div class="code">pkg install -y nodejs curl
curl -o pryme-waker.js ${esc(base || 'https://YOUR-APP.onrender.com')}/waker.js
node pryme-waker.js</div>
      Keep the phone on Wi-Fi and plugged in. In Android settings, turn off battery optimisation for Termux.</div>
    <div class="note"><b>Option 3 · A Wi-Fi smart plug</b> (Tuya / Smart Life) — see README section 10.</div>
    <div class="note"><b>Right now, on home Wi-Fi:</b> <a href="/local/wol.bat">download the one-click Power On file</a> for this laptop.</div>
  </div><div class="sheet-f"><button class="btn" data-close>Close</button></div>`);
}
function renderWakerCard() {
  const w = S.st && S.st.waker, el = $('#wakerBody'); if (!el) return;
  const status = S.cloudMode ? (w && w.online ? `<span class="ok-txt">● Ready</span> — Power On goes through <b>${esc(w.name || 'Pryme Waker')}</b>.` : '<span class="muted">● No waker connected yet.</span>') : '';
  el.innerHTML = `<p style="margin:0 0 12px">${status || 'Let the Power On button switch the server on from anywhere — no files to click.'}</p><button class="btn sm primary" id="wakerSetup">${ico('bolt')}Set up Power On button</button>`;
  $('#wakerSetup').onclick = showWakerSetup;
}

/* ---------------- Cloud Backup ---------------- */
const ACC = {
  gdrive: { logo: 'G', bg: 'linear-gradient(135deg,#1fa463,#4285f4 55%,#fbbc04)', note: 'Sign in with Google.' },
  onedrive: { logo: '☁', bg: 'linear-gradient(135deg,#0364b8,#28a8ea)', note: 'Sign in with Microsoft.' },
  icloud: { logo: '☁', bg: 'linear-gradient(135deg,#3a3a3c,#8e8e93)', note: 'Apple ID + 2-factor code.' },
  icloudphotos: { logo: '❀', bg: 'linear-gradient(135deg,#ff9f0a,#ff375f 50%,#bf5af2)', note: 'Apple ID + 2-factor code.' },
  gphotos: { logo: '✿', bg: 'conic-gradient(from 45deg,#ea4335,#fbbc04,#34a853,#4285f4,#ea4335)', note: 'Through Google Takeout + your Google Drive.' },
};
let cbBusy = false;
async function cloudCall(action, extra) { return post('/api/cloud', { action, ...(extra || {}) }); }
async function loadCloud() {
  if (S.phase !== 'online') { $('#cbAccounts').innerHTML = `<div class="empty-sm">Turn the server on to manage cloud backups.</div>`; $('#cbJobs').innerHTML = ''; return; }
  if (cbBusy) return; cbBusy = true;
  try { S.cb = await cloudCall('status'); } catch (e) { $('#cbAccounts').innerHTML = `<div class="empty-sm">${/unknown (op|action)|not found/i.test(e.message) ? UPDATE_HTML : esc(e.message)}</div>`; return; } finally { cbBusy = false; }
  renderCloud();
}
setInterval(() => { if (S.tab === 'cloud' && S.cb && S.cb.jobs.some(j => j.running)) loadCloud(); }, 2500);
function renderCloud() {
  const c = S.cb; if (!c) return;
  $('#cbVer').textContent = c.rclone ? `rclone v${c.rclone}` : '';
  if (!c.rclone) { $('#cbAccounts').innerHTML = `<div class="empty-sm">Cloud backup needs <b>rclone</b>. On the server run <code>sudo bash ~/pryme-server-pc/server-agent/install.sh</code></div>`; $('#cbJobs').innerHTML = ''; return; }
  const accs = c.accounts.some(a => a.id === 'gphotos') ? c.accounts : [...c.accounts.slice(0, 1), { id: 'gphotos', label: 'Google Photos', connected: false, old: true }, ...c.accounts.slice(1)];
  $('#cbAccounts').innerHTML = accs.map(a => {
    if (a.old) return `<div class="tile acc"><div class="acc-h"><span class="acc-logo" style="background:${ACC.gphotos.bg}">${ACC.gphotos.logo}</span><div><b>Google Photos</b><span class="sub">Update your server to turn this on</span></div></div><div class="row-gap"><button class="btn sm primary" data-gpold>Connect</button></div></div>`;
    const k = ACC[a.id], icl = a.id.startsWith('icloud') && !c.icloud;
    return `<div class="tile acc"><div class="acc-h"><span class="acc-logo" style="background:${k.bg}">${k.logo}</span><div><b>${esc(a.label)}</b><span class="sub">${a.connected ? '<span class="ok-txt">● Connected</span>' : icl ? 'Needs a newer rclone (re-run install.sh)' : k.note}</span></div></div>
      <div class="row-gap">${a.via ? (a.connected ? `<button class="btn sm primary" data-newfrom="${a.id}">${ico('cloud')}Back up</button><button class="btn sm" data-gph>How it works</button>` : `<button class="btn sm primary" data-gph>Connect</button>`)
        : a.connected ? `<button class="btn sm primary" data-newfrom="${a.id}">${ico('cloud')}Back up</button><button class="btn sm" data-disc="${a.id}">Disconnect</button>` : `<button class="btn sm primary" data-conn="${a.id}" ${icl ? 'disabled' : ''}>Connect</button>`}</div></div>`;
  }).join('');
  if (c.drives.length) {
    $('#cbAccounts').insertAdjacentHTML('beforeend', `<div class="tile gp-drop" id="gpDrop"><span class="acc-logo" style="background:${ACC.gphotos.bg}">${ACC.gphotos.logo}</span>
      <div class="gp-txt"><strong class="gp-t">Drop Google Photos here</strong><span class="sub">Drag photos, videos, folders or a Google Photos <b>.zip</b> onto this box — or choose them. On a phone, <b>Choose</b> opens your gallery and Google Photos.</span></div>
      <div class="row-gap"><select id="gpDrive" class="sm-sel">${c.drives.map(d => `<option>${esc(d)}</option>`).join('')}</select><button class="btn sm primary" id="gpPick">${ico('upload')}Choose</button></div>
      <input type="file" id="gpFiles" multiple accept="image/*,video/*,.zip,.heic,.heif" hidden></div>`);
    const box = $('#gpDrop'); let n = 0;
    const go = items => gpImport(items, $('#gpDrive').value);
    $('#gpPick').onclick = () => $('#gpFiles').click();
    $('#gpFiles').onchange = e => { go([...e.target.files].map(f => ({ file: f, name: f.name }))); e.target.value = ''; };
    box.addEventListener('dragenter', e => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); n++; box.classList.add('on'); });
    box.addEventListener('dragover', e => e.preventDefault());
    box.addEventListener('dragleave', () => { if (--n <= 0) { n = 0; box.classList.remove('on'); } });
    box.addEventListener('drop', async e => { e.preventDefault(); n = 0; box.classList.remove('on'); go(await dropItems(e)); });
  }
  $$('[data-conn]').forEach(b => (b.onclick = () => connectAcc(b.dataset.conn)));
  $$('[data-gph]').forEach(b => (b.onclick = gphotosGuide));
  $$('[data-gpold]').forEach(b => (b.onclick = () => sheet(`<div class="sheet-h"><h3>Google Photos</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b"><p style="margin-top:0">Your server runs an older Pryme version without Google Photos. Update it once — on the server run:</p><div class="code">cd ~/pryme-server-pc && git pull\nsudo bash server-agent/install.sh\nsudo reboot</div><p class="muted small">After the reboot, open Cloud again and press Connect on Google Photos.</p></div><div class="sheet-f"><button class="btn" data-close>OK</button></div>`)));
  $$('[data-disc]').forEach(b => (b.onclick = async () => { if (!(await modal({ title: 'Disconnect this account?', text: 'Backups already on the server stay. Backup jobs for it stop working until you connect again.', ok: 'Disconnect', danger: true }))) return; try { await cloudCall('disconnect', { id: b.dataset.disc }); loadCloud(); } catch (e) { toast(e.message, 'err'); } }));
  $$('[data-newfrom]').forEach(b => (b.onclick = () => jobWizard({ remote: b.dataset.newfrom })));
  const jobs = c.jobs;
  $('#cbJobs').innerHTML = jobs.length ? jobs.map(j => {
    const r = j.running, k = ACC[j.remote] || {}, pct = r && r.total ? Math.round(r.bytes / r.total * 100) : 0;
    const when = j.schedule === 'manual' ? 'Manual' : `${j.schedule === 'weekly' ? 'Weekly' : 'Daily'} at ${String(j.hour).padStart(2, '0')}:00`;
    const last = r ? `Backing up… ${fmtBytes(r.bytes)}${r.total ? ' / ' + fmtBytes(r.total) : ''} · ${r.files}${r.totalFiles ? '/' + r.totalFiles : ''} files · ${fmtRate(r.speed)}`
      : j.last ? `${j.last.ok ? '✓' : '✗'} ${fmtDate(j.last.at)} · ${fmtBytes(j.last.bytes || 0)} · ${esc(j.last.msg)}` : 'Not run yet';
    return `<div class="tile job"><span class="acc-logo" style="background:${k.bg || 'var(--tile2)'}">${k.logo || '☁'}</span>
      <div style="min-width:0"><b>${esc(j.name)}</b><span class="sub">${ACC[j.remote] && j.remote === 'gphotos' ? 'All photos &amp; videos (Google Takeout)' : esc(j.items.map(i => i.path || '(everything)').join(', '))} → ${esc(j.drive)}/Cloud Backup · ${when}</span>
      ${r ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}<span class="sub">${last}</span></div>
      <div class="row-gap">${r ? `<button class="btn sm" data-stop="${j.id}">Stop</button>` : `<button class="btn sm primary" data-run="${j.id}">Run now</button>`}<button class="btn sm" data-edit="${j.id}">Edit</button><button class="btn sm danger" data-del="${j.id}">${ico('trash')}</button></div></div>`;
  }).join('') : `<div class="empty-sm">No backups yet. Connect an account, then press <b>New backup</b>.</div>`;
  $$('[data-run]').forEach(b => (b.onclick = async () => { try { await cloudCall('jobRun', { id: b.dataset.run }); toast('Backup started', 'ok'); setTimeout(loadCloud, 800); } catch (e) { toast(e.message, 'err'); } }));
  $$('[data-stop]').forEach(b => (b.onclick = async () => { await cloudCall('jobStop', { id: b.dataset.stop }).catch(() => {}); setTimeout(loadCloud, 800); }));
  $$('[data-edit]').forEach(b => (b.onclick = () => jobWizard(jobs.find(j => j.id === b.dataset.edit))));
  $$('[data-del]').forEach(b => (b.onclick = async () => { if (!(await modal({ title: 'Delete this backup job?', text: 'Files already backed up stay on the server.', ok: 'Delete', danger: true }))) return; await cloudCall('jobDelete', { id: b.dataset.del }).catch(e => toast(e.message, 'err')); loadCloud(); }));
}
$('#cbNew').onclick = () => {
  const acc = S.cb && S.cb.accounts.find(a => a.connected);
  if (!acc) return toast('Connect an account first', 'err');
  jobWizard({ remote: acc.id });
};
async function connectAcc(id) {
  const label = S.cb.accounts.find(a => a.id === id).label;
  if (id.startsWith('icloud')) {
    sheet(`<div class="sheet-h"><h3>Connect ${esc(label)}</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b">
      <div class="note">Before you start, on your iPhone: <b>Settings → [your name] → iCloud</b> → turn <b>Advanced Data Protection OFF</b> and <b>Access iCloud Data on the Web ON</b>. App-specific passwords do not work — use your normal Apple ID password.</div>
      <label class="field" style="margin-top:14px"><span>Apple ID (email)</span><input id="icId" autocomplete="username"></label>
      <label class="field"><span>Apple ID password</span><input id="icPw" type="password" autocomplete="current-password"></label>
      <div id="icCodeWrap" class="hidden"><label class="field"><span>6-digit code from your iPhone / Mac</span><input id="icCode" inputmode="numeric" maxlength="8"></label></div>
      <p class="form-err" id="icErr"></p><p class="muted small">Apple asks you to sign in again about every 30 days — Pryme will show it here.</p></div>
      <div class="sheet-f"><button class="btn" data-close>Cancel</button><button class="btn primary" id="icGo">Continue</button></div>`);
    let stage = 'creds';
    $('#icGo').onclick = async () => {
      const go = $('#icGo'); go.disabled = true; $('#icErr').textContent = '';
      try {
        if (stage === 'creds') {
          go.textContent = 'Signing in…';
          const r = await cloudCall('icloudStart', { id, appleId: $('#icId').value.trim(), password: $('#icPw').value });
          if (r.needCode) { stage = 'code'; $('#icCodeWrap').classList.remove('hidden'); $('#icCode').focus(); go.textContent = 'Confirm code'; go.disabled = false; return; }
        } else {
          go.textContent = 'Checking…';
          const r = await cloudCall('icloudCode', { id, code: $('#icCode').value });
          if (r.needCode) { $('#icErr').textContent = 'Enter the new code'; go.textContent = 'Confirm code'; go.disabled = false; return; }
        }
        closeSheet(); toast(label + ' connected', 'ok'); loadCloud();
      } catch (e) { $('#icErr').textContent = e.message; go.disabled = false; go.textContent = stage === 'code' ? 'Confirm code' : 'Continue'; }
    };
    return;
  }
  sheet(`<div class="sheet-h"><h3>Connect ${esc(label)}</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b">
    <ol class="steps"><li><b>Sign in.</b> Press the button — a new tab opens.<br><button class="btn primary sm" id="oaOpen" style="margin-top:8px">${ico('open')}Sign in to ${esc(label)}</button></li>
    <li><b>Allow access.</b> After you press Allow, the tab shows <b>“This site can’t be reached”</b> (127.0.0.1). <b>That is normal.</b></li>
    <li><b>Copy that tab's address</b> (it starts with <code>http://127.0.0.1:53682/</code>) and paste it here:<input id="oaUrl" placeholder="http://127.0.0.1:53682/?state=…&code=…" style="margin-top:8px"></li></ol>
    <p class="form-err" id="oaErr"></p></div>
    <div class="sheet-f"><button class="btn" data-close>Cancel</button><button class="btn primary" id="oaDone" disabled>Finish</button></div>`);
  const open = $('#oaOpen'), win = window.open('about:blank', '_blank');
  open.disabled = true; open.lastChild.textContent = 'Preparing sign-in…';
  try {
    const r = await cloudCall('connectStart', { id });
    if (win) { win.location = r.authUrl; } else open.onclick = () => window.open(r.authUrl, '_blank');
    open.onclick = () => window.open(r.authUrl, '_blank'); open.disabled = false; open.lastChild.textContent = 'Open sign-in again';
    $('#oaDone').disabled = false;
  } catch (e) { if (win) win.close(); $('#oaErr').textContent = e.message; }
  $('#oaDone').onclick = async () => {
    const b = $('#oaDone'); b.disabled = true; b.textContent = 'Connecting…'; $('#oaErr').textContent = '';
    try { await cloudCall('connectFinish', { id, url: $('#oaUrl').value }); closeSheet(); toast(label + ' connected', 'ok'); loadCloud(); }
    catch (e) { $('#oaErr').textContent = e.message; b.disabled = false; b.textContent = 'Finish'; }
  };
}
function gphotosGuide() {
  const g = S.cb.accounts.find(a => a.id === 'gdrive'), on = g && g.connected, gp = S.cb.accounts.find(a => a.id === 'gphotos');
  sheet(`<div class="sheet-h"><h3>Back up Google Photos</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b">
    <div class="note">Since March 2025 Google lets no app read your whole Photos library directly. The official way is <b>Google Takeout</b>: Google packs your photos into your Google Drive every 2 months, and Pryme downloads and unpacks them automatically.</div>
    <ol class="steps">
      <li><b>Connect Google Drive.</b> ${on ? '<span class="ok-txt">● Connected</span>' : `<br><button class="btn primary sm" id="gpDrive" style="margin-top:8px">Connect Google Drive</button>`}</li>
      <li><b>Open Google Takeout</b> with the same Google account.<br><a class="btn sm" href="https://takeout.google.com/" target="_blank" rel="noopener" style="margin-top:8px">${ico('open')}Open takeout.google.com</a></li>
      <li>Press <b>Deselect all</b>, then tick only <b>Google Photos</b>. Want only some albums? Press <b>All photo albums included</b> under it and tick just those albums. → <b>Next step</b>.</li>
      <li>Set <b>Transfer to: Add to Drive</b> · <b>Frequency: Export every 2 months for 1 year</b> · <b>File type: .zip</b> · <b>Size: 50 GB</b> → <b>Create export</b>.</li>
      <li>Google emails you when it is ready (a few hours to a day). Then press <b>Back up</b> on the Google Photos card here (or let the schedule run). Pryme unpacks the photos into <code>Cloud Backup/Google Photos</code>, album by album, and skips exports it already imported.</li>
    </ol>
    <p class="muted small">Tip: after Pryme has imported an export you can delete the <b>Takeout</b> files from Google Drive to free space.</p></div>
    <div class="sheet-f"><button class="btn" data-close>Close</button>${on ? `<button class="btn primary" id="gpNew">${ico('cloud')}Set up backup</button>` : ''}</div>`);
  const d = $('#gpDrive'); if (d) d.onclick = () => { closeSheet(); connectAcc('gdrive'); };
  const n = $('#gpNew'); if (n) n.onclick = () => { closeSheet(); const ex = S.cb.jobs.find(j => j.remote === 'gphotos'); jobWizard(ex || { remote: 'gphotos', name: 'Google Photos' }); };
}
async function jobWizard(job) {
  const c = S.cb, conn = c.accounts.filter(a => a.connected);
  const j = { name: '', items: [], drive: c.drives[0], schedule: 'daily', hour: 2, ...job };
  if (!j.drive && !c.drives.length) return toast('Add a drive to the server first', 'err');
  const sel = new Map(j.items.map(i => [i.path, i]));
  let cur = '';
  sheet(`<div class="sheet-h"><h3>${job.id ? 'Edit backup' : 'New backup'}</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b">
    <div class="form-row"><label class="field"><span>Account</span><select id="wzAcc">${conn.map(a => `<option value="${a.id}" ${a.id === j.remote ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
    <label class="field"><span>Name</span><input id="wzName" value="${esc(j.name)}" placeholder="e.g. My photos"></label></div>
    <div id="wzPick"><span class="lbl">Choose what to back up — tick folders or files, click a folder to open it</span>
    <nav class="crumbs" id="wzCrumbs" style="margin-top:8px"></nav>
    <div class="pick-list" id="wzList"></div>
    <div class="chips" id="wzChips"></div></div>
    <div class="note hidden" id="wzTk" style="margin:12px 0">Google Photos comes in through <b>Google Takeout</b>, so you choose <b>albums</b> on the Takeout page (press <b>All photo albums included</b> → tick only the albums you want). <a href="#" id="wzTkHow">How it works</a>
      <div class="row-gap" style="margin-top:10px"><button class="btn sm primary" id="wzToDrive" type="button">${ico('files')}Pick folders &amp; photos from Google Drive</button></div></div>
    <div class="form-row"><label class="field"><span>Save on drive</span><select id="wzDrive">${c.drives.map(d => `<option ${d === j.drive ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
    <label class="field"><span>When</span><select id="wzWhen"><option value="daily">Every day</option><option value="weekly">Every week</option><option value="manual">Only when I press Run</option></select></label></div>
    <label class="field" id="wzHourWrap"><span>Time (if the server is off then, it runs as soon as it is on)</span><select id="wzHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === j.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
    <p class="form-err" id="wzErr"></p></div>
    <div class="sheet-f"><button class="btn" data-close>Cancel</button><button class="btn" id="wzSave">Save</button><button class="btn primary" id="wzSaveRun">Save &amp; run now</button></div>`);
  $('#wzWhen').value = j.schedule; $('#wzHourWrap').classList.toggle('hidden', j.schedule === 'manual');
  $('#wzWhen').onchange = () => $('#wzHourWrap').classList.toggle('hidden', $('#wzWhen').value === 'manual');
  const chips = () => { $('#wzChips').innerHTML = sel.size ? [...sel.values()].map(i => `<span>${i.dir ? '📁' : '📄'} ${esc(i.path || 'Everything')}</span>`).join('') : '<span class="muted small" style="background:none">Nothing selected yet</span>'; };
  async function open(p) {
    cur = p; const parts = p ? p.split('/') : [];
    $('#wzCrumbs').innerHTML = [`<button data-p="">${esc(conn.find(a => a.id === $('#wzAcc').value).label)}</button>`].concat(parts.map((x, i) => `<i>›</i><button data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(x)}</button>`)).join('');
    $$('#wzCrumbs button').forEach(b => (b.onclick = () => open(b.dataset.p)));
    $('#wzList').innerHTML = `<div class="fempty" style="padding:30px"><div class="spinner" style="margin:0 auto;border-color:var(--border2);border-top-color:var(--accent)"></div></div>`;
    let r; try { r = await cloudCall('browse', { id: $('#wzAcc').value, path: p }); } catch (e) { $('#wzList').innerHTML = `<div class="fempty" style="padding:24px"><b>${esc(e.message)}</b></div>`; return; }
    const rows = (p === '' ? [{ name: '(Everything in this account)', dir: true, all: true }] : []).concat(r.items);
    $('#wzList').innerHTML = rows.length ? rows.map((i, n) => { const fp = i.all ? '' : (p ? p + '/' : '') + i.name; return `<div class="pick" data-n="${n}" data-p="${esc(fp)}" data-dir="${i.dir ? 1 : 0}"><input type="checkbox" ${sel.has(fp) ? 'checked' : ''}>${fileIcon({ name: i.name, dir: i.dir })}<span>${esc(i.name)}</span><small>${i.dir ? (i.all ? '' : 'Open ›') : fmtBytes(i.size)}</small></div>`; }).join('') : `<div class="fempty" style="padding:24px">Empty folder</div>`;
    $$('#wzList .pick').forEach(row => {
      const fp = row.dataset.p, dir = row.dataset.dir === '1';
      $('input', row).onclick = ev => { ev.stopPropagation(); ev.target.checked ? sel.set(fp, { path: fp, dir }) : sel.delete(fp); chips(); };
      row.onclick = () => { if (dir && fp !== '' ) open(fp); else { const cb = $('input', row); cb.checked = !cb.checked; cb.checked ? sel.set(fp, { path: fp, dir }) : sel.delete(fp); chips(); } };
    });
  }
  const tk = () => $('#wzAcc').value === 'gphotos';
  const mode = () => { $('#wzPick').classList.toggle('hidden', tk()); $('#wzTk').classList.toggle('hidden', !tk()); if (!tk()) open(cur); };
  $('#wzTkHow').onclick = ev => { ev.preventDefault(); gphotosGuide(); };
  $('#wzToDrive').onclick = () => { if (!conn.some(a => a.id === 'gdrive')) return toast('Connect Google Drive first', 'err'); $('#wzAcc').value = 'gdrive'; if ($('#wzName').value === 'Google Photos') $('#wzName').value = ''; $('#wzAcc').onchange(); };
  $('#wzAcc').onchange = () => { sel.clear(); chips(); cur = ''; mode(); };
  const save = async runNow => {
    $('#wzErr').textContent = '';
    try {
      await cloudCall('jobSave', { runNow, job: { id: job.id, remote: $('#wzAcc').value, name: $('#wzName').value.trim(), items: tk() ? [{ path: 'Takeout', dir: true }] : [...sel.values()], drive: $('#wzDrive').value, schedule: $('#wzWhen').value, hour: Number($('#wzHour').value) } });
      closeSheet(); toast(runNow ? 'Backup saved — running now' : 'Backup saved', 'ok'); loadCloud();
    } catch (e) { $('#wzErr').textContent = e.message; }
  };
  $('#wzSave').onclick = () => save(false); $('#wzSaveRun').onclick = () => save(true);
  chips(); if (tk()) mode(); else open('');
}

/* ---------------- mobile "More" menu ---------------- */
const MORE_TABS = ['live', 'trash', 'transfers', 'settings'];
$('#moreBtn').onclick = () => {
  const items = MORE_TABS.filter(t => !$(`#nav [data-tab=${t}]`).classList.contains('hidden')).map(t => {
    const b = $(`#nav [data-tab=${t}]`), use = b.querySelector('use').getAttribute('href');
    return `<button class="more-item${S.tab === t ? ' on' : ''}" data-go="${t}"><svg><use href="${use}"/></svg><span>${esc(TITLES[t][0])}</span></button>`;
  }).join('');
  const dark = document.documentElement.dataset.theme === 'dark';
  sheet(`<div class="sheet-h"><h3>More</h3><button class="icon-btn" data-close>${ico('x')}</button></div><div class="sheet-b"><div class="more-grid">${items}
    <button class="more-item" data-act="theme"><svg><use href="#i-${dark ? 'sun' : 'moon'}"/></svg><span>${dark ? 'Light mode' : 'Dark mode'}</span></button>
    <button class="more-item danger" data-act="logout"><svg><use href="#i-logout"/></svg><span>Sign out</span></button></div></div>`);
  $$('[data-go]', $('#sheetCard')).forEach(b => (b.onclick = () => { closeSheet(); setTab(b.dataset.go); }));
  $('[data-act=theme]', $('#sheetCard')).onclick = () => { closeSheet(); $('#themeBtn').click(); };
  $('[data-act=logout]', $('#sheetCard')).onclick = () => { closeSheet(); $('#logoutBtn').click(); };
};

/* ---------------- start ---------------- */
setInterval(() => { if (S.st && S.st.loggedIn) { if (S.phase === 'booting') renderStatus(); if (S.tab === 'settings') renderSettings(); } if (!S.st || !S.st.configured) { if (!$('#setupForm').classList.contains('hidden')) renderDisc(); } }, 1000);
renderUploads();
refreshState();
