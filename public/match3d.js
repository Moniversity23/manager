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

function skyTexture(night) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  if (night) { gr.addColorStop(0, '#02040a'); gr.addColorStop(0.38, '#08142b'); gr.addColorStop(0.5, '#1a2c4a'); gr.addColorStop(1, '#1a2c4a'); }
  else { gr.addColorStop(0, '#1f5fc4'); gr.addColorStop(0.38, '#4f95e6'); gr.addColorStop(0.5, '#bfe0fb'); gr.addColorStop(1, '#bfe0fb'); }
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

// The ground: its size follows the club's capacity — a small ground has low terraces and open
// ends, a mid-sized one covered stands, a big one a second tier — and the crowd fills it to the
// expected attendance. The design (roof colour) is fixed per club by its name.
function groundDesign(ground = {}) {
  const cap = ground.capacity || 20000;
  const size = cap < 9000 ? 'small' : cap < 32000 ? 'mid' : 'big';
  let h = 7; for (const c of String(ground.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { size, fill: Math.max(0.15, Math.min(1, (ground.attendance || cap * 0.7) / cap)), roof: [0xdfe6ee, 0x3a4250, 0x9aa6b4][h % 3], seed: (h % 1000) + 7 };
}
function buildStands(scene, homeHue, awayHue, low, ground) {
  const design = groundDesign(ground);
  const concrete = new THREE.MeshLambertMaterial({ color: 0x55606f });
  const wall = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(homeHue / 360, 0.6, 0.32) });
  const roofMat = new THREE.MeshLambertMaterial({ color: design.roof });
  const tiersFor = (end) => design.size === 'small' ? (end ? 3 : 5) : design.size === 'mid' ? (end ? 6 : 8) : 9;
  const stands = [
    { cx: 0, cz: -(PZ / 2 + 9), w: PX + 10, rot: 0 }, { cx: 0, cz: PZ / 2 + 9, w: PX + 10, rot: Math.PI },
    { cx: -(PX / 2 + 9), cz: 0, w: PZ, rot: Math.PI / 2 }, { cx: PX / 2 + 9, cz: 0, w: PZ, rot: -Math.PI / 2 },
  ];
  const seats = [];
  const gap = low ? 1.5 : 1.1;
  for (const st of stands) {
    const grp = new THREE.Group(); grp.position.set(st.cx, 0, st.cz); grp.rotation.y = st.rot; scene.add(grp);
    const front = new THREE.Mesh(new THREE.BoxGeometry(st.w, 1.3, 0.3), wall); front.position.set(0, 0.65, 8.1); grp.add(front);
    const end = Math.abs(st.rot) === Math.PI / 2, tiers = tiersFor(end);
    for (let tier = 0; tier < tiers; tier++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(st.w, 1.2, 2), concrete);
      step.position.set(0, 0.6 + tier * 1.2, 7 - tier * 2);
      grp.add(step);
      for (let i = -st.w / 2 + 1; i < st.w / 2 - 1; i += gap) seats.push({ grp, x: i, y: 1.6 + tier * 1.2, z: -tier * 2 + 7 });
    }
    const top = 0.6 + tiers * 1.2;
    const back = new THREE.Mesh(new THREE.BoxGeometry(st.w, top + 2.6, 0.5), concrete); back.position.set(0, (top + 2.6) / 2, 7 - tiers * 2 - 1.2); grp.add(back);
    // A big ground has an upper tier above the side stands.
    if (design.size === 'big' && !end) {
      for (let tier = 0; tier < 5; tier++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(st.w, 1.2, 2), concrete);
        step.position.set(0, top + 3.2 + tier * 1.3, -8 - tier * 2);
        grp.add(step);
        if (!low) for (let i = -st.w / 2 + 1; i < st.w / 2 - 1; i += gap * 1.15) seats.push({ grp, x: i, y: top + 4.2 + tier * 1.3, z: -8 - tier * 2 });
      }
    }
    // Roofs: none over a small ground's ends; the main stand (where the TV camera sits) has none in shot.
    const roofY = design.size === 'big' && !end ? top + 10.5 : top + 2.4;
    if ((st.cz <= 0 || st.rot !== Math.PI) && !(design.size === 'small' && end)) { const roof = new THREE.Mesh(new THREE.BoxGeometry(st.w, 0.4, 17), roofMat); roof.position.set(0, roofY, -2 - (design.size === 'big' && !end ? 6 : 0)); roof.rotation.x = 0.06; grp.add(roof); }
  }
  // Fill to the expected attendance (the same seats stay empty for the whole match).
  { let sd = design.seed; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }; for (let i = seats.length - 1; i >= 0; i--) if (r() > design.fill) seats.splice(i, 1); }
  // Crowd: two instanced meshes (alternate fans) so they can bounce out of step.
  // Every fan has a team (home, away or neutral), a rhythm and an energy level; the shader below
  // moves each one: home fans jump with their arms up when their team scores, the other side's
  // fans slump, everyone rises as a chance builds, and now and then a wave goes round the ground.
  const fan = new THREE.BoxGeometry(0.6, 0.95, 0.45);
  const crowdU = { uTime: { value: 0 }, uMood: { value: new THREE.Vector2(0, 0) }, uTension: { value: 0 }, uWave: { value: -1 } };
  const fanMat = new THREE.MeshLambertMaterial();
  fanMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, crowdU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aFan;\nuniform float uTime;\nuniform vec2 uMood;\nuniform float uTension;\nuniform float uWave;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float mood = aFan.y < 0.25 ? uMood.x : aFan.y > 0.75 ? uMood.y : 0.25 * (uMood.x + uMood.y);
        float joy = max(mood, 0.0) * aFan.z, gloom = max(-mood, 0.0);
        float hop = max(0.0, sin(uTime * (3.0 + 4.5 * joy) + aFan.x * 6.2832));
        float waveAmt = 0.0;
        #ifdef USE_INSTANCING
        if (uWave >= 0.0) {
          float ang = atan(instanceMatrix[3].z, instanceMatrix[3].x);
          float front = mod(uWave * 1.4, 6.2832) - 3.1416;
          float d = abs(mod(ang - front + 3.1416, 6.2832) - 3.1416);
          waveAmt = smoothstep(0.55, 0.0, d);
        }
        #endif
        transformed.y *= 1.0 + 0.35 * joy + 0.3 * waveAmt;
        transformed.y += hop * (0.02 + 0.09 * uTension * aFan.z + 0.45 * joy) + 0.28 * waveAmt - 0.13 * gloom;`);
  };
  const half = [Math.max(1, Math.ceil(seats.length / 2)), Math.max(1, Math.floor(seats.length / 2))];
  const crowds = [new THREE.InstancedMesh(fan, fanMat, half[0]), new THREE.InstancedMesh(fan.clone(), fanMat, half[1])];
  const fanAttr = [new Float32Array(half[0] * 3), new Float32Array(half[1] * 3)];
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
    const fa = fanAttr[i % 2], j = (i >> 1) * 3;
    fa[j] = rnd(); fa[j + 1] = r < 0.45 ? 0 : r < 0.6 ? 1 : 0.5; fa[j + 2] = 0.55 + rnd() * 0.45;   // rhythm, team, energy
    if (i % 7 === 0) flashSpots.push(v.x, v.y + 0.7, v.z);
  });
  crowds.forEach((c, k) => { c.geometry.setAttribute('aFan', new THREE.InstancedBufferAttribute(fanAttr[k], 3)); c.instanceMatrix.needsUpdate = true; c.frustumCulled = false; scene.add(c); });
  return { crowds, flashSpots, crowdU };
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,245,1)'); gr.addColorStop(0.18, 'rgba(255,248,215,.75)'); gr.addColorStop(0.45, 'rgba(255,240,190,.18)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Four floodlight towers. At night each one lights the pitch (and casts its own shadow under every
// player, the X of shadows you see at a floodlit match) and wears a glowing halo.
const TOWERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => [x * (PX / 2 + 16), 36, z * (PZ / 2 + 16)]);
function buildFloodlights(scene, night) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xb9c2ce });
  const lamp = new THREE.MeshBasicMaterial({ color: night ? 0xffffff : 0xfffbe8 });
  const glow = night ? new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff6dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }) : null;
  for (const [px, py, pz] of TOWERS) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 36, 8), mat); pole.position.set(px, 18, pz); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3.4, 0.6), lamp); head.position.set(px, py, pz); head.lookAt(0, 0, 0); scene.add(head);
    if (glow) {
      const sp = new THREE.Sprite(glow); sp.scale.set(34, 34, 1); sp.position.set(px * 0.985, py, pz * 0.985); scene.add(sp);
      const l = new THREE.DirectionalLight(0xfff4e0, 0.62); l.position.set(px, py + 6, pz); scene.add(l);
    }
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
// Palettes shared with the portraits in index.html (keep them in step).
const SKIN_PAL = ['#f6d7c3', '#ecc0a0', '#dca67f', '#c98d62', '#ad724a', '#8d5636', '#6c3f26', '#4a2a19'];
const HAIR_PAL = ['#16110d', '#3a2618', '#5c3b22', '#8a6237', '#d8b46a', '#a8481f'];
const EYE_PAL = ['#3b2416', '#5a3a1e', '#3f6f8f', '#4f7a45'];
const greyed = (hex, g) => new THREE.Color(hex).lerp(new THREE.Color('#b9b4ad'), Math.min(1, g || 0));

// Face painted on the head sphere (the front of the head is at u = 0.5).
// ── Faces and bodies ──────────────────────────────────────────────────────────────────────────────
// Every player has a face of his own: skull proportions, jaw, chin, cheekbones, brow, nose, eyes,
// lips and ears; and a body of his own: shoulders, chest, waist, arms, legs and muscle. A Player
// Studio profile sets them (public/appearance.js); otherwise they come from a hash of his player id
// — the same face every match, never random.
const FACE_SHAPE = { oval: [0.97, 1.18, 0.86], round: [1.0, 1.1, 0.94], square: [0.99, 1.13, 0.92], long: [0.95, 1.25, 0.83], diamond: [0.96, 1.18, 0.85], heart: [0.96, 1.15, 0.88] };
// Where the features sit (unit sphere, y up): the eyes at mid-height, as on an adult face. The 3D
// features and the painted face both use these, so they always line up.
const FY = { brow: 0.25, eye: 0.08, bridge: 0.14, nostril: -0.2, tip: -0.15, lipUp: -0.41, mouth: -0.455, lipLow: -0.5 };
const texY = y => 128 * Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;      // unit height → row of the face texture
const LEGACY_SHAPE = ['oval', 'long', 'square', 'diamond'];
function hash32(n) { let h = (Math.imul(n | 0, 2654435761) ^ 0x9e3779b9) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
function faceOf(lk) {
  const seed = lk ? (lk.faceSeed ?? ((lk.skin || 0) * 131 + (lk.head || 0) * 37 + (lk.eyes || 0) * 11 + (lk.brows || 0) * 7 + (lk.build || 0) * 3 + (lk.heightCm || 180))) : 1;
  let h = hash32(seed + 7); const r = () => { h = hash32(h + 1); return h / 4294967296; };
  const f = { shape: LEGACY_SHAPE[(lk && lk.head) || 0] || 'oval', jaw: 0.3 + r() * 0.5, chin: 0.3 + r() * 0.45, cheek: 0.3 + r() * 0.5, brow: 0.35 + r() * 0.4,
    nose: 0.3 + r() * 0.5, ear: 0.4 + r() * 0.3, lip: 0.35 + r() * 0.4, eye: 0.4 + r() * 0.3, hairline: 0.4 + r() * 0.3 };
  return lk && lk.face ? { ...f, ...lk.face } : f;
}
function bodyOf(lk) {
  const b = lk ? (lk.build ?? 7) / 15 : 0.5;
  const base = { shoulders: 0.35 + b * 0.35, chest: 0.4 + b * 0.25, waist: 0.45 + b * 0.15, arms: 0.5, legs: 0.5, muscle: 0.3 + b * 0.45 };
  return lk && lk.body ? { ...base, ...lk.body } : base;
}
const q10 = v => (typeof v === 'number' ? Math.round(v * 10) : v);

// The skull: a sphere sculpted into a head — taller than wide, the lower face narrowing to the jaw,
// a chin, cheekbones, a brow ridge and eye sockets. Cached per shape (a squad shares a handful).
const HEAD_CACHE = new Map();
function headGeometry(face) {
  const key = [face.shape, face.jaw, face.chin, face.cheek, face.brow].map(q10).join('|');
  let g = HEAD_CACHE.get(key); if (g) return g;
  g = new THREE.SphereGeometry(0.115, 30, 24);
  const sc = FACE_SHAPE[face.shape] || FACE_SHAPE.oval, P = g.attributes.position, v = new THREE.Vector3();
  const jawW = 0.68 + face.jaw * 0.24;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).divideScalar(0.115);
    let { x, y, z } = v;
    if (y < 0) {                                                                                  // cheeks → jawline → chin
      const d = -y, w = d < 0.45 ? 1 - 0.07 * (d / 0.45) : d < 0.85 ? 0.93 + (jawW - 0.93) * ((d - 0.45) / 0.4) : jawW + (0.45 - jawW) * Math.min(1, (d - 0.85) / 0.15);
      z *= w; if (x > 0) z *= 1 - 0.08 * Math.min(1, d) * x; y *= 1.06;
    }
    if (y < -0.5 && x > 0.2) { const t = Math.min(1, (-y - 0.5) / 0.45) * (x - 0.2) / 0.8; x += t * (0.05 + face.chin * 0.1); y -= t * 0.04 * face.chin; }   // chin
    { const t = Math.exp(-((y + 0.06) ** 2) / 0.02) * Math.max(0, x); z *= 1 + t * (face.cheek - 0.4) * 0.12; }                 // cheekbones
    if (x > 0.55 && y > 0.1 && y < 0.4) { const t = Math.exp(-((y - 0.22) ** 2) / 0.005) * (x - 0.55) / 0.45; x += t * (0.025 + face.brow * 0.035); }   // brow
    { const dz = Math.abs(z) - 0.3, dy = y - 0.08; const t = Math.exp(-(dz * dz + dy * dy) / 0.01) * Math.max(0, x - 0.6) / 0.4; x -= t * 0.045; }   // eye sockets
    if (y > 0.05 && y < 0.35 && x > 0.4) { const t = Math.exp(-(z * z) / 0.002) * Math.exp(-((y - 0.16) ** 2) / 0.008); x += t * 0.015; }   // bridge of the nose
    if (x < -0.1 && y > -0.2) x *= 1.04;                                                                                         // back of the skull
    if (y < -0.9) y = -0.9 + (y + 0.9) * 0.5;
    P.setXYZ(i, x * 0.115 * sc[0], y * 0.115 * sc[1], z * 0.115 * sc[2]);
  }
  g.computeVertexNormals();
  HEAD_CACHE.set(key, g);
  return g;
}
// Where a feature sits on the skull: unit coordinates (x forward, y up, z side) → head units.
function onHead(face, x, y, z) { const sc = FACE_SHAPE[face.shape] || FACE_SHAPE.oval; return new THREE.Vector3(x * 0.115 * sc[0], y * 0.115 * sc[1], z * 0.115 * sc[2]); }

// A nose: a narrow bridge running down to a rounded tip, the wings wider and forward at the bottom.
// Origin at the top of the bridge, +X forward, about 4.5 cm long.
function noseGeometry() {
  const g = new THREE.SphereGeometry(0.0125, 16, 12), P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i) / 0.0125, y = P.getY(i) / 0.0125, z = P.getZ(i) / 0.0125;
    const t = (1 - y) / 2;                                   // 0 at the bridge, 1 at the tip
    const nx = x * (0.32 + 0.6 * t) + t * t * 1.25 - 0.1;    // the tip stands out, the bridge sits flat
    const ny = y * 1.8;
    const nz = z * (0.42 + 0.7 * t);
    P.setXYZ(i, nx * 0.0125, ny * 0.0125 - 0.0225, nz * 0.0125);
  }
  g.computeVertexNormals();
  return g;
}

// Hair with strands (a tiling texture) instead of a plastic shell.
const HAIR_TEX = new Map();
function hairTexture(hex) {
  let t = HAIR_TEX.get(hex); if (t) return t;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'), base = new THREE.Color(hex);
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 64, 64);
  let sd = 0; for (const ch of hex) sd = (sd * 31 + ch.charCodeAt(0)) >>> 0;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const k = 0.7 + r() * 0.6, col = base.clone().multiplyScalar(k);
    g.strokeStyle = `#${col.getHexString()}`; g.globalAlpha = 0.55; g.lineWidth = 0.6 + r() * 0.8;
    const x = r() * 64, y = r() * 64; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y + 6 + r() * 8); g.stroke();
  }
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  HAIR_TEX.set(hex, t);
  return t;
}

