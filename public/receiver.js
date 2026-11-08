// Receptor: corre en el PC. Recibe el audio del móvil por WebRTC y lo reproduce
// en el dispositivo elegido (normalmente "CABLE Input" de VB-Cable).
'use strict';

const $ = (id) => document.getElementById(id);
const out = $('out');
const mon = $('mon');
const deviceSel = $('device');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

let pc = null;
let currentStream = null;
let meterStop = null;

function setStatus(text, sub, state) {
  $('status').textContent = text;
  $('statusSub').textContent = sub || '';
  $('dot').className = 'dot' + (state ? ' ' + state : '');
}

// ---------- información y QR ----------
async function loadInfo() {
  const info = await fetch('/api/info').then((r) => r.json());
  $('version').textContent = 'v' + info.version;
  $('phoneUrl').textContent = info.phoneUrl;
  $('qr').innerHTML = QR.toSvg(info.phoneUrl);
}

// ---------- dispositivos de salida ----------
async function listOutputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audiooutput');
}

async function unlockLabels() {
  // Chrome/Edge solo muestran los nombres de las salidas tras conceder un permiso de audio.
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch { /* el usuario lo denegó: seguimos con nombres genéricos */ }
  await fillDevices();
}

async function fillDevices() {
  if (!('setSinkId' in HTMLMediaElement.prototype)) {
    deviceSel.innerHTML = '<option>Este navegador no permite elegir la salida (usa Edge o Chrome)</option>';
    deviceSel.disabled = true;
    return;
  }
  let outputs = await listOutputs();
  const hasLabels = outputs.some((d) => d.label);
  $('noLabels').classList.toggle('hidden', hasLabels);

  const saved = store.get('sinkId');
  const cable = outputs.find((d) => /CABLE Input/i.test(d.label)) || outputs.find((d) => /VB-Audio|CABLE/i.test(d.label));
  $('noCable').classList.toggle('hidden', !hasLabels || !!cable);

  deviceSel.innerHTML = '';
  outputs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || (d.deviceId === 'default' ? 'Predeterminado del sistema' : `Salida ${i + 1}`);
    deviceSel.appendChild(o);
  });
  const pick = outputs.find((d) => d.deviceId === saved) || cable || outputs[0];
  if (pick) deviceSel.value = pick.deviceId;
  await applySink();
}

async function applySink() {
  const id = deviceSel.value;
  if (!id || !out.setSinkId) return;
  try {
    await out.setSinkId(id);
    store.set('sinkId', id);
  } catch (e) {
    setStatus('No pude usar esa salida', e.message, 'err');
  }
}

deviceSel.addEventListener('change', applySink);
$('unlock').addEventListener('click', unlockLabels);
navigator.mediaDevices.addEventListener('devicechange', fillDevices);

$('monitor').checked = store.get('monitor') === '1';
$('monitor').addEventListener('change', () => {
  store.set('monitor', $('monitor').checked ? '1' : '0');
  mon.muted = !$('monitor').checked;
});

// ---------- medidor de nivel ----------
function startMeter(stream) {
  if (meterStop) meterStop();
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let raf = 0;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    $('meter').style.width = Math.min(100, Math.sqrt(peak) * 100).toFixed(1) + '%';
    raf = requestAnimationFrame(tick);
  };
  tick();
  meterStop = () => { cancelAnimationFrame(raf); ctx.close(); $('meter').style.width = '0%'; meterStop = null; };
  document.addEventListener('click', () => ctx.resume(), { once: true });
}

