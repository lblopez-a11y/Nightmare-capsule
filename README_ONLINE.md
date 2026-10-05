# CAPSULE: NIGHTMARE ONLINE v1.10

## Jugar con un amigo desde otra casa

Esta build sirve la página y el servidor WebSocket desde el mismo proceso. Si el campo **SERVIDOR ONLINE** queda vacío, el cliente usa automáticamente el mismo dominio. Por eso vos y tu amigo pueden abrir el mismo enlace público y aparecer en la misma partida.

### Local
```bash
npm install
npm start
```
Abrí `http://localhost:3000`.

### Internet con Render
1. Subí esta carpeta a un repositorio GitHub.
2. En Render elegí **New → Web Service** y conectá el repositorio.
3. Build Command: `npm install`.
4. Start Command: `npm start`.
5. Health Check Path: `/health`.
6. Deploy. Render te dará una URL HTTPS.
7. Vos y tu amigo abren esa misma URL. Dejen el servidor vacío y pongan nombres distintos.

Render admite WebSockets públicos en Web Services. Para una página HTTPS, el cliente usa `wss://` automáticamente.

## Balance aplicado
- Ronda 1: 3 caminantes.
- Ronda 2: 4 caminantes + 1 corredor.
- Ronda 3: 5 caminantes + 2 corredores + 1 tanque.
- Tiradores desde ronda 5.
- Tiradores: 6 de daño, preferencia 18 m, mínimo 8 m.
- 38% de tiros con error fuerte y dispersión en todos los tiros.
- Reacción de 1.25–2.25 s.
- No disparan a través de paredes/coberturas del salón.
- Protección inicial de 6 s al reaparecer o comenzar una oleada, para que no te saquen vida instantáneamente al entrar.
