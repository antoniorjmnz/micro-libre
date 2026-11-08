// Certificado TLS autofirmado sin dependencias: se construye el DER a mano.
// El navegador del móvil exige HTTPS para dejar usar el micrófono.
'use strict';
const crypto = require('crypto');

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);

function oid(str) {
  const parts = str.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const v of parts.slice(2)) {
    const stack = [v & 0x7f];
    let n = v >>> 7;
    while (n > 0) { stack.unshift((n & 0x7f) | 0x80); n >>>= 7; }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function utcTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

function name(cn) {
  return seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
}

function extension(id, valueDer) {
  return seq(oid(id), tlv(0x04, valueDer));
}

const toPem = (label, der) =>
  `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

/**
 * Genera un certificado para las IPs dadas (y localhost).
 * Validez de 365 días: iOS rechaza certificados de servidor de más de 825 días.
 */
function generateCert(ips, days = 365) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const serial = crypto.randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01;

  const sigAlg = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00])); // sha256WithRSA
  const now = new Date(Date.now() - 60 * 60 * 1000);
  const end = new Date(now.getTime() + days * 24 * 3600 * 1000);

  const altNames = [tlv(0x82, Buffer.from('localhost', 'ascii'))];
  for (const ip of ips) altNames.push(tlv(0x87, Buffer.from(ip.split('.').map(Number))));

  const extensions = tlv(0xa3, seq(
    extension('2.5.29.17', seq(...altNames)), // subjectAltName
    extension('2.5.29.37', seq(oid('1.3.6.1.5.5.7.3.1'))), // extKeyUsage: serverAuth
    extension('2.5.29.19', seq()), // basicConstraints: CA=false
  ));

  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([0x02]))), // versión 3
    tlv(0x02, serial),
    sigAlg,
    name('micro-libre'),
    seq(utcTime(now), utcTime(end)),
    name('micro-libre'),
    spki,
    extensions,
  );

  const signature = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, sigAlg, tlv(0x03, Buffer.from([0x00]), signature));

  return {
    cert: toPem('CERTIFICATE', cert),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    notAfter: end.toISOString(),
  };
}

module.exports = { generateCert };
