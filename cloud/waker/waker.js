#!/usr/bin/env node
/*
 * Pryme Waker — run on any device at home that is always on (old Android phone with Termux, Raspberry Pi, Linux/Mac/Windows PC).
 * It stays connected to Pryme Cloud and sends the Wake-on-LAN signal when you press "Power On" — from anywhere.
 *   node pryme-waker.js            (first run asks for your Pryme username & password)
 *   node pryme-waker.js --pair     (pair again)
 * Zero dependencies.
 */
'use strict';
const https = require('https'), http = require('http'), dgram = require('dgram'), fs = require('fs'), path = require('path'), os = require('os'), readline = require('readline');
const DEFAULT_URL = '__PRYME_URL__';
const CFG = path.join(os.homedir(), '.pryme-waker.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch {}
const save = () => fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function post(url, body, headers = {}, timeout = 100000) {
  return new Promise((ok, bad) => {
    const u = new URL(url), data = Buffer.from(JSON.stringify(body || {}));
    const r = (u.protocol === 'https:' ? https : http).request(u, { method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers } }, res => {
      const ch = []; res.on('data', d => ch.push(d));
      res.on('end', () => { let d = {}; try { d = JSON.parse(Buffer.concat(ch).toString()); } catch {} if (res.statusCode < 300) ok(d); else bad(Object.assign(new Error(d.error || 'HTTP ' + res.statusCode), { status: res.statusCode })); });
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', bad); r.end(data);
  });
}
let rl = null; const lines = [], waiters = [];
function ask(q) {
  if (!rl) { rl = readline.createInterface({ input: process.stdin }); rl.on('line', l => { const w = waiters.shift(); if (w) w(l.trim()); else lines.push(l.trim()); }); }
  process.stdout.write(q);
  return new Promise(r => (lines.length ? r(lines.shift()) : waiters.push(r)));
}
async function pair() {
  console.log('== Pryme Waker setup ==');
  const def = /^https?:\/\//.test(DEFAULT_URL) ? DEFAULT_URL : '';
  let url = (await ask(`Pryme Cloud URL${def ? ` [${def}]` : ''}: `)) || def;
  url = url.replace(/\/+$/, '');
  const username = await ask('Pryme username: ');
  const password = await ask('Pryme password: ');
  console.log('Connecting… (the first time Render may need ~1 minute to wake up)');
  const r = await post(url + '/waker/pair', { username, password, name: os.hostname() }, {}, 120000);
  cfg = { url, token: r.token, mac: r.mac || cfg.mac || null }; save();
  console.log('✓ Paired. Keep this device on and connected to home Wi-Fi.');
  if (rl) { rl.close(); rl = null; }
}
function broadcasts() {
  const out = new Set(['255.255.255.255']);
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || []) {
    if (a.family !== 'IPv4' && a.family !== 4) continue; if (a.internal) continue;
    const ip = a.address.split('.').map(Number), m = a.netmask.split('.').map(Number);
    out.add(ip.map((v, i) => (v & m[i]) | (~m[i] & 255)).join('.'));
  }
  return [...out];
}
function wake(mac, extra) {
  const hex = String(mac || '').replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return log('No server MAC known yet — turn the server on once.');
  const m = Buffer.from(hex, 'hex'), pkt = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) m.copy(pkt, 6 + i * 6);
  const targets = [...new Set([...broadcasts(), ...(extra || []).filter(Boolean)])];
  const s = dgram.createSocket('udp4');
  s.bind(() => {
    s.setBroadcast(true); let n = 0;
    const fire = () => { for (const t of targets) for (const port of [9, 7]) s.send(pkt, port, t, () => {}); };
    fire(); const iv = setInterval(() => { fire(); if (++n >= 6) { clearInterval(iv); setTimeout(() => s.close(), 300); } }, 500);
  });
  log('⚡ Wake signal sent to', hex.match(/../g).join(':'), '→', targets.join(', '));
}
(async () => {
  if (!cfg.token || process.argv.includes('--pair')) {
    for (;;) { try { await pair(); break; } catch (e) { console.log('✗', e.message, '— try again.'); } }
  }
  log('Pryme Waker running →', cfg.url, '(Ctrl+C to stop)');
  let connected = false;
  for (;;) {
    try {
      const r = await post(cfg.url + '/waker/poll', { name: os.hostname(), mac: cfg.mac }, { 'x-waker-token': cfg.token });
      if (!connected) { log('✓ Connected to Pryme Cloud'); connected = true; }
      if (r.mac && r.mac !== cfg.mac) { cfg.mac = r.mac; save(); }
      for (const c of r.cmds || []) if (c.op === 'wake') wake(c.mac || cfg.mac, [c.bcast]);
    } catch (e) {
      if (e.status === 401) { console.log('✗ Not paired any more. Run: node pryme-waker.js --pair'); process.exit(1); }
      if (connected) log('Connection lost, retrying…', e.message); connected = false;
      await sleep(5000);
    }
  }
})();
