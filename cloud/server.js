#!/usr/bin/env node
/*
 * Pryme Cloud — runs free on Render. Zero dependencies.
 * An always-on HTTPS page so you can reach your server from any laptop / phone, even when the server is OFF:
 *  - Login (PRYME_USERNAME / PRYME_PASSWORD)
 *  - Power ON via a smart plug's cloud (Tuya / Smart Life, Shelly Cloud) or a home-WiFi plug link
 *  - Shut down / restart, stats, file browse/rename/delete, low-bandwidth live view + mouse/keyboard,
 *    relayed to the server agent (the agent connects OUT to here — no router setup)
 *  - Big file transfers are NOT relayed (Render bandwidth is small) → "Fast mode" opens the server directly on home Wi-Fi
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2.0.0';
const E = process.env;
const PORT = Number(E.PORT) || 10000;
const USER = E.PRYME_USERNAME || '';
const PASS = E.PRYME_PASSWORD || '';
const AGENT_KEY = E.PRYME_AGENT_KEY || '';
const WEB = path.resolve(E.PRYME_WEB_DIR || path.join(__dirname, '..', 'web'));
if (!USER || PASS.length < 6 || AGENT_KEY.length < 16) console.warn('⚠️  Set PRYME_USERNAME, PRYME_PASSWORD (min 6) and PRYME_AGENT_KEY in Render → Environment.');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function json(res, code, obj, headers = {}) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store', ...headers });
  res.end(b);
}
function readBody(req, limit = 1e6) {
  return new Promise((ok, bad) => {
    const ch = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > limit) { bad(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else ch.push(d); });
    req.on('end', () => { try { ok(ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}); } catch { bad(Object.assign(new Error('Bad JSON'), { code: 400 })); } });
    req.on('error', bad);
  });
}

/* ---------------- sessions + login protection ---------------- */
// Sessions are signed (HMAC) so they survive Render restarts.
const SECRET = sha('pryme|' + AGENT_KEY + '|' + PASS);
function makeToken() { const exp = Date.now() + 30 * 864e5; const p = `${exp}.${crypto.randomBytes(8).toString('hex')}`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('hex'); }
function tokenOk(t) {
  const m = /^(\d+)\.([0-9a-f]+)\.([0-9a-f]{64})$/.exec(t || ''); if (!m) return false;
  return Number(m[1]) > Date.now() && safeEq(m[3], crypto.createHmac('sha256', SECRET).update(`${m[1]}.${m[2]}`).digest('hex'));
}
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const authed = req => tokenOk(cookies(req).pryme_cloud);
const fails = new Map();
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function blocked(ip) { const f = fails.get(ip); return f && f.n >= 8 && Date.now() - f.t < 15 * 60e3; }

/* ---------------- agent link (long-poll) ---------------- */
const agent = { last: 0, info: null, waiting: null, queue: [], pending: new Map() };
const online = () => Date.now() - agent.last < 40000 || !!agent.waiting;
function flush() {
  if (!agent.waiting || !agent.queue.length) return;
  const { res, timer } = agent.waiting; agent.waiting = null; clearTimeout(timer);
  json(res, 200, { cmds: agent.queue.splice(0) });
}
function rpc(op, args = {}, timeout = 20000) {
  if (!online()) return Promise.reject(Object.assign(new Error('Server is offline'), { code: 503 }));
  return new Promise((ok, bad) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { agent.pending.delete(id); bad(Object.assign(new Error('Server did not answer'), { code: 504 })); }, timeout);
    agent.pending.set(id, { ok, bad, timer });
    agent.queue.push({ id, op, args }); flush();
  });
}

/* ---------------- power state ---------------- */
const st = { wakeAt: 0, cmd: null, cmdAt: 0, sawOffline: false, cutTimer: null };
function phase() {
  const on = online(), now = Date.now();
  if (st.cmd) {
    if (!on) st.sawOffline = true;
    if (on && !st.sawOffline && now - st.cmdAt < 120000) return st.cmd === 'restart' ? 'restarting' : 'shutting-down';
    if (!on && st.cmd === 'restart' && now - st.cmdAt < 240000) return 'restarting';
    if (!on && st.cmd === 'shutdown' && st.sawOffline) scheduleCut();
    st.cmd = null;
  }
  if (on) { st.wakeAt = 0; const ap = agent.info && agent.info.phase; return ap && ap !== 'online' ? ap : 'online'; }
  if (st.wakeAt && now - st.wakeAt < 180000) return 'booting';
  return 'offline';
}
setInterval(phase, 1000);

