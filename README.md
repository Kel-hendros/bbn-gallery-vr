# Buenos Aires by Night — Galería VR

Galería inmersiva WebXR de los PNJs de la campaña de rol *Buenos Aires by Night*.
Los retratos flotan en un salón nocturno (panorama 360° de Buenos Aires) y, al
mirarlos fijo, se despliega una ficha con su información. Pensada para **Meta Quest 3**.

## Cómo verla en el Quest 3

Está deployada en GitHub Pages (HTTPS, que WebXR necesita). En el **Meta Browser
del Quest**, entrá a la URL de Pages del repo y tocá **"Enter VR"**.

> WebXR **no** funciona "desde la PC" con un Quest en Mac: no existe Oculus/Meta
> Link para macOS. El VR corre nativo en el navegador del propio Quest, por eso
> hace falta servir por HTTPS (lo que da GitHub Pages gratis).

### Controles
- **Joystick izquierdo:** moverse · **Joystick derecho:** girar en snaps de 45°
- **Mirar fijo 1,5 s** (gaze dwell) o **botón A:** abre la ficha · **botón B:** la cierra
- **Manos (hand tracking):** soltá los controles y mostrá las manos; **cerrá el
  puño** y te salen garras de acero estilo Wolverine. Abrí la mano para guardarlas.
- **Sin visor (escritorio, para testear):** arrastrar para mirar, **WASD** para moverse

## Estructura

```
bbn-gallery-vr/
├── migrate.js            ← genera docs/assets/personajes.json (corre 1 vez, local)
├── data/personajes/      ← copias locales de los .md (NO se publican; .gitignore)
└── docs/                 ← el sitio estático que publica GitHub Pages
    ├── index.html
    ├── main.js · scene.js · personaje-card.js · xr-controller.js · hand-claws.js
    └── assets/
        ├── personajes.json
        └── img/          ← retratos + panorama 360
```

## Actualizar los personajes

Los datos vienen del vault de Obsidian, pero el sitio es **estático**: se migra
una vez y queda horneado (no toca el vault en runtime).

1. Copiá al proyecto los `.md` de PNJs (en `data/personajes/`) y sus retratos
   (en `docs/assets/img/`). El vault nunca se modifica, solo se duplica.
2. `npm install` (una vez) y `node migrate.js` → regenera `personajes.json`.
3. `git add -A && git commit && git push` → Pages se actualiza solo.

### Frontmatter que lee el migrador (tolerante a variaciones)
- **nombre** ← nombre del archivo
- **clan** ← `Subcategoria` (Cainitas) o `Criatura` (otras criaturas)
- **generacion** ← `Generacion` (opcional)
- **status** ← `Status` (opcional) · **descripcion** ← `Descripcion`
- **imagen** ← `Retrato` (acepta notación Obsidian `[[archivo.png]]`)

## Stack
Three.js r169 (WebXR, vía importmap, sin build) · `gray-matter` para el frontmatter.

## Testeo local con HTTPS (opcional)
`node serve-https.js` levanta un server HTTPS con cert auto-firmado (en `certs/`,
generá uno con `openssl`). Útil para probar en el Quest por WiFi sin deployar.
