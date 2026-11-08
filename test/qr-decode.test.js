'use strict';
// Decodifica los QR generados con un lector independiente del codificador:
// comprueba bits de formato (valores de la tabla del estándar), síndromes Reed-Solomon y el texto.
const test = require('node:test');
const assert = require('node:assert');
const QR = require('../public/qr');

const ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

// GF(256) con tablas exp/log (implementación distinta a la del codificador).
const EXP = new Array(512); const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function syndromesZero(block, eccLen) {
  for (let i = 0; i < eccLen; i++) {
    let s = 0;
    for (const c of block) s = mul(s, EXP[i]) ^ c;
    if (s !== 0) return false;
  }
  return true;
}

function functionMask(ver, size) {
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8);
  mark(6, 0, 1, size); mark(0, 6, size, 1);
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6]; for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (const a of pos) for (const b of pos) {
      if ((a === 6 && b === 6) || (a === 6 && b === size - 7) || (a === size - 7 && b === 6)) continue;
      mark(a - 2, b - 2, 5, 5);
    }
  }
  if (ver >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }
  return f;
}

function decode({ size, modules }) {
  const ver = (size - 17) / 4;
  // Formato: primera copia, del bit 14 al 0 siguiendo el estándar.
  const coords = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  let fmt = 0;
  coords.forEach(([x, y], i) => { if (modules[y][x]) fmt |= 1 << i; });
  const fmt2 = (() => { let v = 0; for (let i = 0; i < 8; i++) if (modules[8][size - 1 - i]) v |= 1 << i; for (let i = 8; i < 15; i++) if (modules[size - 15 + i][8]) v |= 1 << i; return v; })();
  const fn = functionMask(ver, size);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y][x]) bits.push(modules[y][x] !== ((x + y) % 2 === 0));
    }
  }
  const total = Math.floor(bits.length / 8);
  const cw = []; for (let i = 0; i < total; i++) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]; cw.push(b); }
  const nb = BLOCKS[ver], ecc = ECC[ver];
  const numShort = nb - (total % nb), shortData = Math.floor(total / nb) - ecc;
  const blocks = Array.from({ length: nb }, (_, i) => ({ data: [], ecc: [], dlen: shortData + (i < numShort ? 0 : 1) }));
  let k = 0;
  for (let i = 0; i < shortData + 1; i++) for (const b of blocks) if (i < b.dlen) b.data.push(cw[k++]);
  for (let i = 0; i < ecc; i++) for (const b of blocks) b.ecc.push(cw[k++]);
  const rsOk = blocks.every((b) => syndromesZero([...b.data, ...b.ecc], ecc));
  const data = blocks.flatMap((b) => b.data);
  const bitStr = data.map((b) => b.toString(2).padStart(8, '0')).join('');
  const mode = parseInt(bitStr.slice(0, 4), 2);
  const ccBits = ver <= 9 ? 8 : 16;
  const n = parseInt(bitStr.slice(4, 4 + ccBits), 2);
  const bytes = []; for (let i = 0; i < n; i++) bytes.push(parseInt(bitStr.slice(4 + ccBits + i * 8, 12 + ccBits + i * 8), 2));
  return { fmt, fmt2, rsOk, mode, text: Buffer.from(bytes).toString('utf8') };
}

const SAMPLES = [
  'hola',
  'https://192.168.1.22:47801/?k=3fed677186aba2b2',
  'https://10.0.0.5:47801/?k=0123456789abcdef0123456789abcdef',
  'ñandú 🎤 ' + 'x'.repeat(60),
  'y'.repeat(150), // fuerza versión 7+ con bloques de distinto tamaño
];

for (const s of SAMPLES) {
  test(`QR se decodifica: ${s.slice(0, 30)}…`, () => {
    const q = QR.encode(s);
    const d = decode(q);
    // Tabla del estándar: nivel M, máscara 0 → 101010000010010
    assert.equal(d.fmt, 0b101010000010010, 'bits de formato (copia 1)');
    assert.equal(d.fmt2, 0b101010000010010, 'bits de formato (copia 2)');
    assert.ok(d.rsOk, 'síndromes Reed-Solomon a cero');
    assert.equal(d.mode, 0b0100);
    assert.equal(d.text, s);
  });
}

test('información de versión 7 según el estándar', () => {
  const q = QR.encode('y'.repeat(150));
  const ver = (q.size - 17) / 4;
  assert.ok(ver >= 7);
  if (ver === 7) {
    let v = 0;
    for (let i = 0; i < 18; i++) if (q.modules[Math.floor(i / 3)][q.size - 11 + (i % 3)]) v |= 1 << i;
    assert.equal(v, 0b000111110010010100);
  }
});
