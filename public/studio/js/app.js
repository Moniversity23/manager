// The Player Studio. The 3D footballer is built by the match renderer itself (../../match3d.js), so
// what you see here is what you see on the pitch. Profiles are validated by the game (src/studio),
// which runs on the server or, offline, in the same engine worker as the game.
import { createStudioView, readStudioGLB } from '../../match3d.js';

const $ = id => document.getElementById(id);
const A = window.GafferAppearance;
const toast = (msg, bad) => { const t = $('toast'); t.textContent = msg; t.className = `on${bad ? ' bad' : ''}`; clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = ''; }, 2800); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── the game's API: the server when it runs one, otherwise the offline engine worker ──
let mode = null, worker = null, reqId = 0;
const pending = new Map();
async function detectMode() {
  let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('gaffer_prefs') || '{}'); } catch {}
  const staticHost = /(\.github\.io|\.netlify\.app|\.vercel\.app|\.pages\.dev)$/i.test(location.hostname);
  if (!staticHost && prefs.mode !== 'offline' && /^https?:/.test(location.protocol)) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      const j = await (await fetch('../api/health', { signal: ctl.signal, cache: 'no-store' })).json(); clearTimeout(t);
      if (j && j.ok && !j.public) { mode = 'server'; return; }
    } catch {}
  }
  mode = 'offline';
  worker = new Worker('../engine.worker.js');
  worker.onmessage = e => { const cb = pending.get(e.data.id); if (cb) { pending.delete(e.data.id); cb(e.data.payload); } };
}
async function api(path, method = 'GET', body) {
  if (!mode) await detectMode();
  try {
    if (mode === 'server') { const r = await fetch('..' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return await r.json(); }
    return await new Promise(res => { const id = ++reqId; pending.set(id, res); worker.postMessage({ id, method, path, body: body || {} }); });
  } catch (e) { return { ok: false, error: e.message || 'The game could not be reached' }; }
}

// ── state ──
let view = null, profile = null, assetId = null, name = 'New Footballer', history = [], future = [];
let kits = null, kitSlot = 'home', clubInfo = null;
const GROUP_LABEL = { skin: 'Skin', face: 'Face', eyes: 'Eyes', hair: 'Hair', beard: 'Beard', body: 'Body', kit: 'Kit' };

// The renderer's look for the current profile (the same mapping the server uses for matches).
function lookOf(p) {
  const a = (p && p.appearance) || {};
  let seed = 7; for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const base = { skin: 2, hairStyle: 'crop', hairCol: 0, beardStyle: 'none', head: 0, eyes: 0, brows: 1, heightCm: 180, height: 15, build: 8, grey: 0, cel: 0, faceSeed: seed % 100000, age: a.age || 24 };
  return A.studioToLook(a, base);
}
function kitForView() {
  const k = kits ? (kitSlot === 'gk' ? kits.home : kits[kitSlot]) : null, pk = (profile && profile.appearance.kit) || {};
  const shirt = k ? k.shirt : pk.primary || '#c62828';
  return { shirt, second: k ? k.second : pk.secondary || '#ffffff', shorts: k ? k.shorts : '#ffffff', socks: k ? k.socks : shirt, pattern: k ? k.pattern : pk.pattern || 'plain',
    gk: kitSlot === 'gk', gkColour: kits ? kits.gk : '#f2d21f', number: Number($('kitNumber').value) || 9, name: $('kitName').value || name.split(' ').slice(-1)[0],
    showNumber: $('kitShowNumber').checked, sponsor: $('kitShowSponsor').checked ? (clubInfo && clubInfo.sponsor) || 'THE GAFFER' : '',
    crest: $('kitShowCrest').checked ? { initials: (clubInfo && clubInfo.initials) || 'GFC', c1: shirt, c2: (k && k.second) || '#ffffff' } : null };
}
let redrawTimer = null;
function redraw() { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => { if (!view) return; view.setKit(kitForView()); view.setLook(lookOf(profile)); renderStatus(); }, 60); }

