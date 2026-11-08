#!/usr/bin/env node
// micro-libre: usa el móvil como micrófono del PC. Sin anuncios, sin cuentas, sin dependencias.
//
//  - http://127.0.0.1:<puerto>      → receptor (se abre en el PC, reproduce en VB-Cable)
//  - https://<ip-lan>:<puerto+1>    → página del móvil (captura el micro y lo envía por WebRTC)
//
// El servidor solo sirve las páginas y hace de cartero de la señalización WebRTC;
// el audio va directo del móvil al navegador del PC por la red local.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { generateCert } = require('./cert');

const VERSION = '0.1.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Cuando va empaquetado como micro-libre.exe, las páginas viajan dentro del ejecutable.
let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch { /* Node normal */ }

// En el .exe la consola se cierra sola al fallar: esperamos a que el usuario lea el error.
function fail(msg) {
  console.error(`\n  ${msg}\n`);
  if (sea && process.stdin.isTTY) {
    console.error('  Pulsa Enter para cerrar.');
    process.stdin.once('data', () => process.exit(1));
    return;
  }
  process.exit(1);
}
const DATA_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'micro-libre');

// ---------- argumentos ----------
function parseArgs(argv) {
  const opts = { port: 47800, ip: null, open: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--ip') opts.ip = argv[++i];
    else if (a === '--no-open') opts.open = false;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') { console.log(VERSION); process.exit(0); }
    else { console.error(`Opción desconocida: ${a}`); opts.help = true; }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65534) {
    console.error('--port debe ser un número entre 1 y 65534'); process.exit(1);
  }
  return opts;
}

const HELP = `micro-libre ${VERSION} — el móvil como micrófono del PC

Uso: micro-libre [opciones]

  --port <n>   Puerto del receptor local (por defecto 47800). El del móvil es n+1.
  --ip <ip>    IP de la red local que se pone en el QR (por defecto, se detecta).
  --no-open    No abrir la ventana del receptor automáticamente.
  -h, --help   Muestra esta ayuda.
`;

// ---------- red ----------
const VIRTUAL_IFACE = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Tailscale|ZeroTier|Docker|vpn/i;

function lanAddresses() {
  const out = [];
  for (const [ifname, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ ifname, address: a.address, virtual: VIRTUAL_IFACE.test(ifname) });
    }
  }
  const privateScore = (ip) =>
    ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 0;
  out.sort((a, b) => (a.virtual - b.virtual) || (privateScore(b.address) - privateScore(a.address)));
  return out;
}

// ---------- certificado ----------
function loadOrCreateCert(ips) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const certFile = path.join(DATA_DIR, 'cert.pem');
  const keyFile = path.join(DATA_DIR, 'key.pem');
  const metaFile = path.join(DATA_DIR, 'cert.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const covers = ips.every((ip) => meta.ips.includes(ip));
    const fresh = new Date(meta.notAfter).getTime() - Date.now() > 14 * 24 * 3600 * 1000;
    if (covers && fresh) {
      return { cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') };
    }
  } catch { /* no hay certificado todavía */ }

  const c = generateCert(ips);
  fs.writeFileSync(certFile, c.cert);
  fs.writeFileSync(keyFile, c.key, { mode: 0o600 });
  fs.writeFileSync(metaFile, JSON.stringify({ ips, notAfter: c.notAfter }, null, 2));
  console.log('  Certificado nuevo generado (el móvil te pedirá aceptarlo otra vez).');
  return { cert: c.cert, key: c.key };
}

// ---------- token de emparejamiento ----------
// Va dentro del QR: sin él, nadie más de tu red puede meter audio en tu micrófono.
function loadOrCreateToken() {
  const file = path.join(DATA_DIR, 'token.txt');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{16,}$/.test(t)) return t;
  } catch { /* se crea abajo */ }
  const t = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
}

function tokenOk(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- HTTP utilidades ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), MIME['.json']);

function serveStatic(res, file) {
  if (sea) {
    let data;
    try { data = Buffer.from(sea.getAsset(file)); } catch { return send(res, 404, 'No encontrado'); }
    return send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  }
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, 'Prohibido');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'No encontrado');
    send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
  });
}

function readJson(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- señalización ----------
// Un receptor (la ventana del PC) escucha por Server-Sent Events.
// El móvil manda su oferta SDP por POST y espera la respuesta del receptor.
const receivers = new Set();
const pending = new Map(); // id -> { res, timer }

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of receivers) r.write(msg);
}

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': hola\n\n');
  receivers.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); receivers.delete(res); });
}

async function handleOffer(req, res, token) {
  let body;
  try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'Petición no válida' }); }
  if (!tokenOk(body.k, token)) {
    return sendJson(res, 403, { error: 'Código de emparejamiento incorrecto. Vuelve a escanear el QR del PC.' });
  }
  if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0')) {
    return sendJson(res, 400, { error: 'Oferta SDP no válida' });
  }
  if (receivers.size === 0) {
    return sendJson(res, 503, { error: 'El receptor del PC no está abierto. Abre la ventana de micro-libre en el PC.' });
  }
  const id = crypto.randomBytes(8).toString('hex');
  const timer = setTimeout(() => {
    pending.delete(id);
    sendJson(res, 504, { error: 'El PC no respondió a tiempo.' });
  }, 15000);
  pending.set(id, { res, timer });
  const ua = String(req.headers['user-agent'] || '');
  broadcast('offer', { id, sdp: body.sdp, device: describeDevice(ua) });
}

