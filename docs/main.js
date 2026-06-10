// main.js — Entry point. Renderer + WebXR, carga de datos, disposición en anillo,
// gaze dwell, controles de escritorio (fallback) y loop de animación.
import * as THREE from "three";
import { buildScene, buildDust, makeSpotlight, loadPanorama, SANGRE } from "./scene.js";
import { PersonajeCard } from "./personaje-card.js";
import { XRControls } from "./xr-controller.js";
import { WolverineClaws } from "./hand-claws.js";

const GAZE_DWELL = 1.5; // segundos mirando para abrir
const EYE_HEIGHT = 1.6;
const RING_RADIUS = 4.2;
const DEBUG = new URLSearchParams(location.search).has("debug");

let renderer, scene, camera, dolly, xrControls, dust, handClaws, debugHud, debugButton, modeButton;
let cards = [];
let raycaster, reticle, reticleFill;
let hoverCard = null, activeCard = null, dwell = 0;
let passthrough = false; // modo garras: galería oculta, se ve la habitación real
const clock = new THREE.Clock();

// Estado de controles de escritorio (fallback sin visor).
const desktop = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, keys: {} };

init();

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  // Botón de entrada propio: pide sesión AR (passthrough disponible) con
  // local-floor. VRButton/ARButton de three no sirven acá: VRButton no da
  // passthrough y ARButton fuerza referencia 'local' (sin altura de piso).
  setupXRButton();

  scene = buildScene();
  loadPanorama(scene, "assets/img/Buenos aires 360.png");

  // Cámara dentro de un dolly (el dolly se mueve; en VR el visor mueve la cámara).
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  dolly = new THREE.Group();
  dolly.position.set(0, 0, 0);
  dolly.add(camera);
  camera.position.set(0, EYE_HEIGHT, 0);
  scene.add(dolly);

  // Polvo ambiente (dentro del grupo galería: se oculta en passthrough).
  dust = buildDust(scene.userData.gallery);

  // Retícula de gaze, anclada frente a la cámara.
  buildReticle();

  raycaster = new THREE.Raycaster();

  // Controles VR.
  xrControls = new XRControls(renderer, dolly, camera);
  xrControls.onSelect = () => { if (hoverCard) openCard(hoverCard); };
  xrControls.onCancel = () => closeActive();

  // Hand tracking: al cerrar el puño surgen garras estilo Wolverine.
  handClaws = new WolverineClaws(renderer, dolly, scene);

  // HUD de diagnóstico: arranca visible si la URL trae ?debug, y se puede
  // prender/apagar en VR con el botón flotante "DEBUG".
  debugHud = buildDebugHud();
  debugButton = buildDebugButton();

  // Botón central X/Ankh: alterna entre galería y modo garras (passthrough).
  modeButton = buildModeButton();

  setupDesktopControls();
  window.addEventListener("resize", onResize);

  await loadPersonajes();

  renderer.setAnimationLoop(animate);
}

function buildReticle() {
  const ring = new THREE.RingGeometry(0.008, 0.011, 24);
  reticle = new THREE.Mesh(
    ring,
    new THREE.MeshBasicMaterial({ color: 0x6e5e3e, transparent: true, opacity: 0.7, depthTest: false })
  );
  // Anillo de progreso de dwell (se "llena" girando).
  const fillGeo = new THREE.RingGeometry(0.013, 0.02, 32, 1, 0, 0);
  reticleFill = new THREE.Mesh(
    fillGeo,
    new THREE.MeshBasicMaterial({ color: SANGRE, transparent: true, opacity: 0.9, depthTest: false })
  );
  reticle.add(reticleFill);
  reticle.position.set(0, 0, -1.2);
  reticle.renderOrder = 999;
  camera.add(reticle);
}

function setReticleProgress(p) {
  // Redibuja el anillo de relleno según progreso 0..1.
  p = Math.max(0, Math.min(1, p));
  reticleFill.geometry.dispose();
  reticleFill.geometry = new THREE.RingGeometry(0.013, 0.02, 32, 1, -Math.PI / 2, p * Math.PI * 2);
}

async function loadPersonajes() {
  let data = [];
  try {
    const res = await fetch("assets/personajes.json");
    data = await res.json();
  } catch (e) {
    console.error("No se pudo cargar personajes.json", e);
  }

  layoutCards(data);

  // Espera a que las fuentes estén listas (los paneles las usan).
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) {}
  }

  hideLoader();
}

