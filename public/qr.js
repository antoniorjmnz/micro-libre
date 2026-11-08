// Generador de códigos QR mínimo (modo byte, corrección M, versiones 1–10).
// Sin dependencias. Basado en el estándar ISO/IEC 18004.
(function (global) {
  'use strict';

  // Índice = versión. Nivel M.
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const ECL_FORMAT_BITS = 0; // M

  const getBit = (x, i) => ((x >>> i) & 1) !== 0;

  function rawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }

  function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ r.shift();
      r.push(0);
      divisor.forEach((coef, i) => { r[i] ^= gfMul(coef, factor); });
    }
    return r;
  }

  function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 10; ver++) {
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error('Texto demasiado largo para el QR');

    // Flujo de bits
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    const capacity = dataCodewords(ver) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    // Corrección de errores e intercalado
    const numBlocks = NUM_BLOCKS[ver];
    const eccLen = ECC_PER_BLOCK[ver];
    const rawCodewords = Math.floor(rawDataModules(ver) / 8);
    const numShort = numBlocks - (rawCodewords % numBlocks);
    const shortLen = Math.floor(rawCodewords / numBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((blk, j) => {
        if (i !== shortLen - eccLen || j >= numShort) codewords.push(blk[i]);
      });
    }

    // Matriz
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }

    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    const al = alignmentPositions(ver, size);
    for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
      const last = al.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    const drawFormat = (mask) => {
      const d = (ECL_FORMAT_BITS << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, getBit(f, i));
      setFn(8, 7, getBit(f, 6));
      setFn(8, 8, getBit(f, 7));
      setFn(7, 8, getBit(f, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(f, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(f, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(f, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0); // reserva las zonas de formato

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = getBit(v, i);
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        setFn(a, b, bit); setFn(b, a, bit);
      }
    }

    // Datos en zigzag
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < codewords.length * 8) {
            mod[y][x] = getBit(codewords[bi >>> 3], 7 - (bi & 7));
            bi++;
          }
        }
      }
    }

    // Máscara 0 ((x + y) % 2 == 0): cualquier máscara es válida para los lectores.
    const MASK = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!fn[y][x] && (x + y) % 2 === 0) mod[y][x] = !mod[y][x];
    }
    drawFormat(MASK);

    return { size, modules: mod };
  }

  // Devuelve un <svg> como texto. Usa colores fijos (negro sobre blanco) para que
  // la cámara lo lea siempre, también en modo oscuro.
  function toSvg(text, border = 4) {
    const { size, modules } = encode(text);
    let d = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (modules[y][x]) d += `M${x + border},${y + border}h1v1h-1z`;
    }
    const total = size + border * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="Código QR">` +
      `<rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = { encode, toSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.QR = api;
})(typeof window !== 'undefined' ? window : globalThis);
