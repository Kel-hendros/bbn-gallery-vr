// xr-controller.js — Controladores Quest: locomoción (joystick izq), snap-turn
// (joystick der) y botones A/B. Mueve un "dolly" que contiene a la cámara.
import * as THREE from "three";

const DEADZONE = 0.18;
const MOVE_SPEED = 2.2;       // m/s
const SNAP_ANGLE = Math.PI / 4; // 45°
const SNAP_THRESHOLD = 0.7;

export class XRControls {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Group} dolly  grupo que contiene a la cámara
   * @param {THREE.Camera} camera
   */
  constructor(renderer, dolly, camera) {
    this.renderer = renderer;
    this.dolly = dolly;
    this.camera = camera;
    this.onSelect = () => {};
    this.onCancel = () => {};

    this._snapReady = true;
    this._prevButtons = new WeakMap();

    this._setupRays(renderer, dolly);
  }

  _setupRays(renderer, dolly) {
    // Rayos visuales en ambos controladores.
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const line = new THREE.Line(
        rayGeo,
        new THREE.LineBasicMaterial({ color: 0x7a0c12, transparent: true, opacity: 0.5 })
      );
      line.scale.z = 5;
      controller.add(line);
      dolly.add(controller);

      // 'selectstart' = gatillo: abrir panel del objetivo.
      controller.addEventListener("selectstart", () => this.onSelect());
    }
  }

  _edge(gamepad, index) {
    // Detección de flanco (botón recién apretado).
    const prev = this._prevButtons.get(gamepad) || [];
    const now = gamepad.buttons.map((b) => b.pressed);
    const justPressed = !!now[index] && !prev[index];
    this._prevButtons.set(gamepad, now);
    return justPressed;
  }

  update(dt) {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    for (const src of session.inputSources) {
      if (!src.gamepad) continue;
      const gp = src.gamepad;
      const axes = gp.axes;
      // xr-standard: thumbstick suele estar en axes[2] (x) y axes[3] (y).
      const ax = axes.length >= 4 ? axes[2] : axes[0] || 0;
      const ay = axes.length >= 4 ? axes[3] : axes[1] || 0;

      if (src.handedness === "left") {
        this._move(ax, ay, dt);
      } else if (src.handedness === "right") {
        this._snapTurn(ax);
        // Botón A (index 4) abre, B (index 5) cierra.
        if (this._edge(gp, 4)) this.onSelect();
        if (this._edge(gp, 5)) this.onCancel();
      }
    }
  }

  _move(ax, ay, dt) {
    if (Math.abs(ax) < DEADZONE && Math.abs(ay) < DEADZONE) return;
    // Dirección de la mirada proyectada al piso.
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    move.addScaledVector(forward, -ay); // adelante = empujar stick
    move.addScaledVector(right, ax);
    move.normalize().multiplyScalar(MOVE_SPEED * dt);
    this.dolly.position.add(move);

    // Limitar al radio del salón.
    const r = Math.hypot(this.dolly.position.x, this.dolly.position.z);
    if (r > 10.5) {
      this.dolly.position.x *= 10.5 / r;
      this.dolly.position.z *= 10.5 / r;
    }
  }

  _snapTurn(ax) {
    if (Math.abs(ax) > SNAP_THRESHOLD && this._snapReady) {
      this.dolly.rotateY(ax > 0 ? -SNAP_ANGLE : SNAP_ANGLE);
      this._snapReady = false;
    } else if (Math.abs(ax) < 0.3) {
      this._snapReady = true;
    }
  }
}
