// The Gaffer — 3D match view (three.js, vendored in /vendor so it works offline).
// Renders the same match state as the 2D view (players and ball on a 0–1 pitch, ball height z)
// in a floodlit stadium: striped pitch with full markings, goals with nets, four stands with a
// crowd, floodlight pylons, kit-coloured players with shadows, and three cameras (TV, tactical,
// behind the goal). createView() throws if WebGL is unavailable; the caller falls back to 2D.
import * as THREE from './vendor/three.module.min.js';

const L = 105, W = 68;                  // pitch size in metres
const PX = 120, PZ = 80;                // grass area incl. run-off

function pitchTexture() {
  const s = 9, cw = PX * s, ch = PZ * s;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#2f8a45' : '#2a7d3f'; g.fillRect(i * cw / 16, 0, cw / 16 + 1, ch); }
  const x0 = (PX - L) / 2 * s, z0 = (PZ - W) / 2 * s, m = v => v * s;
  g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 0.14 * s; g.fillStyle = 'rgba(255,255,255,.92)';
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
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function netTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 4);
  return t;
}

function buildGoal(scene, side) {
  const x = side * L / 2, gw = 7.32, gh = 2.44, depth = 2.2;
  const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const cyl = (len) => new THREE.CylinderGeometry(0.06, 0.06, len, 10);
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

function buildStands(scene, homeHue, awayHue) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.6, metalness: 0.3 });
  const stands = [
    { cx: 0, cz: -(PZ / 2 + 9), w: PX + 10, rot: 0 }, { cx: 0, cz: PZ / 2 + 9, w: PX + 10, rot: Math.PI },
    { cx: -(PX / 2 + 9), cz: 0, w: PZ, rot: Math.PI / 2 }, { cx: PX / 2 + 9, cz: 0, w: PZ, rot: -Math.PI / 2 },
  ];
  const seats = [];
  for (const st of stands) {
    const grp = new THREE.Group(); grp.position.set(st.cx, 0, st.cz); grp.rotation.y = st.rot; scene.add(grp);
    for (let tier = 0; tier < 8; tier++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(st.w, 1.2, 2), concrete);
      step.position.set(0, 0.6 + tier * 1.2, 7 - tier * 2);
      step.receiveShadow = true; grp.add(step);
      for (let i = -st.w / 2 + 1; i < st.w / 2 - 1; i += 1.1) seats.push({ grp, x: i, y: 1.6 + tier * 1.2, z: -tier * 2 + 7 });
    }
    // The main stand (where the TV camera sits) has no roof in shot.
    if (st.cz <= 0 || st.rot !== Math.PI) { const roof = new THREE.Mesh(new THREE.BoxGeometry(st.w, 0.4, 18), roofMat); roof.position.set(0, 13, -1); grp.add(roof); }
  }
  // Crowd: one instanced mesh, fans in both clubs' colours and neutral clothes.
  const fan = new THREE.BoxGeometry(0.55, 0.9, 0.45);
  const fanMat = new THREE.MeshLambertMaterial();
  const crowd = new THREE.InstancedMesh(fan, fanMat, seats.length);
  const m = new THREE.Matrix4(), col = new THREE.Color(), v = new THREE.Vector3();
  const palette = [new THREE.Color().setHSL(homeHue / 360, 0.75, 0.5), new THREE.Color().setHSL(awayHue / 360, 0.75, 0.48), new THREE.Color(0xd9d9d9), new THREE.Color(0x30343c), new THREE.Color(0x6b4f3a)];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  seats.forEach((s, i) => {
    s.grp.updateMatrixWorld(true);
    v.set(s.x + (rnd() - 0.5) * 0.3, s.y, s.z).applyMatrix4(s.grp.matrixWorld);
    m.makeTranslation(v.x, v.y, v.z);
    crowd.setMatrixAt(i, m);
    const r = rnd();
    col.copy(palette[r < 0.45 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4]).multiplyScalar(0.75 + rnd() * 0.4);
    crowd.setColorAt(i, col);
  });
  crowd.instanceMatrix.needsUpdate = true;
  scene.add(crowd);
  return crowd;
}

function buildFloodlights(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.6, roughness: 0.4 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = x * (PX / 2 + 14), pz = z * (PZ / 2 + 14);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 34, 8), mat); pole.position.set(px, 17, pz); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.6), lamp); head.position.set(px, 34, pz); head.lookAt(0, 0, 0); scene.add(head);
  }
}

function boardTexture(words) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64;
  const g = c.getContext('2d');
  const cols = ['#0d2a4a', '#7a1020', '#0e4a2c', '#3a2a66'];
  const n = 8, w = c.width / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[i % cols.length]; g.fillRect(i * w, 0, w, 64);
    g.fillStyle = '#fff'; g.font = 'bold 30px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(words[i % words.length] || '').toUpperCase().slice(0, 16), i * w + w / 2, 34, w - 16);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Advertising boards around the pitch: the shirt sponsor and both clubs.
