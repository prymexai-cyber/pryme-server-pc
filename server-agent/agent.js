#!/usr/bin/env node
/*
 * Pryme Server PC — Server Agent
 * Runs on the server PC (Xubuntu). Zero dependencies (Node.js >= 18.15).
 * Serves the Pryme dashboard itself on the home network (http://<server-ip>) and links out to Pryme Cloud (Render).
 * - File manager API for all drives mounted under storageRoot (/srv/pryme)
 * - Power off / restart
 * - Live screen (framebuffer -> MJPEG via ffmpeg)
 * - System stats
 * - UDP beacon so clients auto-discover & auto-link (IP + MAC for Wake-on-LAN)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const { spawn, execFile } = require('child_process');

const VERSION = '3.0.0';
const CONFIG_PATH = process.env.PRYME_CONFIG || '/etc/pryme/config.json';
const BEACON_PORT = 7101;
const DRY = process.env.PRYME_DRYRUN === '1';

const hashPass = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; } }
function saveConfig(c) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------- Pryme Cloud setup */
if (process.argv.includes('--cloud')) {
  const c = loadConfig();
  if (!c) { console.error('Run install.sh first.'); process.exit(1); }
  const url = (process.argv[process.argv.indexOf('--cloud') + 1] || '').trim().replace(/\/+$/, '');
  if (url === 'off') { delete c.cloudUrl; saveConfig(c); console.log('Pryme Cloud link disabled'); process.exit(0); }
  if (!/^https?:\/\/[^\s]+$/.test(url)) { console.error('Usage: node agent.js --cloud https://your-app.onrender.com'); process.exit(1); }
  c.cloudUrl = url;
  c.cloudKey = c.cloudKey || crypto.randomBytes(24).toString('hex');
  saveConfig(c);
  console.log('PRYME_AGENT_KEY=' + c.cloudKey);
  process.exit(0);
}

/* ------------------------------------------------------------------ setup */
if (process.argv.includes('--setup')) {
  const old = loadConfig() || {};
  const user = process.env.PRYME_SET_USER || old.username;
  const pass = process.env.PRYME_SET_PASS;
  if (!user || (!pass && !old.passHash)) {
    console.error('Set PRYME_SET_USER and PRYME_SET_PASS (use install.sh).');
    process.exit(1);
  }
  const salt = pass ? crypto.randomBytes(16).toString('hex') : old.salt;
  const cfg = {
    ...old,
    id: old.id || crypto.randomUUID(),
    name: process.env.PRYME_SET_NAME || old.name || 'Pryme Server PC',
    port: old.port || 7100,
    storageRoot: process.env.PRYME_SET_ROOT || old.storageRoot || '/srv/pryme',
    username: user,
    salt,
    passHash: pass ? hashPass(pass, salt) : old.passHash,
    // New password => new key => clients must link again (safer)
    apiKey: pass ? crypto.randomBytes(32).toString('hex') : old.apiKey,
    fbdev: old.fbdev || '/dev/fb0',
    screenFps: old.screenFps || 10,
    screenWidth: old.screenWidth || 1280,
  };
  saveConfig(cfg);
  fs.mkdirSync(cfg.storageRoot, { recursive: true });
  console.log('Pryme config saved -> ' + CONFIG_PATH);
  process.exit(0);
}

const cfg = loadConfig();
if (!cfg) { console.error('No config found. Run install.sh first.'); process.exit(1); }
const ROOT = path.resolve(cfg.storageRoot);
fs.mkdirSync(ROOT, { recursive: true });

/* ---------------------------------------------------------------- network */
function netInfo() {
  const list = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) list.push({ iface, ip: a.address, mac: a.mac, netmask: a.netmask });
    }
  }
  const score = n => (/^(en|eth)/.test(n.iface) ? 3 : /^wl/.test(n.iface) ? 2 : /^(docker|br-|veth|virbr|tailscale|zt)/.test(n.iface) ? 0 : 1);
  list.sort((x, y) => score(y) - score(x));
  return list[0] || null;
}
const bcastAddr = (ip, mask) => {
  const a = ip.split('.').map(Number), m = mask.split('.').map(Number);
  return a.map((v, i) => (v & m[i]) | (~m[i] & 255)).join('.');
};

/* ----------------------------------------------------------------- beacon */
const sock = dgram.createSocket('udp4');
sock.on('error', e => console.warn('beacon:', e.message));
sock.bind(() => { sock.setBroadcast(true); beacon(); });
function beacon() {
  const n = netInfo();
  if (!n) return;
  const msg = Buffer.from(JSON.stringify({ pryme: 1, id: cfg.id, name: cfg.name, ip: n.ip, port: cfg.port, mac: n.mac, v: VERSION }));
  for (const addr of new Set([bcastAddr(n.ip, n.netmask), '255.255.255.255'])) sock.send(msg, BEACON_PORT, addr, () => {});
}
setInterval(beacon, 1000);

/* ------------------------------------------------------------------ stats */
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const v of Object.values(c.times)) total += v; idle += c.times.idle; }
  return { idle, total };
}
let cpuPrev = cpuTimes(), cpuPct = 0;
let netPrev = null, netRate = { rx: 0, tx: 0 };
function readNetBytes(iface) {
  try {
    const line = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').find(l => l.trim().startsWith(iface + ':'));
    if (!line) return null;
    const f = line.split(':')[1].trim().split(/\s+/).map(Number);
    return { rx: f[0], tx: f[8], t: Date.now() };
  } catch { return null; }
}
setInterval(() => {
  const n = cpuTimes(), dt = n.total - cpuPrev.total, di = n.idle - cpuPrev.idle;
  cpuPct = dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100))) : 0;
  cpuPrev = n;
  const ni = netInfo(), cur = ni && readNetBytes(ni.iface);
  if (cur && netPrev) {
    const s = (cur.t - netPrev.t) / 1000 || 1;
    netRate = { rx: Math.max(0, (cur.rx - netPrev.rx) / s), tx: Math.max(0, (cur.tx - netPrev.tx) / s) };
  }
  netPrev = cur;
}, 1000).unref();

