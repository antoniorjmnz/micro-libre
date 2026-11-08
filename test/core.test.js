'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { generateCert } = require('../src/cert');
const QR = require('../public/qr');

test('el certificado es X.509 válido, autofirmado y con las IPs en el SAN', () => {
  const { cert, key } = generateCert(['192.168.1.50', '10.0.0.7']);
  const x = new crypto.X509Certificate(cert);
  assert.match(x.subjectAltName, /DNS:localhost/);
  assert.match(x.subjectAltName, /IP Address:192\.168\.1\.50/);
  assert.match(x.subjectAltName, /IP Address:10\.0\.0\.7/);
  assert.ok(x.verify(x.publicKey), 'la firma debe verificarse con su propia clave');
  assert.ok(x.checkPrivateKey(crypto.createPrivateKey(key)));
  const days = (new Date(x.validTo) - new Date(x.validFrom)) / 86400000;
  assert.ok(days <= 398, 'validez corta para que iOS lo acepte');
  assert.doesNotThrow(() => tls.createSecureContext({ cert, key }));
});

test('el QR elige una versión válida y tiene los patrones de posición', () => {
  const url = 'https://192.168.100.200:47801/?k=0123456789abcdef';
  const { size, modules } = QR.encode(url);
  assert.ok(size >= 21 && size <= 57 && (size - 17) % 4 === 0);
  // Esquina superior izquierda: anillo exterior oscuro, anillo claro, centro oscuro.
  assert.equal(modules[0][0], true);
  assert.equal(modules[1][1], false);
  assert.equal(modules[3][3], true);
  // Módulo oscuro fijo
  assert.equal(modules[size - 8][8], true);
  // Patrón de temporización alterno
  for (let i = 8; i < size - 8; i++) assert.equal(modules[6][i], i % 2 === 0);
});

test('el QR rechaza textos demasiado largos', () => {
  assert.throws(() => QR.encode('x'.repeat(400)));
});
