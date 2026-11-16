// The Gaffer — 3D match view (three.js, vendored in /vendor so it works offline).
// Renders the same match state as the 2D view (players and ball on a 0–1 pitch, ball height z)
// in a daylight stadium. Players are jointed figures (hips, knees, shoulders, elbows) with shirt
// numbers, driven by a small pose system: stride-matched running, kicking, slide tackles, keeper
// dives, goal celebrations and dejection. Effects: ball trail, turf spray, confetti, camera
// flashes in the crowd, scrolling LED boards, net bulge, goal camera shake. Four cameras.
// createView() throws if WebGL is unavailable; the caller falls back to 2D.
import * as THREE from './vendor/three.module.min.js';

const L = 105, W = 68;                  // pitch size in metres
const PX = 120, PZ = 80;                // grass area incl. run-off
const S = 1.2;                          // players are drawn a little larger than life so they read on a phone
const BALL_R = 0.24;
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

function pitchTexture() {
  const s = 9, cw = PX * s, ch = PZ * s;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  const bands = 18;
  for (let i = 0; i < bands; i++) { g.fillStyle = i % 2 ? '#3fa34d' : '#368f43'; g.fillRect(i * cw / bands, 0, cw / bands + 1, ch); }
  // Cross-cut mowing and grass grain
  for (let j = 0; j < 10; j++) { if (j % 2) { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, j * ch / 10, cw, ch / 10); } }
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9000; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,40,0,.10)' : 'rgba(210,255,190,.07)'; g.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 3, 2); }
  const x0 = (PX - L) / 2 * s, z0 = (PZ - W) / 2 * s, m = v => v * s;
  // Worn turf in the goal mouths and the centre spot
  for (const wx of [x0 + m(3), x0 + m(L - 3), x0 + m(L / 2)]) { const gr = g.createRadialGradient(wx, z0 + m(W / 2), 0, wx, z0 + m(W / 2), m(6)); gr.addColorStop(0, 'rgba(120,110,60,.22)'); gr.addColorStop(1, 'rgba(120,110,60,0)'); g.fillStyle = gr; g.fillRect(wx - m(6), z0 + m(W / 2 - 6), m(12), m(12)); }
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 0.16 * s; g.fillStyle = 'rgba(255,255,255,.95)';
  g.strokeRect(x0, z0, m(L), m(W));
  g.beginPath(); g.moveTo(x0 + m(L / 2), z0); g.lineTo(x0 + m(L / 2), z0 + m(W)); g.stroke();
  g.beginPath(); g.arc(x0 + m(L / 2), z0 + m(W / 2), m(9.15), 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(x0 + m(L / 2), z0 + m(W / 2), m(0.3), 0, Math.PI * 2); g.fill();
  for (const side of [0, 1]) {
    const gx = side ? x0 + m(L) : x0, dir = side ? -1 : 1;
    const box = (d, w) => g.strokeRect(side ? gx - m(d) : gx, z0 + m(W / 2 - w / 2), m(d), m(w));
    box(16.5, 40.3); box(5.5, 18.32);
    g.beginPath(); g.arc(gx + dir * m(11), z0 + m(W / 2), m(0.3), 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(gx + dir * m(11), z0 + m(W / 2), m(9.15), side ? Math.PI - 0.93 : -0.93, side ? Math.PI + 0.93 : 0.93); g.stroke();
  }
  for (const [cx, cz] of [[x0, z0], [x0 + m(L), z0], [x0, z0 + m(W)], [x0 + m(L), z0 + m(W)]]) { g.beginPath(); g.arc(cx, cz, m(1), 0, Math.PI * 2); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function netTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 4);
  return t;
}

function skyTexture() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#1f5fc4'); gr.addColorStop(0.38, '#4f95e6'); gr.addColorStop(0.5, '#bfe0fb'); gr.addColorStop(1, '#bfe0fb');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function ballTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#14171c';
  const patch = (x, y, rx, ry) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5; const px = x + Math.cos(a) * rx, py = y + Math.sin(a) * ry; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.fill(); };
  for (let i = 0; i < 5; i++) patch(26 + i * 51, 64, 13, 13);
  for (let i = 0; i < 4; i++) { patch(32 + i * 64, 28, 20, 10); patch(i * 64, 100, 20, 10); }
  patch(256, 100, 20, 10);
  g.fillRect(0, 0, 256, 5); g.fillRect(0, 123, 256, 5);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Shirt texture wrapped round the chest: front at u = 0.25, back (with the number) at u = 0.75.
function shirtTexture(hue, pattern, number, keeper) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const main = keeper || `hsl(${hue},78%,48%)`, dark = keeper ? 'rgba(0,0,0,.25)' : `hsl(${hue},80%,30%)`;
  g.fillStyle = main; g.fillRect(0, 0, 128, 64);
  if (!keeper) {
    if (pattern === 1) { g.fillStyle = '#f4f4f4'; for (let x = 0; x < 128; x += 16) g.fillRect(x + 4, 0, 8, 64); }
    else if (pattern === 2) { g.fillStyle = dark; for (let y = 10; y < 64; y += 18) g.fillRect(0, y, 128, 8); }
    else if (pattern === 3) { g.fillStyle = dark; g.fillRect(0, 0, 128, 14); g.fillStyle = '#f4f4f4'; g.fillRect(0, 14, 128, 3); }
  }
  g.fillStyle = dark; g.fillRect(0, 60, 128, 4);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, 0, 128, 3);            // collar
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  if (number != null) {
    g.font = 'bold 34px Arial, sans-serif'; g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.75)'; g.fillStyle = '#fff';
    g.strokeText(String(number), 96, 34); g.fillText(String(number), 96, 34);
    g.font = 'bold 13px Arial, sans-serif'; g.lineWidth = 3;
    g.strokeText(String(number), 42, 20); g.fillText(String(number), 42, 20);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(20, 30, 24, 4);       // sponsor bar on the chest
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildGoal(scene, side) {
  const x = side * L / 2, gw = 7.32, gh = 2.44, depth = 2.2;
  const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const cyl = (len) => new THREE.CylinderGeometry(0.07, 0.07, len, 10);
  for (const z of [-gw / 2, gw / 2]) { const m = new THREE.Mesh(cyl(gh), post); m.position.set(x, gh / 2, z); m.castShadow = true; scene.add(m); }
  const bar = new THREE.Mesh(cyl(gw), post); bar.rotation.x = Math.PI / 2; bar.position.set(x, gh, 0); bar.castShadow = true; scene.add(bar);
  // The net hangs from a group anchored on the goal line, so scaling the group stretches it backwards.
  const net = new THREE.Group(); net.position.set(x, 0, 0); scene.add(net);
  const netMat = new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), netMat); back.position.set(side * depth, gh / 2, 0); back.rotation.y = Math.PI / 2; net.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(depth, gw), netMat); top.rotation.x = Math.PI / 2; top.position.set(side * depth / 2, gh, 0); net.add(top);
  for (const z of [-gw / 2, gw / 2]) { const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(depth, gh), netMat); sideNet.position.set(side * depth / 2, gh / 2, z); net.add(sideNet); }
  return net;
}