function layoutCards(data) {
  const n = data.length;
  // Anillo alrededor del usuario. Si hay muchos, se usan dos anillos a distinta altura.
  const twoRings = n > 12;
  data.forEach((p, i) => {
    const perRing = twoRings ? Math.ceil(n / 2) : n;
    const ringIndex = twoRings && i >= perRing ? 1 : 0;
    const idxInRing = i - ringIndex * perRing;
    const countInRing = ringIndex === 0 ? perRing : n - perRing;

    // Distribuir en un arco frontal (no 360°, así el usuario los ve de frente).
    const spread = Math.min(Math.PI * 0.95, 0.6 + countInRing * 0.28);
    const a = countInRing > 1
      ? -spread / 2 + (idxInRing / (countInRing - 1)) * spread
      : 0;
    const angle = a; // 0 = frente (-Z)

    const radius = RING_RADIUS + ringIndex * 1.1;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    const y = EYE_HEIGHT + (ringIndex === 1 ? 0.25 : 0);

    const pos = new THREE.Vector3(x, y, z);
    // El frente del plano (+Z) debe apuntar al centro (origen): rotación = -angle.
    const card = new PersonajeCard(p, pos, -angle);
    scene.userData.gallery.add(card.group);
    cards.push(card);

    // Foco sobre cada retrato.
    const spot = makeSpotlight(pos);
    scene.userData.gallery.add(spot);
    scene.userData.gallery.add(spot.target);
  });
}

function updateGaze(dt) {
  // Rayo desde el centro de la cámara hacia adelante.
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);
  raycaster.set(origin, dir);
  raycaster.far = 12;

  // En passthrough las cards están ocultas (pero el raycaster igual las
  // golpearía): solo se pueden mirar los botones flotantes.
  const meshes = passthrough ? [] : cards.map((c) => c.portrait);
  if (modeButton) meshes.push(modeButton.mesh);
  if (debugButton) meshes.push(debugButton.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  const hit = hits.length ? hits[0].object.userData.card : null;

  if (hit !== hoverCard) {
    if (hoverCard) hoverCard.setHover(false);
    hoverCard = hit;
    if (hoverCard) hoverCard.setHover(true);
    dwell = 0;
    // Mirar a otro personaje cierra el panel activo (regla del PRD).
    if (activeCard && hit && hit !== activeCard) closeActive();
  }

  // Acumular dwell sobre el hover actual.
  if (hoverCard && hoverCard !== activeCard) {
    dwell += dt;
    setReticleProgress(Math.min(1, dwell / GAZE_DWELL));
    if (dwell >= GAZE_DWELL) openCard(hoverCard);
  } else {
    setReticleProgress(0);
  }
}

function openCard(card) {
  // Los botones flotantes no son cards: disparan su acción y listo.
  // Dwell muy negativo: no vuelven a disparar hasta sacar la mirada.
  if (card.isDebugButton) {
    toggleDebug();
    dwell = -999;
    setReticleProgress(0);
    return;
  }
  if (card.isModeButton) {
    toggleMode();
    dwell = -999;
    setReticleProgress(0);
    return;
  }
  if (activeCard && activeCard !== card) activeCard.close();
  activeCard = card;
  card.open();
  dwell = 0;
  setReticleProgress(0);
}

function closeActive() {
  if (activeCard) activeCard.close();
  activeCard = null;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = performance.now();

  if (renderer.xr.isPresenting) {
    xrControls.update(dt);
    if (handClaws) handClaws.update(dt);
  } else {
    updateDesktop(dt);
  }

  if (debugHud && debugHud.mesh.visible) debugHud.update(t);

  updateGaze(dt);
  for (const c of cards) c.update(dt, t);
  if (dust) dust.update(t);

  renderer.render(scene, camera);
}