// The face painted on the skull: skin with light and shade, eye sockets, lashes, brows drawn hair by
// hair, the nose's shading and nostrils, lips, and stubble or beard. Painted eyes are kept for when
// the 3D eyes are hidden at a distance. k = 2 draws it at double resolution for close-ups.
function faceTexture(skin, eye = EYE_PAL[0], brows = 1, beard = 'none', beardHex = '#16110d', o = {}) {
  const k = o.k || 1, lip = o.lip ?? 0.5;
  const c = document.createElement('canvas'); c.width = 256 * k; c.height = 128 * k;
  const g = c.getContext('2d'); g.scale(k, k);
  const base = new THREE.Color(skin), dark = base.clone().multiplyScalar(0.62), mid = base.clone().multiplyScalar(0.82), lite = base.clone().lerp(new THREE.Color(0xffffff), 0.16);
  const hx = col => `#${col.getHexString()}`;
  const lum = base.r * 0.3 + base.g * 0.59 + base.b * 0.11;
  g.fillStyle = hx(base); g.fillRect(0, 0, 256, 128);
  // Light on the forehead, nose and cheeks; a little shade under the jaw.
  const gr = g.createRadialGradient(128, 52, 6, 128, 62, 54); gr.addColorStop(0, hx(lite)); gr.addColorStop(1, hx(base));
  g.fillStyle = gr; g.fillRect(70, 8, 116, 112);
  // Warmth in the cheeks (stronger on lighter skin).
  for (const dx of [-30, 30]) { const sg = g.createRadialGradient(128 + dx, 72, 2, 128 + dx, 72, 17); sg.addColorStop(0, `rgba(190,80,70,${(0.16 * lum).toFixed(3)})`); sg.addColorStop(1, 'rgba(190,80,70,0)'); g.fillStyle = sg; g.fillRect(100 + dx, 52, 56, 40); }
  // Skin texture: fine, deterministic speckle.
  let sd = Math.round(lum * 1e6) + 17; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 900; i++) { g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.025 + rnd() * 0.03})` : `rgba(255,255,255,${0.02 + rnd() * 0.025})`; g.fillRect(70 + rnd() * 116, 20 + rnd() * 100, 0.8, 0.8); }
  const EY = texY(FY.eye), BY = texY(FY.brow), NY = texY(FY.nostril), TY = texY(FY.tip), UY = texY(FY.lipUp), MY = texY(FY.mouth), LY = texY(FY.lipLow);
  // Eye sockets and painted eyes (seen from afar), lash line and lid crease.
  for (const dx of [-12.5, 12.5]) {
    const so = g.createRadialGradient(128 + dx, EY, 2, 128 + dx, EY, 11); so.addColorStop(0, `${hx(dark)}88`); so.addColorStop(1, `${hx(dark)}00`); g.fillStyle = so; g.fillRect(112 + dx, EY - 13, 32, 26);
    g.fillStyle = '#e2dace'; g.beginPath(); g.ellipse(128 + dx, EY, 5.2, 2.3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = eye; g.beginPath(); g.arc(128 + dx, EY, 2.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0d0a08'; g.beginPath(); g.arc(128 + dx, EY, 1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1210'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(128 + dx, EY + 0.3, 5.6, 2.6, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();   // lashes
    g.strokeStyle = `${hx(dark)}aa`; g.lineWidth = 0.8; g.beginPath(); g.ellipse(128 + dx, EY - 1.4, 6, 3, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();   // crease
  }
  // Brows, hair by hair.
  for (const dx of [-12.5, 12.5]) {
    const sgn = Math.sign(dx);
    for (let i = 0; i < 26 + brows * 10; i++) {
      const u = rnd(), x = 128 + dx - sgn * 7.5 + sgn * u * 16, y = BY + 0.5 - Math.sin(u * Math.PI) * 2.2 + (rnd() - 0.5) * (1.4 + brows * 0.45);
      g.strokeStyle = beardHex; g.globalAlpha = 0.55 + rnd() * 0.35; g.lineWidth = 0.55 + brows * 0.12;
      g.beginPath(); g.moveTo(x, y + 1); g.lineTo(x + sgn * (1.6 + rnd()), y - 0.5); g.stroke();
    }
    g.globalAlpha = 1;
  }
  // Nose: shade along the sides of the bridge, nostrils, a highlight on the tip.
  for (const dx of [-4.5, 4.5]) { const ns = g.createLinearGradient(128 + dx * 1.6, 0, 128 + dx * 0.4, 0); ns.addColorStop(0, `${hx(mid)}00`); ns.addColorStop(1, `${hx(mid)}88`); g.fillStyle = ns; g.fillRect(Math.min(128 + dx * 1.6, 128 + dx * 0.4), EY + 2, Math.abs(dx * 1.2), NY - EY - 2); }
  g.fillStyle = hx(dark); for (const dx of [-4, 4]) { g.beginPath(); g.ellipse(128 + dx, NY, 2, 1.1, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = `${hx(lite)}88`; g.beginPath(); g.ellipse(128, TY, 2.4, 1.7, 0, 0, Math.PI * 2); g.fill();
  // Beard, moustache or stubble (painted before the lips, which stay visible through a beard).
  if (beard !== 'none') {
    g.fillStyle = beardHex;
    const jawPath = () => { g.beginPath(); g.moveTo(94, EY + 8); g.quadraticCurveTo(98, 116, 128, 120); g.quadraticCurveTo(158, 116, 162, EY + 8); };
    if (beard === 'full') { jawPath(); g.quadraticCurveTo(146, NY + 4, 128, NY + 4); g.quadraticCurveTo(110, NY + 4, 94, EY + 8); g.globalAlpha = 0.85; g.fill(); }
    else if (beard === 'chin strap') { jawPath(); g.quadraticCurveTo(154, 108, 128, 112); g.quadraticCurveTo(102, 108, 94, EY + 8); g.globalAlpha = 0.85; g.fill(); }
    else if (beard === 'goatee') { g.beginPath(); g.moveTo(116, LY + 1); g.quadraticCurveTo(116, 116, 128, 118); g.quadraticCurveTo(140, 116, 140, LY + 1); g.quadraticCurveTo(128, LY + 4, 116, LY + 1); g.globalAlpha = 0.85; g.fill(); }
    else if (beard === 'stubble') { jawPath(); g.quadraticCurveTo(146, NY + 4, 128, NY + 4); g.quadraticCurveTo(110, NY + 4, 94, EY + 8); g.globalAlpha = 0.2; g.fill(); }
    if (beard !== 'moustache') for (let i = 0; i < (beard === 'stubble' ? 700 : 380); i++) {
      const x = 96 + rnd() * 64, y = EY + 10 + rnd() * (118 - EY - 10);
      if (beard === 'goatee' && (Math.abs(x - 128) > 12 || y < LY)) continue;
      g.globalAlpha = beard === 'stubble' ? 0.32 : 0.5; g.fillRect(x, y, 0.7, beard === 'stubble' ? 0.7 : 1.6);
    }
    if (beard === 'full' || beard === 'goatee' || beard === 'moustache') { g.globalAlpha = 0.9; g.beginPath(); g.ellipse(128, (NY + UY) / 2 + 0.5, beard === 'moustache' ? 9 : 10, 2.1, 0, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
  // Philtrum and lips.
  { const ph = g.createLinearGradient(125.5, 0, 130.5, 0); ph.addColorStop(0, `${hx(mid)}00`); ph.addColorStop(0.5, `${hx(mid)}55`); ph.addColorStop(1, `${hx(mid)}00`); g.fillStyle = ph; g.fillRect(125.5, NY + 1.5, 5, UY - NY - 1.5); }
  const lipCol = base.clone().lerp(new THREE.Color(0xa24f58), 0.24 + 0.1 * lum).multiplyScalar(0.95), lw = 7 + lip * 3.2, lh = 1.5 + lip * 1.2;
  g.fillStyle = hx(lipCol.clone().multiplyScalar(0.9));
  g.beginPath(); g.moveTo(128 - lw, MY); g.quadraticCurveTo(124, UY - lh * 0.5, 128, UY + 0.6); g.quadraticCurveTo(132, UY - lh * 0.5, 128 + lw, MY); g.quadraticCurveTo(128, MY + 0.8, 128 - lw, MY); g.fill();   // upper lip
  g.fillStyle = hx(lipCol); g.beginPath(); g.ellipse(128, MY + 0.6, lw * 0.86, Math.max(lh, LY - MY), 0, 0, Math.PI); g.fill();                     // lower lip
  g.strokeStyle = hx(lipCol.clone().multiplyScalar(0.55)); g.lineWidth = 0.85; g.beginPath(); g.moveTo(128 - lw, MY); g.quadraticCurveTo(128, MY + 1, 128 + lw, MY); g.stroke();   // mouth line
  // Shade under the lower lip and along the jaw.
  const jaw = g.createLinearGradient(0, LY + 2, 0, 124); jaw.addColorStop(0, `${hx(base)}00`); jaw.addColorStop(1, `${hx(mid)}bb`);
  g.fillStyle = jaw; g.fillRect(84, LY + 2, 88, 124 - LY);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Materials for a player's looks — skin, face, hair, lips, eyes — cached per look. hq uses lit
// (PBR) skin and a sharper face for close-ups; low quality keeps the cheaper flat shading.
function lookKit(hq) {
  const geo = playerGeometry();
  const mat = (opts) => (hq ? new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, ...opts }) : new THREE.MeshLambertMaterial(opts));
  const skins = SKIN_PAL.map(c => mat({ color: new THREE.Color(c) }));
  const faces = SKIN_PAL.map(c => mat({ map: faceTexture(c, EYE_PAL[0], 1, 'none', '#16110d', { k: hq ? 2 : 1 }) }));
  const hairs = HAIR_PAL.map(c => new THREE.MeshLambertMaterial({ color: new THREE.Color(c) }));
  const eyeWhite = new THREE.MeshLambertMaterial({ color: 0xddd4c8 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x080606 });
  const irises = EYE_PAL.map(c => new THREE.MeshLambertMaterial({ color: new THREE.Color(c) }));
  const cache = new Map();
  function matsFor(lk) {
    if (!lk) return { skin: skins[2], face: faces[2], hair: hairs[0], hairSoft: hairs[0], eyeWhite, pupil, iris: irises[0], lip: skins[3] };
    const face = faceOf(lk), lipQ = Math.round((face.lip ?? 0.5) * 4) / 4;
    const key = `${lk.skin}.${lk.eyes}.${lk.brows}.${lk.beardStyle}.${lk.hairCol}.${lk.grey}.${lipQ}`;
    let m = cache.get(key);
    if (!m) {
      const sk = SKIN_PAL[lk.skin] || SKIN_PAL[2];
      const hc = greyed(HAIR_PAL[lk.hairCol] || HAIR_PAL[0], lk.grey), bc = greyed(HAIR_PAL[lk.hairCol] || HAIR_PAL[0], (lk.grey || 0) * 1.3);
      const skinCol = new THREE.Color(sk), lum = skinCol.r * 0.3 + skinCol.g * 0.59 + skinCol.b * 0.11;
      m = { skin: skins[lk.skin] || skins[2],
        face: mat({ map: faceTexture(sk, EYE_PAL[lk.eyes] || EYE_PAL[0], lk.brows, lk.beardStyle, `#${bc.getHexString()}`, { k: hq ? 2 : 1, lip: lipQ }) }),
        hair: new THREE.MeshLambertMaterial({ color: 0xffffff, map: hairTexture(`#${hc.getHexString()}`) }),
        hairSoft: new THREE.MeshLambertMaterial({ color: 0xffffff, map: hairTexture(`#${hc.clone().lerp(skinCol, 0.18).multiplyScalar(0.85).getHexString()}`) }), beard: new THREE.MeshLambertMaterial({ color: bc }),
        eyeWhite, pupil, iris: irises[lk.eyes] || irises[0],
        lip: mat({ color: skinCol.clone().lerp(new THREE.Color(0xa24f58), 0.24 + 0.1 * lum).multiplyScalar(0.95) }),
        noseMat: mat({ color: skinCol.clone().multiplyScalar(0.97) }), lidMat: mat({ color: skinCol.clone().multiplyScalar(0.86) }) };
      cache.set(key, m);
    }
    return m;
  }
  return { geo, skins, faces, hairs, matsFor, hq };
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
    ear: new THREE.SphereGeometry(0.026, 10, 8), nose: new THREE.BoxGeometry(0.03, 0.035, 0.03), noseCone: noseGeometry(), nostril: new THREE.SphereGeometry(0.0072, 8, 6),
    eyeball: new THREE.SphereGeometry(0.0118, 12, 10), iris: new THREE.CircleGeometry(0.0056, 16), pupilDisc: new THREE.CircleGeometry(0.0024, 12),
    lid: new THREE.SphereGeometry(0.0128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.36), lowLid: new THREE.SphereGeometry(0.0126, 16, 8, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), lip: new THREE.SphereGeometry(0.012, 12, 8),
    hairCap: new THREE.SphereGeometry(0.123, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairAfro: new THREE.SphereGeometry(0.152, 12, 10), hairTop: (() => { const g = new THREE.SphereGeometry(0.1, 12, 8); g.scale(1.05, 0.42, 0.85); return g; })(),
    thigh: cyl(0.086, 0.06, 0.42, -0.21), shortsLeg: cyl(0.098, 0.108, 0.25, -0.1), knee: new THREE.SphereGeometry(0.061, 8, 6),
    shin: cyl(0.057, 0.04, 0.4, -0.2, 8), sock: cyl(0.062, 0.047, 0.3, -0.24, 8), boot,
    shoulder: new THREE.SphereGeometry(0.07, 8, 6), upper: cyl(0.055, 0.045, 0.27, -0.135, 8), sleeve: cyl(0.066, 0.062, 0.15, -0.07, 8),
    fore: cyl(0.044, 0.034, 0.25, -0.125, 8), hand,
    blob: new THREE.PlaneGeometry(1.5, 1.5), streak: new THREE.PlaneGeometry(2.4, 0.62),
    curl: new THREE.SphereGeometry(0.042, 8, 6), strip: new THREE.BoxGeometry(0.2, 0.07, 0.045), twist: cyl(0.02, 0.016, 0.13, -0.065, 6),
    longBack: (() => { const g = new THREE.SphereGeometry(0.13, 12, 10); g.scale(0.8, 1.5, 1.05); g.translate(-0.05, -0.1, 0); return g; })(),
    beard: new THREE.SphereGeometry(0.118, 18, 8, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.72, Math.PI * 0.2),
    calf: (() => { const g = new THREE.SphereGeometry(0.06, 8, 6); g.scale(1, 1.9, 1); g.translate(-0.012, -0.13, 0); return g; })(),
    card: new THREE.PlaneGeometry(0.09, 0.12), flag: (() => { const g = new THREE.PlaneGeometry(0.34, 0.26); g.translate(0.17, 0.13, 0); return g; })(),
    pole: cyl(0.012, 0.012, 0.6, 0.3, 5), board: new THREE.BoxGeometry(0.62, 0.42, 0.05), number: new THREE.PlaneGeometry(0.2, 0.2), sponsor: new THREE.PlaneGeometry(0.24, 0.08), crest: new THREE.PlaneGeometry(0.055, 0.065),
  };
}