// ---------- WebRTC ----------
function tuneOpus(sdp) {
  // Pide al móvil Opus mono a 64 kbps con corrección de errores (FEC): mejor voz en WiFi regular.
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
  if (!m) return sdp;
  const pt = m[1];
  const want = { stereo: '0', useinbandfec: '1', maxaveragebitrate: '64000' };
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (re.test(sdp)) {
    return sdp.replace(re, (_, params) => {
      const kv = Object.fromEntries(params.split(';').filter(Boolean).map((p) => p.trim().split('=')));
      Object.assign(kv, want);
      return `a=fmtp:${pt} ` + Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(';');
    });
  }
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ` + Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';'));
}

function waitIce(conn, ms = 2500) {
  if (conn.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { conn.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
    const check = () => { if (conn.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    conn.addEventListener('icegatheringstatechange', check);
  });
}

function hangup(reason) {
  if (pc) { pc.close(); pc = null; }
  if (meterStop) meterStop();
  out.srcObject = null;
  mon.srcObject = null;
  currentStream = null;
  $('qrCard').classList.remove('hidden');
  setStatus('Esperando al móvil…', reason || 'Escanea el QR con la cámara del móvil. Tiene que estar en la misma WiFi.');
}

async function onOffer({ id, sdp, device }) {
  hangup();
  setStatus('Conectando…', device ? `Desde ${device}` : '', 'wait');
  const conn = new RTCPeerConnection({ iceServers: [] });
  pc = conn;

  conn.addEventListener('track', (ev) => {
    const stream = ev.streams[0] || new MediaStream([ev.track]);
    currentStream = stream;
    // Latencia mínima: que el búfer de jitter sea lo más pequeño posible.
    try { if ('jitterBufferTarget' in ev.receiver) ev.receiver.jitterBufferTarget = 0; } catch { /* no soportado */ }
    try { ev.receiver.playoutDelayHint = 0; } catch { /* no soportado */ }
    out.srcObject = stream;
    mon.srcObject = stream;
    mon.muted = !$('monitor').checked;
    applySink().then(() => out.play().catch(() => {}));
    mon.play().catch(() => {});
    startMeter(stream);
  });

  conn.addEventListener('connectionstatechange', () => {
    if (conn !== pc) return;
    const s = conn.connectionState;
    if (s === 'connected') {
      const name = deviceSel.selectedOptions[0] ? deviceSel.selectedOptions[0].textContent : 'la salida elegida';
      setStatus('Micrófono conectado', `${device || 'Móvil'} → ${name}`, 'on');
      $('qrCard').classList.add('hidden');
    } else if (s === 'failed') {
      hangup('Se perdió la conexión. ¿Siguen el móvil y el PC en la misma red?');
    } else if (s === 'disconnected') {
      setStatus('Conexión inestable…', 'Intentando recuperarla', 'wait');
    }
  });

  try {
    await conn.setRemoteDescription({ type: 'offer', sdp });
    await conn.setLocalDescription(await conn.createAnswer());
    await waitIce(conn);
    await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, sdp: tuneOpus(conn.localDescription.sdp) }),
    });
  } catch (e) {
    await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, error: e.message }),
    }).catch(() => {});
    hangup('Error al negociar la conexión: ' + e.message);
  }
}

function connectEvents() {
  const es = new EventSource('/events');
  es.addEventListener('offer', (e) => onOffer(JSON.parse(e.data)));
  es.addEventListener('bye', () => { if (pc) hangup('El móvil dejó de enviar audio.'); });
  es.addEventListener('open', () => { if (!pc) setStatus('Esperando al móvil…', 'Escanea el QR con la cámara del móvil. Tiene que estar en la misma WiFi.'); });
  es.addEventListener('error', () => {
    if (!pc) setStatus('Sin conexión con micro-libre', '¿Has cerrado la consola? Vuelve a abrir micro-libre.', 'err');
  });
}

(async () => {
  try { await loadInfo(); } catch { setStatus('Sin conexión con micro-libre', 'Vuelve a abrir micro-libre.', 'err'); }
  await fillDevices().catch(() => {});
  // Si el navegador se abrió desde micro-libre, el permiso está concedido y vemos los nombres sin pedir nada.
  if ($('noLabels').classList.contains('hidden') === false) {
    const st = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
    if (st && st.state === 'granted') await fillDevices();
    else await unlockLabels();
  }
  connectEvents();
})();