function readTemp() {
  try {
    for (const h of fs.readdirSync('/sys/class/hwmon')) {
      const d = '/sys/class/hwmon/' + h;
      let name = '';
      try { name = fs.readFileSync(d + '/name', 'utf8').trim(); } catch {}
      if (['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'acpitz'].includes(name)) {
        const v = parseInt(fs.readFileSync(d + '/temp1_input', 'utf8'), 10);
        if (v) return Math.round(v / 1000);
      }
    }
  } catch {}
  try {
    const v = parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8'), 10);
    if (v) return Math.round(v / 1000);
  } catch {}
  return null;
}
let osName = 'Linux';
try { osName = (fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1] || osName; } catch {}

async function driveList() {
  const out = [];
  let ents = [];
  try { ents = await fsp.readdir(ROOT, { withFileTypes: true }); } catch {}
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = path.join(ROOT, e.name);
    let total = 0, free = 0;
    try { const s = await fsp.statfs(p); total = s.blocks * s.bsize; free = s.bavail * s.bsize; } catch {}
    out.push({ name: e.name, path: '/' + e.name, total, free });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function stats() {
  const ni = netInfo();
  let link = null;
  if (ni) { try { link = parseInt(fs.readFileSync(`/sys/class/net/${ni.iface}/speed`, 'utf8'), 10); } catch {} }
  let sys = { total: 0, free: 0 };
  try { const s = await fsp.statfs('/'); sys = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
  const cpus = os.cpus();
  return {
    name: cfg.name, hostname: os.hostname(), os: osName, kernel: os.release(), version: VERSION,
    uptime: os.uptime(), cpu: cpuPct, cpuModel: (cpus[0] && cpus[0].model || '').replace(/\s+/g, ' ').trim(),
    cores: cpus.length, load: os.loadavg(),
    mem: { total: os.totalmem(), used: os.totalmem() - os.freemem() },
    temp: readTemp(),
    net: ni ? { ip: ni.ip, mac: ni.mac, iface: ni.iface, link: link > 0 ? link : null, rx: netRate.rx, tx: netRate.tx } : null,
    system: sys,
    drives: await driveList(),
  };
}

/* ---------------------------------------------------------------- helpers */
class HttpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
function json(res, code, obj, headers = {}) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store', ...headers });
  res.end(b);
}
function readBody(req, limit = 1e6) {
  return new Promise((ok, bad) => {
    let n = 0; const ch = [];
    req.on('data', d => { n += d.length; if (n > limit) { bad(new HttpErr(413, 'Body too large')); req.destroy(); } else ch.push(d); });
    req.on('end', () => { try { ok(ch.length ? JSON.parse(Buffer.concat(ch).toString('utf8')) : {}); } catch { bad(new HttpErr(400, 'Bad JSON')); } });
    req.on('error', bad);
  });
}
// Virtual path ("/Drive1/Movies") -> real path inside ROOT. Never escapes ROOT.
function vpath(v) {
  const n = (path.posix.normalize('/' + String(v || '/')).replace(/\/+$/, '')) || '/';
  const real = n === '/' ? ROOT : path.join(ROOT, n);
  if (real !== ROOT && !real.startsWith(ROOT + path.sep)) throw new HttpErr(400, 'Bad path');
  return { v: n, real };
}
const cleanName = s => {
  s = String(s || '').trim();
  if (!s || s === '.' || s === '..' || /[\/\\\0]/.test(s)) throw new HttpErr(400, 'Invalid name');
  return s;
};
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
  json: 'application/json', html: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  zip: 'application/zip',
};
let hasZip = false;
execFile('sh', ['-c', 'command -v zip'], e => (hasZip = !e));
const mime = n => MIME[path.extname(n).slice(1).toLowerCase()] || 'application/octet-stream';

/* ------------------------------------------------------------------ files */
async function list(q) {
  const { v, real } = vpath(q.get('path'));
  const ents = await fsp.readdir(real, { withFileTypes: true });
  const items = await Promise.all(ents.filter(e => !e.name.endsWith('.pryme-part') && e.name !== '.pryme-trash').map(async e => {
    try {
      const s = await fsp.stat(path.join(real, e.name));
      return { name: e.name, dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs, hidden: e.name.startsWith('.') };
    } catch { return null; }
  }));
  const entries = items.filter(Boolean).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { path: v, entries, drives: v === '/' ? await driveList() : undefined };
}

async function download(req, res, q) {
  const { real } = vpath(q.get('path'));
  const st = await fsp.stat(real).catch(() => null);
  if (!st) throw new HttpErr(404, 'Not found');
  const name = path.basename(real);
  const asZip = st.isDirectory() && hasZip && q.get('format') !== 'tar';
  const fname = st.isDirectory() ? name + (asZip ? '.zip' : '.tar') : name;
  const disp = (q.get('inline') === '1' ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(fname);
  if (st.isDirectory()) {
    // folders stream as one archive (no compression = full speed)
    res.writeHead(200, { 'Content-Type': asZip ? 'application/zip' : 'application/x-tar', 'Content-Disposition': disp });
    const t = asZip ? spawn('zip', ['-r', '-0', '-q', '-', name, '-x', '*/.pryme-trash/*', '*.pryme-part'], { cwd: path.dirname(real) })
                    : spawn('tar', ['-C', path.dirname(real), '--exclude=.pryme-trash', '--exclude=*.pryme-part', '-cf', '-', name]);
    t.stdout.pipe(res);
    res.on('close', () => t.kill());
    return;
  }
  let start = 0, end = st.size - 1, code = 200;
  const h = { 'Content-Type': mime(name), 'Content-Disposition': disp, 'Accept-Ranges': 'bytes', 'Last-Modified': st.mtime.toUTCString() };
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (r && st.size > 0) {
    if (r[1] === '') start = Math.max(0, st.size - Number(r[2]));
    else { start = Number(r[1]); if (r[2] !== '') end = Math.min(end, Number(r[2])); }
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    code = 206; h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  h['Content-Length'] = st.size === 0 ? 0 : end - start + 1;
  res.writeHead(code, h);
  if (st.size === 0 || req.method === 'HEAD') return res.end();
  const s = fs.createReadStream(real, { start, end, highWaterMark: 1 << 20 });
  s.pipe(res);
  s.on('error', () => res.destroy());
  res.on('close', () => s.destroy());
}

async function walk(q) {
  const { v, real } = vpath(q.get('path'));
  const st = await fsp.stat(real).catch(() => null);
  if (!st) throw new HttpErr(404, 'Not found');
  const name = path.basename(real);
  if (!st.isDirectory()) return { type: 'file', name, size: st.size, files: [{ rel: name, path: v, size: st.size }], dirs: [] };
  const files = [], dirs = [name];
  let total = 0;
  async function rec(dReal, dV, rel) {
    const ents = await fsp.readdir(dReal, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      if (e.name.endsWith('.pryme-part') || e.name === TRASH) continue;
      const r = rel + '/' + e.name, pv = (dV === '/' ? '' : dV) + '/' + e.name, pr = path.join(dReal, e.name);
      if (e.isDirectory()) { dirs.push(r); await rec(pr, pv, r); }
      else if (e.isFile()) {
        const s = await fsp.stat(pr).catch(() => null);
        if (s) { files.push({ rel: r, path: pv, size: s.size }); total += s.size; }
      }
      if (files.length > 200000) throw new HttpErr(413, 'Too many files');
    }
  }
  await rec(real, v, name);
  return { type: 'dir', name, size: total, files, dirs };
}

async function upload(req, res, q) {
  const { real: dir } = vpath(q.get('path'));
  if (dir === ROOT) throw new HttpErr(400, 'Open a drive first, then upload');
  const parts = String(q.get('name') || '').split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some(s => s === '.' || s === '..')) throw new HttpErr(400, 'Invalid name');
  const target = path.join(dir, ...parts);
  if (!target.startsWith(ROOT + path.sep)) throw new HttpErr(400, 'Bad path');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), '.' + path.basename(target) + '.pryme-part');
  const ws = fs.createWriteStream(tmp, { highWaterMark: 1 << 20, flush: true }); // flush = fsync before the file is renamed into place (power-cut safe)
  try {
    await new Promise((ok, bad) => {
      req.pipe(ws);
      req.on('close', () => { if (!req.complete) { ws.destroy(); bad(new HttpErr(499, 'Upload cancelled')); } });
      ws.on('error', bad);
      ws.on('finish', ok);
    });
    await fsp.rename(tmp, target);
    photoCache.at = 0;
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    throw e;
  }
  json(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ power */
function power(action) {
  const cmd = action === 'restart' ? 'reboot' : 'poweroff';
  console.log('Power:', cmd);
  if (DRY) return;
  setTimeout(() => execFile('systemctl', [cmd, '--no-wall'], () => {}), 200);
}

/* -------------------------------------------- smart plug: delayed power cut */
// Before shutting down, ask the plug to switch itself OFF after N seconds (the server is off by then).
// Then "Power On" from any browser = plug ON -> BIOS (Restore on AC Power Loss = Power On) starts the PC.
function plugDelayedOff(sec = 45) {
  const p = cfg.plug;
  if (!p || !p.cutAfterShutdown || !p.ip) return Promise.resolve(false);
  const ip = p.ip;
  const url = p.type === 'shelly1' ? `http://${ip}/relay/0?turn=on&timer=${sec}`
    : p.type === 'shelly2' ? `http://${ip}/rpc/Switch.Set?id=0&on=true&toggle_after=${sec}`
    : p.type === 'tasmota' ? `http://${ip}/cm?cmnd=${encodeURIComponent(`Backlog Delay ${sec * 10}; Power Off`)}` : null;
  if (!url) return Promise.resolve(false);
  return new Promise(ok => {
    const r = http.get(url, { timeout: 3000 }, res => { res.resume(); console.log('Smart plug: power off in', sec, 's'); ok(res.statusCode < 400); });
    r.on('timeout', () => r.destroy()); r.on('error', e => { console.warn('Smart plug:', e.message); ok(false); });
  });
}

/* ----------------------------------------------------------------- screen */
const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);
const screen = { proc: null, viewers: new Set(), last: null, error: null, stopTimer: null, mode: null };

/* --- Desktop (X11) detection: Xubuntu / any Xorg desktop --- */
const DISPLAY = cfg.display || ':0';
function findXauth() {
  if (cfg.xauth && fs.existsSync(cfg.xauth)) return cfg.xauth;
  const c = [];
  for (const f of [`/var/run/lightdm/root/${DISPLAY}`, `/run/lightdm/root/${DISPLAY}`]) if (fs.existsSync(f)) c.push(f);
  const add = f => { try { c.push({ f, t: fs.statSync(f).mtimeMs }); } catch {} };
  try { for (const u of fs.readdirSync('/home')) add(`/home/${u}/.Xauthority`); } catch {}
  try { for (const u of fs.readdirSync('/run/user')) { add(`/run/user/${u}/gdm/Xauthority`); try { for (const f of fs.readdirSync(`/run/user/${u}`)) if (/^xauth_/.test(f)) add(`/run/user/${u}/${f}`); } catch {} } } catch {}
  const s = c.find(x => typeof x === 'string');
  if (s) return s;
  const objs = c.filter(x => typeof x === 'object').sort((a, b) => b.t - a.t);
  return objs[0] ? objs[0].f : null;
}
const hasX = () => cfg.screenMode !== 'console' && fs.existsSync('/tmp/.X11-unix/X' + DISPLAY.replace(/^:/, '').split('.')[0]);
function xEnv() { const e = { ...process.env, DISPLAY }; const a = findXauth(); if (a) e.XAUTHORITY = a; return e; }
let hasXdotool = null;
function checkXdotool() { return new Promise(r => execFile('sh', ['-c', 'command -v xdotool'], e => r(!e))); }
checkXdotool().then(v => (hasXdotool = v));

function startScreen() {
  clearTimeout(screen.stopTimer);
  if (screen.proc) return;
  screen.error = null;
  const fps = String(cfg.screenFps || 12), w = cfg.screenWidth || 1280;
  const out = ['-vf', `scale=${w}:-2`, '-pix_fmt', 'yuvj420p', '-q:v', '5', '-f', 'mjpeg', 'pipe:1'];
  let args, env = process.env;
  if (cfg.screenArgs) { args = cfg.screenArgs; screen.mode = 'custom'; }
  else if (hasX()) {
    screen.mode = 'desktop'; env = xEnv();
    args = ['-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '1', '-framerate', fps, '-i', DISPLAY, ...out];
  } else {
    screen.mode = 'console';
    args = ['-loglevel', 'error', '-f', 'fbdev', '-framerate', fps, '-i', cfg.fbdev || '/dev/fb0', ...out];
  }
  let p;
  try { p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], env }); }
  catch (e) { screen.error = e.message; return; }
  screen.proc = p;
  let buf = Buffer.alloc(0), errText = '';
  p.stdout.on('data', d => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    let s, e;
    while ((s = buf.indexOf(SOI)) !== -1 && (e = buf.indexOf(EOI, s + 2)) !== -1) {
      const frame = Buffer.from(buf.subarray(s, e + 2));
      buf = buf.subarray(e + 2);
      screen.last = frame;
      for (const res of screen.viewers) {
        if (res.writableLength > 3e6) continue; // slow viewer: drop frame
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame); res.write('\r\n');
      }
    }
    if (buf.length > 16e6) buf = Buffer.alloc(0);
  });
  p.stderr.on('data', d => { errText = (errText + d).slice(-500); });
  p.on('error', e => { screen.error = e.code === 'ENOENT' ? 'ffmpeg is not installed' : e.message; });
  p.on('exit', code => {
    if (screen.proc === p) screen.proc = null;
    if (code && !screen.error) screen.error = errText.trim() || 'Screen capture stopped (' + code + ')';
    for (const res of screen.viewers) res.end();
    screen.viewers.clear();
  });
}
function stopScreenSoon(ms = 4000) {
  clearTimeout(screen.stopTimer);
  screen.stopTimer = setTimeout(() => {
    if (!screen.viewers.size && screen.proc) { screen.proc.kill('SIGTERM'); screen.proc = null; }
  }, ms);
}
function streamScreen(req, res) {
  startScreen();
  if (!screen.proc) throw new HttpErr(503, screen.error || 'Screen not available');
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Connection: 'close',
  });
  screen.viewers.add(res);
  if (screen.last) { res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${screen.last.length}\r\n\r\n`); res.write(screen.last); res.write('\r\n'); }
  res.on('close', () => { screen.viewers.delete(res); if (!screen.viewers.size) stopScreenSoon(); });
}

/* ------------------------------------------- remote mouse / keyboard */
let geom = null, inputChain = Promise.resolve();
const xdo = args => new Promise((ok, bad) => execFile('xdotool', args, { env: xEnv(), timeout: 4000 }, (e, so, se) => (e ? bad(new Error((se || e.message).trim())) : ok(so))));
async function geometry() {
  if (!geom) { const [w, h] = (await xdo(['getdisplaygeometry'])).trim().split(/\s+/).map(Number); geom = { w, h }; setTimeout(() => (geom = null), 30000); }
  return geom;
}
const KEY_OK = /^[A-Za-z0-9_+]{1,40}$/;
async function runInput(events) {
  if (!hasX()) throw new HttpErr(409, 'No desktop running on the server');
  if (!hasXdotool) { hasXdotool = await checkXdotool(); if (!hasXdotool) throw new HttpErr(501, 'xdotool is not installed (sudo apt install xdotool)'); }
  const g = await geometry();
  const P = (x, y) => [String(Math.round(Math.max(0, Math.min(1, +x || 0)) * (g.w - 1))), String(Math.round(Math.max(0, Math.min(1, +y || 0)) * (g.h - 1)))];
  const btn = b => String([1, 2, 3].includes(+b) ? +b : 1);
  for (const ev of events.slice(0, 60)) {
    switch (ev.t) {
      case 'move': await xdo(['mousemove', ...P(ev.x, ev.y)]); break;
      case 'down': await xdo(['mousemove', ...P(ev.x, ev.y), 'mousedown', btn(ev.b)]); break;
      case 'up': await xdo(['mousemove', ...P(ev.x, ev.y), 'mouseup', btn(ev.b)]); break;
      case 'click': await xdo(['mousemove', ...P(ev.x, ev.y), 'click', '--repeat', String(ev.n === 2 ? 2 : 1), btn(ev.b)]); break;
      case 'scroll': { const n = Math.min(10, Math.max(1, Math.abs(ev.n | 0) || 1)); await xdo(['mousemove', ...P(ev.x, ev.y), 'click', '--repeat', String(n), ev.dy < 0 ? '4' : '5']); break; }
      case 'key': if (KEY_OK.test(ev.k || '')) await xdo(['key', '--clearmodifiers', ev.k]); break;
      case 'type': if (typeof ev.s === 'string' && ev.s.length <= 200) await xdo(['type', '--delay', '0', '--', ev.s]); break;
    }
  }
}

/* ------------------------------------- built-in web dashboard (no install) */
const PUB = path.resolve(cfg.publicDir || path.join(__dirname, 'public'));
const SESS_PATH = path.join(path.dirname(CONFIG_PATH), 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESS_PATH, 'utf8')); } catch {}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const saveSessions = () => { try { fs.writeFileSync(SESS_PATH, JSON.stringify(sessions), { mode: 0o600 }); } catch {} };
const cookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
function sessionOk(req) { const t = cookies(req).pryme_sid; const e = t && sessions[sha(t)]; return !!e && e > Date.now(); }
function newSession() {
  const t = crypto.randomBytes(32).toString('hex'), now = Date.now();
  for (const [k, v] of Object.entries(sessions)) if (v < now) delete sessions[k];
  sessions[sha(t)] = now + 30 * 864e5; saveSessions();
  return `pryme_sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(res, p) {
  if (p === '/') p = '/index.html';
  const f = path.join(PUB, path.posix.normalize(p));
  if (!f.startsWith(PUB + path.sep)) return json(res, 400, { error: 'Bad path' });
  fs.readFile(f, (e, b) => {
    if (e) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(b);
  });
}
const powerState = { action: null, at: 0 };
const PLUG_TYPES = ['none', 'shelly1', 'shelly2', 'tasmota', 'custom'];
// Windows "Power On" file: double-click on any PC on the home Wi-Fi → sends the Wake-on-LAN magic packet (PowerShell is built in)
function makeWolBat(mac, bcasts, openUrl, name) {
  const m = String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (m.length !== 12) return null;
  const macTxt = m.match(/../g).join('-');
  const targets = [...new Set(['255.255.255.255', ...(bcasts || [])].filter(t => /^\d+\.\d+\.\d+\.\d+$/.test(t)))].map(t => `'${t}'`).join(',');
  const ps = `$b=[byte[]]('${macTxt}' -split '-' | %% {[Convert]::ToByte($_,16)}); $p=[byte[]]((,0xFF*6)+($b*16)); ` +
    `$u=New-Object Net.Sockets.UdpClient; $u.EnableBroadcast=$true; ` +
    `foreach($i in 1..5){ foreach($t in @(${targets})){ foreach($port in 7,9){ try{[void]$u.Send($p,$p.Length,$t,$port)}catch{} } }; Start-Sleep -Milliseconds 400 }; $u.Close()`;
  const safeName = String(name || 'Pryme Server PC').replace(/[^\w .-]/g, '');
  return ['@echo off', `title ${safeName} - Power On`, 'echo Waking ' + safeName + ' (' + macTxt + ') ...',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
    'echo Wake signal sent. The server will be online in about 30-60 seconds.',
    openUrl && /^https?:\/\/[\w.:\-\/]+$/.test(openUrl) ? `timeout /t 2 >nul & start "" "${openUrl}"` : 'timeout /t 4 >nul', ''].join('\r\n');
}
function sendWolBat(res, bat) {
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="Pryme Power On.bat"', 'Cache-Control': 'no-store' });
  res.end(bat);
}

async function localRoute(req, res, p, M) {
  if (p === '/local/state') {
    const ok = sessionOk(req), n = netInfo();
    const out = { configured: true, loggedIn: ok, mode: 'server', version: VERSION };
    if (ok) Object.assign(out, {
      user: cfg.username, online: true, activeJobs: 0, plug: cfg.plug || { type: 'none' }, cloudUrl: cfg.cloudUrl || null, cloudOk: cloudState.ok,
      server: { id: cfg.id, name: cfg.name, ip: n && n.ip, mac: n && n.mac, port: cfg.port },
      phase: powerState.action && Date.now() - powerState.at < 120000 ? (powerState.action === 'restart' ? 'restarting' : 'shutting-down') : 'online',
    });
    return json(res, 200, out);
  }
  if (p === '/local/login' && M === 'POST') {
    const b = await readBody(req);
    if (pairFails > 20) await sleep(5000);
    if (b.username === cfg.username && safeEq(hashPass(b.password || '', cfg.salt), cfg.passHash)) { pairFails = 0; return json(res, 200, { ok: true }, { 'Set-Cookie': newSession() }); }
    pairFails++; await sleep(800);
    return json(res, 401, { error: 'Wrong username or password' });
  }
  if (!sessionOk(req)) return json(res, 401, { error: 'Please sign in', login: true });
  if (p === '/local/logout' && M === 'POST') {
    const t = cookies(req).pryme_sid; if (t) { delete sessions[sha(t)]; saveSessions(); }
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'pryme_sid=; Path=/; Max-Age=0' });
  }
  if (p === '/local/wol.bat') {
    const n = netInfo();
    const bat = n && makeWolBat(n.mac, [bcastAddr(n.ip, n.netmask)], cfg.cloudUrl || agentStatus().lanUrl, cfg.name);
    if (!bat) return json(res, 500, { error: 'MAC address not found' });
    return sendWolBat(res, bat);
  }
  if (p === '/local/settings' && M === 'POST') {
    const b = await readBody(req);
    if (b.plug && typeof b.plug === 'object') {
      cfg.plug = { type: PLUG_TYPES.includes(b.plug.type) ? b.plug.type : 'none', ip: String(b.plug.ip || '').trim(),
        onUrl: String(b.plug.onUrl || '').trim(), offUrl: String(b.plug.offUrl || '').trim(), cutAfterShutdown: !!b.plug.cutAfterShutdown };
    }
    if (b.newPassword) {
      if (!safeEq(hashPass(b.oldPassword || '', cfg.salt), cfg.passHash)) return json(res, 400, { error: 'Current password is wrong' });
      if (String(b.newPassword).length < 6) return json(res, 400, { error: 'Password: min 6 characters' });
      cfg.salt = crypto.randomBytes(16).toString('hex'); cfg.passHash = hashPass(b.newPassword, cfg.salt);
    }
    saveConfig(cfg);
    return json(res, 200, { ok: true });
  }
  if (p === '/local/jobs') return json(res, 200, { jobs: [] });
  if (p === '/local/wake') return json(res, 200, { ok: true, already: true });
  return json(res, 404, { error: 'Not found' });
}

