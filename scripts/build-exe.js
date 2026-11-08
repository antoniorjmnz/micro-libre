// Genera dist/micro-libre.exe: un único ejecutable con Node y las páginas dentro (Node SEA).
// Uso: npm run build
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const build = path.join(dist, 'build');
fs.mkdirSync(build, { recursive: true });

// 1. Un solo archivo JS: SEA no permite require() de archivos locales.
const cert = fs.readFileSync(path.join(root, 'src', 'cert.js'), 'utf8');
let server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8').replace(/^#!.*\n/, '');
const needle = "require('./cert')";
if (!server.includes(needle)) throw new Error('No encuentro require(./cert) en server.js');
server = server.replace(needle, '__certModule');
const bundle = `'use strict';\nconst __certModule = (function () { const module = { exports: {} }; const exports = module.exports;\n${cert}\nreturn module.exports; })();\n${server}`;
fs.writeFileSync(path.join(build, 'bundle.js'), bundle);

// 2. Configuración SEA con las páginas como recursos.
const assets = {};
for (const f of fs.readdirSync(path.join(root, 'public'))) assets[f] = path.join(root, 'public', f);
const blob = path.join(build, 'sea-prep.blob');
fs.writeFileSync(path.join(build, 'sea-config.json'), JSON.stringify({
  main: path.join(build, 'bundle.js'),
  output: blob,
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets,
}, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(build, 'sea-config.json')], { stdio: 'inherit' });

// 3. Copia de node.exe + inyección del blob.
const exe = path.join(dist, 'micro-libre.exe');
fs.copyFileSync(process.execPath, exe);
const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });

console.log(`\nListo: ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