// The head: sculpted skull with his face, ears, nose, eyes, lips, hair and beard (origin at the centre
// of the skull, +X forward). The small features (eyes, lids, lips, nostrils) are a detail group the
// match view hides when the camera is far away; m.detail = false leaves them out (low quality).
function buildHead(geo, m, lk) {
  const mesh = (ge, ma, shadow) => { const x = new THREE.Mesh(ge, ma); x.castShadow = !!shadow; return x; };
  const head = new THREE.Group();
  const face = faceOf(lk);
  const shape = FACE_SHAPE[face.shape] || FACE_SHAPE.oval;
  const skull = mesh(headGeometry(face), m.face || m.skin, true); head.add(skull);
  // Ears: flat ovals, angled back, sized by the profile.
  const ek = 0.85 + (face.ear ?? 0.5) * 0.3;
  for (const sgn of [-1, 1]) { const e = mesh(geo.ear, m.skin); e.scale.set(0.42 * ek, 1.18 * ek, 0.34 * ek); e.position.copy(onHead(face, -0.06, 0.02, sgn * 0.93)); e.rotation.y = sgn * 0.3; head.add(e); }
  // Nose: bridge between the eyes, tip forward; width from the profile.
  const nose = new THREE.Group(), nw = 0.85 + (face.nose ?? 0.5) * 0.4;
  const cone = mesh(geo.noseCone, m.noseMat || m.skin); cone.scale.set(1.15, 1.12, nw); nose.add(cone);
  nose.position.copy(onHead(face, 0.95, FY.bridge, 0)); head.add(nose);
  const detail = new THREE.Group(); head.add(detail); head.userData.detail = detail;
  if (m.detail !== false && m.eyeWhite) {
    for (const sgn of [-1, 1]) { const n = mesh(geo.nostril, m.noseMat || m.skin); n.position.set(0.01, -0.045, sgn * 0.0088 * nw); n.scale.set(0.85, 0.5, 0.9); nose.add(n); }
    // Eyes: set into the sockets, upper and lower lids leaving a natural opening.
    const es = 0.82 + (face.eye ?? 0.5) * 0.18, open = 0.3 - (face.eye ?? 0.5) * 0.12;
    for (const sgn of [-1, 1]) {
      const at = onHead(face, 0.8, FY.eye, sgn * 0.3);
      const ball = mesh(geo.eyeball, m.eyeWhite); ball.position.copy(at); ball.scale.setScalar(es); detail.add(ball);
      const iris = mesh(geo.iris, m.iris); iris.position.set(at.x + 0.0115 * es, at.y, at.z); iris.rotation.y = Math.PI / 2; iris.scale.setScalar(es * 0.92); detail.add(iris);
      const pupil = mesh(geo.pupilDisc, m.pupil); pupil.position.set(at.x + 0.0117 * es, at.y, at.z); pupil.rotation.y = Math.PI / 2; pupil.scale.setScalar(es * 0.92); detail.add(pupil);
      const lid = mesh(geo.lid, m.lidMat || m.skin); lid.position.copy(at); lid.scale.setScalar(es * 1.06); lid.rotation.z = -open; detail.add(lid);            // upper lid
      const low = mesh(geo.lowLid, m.lidMat || m.skin); low.position.copy(at); low.scale.setScalar(es * 1.05); low.rotation.z = 0.2; detail.add(low);        // lower lid
    }
    const lw = 0.8 + (face.lip ?? 0.5) * 0.35;
    const upper = mesh(geo.lip, m.lip || m.skin); upper.scale.set(0.3, 0.2, 1.0 * lw); upper.position.copy(onHead(face, 0.87, FY.lipUp, 0)); detail.add(upper);
    const lower = mesh(geo.lip, m.lip || m.skin); lower.scale.set(0.33, 0.25, 0.9 * lw); lower.position.copy(onHead(face, 0.855, FY.lipLow + 0.02, 0)); detail.add(lower);
  }
  // Hair (the hairline moves with the profile).
  const style = lk ? lk.hairStyle : ['crop', 'afro', 'fade', 'bald'][m.hairStyle || 0];
  const line = ((face.hairline ?? 0.5) - 0.5) * 0.3;
  const cap = (sc = 1, op, tilt = 0.55) => { const h = mesh(geo.hairCap, op ? m.hairSoft : m.hair); h.scale.set(shape[0] * sc * 1.05, shape[1] * 0.98 * sc, shape[2] * sc * 1.0); h.position.set(-0.004, 0.006, 0); h.rotation.z = tilt + line; head.add(h); return h; };
  if (style === 'crop' || style === 'swept' || style === 'curly' || style === 'long' || style === 'twists') cap(1.03, false, style === 'curly' || style === 'twists' ? 0.45 : 0.38);
  if (style === 'buzz' || style === 'fade' || style === 'mohawk') cap(1.0, true, 0.45);
  if (style === 'receding') { const h = cap(1.0, true); h.position.x = -0.03; h.rotation.z = 0.25 + line; }
  if (style === 'afro') { const h = mesh(geo.hairAfro, m.hair); h.scale.set(0.92 * shape[0], 0.95, shape[2] * 1.08); h.position.set(-0.036, 0.085, 0); head.add(h); }
  if (style === 'fade') { const t2 = mesh(geo.hairCap, m.hair); t2.scale.set(shape[0] * 0.99, shape[1] * 0.7, shape[2] * 0.93); t2.position.set(-0.012, 0.04, 0); t2.rotation.z = 0.5 + line; head.add(t2); }
  if (style === 'swept') { const t2 = mesh(geo.hairCap, m.hair); t2.scale.set(shape[0] * 0.9, shape[1] * 0.45, shape[2] * 0.85); t2.position.set(0.012, 0.075, 0.012); t2.rotation.set(0.12, 0, 0.35); head.add(t2); }   // a quiff swept to one side
  if (style === 'mohawk') { const t2 = mesh(geo.strip, m.hair); t2.position.set(-0.01, 0.15, 0); head.add(t2); }
  if (style === 'curly') for (let k = 0; k < 9; k++) { const c = mesh(geo.curl, m.hair); const a = (k / 9) * Math.PI * 2; c.position.set(Math.cos(a) * 0.07 - 0.01, 0.13 + Math.sin(k * 1.7) * 0.012, Math.sin(a) * 0.07); head.add(c); }
  if (style === 'twists') for (let k = 0; k < 10; k++) { const c = mesh(geo.twist, m.hair); const a = (k / 10) * Math.PI * 2; c.position.set(Math.cos(a) * 0.1 - 0.02, 0.1, Math.sin(a) * 0.1); c.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); head.add(c); }
  if (style === 'long') { const b = mesh(geo.longBack, m.hair); head.add(b); }
  const beard = lk ? lk.beardStyle : 'none';
  if (beard === 'full' || beard === 'goatee') { const b = mesh(geo.beard, m.beard || m.hair); b.scale.set(shape[0] * 1.04, shape[1] * (beard === 'goatee' ? 0.95 : 1.04), shape[2] * (beard === 'goatee' ? 0.45 : 1.06)); head.add(b); }
  return head;
}

// Soft blob shadow under a figure, plus one streak per floodlight at night.
function addGroundShadows(g, geo, m) {
  const blob = new THREE.Mesh(geo.blob, m.blob); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.renderOrder = 1; g.add(blob);
  let shadows = null;
  if (m.streak) {
    shadows = new THREE.Group(); g.add(shadows);
    for (const [tx, , tz] of TOWERS) {
      const len = Math.hypot(tx, tz), dx = -tx / len, dz = -tz / len;
      const st = new THREE.Mesh(geo.streak, m.streak);
      st.rotation.set(-Math.PI / 2, 0, Math.atan2(-dz, dx)); st.position.set(dx * 1.05, 0.025, dz * 1.05); st.renderOrder = 1; shadows.add(st);
    }
  }
  return { blob, shadows };
}

