// Página del móvil: captura el micrófono y lo envía al PC por WebRTC.
'use strict';

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('k') || '';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

let pc = null;
let stream = null;
let audioCtx = null;
let raf = 0;
let wakeLock = null;
let running = false;

function setStatus(text, sub, state) {
  $('status').textContent = text;
  $('statusSub').textContent = sub || '';
  $('dot').className = 'dot' + (state ? ' ' + state : '');
}

function setButton(on) {
  running = on;
  $('toggleText').textContent = on ? 'Parar' : 'Empezar';
  $('toggle').classList.toggle('stop', on);
}

// ---------- ajustes guardados ----------
for (const id of ['ns', 'agc', 'ec']) {
  const saved = store.get(id);
  if (saved !== null) $(id).checked = saved === '1';
  $(id).addEventListener('change', async () => {
    store.set(id, $(id).checked ? '1' : '0');
    if (running) await restartCapture();
  });
}
$('mute').addEventListener('change', () => {
  if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !$('mute').checked; });
});

function constraints() {
  return {
    audio: {
      channelCount: 1,
      noiseSuppression: $('ns').checked,
      autoGainControl: $('agc').checked,
      echoCancellation: $('ec').checked,
    },
    video: false,
  };
}

// ---------- medidor ----------
function startMeter(s) {
  stopMeter();
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  const src = audioCtx.createMediaStreamSource(s);
  const an = audioCtx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    $('meter').style.width = ($('mute').checked ? 0 : Math.min(100, Math.sqrt(peak) * 100)).toFixed(1) + '%';
    raf = requestAnimationFrame(tick);
  };
  tick();
  startMeter.src = src;
}
function stopMeter() {
  cancelAnimationFrame(raf);
  if (startMeter.src) { startMeter.src.disconnect(); startMeter.src = null; }
  $('meter').style.width = '0%';
}

// ---------- pantalla encendida ----------
async function keepAwake() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* no soportado */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && !wakeLock) keepAwake();
});

// ---------- conexión ----------
function waitIce(conn, ms = 2500) {
  if (conn.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { conn.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
    const check = () => { if (conn.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    conn.addEventListener('icegatheringstatechange', check);
  });
}

async function start() {
  setButton(true);
  setStatus('Pidiendo el micrófono…', '', 'wait');
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints());
  } catch (e) {
    setButton(false);
    const denied = e.name === 'NotAllowedError';
    setStatus('Sin acceso al micrófono', denied
      ? 'Has denegado el permiso. Actívalo en los ajustes del navegador para este sitio.'
      : e.message, 'err');
    return;
  }
  stream.getAudioTracks().forEach((t) => { t.enabled = !$('mute').checked; });
  startMeter(stream);
  keepAwake();

  setStatus('Conectando con el PC…', '', 'wait');
  const conn = new RTCPeerConnection({ iceServers: [] });
  pc = conn;
  stream.getTracks().forEach((t) => conn.addTrack(t, stream));

  conn.addEventListener('connectionstatechange', () => {
    if (conn !== pc) return;
    const s = conn.connectionState;
    if (s === 'connected') setStatus('Enviando audio al PC', 'Mantén esta pantalla abierta y encendida.', 'on');
    else if (s === 'disconnected') setStatus('Conexión inestable…', 'Intentando recuperarla', 'wait');
    else if (s === 'failed') { stop(false); setStatus('Se perdió la conexión', '¿Siguen el móvil y el PC en la misma WiFi?', 'err'); }
  });

  try {
    await conn.setLocalDescription(await conn.createOffer());
    await waitIce(conn);
    const res = await fetch('/api/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: token, sdp: conn.localDescription.sdp }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
    if (conn !== pc) return;
    await conn.setRemoteDescription({ type: 'answer', sdp: body.sdp });
  } catch (e) {
    stop(false);
    setStatus('No se pudo conectar', e.message, 'err');
  }
}

async function restartCapture() {
  // Cambiar los filtros obliga a pedir otra pista; se sustituye sin renegociar.
  if (!pc) return;
  const next = await navigator.mediaDevices.getUserMedia(constraints()).catch(() => null);
  if (!next) return;
  const track = next.getAudioTracks()[0];
  track.enabled = !$('mute').checked;
  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
  if (sender) await sender.replaceTrack(track);
  stream.getTracks().forEach((t) => t.stop());
  stream = next;
  startMeter(stream);
}

function stop(notify = true) {
  setButton(false);
  if (pc) { pc.close(); pc = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  stopMeter();
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (notify) {
    fetch('/api/bye', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: token }),
      keepalive: true,
    }).catch(() => {});
    setStatus('Parado', 'Pulsa Empezar para volver a enviar audio.');
  }
}

$('toggle').addEventListener('click', () => (running ? stop() : start()));
window.addEventListener('pagehide', () => { if (running) stop(); });

// ---------- comprobaciones iniciales ----------
if (!window.isSecureContext || !navigator.mediaDevices || !window.RTCPeerConnection) {
  $('insecure').classList.remove('hidden');
  $('toggle').disabled = true;
  setStatus('No disponible', 'Hace falta HTTPS para usar el micrófono.', 'err');
} else if (!token) {
  $('noToken').classList.remove('hidden');
  $('toggle').disabled = true;
  setStatus('Sin emparejar', 'Escanea el QR del PC.', 'err');
}