/* ------------------------------------------------ power-cut safety */
// Durable write: data reaches the disk before we continue (survives a power cut)
function writeDurable(f, data) {
  const tmp = f + '.tmp', fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
}
const STATE_DIR = process.env.PRYME_STATE_DIR || '/var/lib/pryme';
fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const BOOT_ID = (() => { try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return 'unknown'; } })();
let pstate = {};
try { pstate = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
const safety = { powercuts: Array.isArray(pstate.powercuts) ? pstate.powercuts : [], recovered: null };
// A new boot whose previous boot never shut down cleanly = power cut / hard reset
if (pstate.bootId && pstate.bootId !== BOOT_ID && pstate.clean === false) {
  const ev = { at: pstate.lastSeen || null, back: Date.now() - os.uptime() * 1000 };
  safety.powercuts.unshift(ev); safety.powercuts = safety.powercuts.slice(0, 30); safety.recovered = ev;
  console.warn('⚠ Previous shutdown was NOT clean (power cut or hard reset). Disks were auto-checked at boot.');
}
function saveState(clean) {
  try { writeDurable(STATE_FILE, JSON.stringify({ bootId: BOOT_ID, clean, lastSeen: Date.now(), powercuts: safety.powercuts })); } catch {}
}
saveState(false);
setInterval(() => saveState(false), 60000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  saveState(true);
  try { if (screen.proc) screen.proc.kill(); } catch {}
  process.exit(0);
});