function buildBoards(scene, words) {
  const mat = new THREE.MeshBasicMaterial({ map: boardTexture(words) });
  const far = new THREE.Mesh(new THREE.PlaneGeometry(L + 6, 1.1), mat); far.position.set(0, 0.55, -(W / 2 + 4)); scene.add(far);
  for (const side of [-1, 1]) {
    for (const z of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W / 2 - 8, 1.1), mat);
      m.position.set(side * (L / 2 + 4.5), 0.55, z * (W / 4 + 3)); m.rotation.y = -side * Math.PI / 2; scene.add(m);
    }
  }
}

function makePlayer(color, shorts, skin, hair) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const shortsMat = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const sockMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const body = new THREE.Group(); g.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.5, 4, 10), shirt); torso.position.y = 1.25; torso.scale.set(0.8, 1, 1.15); torso.castShadow = true;
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.24, 0.32, 10), shortsMat); hips.position.y = 0.84; hips.scale.set(0.85, 1, 1.1); hips.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), skinMat); head.position.y = 1.8; head.castShadow = true;
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.168, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: hair, roughness: 0.9 })); hairM.position.y = 1.82;
  body.add(torso, hips, head, hairM);
  const limb = (mat, len, r) => { const piv = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), mat); m.position.y = -len / 2 - r; m.castShadow = true; piv.add(m); return piv; };
  const legL = limb(skinMat, 0.62, 0.095), legR = limb(skinMat, 0.62, 0.095);
  legL.position.set(0, 0.78, 0.12); legR.position.set(0, 0.78, -0.12);
  for (const leg of [legL, legR]) { const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.3, 8), sockMat); sock.position.y = -0.62; leg.add(sock); }
  const armL = limb(shirt, 0.42, 0.075), armR = limb(shirt, 0.42, 0.075);
  armL.position.set(0, 1.5, 0.36); armR.position.set(0, 1.5, -0.36);
  body.add(armL, armR); g.add(legL, legR);
  g.userData = { legL, legR, armL, armR, body, face: 0 };
  return g;
}