// ── controls built from one table, so every control is wired to the model ──
const SELECTS = {
  baseBody: [['auto', 'Automatic (from skin tone)'], ['m-light', 'Realistic: light skin'], ['m-brown', 'Realistic: brown skin'], ['m-dark', 'Realistic: dark skin'], ['m-asian', 'Realistic: East Asian'], ['classic', 'Classic figure']],
  skinTone: [['very-light', 'Very light'], ['light', 'Light'], ['medium', 'Medium'], ['tan', 'Tan'], ['brown', 'Brown'], ['dark', 'Dark'], ['deep', 'Deep'], ['very-dark', 'Very dark']],
  faceShape: [['oval', 'Oval'], ['round', 'Round'], ['square', 'Square'], ['long', 'Long'], ['diamond', 'Diamond'], ['heart', 'Heart']],
  eyeShape: [['almond', 'Almond'], ['round', 'Round'], ['hooded', 'Hooded'], ['deep-set', 'Deep-set'], ['upturned', 'Upturned']],
  eyeColour: [['brown', 'Brown'], ['dark-brown', 'Dark brown'], ['hazel', 'Hazel'], ['green', 'Green'], ['blue', 'Blue'], ['grey', 'Grey']],
  lipShape: [['thin', 'Thin'], ['natural', 'Natural'], ['full', 'Full']],
  eyebrowShape: [['natural', 'Natural'], ['straight', 'Straight'], ['arched', 'Arched'], ['thick', 'Thick']],
  hairStyle: [['crop', 'Crop'], ['buzz', 'Buzz cut'], ['fade', 'Fade'], ['short-curly-fade', 'Short curly low fade'], ['curly', 'Curly'], ['afro', 'Afro'], ['twists', 'Twists'], ['swept', 'Swept'], ['long', 'Long'], ['mohawk', 'Mohawk'], ['receding', 'Receding'], ['bald', 'Bald']],
  hairColour: [['black', 'Black'], ['dark-brown', 'Dark brown'], ['brown', 'Brown'], ['light-brown', 'Light brown'], ['blond', 'Blond'], ['ginger', 'Ginger'], ['grey', 'Grey']],
  beardStyle: [['none', 'Clean shaven'], ['stubble', 'Stubble'], ['goatee', 'Goatee'], ['full', 'Full beard'], ['moustache', 'Moustache'], ['chin-strap', 'Chin strap']],
};
const SLIDER = (key, label, min = 0, max = 1, step = 0.01, unit = '') => ({ key, label, min, max, step, unit });
const FACE = [['select', 'baseBody', 'Close-up body'], ['select', 'skinTone', 'Skin tone'], ['select', 'faceShape', 'Face shape'], ['slider', SLIDER('forehead', 'Forehead')], ['slider', SLIDER('jaw', 'Jaw width')], ['slider', SLIDER('chin', 'Chin')],
  ['slider', SLIDER('cheekbones', 'Cheekbones')], ['slider', SLIDER('noseWidth', 'Nose width')], ['select', 'eyeShape', 'Eyes'], ['select', 'eyeColour', 'Eye colour'], ['select', 'eyebrowShape', 'Eyebrows'],
  ['select', 'lipShape', 'Lips'], ['slider', SLIDER('earSize', 'Ears')]];
const HAIR = [['select', 'hairStyle', 'Hair style'], ['select', 'hairColour', 'Hair colour'], ['slider', SLIDER('hairline', 'Hairline')], ['select', 'beardStyle', 'Facial hair']];
const BODY = [['slider', SLIDER('heightCm', 'Height', 160, 205, 1, ' cm')], ['slider', SLIDER('weightKg', 'Weight', 55, 110, 1, ' kg')], ['slider', SLIDER('muscularity', 'Muscle')], ['slider', SLIDER('shoulderWidth', 'Shoulders')],
  ['slider', SLIDER('chest', 'Chest')], ['slider', SLIDER('waist', 'Waist')], ['slider', SLIDER('armLength', 'Arm length')], ['slider', SLIDER('legLength', 'Leg length')]];