const run = (cmd, args, timeout = 8000) => new Promise(ok => execFile(cmd, args, { timeout, maxBuffer: 8e6 }, (e, so) => ok(e && !so ? '' : String(so || ''))));
const readNum = f => { try { return Number(fs.readFileSync(f, 'utf8').trim()); } catch { return null; } };

/* ------------------------------------------------ disk health (SMART) */
let healthCache = { at: 0, data: null };
async function diskHealth() {
  let tree = [];
  try { tree = JSON.parse(await run('lsblk', ['-J', '-b', '-o', 'NAME,TYPE,SIZE,MODEL,TRAN,ROTA,MOUNTPOINTS'])).blockdevices || []; } catch {}
  const out = [];
  for (const d of tree) {
    if (d.type !== 'disk' || /^(loop|zram|sr|ram)/.test(d.name)) continue;
    const mounts = [];
    (function walkm(n) { for (const m of n.mountpoints || []) if (m) mounts.push(m); for (const c of n.children || []) walkm(c); })(d);
    let j = null;
    for (const extra of [[], ['-d', 'sat']]) {
      try { const t = await run('smartctl', ['-j', '-a', ...extra, '/dev/' + d.name], 15000); const p = JSON.parse(t); if (p.smart_status || p.ata_smart_attributes || p.nvme_smart_health_information_log) { j = p; break; } } catch {}
    }
    const attr = id => { const a = j && j.ata_smart_attributes && j.ata_smart_attributes.table && j.ata_smart_attributes.table.find(x => x.id === id); return a ? Number(a.raw && a.raw.value) : null; };
    const nv = j && j.nvme_smart_health_information_log;
    const realloc = attr(5), pending = attr(197);
    const passed = j && j.smart_status ? j.smart_status.passed : null;
    const status = !j ? 'unknown' : passed === false ? 'failing' : (realloc > 0 || pending > 0) ? 'warning' : 'healthy';
    out.push({
      dev: d.name, model: (j && j.model_name) || d.model || 'Disk', size: Number(d.size) || 0, usb: d.tran === 'usb', ssd: d.rota === false || d.rota === '0',
      status, temp: j && j.temperature ? j.temperature.current : null, hours: j && j.power_on_time ? j.power_on_time.hours : null,
      cycles: j ? j.power_cycle_count ?? null : null, unsafe: nv ? nv.unsafe_shutdowns : (attr(192) ?? attr(174)),
      realloc, pending, system: mounts.includes('/'), mounts,
    });
  }
  return out;
}
async function svc(name) { return (await run('systemctl', ['is-active', name], 3000)).trim() === 'active'; }
async function health() {
  if (healthCache.data && Date.now() - healthCache.at < 90000) return { ...healthCache.data, safety: safetyInfo() };
  const n = netInfo(), ip = n ? n.ip : '';
  let wol = null;
  if (n) { const t = await run('ethtool', [n.iface], 3000); const m = /Wake-on:\s*(\w+)/.exec(t.split('Supports Wake-on')[1] || t); wol = m ? m[1].includes('g') : null; }
  let backupLast = null;
  const bshow = await run('systemctl', ['show', 'pryme-backup.service', '-p', 'ExecMainExitTimestamp', '-p', 'ExecMainStatus'], 3000);
  const ts = /ExecMainExitTimestamp=(.+)/.exec(bshow); if (ts && ts[1].trim()) backupLast = { at: Date.parse(ts[1].trim().replace(/ \+?\w+$/, '')) || null, ok: /ExecMainStatus=0/.test(bshow) };
  const services = [
    { id: 'samba', name: 'Windows File Sharing', on: await svc('smbd'), url: ip ? `\\\\${ip}\\Pryme` : null },
    { id: 'smart', name: 'Disk Health Monitor', on: (await svc('smartmontools')) || (await svc('smartd')) },
    { id: 'backup', name: 'Daily Backup', on: await svc('pryme-backup.timer'), last: backupLast },
    { id: 'jellyfin', name: 'Jellyfin Media', on: await svc('jellyfin'), url: ip ? `http://${ip}:8096` : null },
    { id: 'cloud', name: 'Pryme Cloud', on: !!cloudState.ok, url: cfg.cloudUrl || null },
    { id: 'wol', name: 'Wake-on-LAN', on: wol },
    { id: 'ssh', name: 'Remote Terminal (SSH)', on: (await svc('ssh')) || (await svc('ssh.socket')) },
  ];
  healthCache = { at: Date.now(), data: { disks: await diskHealth(), services } };
  return { ...healthCache.data, safety: safetyInfo() };
}
function safetyInfo() {
  let cmd = ''; try { cmd = fs.readFileSync('/proc/cmdline', 'utf8'); } catch {}
  let mounts = []; try { mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n').map(l => l.split(' ')).filter(f => f[1] && (f[1] === '/' || f[1].startsWith(ROOT + '/'))).map(f => ({ mount: f[1].replace(/\\040/g, ' '), fs: f[2] })); } catch {}
  const journaled = mounts.filter(m => ['ext4', 'btrfs', 'xfs', 'zfs', 'f2fs'].includes(m.fs)).length;
  const checks = [
    { id: 'journal', label: 'Crash-safe file systems', ok: mounts.length > 0 && journaled === mounts.length, info: mounts.map(m => `${m.mount === '/' ? 'System' : path.basename(m.mount)}: ${m.fs}`).join(' · ') || '—' },
    { id: 'flush', label: 'Fast flush to disk (≤3 s)', ok: (readNum('/proc/sys/vm/dirty_expire_centisecs') || 3000) <= 500 },
    { id: 'fsck', label: 'Auto-repair disks after a power cut', ok: /fsck\.repair=yes/.test(cmd) },
    { id: 'atomic', label: 'Safe uploads (no half-written files)', ok: true },
    { id: 'cache', label: 'Extra-safe disk write cache', ok: fs.existsSync('/etc/systemd/system/pryme-safe-cache.service'), optional: true },
  ];
  const ok = checks.filter(c => !c.optional && c.ok).length, total = checks.filter(c => !c.optional).length;
  return { checks, score: Math.round(ok / total * 100), powercuts: safety.powercuts, recovered: safety.recovered, ups: false };
}

/* ------------------------------------------------ recycle bin */
const TRASH = '.pryme-trash';
async function dirSize(p) {
  let total = 0, n = 0;
  async function rec(d) { for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { if (++n > 100000) return; const f = path.join(d, e.name); if (e.isDirectory()) await rec(f); else { const s = await fsp.lstat(f).catch(() => null); if (s) total += s.size; } } }
  await rec(p); return total;
}
async function moveToTrash(v) {
  const { v: vp, real } = vpath(v);
  const seg = vp.split('/').filter(Boolean);
  if (seg.length < 2) throw new HttpErr(400, 'Drives cannot be deleted');
  if (seg.includes(TRASH)) return fsp.rm(real, { recursive: true, force: true });
  const st = await fsp.lstat(real);
  const tdir = path.join(ROOT, seg[0], TRASH), id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  await fsp.mkdir(path.join(tdir, id), { recursive: true });
  const size = st.isDirectory() ? await dirSize(real) : st.size;
  await fsp.rename(real, path.join(tdir, id, path.basename(real)));
  writeDurable(path.join(tdir, id + '.json'), JSON.stringify({ id, name: path.basename(real), from: vp, drive: seg[0], at: Date.now(), size, dir: st.isDirectory() }));
}
async function trashItems() {
  const items = [];
  for (const d of await driveList()) {
    const tdir = path.join(ROOT, d.name, TRASH);
    for (const f of await fsp.readdir(tdir).catch(() => [])) {
      if (!f.endsWith('.json')) continue;
      try { items.push(JSON.parse(await fsp.readFile(path.join(tdir, f), 'utf8'))); } catch {}
    }
  }
  return items.sort((a, b) => b.at - a.at);
}
async function trashRemove(it) {
  const tdir = path.join(ROOT, it.drive, TRASH);
  await fsp.rm(path.join(tdir, it.id), { recursive: true, force: true });
  await fsp.rm(path.join(tdir, it.id + '.json'), { force: true });
}
async function trashRestore(ids) {
  const all = await trashItems(); let n = 0;
  for (const it of all.filter(x => ids.includes(x.id))) {
    let { real: target } = vpath(it.from);
    if (fs.existsSync(target)) { const ext = path.extname(target); target = target.slice(0, target.length - ext.length) + ' (restored)' + ext; }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(path.join(ROOT, it.drive, TRASH, it.id, it.name), target);
    await trashRemove(it); n++;
  }
  return { ok: true, restored: n };
}
async function trashEmpty(ids) {
  const all = await trashItems(); let n = 0;
  for (const it of all.filter(x => !ids || ids.includes(x.id))) { await trashRemove(it); n++; }
  return { ok: true, deleted: n };
}
// Items older than 30 days are removed automatically
setInterval(async () => { const old = (await trashItems()).filter(i => Date.now() - i.at > 30 * 864e5).map(i => i.id); if (old.length) trashEmpty(old); }, 6 * 3600e3).unref();

/* ------------------------------------------------ photos */
const IMG_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;
let photoCache = { key: '', at: 0, data: null };
async function photos(b) {
  const { v, real } = vpath(b.path || '/');
  if (photoCache.key === v && Date.now() - photoCache.at < 60000) return photoCache.data;
  const out = []; let seen = 0;
  async function rec(dReal, dV) {
    for (const e of await fsp.readdir(dReal, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || ++seen > 300000 || out.length >= 5000) continue;
      const pr = path.join(dReal, e.name), pv = (dV === '/' ? '' : dV) + '/' + e.name;
      if (e.isDirectory()) await rec(pr, pv);
      else if (IMG_RE.test(e.name)) { const s = await fsp.stat(pr).catch(() => null); if (s && s.size > 2048) out.push({ path: pv, name: e.name, size: s.size, mtime: s.mtimeMs, folder: dV }); }
    }
  }
  await rec(real, v);
  out.sort((a, b2) => b2.mtime - a.mtime);
  photoCache = { key: v, at: Date.now(), data: { path: v, photos: out, total: out.length } };
  return photoCache.data;
}
const THUMB_DIR = path.join(STATE_DIR, 'thumbs');
fs.mkdirSync(THUMB_DIR, { recursive: true });
let thumbBusy = 0; const thumbWait = [];
const thumbSlot = () => new Promise(r => { if (thumbBusy < 2) { thumbBusy++; r(); } else thumbWait.push(r); });
const thumbDone = () => { const n = thumbWait.shift(); if (n) n(); else thumbBusy--; };
async function thumb(req, res, q) {
  const { real } = vpath(q.get('path'));
  const st = await fsp.stat(real).catch(() => null);
  if (!st || !st.isFile()) throw new HttpErr(404, 'Not found');
  const w = Math.min(800, Math.max(64, Number(q.get('w')) || 360));
  const key = crypto.createHash('sha1').update(real + '|' + st.mtimeMs + '|' + w).digest('hex');
  const out = path.join(THUMB_DIR, key.slice(0, 2), key + '.jpg');
  if (!fs.existsSync(out)) {
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await thumbSlot();
    try {
      await new Promise(ok => execFile('ffmpeg', ['-loglevel', 'error', '-y', '-i', real, '-vf', `scale='min(${w},iw)':-2`, '-frames:v', '1', '-q:v', '5', out + '.tmp.jpg'], { timeout: 20000 }, () => ok()));
      if (fs.existsSync(out + '.tmp.jpg')) fs.renameSync(out + '.tmp.jpg', out);
    } finally { thumbDone(); }
  }
  if (!fs.existsSync(out)) { res.writeHead(302, { Location: '/api/download?inline=1&path=' + encodeURIComponent(q.get('path')) }); return res.end(); }
  const buf = await fsp.readFile(out);
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=86400' });
  res.end(buf);
}

/* --------------------------------------- operations (LAN + Pryme Cloud) */
const OPS = {
  async mkdir(b) {
    const { real } = vpath(b.path);
    if (real === ROOT) throw new HttpErr(400, 'Open a drive first');
    await fsp.mkdir(path.join(real, cleanName(b.name)));
    return { ok: true };
  },
  async rename(b) {
    const { v, real } = vpath(b.path);
    if (v.split('/').length <= 2) throw new HttpErr(400, 'Drives cannot be renamed here');
    const to = path.join(path.dirname(real), cleanName(b.newName));
    if (fs.existsSync(to)) throw new HttpErr(409, 'A file with that name already exists');
    await fsp.rename(real, to);
    return { ok: true };
  },
  async delete(b) {
    const paths = Array.isArray(b.paths) ? b.paths : [];
    for (const x of paths) {
      const { v, real } = vpath(x);
      if (v.split('/').length <= 2) throw new HttpErr(400, 'Drives cannot be deleted');
      if (b.permanent) await fsp.rm(real, { recursive: true, force: true });
      else await moveToTrash(v);
    }
    photoCache.at = 0;
    return { ok: true, deleted: paths.length, trash: !b.permanent };
  },
  health: () => health(),
  trash: async () => { const items = await trashItems(); return { items, size: items.reduce((a, i) => a + (i.size || 0), 0) }; },
  trashRestore: b => trashRestore(Array.isArray(b.ids) ? b.ids : []),
  trashEmpty: b => trashEmpty(Array.isArray(b.ids) ? b.ids : null),
  photos: b => photos(b),
  async input(b) {
    const evs = Array.isArray(b.events) ? b.events : [];
    const job = inputChain.then(() => runInput(evs));
    inputChain = job.catch(() => {});
    await job;
    return { ok: true };
  },
  stats: () => stats(),
  list: b => list(new URLSearchParams({ path: b.path || '/' })),
  screenStatus: async () => ({ running: !!screen.proc, error: screen.error, hasFrame: !!screen.last, mode: hasX() ? 'desktop' : 'console', control: hasX() && hasXdotool !== false }),
  // one JPEG frame for the low-bandwidth cloud preview
  async snap() {
    startScreen(); stopScreenSoon(8000);
    const t0 = Date.now(), had = screen.last;
    while (Date.now() - t0 < 4000 && (!screen.last || (screen.last === had && Date.now() - t0 < 300))) await sleep(100);
    if (!screen.last) throw new HttpErr(503, screen.error || 'Screen not ready yet');
    return { jpeg: screen.last.toString('base64') };
  },
  async power(b) { const action = b.action === 'restart' ? 'restart' : 'shutdown'; setTimeout(() => doPower(action), 300); return { ok: true, action }; },
};
async function doPower(action) {
  powerState.action = action; powerState.at = Date.now();
  if (action === 'shutdown') await plugDelayedOff(45);
  await cloudPost('/agent/bye', { action }, 2000).catch(() => {}); // lets Pryme Cloud cut a Tuya plug afterwards
  power(action);
}

/* ------------------------------------------- Pryme Cloud link (Render) */
// The agent calls OUT to Render (no port forwarding / router setup needed).
const https = require('https');
function cloudPost(p, body, timeout) {
  return new Promise((ok, bad) => {
    if (!cfg.cloudUrl || !cfg.cloudKey) return bad(new Error('cloud off'));
    let u; try { u = new URL(p, cfg.cloudUrl); } catch (e) { return bad(e); }
    const data = Buffer.from(JSON.stringify(body || {}));
    const r = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'x-agent-key': cfg.cloudKey } }, res => {
      const ch = []; res.on('data', d => ch.push(d));
      res.on('end', () => { let d = {}; try { d = JSON.parse(Buffer.concat(ch).toString()); } catch {} res.statusCode < 300 ? ok(d) : bad(new Error(d.error || 'cloud ' + res.statusCode)); });
    });
    r.on('timeout', () => r.destroy(new Error('cloud timeout'))); r.on('error', bad);
    r.end(data);
  });
}
function agentStatus() {
  const n = netInfo(), wp = cfg.webPort === undefined ? 80 : cfg.webPort;
  const host = n ? n.ip : '';
  const bcast = n ? bcastAddr(n.ip, n.netmask) : null;
  return { id: cfg.id, name: cfg.name, version: VERSION, ip: host, mac: n && n.mac, bcast, desktop: hasX(),
    lanUrl: host ? `http://${host}${wp === 80 ? '' : ':' + (wp || cfg.port)}` : null,
    mdnsUrl: `http://${os.hostname()}.local${wp === 80 ? '' : ':' + (wp || cfg.port)}`,
    phase: powerState.action && Date.now() - powerState.at < 120000 ? (powerState.action === 'restart' ? 'restarting' : 'shutting-down') : 'online' };
}
let cloudState = { ok: false, error: null };
async function runCloudCmd(c) {
  let reply;
  try { if (!OPS[c.op]) throw new HttpErr(400, 'Unknown op'); reply = { id: c.id, ok: true, data: await OPS[c.op](c.args || {}) }; }
  catch (e) { reply = { id: c.id, ok: false, error: e.message, code: typeof e.code === 'number' ? e.code : 500 }; }
  cloudPost('/agent/reply', reply, 20000).catch(() => {});
}
async function cloudLoop() {
  if (!cfg.cloudUrl || !cfg.cloudKey) return;
  console.log('Pryme Cloud link →', cfg.cloudUrl);
  for (;;) {
    try {
      const r = await cloudPost('/agent/poll', { status: agentStatus() }, 90000); // first call may wait ~1 min while Render wakes up
      if (!cloudState.ok) console.log('Pryme Cloud: connected');
      cloudState = { ok: true, error: null };
      for (const c of r.cmds || []) runCloudCmd(c);
    } catch (e) {
      if (cloudState.ok || cloudState.error !== e.message) console.warn('Pryme Cloud:', e.message);
      cloudState = { ok: false, error: e.message };
      await sleep(5000);
    }
  }
}
setTimeout(cloudLoop, 1000);