async function handleAnswer(req, res) {
  let body;
  try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'Petición no válida' }); }
  const p = pending.get(body.id);
  if (!p) return sendJson(res, 404, { error: 'Oferta caducada' });
  clearTimeout(p.timer);
  pending.delete(body.id);
  if (body.error) sendJson(p.res, 500, { error: String(body.error).slice(0, 300) });
  else sendJson(p.res, 200, { sdp: body.sdp });
  sendJson(res, 200, { ok: true });
}

async function handleBye(req, res, token) {
  let body = {};
  try { body = await readJson(req); } catch { /* da igual */ }
  if (!tokenOk(body.k, token)) return sendJson(res, 403, { error: 'No autorizado' });
  broadcast('bye', {});
  sendJson(res, 200, { ok: true });
}

function describeDevice(ua) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  if (m) return m[1].replace(/ Build.*/, '').trim();
  if (/Android/.test(ua)) return 'Android';
  return 'Móvil';
}

// ---------- abrir el receptor ----------
function findBrowser() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const rel = [
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ];
  for (const r of rel) for (const root of roots) {
    const p = path.join(root, ...r);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openReceiver(url) {
  const browser = findBrowser();
  if (!browser) {
    console.log(`  No encontré Edge ni Chrome. Abre esto en un navegador basado en Chromium: ${url}`);
    return;
  }
  // Perfil propio: no toca tu navegador habitual y permite autoaceptar el permiso
  // de audio (solo se usa para leer los nombres de las salidas, p. ej. "CABLE Input").
  const profile = path.join(DATA_DIR, 'browser-profile');
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=460,820',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];
  const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`  No pude abrir el navegador. Abre a mano: ${url}`));
  child.unref();
}

// ---------- arranque ----------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }

  const addrs = lanAddresses();
  const ip = opts.ip || (addrs[0] && addrs[0].address);
  if (!ip) return fail('No encontré ninguna red local. Conecta el PC a la misma WiFi que el móvil.');
  const certIps = [...new Set([ip, ...addrs.map((a) => a.address)])];

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const token = loadOrCreateToken();
  const { cert, key } = loadOrCreateCert(certIps);

  const localPort = opts.port;
  const phonePort = opts.port + 1;
  const phoneUrl = `https://${ip}:${phonePort}/?k=${token}`;
  const localUrl = `http://127.0.0.1:${localPort}/`;

  // Receptor: solo en 127.0.0.1, nunca expuesto a la red.
  const local = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/') return serveStatic(res, 'receiver.html');
    if (req.method === 'GET' && url.pathname === '/events') return handleEvents(req, res);
    if (req.method === 'GET' && url.pathname === '/api/info') {
      return sendJson(res, 200, { version: VERSION, phoneUrl, ip, others: addrs.map((a) => a.address) });
    }
    if (req.method === 'POST' && url.pathname === '/api/answer') return handleAnswer(req, res);
    if (req.method === 'GET' && /^\/[\w.-]+\.(js|css|svg)$/.test(url.pathname)) return serveStatic(res, url.pathname.slice(1));
    send(res, 404, 'No encontrado');
  });

  // Móvil: HTTPS en la red local.
  const phone = https.createServer({ cert, key }, (req, res) => {
    const url = new URL(req.url, 'https://x');
    if (req.method === 'GET' && url.pathname === '/') return serveStatic(res, 'phone.html');
    if (req.method === 'POST' && url.pathname === '/api/offer') return handleOffer(req, res, token);
    if (req.method === 'POST' && url.pathname === '/api/bye') return handleBye(req, res, token);
    if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') return serveStatic(res, 'manifest.webmanifest');
    if (req.method === 'GET' && /^\/[\w.-]+\.(js|css|svg)$/.test(url.pathname) && url.pathname !== '/receiver.js') {
      return serveStatic(res, url.pathname.slice(1));
    }
    send(res, 404, 'No encontrado');
  });

  const onListenError = (port) => (err) => {
    if (err.code === 'EADDRINUSE') fail(`El puerto ${port} está ocupado. ¿Ya tienes micro-libre abierto? Ciérralo o prueba con --port.`);
    else fail(err.message);
  };
  local.on('error', onListenError(localPort));
  phone.on('error', onListenError(phonePort));

  local.listen(localPort, '127.0.0.1', () => {
    phone.listen(phonePort, '0.0.0.0', () => {
      console.log(`\n  micro-libre ${VERSION}\n`);
      console.log(`  Receptor (PC):  ${localUrl}`);
      console.log(`  Móvil:          ${phoneUrl}`);
      if (addrs.length > 1) console.log(`  Otras IPs:      ${addrs.slice(1).map((a) => `${a.address} (${a.ifname})`).join(', ')}  →  usa --ip si el móvil no conecta`);
      console.log('\n  Escanea el QR de la ventana del receptor con el móvil (misma WiFi).');
      console.log('  Si Windows pregunta por el firewall, permite el acceso en redes privadas.');
      console.log('  Ctrl+C para salir.\n');
      if (opts.open) openReceiver(localUrl);
    });
  });

  const shutdown = () => { broadcast('bye', {}); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
