// Elección de la salida de audio del receptor. Separado para poder probarlo.
(function (global) {
  'use strict';

  // "default" y "communications" son alias que siguen lo que Windows tenga como predeterminado:
  // si el usuario cambia la salida de Windows a sus cascos, el audio se iría a los cascos y no al cable.
  const isAlias = (d) => d.deviceId === 'default' || d.deviceId === 'communications';

  function findCable(outputs) {
    const real = outputs.filter((d) => !isAlias(d));
    return real.find((d) => /CABLE Input/i.test(d.label)) ||
      real.find((d) => /VB-Audio|CABLE/i.test(d.label)) || null;
  }

  /** Devuelve el deviceId que hay que usar. */
  function pickOutput(outputs, savedId) {
    const cable = findCable(outputs);
    const saved = outputs.find((d) => d.deviceId === savedId);
    // Un alias guardado (de una versión anterior o elegido sin querer) no vale si hay cable.
    if (saved && !(isAlias(saved) && cable)) return saved.deviceId;
    if (cable) return cable.deviceId;
    const first = outputs.find((d) => !isAlias(d)) || outputs[0];
    return first ? first.deviceId : null;
  }

  /** ¿Windows tiene el cable como salida predeterminada? Entonces el usuario no oye su PC. */
  function cableIsSystemDefault(outputs) {
    const def = outputs.find((d) => d.deviceId === 'default');
    return !!def && /CABLE|VB-Audio/i.test(def.label);
  }

  const api = { pickOutput, findCable, cableIsSystemDefault, isAlias };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Devices = api;
})(typeof window !== 'undefined' ? window : globalThis);