/* ----------------------------------------------------------------- server */
let pairFails = 0;
const handler = async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = u.searchParams, p = u.pathname, M = req.method;
  try {
    if (p === '/api/ping') return json(res, 200, { ok: true, id: cfg.id, name: cfg.name, v: VERSION, uptime: os.uptime() });
    if (!p.startsWith('/api/') && !p.startsWith('/local/')) return serveStatic(res, p);
    if (p.startsWith('/local/')) return await localRoute(req, res, p, M);

    if (p === '/api/pair' && M === 'POST') {
      const b = await readBody(req);
      if (pairFails > 20) await sleep(5000);
      if (b.username === cfg.username && safeEq(hashPass(b.password || '', cfg.salt), cfg.passHash)) {
        pairFails = 0;
        const n = netInfo();
        return json(res, 200, { ok: true, apiKey: cfg.apiKey, id: cfg.id, name: cfg.name, mac: n && n.mac, ip: n && n.ip, port: cfg.port });
      }
      pairFails++; await sleep(800);
      throw new HttpErr(401, 'Wrong username or password');
    }

    if (!safeEq(req.headers['x-pryme-key'] || '', cfg.apiKey) && !sessionOk(req)) {
      if (req.headers['x-pryme-key']) throw new HttpErr(401, 'Not linked — please link this PC again');
      return json(res, 401, { error: 'Please sign in', login: true });
    }

    if (p === '/api/stats') return json(res, 200, await stats());
    if (p === '/api/health') return json(res, 200, await health());
    if (p === '/api/trash') return json(res, 200, await OPS.trash());
    if (p === '/api/photos') return json(res, 200, await photos({ path: q.get('path') || '/' }));
    if (p === '/api/thumb') return await thumb(req, res, q);
    if (p === '/api/list') return json(res, 200, await list(q));
    if (p === '/api/walk') return json(res, 200, await walk(q));
    if (p === '/api/download' && (M === 'GET' || M === 'HEAD')) return await download(req, res, q);
    if (p === '/api/upload' && M === 'PUT') return await upload(req, res, q);
    if (p === '/api/screen') return streamScreen(req, res);
    if (p === '/api/screen/snap') {
      if (!screen.last) throw new HttpErr(404, 'No frame yet');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'attachment; filename="pryme-screen.jpg"' });
      return res.end(screen.last);
    }
    if (p === '/api/screen/status') return json(res, 200, { running: !!screen.proc, error: screen.error, hasFrame: !!screen.last, mode: hasX() ? 'desktop' : 'console', control: hasX() && hasXdotool !== false });

    if (M === 'POST') {
      const b = await readBody(req);
      const op = { '/api/mkdir': 'mkdir', '/api/rename': 'rename', '/api/delete': 'delete', '/api/input': 'input', '/api/trash/restore': 'trashRestore', '/api/trash/empty': 'trashEmpty' }[p];
      if (op) return json(res, 200, await OPS[op](b));
      if (p === '/api/power') {
        const action = b.action === 'restart' ? 'restart' : 'shutdown';
        json(res, 200, { ok: true, action });
        return doPower(action);
      }
    }
    throw new HttpErr(404, 'Not found');
  } catch (e) {
    const map = { ENOENT: 404, EEXIST: 409, EACCES: 403, EPERM: 403, ENOTDIR: 400, EISDIR: 400, ENOSPC: 507, EROFS: 403 };
    const code = typeof e.code === 'number' ? e.code : map[e.code] || 500;
    const msg = e.code === 'ENOSPC' ? 'Drive is full' : e.code === 'EEXIST' ? 'Already exists' : e.code === 'ENOENT' ? 'Not found' : e.message;
    if (!res.headersSent) json(res, code >= 400 && code < 600 ? code : 500, { error: msg });
    else res.destroy();
  }
};
function startHttp(port, required) {
  const s = http.createServer(handler);
  s.keepAliveTimeout = 65000;
  s.requestTimeout = 0; // allow huge uploads
  s.on('error', e => { if (required) throw e; console.warn(`Port ${port} not available (${e.code}) — use :${cfg.port}`); });
  s.listen(port, '0.0.0.0', () => {
    const n = netInfo();
    console.log(`Pryme Server Agent v${VERSION} → http://${n ? n.ip : '0.0.0.0'}${port === 80 ? '' : ':' + port}  storage=${ROOT}${DRY ? '  [DRY RUN]' : ''}`);
  });
}
startHttp(cfg.port, true);
// Port 80 too, so laptops/phones can just type the IP (or pryme-server.local)
const webPort = cfg.webPort === undefined ? 80 : cfg.webPort;
if (webPort && webPort !== cfg.port) startHttp(webPort, false);