/* ---------------- smart plug (cloud) ----------------
 * PLUG_TYPE = tuya | shelly-cloud | webhook | local-url | none
 *  tuya:         TUYA_ENDPOINT (e.g. https://openapi.tuyaeu.com), TUYA_CLIENT_ID, TUYA_SECRET, TUYA_DEVICE_ID, [TUYA_SWITCH_CODE=switch_1]
 *  shelly-cloud: SHELLY_SERVER (e.g. https://shelly-123-eu.shelly.cloud), SHELLY_AUTH_KEY, SHELLY_DEVICE_ID
 *  webhook:      PLUG_ON_URL, PLUG_OFF_URL   (called from Render)
 *  local-url:    PLUG_ON_URL (opened in your browser — works only on home Wi-Fi, e.g. a Shelly/Tasmota link)
 * PLUG_CUT_AFTER_SHUTDOWN=1  → switch the plug OFF ~40 s after the server has shut down
 */
const PT = (E.PLUG_TYPE || 'none').toLowerCase();
function hreq(url, { method = 'GET', headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((ok, bad) => {
    const u = new URL(url);
    const r = (u.protocol === 'https:' ? https : http).request(u, { method, headers, timeout }, res => {
      const ch = []; res.on('data', d => ch.push(d));
      res.on('end', () => { const t = Buffer.concat(ch).toString(); let d = t; try { d = JSON.parse(t); } catch {} ok({ status: res.statusCode, data: d }); });
    });
    r.on('timeout', () => r.destroy(new Error('Smart plug cloud timeout'))); r.on('error', bad);
    r.end(body);
  });
}
// Tuya OpenAPI signing (HMAC-SHA256, see developer.tuya.com "Sign requests")
let tuyaToken = { v: '', exp: 0 };
function tuyaHeaders(method, p, body, token) {
  const t = String(Date.now()), nonce = '';
  const strToSign = [method, sha(body || ''), '', p].join('\n');
  const sign = crypto.createHmac('sha256', E.TUYA_SECRET).update(E.TUYA_CLIENT_ID + (token || '') + t + nonce + strToSign).digest('hex').toUpperCase();
  const h = { client_id: E.TUYA_CLIENT_ID, sign, t, sign_method: 'HMAC-SHA256' };
  if (token) h.access_token = token;
  if (body) h['Content-Type'] = 'application/json';
  return h;
}
async function tuyaCall(method, p, bodyObj) {
  const base = (E.TUYA_ENDPOINT || 'https://openapi.tuyaeu.com').replace(/\/+$/, '');
  if (!E.TUYA_CLIENT_ID || !E.TUYA_SECRET || !E.TUYA_DEVICE_ID) throw new Error('Tuya settings missing in Render');
  if (!tuyaToken.v || Date.now() > tuyaToken.exp) {
    const tp = '/v1.0/token?grant_type=1';
    const r = await hreq(base + tp, { headers: tuyaHeaders('GET', tp, '', '') });
    if (!r.data || !r.data.success) throw new Error('Tuya login failed: ' + ((r.data && r.data.msg) || r.status));
    tuyaToken = { v: r.data.result.access_token, exp: Date.now() + (r.data.result.expire_time - 120) * 1000 };
  }
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const r = await hreq(base + p, { method, body: body || null, headers: tuyaHeaders(method, p, body, tuyaToken.v) });
  if (!r.data || !r.data.success) { if (r.data && /token/i.test(r.data.msg || '')) tuyaToken.v = ''; throw new Error('Tuya: ' + ((r.data && r.data.msg) || r.status)); }
  return r.data.result;
}
async function plug(on) {
  switch (PT) {
    case 'tuya':
      await tuyaCall('POST', `/v1.0/iot-03/devices/${encodeURIComponent(E.TUYA_DEVICE_ID)}/commands`,
        { commands: [{ code: E.TUYA_SWITCH_CODE || 'switch_1', value: !!on }] });
      return 'cloud';
    case 'shelly-cloud': {
      const base = String(E.SHELLY_SERVER || '').replace(/\/+$/, '');
      if (!base || !E.SHELLY_AUTH_KEY || !E.SHELLY_DEVICE_ID) throw new Error('Shelly Cloud settings missing in Render');
      const body = new URLSearchParams({ id: E.SHELLY_DEVICE_ID, auth_key: E.SHELLY_AUTH_KEY, channel: '0', turn: on ? 'on' : 'off' }).toString();
      const r = await hreq(base + '/device/relay/control', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.data || r.data.isok === false || r.status >= 400) throw new Error('Shelly Cloud: ' + JSON.stringify(r.data && r.data.errors || r.status));
      return 'cloud';
    }
    case 'webhook': {
      const u = on ? E.PLUG_ON_URL : E.PLUG_OFF_URL;
      if (!u) throw new Error('PLUG_ON_URL / PLUG_OFF_URL missing in Render');
      const r = await hreq(u, { method: E.PLUG_WEBHOOK_METHOD || 'GET' }); if (r.status >= 400) throw new Error('Webhook ' + r.status);
      return 'cloud';
    }
    case 'local-url': return on ? 'browser' : 'none';
    default: return 'none';
  }
}
function scheduleCut() {
  if (E.PLUG_CUT_AFTER_SHUTDOWN !== '1' || !['tuya', 'shelly-cloud', 'webhook'].includes(PT)) return;
  clearTimeout(st.cutTimer);
  st.cutTimer = setTimeout(() => { if (!online() && !st.wakeAt) plug(false).then(() => console.log('Plug OFF after shutdown'), e => console.warn(e.message)); }, 40000);
}

/* ---------------- static ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function serveStatic(res, p) {
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, path.posix.normalize(p));
  if (!f.startsWith(WEB + path.sep)) return json(res, 400, { error: 'Bad path' });
  fs.readFile(f, (e, b) => {
    if (e) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY' });
    res.end(b);
  });
}

/* ---------------- HTTP ---------------- */
const SEC = { 'Strict-Transport-Security': 'max-age=31536000' };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, M = req.method;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true });

    /* agent side */
    if (p.startsWith('/agent/')) {
      if (!AGENT_KEY || !safeEq(req.headers['x-agent-key'] || '', AGENT_KEY)) return json(res, 401, { error: 'Bad agent key' });
      const b = await readBody(req, 12e6);
      if (p === '/agent/poll') {
        agent.last = Date.now(); if (b.status) agent.info = b.status;
        if (agent.waiting) { const w = agent.waiting; agent.waiting = null; clearTimeout(w.timer); json(w.res, 200, { cmds: [] }); }
        if (agent.queue.length) return json(res, 200, { cmds: agent.queue.splice(0) });
        const timer = setTimeout(() => { if (agent.waiting && agent.waiting.res === res) { agent.waiting = null; agent.last = Date.now(); json(res, 200, { cmds: [] }); } }, 25000);
        agent.waiting = { res, timer };
        res.on('close', () => { if (agent.waiting && agent.waiting.res === res) { clearTimeout(timer); agent.waiting = null; } });
        return;
      }
      if (p === '/agent/reply') {
        agent.last = Date.now();
        const w = agent.pending.get(b.id);
        if (w) { agent.pending.delete(b.id); clearTimeout(w.timer); b.ok ? w.ok(b.data) : w.bad(Object.assign(new Error(b.error || 'Error'), { code: b.code || 500 })); }
        return json(res, 200, { ok: true });
      }
      if (p === '/agent/bye') { // server is about to power off / restart (also when started from the home dashboard)
        Object.assign(st, { cmd: b.action === 'restart' ? 'restart' : 'shutdown', cmdAt: Date.now(), sawOffline: false });
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Not found' });
    }

    if (!p.startsWith('/api/') && !p.startsWith('/local/')) return serveStatic(res, p);

    if (p === '/local/state') {
      const ok = authed(req), i = agent.info || {};
      const out = { configured: true, loggedIn: ok, mode: 'cloud', version: VERSION };
      if (ok) Object.assign(out, {
        user: USER, phase: phase(), online: online(),
        server: { name: i.name || 'Pryme Server PC', ip: i.ip, mac: i.mac, port: 80 },
        lanUrl: i.lanUrl || null, mdnsUrl: i.mdnsUrl || null, desktop: !!i.desktop,
        plugType: PT, canWake: PT !== 'none', plugCut: E.PLUG_CUT_AFTER_SHUTDOWN === '1', activeJobs: 0,
      });
      return json(res, 200, out);
    }
    if (p === '/local/login' && M === 'POST') {
      const ip = ipOf(req);
      if (blocked(ip)) return json(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
      const b = await readBody(req);
      if (USER && PASS && safeEq(b.username || '', USER) && safeEq(b.password || '', PASS)) {
        fails.delete(ip);
        return json(res, 200, { ok: true }, { ...SEC, 'Set-Cookie': `pryme_cloud=${makeToken()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}` });
      }
      const f = fails.get(ip) || { n: 0, t: Date.now() }; f.n++; f.t = Date.now(); fails.set(ip, f);
      await sleep(900);
      return json(res, 401, { error: 'Wrong username or password' });
    }
    if (!authed(req)) return json(res, 401, { error: 'Please sign in', login: true });

    if (p === '/local/logout' && M === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': 'pryme_cloud=; Path=/; Max-Age=0; Secure' });
    if (p === '/local/wake' && M === 'POST') {
      if (online()) return json(res, 200, { ok: true, already: true });
      if (PT === 'none') return json(res, 400, { error: 'No smart plug set up in Render (PLUG_TYPE)', noPlug: true });
      const how = await plug(true);
      st.wakeAt = Date.now(); st.cmd = null; clearTimeout(st.cutTimer);
      return json(res, 200, { ok: true, how, openUrl: how === 'browser' ? E.PLUG_ON_URL : undefined });
    }
    if (p === '/local/plug' && M === 'POST') {
      const b = await readBody(req);
      if (b.action === 'off' && online()) return json(res, 409, { error: 'Server is ON — shut it down first' });
      await plug(b.action !== 'off');
      if (b.action !== 'off') st.wakeAt = Date.now();
      return json(res, 200, { ok: true });
    }
    if (p === '/local/jobs') return json(res, 200, { jobs: [] });

    /* relayed to the server */
    if (p === '/api/stats') return json(res, 200, await rpc('stats'));
    if (p === '/api/list') return json(res, 200, await rpc('list', { path: u.searchParams.get('path') || '/' }));
    if (p === '/api/screen/status') return json(res, 200, await rpc('screenStatus'));
    if (p === '/api/screen/snap') {
      const d = await rpc('snap', {}, 15000);
      const img = Buffer.from(d.jpeg, 'base64');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-store',
        ...(u.searchParams.get('dl') ? { 'Content-Disposition': 'attachment; filename="pryme-screen.jpg"' } : {}) });
      return res.end(img);
    }
    if (M === 'POST') {
      const op = { '/api/mkdir': 'mkdir', '/api/rename': 'rename', '/api/delete': 'delete', '/api/input': 'input', '/api/power': 'power' }[p];
      if (op) {
        const b = await readBody(req);
        const r = await rpc(op, b);
        if (op === 'power') Object.assign(st, { cmd: r.action, cmdAt: Date.now(), sawOffline: false, wakeAt: 0 });
        return json(res, 200, r);
      }
    }
    if (['/api/download', '/api/upload', '/api/screen', '/api/walk'].includes(p))
      return json(res, 409, { error: 'Big transfers use Fast mode — open your server on home Wi-Fi', fast: true, lanUrl: agent.info && agent.info.lanUrl });
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    const code = typeof e.code === 'number' && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (!res.headersSent) json(res, code, { error: e.message }); else res.destroy();
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`Pryme Cloud v${VERSION} on :${PORT}  plug=${PT}`));
