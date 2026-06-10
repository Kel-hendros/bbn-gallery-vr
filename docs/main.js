// main.js — Entry point. Renderer + WebXR, carga de datos, disposición en anillo,
// gaze dwell, controles de escritorio (fallback) y loop de animación.
import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { buildScene, buildDust, makeSpotlight, loadPanorama, SANGRE } from "./scene.js";
import { PersonajeCard } from "./personaje-card.js";
import { XRControls } from "./xr-controller.js";
import { WolverineClaws } from "./hand-claws.js";

const GAZE_DWELL = 1.5; // segundos mirando para abrir
const EYE_HEIGHT = 1.6;
const RING_RADIUS = 4.2;
const DEBUG = new URLSearchParams(location.search).has("debug");

let renderer, scene, camera, dolly, xrControls, dust, handClaws, debugHud, debugButton;
let cards = [];
let raycaster, reticle, reticleFill;
let hoverCard = null, activeCard = null, dwell = 0;
const clock = new THREE.Clock();

// Estado de controles de escritorio (fallback sin visor).
const desktop = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, keys: {} };

init();

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(
    VRButton.createButton(renderer, {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
    })
  );

  scene = buildScene();
  loadPanorama(scene, "assets/img/Buenos aires 360.png");

  // Cámara dentro de un dolly (el dolly se mueve; en VR el visor mueve la cámara).
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 100);
  dolly = new THREE.Group();
  dolly.position.set(0, 0, 0);
  dolly.add(camera);
  camera.position.set(0, EYE_HEIGHT, 0);
  scene.add(dolly);

  // Polvo ambiente.
  dust = buildDust(scene);

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
    scene.add(card.group);
    cards.push(card);

    // Foco sobre cada retrato.
    const spot = makeSpotlight(pos);
    scene.add(spot);
    scene.add(spot.target);
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

  const meshes = cards.map((c) => c.portrait);
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
  // El botón de debug no es una card: solo alterna el HUD.
  if (card.isDebugButton) {
    toggleDebug();
    // Dwell muy negativo: no vuelve a disparar hasta sacar la mirada del botón.
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