export async function createView(container, { homeHue = 210, awayHue = 0, cam = () => 'tv', boards = ['THE GAFFER'] } = {}) {
  if (!container) throw new Error('no container');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1220);
  scene.fog = new THREE.Fog(0x0a1220, 140, 320);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 700);
  camera.position.set(0, 21, 47);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1d3a1d, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3dc, 1.7);
  sun.position.set(-40, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 50, bottom: -50, near: 10, far: 220 });
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5); fill.position.set(50, 60, -40); scene.add(fill);

  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(PX, PZ), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; scene.add(pitch);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(PX + 60, PZ + 60), new THREE.MeshStandardMaterial({ color: 0x1b2430 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
  const nets = { '-1': buildGoal(scene, -1), '1': buildGoal(scene, 1) };
  const crowd = buildStands(scene, homeHue, awayHue);
  buildFloodlights(scene);
  buildBoards(scene, boards);

  const kit = h => new THREE.Color().setHSL(h / 360, 0.75, 0.5);
  const players = { home: [], away: [] };
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
  ball.castShadow = true; scene.add(ball);
  // Dark panels on the ball so its spin is visible.
  for (const [x, y, z] of [[0.2, 0, 0], [-0.2, 0, 0], [0, 0.2, 0], [0, -0.2, 0], [0, 0, 0.2], [0, 0, -0.2]]) { const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x15181d })); dot.position.set(x, y, z); ball.add(dot); }

  const look = new THREE.Vector3(0, 0, 0), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), prevBall = new THREE.Vector3();
  const label = container.querySelector('#mvLabel');
  function resize() {
    const w = container.clientWidth || 640, h = container.clientHeight || 360;
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
      v.dots[side].forEach((d, i) => {
        const gk = lineup[i] && lineup[i].slot === 'GK';
        const color = gk ? new THREE.Color(side === 'home' ? 0xf2e14b : 0x5be37a) : kit(side === 'home' ? homeHue : awayHue);
        const n = (d.id || i);
        const p = makePlayer(color, side === 'home' ? 0xf4f4f4 : 0x1d2330, [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69][n % 4], [0x1a1410, 0x3b2a1a, 0x0c0c0c, 0xb08a4a][(n >> 2) % 4]);
        p.userData.face = side === 'home' ? 0 : Math.PI;
        scene.add(p);
        players[side].push(p);
      });
    }
  }

  return {
    render(v, now) {
      ensurePlayers(v);
      const t = now / 1000, sim = v.sim || {};
      const cel = sim.phase === 'celebrate' ? sim.celebrate : null;
      const bx = (v.ball.x - 0.5) * L, bz = (v.ball.y - 0.5) * W, by = 0.22 + (v.ball.z || 0) * 6;
      for (const side of ['home', 'away']) {
        v.dots[side].forEach((d, i) => {
          const p = players[side][i]; if (!p) return;
          p.visible = !d.off;
          const u = p.userData;
          p.position.x = (d.x - 0.5) * L; p.position.z = (d.y - 0.5) * W;
          const vx = (d.vx || 0) * L, vz = (d.vy || 0) * W, speed = Math.hypot(vx, vz);
          const run = Math.min(1, speed / 6.5);
          // Face the way he runs; when standing, face the ball.
          const want = speed > 0.6 ? Math.atan2(-vz, vx) : Math.atan2(-(bz - p.position.z), bx - p.position.x);
          let diff = want - u.face; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
          u.face += diff * 0.18; p.rotation.y = u.face;
          const phase = t * (7 + run * 6) + i * 1.9;
          const swing = Math.sin(phase) * (0.25 + run * 0.75) * (speed > 0.15 ? 1 : 0);
          u.legL.rotation.z = swing; u.legR.rotation.z = -swing;
          u.armL.rotation.z = -swing * 0.8; u.armR.rotation.z = swing * 0.8;
          u.body.rotation.z = -run * 0.16;
          let y = Math.abs(Math.sin(phase)) * 0.07 * run;
          u.body.rotation.x = 0;
          if (cel && side === cel.side) {            // celebration: arms up, jumping
            u.armL.rotation.z = u.armR.rotation.z = 2.6 + Math.sin(t * 9 + i) * 0.3;
            y += Math.abs(Math.sin(t * 6 + i)) * 0.45;
          } else if (sim.dive && sim.dive.side === side && sim.dive.idx === i && sim.phase === 'shot') {   // keeper dives
            const dirY = Math.sign(sim.dive.y - d.y) || 1;
            u.body.rotation.x = dirY * 1.1 * (side === 'home' ? 1 : -1);
            u.armL.rotation.z = u.armR.rotation.z = 2.8; y += 0.35;
          } else if (sim.phase === 'held' && !sim.goalKick && sim.poss === side && sim.holder === i) { u.armL.rotation.z = u.armR.rotation.z = 1.3; }
          p.position.y = y;
        });
      }
      // Ball: position, spin from its movement
      ball.position.set(bx, by, bz);
      tmp.copy(ball.position).sub(prevBall); prevBall.copy(ball.position);
      if (tmp.length() > 0.001) { ball.rotation.z -= tmp.x / 0.22; ball.rotation.x += tmp.z / 0.22; }
      // Net bulges when the ball hits it
      for (const k of ['-1', '1']) nets[k].scale.x = 1;
      if (sim.net) { const age = sim.t - sim.net.t0; const n = nets[sim.net.side === 'home' ? '1' : '-1']; if (age < 1.2) n.scale.x = 1 + Math.sin(Math.min(1, age / 0.5) * Math.PI) * 0.5; }
      // Crowd jumps on a goal
      crowd.position.y = cel ? Math.abs(Math.sin(t * 7)) * 0.35 : 0;
      // Name tag over the player on the ball
      if (label) {
        const hd = sim.poss && (sim.phase === 'play' || sim.phase === 'held') && !sim.pass ? v.dots[sim.poss][sim.holder] : cel ? v.dots[cel.side][cel.scorer] : null;
        if (hd && !hd.off) {
          tmp.set((hd.x - 0.5) * L, 2.5, (hd.y - 0.5) * W).project(camera);
          label.style.display = tmp.z < 1 ? 'block' : 'none';
          label.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`; label.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
          const nm = (hd.name || '').split(' ').slice(-1)[0]; if (label.textContent !== nm) label.textContent = nm;
        } else label.style.display = 'none';
      }
      // Cameras
      const mode = cam();
      if (cel) {                                   // close-up on the scorer
        const sc = v.dots[cel.side][cel.scorer]; const sx = (sc.x - 0.5) * L, sz = (sc.y - 0.5) * W;
        camTarget.set(sx * 0.82, 6, sz + (sz > 0 ? -16 : 16)); tmp.set(sx, 1.4, sz); look.lerp(tmp, 0.1);
        camera.position.lerp(camTarget, 0.045);
      } else {
        if (mode === 'high') { camTarget.set(bx * 0.25, 92, 34); tmp.set(bx * 0.3, 0, 0); look.lerp(tmp, 0.08); }
        else if (mode === 'goal') { const s = bx >= 0 ? 1 : -1; camTarget.set(s * (L / 2 + 16), 11, bz * 0.25); tmp.set(bx - s * 6, 1, bz * 0.6); look.lerp(tmp, 0.08); }
        else { const zoom = Math.abs(bx) > 30 ? 0.86 : 1; camTarget.set(bx * 0.78, 21 * zoom, 47 * zoom + bz * 0.12); tmp.set(bx * 0.92, 0.5, bz * 0.45); look.lerp(tmp, 0.07); }
        camera.position.lerp(camTarget, 0.05);
      }
      camera.lookAt(look);
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
