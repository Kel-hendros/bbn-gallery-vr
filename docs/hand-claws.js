// hand-claws.js — Hand tracking en Quest 3: al cerrar el puño surgen tres garras
// de acero estilo Wolverine del dorso de la mano. Usa la API de manos de WebXR
// (renderer.xr.getHand) para leer las articulaciones y detectar el gesto.
import * as THREE from "three";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

// Dedos (sin pulgar) que se usan para medir cuán cerrado está el puño.
const FINGERS = ["index", "middle", "ring", "pinky"];

// Umbrales con histéresis sobre la "apertura" promedio de los dedos
// (largo nudillo→punta normalizado por el largo de la palma).
const FIST_CLOSE = 0.55; // por debajo de esto: puño cerrado → salen las garras
const FIST_OPEN = 0.78;  // por encima: mano abierta → se retraen

const EXTEND_SPEED = 13;  // qué tan rápido salen/entran las garras
const FORWARD_OFFSET = 0.02; // las garras nacen un poco más allá de los nudillos

export class WolverineClaws {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Group} dolly  grupo que contiene la cámara (las manos se mueven con él)
   * @param {THREE.Scene} scene
   */
  constructor(renderer, dolly, scene) {
    this.renderer = renderer;
    this.hands = [];

    const handFactory = new XRHandModelFactory();

    // Vectores reutilizables (sin allocar en cada frame).
    this._tmp = {
      wrist: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      idx: new THREE.Vector3(),
      pnk: new THREE.Vector3(),
      center: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      side: new THREE.Vector3(),
      up: new THREE.Vector3(),
      m: new THREE.Matrix4(),
    };

    for (let i = 0; i < 2; i++) {
      const hand = renderer.xr.getHand(i);
      // Esferas como base (geometría local, se ven siempre que haya tracking).
      // En paralelo se intenta cargar la malla realista de mano desde el CDN;
      // si llega, reemplaza a las esferas. Si no llega, las esferas quedan.
      const spheres = handFactory.createHandModel(hand, "spheres");
      hand.add(spheres);
      const meshFactory = new XRHandModelFactory(null, () => {
        spheres.visible = false;
      });
      hand.add(meshFactory.createHandModel(hand, "mesh"));
      dolly.add(hand);

      // El grupo de garras vive en la escena (no en la mano): cada frame le
      // fijamos la transform en coordenadas de mundo a partir de las articulaciones.
      const claws = this._buildClaws();
      scene.add(claws);

      this.hands.push({ hand, claws, extend: 0, isFist: false, openness: null });
    }
  }

  _buildClaws() {
    const group = new THREE.Group();
    group.visible = false;

    const steel = new THREE.MeshStandardMaterial({
      color: 0xd2d7dd,
      metalness: 1.0,
      roughness: 0.16,
      emissive: 0x2a3a52,
      emissiveIntensity: 0.22,
    });

    // Tres garras paralelas sobre los nudillos. La del medio, más larga.
    const lengths = [0.20, 0.245, 0.20];
    const xs = [-0.024, 0.0, 0.024];
    const splay = [-0.1, 0.0, 0.1]; // leve abanico hacia afuera

    for (let k = 0; k < 3; k++) {
      const len = lengths[k];
      // Cono fino: base en el origen, punta hacia +Z (dirección de los dedos).
      const geo = new THREE.ConeGeometry(0.0055, len, 14);
      geo.translate(0, len / 2, 0); // base en y=0, crece hacia +Y
      geo.rotateX(Math.PI / 2);     // ahora la punta apunta a +Z
      const blade = new THREE.Mesh(geo, steel);
      blade.position.set(xs[k], 0, 0);
      blade.rotation.y = splay[k];
      group.add(blade);
    }

    return group;
  }

  /** Estado por mano, para el HUD de debug. */
  status() {
    return this.hands.map((s) => ({
      tracked: !!(s.hand.joints && s.hand.joints["wrist"]),
      openness: s.openness,
      isFist: s.isFist,
      extend: s.extend,
    }));
  }

  /** Posición de mundo de una articulación, o null si no está trackeada. */
  _joint(joints, name, out) {
    const j = joints[name];
    if (!j || j.visible === false) return null;
    return j.getWorldPosition(out);
  }

  update(dt) {
    const t = this._tmp;

    for (const state of this.hands) {
      const joints = state.hand.joints;

      const wrist = this._joint(joints, "wrist", t.wrist);
      const midK = this._joint(joints, "middle-finger-phalanx-proximal", t.mid);

      // Apertura promedio de los dedos (1 ≈ extendido, ~0.3 ≈ cerrado).
      let openness = null;
      if (wrist && midK) {
        const palm = wrist.distanceTo(midK);
        if (palm > 1e-4) {
          let sum = 0, valid = 0;
          for (const f of FINGERS) {
            const knuckle = this._joint(joints, `${f}-finger-phalanx-proximal`, t.a);
            const tip = this._joint(joints, `${f}-finger-tip`, t.b);
            if (!knuckle || !tip) continue;
            sum += knuckle.distanceTo(tip) / palm;
            valid++;
          }
          if (valid >= 3) openness = sum / valid;
        }
      }
      state.openness = openness;

      // Gesto de puño con histéresis para que no parpadee.
      if (openness != null) {
        if (!state.isFist && openness < FIST_CLOSE) state.isFist = true;
        else if (state.isFist && openness > FIST_OPEN) state.isFist = false;
      } else {
        state.isFist = false; // sin tracking → garras adentro
      }

      // Animación de salida/retracción (easing exponencial).
      const target = state.isFist ? 1 : 0;
      state.extend += (target - state.extend) * Math.min(1, dt * EXTEND_SPEED);
      if (state.extend < 0.001) state.extend = 0;

      const claws = state.claws;
      claws.visible = state.extend > 0.01;
      if (!claws.visible) continue;

      // Orientar y anclar las garras al dorso de la mano (necesita los nudillos).
      const idxK = this._joint(joints, "index-finger-phalanx-proximal", t.idx);
      const pnkK = this._joint(joints, "pinky-finger-phalanx-proximal", t.pnk);
      if (wrist && midK && idxK && pnkK) {
        // Centro sobre los nudillos.
        const center = t.center.copy(idxK).add(pnkK).multiplyScalar(0.5);

        // Base ortonormal: +Z hacia donde apuntan los dedos, +X a lo ancho.
        const fwd = t.fwd.copy(center).sub(wrist).normalize();
        const side = t.side.copy(idxK).sub(pnkK).normalize();
        const up = t.up.crossVectors(fwd, side).normalize();
        side.crossVectors(up, fwd).normalize();

        t.m.makeBasis(side, up, fwd);
        claws.quaternion.setFromRotationMatrix(t.m);
        claws.position.copy(center).addScaledVector(fwd, FORWARD_OFFSET);
      }

      // El "scale.z" hace que las garras parezcan deslizarse hacia afuera.
      claws.scale.set(1, 1, Math.max(0.0001, state.extend));
    }
  }
}