function buildStands(scene, homeHue, awayHue, low) {
  const concrete = new THREE.MeshLambertMaterial({ color: 0x55606f });
  const wall = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(homeHue / 360, 0.6, 0.32) });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xdfe6ee });
  const stands = [
    { cx: 0, cz: -(PZ / 2 + 9), w: PX + 10, rot: 0 }, { cx: 0, cz: PZ / 2 + 9, w: PX + 10, rot: Math.PI },
    { cx: -(PX / 2 + 9), cz: 0, w: PZ, rot: Math.PI / 2 }, { cx: PX / 2 + 9, cz: 0, w: PZ, rot: -Math.PI / 2 },
  ];
  const seats = [];
  const gap = low ? 1.5 : 1.1;
  for (const st of stands) {
    const grp = new THREE.Group(); grp.position.set(st.cx, 0, st.cz); grp.rotation.y = st.rot; scene.add(grp);
    const front = new THREE.Mesh(new THREE.BoxGeometry(st.w, 1.3, 0.3), wall); front.position.set(0, 0.65, 8.1); grp.add(front);
    for (let tier = 0; tier < 9; tier++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(st.w, 1.2, 2), concrete);
      step.position.set(0, 0.6 + tier * 1.2, 7 - tier * 2);
      grp.add(step);
      for (let i = -st.w / 2 + 1; i < st.w / 2 - 1; i += gap) seats.push({ grp, x: i, y: 1.6 + tier * 1.2, z: -tier * 2 + 7 });
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(st.w, 14, 0.5), concrete); back.position.set(0, 7, -10.2); grp.add(back);
    // The main stand (where the TV camera sits) has no roof in shot.
    if (st.cz <= 0 || st.rot !== Math.PI) { const roof = new THREE.Mesh(new THREE.BoxGeometry(st.w, 0.4, 17), roofMat); roof.position.set(0, 14.4, -2); roof.rotation.x = 0.06; grp.add(roof); }
  }
  // Crowd: two instanced meshes (alternate fans) so they can bounce out of step.
  const fan = new THREE.BoxGeometry(0.6, 0.95, 0.45);
  const fanMat = new THREE.MeshLambertMaterial();
  const half = [Math.ceil(seats.length / 2), Math.floor(seats.length / 2)];
  const crowds = [new THREE.InstancedMesh(fan, fanMat, half[0]), new THREE.InstancedMesh(fan, fanMat, half[1])];
  const m = new THREE.Matrix4(), col = new THREE.Color(), v = new THREE.Vector3();
  const palette = [new THREE.Color().setHSL(homeHue / 360, 0.75, 0.5), new THREE.Color().setHSL(awayHue / 360, 0.75, 0.48), new THREE.Color(0xe6e6e6), new THREE.Color(0x3a4050), new THREE.Color(0x8a6a4c)];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const flashSpots = [];
  seats.forEach((s, i) => {
    s.grp.updateMatrixWorld(true);
    v.set(s.x + (rnd() - 0.5) * 0.3, s.y, s.z).applyMatrix4(s.grp.matrixWorld);
    m.makeTranslation(v.x, v.y, v.z);
    crowds[i % 2].setMatrixAt(i >> 1, m);
    const r = rnd();
    col.copy(palette[r < 0.45 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4]).multiplyScalar(0.75 + rnd() * 0.4);
    crowds[i % 2].setColorAt(i >> 1, col);
    if (i % 7 === 0) flashSpots.push(v.x, v.y + 0.7, v.z);
  });
  for (const c of crowds) { c.instanceMatrix.needsUpdate = true; c.frustumCulled = false; scene.add(c); }
  return { crowds, flashSpots };
}

function buildFloodlights(scene) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xb9c2ce });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = x * (PX / 2 + 16), pz = z * (PZ / 2 + 16);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 36, 8), mat); pole.position.set(px, 18, pz); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 0.6), lamp); head.position.set(px, 36, pz); head.lookAt(0, 0, 0); scene.add(head);
  }
}

function boardTexture(words) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
  const g = c.getContext('2d');
  const cols = ['#0b3d91', '#b3122a', '#0c7a43', '#5a2ea6', '#101418', '#c77800'];
  const n = 8, w = c.width / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[i % cols.length]; g.fillRect(i * w, 0, w, 64);
    g.fillStyle = '#fff'; g.font = 'bold 32px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(words[i % words.length] || '').toUpperCase().slice(0, 16), i * w + w / 2, 34, w - 16);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// LED advertising boards around the pitch (they scroll): the shirt sponsor and both clubs.
function buildBoards(scene, words) {
  const mat = new THREE.MeshBasicMaterial({ map: boardTexture(words) });
  const far = new THREE.Mesh(new THREE.PlaneGeometry(L + 6, 1.15), mat); far.position.set(0, 0.58, -(W / 2 + 4)); scene.add(far);
  for (const side of [-1, 1]) {
    for (const z of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W / 2 - 8, 1.15), mat);
      m.position.set(side * (L / 2 + 4.5), 0.58, z * (W / 4 + 3)); m.rotation.y = -side * Math.PI / 2; scene.add(m);
    }
  }
  return mat;
}

