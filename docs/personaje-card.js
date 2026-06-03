// personaje-card.js — Clase PersonajeCard: retrato (con vignette) + panel de info.
import * as THREE from "three";
import { SANGRE, ORO } from "./scene.js";

const loader = new THREE.TextureLoader();
loader.crossOrigin = "anonymous";

/** Aplica un vignette radial sobre la imagen y devuelve una textura. */
function vignetteTexture(image) {
  const w = 512;
  const h = Math.round((image.height / image.width) * w) || 700;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.drawImage(image, 0, 0, w, h);

  // Vignette: oscurece los bordes hacia negro.
  const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, h * 0.72);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.7, "rgba(0,0,0,0.15)");
  grad.addColorStop(1, "rgba(5,3,10,0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

/** Envuelve texto en varias líneas según ancho máximo (px). */
function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Renderiza el panel de info a un canvas y devuelve la textura. */
function buildInfoTexture(p) {
  const W = 560, H = 760;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  // Fondo pergamino oscuro con degradé.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0d0a10");
  bg.addColorStop(1, "#08060c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Borde doble: oro envejecido + filo sangre.
  ctx.strokeStyle = "#b8954b";
  ctx.lineWidth = 3;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.strokeStyle = "rgba(122,12,18,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  const M = 48;
  let y = 96;

  // Nombre (Cinzel grande, oro).
  ctx.fillStyle = "#d9c7a3";
  ctx.font = "700 46px Cinzel, serif";
  ctx.textBaseline = "alphabetic";
  for (const ln of wrapText(ctx, p.nombre, W - M * 2)) {
    ctx.fillText(ln, M, y);
    y += 52;
  }

  // Filete decorativo.
  y += 6;
  ctx.strokeStyle = "#7a0c12";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  y += 44;

  // Clan + Generación.
  ctx.font = "500 26px Cinzel, serif";
  ctx.fillStyle = "#b8954b";
  const genTxt = p.generacion != null && p.generacion !== "" ? `  ·  ${p.generacion}ª Gen.` : "";
  ctx.fillText(`${p.clan}${genTxt}`, M, y);
  y += 46;

  // Status (etiqueta + valor).
  ctx.font = "italic 22px 'EB Garamond', serif";
  ctx.fillStyle = "#6e5e3e";
  ctx.fillText("Status", M, y);
  y += 30;
  ctx.font = "22px 'EB Garamond', serif";
  ctx.fillStyle = "#cdbf9f";
  for (const ln of wrapText(ctx, p.status || "Desconocido", W - M * 2)) {
    ctx.fillText(ln, M, y);
    y += 30;
  }
  y += 24;

  // Descripción.
  if (p.descripcion) {
    ctx.font = "italic 22px 'EB Garamond', serif";
    ctx.fillStyle = "#6e5e3e";
    ctx.fillText("Crónica", M, y);
    y += 32;
    ctx.font = "23px 'EB Garamond', serif";
    ctx.fillStyle = "#c9bda0";
    for (const ln of wrapText(ctx, p.descripcion, W - M * 2)) {
      ctx.fillText(ln, M, y);
      y += 31;
    }
  }

  // Organización al pie.
  if (p.organizacion && p.organizacion.length) {
    ctx.font = "italic 19px 'EB Garamond', serif";
    ctx.fillStyle = "#5a4d33";
    ctx.fillText(p.organizacion.join("  ·  "), M, H - 56);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H };
}

export class PersonajeCard {
  /**
   * @param {object} data  Registro del personaje (de personajes.json)
   * @param {THREE.Vector3} position  Posición del retrato
   * @param {number} faceAngle  Ángulo (rad) hacia donde mira el frente
   */
  constructor(data, position, faceAngle) {
    this.data = data;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = faceAngle;

    this.baseY = position.y;
    this.phase = Math.random() * Math.PI * 2; // desfase del bobbing
    this.state = "idle";
    this._panelBuilt = false;
    this.panelTargetOpacity = 0;

    this._buildFrame();
    this._buildPortrait();
    this._buildPanel();
  }

  _buildFrame() {
    // Marco que se ilumina en rojo sangre al hacer hover.
    const frameGeo = new THREE.PlaneGeometry(0.92, 1.22);
    this.frameMat = new THREE.MeshBasicMaterial({
      color: SANGRE,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    this.frame = new THREE.Mesh(frameGeo, this.frameMat);
    this.frame.position.z = -0.01;
    this.group.add(this.frame);
  }

  _buildPortrait() {
    // Placeholder mientras carga la textura.
    const geo = new THREE.PlaneGeometry(0.8, 1.1);
    this.portraitMat = new THREE.MeshBasicMaterial({
      color: 0x1a1622,
      side: THREE.DoubleSide,
    });
    this.portrait = new THREE.Mesh(geo, this.portraitMat);
    this.portrait.userData.card = this; // para el raycaster
    this.group.add(this.portrait);

    loader.load(this.data.imagen, (texture) => {
      const { tex, aspect } = vignetteTexture(texture.image);
      this.portraitMat.map = tex;
      this.portraitMat.color.set(0xffffff);
      this.portraitMat.needsUpdate = true;
      // Ajusta el plano al aspecto real de la imagen (alto fijo 1.1m).
      const h = 1.1, w = h * aspect;
      this.portrait.geometry.dispose();
      this.portrait.geometry = new THREE.PlaneGeometry(w, h);
      this.frame.geometry.dispose();
      this.frame.geometry = new THREE.PlaneGeometry(w + 0.12, h + 0.12);
    });
  }

  _buildPanel() {
    // El plano del panel existe desde el inicio pero invisible; la textura se
    // genera la primera vez que se activa (lazy) para no renderizar 10 canvas de una.
    const geo = new THREE.PlaneGeometry(0.85, 1.15);
    this.panelMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.panel = new THREE.Mesh(geo, this.panelMat);
    this.panel.position.set(0.95, 0, 0.05); // a la derecha del retrato
    this.panel.visible = false;
    this.group.add(this.panel);
  }

  _ensurePanelTexture() {
    if (this._panelBuilt) return;
    const { tex, aspect } = buildInfoTexture(this.data);
    this.panelMat.map = tex;
    this.panelMat.needsUpdate = true;
    const h = 1.15, w = h * aspect;
    this.panel.geometry.dispose();
    this.panel.geometry = new THREE.PlaneGeometry(w, h);
    this.panel.position.x = 0.45 + w / 2;
    this._panelBuilt = true;
  }

  setHover(on) {
    if (this.state === "active") return;
    this.state = on ? "hover" : "idle";
  }

  open() {
    this.state = "active";
    this._ensurePanelTexture();
    this.panel.visible = true;
    this.panelTargetOpacity = 1;
  }

  close() {
    this.state = "idle";
    this.panelTargetOpacity = 0;
  }

  /** Anima bobbing, hover y panel. dt en segundos, t en ms. */
  update(dt, t) {
    // Bobbing idle: 0.05m de amplitud, ~3s de período.
    const bob = Math.sin((t * 0.001) * (Math.PI * 2 / 3) + this.phase) * 0.05;
    this.group.position.y = this.baseY + bob;

    // Escala y borde según estado.
    const targetScale = this.state === "idle" ? 1.0 : 1.05;
    const s = this.portrait.scale.x;
    const ns = s + (targetScale - s) * Math.min(1, dt * 8);
    this.portrait.scale.setScalar(ns);
    this.frame.scale.setScalar(ns);

    const targetBorder = this.state === "idle" ? 0.0 : 0.85;
    this.frameMat.opacity += (targetBorder - this.frameMat.opacity) * Math.min(1, dt * 8);

    // El retrato activo se adelanta levemente.
    const targetZ = this.state === "active" ? 0.12 : 0.0;
    this.portrait.position.z += (targetZ - this.portrait.position.z) * Math.min(1, dt * 6);

    // Fade del panel.
    if (this._panelBuilt) {
      this.panelMat.opacity += (this.panelTargetOpacity - this.panelMat.opacity) * Math.min(1, dt * 6);
      if (this.panelMat.opacity < 0.01 && this.panelTargetOpacity === 0) {
        this.panel.visible = false;
      }
    }
  }
}