// ---------- Controles de escritorio (fallback para testear sin visor) ----------
function setupDesktopControls() {
  const el = renderer.domElement;
  el.addEventListener("mousedown", (e) => { desktop.dragging = true; desktop.lastX = e.clientX; desktop.lastY = e.clientY; });
  window.addEventListener("mouseup", () => { desktop.dragging = false; });
  window.addEventListener("mousemove", (e) => {
    if (!desktop.dragging) return;
    desktop.yaw -= (e.clientX - desktop.lastX) * 0.004;
    desktop.pitch -= (e.clientY - desktop.lastY) * 0.004;
    desktop.pitch = Math.max(-1.2, Math.min(1.2, desktop.pitch));
    desktop.lastX = e.clientX; desktop.lastY = e.clientY;
  });
  window.addEventListener("keydown", (e) => { desktop.keys[e.code] = true; });
  window.addEventListener("keyup", (e) => { desktop.keys[e.code] = false; });
}

function updateDesktop(dt) {
  // Orientación por arrastre.
  camera.rotation.set(desktop.pitch, desktop.yaw, 0, "YXZ");

  // Movimiento WASD relativo a la mirada.
  const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const m = new THREE.Vector3();
  if (desktop.keys["KeyW"]) m.add(f);
  if (desktop.keys["KeyS"]) m.sub(f);
  if (desktop.keys["KeyD"]) m.add(r);
  if (desktop.keys["KeyA"]) m.sub(r);
  if (m.lengthSq() > 0) {
    m.normalize().multiplyScalar(2.2 * dt);
    dolly.position.add(m);
    const rad = Math.hypot(dolly.position.x, dolly.position.z);
    if (rad > 10.5) { dolly.position.x *= 10.5 / rad; dolly.position.z *= 10.5 / rad; }
  }
}

// ---------- Entrada a XR (sesión AR con passthrough disponible) ----------
function setupXRButton() {
  const btn = document.createElement("button");
  Object.assign(btn.style, {
    position: "absolute", bottom: "20px", left: "50%", transform: "translateX(-50%)",
    padding: "12px 28px", border: "1px solid #b8954b", borderRadius: "4px",
    background: "rgba(0,0,0,0.65)", color: "#d9c7a3",
    font: "bold 14px Cinzel, serif", letterSpacing: "0.12em",
    cursor: "pointer", zIndex: "11", opacity: "0.9",
  });
  btn.textContent = "…";
  document.body.appendChild(btn);

  if (!("xr" in navigator)) {
    btn.textContent = "WEBXR NO DISPONIBLE";
    btn.disabled = true;
    return;
  }

  let session = null;
  let mode = null;
  // Preferir AR (passthrough para el modo garras); si no hay, VR común.
  navigator.xr.isSessionSupported("immersive-ar")
    .then((ar) => (ar ? "immersive-ar" : navigator.xr.isSessionSupported("immersive-vr").then((vr) => (vr ? "immersive-vr" : null))))
    .then((m) => {
      mode = m;
      btn.textContent = mode ? "ENTRAR AL ARCHIVO" : "VISOR NO DETECTADO";
      btn.disabled = !mode;
    })
    .catch(() => {
      mode = "immersive-vr";
      btn.textContent = "ENTRAR AL ARCHIVO";
    });

  btn.onclick = async () => {
    if (session) { session.end(); return; }
    if (!mode) return;
    try {
      session = await navigator.xr.requestSession(mode, {
        requiredFeatures: ["local-floor"],
        optionalFeatures: ["bounded-floor", "hand-tracking"],
      });
    } catch (e) {
      console.error("No se pudo iniciar la sesión XR", e);
      return;
    }
    session.addEventListener("end", () => {
      session = null;
      btn.textContent = "ENTRAR AL ARCHIVO";
    });
    renderer.xr.setReferenceSpaceType("local-floor");
    await renderer.xr.setSession(session);
    btn.textContent = "SALIR";
  };
}

// ---------- Modo garras: passthrough sin galería ----------
function toggleMode() {
  passthrough = !passthrough;
  scene.userData.passthrough = passthrough;
  scene.userData.gallery.visible = !passthrough;

  if (passthrough) {
    // Fondo transparente: el compositor del visor muestra la cámara real.
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    closeActive();
    if (hoverCard && !hoverCard.isModeButton && !hoverCard.isDebugButton) {
      hoverCard.setHover(false);
      hoverCard = null;
    }
  } else {
    scene.background = scene.userData.panoTex || new THREE.Color(0x05030a);
    renderer.setClearColor(0x05030a, 1);
  }

  // Sin manos virtuales en passthrough: las garras salen de tus manos reales.
  if (handClaws) handClaws.setHandModelsVisible(!passthrough);
  modeButton.draw();
}