function buildControls(host, list) {
  $(host).innerHTML = list.map(([kind, a, b]) => kind === 'select'
    ? `<label>${b}<select data-k="${a}">${SELECTS[a].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`
    : `<label>${a.label} <span class="out" data-o="${a.key}"></span><input type="range" data-k="${a.key}" min="${a.min}" max="${a.max}" step="${a.step}" data-unit="${a.unit}"></label>`).join('');
}
function syncControls() {
  const a = profile.appearance;
  document.querySelectorAll('[data-k]').forEach(el => { const v = a[el.dataset.k]; if (v != null) el.value = v; });
  document.querySelectorAll('[data-o]').forEach(el => { const k = el.dataset.o, inp = document.querySelector(`[data-k="${k}"]`); el.textContent = inp.dataset.unit ? `${a[k]}${inp.dataset.unit}` : `${Math.round((a[k] ?? 0.5) * 100)}`; });
  $('age').value = a.age || 24; $('position').value = a.position || 'ST'; $('nation').value = a.nationality || ''; $('name').value = name;
  document.querySelectorAll('#locks input').forEach(el => { el.checked = (profile.locks || []).includes(el.value); });
}
function onControl(e) {
  const el = e.target; if (!el.dataset || !el.dataset.k) return;
  if (e.type === 'change' || el.type !== 'range') snapshot();
  const v = el.type === 'range' ? Number(el.value) : el.value;
  profile.appearance[el.dataset.k] = v;
  const out = document.querySelector(`[data-o="${el.dataset.k}"]`); if (out) out.textContent = el.dataset.unit ? `${v}${el.dataset.unit}` : `${Math.round(v * 100)}`;
  redraw();
}

function snapshot() { if (profile) { history.push(JSON.stringify({ profile, name })); if (history.length > 60) history.shift(); future = []; } }
function restore(json) { const s = JSON.parse(json); profile = s.profile; name = s.name; syncControls(); redraw(); }
function readIdentity() { const a = profile.appearance; a.age = Number($('age').value) || a.age; a.position = $('position').value; a.nationality = $('nation').value.trim().slice(0, 40); name = $('name').value.trim().slice(0, 80) || 'New Footballer'; }

function setProfile(p, nm, id) { profile = JSON.parse(JSON.stringify(p)); if (nm) name = nm; if (id !== undefined) assetId = id; syncControls(); redraw(); }

function renderStatus() {
  const info = view ? view.info() : null, a = profile.appearance;
  $('status').innerHTML = [['Name', esc(name)], ['Saved', assetId ? 'In the library' : 'Not yet'], ['Height', `${a.heightCm} cm · ${a.weightKg} kg`], ['Skeleton', info ? (info.bones === 'ok' ? 'Shared match rig' : 'Missing') : '…'],
    ['Body', view && view.body ? `Realistic (${esc(view.body.label)})` : 'Classic figure'], ['Model', info ? `${info.meshes} parts · ${info.triangles.toLocaleString()} triangles` : '…'], ['Clip', info ? info.clip : '…']].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}

// ── create, regenerate, save ──
async function generate() {
  snapshot();
  const j = await api('/api/studio/preview', 'POST', { description: $('description').value });
  if (!j.ok) return toast(j.error || 'Generation failed', true);
  const a = j.profile.appearance;
  const parsedName = $('name').value === 'New Footballer' || !$('name').value ? `${a.nationality || 'New'} ${a.position || 'player'}` : $('name').value;
  setProfile(j.profile, parsedName, null);
  toast('Footballer generated — save him to keep him.');
}
async function regen() {
  readIdentity(); snapshot();
  const locks = [...document.querySelectorAll('#locks input:checked')].map(x => x.value);
  const j = await api('/api/studio/regenerate', 'POST', { profile: { ...profile, locks }, locks, seed: `${Date.now()}` });
  if (!j.ok) return toast(j.error || 'Could not make a variation', true);
  setProfile({ ...j.profile, playerId: profile.playerId, assetId }, null);
}
async function save() {
  readIdentity();
  const body = { name, profile: { ...profile, assetId } };
  const j = assetId ? await api(`/api/studio/library/${encodeURIComponent(assetId)}`, 'PUT', body) : await api('/api/studio/generate', 'POST', { name, appearance: profile.appearance });
  if (!j.ok) return toast(j.error || 'Could not save', true);
  assetId = j.asset.assetId; profile = j.asset.profile;
  if (!body.profile.assetId) { await api(`/api/studio/library/${encodeURIComponent(assetId)}`, 'PUT', { name, profile: { ...profile, appearance: body.profile.appearance } }); }
  toast(`${name} saved to the library.`); renderStatus(); refreshLibrary();
}

