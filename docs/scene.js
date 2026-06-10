// scene.js — Setup del entorno 3D: salón gótico oscuro, niebla, luces, polvo.
import * as THREE from "three";

const SANGRE = 0x7a0c12;
const ORO = 0xb8954b;

/** Crea la escena base con niebla y suelo/paredes de piedra. */
export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05030a);
  // Niebla volumétrica baja: oscurece la distancia, encierra el salón.
  scene.fog = new THREE.FogExp2(0x05030a, 0.07);

  // Todo lo "galería" (suelo, retratos, focos, polvo) vive en este grupo:
  // en modo passthrough se oculta entero. Las luces base quedan fuera para
  // que las garras sigan iluminadas.
  const gallery = new THREE.Group();
  gallery.name = "gallery";
  scene.add(gallery);
  scene.userData.gallery = gallery;

  // --- Iluminación ambiental muy baja (casi negro) ---
  const ambient = new THREE.AmbientLight(0x221a2e, 0.35);
  scene.add(ambient);

  // Un tinte general frío desde arriba, apenas perceptible.
  const hemi = new THREE.HemisphereLight(0x2a2238, 0x050304, 0.25);
  scene.add(hemi);

  // --- Suelo circular de piedra ---
  const floorGeo = new THREE.CircleGeometry(12, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x14110f,
    roughness: 0.95,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  gallery.add(floor);

  // Las paredes/techo las reemplaza el panorama 360 (loadPanorama). Si no hay
  // panorama, el background oscuro (0x05030a) + niebla alcanzan para el mood.
  return scene;
}

/**
 * Carga un panorama equirectangular (2:1) como esfera/skybox 360 envolvente.
 * Se oscurece con backgroundIntensity para no romper la atmósfera gótica.
 * El background no recibe niebla, así que se ve nítido en todas direcciones (y en VR).
 */
export function loadPanorama(scene, url, { bgIntensity = 0.32, envIntensity = 0.3 } = {}) {
  const tl = new THREE.TextureLoader();
  tl.crossOrigin = "anonymous";
  tl.load(url, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.userData.panoTex = tex;
    // En passthrough el fondo debe quedar transparente: no pisarlo.
    if (!scene.userData.passthrough) scene.background = tex;
    scene.backgroundIntensity = bgIntensity;   // oscurece el skybox
    scene.environment = tex;                     // ilumina sutilmente la escena
    scene.environmentIntensity = envIntensity;
  });
}

/**
 * Partículas de polvo flotando: ~50 puntos sutiles que derivan lentamente.
 * Devuelve { points, update } para animarlas en el loop.
 */
export function buildDust(scene, count = 60) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const R = 8;
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * R * 2;
    positions[i * 3 + 1] = Math.random() * 4 + 0.3;
    positions[i * 3 + 2] = (Math.random() - 0.5) * R * 2;
    speeds[i] = 0.02 + Math.random() * 0.04;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xb8954b,
    size: 0.025,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  function update(t) {
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speeds[i] * 0.01; // sube lento
      arr[i * 3 + 0] += Math.sin(t * 0.0003 + i) * 0.0008; // deriva lateral
      if (arr[i * 3 + 1] > 4.5) arr[i * 3 + 1] = 0.3; // recicla al piso
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { points, update };
}

/** Crea un foco direccional para iluminar un retrato desde arriba/adelante. */
export function makeSpotlight(target) {
  const spot = new THREE.SpotLight(0xffe9c8, 14, 9, Math.PI / 7, 0.55, 1.4);
  spot.position.set(target.x * 0.7, 4.2, target.z * 0.7);
  spot.target.position.copy(target);
  return spot;
}

export { SANGRE, ORO };