function makePlayer(geo, m) {
  const g = new THREE.Group();
  const rig = new THREE.Group(); g.add(rig);
  const lk = m.look || null;
  const hs = lk ? lk.heightCm / 181 : (m.build ? m.build.h : 1);
  const bw = lk ? 0.94 + lk.build / 15 * 0.13 : (m.build ? m.build.w : 1);       // broader players fill out the frame
  rig.scale.set(S * hs * bw, S * hs, S * hs * bw);
  const limb = lk ? 0.92 + lk.build / 15 * 0.2 : 1;                              // and carry thicker limbs
  const mesh = (ge, ma, shadow) => { const x = new THREE.Mesh(ge, ma); x.castShadow = !!shadow; return x; };
  const hips = new THREE.Group(); hips.position.y = 0.94; rig.add(hips);
  const pelvis = mesh(geo.pelvis, m.shorts, true); pelvis.scale.set(0.72, 1, 1.08); hips.add(pelvis);
  const torso = new THREE.Group(); torso.position.y = 0.04; hips.add(torso);
  const chest = mesh(geo.chest, m.shirt, true); chest.scale.set(0.66 * (0.96 + (bw - 1)), 1, 1.12); torso.add(chest);
  const neck = mesh(geo.neck, m.skin); neck.position.y = 0.63; neck.scale.set(limb, 1, limb); torso.add(neck);
  const head = buildHead(geo, m, lk); head.position.y = 0.78; torso.add(head);
  const leg = z => {
    const hip = new THREE.Group(); hip.position.set(0, -0.03, z); hips.add(hip);
    const th = mesh(geo.thigh, m.skin, true); th.scale.set(limb, 1, limb);
    hip.add(th, mesh(geo.shortsLeg, m.shorts));
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
    const calf = mesh(geo.calf, m.skin); calf.scale.set(limb, 1, limb);
    knee.add(mesh(geo.knee, m.skin), mesh(geo.shin, m.skin), calf, mesh(geo.sock, m.sock, true));
    const ankle = new THREE.Group(); ankle.position.y = -0.41; knee.add(ankle);
    ankle.add(mesh(geo.boot, m.boot, true));
    return { hip, knee, ankle };
  };
  const arm = z => {
    const sh = new THREE.Group(); sh.position.set(0, 0.5, z); torso.add(sh);
    const up = mesh(geo.upper, m.skin, true); up.scale.set(limb, 1, limb);
    sh.add(mesh(geo.shoulder, m.sleeve), up, mesh(geo.sleeve, m.sleeve));
    const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
    el.add(mesh(geo.fore, m.skin));
    const hand = mesh(geo.hand, m.glove || m.skin); hand.position.y = -0.285; el.add(hand);
    return { sh, el, hand };
  };
  const { blob, shadows } = addGroundShadows(g, geo, m);
  g.userData = { rig, hips, torso, chest, head, blob, shadows, legL: leg(0.096), legR: leg(-0.096), armL: arm(0.245), armR: arm(-0.245), sy: S * hs, cel: lk ? lk.cel : 0,
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

  if (a.injured != null) {                        // down injured: on his back, knee up, hands on the shin
    const w = clamp01(a.injured / 0.5);
    pitch = -1.45 * w; y = lerp(y, 0.16, w); hipL = lerp(hipL, 1.2, w); kneeL = lerp(kneeL, -1.9, w); hipR = lerp(hipR, 0.2, w); kneeR = lerp(kneeR, -0.3, w);
    shL = shR = lerp(shL, 1.6, w); elL = elR = 1.2; lean = 0; twist = 0; roll = Math.sin(t * 3) * 0.08 * w; free = false;
  } else if (a.header) {                          // jump and head it: neck forward, arms out for balance
    const k = Math.sin(Math.PI * clamp01(a.header));
    y = 0.42 * k; kneeL = kneeR = -0.7 * k; hipL = hipR = 0.3 * k; abL = -1.1 * k; abR = 1.1 * k; shL = shR = 0.5 * k; lean = 0.35 * k; headZ = -0.45 * k; free = false;
  } else if (a.touch != null) {                   // first touch: cushion the ball with the inside of the foot
    const k = Math.sin(Math.PI * clamp01(a.touch / 0.35));
    hipR = lerp(hipR, 0.5, k); kneeR = lerp(kneeR, -0.55, k); spreadR -= 0.25 * k; hipL = lerp(hipL, 0.05, k); kneeL = lerp(kneeL, -0.3, k); lean = lerp(lean, 0.05, k); headZ = -0.35 * k; abL -= 0.3 * k; abR += 0.3 * k;
  } else if (a.catchBall) {                       // keeper takes it cleanly into his chest
    const k = clamp01(a.catchBall / 0.2);
    shL = shR = lerp(shL, 1.35, k); elL = elR = lerp(elL, 1.15, k); abL = 0.15; abR = -0.15; kneeL = kneeR = -0.35 * k; drop = 0.05 * k; lean = 0.12 * k; free = false;
  } else if (a.punch) {                           // keeper punches it clear
    const k = Math.sin(Math.PI * clamp01(a.punch / 0.5));
    y = 0.45 * k; shR = lerp(shR, 3.0, k); elR = 0.05; shL = lerp(shL, 1.2, k); elL = 0.8; kneeL = -0.9 * k; hipL = 0.6 * k; free = false;
  } else if (a.block != null) {                   // throws a leg across the shot, arms behind his back
    const k = Math.sin(Math.PI * clamp01(a.block / 0.6)) ** 0.7;
    spreadR -= 0.9 * k; kneeR = lerp(kneeR, -0.1, k); hipR = lerp(hipR, 0.4, k); kneeL = lerp(kneeL, -0.6, k); shL = shR = lerp(shL, -0.7, k); elL = elR = 0.9; roll = 0.25 * k; lean = -0.1 * k; y *= 1 - k;
  } else if (a.card) {                            // referee shows a card, arm straight up
    shR = 3.05; elR = 0.05; abR = 0.1; shL = -0.2; elL = 0.6; lean = -0.04; headZ = 0.1;
  } else if (a.boardUp) {                         // fourth official holds up the board
    shL = shR = 2.5; elL = elR = 0.9; abL = -0.25; abR = 0.25;
  } else if (a.flag) {                            // assistant referee: flag in the right hand
    shR = Math.max(shR, 0.25); elR = 0.4;
  }
  if (a.injured != null || a.header || a.touch != null || a.catchBall || a.punch || a.block != null || a.card || a.boardUp) { /* action set above */ }
  else if (a.dive) {                              // keeper throws himself across the goal
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
    // Every player has his own celebration (part of his look): jump and punch the air, a knee
    // slide, pointing to the sky, or the aeroplane.
    if (u.spd > 1.6) { abL = -1.45; abR = 1.45; shL = shR = 0; elL = elR = 0.08; lean -= 0.05; headZ = 0.15; }          // arms out, wheeling away
    else if (u.cel === 1) { kneeL = kneeR = -2.1; hipL = hipR = 0.75; drop = 0.42; lean = -0.35; shL = shR = 2.6; elL = elR = 0.25; headZ = 0.45; }
    else if (u.cel === 2) { shR = 3.0; elR = 0.05; shL = 0.3; elL = 0.5; headZ = 0.55; lean = -0.12; y += Math.abs(Math.sin(t * 3)) * 0.06; }
    else if (u.cel === 3) { abL = -1.5; abR = 1.5; shL = shR = 0; elL = elR = 0.05; roll = Math.sin(t * 2.4) * 0.3; headZ = 0.2; }
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


// ── Motion-captured footballers ─────────────────────────────────────
// A CC0 skinned mannequin (Mesh2Motion) with CC0 clips, prepared by scripts/anim/build-footballer.js:
// public/models/footballer.glb (mesh split into kit regions) and footballer-anims.json. Each player
// is a clone of the mannequin wearing his club's colours, with his own head (face, hair, beard from
// his permanent look) on the head bone and his number on his back. An AnimationMixer per player
// blends idle / walk / jog / sprint / backwards / strafe by his real speed and direction, with
// stride speed matched to ground speed, and plays one-shot actions on match events: kicks timed
// so the foot meets the ball when it leaves, slide tackles, headers, keeper dives and saves,
// celebrations, disappointment, appeals, falls and getting up. If the files cannot be loaded the
// view falls back to the procedural figures above.
let FOOTBALLER = null, FOOTBALLER_P = null;
// One shared download: the match screen starts it when you press Play, the 3D view waits for it.
export function loadFootballer(base) { if (!FOOTBALLER_P) FOOTBALLER_P = fetchFootballer(base).catch(e => { FOOTBALLER_P = null; throw e; }); return FOOTBALLER_P; }
async function fetchFootballer(base = new URL('./models/', import.meta.url).href) {
  if (FOOTBALLER) return FOOTBALLER;
  const [{ GLTFLoader }, SU] = await Promise.all([import('./vendor/jsm/loaders/GLTFLoader.js'), import('./vendor/jsm/utils/SkeletonUtils.js')]);
  const [gltf, anims] = await Promise.all([new GLTFLoader().loadAsync(base + 'footballer.glb'), fetch(base + 'footballer-anims.json').then(r => { if (!r.ok) throw new Error('animations ' + r.status); return r.json(); })]);
  const clips = {};
  for (const [k, c] of Object.entries(anims.clips)) clips[k] = { clip: THREE.AnimationClip.parse({ name: k, duration: c.duration, tracks: c.tracks, uuid: THREE.MathUtils.generateUUID() }), loop: c.loop, contact: c.contact, foot: c.foot };
  // Model height (bind pose) for scaling players to their real heights.
  const box = new THREE.Box3().setFromObject(gltf.scene);
  FOOTBALLER = { scene: gltf.scene, clips, height: box.max.y - box.min.y || 1.83, clone: SU.clone };
  return FOOTBALLER;
}

const LOCO = ['idle', 'walk', 'jog', 'sprint', 'back', 'strafeL', 'strafeR', 'ready', 'gkReady', 'tired', 'injuredWalk'];
const CEL = ['celFist', 'celVictory', 'celJump', 'celFlip', 'celDab'];
// Ground speed (m/s at our figure scale) at which each locomotion clip's feet don't slide.
const STRIDE = { walk: 1.7, jog: 3.9, sprint: 7.2, back: 1.5, strafeL: 1.6, strafeR: 1.6, injuredWalk: 1.0 };

// Keeps an object upright in the figure's frame while it rides on a bone (head, shirt number…).
// worldOffset is in the figure's frame (+X forward, +Y up); worldScale is the size the object should
// have in the world (the bone's own scale is cancelled). The object's own rotation is kept.
function attachToBone(fig, bone, obj, worldOffset, worldScale = 1) {
  fig.updateMatrixWorld(true);
  const qb = new THREE.Quaternion(), qf = new THREE.Quaternion(), pb = new THREE.Vector3(), sb = new THREE.Vector3();
  bone.matrixWorld.decompose(pb, qb, sb);
  fig.getWorldQuaternion(qf);
  const own = obj.quaternion.clone();
  obj.quaternion.copy(qb.clone().invert().multiply(qf).multiply(own));
  const want = pb.clone().add(worldOffset.clone().applyQuaternion(qf));
  bone.add(obj);
  obj.position.copy(bone.worldToLocal(want));
  obj.scale.set(worldScale / sb.x, worldScale / sb.y, worldScale / sb.z);
}

// The front of the shirt: the sponsor's name across the chest and the club crest on the left.
const BADGE_TEX = new Map();
function sponsorTexture(text, light) {
  const key = `s|${text}|${light}`; let t = BADGE_TEX.get(key); if (t) return t;
  const c = document.createElement('canvas'); c.width = 256; c.height = 86;
  const g = c.getContext('2d'), nm = String(text).toUpperCase().slice(0, 18);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 ${nm.length > 11 ? 30 : 38}px Arial, sans-serif`;
  g.fillStyle = light ? '#ffffff' : '#111111'; g.fillText(nm, 128, 45, 248);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; BADGE_TEX.set(key, t); return t;
}
function crestTexture(initials, c1, c2) {
  const key = `c|${initials}|${c1}|${c2}`; let t = BADGE_TEX.get(key); if (t) return t;
  const c = document.createElement('canvas'); c.width = 96; c.height = 112;
  const g = c.getContext('2d');
  g.beginPath(); g.moveTo(8, 8); g.lineTo(88, 8); g.lineTo(88, 60); g.quadraticCurveTo(88, 96, 48, 108); g.quadraticCurveTo(8, 96, 8, 60); g.closePath();
  g.fillStyle = c1; g.fill(); g.lineWidth = 7; g.strokeStyle = c2; g.stroke();
  g.fillStyle = c2; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 34px Arial, sans-serif'; g.fillText(String(initials).slice(0, 3), 48, 54, 74);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; BADGE_TEX.set(key, t); return t;
}

// The back of the shirt: his surname across the shoulders and his number below it.
function numberTexture(n, light, name) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.strokeStyle = light ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.9)'; g.fillStyle = light ? '#fff' : '#111';
  if (name) {
    const nm = String(name).toUpperCase().slice(0, 12);
    g.font = `bold ${nm.length > 8 ? 17 : 21}px Arial, sans-serif`; g.lineWidth = 4;
    g.strokeText(nm, 64, 22, 124); g.fillText(nm, 64, 22, 124);
  }
  g.font = 'bold 76px Arial, sans-serif'; g.lineWidth = 9;
  g.strokeText(String(n), 64, name ? 80 : 68); g.fillText(String(n), 64, name ? 80 : 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeFootballer(F, geo, m) {
  const g = new THREE.Group();
  const lk = m.look || null;
  const hs = (lk ? lk.heightCm / 100 : 1.8) / F.height;
  const bw = lk ? 0.95 + lk.build / 15 * 0.11 : 1;
  const holder = new THREE.Group(); holder.scale.set(S * hs * bw, S * hs, S * hs * bw); g.add(holder);
  const model = F.clone(F.scene);
  model.rotation.y = Math.PI / 2;                               // the mannequin faces +Z; our figures face +X
  holder.add(model);
  const kit = { shirt: m.shirt3d || m.sleeve, shorts: m.shorts, socks: m.sock, boots: m.boot, skin: m.skin, hands: m.glove || m.skin };
  model.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false; o.castShadow = true;
    const region = o.material && o.material.name;
    if (region === 'head') { o.visible = false; return; }
    o.material = kit[region] || m.skin;
  });
  const bone = name => model.getObjectByName(name);
  const headBone = bone('head'), spine = bone('spine_03'), handR = bone('hand_r');
  const bones = { s2: bone('spine_02'), s3: bone('spine_03'), ual: bone('upperarm_l'), uar: bone('upperarm_r'), neck: bone('neck_01') };
  // His body: limb lengths move the joints along the bones (no stretching of the mesh), muscle
  // thickens limbs across them; longer legs lift the hips so his feet stay on the grass.
  const body = bodyOf(lk), K = (v, amt) => 1 + ((v ?? 0.5) - 0.5) * amt;
  for (const sd of ['l', 'r']) {
    for (const n of ['calf_', 'foot_']) { const b = bone(n + sd); if (b) b.position.y *= K(body.legs, 0.14); }
    for (const n of ['lowerarm_', 'hand_']) { const b = bone(n + sd); if (b) b.position.y *= K(body.arms, 0.16); }
    const ua = bone('upperarm_' + sd); if (ua) { ua.position.y *= K(body.shoulders, 0.55); ua.scale.set(K(body.muscle, 0.26), 1, K(body.muscle, 0.26)); }
    const th = bone('thigh_' + sd); if (th) th.scale.set(K(body.muscle, 0.22), 1, K(body.muscle, 0.22));
  }
  if (bones.s3) bones.s3.scale.set(K(body.chest, 0.16), 1, K(body.chest, 0.12));
  { const s1 = bone('spine_01'); if (s1) s1.scale.set(K(body.waist, 0.12), 1, K(body.waist, 0.12)); }
  model.position.y += (K(body.legs, 0.14) - 1) * 0.84;
  // His own head: face, ears, nose, hair and beard from his permanent look.
  const head = buildHead(geo, m, lk);
  const headScale = S * (lk ? lk.heightCm : 181) / 181;
  if (headBone) attachToBone(g, headBone, head, new THREE.Vector3(0.012 * headScale, 0.085 * headScale, 0), headScale);
  // Shirt number on his back
  if (spine && m.number != null) {
    const plate = new THREE.Mesh(geo.number, new THREE.MeshBasicMaterial({ map: numberTexture(m.number, m.lightNumber !== false, m.shirtName), transparent: true, depthWrite: false }));
    plate.rotation.y = -Math.PI / 2;
    attachToBone(g, spine, plate, new THREE.Vector3(-0.15 * headScale * bw, 0.02, 0), headScale);
  }
  // Sponsor across the chest and the club crest on the left breast.
  if (spine && m.sponsor) {
    const plate = new THREE.Mesh(geo.sponsor, new THREE.MeshBasicMaterial({ map: sponsorTexture(m.sponsor, m.lightNumber !== false), transparent: true, depthWrite: false }));
    plate.rotation.y = Math.PI / 2;
    attachToBone(g, spine, plate, new THREE.Vector3(0.152 * headScale * bw, -0.025 * headScale, 0), headScale);
  }
  if (spine && m.crest) {
    const plate = new THREE.Mesh(geo.crest, new THREE.MeshBasicMaterial({ map: crestTexture(m.crest.initials, m.crest.c1, m.crest.c2), transparent: true, depthWrite: false }));
    plate.rotation.y = Math.PI / 2;
    attachToBone(g, spine, plate, new THREE.Vector3(0.146 * headScale * bw, 0.06 * headScale, -0.07 * headScale), headScale);
  }
  const { blob, shadows } = addGroundShadows(g, geo, m);
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const [k, c] of Object.entries(F.clips)) {
    const a = mixer.clipAction(c.clip);
    if (c.loop) { a.setLoop(THREE.LoopRepeat, Infinity); } else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    a.enabled = false; act[k] = a;
  }
  for (const k of LOCO) if (act[k]) { act[k].enabled = true; act[k].setEffectiveWeight(k === 'idle' ? 1 : 0); act[k].time = Math.random() * act[k].getClip().duration; act[k].play(); }
  g.userData = { mixer, act, model, holder, head, blob, shadows, sy: S * hs, cel: lk ? lk.cel : 0, mocap: true, F, bones: bones.s2 && bones.s3 ? bones : null,
    armR: { hand: handR || head }, face: 0, spd: 0, lx: null, lz: 0, one: null, w: Object.fromEntries(LOCO.map(k => [k, k === 'idle' ? 1 : 0])), gait: 1 + ((lk ? lk.height : 20) - 20) * 0.004 };
  return g;
}

// Club shirt for the motion-captured model. The model has no texture coordinates, so the pattern
// (1 stripes, 2 hoops, 3 dark yoke) is painted in the shader from each vertex's bind-pose position,
// which moves with the cloth as the skeleton animates.
const KIT_PATTERN = { plain: 0, 'vertical-stripes': 1, stripes: 1, 'horizontal-stripes': 2, hoops: 2, yoke: 3, sash: 3 };
function kitShirtMaterial(color, pattern, second, height) {
  const mat = new THREE.MeshLambertMaterial({ color });
  if (!pattern) return mat;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uKit2 = { value: new THREE.Color(second) };
    sh.uniforms.uPat = { value: pattern };
    sh.uniforms.uH = { value: height || 1.8 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKitPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKitPos;\nuniform vec3 uKit2;\nuniform float uPat;\nuniform float uH;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kitH = vKitPos.y / uH, kitM = 0.0;
        if (uPat < 1.5) kitM = step(0.5, fract(vKitPos.x / uH * 14.0));
        else if (uPat < 2.5) kitM = step(0.62, fract(kitH * 16.0));
        else kitM = step(0.77, kitH);
        diffuseColor.rgb = mix(diffuseColor.rgb, uKit2, kitM);`);
  };
  mat.customProgramCacheKey = () => 'kit-shirt';
  return mat;
}

// Starts a one-shot clip (fades out locomotion) unless the same one is already running.
function oneShot(u, key, { at = 0, speed = 1, hold = 0, fade = 0.12 } = {}) {
  const a = u.act[key]; if (!a) return;
  if (u.one && u.one.key === key && !u.one.done) return;
  if (u.one && u.one.a !== a) u.one.a.fadeOut(fade);
  a.enabled = true; a.reset(); a.time = Math.max(0, at); a.timeScale = speed; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
  u.one = { key, a, until: (a.getClip().duration - a.time) / Math.max(0.1, speed) + hold, age: 0, done: false };
  const L = globalThis.__animLog; if (L) L[key] = (L[key] || 0) + 1;   // test hook: which actions played
}

// Procedural layer on top of the motion-captured clips, for actions no free clip covers:
// shielding the ball (lean in, arm out, a look over the shoulder), chest control (lean back,
// arms out) and twisting the upper body into a turn with the ball. Bones are turned about world
// axes (the figure's forward, side and up), so it does not depend on each bone's local axes.
const _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function turnBone(b, axis, angle) {
  if (!b || !b.parent || Math.abs(angle) < 1e-4) return;
  b.parent.updateWorldMatrix(true, false);
  b.parent.getWorldQuaternion(_qp);
  _qa.setFromAxisAngle(axis, angle);
  b.quaternion.premultiply(_qp).premultiply(_qa).premultiply(_qp.invert());
}
function layerPose(u, a, dt) {
  const B = u.bones, k = Math.min(1, dt * 8);
  u.wShield = (u.wShield || 0) + ((a.shield ? 1 : 0) - (u.wShield || 0)) * k;
  if (a.shield) u.shieldSide = a.shield;
  u.wChest = (u.wChest || 0) + ((a.chest != null ? Math.sin(Math.PI * Math.min(1, a.chest / 0.5)) : 0) - (u.wChest || 0)) * Math.min(1, dt * 16);
  u.wTwist = (u.wTwist || 0) + ((a.dribble ? Math.max(-0.35, Math.min(0.35, (a.turn || 0) * 0.05)) : 0) - (u.wTwist || 0)) * k;
  if (u.wShield < 0.01 && u.wChest < 0.01 && Math.abs(u.wTwist) < 0.01) return;
  const f = u.face;
  _fwd.set(Math.cos(f), 0, -Math.sin(f)); _side.set(Math.sin(f), 0, Math.cos(f));
  if (u.wShield > 0.01) {
    const s = u.shieldSide || 1, w = u.wShield;                       // s = +1: the defender is on his left
    turnBone(B.s2, _side, -0.16 * w);                                 // a little lower, over the ball
    turnBone(B.s3, _fwd, -s * 0.13 * w);                              // lean into the defender
    turnBone(s > 0 ? B.ual : B.uar, _fwd, s * 0.8 * w);               // the arm on his side holds him off
    turnBone(B.neck, _up, s * 0.55 * w);                              // and a look over that shoulder
  }
  if (u.wChest > 0.01) {
    const w = u.wChest;
    turnBone(B.s2, _side, 0.3 * w);                                   // lean back to cushion it
    turnBone(B.ual, _fwd, 0.55 * w); turnBone(B.uar, _fwd, -0.55 * w); // arms out for balance
  }
  if (Math.abs(u.wTwist) > 0.01) turnBone(B.s3, _up, u.wTwist);
}

// Called every frame instead of pose() for a mocap figure. `a` is the same action description.
function animateFootballer(u, a, dt, t, simRate) {
  u.spd += (a.speed - u.spd) * Math.min(1, dt * 8);
  const F = u.F, sp = u.spd / (u.sy / S), k = simRate || 1;              // speed in model metres
  // ── one-shot actions from match events ──
  let want = null, opts = {};
  // Keeper and football clips from Ara 3D Gen (retargeted) where the build has them; the
  // Mesh2Motion stand-ins otherwise. Each is started so its contact frame (hands, foot or head
  // on the ball) lands when the ball does: `eta` is the time until the ball arrives.
  const C = F.clips, has = key => !!C[key];
  const meet = (key, eta, speed) => ({ at: Math.max(0, Math.min(C[key].contact || 0, (C[key].contact || 0) - Math.max(0, eta) * speed)), speed });
  if (a.injured != null) { want = a.injured < 2.4 ? 'fall' : 'getUp'; opts = { hold: 0.6 }; }
  else if (a.dive) {
    if (has('gkDiveL')) { want = a.dive.sign > 0 ? (a.dive.low ? 'gkLowL' : 'gkDiveL') : (a.dive.low ? 'gkLowR' : 'gkDiveR'); opts = meet(want, a.dive.eta ?? 0.3, 1.25 * k); }
    else { want = a.dive.sign > 0 ? 'diveL' : 'diveR'; opts = { speed: 1.6 * k }; }
  }
  else if (a.catchBall != null) { want = has('gkCatch') ? 'gkCatch' : 'block'; opts = has('gkCatch') ? meet('gkCatch', a.eta ?? 0.3, 1.2 * k) : { speed: 1.4 * k }; }
  else if (a.punch != null) { want = has('gkPunch') ? 'gkPunch' : 'block'; opts = has('gkPunch') ? meet('gkPunch', a.eta ?? 0.3, 1.2 * k) : { speed: 1.4 * k }; }
  else if (a.slide != null) { want = has('slideA') ? 'slideA' : 'slide'; opts = has('slideA') ? { at: 0.12, speed: 1.4 * k } : { at: 0.15, speed: 1.5 * k }; }
  else if (a.poke != null && a.poke < 0.3) { want = has('tackleA') ? 'tackleA' : 'kickSide'; opts = { at: has('tackleA') ? 0.1 : 0.08, speed: 1.4 * k }; }   // standing tackle: a foot in
  else if (a.throwIn != null && has('throwIn')) { want = 'throwIn'; opts = { at: Math.max(0, Math.min(0.7, a.throwIn)), speed: k }; }
  else if (a.strike != null && a.strike < 0.3) {
    // Time the kick so the foot meets the ball as it leaves (the ball leaves 0.11 s of match time after the strike starts).
    // A shot is struck with the laces; a long or driven pass straight through the ball; a short one with the inside of the foot.
    const p = a.power || 0.6;
    const key = has('shoot') ? (p >= 0.95 ? 'shoot' : p >= 0.85 ? 'passA' : 'passIn') : p >= 0.85 ? 'kickFront' : 'kickSide', c = C[key];
    // The mixer advances by this frame's dt straight after the kick starts, hence the - dt * k.
    want = key; opts = { at: Math.max(0, (c.contact || 0.3) - (0.11 - a.strike) - dt * k), speed: k };
  }
  else if (a.header) { const jump = a.headerHigh && has('headerJump'); want = has('headerA') ? (jump ? 'headerJump' : 'headerA') : 'header'; opts = has('headerA') ? { at: jump ? 0.3 : 0.18, speed: 1.3 * k } : { at: 0.25, speed: 1.3 * k }; }
  else if (a.receive != null && a.receive < 0.7 && has('receive')) { want = a.receiveChest && has('chestCtl') ? 'chestCtl' : 'receive'; opts = { at: Math.max(0, Math.min(0.35, a.receive * k)), speed: k }; }
  else if (a.block != null) { want = 'block'; opts = { speed: 1.2 * k }; }
  else if (a.cel === 'scorer' && u.spd < 1.6) want = CEL[u.cel % CEL.length];
  else if (a.cel === 'mate' && u.spd < 1.6) want = u.cel % 2 ? 'clap' : 'celPower';
  else if (a.card) want = 'call';
  else if (a.boardUp) want = 'block';
  else if (a.appeal) want = u.cel % 2 ? 'angry' : 'reject';
  if (want && F.clips[want]) oneShot(u, want, opts);
  // A finished one-shot hands back to locomotion (held poses stay while their trigger lasts).
  if (u.one) {
    u.one.age += dt;
    const holding = (want === u.one.key) && (a.injured != null || a.boardUp || a.card || a.cel);
    if (!holding && u.one.age >= u.one.until) { u.one.a.fadeOut(0.2); u.one.done = true; u.one = null; }
  }
  // ── locomotion blend by speed and direction ──
  const active = u.one ? 0 : 1;
  const sad = a.cel === 'sad', fwd = Math.cos(a.rel || 0), side = Math.sin(a.rel || 0);
  const w = { idle: 0, walk: 0, jog: 0, sprint: 0, back: 0, strafeL: 0, strafeR: 0, ready: 0, gkReady: 0, tired: 0, injuredWalk: 0 };
  if (sad && sp < 1) w.tired = 1;
  else if (a.ready && sp < 2) { if (u.gk && u.act.gkReady) w.gkReady = 1; else w.ready = 1; }
  else if (sp < 0.35) w.idle = 1;
  else if (fwd < -0.35 && sp < 4.5) { w.back = 1; }
  else if (Math.abs(side) > 0.7 && sp < 4) { w[side > 0 ? 'strafeL' : 'strafeR'] = 1; }
  else if (sp < 1.9) { const x = (sp - 0.35) / 1.55; w.idle = 1 - x; w.walk = x; }
  else if (sp < 4.4) { const x = (sp - 1.9) / 2.5; w.walk = 1 - x; w.jog = x; }
  else { const x = Math.min(1, (sp - 4.4) / 2.6); w.jog = 1 - x; w.sprint = x; }
  for (const key of LOCO) {
    const ac = u.act[key]; if (!ac) continue;
    u.w[key] += ((w[key] || 0) * active - u.w[key]) * Math.min(1, dt * 7);
    const wt = u.w[key];
    ac.enabled = wt > 0.003;
    ac.setEffectiveWeight(wt);
    if (STRIDE[key]) ac.timeScale = Math.max(0.55, Math.min(1.7, sp / STRIDE[key] / u.gait));
  }
  u.mixer.update(dt);
  if (u.bones) layerPose(u, u.one && u.one.key === 'chestCtl' ? { ...a, chest: null } : a, dt);
  { const L = globalThis.__animLog; if (L) { if (a.shield) L.shield = (L.shield || 0) + 1; if (a.chest != null) L.chest = (L.chest || 0) + 1; } }   // test hook
  // Test hook: how far the kicking foot is from its contact frame when the ball leaves.
  if (globalThis.__animLog && a.strike != null && u.one && /^(kick|shoot|pass)/.test(u.one.key) && !u.one.logged && a.strike >= 0.11) { u.one.logged = true; const c = F.clips[u.one.key]; (globalThis.__animLog.kickSync = globalThis.__animLog.kickSync || []).push(+(u.one.a.time - c.contact - (a.strike - 0.11) * k).toFixed(3)); }
  // Lean into turns at speed, and keeper dives fly sideways off the ground.
  u.bank = (u.bank || 0) + ((Math.max(-0.22, Math.min(0.22, (a.turn || 0) * u.spd * 0.014))) - (u.bank || 0)) * Math.min(1, dt * 6);
  let roll = -u.bank, lift = 0;
  if (a.dive && !F.clips.gkDiveL) { const wv = Math.min(1, a.dive.age / 0.2), far = Math.min(1, Math.abs(a.dive.reach) * 9); roll = a.dive.sign * 1.25 * wv * far; lift = 0.5 * wv * far; }
  if (a.header) lift = Math.max(lift, Math.sin(Math.PI * Math.min(1, a.header)) * 0.35);
  u.holder.rotation.set(roll, 0, 0);
  u.holder.position.y = lift * u.sy;
  u.blob.scale.setScalar(1 - Math.min(0.6, lift));
}

// One WebGL renderer for every match of the session. Compiling the players' and stadium's shaders
// is what made the start of a half wait (seconds on some GPUs); the renderer keeps its compiled
// programs, so only the first match of a session compiles them, and prepare() does that before
// the first frame (asynchronously where the browser can compile in parallel).
const RENDERERS = {};
function matchRenderer(antialias) {
  const k = antialias ? 'aa' : 'plain';
  let r = RENDERERS[k];
  if (!r || r.__lost) {
    r = RENDERERS[k] = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
    r.domElement.addEventListener('webglcontextlost', () => { r.__lost = true; });
  }
  r.shadowMap.needsUpdate = true;
  return r;
}

// Compiles the shaders a match needs while the week is being simulated (advance() calls this
// before the match view exists), using a small stand-in scene: a keeper and an outfield player per
// side in an empty stadium. Their programs stay with the shared renderer for the real match.
let WARMED = null;
export function warmUp({ night = false, quality = 'auto' } = {}) {
  const key = `${night}|${quality}`;
  if (WARMED && WARMED.key === key) return WARMED.p;
  const p = (async () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-4000px;top:0;width:320px;height:180px;';
    document.body.appendChild(host);
    try {
      const view = await createView(host, { night, quality });
      const lu = side => [{ playerId: side === 'home' ? -1 : -3, slot: 'GK' }, { playerId: side === 'home' ? -2 : -4, slot: 'CM' }];
      const dots = side => lu(side).map((x, i) => ({ id: x.playerId, name: 'Warm Up', x: side === 'home' ? 0.1 + i * 0.3 : 0.9 - i * 0.3, y: 0.5, off: false }));
      const v = { m: { lineups: { home: lu('home'), away: lu('away'), looks: {} } }, dots: { home: dots('home'), away: dots('away') }, ball: { x: 0.5, y: 0.5, z: 0 }, sim: { t: 0, phase: 'play' }, minute: 0, score: { home: 0, away: 0 } };
      await view.prepare(v, { textures: false });   // only the shaders: the textures belong to each match
      view.dispose();
    } catch (e) { console.warn('3D warm-up skipped:', e && e.message); }
    host.remove();
  })();
  WARMED = { key, p };
  return p;
}

