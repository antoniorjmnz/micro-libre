# micro-libre

**Usa el móvil como micrófono del PC por WiFi. Sin instalar app, sin anuncios, sin cuentas.**
*Use your phone as a PC microphone over WiFi. No app, no ads, no accounts.* — [English below](#english)

Alternativa open source a WO Mic, micstream y similares. El móvil abre una página web que sirve tu propio PC
(escaneando un QR), y el audio viaja por WebRTC directo del móvil al PC dentro de tu red local. Nada pasa por
servidores de terceros.

```
 Móvil (Chrome / Safari)                 PC con Windows
┌──────────────────────┐   WebRTC/Opus  ┌──────────────────────────────┐
│ página del micro     │ ─────────────▶ │ ventana receptora (Edge/Chrome)│──▶ CABLE Input ──▶ CABLE Output
│ (https://IP:47801)   │   red local    │ http://127.0.0.1:47800        │      (VB-Cable)      = micrófono
└──────────────────────┘                └──────────────────────────────┘                     en Discord/OBS/Zoom
           ▲  señalización (SDP) ── micro-libre (Node, sin dependencias) ──┘
```

## Descarga rápida

**[⬇ Descargar para Windows](https://github.com/antoniorjmnz/micro-libre/releases/latest/download/micro-libre-windows.zip)**:
descomprime el zip y abre `micro-libre.exe`. No hace falta instalar Node.
Para generar el `.exe` tú mismo: `npm install` y `npm run build` (sale en `dist/micro-libre.exe`).

## Requisitos

- Windows 10/11.
- [Node.js](https://nodejs.org) 20 o superior (solo si lo ejecutas desde el código; el `.exe` ya lo lleva dentro).
- Edge o Chrome en el PC (Edge viene con Windows).
- [VB-Cable](https://vb-audio.com/Cable/) (gratuito): es el «cable virtual» que convierte el audio en un micrófono que ven las demás apps.
- El móvil y el PC en la misma WiFi.

## Uso

1. Instala VB-Cable (ejecuta `VBCABLE_Setup_x64.exe` como administrador) y reinicia el PC si te lo pide.
2. Arranca micro-libre: doble clic en `micro-libre.cmd`, o en una terminal:
   ```bash
   node src/server.js
   ```
3. Se abre una ventana pequeña con un QR. La primera vez Windows te preguntará por el firewall:
   **permite el acceso en redes privadas**.
4. Escanea el QR con la cámara del móvil. Saldrá un aviso de «conexión no privada»: es normal, el certificado lo
   ha creado tu PC. Acepta (Android: *Configuración avanzada → Acceder*; iPhone: *Mostrar detalles → visitar este sitio web*).
5. Pulsa **Empezar** y permite el micrófono.
6. En Discord, OBS, Zoom, Teams, etc. elige **CABLE Output (VB-Audio Virtual Cable)** como micrófono.

Mantén la pantalla del móvil encendida mientras lo uses: si se bloquea, el sistema corta el micrófono.

### Opciones

```
--port <n>   Puerto del receptor local (47800 por defecto). El del móvil es n+1.
--ip <ip>    IP que se pone en el QR, si la detectada no es la de tu WiFi.
--no-open    No abrir la ventana del receptor automáticamente.
```

## Privacidad y seguridad

- El audio va del móvil al PC por la red local, cifrado (DTLS-SRTP). No hay servidores externos ni telemetría.
- El QR lleva un código de emparejamiento: sin él, otro dispositivo de tu red no puede meter audio en tu micrófono.
- El receptor solo escucha en `127.0.0.1`; hacia la red solo se expone la página HTTPS del móvil.
- Los datos (certificado, código, perfil del navegador del receptor) se guardan en `%LOCALAPPDATA%\micro-libre`.
  Borra esa carpeta para regenerarlo todo.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| El móvil no carga la página | Misma WiFi; firewall de Windows permitido para Node en redes privadas; prueba `--ip` con otra IP de las que muestra la consola. Las redes «públicas» de Windows bloquean conexiones entrantes. |
| «No veo VB-Cable» | Instálalo y reinicia micro-libre. |
| Se corta al bloquear el móvil | Es una limitación de los navegadores móviles: deja la pantalla encendida. |
| Se oye eco | Activa *Cancelación de eco* en el móvil, o usa auriculares en el PC. |
| La WiFi de invitados/hotel no conecta | Muchas aíslan a los dispositivos entre sí; no hay arreglo desde aquí. |

## Desarrollo

```bash
npm test
```

Sin dependencias: el certificado se genera con `node:crypto` (`src/cert.js`) y el QR con un codificador propio
(`public/qr.js`).

### Siguientes pasos

- Modo USB para Android con `adb reverse` (sin WiFi, menos latencia).
- Un único `.exe` con Node SEA, sin tener que instalar Node.
- Elegir la salida directamente sin VB-Cable usando un driver open source (p. ej. Scream).
- App Android nativa opcional para seguir con la pantalla apagada.
- Linux (PipeWire/PulseAudio crean micrófonos virtuales sin drivers extra) y macOS (BlackHole).

## Licencia

MIT. VB-Cable es de VB-Audio y tiene su propia licencia (donationware); micro-libre no lo incluye.

---

## English

Open source alternative to WO Mic, micstream and similar. Your phone opens a web page served by your own PC
(scan a QR), and audio goes over WebRTC straight from the phone to the PC on your local network.

**[⬇ Download for Windows](https://github.com/antoniorjmnz/micro-libre/releases/latest/download/micro-libre-windows.zip)**: unzip and run `micro-libre.exe` (no Node needed).

**Requirements:** Windows 10/11, Node.js 20+ (only when running from source), Edge or Chrome, [VB-Cable](https://vb-audio.com/Cable/) (free), phone and PC on the same WiFi.

**Usage:** install VB-Cable → run `micro-libre.cmd` (or `node src/server.js`) → allow the Windows firewall prompt on
private networks → scan the QR with your phone → accept the self-signed certificate warning → tap **Empezar** (Start) →
pick **CABLE Output** as the microphone in Discord/OBS/Zoom. Keep the phone screen on.

Audio stays on your LAN, encrypted with DTLS-SRTP. A pairing code in the QR stops other devices on your network from
sending audio. No external servers, no telemetry. Licence: MIT.