function buildModeButton() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  // Centro de la escena, a media altura, delante del anillo de retratos.
  mesh.position.set(0, 1.05, -2.0);
  scene.add(mesh);

  const btn = {
    isModeButton: true,
    mesh,
    hovered: false,
    setHover(h) {
      this.hovered = h;
      this.draw();
    },
    draw() {
      ctx.clearRect(0, 0, 256, 256);
      // Medallón circular de fondo.
      ctx.beginPath();
      ctx.arc(128, 128, 110, 0, Math.PI * 2);
      ctx.fillStyle = this.hovered ? "rgba(46, 10, 14, 0.92)" : "rgba(10, 8, 6, 0.75)";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#b8954b";
      ctx.stroke();

      ctx.lineCap = "round";
      if (!passthrough) {
        // X de tajos de garra: pasar al modo passthrough.
        ctx.strokeStyle = this.hovered ? "#c41420" : "#7a0c12";
        ctx.lineWidth = 13;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(78 + i * 26, 62);
          ctx.lineTo(126 + i * 26, 194);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(186, 74);
        ctx.lineTo(70, 182);
        ctx.stroke();
      } else {
        // Ankh: volver a la galería.
        ctx.strokeStyle = this.hovered ? "#e8c97a" : "#b8954b";
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.ellipse(128, 84, 30, 42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(128, 126);
        ctx.lineTo(128, 208);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(84, 148);
        ctx.lineTo(172, 148);
        ctx.stroke();
      }
      tex.needsUpdate = true;
    },
  };
  mesh.userData.card = btn;
  btn.draw();
  return btn;
}

// ---------- Botón flotante para prender/apagar el HUD de debug ----------
function toggleDebug() {
  debugHud.mesh.visible = !debugHud.mesh.visible;
  debugButton.draw();
}

function buildDebugButton() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.13),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  // Abajo y al frente, por debajo del anillo de retratos.
  mesh.position.set(0, 0.72, -2.9);
  scene.add(mesh);

  const btn = {
    isDebugButton: true,
    mesh,
    hovered: false,
    setHover(h) {
      this.hovered = h;
      this.draw();
    },
    draw() {
      const on = debugHud && debugHud.mesh.visible;
      ctx.clearRect(0, 0, 256, 96);
      ctx.fillStyle = this.hovered ? "rgba(122, 12, 18, 0.85)" : "rgba(10, 8, 6, 0.7)";
      ctx.fillRect(0, 0, 256, 96);
      ctx.strokeStyle = "#b8954b";
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, 248, 88);
      ctx.fillStyle = "#d9c7a3";
      ctx.font = "28px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`DEBUG ${on ? "ON" : "OFF"}`, 128, 58);
      tex.needsUpdate = true;
    },
  };
  mesh.userData.card = btn;
  btn.draw();
  return btn;
}

// ---------- HUD de debug en VR (estado del hand tracking) ----------
function buildDebugHud() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.105),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
  );
  mesh.position.set(0, -0.18, -0.85);
  mesh.renderOrder = 998;
  mesh.visible = DEBUG; // ?debug en la URL lo deja prendido de entrada
  camera.add(mesh);

  let last = 0;
  return {
    mesh,
    update(now) {
      if (now - last < 150) return; // ~6 veces por segundo alcanza
      last = now;

      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = "#9fdc9f";
      ctx.font = "22px monospace";

      const session = renderer.xr.getSession();
      const feats = session && session.enabledFeatures;
      const ht = feats ? (feats.includes("hand-tracking") ? "si" : "NO") : "?";
      let manos = 0;
      if (session) for (const s of session.inputSources) if (s.hand) manos++;
      ctx.fillText(`feature hand-tracking: ${ht}   inputs con mano: ${manos}`, 10, 30);

      const st = handClaws ? handClaws.status() : [];
      st.forEach((s, i) => {
        const open = s.openness == null ? "--" : s.openness.toFixed(2);
        ctx.fillText(
          `mano${i}: joints ${s.tracked ? "si" : "no"}  apertura ${open}  puño ${s.isFist ? "SI" : "no"}`,
          10,
          62 + i * 30
        );
      });
      tex.needsUpdate = true;
    },
  };
}

function hideLoader() {
  const l = document.getElementById("loader");
  if (l) { l.classList.add("hidden"); setTimeout(() => l.remove(), 1300); }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