function buildCornerFlags(scene) {
  const pole = new THREE.MeshLambertMaterial({ color: 0xffffff }), cloth = new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide });
  const flags = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), pole); p.position.set(x * L / 2, 0.8, z * W / 2); scene.add(p);
    const fg = new THREE.PlaneGeometry(0.5, 0.34); fg.translate(0.25, 0, 0);
    const f = new THREE.Mesh(fg, cloth); f.position.set(x * L / 2, 1.42, z * W / 2); scene.add(f); flags.push(f);
  }
  return flags;
}

// Face painted on the head sphere (the front of the head is at u = 0.5).
function faceTexture(skin) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const base = new THREE.Color(skin), dark = base.clone().multiplyScalar(0.62), lite = base.clone().lerp(new THREE.Color(0xffffff), 0.12);
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 256, 128);
  const gr = g.createRadialGradient(128, 62, 6, 128, 62, 46); gr.addColorStop(0, `#${lite.getHexString()}`); gr.addColorStop(1, `#${base.getHexString()}`);
  g.fillStyle = gr; g.fillRect(84, 20, 88, 92);
  for (const dx of [-15, 15]) {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.ellipse(128 + dx, 56, 6, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1b1410'; g.beginPath(); g.arc(128 + dx, 56, 2.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1b1410'; g.lineWidth = 3; g.beginPath(); g.moveTo(128 + dx - 8, 47); g.lineTo(128 + dx + 8, 46); g.stroke();
  }
  g.strokeStyle = `#${dark.getHexString()}`; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(128, 60); g.lineTo(126, 72); g.lineTo(131, 73); g.stroke();              // nose
  g.lineWidth = 3; g.beginPath(); g.moveTo(118, 87); g.quadraticCurveTo(128, 91, 138, 87); g.stroke();   // mouth
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Shared body geometry. Forward is +X, up is +Y; a positive rotation about Z swings a limb forward.
// Limbs taper (thigh to knee, calf to ankle, upper arm to wrist) and the chest is a lathed profile
// with a waist and shoulders, so the silhouette reads as a person rather than a stack of capsules.
function playerGeometry() {
  const cyl = (rt, rb, len, y, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, len, seg); g.translate(0, y, 0); return g; };
  const chest = new THREE.LatheGeometry([[0.128, 0], [0.15, 0.07], [0.146, 0.2], [0.168, 0.36], [0.19, 0.47], [0.172, 0.54], [0.085, 0.585], [0.058, 0.61]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  const boot = new THREE.SphereGeometry(0.062, 10, 8); boot.scale(2.25, 0.8, 0.95); boot.translate(0.075, -0.035, 0);
  const hand = new THREE.SphereGeometry(0.045, 8, 6); hand.scale(0.8, 1.25, 0.6);
  return {
    chest, pelvis: cyl(0.148, 0.17, 0.2, 0, 12),
    neck: new THREE.CylinderGeometry(0.048, 0.058, 0.11, 8), head: new THREE.SphereGeometry(0.115, 18, 14),
    ear: new THREE.SphereGeometry(0.026, 6, 5), nose: new THREE.BoxGeometry(0.03, 0.035, 0.03),
    hairCap: new THREE.SphereGeometry(0.123, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hairAfro: new THREE.SphereGeometry(0.152, 12, 10), hairTop: new THREE.BoxGeometry(0.2, 0.07, 0.15),
    thigh: cyl(0.086, 0.06, 0.42, -0.21), shortsLeg: cyl(0.098, 0.108, 0.25, -0.1), knee: new THREE.SphereGeometry(0.061, 8, 6),
    shin: cyl(0.057, 0.04, 0.4, -0.2, 8), sock: cyl(0.062, 0.047, 0.3, -0.24, 8), boot,
    shoulder: new THREE.SphereGeometry(0.07, 8, 6), upper: cyl(0.055, 0.045, 0.27, -0.135, 8), sleeve: cyl(0.066, 0.062, 0.15, -0.07, 8),
    fore: cyl(0.044, 0.034, 0.25, -0.125, 8), hand,
    blob: new THREE.PlaneGeometry(1.5, 1.5),
  };
}

function makePlayer(geo, m) {
  const g = new THREE.Group();
  const rig = new THREE.Group(); g.add(rig);
  const build = m.build || { h: 1, w: 1 };
  rig.scale.set(S * build.h * build.w, S * build.h, S * build.h * build.w);
  const mesh = (ge, ma, shadow) => { const x = new THREE.Mesh(ge, ma); x.castShadow = !!shadow; return x; };
  const hips = new THREE.Group(); hips.position.y = 0.94; rig.add(hips);
  const pelvis = mesh(geo.pelvis, m.shorts, true); pelvis.scale.set(0.72, 1, 1.08); hips.add(pelvis);
  const torso = new THREE.Group(); torso.position.y = 0.04; hips.add(torso);
  const chest = mesh(geo.chest, m.shirt, true); chest.scale.set(0.66, 1, 1.12); torso.add(chest);
  const neck = mesh(geo.neck, m.skin); neck.position.y = 0.63; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.78; torso.add(head);
  const skull = mesh(geo.head, m.face || m.skin, true); skull.scale.set(0.97, 1.15, 0.9); head.add(skull);
  for (const z of [-0.105, 0.105]) { const e = mesh(geo.ear, m.skin); e.position.set(-0.005, 0, z); head.add(e); }
  const nose = mesh(geo.nose, m.skin); nose.position.set(0.108, -0.012, 0); head.add(nose);
  if (m.hairStyle === 0 || m.hairStyle === 2) { const h = mesh(geo.hairCap, m.hair); h.scale.set(1, 1.12, 0.93); h.position.set(-0.014, 0.022, 0); head.add(h); }
  if (m.hairStyle === 1) { const h = mesh(geo.hairAfro, m.hair); h.position.set(-0.024, 0.06, 0); head.add(h); }
  if (m.hairStyle === 2) { const t2 = mesh(geo.hairTop, m.hair); t2.position.set(0, 0.145, 0); head.add(t2); }
  const leg = z => {
    const hip = new THREE.Group(); hip.position.set(0, -0.03, z); hips.add(hip);
    hip.add(mesh(geo.thigh, m.skin, true), mesh(geo.shortsLeg, m.shorts));
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
    knee.add(mesh(geo.knee, m.skin), mesh(geo.shin, m.skin), mesh(geo.sock, m.sock, true));
    const ankle = new THREE.Group(); ankle.position.y = -0.41; knee.add(ankle);
    ankle.add(mesh(geo.boot, m.boot, true));
    return { hip, knee, ankle };
  };
  const arm = z => {
    const sh = new THREE.Group(); sh.position.set(0, 0.5, z); torso.add(sh);
    sh.add(mesh(geo.shoulder, m.sleeve), mesh(geo.upper, m.skin, true), mesh(geo.sleeve, m.sleeve));
    const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
    el.add(mesh(geo.fore, m.skin));
    const hand = mesh(geo.hand, m.glove || m.skin); hand.position.y = -0.285; el.add(hand);
    return { sh, el };
  };
  const blob = new THREE.Mesh(geo.blob, m.blob); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.renderOrder = 1; g.add(blob);
  g.userData = { rig, hips, torso, chest, head, blob, legL: leg(0.096), legR: leg(-0.096), armL: arm(0.245), armR: arm(-0.245), sy: S * build.h,
    face: 0, ph: Math.random() * 6, spd: 0, mv: 0, lx: null, lz: 0, bank: 0, acc: 0, look: 0, lastSpd: 0, fwd: 1, side: 0 };
  return g;
}

// Sets every joint of one figure for this frame. `a` describes what he is doing:
//   speed (m/s), rel (direction of travel relative to where he faces), turn (rad/s), look (angle
//   to the ball relative to his body), plus at most one action (dive, slide, strike, cel, hold, ready).
function pose(u, a, dt, t, i) {
  const k10 = Math.min(1, dt * 10);
  u.spd += (a.speed - u.spd) * k10;
  u.acc += ((u.spd - u.lastSpd) / dt - u.acc) * Math.min(1, dt * 6); u.lastSpd = u.spd;
  const run = Math.min(1, u.spd / 7.5);
  u.mv += ((u.spd > 0.45 ? 1 : 0) - u.mv) * Math.min(1, dt * 9);
  // Moving forwards, backwards or sideways relative to the way he faces (jockeying defenders back-pedal and side-step).
  const rel = a.rel || 0;
  u.fwd += (Math.cos(rel) - u.fwd) * k10; u.side += (Math.sin(rel) - u.side) * k10;
  const back = u.fwd < -0.25;
  u.ph += dt * (4.2 + u.spd * 1.3) * u.mv * (back ? -1 : 1);
  const A = (0.22 + 0.78 * run) * u.mv, s = Math.sin(u.ph), c = Math.cos(u.ph);
  const stride = A * Math.max(0.35, Math.abs(u.fwd));
  const flex = ph => -(0.07 + u.mv * (0.32 + run * 1.3) * Math.max(0, Math.cos(ph + 0.6)));
  let hipL = s * stride * 0.95, hipR = -s * stride * 0.95, kneeL = flex(u.ph), kneeR = flex(u.ph + Math.PI);
  let spreadL = 0.03 + u.side * s * 0.38 * u.mv, spreadR = -0.03 + u.side * s * 0.38 * u.mv;      // side-steps open the legs
  const idle = 1 - u.mv, sway = Math.sin(t * 1.3 + i) * 0.045 * idle;
  let shL = -s * A * 0.9 + sway, shR = s * A * 0.9 - sway;
  // The arm coming forward bends more than the one going back.
  let elL = 0.2 + u.mv * (0.5 + run * 0.75) + Math.max(0, -s) * 0.35 * A, elR = 0.2 + u.mv * (0.5 + run * 0.75) + Math.max(0, s) * 0.35 * A;
  let abL = -0.1 - idle * 0.03, abR = 0.1 + idle * 0.03;
  let lean = -(0.03 + run * 0.25) * u.mv * Math.max(0, u.fwd) + (back ? 0.07 * u.mv : 0) - Math.max(-0.14, Math.min(0.14, u.acc * 0.016));
  let twist = s * 0.17 * A, y = (0.5 - 0.5 * Math.cos(u.ph * 2)) * 0.065 * A, roll = 0, pitch = 0, headZ = 0, drop = 0, sideLean = u.side * 0.08 * u.mv;
  // Leaning into a turn at speed.
  u.bank += (Math.max(-0.26, Math.min(0.26, (a.turn || 0) * u.spd * 0.016)) - u.bank) * Math.min(1, dt * 7);
  roll = -u.bank;
  let free = true;                                 // the head is free to follow the ball
  if (a.dribble) { abL -= 0.22; abR += 0.22; lean -= 0.05; }

  if (a.dive) {                                   // keeper throws himself across the goal
    const w = clamp01(a.dive.age / 0.2), far = Math.min(1, Math.abs(a.dive.reach) * 9);
    roll = a.dive.sign * 1.35 * w * far; y = 0.55 * w * far + 0.1 * w;
    shL = shR = lerp(shL, 2.95, w); elL = elR = 0.1; hipL = 0.25 * w; hipR = -0.2 * w; kneeL = kneeR = -0.35 * w; lean = 0; twist = 0; free = false;
  } else if (a.slide != null) {                   // slide tackle
    const w = Math.sin(Math.PI * clamp01(a.slide / 0.6)) ** 0.6;
    pitch = 1.12 * w; hipR = lerp(hipR, 1.25, w); kneeR = lerp(kneeR, 0, w); hipL = lerp(hipL, 0.5, w); kneeL = lerp(kneeL, -1.6, w);
    shL = lerp(shL, -0.9, w); shR = lerp(shR, -0.6, w); elL = elR = 0.3; lean = lerp(lean, 0.2, w); y *= 1 - w; roll *= 1 - w;
  } else if (a.strike != null) {                  // pass or shot: plant, wind up, strike, follow through
    const q = a.strike, p = a.power, w = q < 0.4 ? 1 : clamp01((0.55 - q) / 0.15);
    let hip, knee;
    if (q < 0.12) { const k = q / 0.12; hip = -0.95 * k * p; knee = -1.55 * k * p; }
    else if (q < 0.22) { const k = (q - 0.12) / 0.1; hip = lerp(-0.95, 1.2, k) * p; knee = -1.55 * (1 - k) * p; }
    else { const k = clamp01((q - 0.22) / 0.3); hip = 1.2 * (1 - k) * p; knee = -0.25 * k; }
    hipR = lerp(hipR, hip, w); kneeR = lerp(kneeR, knee, w); hipL = lerp(hipL, -0.12, w); kneeL = lerp(kneeL, -0.24, w);
    shL = lerp(shL, 0.75 * p, w); shR = lerp(shR, -0.8 * p, w); abL = lerp(abL, -0.55, w); abR = lerp(abR, 0.4, w);
    lean = lerp(lean, q < 0.2 ? -0.12 : 0.14 * p, w); twist = lerp(twist, q < 0.2 ? -0.3 * p : 0.35 * p, w); y *= 1 - w; headZ = -0.25 * w;
  } else if (a.cel === 'scorer') {
    if (u.spd > 1.6) { abL = -1.45; abR = 1.45; shL = shR = 0; elL = elR = 0.08; lean -= 0.05; headZ = 0.15; }          // arms out, wheeling away
    else { const k = Math.abs(Math.sin(t * 5.5)); y += k * 0.5; shL = 2.75 + Math.sin(t * 11) * 0.25; shR = 2.75 - Math.sin(t * 11) * 0.25; elL = elR = 0.35; kneeL = kneeR = -0.5 * (1 - k); headZ = 0.2; }
    free = false;
  } else if (a.cel === 'mate') {
    if (u.spd > 1.6) { shR = 2.4; elR = 0.3; }
    else { const k = Math.abs(Math.sin(t * 6 + i)); y += k * 0.42; shL = shR = 2.6 + Math.sin(t * 9 + i) * 0.3; elL = elR = 0.25; kneeL = kneeR = -0.45 * (1 - k); }
  } else if (a.cel === 'sad') {                   // hands on hips, head down
    lean = Math.min(lean, -0.2); headZ = -0.5; abL = -0.5; abR = 0.5; shL = shR = -0.25; elL = elR = 1.35; free = false;
  } else if (a.hold) { shL = shR = 1.15; elL = elR = 0.9; abL = 0.12; abR = -0.12; }                       // keeper with the ball in his hands
  else if (a.ready) { kneeL = Math.min(kneeL, -0.42); kneeR = Math.min(kneeR, -0.42); hipL += 0.22; hipR += 0.22; lean -= 0.14; abL = -0.6; abR = 0.6; elL = elR = 0.5; drop = 0.05; spreadL += 0.12; spreadR -= 0.12; }  // keeper set for a shot

  u.legL.hip.rotation.set(spreadL, 0, hipL); u.legR.hip.rotation.set(spreadR, 0, hipR); u.legL.knee.rotation.z = kneeL; u.legR.knee.rotation.z = kneeR;
  // Feet stay close to level on the ground and point down as the leg trails.
  u.legL.ankle.rotation.z = Math.max(-0.7, Math.min(0.5, -(hipL + kneeL) * 0.7)); u.legR.ankle.rotation.z = Math.max(-0.7, Math.min(0.5, -(hipR + kneeR) * 0.7));
  u.armL.sh.rotation.set(abL, 0, shL); u.armR.sh.rotation.set(abR, 0, shR); u.armL.el.rotation.z = elL; u.armR.el.rotation.z = elR;
  u.torso.rotation.set(sideLean, twist, lean); u.hips.rotation.y = -twist * 0.55;
  u.chest.scale.y = 1 + Math.sin(t * 2.1 + i * 1.7) * 0.012 * (0.4 + idle);          // breathing
  // Eyes on the ball: the head turns towards it (within what a neck allows) and tips down when it is close.
  const want = free ? Math.max(-1.15, Math.min(1.15, (a.look || 0) - twist)) : 0;
  u.look += (want - u.look) * Math.min(1, dt * 6);
  u.head.rotation.set(0, u.look, headZ + (free && a.near ? -0.22 : 0) - lean * 0.6);
  u.rig.rotation.set(roll, 0, pitch); u.rig.position.y = (y - drop) * u.sy;
  u.blob.scale.setScalar(1 - Math.min(0.6, y * 0.9));
}

export async function createView(container, { homeHue = 210, awayHue = 0, cam = () => 'tv', boards = ['THE GAFFER'] } = {}) {
  if (!container) throw new Error('no container');
  const low = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || window.innerWidth < 720;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(low ? 1.75 : 2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe0fb);
  scene.fog = new THREE.Fog(0xbfe0fb, 220, 560);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 900);
  camera.position.set(0, 17, 40);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 16, 12), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x3d6b3a, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.position.set(-45, 85, 40);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 240 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55); fill.position.set(50, 60, -40); scene.add(fill);

  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PX, PZ), new THREE.MeshLambertMaterial({ map: pitchTexture() }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(PX + 400, PZ + 400), new THREE.MeshLambertMaterial({ color: 0x6f7c88 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; scene.add(ground);
  const nets = { '-1': buildGoal(scene, -1), '1': buildGoal(scene, 1) };
  const { crowds, flashSpots } = buildStands(scene, homeHue, awayHue, low);
  buildFloodlights(scene);
  const boardMat = buildBoards(scene, boards);
  const flags = buildCornerFlags(scene);

  // ── Players ──
  const geo = playerGeometry();
  const lam = c => new THREE.MeshLambertMaterial({ color: c });
  const blobTex = blobTexture();
  const skinCols = [0xf1c9a5, 0xd9a066, 0x8d5524, 0x5c3a21, 0xe6b98a];
  const skins = skinCols.map(lam), faces = skinCols.map(c => new THREE.MeshLambertMaterial({ map: faceTexture(c) }));
  const hairs = [0x1a1410, 0x3b2a1a, 0x0c0c0c, 0xc9a45a, 0x6b3a1c].map(lam);
  const boots = [0x15181d, 0xf2f2f2, 0xff5a1f, 0x21d07a, 0x2aa7ff].map(lam);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
  const kitCol = h => new THREE.Color().setHSL(h / 360, 0.78, 0.48);
  const team = {
    home: { hue: homeHue, pattern: Math.round(homeHue / 7) % 4, sleeve: lam(kitCol(homeHue)), shorts: lam(0xf4f4f4), sock: lam(kitCol(homeHue)) },
    away: { hue: awayHue, pattern: Math.round(awayHue / 11) % 4, sleeve: lam(kitCol(awayHue)), shorts: lam(0x1d2330), sock: lam(0x1d2330) },
  };
  const gkKit = { home: ['#f2d21f', 0xf2d21f], away: ['#31d17c', 0x31d17c] };
  const gloves = lam(0xffffff);
  const players = { home: [], away: [] };
  const refMats = { shirt: new THREE.MeshLambertMaterial({ map: shirtTexture(0, 0, null, '#16181c') }), sleeve: lam(0x16181c), shorts: lam(0x16181c), sock: lam(0x16181c), skin: skins[1], face: faces[1], hair: hairs[0], hairStyle: 0, boot: boots[0], blob: blobMat };
  const referee = makePlayer(geo, refMats); referee.position.set(-6, 0, 8); scene.add(referee);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16), new THREE.MeshLambertMaterial({ map: ballTexture() }));
  ball.castShadow = true; scene.add(ball);
  const ballBlob = new THREE.Mesh(geo.blob, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })); ballBlob.rotation.x = -Math.PI / 2; ballBlob.position.y = 0.035; ballBlob.renderOrder = 1; scene.add(ballBlob);
  // Trail behind a fast ball
  const TRAIL = 7, trailGeo = new THREE.SphereGeometry(BALL_R * 0.85, 8, 6), trail = [], hist = [];
  for (let i = 0; i < TRAIL; i++) { const tm = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); tm.visible = false; scene.add(tm); trail.push(tm); }
  // Marker for the player on the ball: a ring at his feet and a pointer over his head
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 28), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.renderOrder = 2; scene.add(ring);
  const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4), new THREE.MeshBasicMaterial({ color: 0xffe14d })); pointer.rotation.x = Math.PI; scene.add(pointer);

  // ── Particles: turf spray on a kick, confetti on a goal ──
  const PN = low ? 160 : 300;
  const pPos = new Float32Array(PN * 3).fill(-999), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pGrav = new Float32Array(PN);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, depthWrite: false }));
  points.frustumCulled = false; scene.add(points);
  let pNext = 0;
  const tmpCol = new THREE.Color();
  function emit(x, y, z, vx, vy, vz, color, life, grav) {
    const i = pNext; pNext = (pNext + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    tmpCol.set(color); pCol[i * 3] = tmpCol.r; pCol[i * 3 + 1] = tmpCol.g; pCol[i * 3 + 2] = tmpCol.b; pLife[i] = life; pGrav[i] = grav;
  }
  // Camera flashes in the stands
  const FN = 40, fPos = new Float32Array(FN * 3).fill(-999), fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  const flashes = new THREE.Points(fGeo, new THREE.PointsMaterial({ size: 2.2, color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  flashes.frustumCulled = false; flashes.visible = false; scene.add(flashes);

  const look = new THREE.Vector3(0, 0, 0), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), prevBall = new THREE.Vector3();
  const label = container.querySelector('#mvLabel');
  let viewW = 640;
  function resize() {
    const w = container.clientWidth || 640, h = container.clientHeight || 360;
    viewW = w;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);

  function ensurePlayers(v) {
    for (const side of ['home', 'away']) {
      if (players[side].length) continue;
      const lineup = (v.m.lineups && v.m.lineups[side]) || [];
      const tm = team[side];
      let num = 1;
      v.dots[side].forEach((d, i) => {
        const gk = lineup[i] && lineup[i].slot === 'GK';
        const n = Math.abs(Number(d.id) || i * 7 + 3), number = gk ? 1 : ++num;
        const mats = gk
          ? { shirt: new THREE.MeshLambertMaterial({ map: shirtTexture(0, 0, number, gkKit[side][0]) }), sleeve: lam(gkKit[side][1]), shorts: lam(0x20242c), sock: lam(gkKit[side][1]), glove: gloves }
          : { shirt: new THREE.MeshLambertMaterial({ map: shirtTexture(tm.hue, tm.pattern, number) }), sleeve: tm.sleeve, shorts: tm.shorts, sock: tm.sock };
        Object.assign(mats, { skin: skins[n % skins.length], face: faces[n % skins.length], hair: hairs[(n >> 2) % hairs.length], hairStyle: (n >> 4) % 4, boot: boots[(n >> 1) % boots.length], blob: blobMat,
          build: { h: 0.95 + (n % 7) * 0.017 + (gk ? 0.03 : 0), w: 0.96 + ((n >> 3) % 5) * 0.024 } });   // no two players are the same size
        const p = makePlayer(geo, mats);
        p.userData.face = side === 'home' ? 0 : Math.PI;
        p.userData.gk = !!gk;
        scene.add(p);
        players[side].push(p);
      });
    }
  }

  const wrap = d => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  const turn = (u, want, k) => { const step = wrap(want - u.face) * Math.min(1, k); u.face += step; return step; };
  let lastNow = 0, lastStrike = null, lastCel = null, lastSimT = null;
  const refPos = { x: -6, z: 8 };

  return {
    render(v, now) {
      ensurePlayers(v);
      const t = now / 1000, sim = v.sim || {};
      const dt = lastNow ? Math.min(0.1, Math.max(0.001, (now - lastNow) / 1000)) : 0.016; lastNow = now;
      const frozen = sim.t === lastSimT; lastSimT = sim.t;                 // paused: hold the pose
      const cel = sim.phase === 'celebrate' ? sim.celebrate : null;
      const bx = (v.ball.x - 0.5) * L, bz = (v.ball.y - 0.5) * W, by = BALL_R + (v.ball.z || 0) * 6;
      const strikeAge = sim.strike ? sim.t - sim.strike.t0 : 9, tackleAge = sim.tackle ? sim.t - sim.tackle.t0 : 9;
      const threat = !!sim.attack && sim.phase === 'play';

      for (const side of ['home', 'away']) {
        v.dots[side].forEach((d, i) => {
          const p = players[side][i]; if (!p) return;
          p.visible = !d.off;
          if (d.off) return;
          const u = p.userData;
          const px = (d.x - 0.5) * L, pz = (d.y - 0.5) * W;
          const mvx = u.lx == null ? 0 : px - u.lx, mvz = u.lx == null ? 0 : pz - u.lz;
          const speed = frozen ? 0 : Math.hypot(mvx, mvz) / dt;
          u.lx = px; u.lz = pz;
          p.position.x = px; p.position.z = pz;
          if (frozen) return;
          const a = { speed: Math.min(speed, 11), power: 1 };
          const isHolder = sim.poss === side && sim.holder === i;
          if (cel) a.cel = side !== cel.side ? 'sad' : i === cel.scorer ? 'scorer' : u.gk ? null : 'mate';
          else if (sim.dive && sim.dive.side === side && sim.dive.idx === i && sim.phase === 'shot') a.dive = { age: sim.t - sim.dive.t0, reach: sim.dive.y - d.y, sign: (Math.sign(sim.dive.y - d.y) || 1) * (Math.cos(u.face) >= 0 ? 1 : -1) };
          else if (sim.tackle && sim.tackle.side === side && sim.tackle.idx === i && tackleAge < 0.6) a.slide = tackleAge;
          else if (sim.strike && sim.strike.side === side && sim.strike.idx === i && strikeAge < 0.55) { a.strike = strikeAge; a.power = sim.strike.power || 0.7; }
          else if (sim.phase === 'held' && !sim.goalKick && isHolder && u.gk) a.hold = true;
          else if (u.gk && threat && sim.attack.side !== side) a.ready = true;
          // Where he looks: the man on the ball and anyone sprinting face the way they run; everyone
          // else keeps his body towards the ball and back-pedals or side-steps (as real players do).
          const moveAng = Math.atan2(-mvz, mvx), ballAng = Math.atan2(-(bz - pz), bx - px), ballDist = Math.hypot(bx - px, bz - pz);
          const dribble = isHolder && sim.phase === 'play' && !sim.pass;
          const jockey = !dribble && !cel && speed < 3.6 && ballDist > 1.5;
          let want = speed < 0.9 || jockey || a.dive || a.ready || a.hold ? ballAng : moveAng;
          if (a.strike != null && sim.strike.dir) want = Math.atan2(-sim.strike.dir[1] * W, sim.strike.dir[0] * L);
          if (a.cel === 'sad' && speed < 0.9) want = u.face;
          const turned = turn(u, want, dt * (a.strike != null ? 22 : 9));
          p.rotation.y = u.face;
          a.turn = turned / dt; a.rel = speed > 0.5 ? wrap(moveAng - u.face) : 0; a.look = wrap(ballAng - u.face); a.near = ballDist < 7 && by < 1.2; a.dribble = dribble;
          pose(u, a, dt, t, i);
        });
      }

      // Referee keeps up with play, a few metres off the ball
      if (!frozen) {
        const rx = Math.max(-L / 2 + 4, Math.min(L / 2 - 4, bx - 7)), rz = Math.max(-W / 2 + 4, Math.min(W / 2 - 4, bz + (bz > 0 ? -9 : 9)));
        const dx = rx - refPos.x, dz = rz - refPos.z, dist = Math.hypot(dx, dz), u = referee.userData;
        const stepLen = Math.min(dist, (dist > 4 ? 6.5 : dist > 1.5 ? 2.5 : 0) * dt);
        if (dist > 0.01) { refPos.x += dx / dist * stepLen; refPos.z += dz / dist * stepLen; }
        referee.position.set(refPos.x, 0, refPos.z);
        const refTurn = turn(u, stepLen / dt > 0.9 ? Math.atan2(-dz, dx) : Math.atan2(-(bz - refPos.z), bx - refPos.x), dt * 8);
        referee.rotation.y = u.face;
        pose(u, { speed: stepLen / dt, power: 1, turn: refTurn / dt, look: wrap(Math.atan2(-(bz - refPos.z), bx - refPos.x) - u.face) }, dt, t, 30);
      }

      // Ball: position, spin from its movement, shadow, trail
      ball.position.set(bx, by, bz);
      tmp.copy(ball.position).sub(prevBall); prevBall.copy(ball.position);
      const moved = tmp.length(), ballSpeed = moved / dt;
      if (moved > 0.001 && moved < 20) { ball.rotation.z -= tmp.x / BALL_R; ball.rotation.x += tmp.z / BALL_R; }
      ballBlob.position.x = bx; ballBlob.position.z = bz;
      const bh = Math.min(1, (by - BALL_R) / 6);
      ballBlob.scale.setScalar(0.5 + bh * 0.9); ballBlob.material.opacity = 0.9 - bh * 0.6;
      if (!frozen) { hist.unshift([bx, by, bz]); if (hist.length > TRAIL + 1) hist.pop(); }
      const fast = !frozen && ((ballSpeed > 17 && ballSpeed < 200) || sim.phase === 'shot');
      trail.forEach((tm, i) => {
        const h = hist[i + 1];
        const target = fast && h ? 0.34 * (1 - i / TRAIL) : 0;
        tm.material.opacity += (target - tm.material.opacity) * 0.4;
        tm.visible = tm.material.opacity > 0.02 && !!h;
        if (h) { tm.position.set(h[0], h[1], h[2]); tm.scale.setScalar(1 - i * 0.09); }
      });

      // Turf spray when the ball is struck; confetti and flashes when a goal goes in
      if (sim.strike && sim.strike !== lastStrike) {
        lastStrike = sim.strike;
        const n = sim.strike.power > 0.9 ? 12 : 5;
        for (let i = 0; i < n; i++) emit(bx, 0.1, bz, (Math.random() - 0.5) * 5, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 5, Math.random() < 0.7 ? 0x4fb85a : 0xe9ffe0, 0.5 + Math.random() * 0.3, -12);
      }
      if (cel && cel !== lastCel) {
        const cols = [kitCol(team[cel.side].hue).getHex(), 0xffffff, 0xffd23f];
        const sc = v.dots[cel.side][cel.scorer], cx = (sc.x - 0.5) * L, cz = (sc.y - 0.5) * W;
        for (let i = 0; i < PN - 20; i++) emit(cx + (Math.random() - 0.5) * 44, 2.5 + Math.random() * 11, cz * 0.7 + (Math.random() - 0.5) * 34, (Math.random() - 0.5) * 3, -1 - Math.random() * 2, (Math.random() - 0.5) * 3, cols[i % 3], 4 + Math.random() * 2.5, -1.2);
      }
      lastCel = cel;
      if (!frozen) {
        for (let i = 0; i < PN; i++) {
          if (pLife[i] <= 0) continue;
          pLife[i] -= dt;
          if (pLife[i] <= 0 || pPos[i * 3 + 1] < 0) { pLife[i] = 0; pPos[i * 3 + 1] = -999; continue; }
          pVel[i * 3 + 1] += pGrav[i] * dt;
          if (pGrav[i] > -5) { pVel[i * 3] += Math.sin(t * 5 + i) * dt * 4; pVel[i * 3 + 1] = Math.max(pVel[i * 3 + 1], -3.2); }   // confetti flutters
          pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
        }
        pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
      }
      flashes.visible = !!cel;
      if (cel && !frozen) {
        for (let i = 0; i < FN; i++) {
          if (Math.random() < 0.35) { const k = Math.floor(Math.random() * (flashSpots.length / 3)) * 3; fPos[i * 3] = flashSpots[k]; fPos[i * 3 + 1] = flashSpots[k + 1]; fPos[i * 3 + 2] = flashSpots[k + 2]; }
          else fPos[i * 3 + 1] = -999;
        }
        fGeo.attributes.position.needsUpdate = true;
      }

      // Net bulges when the ball hits it
      for (const k of ['-1', '1']) nets[k].scale.x = 1;
      if (sim.net) { const age = sim.t - sim.net.t0; const n = nets[sim.net.side === 'home' ? '1' : '-1']; if (age < 1.2) n.scale.x = 1 + Math.sin(Math.min(1, age / 0.5) * Math.PI) * 0.55; }
      // Crowd: gentle sway, a bigger bounce as a chance builds, jumping on a goal
      const amp = cel ? 0.42 : threat ? 0.12 : 0.03, beat = cel ? 7 : 3;
      crowds[0].position.y = Math.abs(Math.sin(t * beat)) * amp;
      crowds[1].position.y = Math.abs(Math.sin(t * beat + 1.3)) * amp;
      boardMat.map.offset.x = t * 0.012;
      flags.forEach((f, i) => { f.rotation.y = Math.sin(t * 3 + i) * 0.5; });

      // Marker and name tag for the player on the ball
      const hd = sim.poss && (sim.phase === 'play' || sim.phase === 'held') && !sim.pass ? v.dots[sim.poss][sim.holder] : cel ? v.dots[cel.side][cel.scorer] : null;
      const showMark = !!hd && !hd.off;
      ring.visible = pointer.visible = showMark;
      if (showMark) {
        const hx = (hd.x - 0.5) * L, hz = (hd.y - 0.5) * W, up = cel ? 0.6 : 0;
        ring.position.x = hx; ring.position.z = hz; ring.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
        pointer.position.set(hx, 2.75 + up + Math.sin(t * 5) * 0.08, hz); pointer.rotation.y = t * 2.5;
        if (label) {
          tmp.set(hx, 3.25 + up, hz).project(camera);
          label.style.display = tmp.z < 1 && !cel ? 'block' : 'none';      // the GOAL banner already names the scorer
          label.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`; label.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
          const nm = (hd.name || '').split(' ').slice(-1)[0]; if (label.textContent !== nm) label.textContent = nm;
        }
      } else if (label) label.style.display = 'none';

      // Cameras (smoothing is frame-rate independent)
      const mode = cam(), ease = r => 1 - Math.exp(-dt * r);
      const near = Math.max(0.74, Math.min(1, viewW / 760));      // small screens sit closer to the action
      if (cel) {                                   // close-up on the scorer
        const sc = v.dots[cel.side][cel.scorer]; const sx = (sc.x - 0.5) * L, sz = (sc.y - 0.5) * W;
        camTarget.set(sx * 0.86, 4.6, sz + (sz > 0 ? -13 : 13)); tmp.set(sx, 1.5, sz); look.lerp(tmp, ease(6));
        camera.position.lerp(camTarget, ease(2.6));
      } else {
        if (mode === 'high') { camTarget.set(bx * 0.25, 88, 36); tmp.set(bx * 0.3, 0, 0); look.lerp(tmp, ease(5)); }
        else if (mode === 'goal') { const s = bx >= 0 ? 1 : -1; camTarget.set(s * (L / 2 + 15), 10, bz * 0.25); tmp.set(bx - s * 6, 1, bz * 0.6); look.lerp(tmp, ease(5)); }
        else if (mode === 'close') { camTarget.set(bx * 0.93, 8.5, bz + 23); tmp.set(bx, 1.1, bz * 0.92); look.lerp(tmp, ease(6)); }
        else { const zoom = (Math.abs(bx) > 30 ? 0.9 : 1) * near; camTarget.set(bx * 0.86, 15 * zoom, 34 * zoom + bz * 0.38); tmp.set(bx * 0.94, 0.8, bz * 0.6); look.lerp(tmp, ease(4.5)); }
        camera.position.lerp(camTarget, ease(3));
      }
      camera.lookAt(look);
      if (sim.net) { const age = sim.t - sim.net.t0; if (age < 0.55) { const k = (1 - age / 0.55) * 0.3; camera.position.y += Math.sin(age * 46) * k; camera.position.x += Math.cos(age * 39) * k * 0.6; } }
      renderer.render(scene, camera);
    },
    dispose() {
      if (ro) ro.disconnect();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