export async function createView(container, opts = {}) {
  const t0 = performance.now();
  const view = await buildView(container, opts);
  if (globalThis.__m3dDebug) console.log('prepare createView', Math.round(performance.now() - t0), 'ms');
  return view;
}
async function buildView(container, { homeHue = 210, awayHue = 0, cam = () => 'tv', boards = ['THE GAFFER'], night = false, quality = 'auto', models = 'mocap', venue = {}, weather = 'clear', kits = null, badges = null } = {}) {
  let F = null;
  if (models !== 'classic') {
    try { F = await Promise.race([loadFootballer(), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 30000))]); }
    catch (e) { console.warn('Motion-captured players unavailable, using classic figures:', e.message); }
  }
  if (!container) throw new Error('no container');
  // Graphics quality: 'low' for older phones, 'high' for strong devices, 'auto' decides from the device.
  const weak = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || window.innerWidth < 720;
  const low = quality === 'low' || (quality === 'auto' && weak);
  const renderer = matchRenderer(quality !== 'low');
  // The renderer is shared (the warm-up, a match, highlights): the view that draws claims it,
  // puts the canvas in its own container and sets its own size, pixel ratio and shadows.
  const self = {}, pixelRatio = Math.min(quality === 'low' ? 1 : low ? 1.75 : 2, window.devicePixelRatio || 1), shadows = !low && !night;
  renderer.__owner = self;
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const rain = weather === 'rain', snow = weather === 'snow', windy = weather === 'wind';
  const fogCol = night ? (snow ? 0x2a3546 : 0x16243b) : rain ? 0x9aa7b4 : snow ? 0xd9e0e8 : 0xbfe0fb;
  scene.background = new THREE.Color(fogCol);
  scene.fog = new THREE.Fog(fogCol, rain || snow ? 140 : 220, rain || snow ? 420 : 560);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 900);
  camera.position.set(0, 17, 40);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 16, 12), new THREE.MeshBasicMaterial({ map: skyTexture(night), side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(night ? 0x9fb4d8 : 0xdcecff, night ? 0x1d3a22 : 0x3d6b3a, night ? 0.7 : 1.25));
  const sun = new THREE.DirectionalLight(0xfff1d6, night ? 0 : 2.1);
  sun.position.set(-45, 85, 40);
  sun.castShadow = !low && !night;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 240 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xcfe0ff, night ? 0.2 : 0.55); fill.position.set(50, 60, -40); scene.add(fill);

  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PX, PZ), new THREE.MeshLambertMaterial({ map: pitchTexture() }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(PX + 400, PZ + 400), new THREE.MeshLambertMaterial({ color: 0x6f7c88 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; scene.add(ground);
  const nets = { '-1': buildGoal(scene, -1), '1': buildGoal(scene, 1) };
  const { crowds, flashSpots, crowdU } = buildStands(scene, homeHue, awayHue, low, venue);
  let waveT = -1, lastWave = 0;
  // Rain: streaks falling through the floodlights, recycled around the pitch.
  let rainDrops = null;
  if (rain || snow) {
    const n = (low ? 700 : 1800) * (snow ? 0.8 : 1) | 0, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 150; pos[i * 3 + 1] = Math.random() * 40; pos[i * 3 + 2] = (Math.random() - 0.5) * 110; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainDrops = new THREE.Points(g, new THREE.PointsMaterial({ color: snow ? 0xffffff : 0xd8e2ee, size: snow ? 0.32 : 0.45, transparent: true, opacity: snow ? 0.85 : 0.5, depthWrite: false }));
    rainDrops.frustumCulled = false; scene.add(rainDrops);
  }
  buildFloodlights(scene, night);
  const boardMat = buildBoards(scene, boards);
  const flags = buildCornerFlags(scene);

  // ── Players ──
  const lam = c => new THREE.MeshLambertMaterial({ color: c });
  const blobTex = blobTexture();
  // Skin, face, hair and eye materials per look (lit skin and close-up faces unless on low quality).
  const { geo, skins, faces, hairs, matsFor } = lookKit(!low);
  const boots = [0x15181d, 0xf2f2f2, 0xff5a1f, 0x21d07a, 0x2aa7ff].map(lam);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: night ? 0.55 : 1 });
  const streakMat = night ? new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.4 }) : null;
  const kitCol = h => new THREE.Color().setHSL(h / 360, 0.78, 0.48);
  const team = {
    home: { hue: homeHue, pattern: Math.round(homeHue / 7) % 4, sleeve: lam(kitCol(homeHue)), shorts: lam(0xf4f4f4), sock: lam(kitCol(homeHue)) },
    away: { hue: awayHue, pattern: Math.round(awayHue / 11) % 4, sleeve: lam(kitCol(awayHue)), shorts: lam(0x1d2330), sock: lam(0x1d2330) },
  };
  // The same club pattern as the classic figures' shirts, on the motion-captured model.
  for (const t of Object.values(team)) t.shirt3d = kitShirtMaterial(kitCol(t.hue), t.pattern, t.pattern === 1 ? 0xf4f4f4 : new THREE.Color().setHSL(t.hue / 360, 0.8, 0.3), F ? F.height : 1.8);
  const gkKit = { home: ['#f2d21f', 0xf2d21f], away: ['#31d17c', 0x31d17c] };
  // Club kits chosen in the Player Studio's kit workshop (colours, pattern, goalkeeper kit).
  for (const side of ['home', 'away']) {
    const k = kits && kits[side]; if (!k || !k.shirt) continue;
    const t = team[side], shirt = new THREE.Color(k.shirt), hsl = {}; shirt.getHSL(hsl);
    t.hue = Math.round(hsl.h * 360); t.pattern = KIT_PATTERN[k.pattern] ?? 0;
    t.sleeve = lam(shirt); t.shorts = lam(new THREE.Color(k.shorts || '#f4f4f4')); t.sock = lam(new THREE.Color(k.socks || k.shirt));
    t.shirt3d = kitShirtMaterial(shirt, t.pattern, new THREE.Color(k.second || '#ffffff'), F ? F.height : 1.8);
    if (k.gk) gkKit[side] = [k.gk, new THREE.Color(k.gk).getHex()];
  }
  const gloves = lam(0xffffff);
  const players = { home: [], away: [] };
  const refMats = { shirt: new THREE.MeshLambertMaterial({ map: shirtTexture(0, 0, null, '#16181c') }), sleeve: lam(0x16181c), shorts: lam(0x16181c), sock: lam(0x16181c), skin: skins[1], face: faces[1], hair: hairs[0], hairSoft: hairs[0], hairStyle: 0, boot: boots[0], blob: blobMat };
  const official = (lkSkin, style) => {
    const mats = { ...refMats, skin: skins[lkSkin], face: faces[lkSkin], hairStyle: style };
    return F ? makeFootballer(F, geo, mats) : makePlayer(geo, mats);
  };
  const referee = official(1, 0); referee.position.set(-6, 0, 8); scene.add(referee);
  // Cards in the referee's hand
  const cardY = new THREE.Mesh(geo.card, new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide }));
  const cardR = new THREE.Mesh(geo.card, new THREE.MeshBasicMaterial({ color: 0xe0161f, side: THREE.DoubleSide }));
  for (const cd of [cardY, cardR]) { cd.visible = false; if (referee.userData.mocap) attachToBone(referee, referee.userData.armR.hand, cd, new THREE.Vector3(0.04, 0.12, 0), S); else { cd.position.set(0.02, -0.11, 0); referee.userData.armR.hand.add(cd); } }
  // Two assistant referees on the touchlines, each covering a half, with a flag
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide });
  const assistants = [{ fig: official(4, 2), side: 1, z: -(W / 2 + 1.2), x: 20 }, { fig: official(6, 1), side: -1, z: W / 2 + 1.2, x: -20 }];
  for (const as of assistants) {
    const pole = new THREE.Mesh(geo.pole, refMats.sleeve), fl = new THREE.Mesh(geo.flag, flagMat);
    pole.rotation.z = -Math.PI / 2; fl.position.set(0, 0.6, 0); pole.add(fl);
    if (as.fig.userData.mocap) { pole.rotation.set(0, 0, 0.35); attachToBone(as.fig, as.fig.userData.armR.hand, pole, new THREE.Vector3(0.05, -0.02, 0), S); } else { pole.position.set(0, -0.05, 0); as.fig.userData.armR.hand.add(pole); }
    as.fig.position.set(as.x, 0, as.z); scene.add(as.fig);
  }
  // Fourth official at halfway with the substitution board
  const fourth = official(3, 3); fourth.position.set(0, 0, W / 2 + 3.2); fourth.userData.face = -Math.PI / 2; fourth.rotation.y = -Math.PI / 2; scene.add(fourth);
  const boardCanvas = document.createElement('canvas'); boardCanvas.width = 128; boardCanvas.height = 88;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  const subBoard = new THREE.Mesh(geo.board, [refMats.sleeve, refMats.sleeve, refMats.sleeve, refMats.sleeve, new THREE.MeshBasicMaterial({ map: boardTex }), new THREE.MeshBasicMaterial({ map: boardTex })]);
  subBoard.visible = false; scene.add(subBoard);
  let boardShown = null;
  function drawBoard(outN, inN) {
    const g = boardCanvas.getContext('2d');
    g.fillStyle = '#05070a'; g.fillRect(0, 0, 128, 88);
    g.font = 'bold 36px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ff2b2b'; g.fillText(String(outN).padStart(2, '0'), 64, 24);
    g.fillStyle = '#2bff6a'; g.fillText(String(inN).padStart(2, '0'), 64, 66);
    boardTex.needsUpdate = true;
  }

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
    if (renderer.__owner === self) renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function own() {
    if (renderer.__owner === self && renderer.domElement.parentNode === container) return;
    renderer.__owner = self;
    if (renderer.domElement.parentNode !== container) container.prepend(renderer.domElement);
    renderer.setPixelRatio(pixelRatio); renderer.shadowMap.enabled = shadows; renderer.shadowMap.needsUpdate = true;
    resize();
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);

  const subsOn = { home: 0, away: 0 };
  function buildFigure(v, side, i, d, number) {
    const lineup = (v.m.lineups && v.m.lineups[side]) || [];
    const entry = lineup.find(x => x.playerId === d.id) || lineup[i];
    const lk = (entry && entry.playerId === d.id && entry.look) || ((v.m.lineups || {}).looks || {})[d.id] || null;
    const gk = !!(entry && entry.slot === 'GK' && entry.playerId === d.id) || (lk && lk.gk);
    const tm = team[side];
    const kit = gk
      ? { shirt: new THREE.MeshLambertMaterial({ map: shirtTexture(0, 0, number, gkKit[side][0]) }), sleeve: lam(gkKit[side][1]), shorts: lam(0x20242c), sock: lam(gkKit[side][1]), glove: gloves }
      : { shirt: new THREE.MeshLambertMaterial({ map: shirtTexture(tm.hue, tm.pattern, number) }), shirt3d: tm.shirt3d, sleeve: tm.sleeve, shorts: tm.shorts, sock: tm.sock };
    const n = Math.abs(Number(d.id) || i * 7 + 3);
    const bd = badges && badges[side];
    const mats = { ...kit, ...matsFor(lk), look: lk, hairStyle: (n >> 4) % 4, boot: boots[(n >> 1) % boots.length], blob: blobMat, streak: streakMat, number, lightNumber: !gk, shirtName: String(d.name || '').split(' ').slice(-1)[0], detail: !low,
      sponsor: !gk && bd ? bd.sponsor : null, crest: bd && bd.crest ? bd.crest : null };
    const p = F ? makeFootballer(F, geo, mats) : makePlayer(geo, mats);
    p.userData.gk = gk; p.userData.pid = d.id; p.userData.number = number;
    p.userData.face = side === 'home' ? 0 : Math.PI;
    scene.add(p);
    return p;
  }
  function ensurePlayers(v) {
    for (const side of ['home', 'away']) {
      if (!players[side].length) {
        let num = 1;
        const lineup = (v.m.lineups && v.m.lineups[side]) || [];
        v.dots[side].forEach((d, i) => { const gk = lineup[i] && lineup[i].slot === 'GK'; players[side].push(buildFigure(v, side, i, d, gk ? 1 : ++num)); });
        continue;
      }
      // A substitute coming on gets his own face and build (and a squad number from 12 up).
      v.dots[side].forEach((d, i) => {
        const old = players[side][i];
        if (!old || old.userData.pid === d.id || d.id == null) return;
        const outN = old.userData.number, inN = 12 + subsOn[side]++;
        const fresh = buildFigure(v, side, i, d, inN);
        fresh.position.copy(old.position); fresh.userData.face = old.userData.face; fresh.userData.lx = old.userData.lx; fresh.userData.lz = old.userData.lz;
        scene.remove(old);
        players[side][i] = fresh;
        drawBoard(outN, inN); boardShown = { until: performance.now() + 4200 };
      });
    }
  }

  const wrap = d => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
  const turn = (u, want, k) => { const step = wrap(want - u.face) * Math.min(1, k); u.face += step; return step; };
  let lastNow = 0, lastStrike = null, lastCel = null, lastSimT = null;
  const refPos = { x: -6, z: 8 };

  return {
    render(v, now) {
      own();
      ensurePlayers(v);
      const t = now / 1000, sim = v.sim || {};
      const dt = lastNow ? Math.min(0.1, Math.max(0.001, (now - lastNow) / 1000)) : 0.016; lastNow = now;
      const simRate = lastSimT == null ? 1 : Math.max(0.3, Math.min(3, (sim.t - lastSimT) / dt));
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
          { const hd = p.userData.head, det = hd && hd.userData.detail; if (det) det.visible = camera.position.distanceToSquared(p.position) < 324; }   // eyes and lips only within 18 m of the camera
          if (frozen) return;
          const a = { speed: Math.min(speed, 11), power: 1 };
          const isHolder = sim.poss === side && sim.holder === i;
          const ballNear = Math.hypot(bx - px, bz - pz);
          if (sim.injured && sim.injured.side === side && sim.injured.idx === i && sim.t - sim.injured.t0 < 3.2) a.injured = sim.t - sim.injured.t0;
          else if (cel) a.cel = side !== cel.side ? 'sad' : i === cel.scorer ? 'scorer' : u.gk ? null : 'mate';
          else if (sim.dive && sim.dive.side === side && sim.dive.idx === i && sim.phase === 'shot') {
            const age = sim.t - sim.dive.t0;
            const eta = sim.shot ? sim.shot.t0 + sim.shot.dur - sim.t : 0.2;
            a.eta = eta;
            if (sim.dive.kind === 'catch') a.catchBall = age; else if (sim.dive.kind === 'punch') a.punch = age;
            else if (sim.dive.kind !== 'watch') {
              // The side he dives to is decided when the shot is struck and kept for the whole dive.
              if (u.diveT0 !== sim.dive.t0) { u.diveT0 = sim.dive.t0; u.diveSign = (Math.sign(sim.dive.y - d.y) || 1) * (Math.cos(u.face) >= 0 ? 1 : -1); }
              a.dive = { age, eta, low: (sim.dive.z ?? 0.2) < 0.1, reach: sim.dive.y - d.y, sign: u.diveSign };
            }
          }
          else if (sim.block && sim.block.side === side && sim.block.idx === i && sim.t - sim.block.t0 < 0.7) a.block = sim.t - sim.block.t0;
          else if (!u.gk && by > 1.5 && by < 3 && ballNear < 1.3 && (sim.pass || sim.phase === 'shot')) { u.hd = (u.hd || 0) + dt * 2.2; a.header = Math.min(1, u.hd); a.headerHigh = by > 2.3; }
          else if (sim.throwIn && sim.throwIn.side === side && sim.throwIn.idx === i && sim.t >= sim.throwIn.at - 0.8 && sim.t < sim.throwIn.at + 0.8) a.throwIn = sim.t - (sim.throwIn.at - 0.8);
          else if (sim.receiving && sim.receiving.side === side && sim.receiving.idx === i && sim.t - sim.receiving.t0 < 0.8) { a.receive = sim.t - sim.receiving.t0; a.receiveChest = !!sim.receiving.chest; }
          else if (sim.touch && sim.touch.chest && sim.touch.side === side && sim.touch.idx === i && sim.t - sim.touch.t0 < 0.5) a.chest = sim.t - sim.touch.t0;
          else if (sim.touch && sim.touch.side === side && sim.touch.idx === i && sim.t - sim.touch.t0 < 0.35) a.touch = sim.t - sim.touch.t0;
          else if (sim.tackle && sim.tackle.side === side && sim.tackle.idx === i && tackleAge < 0.6) { if (sim.tackle.kind === 'standing') a.poke = tackleAge; else a.slide = tackleAge; }
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
          if (u.shadows) u.shadows.rotation.y = -u.face;
          a.turn = turned / dt; a.rel = speed > 0.5 ? wrap(moveAng - u.face) : 0; a.look = wrap(ballAng - u.face); a.near = ballDist < 7 && by < 1.2; a.dribble = dribble;
          // Shielding: the man on the ball with an opponent tight beside or behind him.
          if (dribble && u.bones) {
            let best = 2.4, lzB = 0;
            for (const od of v.dots[side === 'home' ? 'away' : 'home']) {
              if (od.off) continue;
              const dx = (od.x - 0.5) * L - px, dz = (od.y - 0.5) * W - pz, dd = Math.hypot(dx, dz);
              if (dd >= best) continue;
              const lx = dx * Math.cos(u.face) - dz * Math.sin(u.face);
              if (lx > 1.0) continue;                                  // in front of him: not shielding, taking him on
              best = dd; lzB = dx * Math.sin(u.face) + dz * Math.cos(u.face);
            }
            if (best < 2.4) a.shield = lzB < 0 ? 1 : -1;
          }
          if (!a.header) u.hd = 0;
          if (sim.card && sim.t - sim.card.t0 < 2.5 && sim.card.side === side && i !== sim.card.idx && !cel) { const bk = (v.dots[side] || [])[sim.card.idx]; if (bk && Math.hypot(bk.x - d.x, (bk.y - d.y) * 0.65) < 0.08) a.appeal = true; }
          if (u.mocap) animateFootballer(u, a, dt, t, simRate); else pose(u, a, dt, t, i);
        });
      }

      // Referee keeps up with play, a few metres off the ball; for a card he goes to the player.
      const card = sim.card && sim.t - sim.card.t0 < 3 ? sim.card : null;
      const booked = card ? (v.dots[card.side] || [])[card.idx] : null;
      cardY.visible = cardR.visible = false;
      if (!frozen) {
        let rx = Math.max(-L / 2 + 4, Math.min(L / 2 - 4, bx - 7)), rz = Math.max(-W / 2 + 4, Math.min(W / 2 - 4, bz + (bz > 0 ? -9 : 9)));
        if (booked) { rx = (booked.x - 0.5) * L - 1.6; rz = (booked.y - 0.5) * W + 0.4; }
        const dx = rx - refPos.x, dz = rz - refPos.z, dist = Math.hypot(dx, dz), u = referee.userData;
        const stepLen = Math.min(dist, (dist > 4 ? 6.5 : dist > 1.5 ? 2.5 : 0) * dt);
        if (dist > 0.01) { refPos.x += dx / dist * stepLen; refPos.z += dz / dist * stepLen; }
        referee.position.set(refPos.x, 0, refPos.z);
        const refTurn = turn(u, stepLen / dt > 0.9 ? Math.atan2(-dz, dx) : Math.atan2(-(bz - refPos.z), bx - refPos.x), dt * 8);
        referee.rotation.y = u.face;
        const showing = booked && dist < 2.2;
        if (showing) (card.color === 'red' ? cardR : cardY).visible = true;
        const refA = { speed: stepLen / dt, power: 1, turn: refTurn / dt, rel: 0, look: wrap(Math.atan2(-(bz - refPos.z), bx - refPos.x) - u.face), card: showing };
        if (u.mocap) animateFootballer(u, refA, dt, t, simRate); else pose(u, refA, dt, t, 30);
        // Assistants run the line, level with play in their half
        for (const as of assistants) {
          const ux = as.fig.userData;
          const target = as.side > 0 ? Math.max(4, Math.min(L / 2 - 2, bx + 3)) : Math.min(-4, Math.max(-L / 2 + 2, bx - 3));
          const dx2 = target - as.x, st2 = Math.sign(dx2) * Math.min(Math.abs(dx2), (Math.abs(dx2) > 6 ? 6.5 : Math.abs(dx2) > 1 ? 2.2 : 0) * dt);
          as.x += st2; as.fig.position.x = as.x;
          const faceIn = as.z < 0 ? -Math.PI / 2 : Math.PI / 2;
          turn(ux, faceIn, dt * 6); as.fig.rotation.y = ux.face;
          const asA = { speed: Math.abs(st2) / dt, rel: Math.sign(st2) * (as.z < 0 ? 1 : -1) * Math.PI / 2, power: 1, look: wrap(Math.atan2(-(bz - as.fig.position.z), bx - as.x) - ux.face), flag: true };
          if (ux.mocap) animateFootballer(ux, asA, dt, t, simRate); else pose(ux, asA, dt, t, 40 + as.side);
        }
        const boardUp = boardShown && now < boardShown.until;
        subBoard.visible = !!boardUp;
        if (boardUp) subBoard.position.set(0.5, 2.55 * S, W / 2 + 3.2);
        const fA = { speed: 0, power: 1, rel: 0, look: wrap(Math.atan2(-(bz - W / 2 - 3.2), bx) - fourth.userData.face), boardUp };
        if (fourth.userData.mocap) animateFootballer(fourth.userData, fA, dt, t, simRate); else pose(fourth.userData, fA, dt, t, 50);
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
      {
        // The crowd: moods follow the goals, tension follows the chance, and a wave in quiet spells.
        const ease = Math.min(1, dt * 3), mood = crowdU.uMood.value;
        const target = cel ? (cel.side === 'home' ? [1, -1] : [-1, 1]) : [0, 0];
        mood.x += (target[0] - mood.x) * ease; mood.y += (target[1] - mood.y) * ease;
        crowdU.uTension.value += ((threat ? 1 : 0) - crowdU.uTension.value) * Math.min(1, dt * 2);
        crowdU.uTime.value = t;
        if (waveT < 0 && !threat && !cel && t - lastWave > 120 && Math.random() < dt * 0.03) { waveT = 0; lastWave = t; }
        if (waveT >= 0) { waveT += dt; if (waveT > 9 || threat || cel) waveT = -1; }
        crowdU.uWave.value = waveT;
        crowds[0].position.y = 0; crowds[1].position.y = 0;
      }
      if (rainDrops) {
        // Rain falls straight and fast; snow drifts down slowly, swaying.
        const a = rainDrops.geometry.attributes.position, arr = a.array, st = Math.min(0.1, dt), fall = st * (snow ? 3.2 : 26);
        for (let i = 1; i < arr.length; i += 3) { arr[i] -= fall; if (snow) arr[i - 1] += Math.sin(t * 0.8 + i) * st * 0.9; if (arr[i] < 0) arr[i] += 40; }
        a.needsUpdate = true;
      }
      boardMat.map.offset.x = t * 0.012;
      flags.forEach((f, i) => { f.rotation.y = windy ? 0.9 + Math.sin(t * 9 + i) * 0.35 : Math.sin(t * 3 + i) * 0.5; });   // wind: flags stream out and snap

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
          label.style.display = tmp.z < 1 && !cel && v.introT == null ? 'block' : 'none';      // the GOAL banner already names the scorer
          label.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`; label.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
          const nm = (hd.name || '').split(' ').slice(-1)[0] + (hd.rt ? ` · ${hd.rt}` : ''); if (label.textContent !== nm) label.textContent = nm;   // his rating where he is playing
        }
      } else if (label) label.style.display = 'none';

      // Cameras (smoothing is frame-rate independent)
      const mode = cam(), ease = r => 1 - Math.exp(-dt * r);
      const near = Math.max(0.78, Math.min(1, viewW / 760));      // small screens sit closer to the action
      if (v.introT != null) {                       // pre-match: sweep round the stadium and settle behind the centre circle
        const k = v.introT, ang = -2.4 + k * 2.1, r = lerp(95, 40, k * k), h = lerp(46, 13, k);
        camera.position.set(Math.sin(ang) * r, h, Math.cos(ang) * r); look.set(0, lerp(4, 0.5, k), 0);
      } else if (v.replay) {                        // replay: low, beside the goal it went into
        const gs = v.replay.side, cx = gs * (L / 2 - 9), cz = bz > 0 ? bz - 15 : bz + 15;
        if (v.replay.angle === 'behind') camTarget.set(gs * (L / 2 + 7), 4.2, bz * 0.35);   // second angle: from behind the goal
        else camTarget.set(cx, 3.2, cz);
        tmp.set(bx, Math.max(0.6, by * 0.7), bz); look.lerp(tmp, ease(9));
        camera.position.lerp(camTarget, ease(v.replay.cut ? 60 : 4)); v.replay.cut = false;
      } else if (cel) {                                   // close-up on the scorer
        const sc = v.dots[cel.side][cel.scorer]; const sx = (sc.x - 0.5) * L, sz = (sc.y - 0.5) * W;
        camTarget.set(sx * 0.86, 4.6, sz + (sz > 0 ? -13 : 13)); tmp.set(sx, 1.5, sz); look.lerp(tmp, ease(6));
        camera.position.lerp(camTarget, ease(2.6));
      } else {
        if (mode === 'high') { camTarget.set(bx * 0.25, 88, 36); tmp.set(bx * 0.3, 0, 0); look.lerp(tmp, ease(5)); }
        else if (mode === 'wide') { camTarget.set(bx * 0.55, 30, 64); tmp.set(bx * 0.7, 0, bz * 0.25); look.lerp(tmp, ease(4)); }
        else if (mode === 'goal') { const s = bx >= 0 ? 1 : -1; camTarget.set(s * (L / 2 + 15), 10, bz * 0.25); tmp.set(bx - s * 6, 1, bz * 0.6); look.lerp(tmp, ease(5)); }
        else if (mode === 'close') { camTarget.set(bx * 0.93, 8.5, bz + 23); tmp.set(bx, 1.1, bz * 0.92); look.lerp(tmp, ease(6)); }
        else { const zoom = (Math.abs(bx) > 30 ? 0.92 : 1) * near; camTarget.set(bx * 0.88, 12 * zoom, 28 * zoom + bz * 0.42); tmp.set(bx * 0.95, 0.6, bz * 0.66); look.lerp(tmp, ease(4.5)); }
        camera.position.lerp(camTarget, ease(3));
      }
      camera.lookAt(look);
      if (sim.net && v.introT == null) { const age = sim.t - sim.net.t0; if (age < 0.55) { const k = (1 - age / 0.55) * 0.3; camera.position.y += Math.sin(age * 46) * k; camera.position.x += Math.cos(age * 39) * k * 0.6; } }
      renderer.render(scene, camera);
    },
    // Builds the players and compiles every shader before the first frame is shown.
    async prepare(v, { textures = true } = {}) {
      own();
      ensurePlayers(v);
      const hidden = [];
      scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });   // eyes, lips and effects that appear later
      const t0 = performance.now(), p0 = renderer.info.programs ? renderer.info.programs.length : 0;
      try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); }
      catch (e) { console.warn('shader warm-up skipped', e); }
      const t1 = performance.now();
      // Textures (pitch, crowd, kits, faces) go to the GPU now too, not on the first frame.
      if (textures) scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap']) if (m[k] && m[k].isTexture) renderer.initTexture(m[k]); });
      for (const o of hidden) o.visible = false;
      if (globalThis.__m3dDebug) console.log('prepare', 'programs', p0, '→', renderer.info.programs.length, 'compile', Math.round(t1 - t0), 'ms', 'textures', Math.round(performance.now() - t1), 'ms');
    },
    // Moves the view into a new page element (the second half reuses the first half's view).
    attach(host) {
      if (!host || host === container) return;
      if (ro) ro.disconnect();
      container = host;
      if (ro) ro.observe(host);
      renderer.__owner = null; own();
    },
    // A new half: the same figures follow the players to their new places in the line-up, players
    // who came on at half-time get theirs, and nothing carries over from the last frame.
    rebind(v) {
      for (const side of ['home', 'away']) {
        const old = players[side].slice(), next = [];
        v.dots[side].forEach((d, i) => { const k = old.findIndex(p => p && p.userData.pid === d.id); if (k >= 0) { next[i] = old[k]; old[k] = null; } });
        v.dots[side].forEach((d, i) => { if (!next[i]) next[i] = buildFigure(v, side, i, d, 12 + subsOn[side]++); });
        for (const p of old) if (p) scene.remove(p);
        for (const p of next) { p.userData.lx = null; p.userData.lz = null; }
        players[side] = next;
      }
      lastNow = 0; lastSimT = null; lastStrike = null; lastCel = null;
    },
    info() { return { programs: renderer.info.programs ? renderer.info.programs.length : null, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
    dispose() {
      if (ro) ro.disconnect();
      // Geometry and textures are freed; materials are left to the garbage collector so their
      // compiled shader programs stay with the shared renderer for the next match.
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); }); } });
      renderer.renderLists.dispose();
      if (renderer.__owner === self) { renderer.__owner = null; if (renderer.domElement.parentNode === container) renderer.domElement.remove(); }
    },
  };
}

// ── Animation lab (public/dev/anim-lab.html): every clip on its own footballer, for checking
// orientation, foot contact and distortion without playing a match.
export async function animLab(container, { keys = null, cols = 6 } = {}) {
  const F = await loadFootballer();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x203040);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x335533, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(5, 10, 8); scene.add(sun);
  const geo = playerGeometry();
  const lam = c => new THREE.MeshLambertMaterial({ color: c });
  const list = keys || Object.keys(F.clips);
  const rows = Math.ceil(list.length / cols), gap = 2.6;
  const grid = new THREE.GridHelper(cols * gap + 4, (cols * gap + 4) * 2, 0x88aa88, 0x446644); grid.position.set(((cols - 1) * gap) / 2, 0, ((rows - 1) * gap) / 2); scene.add(grid);
  const figs = [];
  list.forEach((key, i) => {
    const look = { heightCm: 178 + (i % 5) * 4, build: 7, skin: i % 8, hairStyle: ['crop', 'afro', 'swept', 'fade', 'curly', 'long', 'buzz'][i % 7], hairCol: i % 6, beardStyle: ['none', 'stubble', 'full', 'goatee'][i % 4], head: i % 4, eyes: 0, brows: 1, grey: 0, cel: i % 4 };
    const blob = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
    const m = { shirt: lam(0xc0392b), sleeve: lam(0xc0392b), shorts: lam(0xf4f4f4), sock: lam(0xc0392b), boot: lam(0x111111), skin: lam(new THREE.Color(SKIN_PAL[look.skin])), face: new THREE.MeshLambertMaterial({ map: faceTexture(SKIN_PAL[look.skin]) }), hair: lam(new THREE.Color(HAIR_PAL[look.hairCol])), hairSoft: lam(new THREE.Color(HAIR_PAL[look.hairCol])), look, blob, number: i + 2 };
    const f = makeFootballer(F, geo, m);
    f.position.set((i % cols) * gap, 0, Math.floor(i / cols) * gap);
    f.rotation.y = -Math.PI / 2;                                       // face the camera (+Z)
    const u = f.userData;
    for (const k of Object.keys(u.w)) { u.w[k] = 0; u.act[k] && u.act[k].setEffectiveWeight(0); }
    const a = u.act[key]; a.enabled = true; a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.setEffectiveWeight(1); a.play();
    scene.add(f); figs.push({ f, key });
  });
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const cx = ((cols - 1) * gap) / 2, cz = ((rows - 1) * gap) / 2;
  camera.position.set(cx, 4.5 + rows * 0.8, cz + rows * gap + 6); camera.lookAt(cx, 0.9, cz);
  const resize = () => { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize();
  let last = performance.now();
  const loop = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; for (const { f } of figs) f.userData.mixer.update(dt); renderer.render(scene, camera); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return { objs: figs, figs: figs.map(x => x.key), camera, project: (i) => { camera.updateMatrixWorld(); const v = new THREE.Vector3(); figs[i].f.getWorldPosition(v); v.y = 2.3; v.project(camera); return [(v.x + 1) / 2, (1 - v.y) / 2]; },
    setTime: (sec) => { for (const { f, key } of figs) { const ac = f.userData.act[key]; ac.time = (sec % ac.getClip().duration); f.userData.mixer.update(0); } renderer.render(scene, camera); } };
}

// ── Player Studio preview ───────────────────────────────────────────────────────────────────────
// One footballer, built by exactly the same code as the match players (what the Studio shows is what
// you see on the pitch), on a lit turntable. setLook() and setKit() rebuild him, playClip() runs any
// clip from the shared animation set, exportGLB() writes him out as a .glb with his profile inside.
export async function createStudioView(container, { quality = 'high' } = {}) {
  const F = await loadFootballer();
  const hq = quality !== 'low';
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101722);
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x2a3442, 1.35));
  const key = new THREE.DirectionalLight(0xfff1e0, 1.9); key.position.set(3, 6, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbcd7ff, 1.1); rim.position.set(-4, 3, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: 0x1a2735, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const looks = lookKit(hq), lam = c => new THREE.MeshLambertMaterial({ color: c });
  const boot = lam(0x15181d), gloves = lam(0xffffff);
  let fig = null, look = null, clip = 'idle', clipSpeed = 1;
  let kit = { shirt: '#c62828', second: '#ffffff', shorts: '#ffffff', socks: '#c62828', pattern: 'plain', number: 9, name: '', gk: false, sponsor: '', crest: null, showNumber: true };
  const cam = { yaw: 0.35, dist: 5.2, height: 1.25 };
  function build() {
    if (fig) { fig.removeFromParent(); fig.traverse(o => { if (o.isMesh && o.material && o.material.map && o.material.map.isCanvasTexture && !o.material.map.userData.shared) { /* shared textures are cached */ } }); }
    const lk = look || { skin: 2, hairStyle: 'crop', hairCol: 0, beardStyle: 'none', head: 0, eyes: 0, brows: 1, heightCm: 182, build: 8, grey: 0 };
    const shirt = new THREE.Color(kit.gk ? (kit.gkColour || '#f2d21f') : kit.shirt);
    const pattern = kit.gk ? 0 : (KIT_PATTERN[kit.pattern] ?? 0);
    const m = { ...looks.matsFor(lk), look: lk, detail: true, boot, blob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
      sleeve: lam(shirt), shirt3d: kitShirtMaterial(shirt, pattern, new THREE.Color(kit.second || '#ffffff'), F.height),
      shorts: lam(new THREE.Color(kit.gk ? '#20242c' : kit.shorts)), sock: lam(new THREE.Color(kit.gk ? (kit.gkColour || '#f2d21f') : kit.socks)), glove: kit.gk ? gloves : null,
      number: kit.showNumber === false ? null : kit.number, shirtName: kit.showNumber === false ? '' : kit.name, lightNumber: !kit.gk && shirt.getHSL({}).l < 0.62,
      sponsor: kit.gk ? null : kit.sponsor || null, crest: kit.crest || null };
    fig = makeFootballer(F, looks.geo, m);
    fig.rotation.y = -Math.PI / 2;                                      // facing the camera
    fig.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    const u = fig.userData;
    for (const k2 of Object.keys(u.w)) { u.w[k2] = 0; if (u.act[k2]) u.act[k2].setEffectiveWeight(0); }
    scene.add(fig);
    playClip(clip);
  }
  function playClip(k2) {
    if (!fig) return;
    const u = fig.userData, a = u.act[k2] || u.act.idle;
    clip = u.act[k2] ? k2 : 'idle';
    for (const x of Object.values(u.act)) { x.stop(); x.enabled = false; }
    a.enabled = true; a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.setEffectiveWeight(1); a.timeScale = clipSpeed; a.play();
  }
  function placeCamera() {
    const h = (look ? look.heightCm : 182) / 182;
    const target = new THREE.Vector3(0, cam.height * h, 0);
    camera.position.set(Math.sin(cam.yaw) * cam.dist, target.y + 0.25, Math.cos(cam.yaw) * cam.dist);
    camera.lookAt(target);
  }
  const resize = () => { const w = container.clientWidth || 640, h = container.clientHeight || 480; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  // Drag to turn, wheel or pinch to zoom.
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, height: cam.height }; renderer.domElement.setPointerCapture(e.pointerId); });
  renderer.domElement.addEventListener('pointermove', e => { if (!drag) return; cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.01; cam.height = Math.max(0.3, Math.min(2.1, drag.height + (e.clientY - drag.y) * 0.004)); });
  renderer.domElement.addEventListener('pointerup', () => { drag = null; });
  renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(1.1, Math.min(9, cam.dist * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: false });
  let last = performance.now(), running = true;
  const loop = now => { if (!running) return; const dt = Math.min(0.05, (now - last) / 1000); last = now; if (fig) fig.userData.mixer.update(dt); placeCamera(); renderer.render(scene, camera); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  build();
  return {
    clips: Object.keys(F.clips),
    setLook(lk) { look = lk; build(); },
    setKit(k2) { kit = { ...kit, ...k2 }; build(); },
    playClip(k2) { playClip(k2); },
    setSpeed(v) { clipSpeed = Math.max(0.1, Math.min(2, Number(v) || 1)); if (fig) for (const a of Object.values(fig.userData.act)) a.timeScale = clipSpeed; },
    rotate(d) { cam.yaw += d; },
    zoom(f) { cam.dist = Math.max(1.1, Math.min(9, cam.dist * f)); },
    focus(part) { if (part === 'face') { cam.dist = 1.35; cam.height = 2.05; cam.yaw = 0; } else { cam.dist = 5.2; cam.height = 1.25; } },
    setBackground(c) { scene.background = new THREE.Color(c); },
    info() { let meshes = 0, tris = 0; fig.traverse(o => { if (o.isMesh) { meshes++; const gm = o.geometry; tris += gm.index ? gm.index.count / 3 : gm.attributes.position.count / 3; } }); return { meshes, triangles: Math.round(tris), clip, heightCm: look ? look.heightCm : 182, bones: fig.userData.model ? fig.userData.model.getObjectByName('pelvis') ? 'ok' : 'missing' : 'none' }; },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    async exportGLB(profile) {
      const { GLTFExporter } = await import('./vendor/jsm/exporters/GLTFExporter.js');
      const group = fig.userData.model;
      const prev = group.userData; group.userData = { ...prev, gafferProfile: profile || null, generator: 'The Gaffer Player Studio' };
      const clips = Object.values(F.clips).map(c => c.clip);
      try {
        return await new Promise((ok, no) => new GLTFExporter().parse(group, ok, no, { binary: true, animations: clips, onlyVisible: true }));
      } finally { group.userData = prev; }
    },
    dispose() { running = false; removeEventListener('resize', resize); renderer.dispose(); renderer.domElement.remove(); },
  };
}

// Reads the Player Studio profile back out of a .glb exported by the Studio (or null).
export async function readStudioGLB(arrayBuffer) {
  const { GLTFLoader } = await import('./vendor/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  let profile = null;
  gltf.scene.traverse(o => { if (!profile && o.userData && o.userData.gafferProfile) profile = o.userData.gafferProfile; });
  return { profile, meshes: (() => { let n = 0; gltf.scene.traverse(o => { if (o.isMesh || o.isSkinnedMesh) n++; }); return n; })(), animations: gltf.animations.length };
}


// ── Award ceremony ──────────────────────────────────────────────────────────────────────────────
// The winner on a podium under a spotlight — man of the match, player of the season, Golden Ball —
// holding his trophy and celebrating, with confetti. Built by the match renderer: his own look, his
// club's kit and badges.
export async function createAwardView(container, { look = null, kit = {}, gk = false, badge = null, trophy = 'cup', quality = 'auto' } = {}) {
  const F = await loadFootballer();
  const weak = (navigator.hardwareConcurrency || 4) <= 4 && /Mobi|Android/i.test(navigator.userAgent || '');
  const hq = quality === 'high' || (quality === 'auto' && !weak);
  const renderer = new THREE.WebGLRenderer({ antialias: hq });
  renderer.setPixelRatio(Math.min(hq ? 2 : 1, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1220);
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1f2a, 1.0));
  const spot = new THREE.SpotLight(0xfff2d8, 90, 30, 0.42, 0.55, 1.3); spot.position.set(0.5, 9, 4.5); spot.target.position.set(0, 1.2, 0); scene.add(spot, spot.target);
  const rim = new THREE.DirectionalLight(0x9ec5ff, 1.3); rim.position.set(-3, 3, -4); scene.add(rim);
  const front = new THREE.DirectionalLight(0xffffff, 0.6); front.position.set(0, 2, 6); scene.add(front);
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.5, 40), new THREE.MeshStandardMaterial({ color: 0x1c2b3d, roughness: 0.5, metalness: 0.3 }));
  pod.position.y = 0.25; scene.add(pod);
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: 0xd4a017 }));
  band.rotation.x = Math.PI / 2; band.position.y = 0.5; scene.add(band);
  const looks = lookKit(hq), lam = c => new THREE.MeshLambertMaterial({ color: c });
  const shirt = new THREE.Color(gk ? (kit.gk || '#f2d21f') : (kit.shirt || '#c62828'));
  const m = { ...looks.matsFor(look), look, detail: true, boot: lam(0x15181d), blob: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    sleeve: lam(shirt), shirt3d: kitShirtMaterial(shirt, gk ? 0 : (KIT_PATTERN[kit.pattern] ?? 0), new THREE.Color(kit.second || '#ffffff'), F.height),
    shorts: lam(new THREE.Color(gk ? '#20242c' : (kit.shorts || '#f4f4f4'))), sock: lam(new THREE.Color(gk ? (kit.gk || '#f2d21f') : (kit.socks || kit.shirt || '#c62828'))),
    glove: gk ? lam(0xffffff) : null, sponsor: badge && !gk ? badge.sponsor : null, crest: badge ? badge.crest : null, number: null };
  const fig = makeFootballer(F, looks.geo, m);
  fig.position.y = 0.5; fig.rotation.y = -Math.PI / 2; scene.add(fig);
  const u = fig.userData;
  for (const k of Object.keys(u.w)) { u.w[k] = 0; if (u.act[k]) u.act[k].setEffectiveWeight(0); }
  const play = k => { const a = u.act[k] || u.act.idle; for (const x of Object.values(u.act)) { x.stop(); x.enabled = false; } a.enabled = true; a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.setEffectiveWeight(1); a.play(); };
  play(u.act.celFist ? 'celFist' : 'idle');                 // a fist pump with the trophy, feet on the podium
  // The trophy in his hand: a cup, or the golden ball on its stand.
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a821, metalness: 0.92, roughness: 0.22 });
  const prize = new THREE.Group();
  if (trophy === 'ball') {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.09, 16), gold); stand.position.y = 0.045; prize.add(stand);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 28, 20), gold); ball.position.y = 0.17; prize.add(ball);
  } else {
    const pts = [[0, 0], [0.065, 0], [0.065, 0.016], [0.022, 0.032], [0.016, 0.1], [0.032, 0.112], [0.075, 0.17], [0.08, 0.24], [0.072, 0.245], [0, 0.245]].map(([x, y]) => new THREE.Vector2(x, y));
    prize.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 32), gold));
    for (const sd of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 8, 20, Math.PI), gold); h.position.set(0, 0.19, sd * 0.08); h.rotation.set(0, sd > 0 ? 0 : Math.PI, Math.PI / 2); prize.add(h); }
  }
  if (u.armR && u.armR.hand) attachToBone(fig, u.armR.hand, prize, new THREE.Vector3(0.02, 0.05, 0), S * 2.4);
  // Confetti in gold and the club's colours.
  const N = hq ? 500 : 220, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), cols = [new THREE.Color(0xd4a017), shirt, new THREE.Color(kit.second || '#ffffff')];
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 7; pos[i * 3 + 1] = Math.random() * 6; pos[i * 3 + 2] = (Math.random() - 0.5) * 4; const c = cols[i % 3]; col.set([c.r, c.g, c.b], i * 3); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.07, vertexColors: true })); scene.add(confetti);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const resize = () => { const w = container.clientWidth || 600, h = container.clientHeight || 260; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  let last = performance.now(), running = true, t = 0;
  const loop = now => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    u.mixer.update(dt);
    const a = confetti.geometry.attributes.position, arr = a.array;
    for (let i = 1; i < arr.length; i += 3) { arr[i] -= dt * (0.6 + (i % 7) * 0.08); arr[i - 1] += Math.sin(t * 2 + i) * dt * 0.15; if (arr[i] < 0.5) arr[i] += 6; }
    a.needsUpdate = true;
    const ang = Math.sin(t * 0.35) * 0.35;
    const far = camera.aspect > 1.8 ? 8.4 : 6.8;                         // wide, short stages need the camera further back
    camera.position.set(Math.sin(ang) * far, 2.2, Math.cos(ang) * far); camera.lookAt(0, 1.75, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { dispose() { running = false; removeEventListener('resize', resize); renderer.dispose(); renderer.domElement.remove(); } };
}
