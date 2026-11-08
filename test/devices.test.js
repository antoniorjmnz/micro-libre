'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickOutput, cableIsSystemDefault } = require('../public/devices');

// Así lista Chrome/Edge las salidas en Windows: primero los alias, luego los dispositivos reales.
const cableDefault = [
  { deviceId: 'default', label: 'Predeterminado - CABLE Input (VB-Audio Virtual Cable)' },
  { deviceId: 'communications', label: 'Comunicaciones - CABLE Input (VB-Audio Virtual Cable)' },
  { deviceId: 'hp1', label: 'Auriculares (USB Audio)' },
  { deviceId: 'cab', label: 'CABLE Input (VB-Audio Virtual Cable)' },
];
const headphonesDefault = [
  { deviceId: 'default', label: 'Predeterminado - Auriculares (USB Audio)' },
  { deviceId: 'communications', label: 'Comunicaciones - Auriculares (USB Audio)' },
  { deviceId: 'hp1', label: 'Auriculares (USB Audio)' },
  { deviceId: 'cab', label: 'CABLE Input (VB-Audio Virtual Cable)' },
];

test('elige el CABLE Input real aunque el alias "Predeterminado" también diga CABLE', () => {
  assert.equal(pickOutput(cableDefault, null), 'cab');
});

test('sigue en el cable cuando Windows pasa la salida a los cascos', () => {
  assert.equal(pickOutput(headphonesDefault, null), 'cab');
});

test('corrige un "default" guardado por la versión 0.1.0', () => {
  assert.equal(pickOutput(headphonesDefault, 'default'), 'cab');
  assert.equal(pickOutput(headphonesDefault, 'communications'), 'cab');
});

test('respeta una salida real elegida a mano', () => {
  assert.equal(pickOutput(headphonesDefault, 'hp1'), 'hp1');
});

test('sin VB-Cable usa una salida real', () => {
  const noCable = headphonesDefault.filter((d) => d.deviceId !== 'cab');
  assert.equal(pickOutput(noCable, null), 'hp1');
});

test('detecta cuando Windows tiene el cable como salida predeterminada', () => {
  assert.equal(cableIsSystemDefault(cableDefault), true);
  assert.equal(cableIsSystemDefault(headphonesDefault), false);
});
