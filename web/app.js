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
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : d)) + ' ' + u[i];
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
  transfers: ['Transfers', 'Uploads and copies to this PC'], settings: ['Settings', 'Theme, folders and account'],
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
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + t));
  $('#pageTitle').textContent = TITLES[t][0]; $('#pageSub').textContent = TITLES[t][1];
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
  if (S.cloudMode) renderFast();
  if (S.serverMode && st.plug) { try { localStorage.setItem('pryme-plug', JSON.stringify(st.plug)); } catch {} }
  if (st.phase === 'online') { S.powerCmd = null; S.wakeAt = 0; S.cycleAsked = false; }
  setPhase(st.phase);
}
setInterval(refreshState, 1000);

// Parts that only make sense when the Pryme client app runs on this PC
function applyMode() {
  const sm = S.serverMode || S.cloudMode, cm = S.cloudMode;
  $('#dlDir').closest('.card').classList.toggle('hidden', sm);
  $('#unlinkBtn').classList.toggle('hidden', sm);
  $('#jobList').closest('.card').classList.toggle('hidden', sm);
  $('#plugCard').classList.toggle('hidden', cm);       // in the cloud the plug is set in Render
  $('#pwCard').classList.toggle('hidden', cm);         // cloud password = Render setting
  $('#cloudNote').classList.toggle('hidden', !cm);
  $('#cloudCard').classList.toggle('hidden', !S.serverMode && !cm);
  $('[data-tab=transfers]').classList.toggle('hidden', cm);
  document.title = cm ? 'Pryme Cloud · Server PC' : 'Pryme Server PC';
  $('#plType option[value=sonoff]').classList.toggle('hidden', sm);
  $('#plCut').closest('label').querySelector('span').textContent = sm ? 'Cut power 45s after Shut Down (needed for Power On from this page)' : 'Cut power 20s after shutdown (saves electricity)';
  $('#upList').closest('.card').querySelector('h4').lastChild.textContent = sm ? 'This device → server' : 'This PC → server';
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
  if (to === 'online') { pollStats(); if (S.tab === 'files') loadDir(S.path); }
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
  $('#sideName').textContent = srv.name || 'Server';
  $('#sideState').textContent = info.pill + (srv.ip ? ' · ' + srv.ip : '');
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
      toast('Smart plug ON — server is starting…'); setTab('live'); refreshState();
    } catch (e) {
      if (/No smart plug/i.test(e.message)) {
        const ok = await modal({ title: 'Power On with Wake-on-LAN', text: 'On your home Wi-Fi? Double-click the "Pryme Power On" file on your laptop — it wakes the server in seconds. Download it once and keep it on your Desktop. (From outside home, Power On needs a smart plug.)', ok: 'Download Power On file', cancel: 'Close' });
        if (ok) location.href = '/local/wol.bat';
        return;
      }
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
function setBar(id, pct, hot) { const el = $(id); el.style.width = Math.max(0, Math.min(100, pct || 0)) + '%'; el.classList.toggle('hot', !!hot); }
function renderStats() {
  const s = S.stats;
  if (!s) {
    ['#sCpu', '#sMem', '#sTemp', '#sNet', '#sRx', '#sTx'].forEach(i => ($(i).textContent = '—'));
    ['#bCpu', '#bMem', '#bTemp'].forEach(i => setBar(i, 0));
    $('#drives').innerHTML = `<div class="empty-sm muted">${S.phase === 'online' ? 'Loading…' : 'Turn the server on to see its drives.'}</div>`;
    return;
  }
  $('#sCpu').textContent = s.cpu + '%'; setBar('#bCpu', s.cpu, s.cpu > 85); $('#sCpuM').textContent = `${s.cpuModel} · ${s.cores} threads`;
  const mp = s.mem.total ? Math.round(s.mem.used / s.mem.total * 100) : 0;
  $('#sMem').textContent = mp + '%'; setBar('#bMem', mp, mp > 90); $('#sMemM').textContent = `${fmtBytes(s.mem.used)} of ${fmtBytes(s.mem.total)}`;
  if (s.temp != null) { $('#sTemp').textContent = s.temp + '°C'; setBar('#bTemp', s.temp, s.temp > 75); } else { $('#sTemp').textContent = 'n/a'; setBar('#bTemp', 0); }
  if (s.net) {
    $('#sNet').textContent = s.net.link ? (s.net.link >= 1000 ? s.net.link / 1000 + ' Gbps' : s.net.link + ' Mbps') : s.net.iface;
    $('#sRx').textContent = fmtRate(s.net.rx); $('#sTx').textContent = fmtRate(s.net.tx);
    $('#sNetM').textContent = `${s.net.iface} · ${s.os}`;
    $('#mLink').textContent = s.net.link ? (s.net.link >= 1000 ? s.net.link / 1000 + ' Gbps' : s.net.link + ' Mbps') : s.net.iface;
  }
  $('#mUp').textContent = fmtDur(s.uptime);
  $('#drives').innerHTML = s.drives.length ? s.drives.map(driveCard).join('')
    : `<div class="empty-sm muted">No drives yet. On the server run <code>sudo bash /opt/pryme/mount-drives.sh</code></div>`;
  bindDriveCards($('#drives'));
}
function driveCard(d) {
  const used = d.total - d.free, pct = d.total ? Math.round(used / d.total * 100) : 0;
  return `<button class="card drive" data-path="${esc(d.path)}"><div class="drive-h"><div class="drive-ic">${ico('drive')}</div><div><b>${esc(d.name)}</b><small>${fmtBytes(d.total)} total</small></div></div>
    <div class="bar"><i style="width:${pct}%" class="${pct > 90 ? 'hot' : ''}"></i></div><div class="drive-f"><span>${fmtBytes(used)} used</span><span>${fmtBytes(d.free)} free</span></div></button>`;
}
function bindDriveCards(root) { $$('.drive', root).forEach(b => (b.onclick = () => { S.path = b.dataset.path; setTab('files'); })); }

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
  if (e.dir) return `<div class="ficon" style="background:linear-gradient(135deg,#7b6cff,#22c3ee)">${ico('files')}</div>`;
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
      <input type="checkbox" ${S.sel.has(p) ? 'checked' : ''}>${fileIcon(e)}<b title="${esc(e.name)}">${esc(e.name)}</b><small>${e.dir ? 'Folder' : fmtBytes(e.size)}</small></div>`; }).join('')}</div>`;
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
    const ok = await modal({ title: `Delete ${paths.length === 1 ? '"' + paths[0].split('/').pop() + '"' : paths.length + ' items'}?`, text: 'This permanently deletes from the server. It cannot be undone.', ok: 'Delete', danger: true });
    if (!ok) return;
    try { await post('/api/delete', { paths }); toast('Deleted', 'ok'); loadDir(S.path); } catch (e) { toast(e.message, 'err'); }
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
  for (const it of items) S.uploads.unshift({ id: Math.random().toString(36).slice(2), file: it.file, name: it.name, dest, loaded: 0, total: it.file.size, status: 'queued', speed: 0 });
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
    if (x.status < 300) { u.status = 'done'; u.loaded = u.total; }
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
    const info = u.status === 'uploading' ? `${fmtBytes(u.loaded)} / ${fmtBytes(u.total)} · ${fmtRate(u.speed)}` : u.status === 'error' ? esc(u.error) : `${fmtBytes(u.total)} → ${esc(u.dest)}`;
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
  const dest = S.path, items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  async function walk(entry, prefix) {
    if (entry.isFile) { const f = await new Promise((ok, bad) => entry.file(ok, bad)); out.push({ file: f, name: prefix + f.name }); }
    else if (entry.isDirectory) {
      const r = entry.createReader();
      let batch; do { batch = await new Promise((ok, bad) => r.readEntries(ok, bad)); for (const c of batch) await walk(c, prefix + entry.name + '/'); } while (batch.length);
    }
  }
  if (items.length) { for (const it of items) await walk(it, ''); } else out.push(...[...e.dataTransfer.files].map(f => ({ file: f, name: f.name })));
  if (out.length) queueUploads(out, dest);
});

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
  renderCloudCard();
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

/* ---------------- start ---------------- */
setInterval(() => { if (S.st && S.st.loggedIn) { if (S.phase === 'booting') renderStatus(); if (S.tab === 'settings') renderSettings(); } if (!S.st || !S.st.configured) { if (!$('#setupForm').classList.contains('hidden')) renderDisc(); } }, 1000);
renderUploads();
refreshState();