// ── library ──
async function refreshLibrary() {
  const q = $('search').value.trim();
  const j = await api(`/api/studio/library${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  if (!j.ok) { $('libraryList').innerHTML = `<p class="hint">${esc(j.error || 'Library unavailable')}</p>`; return; }
  $('libraryList').innerHTML = j.assets.length ? j.assets.slice().reverse().map(x => { const a = x.profile.appearance; return `<div class="library-item${x.assetId === assetId ? ' on' : ''}" data-id="${esc(x.assetId)}"><strong>${esc(x.name)}</strong><div>${esc(a.position || '')} · ${esc(a.nationality || '')} · ${a.heightCm} cm${x.playerId != null ? ' · <span class="good">in your squad</span>' : ''}</div></div>`; }).join('') : '<p class="hint">No characters yet. Generate one and press Save.</p>';
}
async function openAsset(id) {
  const j = await api(`/api/studio/library/${encodeURIComponent(id)}`);
  if (!j.ok) return toast(j.error || 'Not found', true);
  snapshot(); setProfile(j.asset.profile, j.asset.name, j.asset.assetId); refreshLibrary();
}
async function duplicate() {
  if (!assetId) return toast('Save the character first.', true);
  const j = await api(`/api/studio/library/${encodeURIComponent(assetId)}/duplicate`, 'POST', {});
  if (!j.ok) return toast(j.error || 'Could not duplicate', true);
  setProfile(j.asset.profile, j.asset.name, j.asset.assetId); refreshLibrary(); toast('Copy made.');
}
async function remove() {
  if (!assetId) return toast('Nothing saved to delete.', true);
  if (!confirm(`Delete ${name} from the library? This cannot be undone.`)) return;
  const j = await api(`/api/studio/library/${encodeURIComponent(assetId)}`, 'DELETE');
  if (!j.ok) return toast(j.error || 'Could not delete', true);
  assetId = null; renderStatus(); refreshLibrary(); toast('Deleted.');
}

// ── files ──
function download(blob, file) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const fileName = ext => `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'footballer'}.${ext}`;
function exportJson() { readIdentity(); download(new Blob([JSON.stringify({ name, profile }, null, 2)], { type: 'application/json' }), fileName('json')); }
async function exportGlb() {
  readIdentity();
  try { const buf = await view.exportGLB({ name, ...profile }); download(new Blob([buf], { type: 'model/gltf-binary' }), fileName('glb')); toast('Exported: the .glb has his model, skeleton, animations and profile.'); }
  catch (e) { toast(`Export failed: ${e.message}`, true); }
}
async function importFile() {
  const f = $('importFile').files[0]; $('importFile').value = '';
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) return toast('That file is too large (8 MB at most).', true);
  try {
    let asset;
    if (/\.glb$/i.test(f.name)) {
      const r = await readStudioGLB(await f.arrayBuffer());
      if (!r.profile) return toast('That .glb has no Player Studio profile inside (only Studio exports can be imported).', true);
      asset = { name: r.profile.name || f.name.replace(/\.glb$/i, ''), profile: r.profile };
    } else {
      const j = JSON.parse(await f.text());
      asset = j.profile ? { name: j.name, profile: j.profile } : { name: f.name.replace(/\.json$/i, ''), profile: j };
    }
    const res = await api('/api/studio/import', 'POST', { asset });
    if (!res.ok) return toast(`Import refused: ${res.error}`, true);
    snapshot(); setProfile(res.asset.profile, res.asset.name, res.asset.assetId); refreshLibrary(); toast(`${res.asset.name} imported.`);
  } catch (e) { toast(`Not a valid character file (${e.message}).`, true); }
}

// ── career: assign to a player, club kits ──
async function loadSquad() {
  const j = await api('/api/studio/squad');
  const sel = $('assignPlayer');
  if (!j.ok) { sel.innerHTML = '<option value="">Start a career to dress your players</option>'; sel.disabled = true; $('assignBtn').disabled = $('clearBtn').disabled = true; return; }
  sel.innerHTML = j.players.map(p => `<option value="${p.id}">${esc(p.name)} · ${p.position} · ${p.age}${p.assetId ? ' · Studio look' : ''}${p.youth ? ' · academy' : ''}</option>`).join('');
}
async function assign() {
  const pid = Number($('assignPlayer').value); if (!pid) return;
  if (!assetId) await save();
  if (!assetId) return;
  const j = await api(`/api/studio/player/${pid}/assign`, 'POST', { assetId });
  if (!j.ok) return toast(j.error || 'Could not assign', true);
  await api('/api/autosave', 'POST', {});
  toast('Done — he wears this look in your next match.'); loadSquad(); refreshLibrary();
}
async function clearLook() {
  const pid = Number($('assignPlayer').value); if (!pid) return;
  const j = await api(`/api/studio/player/${pid}/clear`, 'POST', {});
  if (!j.ok) return toast(j.error || 'Could not change him back', true);
  await api('/api/autosave', 'POST', {});
  toast('He has his own look again.'); loadSquad(); refreshLibrary();
}
async function loadKits() {
  const j = await api('/api/studio/kits');
  if (!j.ok) { $('kitIntro').textContent = 'Start a career to design your club kits. You can still try colours on this player.'; $('kitApply').disabled = true; kits = null; renderKitFields(); return; }
  kits = j.kits; clubInfo = { initials: j.initials, sponsor: j.sponsor }; $('kitIntro').textContent = `${j.club}'s kits — worn in your matches${j.custom ? '' : ' (these are your current colours)'}.`;
  renderKitFields(); redraw();
}
const PATTERNS = [['plain', 'Plain'], ['vertical-stripes', 'Stripes'], ['horizontal-stripes', 'Hoops'], ['yoke', 'Yoke']];
function renderKitFields() {
  const host = $('kitFields');
  if (kitSlot === 'gk') { host.innerHTML = `<label>Goalkeeper shirt<input type="color" data-kit="gk" value="${kits ? kits.gk : '#f2d21f'}"></label>`; return; }
  const k = kits ? kits[kitSlot] : { shirt: (profile && profile.appearance.kit.primary) || '#c62828', second: '#ffffff', shorts: '#ffffff', socks: '#c62828', pattern: 'plain' };
  host.innerHTML = `<div class="grid"><label>Shirt<input type="color" data-kit="shirt" value="${k.shirt}"></label><label>Second colour<input type="color" data-kit="second" value="${k.second}"></label>
    <label>Shorts<input type="color" data-kit="shorts" value="${k.shorts}"></label><label>Socks<input type="color" data-kit="socks" value="${k.socks}"></label></div>
    <label>Pattern<select data-kit="pattern">${PATTERNS.map(([v, l]) => `<option value="${v}" ${k.pattern === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
function onKitField(e) {
  const f = e.target.dataset && e.target.dataset.kit; if (!f) return;
  if (!kits) kits = { home: { shirt: '#c62828', second: '#ffffff', shorts: '#ffffff', socks: '#c62828', pattern: 'plain' }, away: { shirt: '#ffffff', second: '#111111', shorts: '#111111', socks: '#ffffff', pattern: 'plain' }, third: { shirt: '#20242c', second: '#c62828', shorts: '#20242c', socks: '#c62828', pattern: 'plain' }, gk: '#f2d21f' };
  if (f === 'gk') kits.gk = e.target.value; else kits[kitSlot] = { ...kits[kitSlot], [f]: e.target.value };
  if (profile && kitSlot === 'home' && (f === 'shirt' || f === 'second' || f === 'pattern')) profile.appearance.kit = { ...profile.appearance.kit, primary: kits.home.shirt, secondary: kits.home.second, pattern: kits.home.pattern };
  redraw();
}
async function applyKits() {
  if (!kits) return;
  const j = await api('/api/studio/kits', 'PUT', { home: kits.home, away: kits.away, third: kits.third, gk: kits.gk });
  if (!j.ok) { $('kitMsg').textContent = j.error || 'Could not save the kits'; return toast(j.error || 'Could not save the kits', true); }
  await api('/api/autosave', 'POST', {});
  kits = { ...kits, ...j.kits }; $('kitMsg').textContent = 'Saved. Your team wears these kits from the next match.'; toast('Kits saved for your club.');
}

// ── animation lab ──
// Every clip the match players use. The football set (passes with the inside of the foot, first
// touch, chest control, tackles, the keeper's catch, punch and dives, throws) comes from Ara 3D Gen,
// retargeted onto the same skeleton; the rest from Mesh2Motion. A clip the build lacks is not listed.
const CLIPS = [['idle', 'Idle'], ['walk', 'Walk'], ['jog', 'Run'], ['sprint', 'Sprint'], ['back', 'Back-pedal'], ['strafeL', 'Side-step'],
  ['passIn', 'Pass: inside of the foot'], ['passL', 'Pass: across the body'], ['passR', 'Pass: opened up'], ['passA', 'Pass: driven'], ['shoot', 'Shoot'], ['receive', 'First touch'], ['chestCtl', 'Chest control'],
  ['headerA', 'Header'], ['headerJump', 'Jumping header'], ['tackleA', 'Standing tackle'], ['slideA', 'Slide tackle'], ['block', 'Block'], ['throwIn', 'Throw-in'],
  ['celJump', 'Celebrate: jump and turn'], ['celFist', 'Celebrate: fist'], ['celVictory', 'Celebrate: arms up'], ['celFlip', 'Celebrate: backflip'], ['celDab', 'Celebrate: dab'], ['celPower', 'Celebrate: power'], ['clap', 'Clap'],
  ['gkReady', 'Keeper: set'], ['gkCatch', 'Keeper: catch'], ['gkPunch', 'Keeper: punch'], ['gkDiveL', 'Keeper: dive left'], ['gkDiveR', 'Keeper: dive right'], ['gkLowL', 'Keeper: low dive left'], ['gkLowR', 'Keeper: low dive right'],
  ['gkPick', 'Keeper: pick up'], ['gkThrow', 'Keeper: throw'], ['gkRoll', 'Keeper: roll out'],
  ['kickSide', 'Kick (classic)'], ['kickFront', 'Volley (classic)'], ['tired', 'Tired'], ['angry', 'Appeal'], ['fall', 'Fall'], ['getUp', 'Get up']];
function buildClips() {
  const have = new Set(view ? view.clips : []);
  $('clipList').innerHTML = CLIPS.filter(([k]) => have.has(k)).map(([k, l]) => `<button data-clip="${k}"${k === 'idle' ? ' class="on"' : ''}>${l}</button>`).join('');
}

// ── wiring ──
function wire() {
  for (const [host, list] of [['faceControls', FACE], ['hairControls', HAIR], ['bodyControls', BODY]]) buildControls(host, list);
  $('locks').innerHTML = Object.entries(GROUP_LABEL).map(([g, l]) => `<label class="check"><input type="checkbox" value="${g}"> ${l}</label>`).join('');
  document.querySelector('.left').addEventListener('input', onControl);
  document.querySelector('.left').addEventListener('change', e => { onControl(e); if (e.target.closest('#locks')) profile.locks = [...document.querySelectorAll('#locks input:checked')].map(x => x.value); });
  $('kitFields').addEventListener('input', onKitField);
  for (const id of ['kitNumber', 'kitName', 'kitShowNumber', 'kitShowSponsor', 'kitShowCrest']) $(id).addEventListener('input', redraw), $(id).addEventListener('change', redraw);
  $('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b)); document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; }); if (b.dataset.tab === 'library') refreshLibrary(); if (b.dataset.tab === 'kit') loadKits(); };
  $('kitSlot').onclick = e => { const b = e.target.closest('[data-slot]'); if (!b) return; kitSlot = b.dataset.slot; document.querySelectorAll('#kitSlot button').forEach(x => x.classList.toggle('on', x === b)); renderKitFields(); redraw(); };
  $('generate').onclick = generate; $('regen').onclick = regen; $('saveBtn').onclick = save; $('kitApply').onclick = applyKits;
  $('undo').onclick = () => { if (!history.length) return; future.push(JSON.stringify({ profile, name })); restore(history.pop()); };
  $('redo').onclick = () => { if (!future.length) return; history.push(JSON.stringify({ profile, name })); restore(future.pop()); };
  $('rotateL').onclick = () => view && view.rotate(-Math.PI / 8); $('rotateR').onclick = () => view && view.rotate(Math.PI / 8);
  $('zoomIn').onclick = () => view && view.zoom(0.85); $('zoomOut').onclick = () => view && view.zoom(1.18);
  $('focusFace').onclick = () => view && view.focus('face'); $('focusBody').onclick = () => view && view.focus('body');
  $('background').onchange = () => view && view.setBackground($('background').value);
  $('clipList').onclick = e => { const b = e.target.closest('[data-clip]'); if (!b || !view) return; view.playClip(b.dataset.clip); document.querySelectorAll('#clipList button').forEach(x => x.classList.toggle('on', x === b)); renderStatus(); };
  $('speed').oninput = () => { $('speedOut').textContent = `${Number($('speed').value).toFixed(1)}×`; view && view.setSpeed($('speed').value); };
  $('search').oninput = () => { clearTimeout(refreshLibrary.t); refreshLibrary.t = setTimeout(refreshLibrary, 200); };
  $('libraryList').onclick = e => { const el = e.target.closest('[data-id]'); if (el) openAsset(el.dataset.id); };
  $('importFile').onchange = importFile; $('exportJson').onclick = exportJson; $('exportGlb').onclick = exportGlb; $('duplicate').onclick = duplicate; $('deleteBtn').onclick = remove;
  $('assignBtn').onclick = assign; $('clearBtn').onclick = clearLook;
  for (const id of ['name', 'age', 'position', 'nation']) $(id).addEventListener('change', () => { readIdentity(); renderStatus(); });
}

async function start() {
  wire();
  const first = await api('/api/studio/preview', 'POST', { description: $('description').value });
  profile = first.ok ? first.profile : { schemaVersion: 1, appearance: { heightCm: 183, weightKg: 78, skinTone: 'dark', hairStyle: 'short-curly-fade', kit: { primary: '#c62828', secondary: '#ffffff', pattern: 'plain' } }, locks: [] };
  name = 'Nigerian striker';
  syncControls();
  try {
    const prefs = (() => { try { return JSON.parse(localStorage.getItem('gaffer_prefs') || '{}'); } catch { return {}; } })();   // the game's settings (same origin)
    view = await createStudioView($('viewport'), { quality: matchMedia('(max-width: 700px)').matches ? 'low' : 'high', bodies: prefs.realBodies !== false });
    $('loading').remove();
    buildClips();
  } catch (e) { $('loading').textContent = `3D preview unavailable: ${e.message}`; }
  redraw(); loadSquad(); loadKits();
  $('viewport').addEventListener('gaffer-body', () => renderStatus());   // the close-up body has loaded or changed
  window.__studio = { view: () => view, profile: () => profile, api };     // test hook
}
start();
