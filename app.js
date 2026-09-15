'use strict';

const STORE_KEY = 'flarelog.v1';
const DAY = 86400000;
// Starting list — everyone's symptoms are different, so this is just a default.
// Users can add their own via "+ Add a new symptom", which then competes for a
// Quick log slot on the dashboard based on how often it's actually used.
const BUILTIN_SYMPTOMS = [
  { value: 'Brain fog', label: 'Brain fog' },
  { value: 'Migraine', label: 'Migraine / headache' },
  { value: 'Numbness/tingling', label: 'Numbness / tingling' },
  { value: 'Joint pain', label: 'Joint pain' },
  { value: 'Muscle weakness', label: 'Muscle weakness' },
  { value: 'Fatigue', label: 'Fatigue' },
  { value: 'Dizziness', label: 'Dizziness' },
  { value: 'Nausea', label: 'Nausea' },
  { value: 'Rash', label: 'Rash / skin flare' },
  { value: 'Skin patches', label: 'Skin patches' },
  { value: 'Light sensitivity', label: 'Light sensitivity' },
  { value: 'Appetite changes', label: 'Appetite changes' },
];
const DEFAULT_QUICK_SYMPTOMS = ['Brain fog', 'Migraine', 'Numbness/tingling', 'Fatigue', 'Joint pain', 'Dizziness'];
const TRIGGER_OPTIONS = ['Poor sleep', 'Stress', 'Weather change', 'Missed medication', 'Overexertion', 'Diet/food', 'Illness/infection', 'Hormonal cycle', 'Alcohol', 'Screen time'];

// A 1-10 scale with plain-language bands instead of jargon or emoji — the
// number, the label, and the button color all carry the same information.
// Kept intensity-neutral (not "hurts") since not every symptom is pain —
// brain fog, appetite changes, fatigue included.
const SEVERITY_LABELS = [
  { max: 2, label: 'Barely there' },
  { max: 4, label: 'A little' },
  { max: 6, label: 'Moderate' },
  { max: 8, label: 'A lot' },
  { max: 10, label: 'Worst ever' },
];
const FATIGUE_LABELS = [
  { max: 2, label: 'Fully rested' },
  { max: 4, label: 'Mild fatigue' },
  { max: 6, label: 'Moderate fatigue' },
  { max: 8, label: 'Heavy fatigue' },
  { max: 10, label: "Can't function" },
];
function labelFor(bands, n) { return (bands.find(f => n <= f.max) || bands[bands.length - 1]).label; }
function severityHue(n) { return Math.round(130 - ((n - 1) / 9) * 130); }

const STIFFNESS_OPTIONS = [
  { key: 'none', label: 'None' },
  { key: 'lt30', label: 'Under 30 min' },
  { key: '30-60', label: '30–60 min' },
  { key: '1-2h', label: '1–2 hours' },
  { key: 'gt2h', label: 'Over 2 hours' },
  { key: 'allday', label: 'All day' },
];
const SLEEP_HOURS_OPTIONS = [
  { key: 'lt4', label: 'Under 4h' },
  { key: '4-6', label: '4–6h' },
  { key: '6-8', label: '6–8h' },
  { key: '8+', label: '8h+' },
];
const SLEEP_QUALITY_OPTIONS = [
  { key: 'poor', label: 'Poor' },
  { key: 'fair', label: 'Fair' },
  { key: 'good', label: 'Good' },
  { key: 'great', label: 'Great' },
];
const MOOD_OPTIONS = [
  { key: 'low', label: 'Very low' },
  { key: 'down', label: 'Low' },
  { key: 'okay', label: 'Okay' },
  { key: 'good', label: 'Good' },
  { key: 'great', label: 'Great' },
];
const FUNCTION_QUESTIONS = [
  { key: 'dressing', label: 'Getting dressed (buttons, zippers)' },
  { key: 'gripping', label: 'Gripping or opening things (jars, doorknobs)' },
  { key: 'stairs', label: 'Climbing stairs' },
  { key: 'workday', label: 'Getting through a full day (work/school)' },
];
const FUNCTION_OPTIONS = [
  { value: 0, label: 'No difficulty' },
  { value: 1, label: 'Some difficulty' },
  { value: 2, label: 'A lot of difficulty' },
  { value: 3, label: 'Unable' },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      migrate(data);
      return data;
    }
  } catch (e) { console.warn('Could not read saved data', e); }
  return { symptoms: [], medications: [], doseLog: [], checkins: [], flares: [], customSymptomTypes: [], severityScale: 10 };
}

// Older versions scheduled by hour and required a start date; carry that data
// forward as a once-daily schedule anchored to whatever was last taken.
function migrate(data) {
  (data.medications || []).forEach(med => {
    if (med.intervalUnit) return;
    med.intervalValue = 1;
    med.intervalUnit = 'day';
    med.lastTakenTs = med.lastTakenTs || med.startTs || null;
    delete med.mode;
    delete med.intervalHours;
    delete med.times;
    delete med.startTs;
  });
  (data.symptoms || []).forEach(s => { if (!s.triggers) s.triggers = []; if (s.photoId === undefined) s.photoId = null; });
  if (!data.checkins) data.checkins = [];
  if (!data.flares) data.flares = [];
  if (!data.customSymptomTypes) data.customSymptomTypes = [];
  // Severity moved from a 1-5 scale to 1-10; scale old entries up once, guarded by a flag.
  if (data.severityScale !== 10) {
    (data.symptoms || []).forEach(s => { s.severity = Math.min(10, Math.max(1, Math.round((s.severity || 3) * 2))); });
    data.severityScale = 10;
  }
}

let state = loadState();
let currentUser = null;

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (currentUser) {
    userDocRef(currentUser.uid).set(state).then(() => {
      $('#syncStatus').textContent = 'Synced';
    }).catch(err => {
      console.warn('cloud save failed', err);
      $('#syncStatus').textContent = 'Sync error — saved on this device only';
    });
  }
}

// ---------- photo storage (IndexedDB — binary data doesn't belong in localStorage) ----------

const PHOTO_DB_NAME = 'flarelog-photos';
function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PHOTO_DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('photos')) req.result.createObjectStore('photos'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function savePhotoBlob(id, blob) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadPhotoBlob(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deletePhotoBlob(id) {
  try {
    const db = await openPhotoDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('photo delete failed', e); }
}
function resizeImageFile(file, maxDim = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error('toBlob failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}
const photoUrlCache = {};
async function hydratePhotos(root = document) {
  const imgs = root.querySelectorAll('img[data-photo-id]:not([data-hydrated])');
  for (const img of imgs) {
    img.dataset.hydrated = '1';
    const id = img.dataset.photoId;
    try {
      if (!photoUrlCache[id]) {
        const blob = await loadPhotoBlob(id);
        if (!blob) continue;
        photoUrlCache[id] = URL.createObjectURL(blob);
      }
      img.src = photoUrlCache[id];
      img.hidden = false;
    } catch (e) { console.warn('photo load failed', e); }
  }
}

// ---------- dose scheduling ----------

function addInterval(ts, value, unit) {
  const d = new Date(ts);
  switch (unit) {
    case 'day': d.setDate(d.getDate() + value); break;
    case 'week': d.setDate(d.getDate() + value * 7); break;
    case 'month': d.setMonth(d.getMonth() + value); break;
    case 'year': d.setFullYear(d.getFullYear() + value); break;
  }
  return d.getTime();
}

function scheduleLabel(med) {
  const n = med.intervalValue;
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[med.intervalUnit];
  return `every ${n} ${unit}${n > 1 ? 's' : ''}`;
}

// Returns null when the medication has no logged dose yet — there is nothing to count down from.
function nextDoseTime(med, now = Date.now()) {
  if (!med.active || !med.lastTakenTs) return null;
  return addInterval(med.lastTakenTs, med.intervalValue, med.intervalUnit);
}

function doseStatus(nextTs, now = Date.now()) {
  const diff = nextTs - now;
  if (diff <= 0) return 'overdue';
  if (diff <= 30 * 60000) return 'soon';
  return 'ok';
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDateOnly(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtRelative(ts, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return diff >= 0 ? 'due now' : 'just now';
  if (mins < 60) return diff >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return diff >= 0 ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}
function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function markDoseTaken(medId, ts = Date.now()) {
  const med = state.medications.find(m => m.id === medId);
  if (!med) return;
  med.lastTakenTs = ts;
  if (typeof med.quantityOnHand === 'number') med.quantityOnHand = Math.max(0, med.quantityOnHand - 1);
  state.doseLog.push({ id: uid(), medId, ts });
  save();
  renderAll();
  let msg = `${med.name} logged as taken`;
  if (typeof med.quantityOnHand === 'number' && med.quantityOnHand <= (med.refillThreshold ?? 5)) {
    msg = med.quantityOnHand === 0 ? `${med.name} logged — out of doses, time to refill` : `${med.name} logged — only ${med.quantityOnHand} left`;
  }
  showToast(msg);
}

function addRefill(medId) {
  const med = state.medications.find(m => m.id === medId);
  if (!med) return;
  const input = prompt(`How many doses did you add for ${med.name}?`, '30');
  if (input === null) return;
  const amount = Math.round(Number(input));
  if (!Number.isFinite(amount) || amount <= 0) return;
  med.quantityOnHand = (med.quantityOnHand || 0) + amount;
  save();
  renderAll();
  showToast(`${med.name} refilled — ${med.quantityOnHand} doses left`);
}

// ---------- rendering ----------

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => { t.hidden = true; }, 2200);
}

function renderDashboard() {
  const now = Date.now();
  const wrap = $('#doseCards');
  wrap.innerHTML = '';
  const active = state.medications.filter(m => m.active);
  if (!active.length) {
    wrap.innerHTML = '<div class="empty-note">No medications yet. Add one in the Meds tab to get dose reminders.</div>';
  } else {
    active
      .map(med => ({ med, next: nextDoseTime(med, now) }))
      .sort((a, b) => (a.next ?? -Infinity) - (b.next ?? -Infinity))
      .forEach(({ med, next }) => {
        const status = next === null ? 'not-started' : doseStatus(next, now);
        const card = document.createElement('div');
        card.className = `dose-card ${status}`;
        card.innerHTML = next === null ? `
          <div class="info">
            <div class="name">${escapeHtml(med.name)}${med.dosage ? ` · ${escapeHtml(med.dosage)}` : ''}</div>
            <div class="meta">${scheduleLabel(med)}</div>
            <div class="status">Not started yet</div>
          </div>
          <button class="take-btn" data-take="${med.id}">Log first dose</button>
        ` : `
          <div class="info">
            <div class="name">${escapeHtml(med.name)}${med.dosage ? ` · ${escapeHtml(med.dosage)}` : ''}</div>
            <div class="meta">Next dose: ${fmtTime(next)}</div>
            <div class="status">${status === 'overdue' ? 'OVERDUE · ' : status === 'soon' ? 'due soon · ' : ''}${fmtRelative(next, now)}</div>
          </div>
          <button class="take-btn" data-take="${med.id}">Take</button>
        `;
        wrap.appendChild(card);
      });
  }

  const chipWrap = $('#quickSymptoms');
  chipWrap.innerHTML = computeQuickSymptoms().map(s => `<button class="chip" data-quick="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');

  const recent = [...state.symptoms].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const list = $('#recentList');
  if (!recent.length) {
    list.innerHTML = '<li class="empty-note">Nothing logged yet.</li>';
  } else {
    list.innerHTML = recent.map(entryHtml).join('');
  }
}

function entryHtml(s) {
  const label = s.type === 'Other' ? (s.custom || 'Other') : s.type;
  const triggers = s.triggers && s.triggers.length
    ? `<div class="tag-row">${s.triggers.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  const photo = s.photoId ? `<img class="photo-thumb-lg" data-photo-id="${escapeHtml(s.photoId)}" alt="attached photo" hidden />` : '';
  const hue = severityHue(s.severity);
  return `
    <li class="entry-item">
      <div class="main">
        <div class="title">${escapeHtml(label)}</div>
        <div class="sub">${fmtTime(s.ts)}</div>
        ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ''}
        ${triggers}
        ${photo}
      </div>
      <div class="entry-actions">
        <div class="sev" style="background:hsl(${hue} 45% 92%); color:hsl(${hue} 55% 28%)">${s.severity}/10</div>
        <button class="edit-btn" data-edit-symptom="${s.id}" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg></button>
        <button class="del-btn" data-del-symptom="${s.id}" aria-label="Delete">✕</button>
      </div>
    </li>`;
}

let symptomFilter = 'All';

function renderSymptomsView() {
  const types = ['All', ...new Set(state.symptoms.map(s => (s.type === 'Other' ? (s.custom || 'Other') : s.type)))];
  $('#symptomFilterRow').innerHTML = types.map(t =>
    `<button class="chip ${t === symptomFilter ? 'active' : ''}" data-filter="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join('');

  let list = [...state.symptoms].sort((a, b) => b.ts - a.ts);
  if (symptomFilter !== 'All') {
    list = list.filter(s => (s.type === 'Other' ? (s.custom || 'Other') : s.type) === symptomFilter);
  }
  const el = $('#symptomHistory');
  el.innerHTML = list.length ? list.map(entryHtml).join('') : '<li class="empty-note">No entries yet.</li>';

  renderPatterns();
}

// Compares the last 14 days against the 14 days before that, per symptom type,
// to surface when something is becoming more frequent or more severe.
function computeSymptomTrends(now = Date.now()) {
  const recentStart = now - 14 * DAY;
  const priorStart = now - 28 * DAY;

  const byType = {};
  state.symptoms.forEach(s => {
    const label = s.type === 'Other' ? (s.custom || 'Other') : s.type;
    (byType[label] = byType[label] || []).push(s);
  });

  const rows = Object.entries(byType).map(([label, entries]) => {
    const recent = entries.filter(s => s.ts >= recentStart);
    const prior = entries.filter(s => s.ts >= priorStart && s.ts < recentStart);
    const avg = list => list.length ? list.reduce((sum, s) => sum + s.severity, 0) / list.length : null;
    const recentAvg = avg(recent);
    const priorAvg = avg(prior);

    const freqRising = recent.length >= 3 && (prior.length === 0 ? true : recent.length >= prior.length * 1.5);
    const severityRising = recent.length >= 2 && recentAvg !== null && priorAvg !== null && (recentAvg - priorAvg) >= 2;
    const rising = freqRising || severityRising;
    const falling = !rising && prior.length >= 3 && recent.length <= prior.length * 0.5;

    return { label, recentCount: recent.length, priorCount: prior.length, recentAvg, priorAvg, rising, falling, freqRising, severityRising };
  }).filter(r => r.recentCount > 0 || r.priorCount > 0)
    .sort((a, b) => b.recentCount - a.recentCount);

  return rows;
}

function renderPatterns() {
  const card = $('#patternsCard');
  const rows = computeSymptomTrends();
  if (!rows.length) {
    card.innerHTML = '<p class="muted">Log a few symptoms and patterns will show up here — frequency, severity, and whether things are trending up.</p>';
    return;
  }

  const warnings = rows.filter(r => r.rising);
  let html = '';
  if (warnings.length) {
    html += warnings.map(r => {
      const reason = r.freqRising
        ? `${r.recentCount}× in the last 14 days, vs ${r.priorCount}× the 14 days before`
        : `average severity rose from ${r.priorAvg.toFixed(1)} to ${r.recentAvg.toFixed(1)} over the last 14 days`;
      return `<div class="alert warn"><strong>${escapeHtml(r.label)} may be increasing</strong>${reason}.</div>`;
    }).join('');
    html += `<p class="muted" style="margin:-2px 0 14px">This is a pattern in what you've logged, not a diagnosis — worth mentioning to your care team if it continues.</p>`;
  }

  html += rows.map(r => {
    const arrow = r.rising ? '↑' : r.falling ? '↓' : '→';
    const cls = r.rising ? 'up' : r.falling ? 'down' : 'flat';
    const sevText = r.recentAvg !== null ? `avg severity ${r.recentAvg.toFixed(1)}/10` : 'no entries in last 14 days';
    return `
      <div class="trend-row">
        <div>
          <div class="trend-name">${escapeHtml(r.label)}</div>
          <div class="trend-detail">${r.recentCount}× last 14 days · ${sevText}</div>
        </div>
        <div class="trend-arrow ${cls}">${arrow}</div>
      </div>`;
  }).join('');

  card.innerHTML = html;
}

function renderMeds() {
  const list = $('#medList');
  if (!state.medications.length) {
    list.innerHTML = '<li class="empty-note">No medications added yet.</li>';
    return;
  }
  list.innerHTML = state.medications.map(med => {
    const next = nextDoseTime(med, Date.now());
    const lastLine = med.lastTakenTs ? `Last taken: ${fmtTime(med.lastTakenTs)}` : 'No dose logged yet';
    const nextLine = next === null ? 'Log a dose to start reminders' : `Next: ${fmtTime(next)} (${fmtRelative(next)})`;
    let refillLine = '';
    if (typeof med.quantityOnHand === 'number') {
      const low = med.quantityOnHand <= (med.refillThreshold ?? 5);
      const text = med.quantityOnHand === 0 ? 'Out of doses — refill needed' : `${med.quantityOnHand} dose${med.quantityOnHand === 1 ? '' : 's'} left${low ? ' — refill soon' : ''}`;
      refillLine = `<div class="refill-note ${low ? 'low' : 'ok'}">${escapeHtml(text)}</div>`;
    }
    return `
      <li class="entry-item med-item">
        <div class="row">
          <div class="main">
            <div class="title">${escapeHtml(med.name)}${med.dosage ? ` · ${escapeHtml(med.dosage)}` : ''}</div>
            <div class="sub">${scheduleLabel(med)}${med.notes ? ' · ' + escapeHtml(med.notes) : ''}</div>
            <div class="sub">${lastLine}</div>
            <div class="sub">${nextLine}</div>
            ${refillLine}
          </div>
          <button class="del-btn" data-del-med="${med.id}" aria-label="Remove">✕</button>
        </div>
        <div class="row actions">
          <button class="take-btn" data-take="${med.id}">Mark taken now</button>
          <button class="secondary-btn" data-toggle-med="${med.id}">${med.active ? 'Pause' : 'Resume'}</button>
          ${typeof med.quantityOnHand === 'number' ? `<button class="secondary-btn" data-refill-med="${med.id}">Refilled</button>` : ''}
        </div>
      </li>`;
  }).join('');
}

function typeLabel(s) { return s.type === 'Other' ? (s.custom || 'Other') : s.type; }

// Surfaces whatever the person actually logs most, not a fixed list — everyone's
// symptom mix is different. Falls back to sensible defaults while history is thin.
function computeQuickSymptoms(limit = 6) {
  const counts = {};
  state.symptoms.forEach(s => { const l = typeLabel(s); counts[l] = (counts[l] || 0) + 1; });
  const byFrequency = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label]) => label);
  const combined = [...byFrequency, ...DEFAULT_QUICK_SYMPTOMS.filter(d => !byFrequency.includes(d))];
  return combined.slice(0, limit);
}

function allSymptomTypeValues() {
  return [...BUILTIN_SYMPTOMS.map(b => b.value), ...state.customSymptomTypes];
}

function renderSymptomTypeOptions() {
  const sel = $('#symType');
  const prev = sel.value;
  const custom = [...state.customSymptomTypes].sort((a, b) => a.localeCompare(b));
  sel.innerHTML =
    BUILTIN_SYMPTOMS.map(b => `<option value="${escapeHtml(b.value)}">${escapeHtml(b.label)}</option>`).join('') +
    custom.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
    `<option value="Other">Other (just this once)…</option>` +
    `<option value="__new__">+ Add a new symptom</option>`;
  if (prev && allSymptomTypeValues().includes(prev)) sel.value = prev;
}

function addCustomSymptomType(name) {
  const exists = allSymptomTypeValues().some(v => v.toLowerCase() === name.toLowerCase());
  if (!exists) {
    state.customSymptomTypes.push(name);
    save();
  }
  renderSymptomTypeOptions();
  $('#symType').value = name;
}

function flareFreeStreak(now) {
  const daySet = new Set(state.symptoms.map(s => new Date(s.ts).toDateString()));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now - i * DAY);
    if (daySet.has(d.toDateString())) break;
    streak++;
  }
  return streak;
}

function computeAdherence(now) {
  const cutoff = now - 30 * DAY;
  const daysPer = { day: 1, week: 7, month: 30, year: 365 };
  let expected = 0, actual = 0;
  state.medications.forEach(med => {
    if (!med.lastTakenTs) return;
    actual += state.doseLog.filter(d => d.medId === med.id && d.ts >= cutoff).length;
    const intervalDays = daysPer[med.intervalUnit] * med.intervalValue;
    expected += Math.max(1, Math.round(30 / intervalDays));
  });
  return expected === 0 ? null : Math.round((actual / expected) * 100);
}

function renderKpiRow(recent, now) {
  const counts = {};
  recent.forEach(s => { const l = typeLabel(s); counts[l] = (counts[l] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const streak = flareFreeStreak(now);
  const adherence = computeAdherence(now);

  const tiles = [
    { value: recent.length, label: 'symptoms logged · 30d' },
    { value: top ? top[0] : '—', label: top ? `most common (${top[1]}×)` : 'most common symptom' },
    { value: `${streak}d`, label: 'flare-free streak' },
    { value: adherence === null ? '—' : `${adherence}%`, label: 'dose adherence · 30d' },
  ];
  $('#kpiRow').innerHTML = tiles.map(t => `
    <div class="kpi-tile">
      <div class="kpi-value">${escapeHtml(String(t.value))}</div>
      <div class="kpi-label">${escapeHtml(t.label)}</div>
    </div>`).join('');
}

function renderBarChart(container, rows, hueVar, emptyMsg) {
  if (!rows.length) { container.innerHTML = `<div class="chart-empty">${escapeHtml(emptyMsg)}</div>`; return; }
  const max = rows[0][1];
  container.innerHTML = rows.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, (count / max) * 100)}%; background:var(${hueVar})"></div></div>
      <div class="bar-count">${count}</div>
    </div>`).join('');
}

function renderFrequencyChart(recent) {
  const counts = {};
  recent.forEach(s => { const l = typeLabel(s); counts[l] = (counts[l] || 0) + 1; });
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  renderBarChart($('#chartFrequency'), rows, '--accent', 'Log a symptom and it will show up here.');
}

function renderTriggerChart(recent) {
  const counts = {};
  recent.forEach(s => (s.triggers || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  renderBarChart($('#chartTriggers'), rows, '--olive', 'Tag a trigger when you log a symptom to see patterns here.');
}

function weekBuckets(now, weeks) {
  const WEEK = 7 * DAY;
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * WEEK;
    buckets.push({ start: end - WEEK, end });
  }
  return buckets;
}

function renderSeverityTrendChart(now) {
  const buckets = weekBuckets(now, 8);
  const points = buckets.map(b => {
    const entries = state.symptoms.filter(s => s.ts >= b.start && s.ts < b.end);
    if (!entries.length) return null;
    return entries.reduce((sum, s) => sum + s.severity, 0) / entries.length;
  });

  const container = $('#chartSeverity');
  if (points.every(p => p === null)) {
    container.innerHTML = '<div class="chart-empty">Log symptoms over a couple of weeks to see a trend line here.</div>';
    return;
  }

  const W = 320, H = 150, padL = 20, padR = 8, padT = 10, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = points.length;
  const xAt = i => padL + (i / (n - 1)) * plotW;
  const yAt = v => padT + plotH - ((v - 1) / 9) * plotH;

  const runs = [];
  let current = [];
  points.forEach((p, i) => {
    if (p === null) { if (current.length) runs.push(current); current = []; }
    else current.push({ i, v: p });
  });
  if (current.length) runs.push(current);

  const gridSvg = [1, 5.5, 10].map(v => `
    <line class="lc-gridline" x1="${padL}" y1="${yAt(v).toFixed(1)}" x2="${W - padR}" y2="${yAt(v).toFixed(1)}" />
    <text class="lc-axis-text" x="1" y="${(yAt(v) + 3).toFixed(1)}">${Math.round(v)}</text>
  `).join('');

  const pathFor = run => run.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xAt(p.i).toFixed(1)} ${yAt(p.v).toFixed(1)}`).join(' ');

  const areaSvg = runs.filter(r => r.length > 1).map(run => {
    const base = `L ${xAt(run[run.length - 1].i).toFixed(1)} ${yAt(1).toFixed(1)} L ${xAt(run[0].i).toFixed(1)} ${yAt(1).toFixed(1)} Z`;
    return `<path class="lc-area" d="${pathFor(run)} ${base}" />`;
  }).join('');

  const lineSvg = runs.map(run => `<path class="lc-line" d="${pathFor(run)}" />`).join('');

  const dotSvg = points.map((p, i) => {
    if (p === null) return '';
    const wk = new Date(buckets[i].end - DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<circle class="lc-dot" cx="${xAt(i).toFixed(1)}" cy="${yAt(p).toFixed(1)}" r="4"><title>Week of ${wk}: avg ${p.toFixed(1)}/10</title></circle>`;
  }).join('');

  const labelSvg = buckets.map((b, i) => i % 2 === 0
    ? `<text class="lc-axis-text" x="${xAt(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${new Date(b.end - DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>`
    : '').join('');

  container.innerHTML = `<svg class="line-chart-svg" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="severityGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
    </linearGradient></defs>
    ${gridSvg}${areaSvg}${lineSvg}${dotSvg}${labelSvg}
  </svg>`;
}

function renderHeatmap(now) {
  const days = 35;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * DAY);
  start.setDate(start.getDate() - start.getDay());

  const dayData = {};
  state.symptoms.forEach(s => {
    const d = new Date(s.ts); d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    const bucket = dayData[key] || (dayData[key] = { count: 0, maxSev: 0 });
    bucket.count++;
    bucket.maxSev = Math.max(bucket.maxSev, s.severity);
  });

  const spanDays = Math.round((today.getTime() - start.getTime()) / DAY) + 1;
  const totalCells = Math.ceil(spanDays / 7) * 7;
  const maxCount = Math.max(1, ...Object.values(dayData).map(d => d.count));

  let cellsHtml = '';
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const info = dayData[d.getTime()];
    if (d.getTime() > today.getTime()) {
      cellsHtml += `<div class="heat-cell" style="visibility:hidden"></div>`;
      continue;
    }
    const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (!info) {
      cellsHtml += `<div class="heat-cell" title="${dateLabel}: no symptoms logged"></div>`;
    } else {
      const intensity = (0.22 + 0.78 * (info.count / maxCount)).toFixed(2);
      const plural = info.count === 1 ? 'entry' : 'entries';
      cellsHtml += `<div class="heat-cell" style="background: hsl(18 65% 45% / ${intensity})" title="${dateLabel}: ${info.count} ${plural}, worst ${info.maxSev}/10"></div>`;
    }
  }

  $('#chartHeatmap').innerHTML = `
    <div class="heatmap-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
    <div class="heatmap-grid">${cellsHtml}</div>
    <div class="heatmap-legend">Less
      <div class="heat-cell" style="background:hsl(18 65% 45% / 0.22)"></div>
      <div class="heat-cell" style="background:hsl(18 65% 45% / 0.5)"></div>
      <div class="heat-cell" style="background:hsl(18 65% 45% / 0.78)"></div>
      <div class="heat-cell" style="background:hsl(18 65% 45% / 1)"></div>
    More</div>`;
}

function renderInsights() {
  const now = Date.now();
  const recent = state.symptoms.filter(s => s.ts >= now - 30 * DAY);
  renderKpiRow(recent, now);
  renderFrequencyChart(recent);
  renderSeverityTrendChart(now);
  renderTriggerChart(recent);
  renderHeatmap(now);
}

// ---------- daily check-in ----------

function checkinSummary(c) {
  const parts = [];
  if (c.fatigue != null) parts.push(`fatigue ${c.fatigue}/10`);
  if (c.stiffness) parts.push(`stiffness ${STIFFNESS_OPTIONS.find(o => o.key === c.stiffness)?.label.toLowerCase()}`);
  if (c.sleepHours) parts.push(`slept ${SLEEP_HOURS_OPTIONS.find(o => o.key === c.sleepHours)?.label}`);
  if (c.sleepQuality) parts.push(`sleep quality ${SLEEP_QUALITY_OPTIONS.find(o => o.key === c.sleepQuality)?.label.toLowerCase()}`);
  if (c.mood) parts.push(`mood ${MOOD_OPTIONS.find(o => o.key === c.mood)?.label.toLowerCase()}`);
  const funcVals = Object.values(c.func || {}).filter(v => v !== null && v !== undefined);
  if (funcVals.length) parts.push(`function ${funcVals.reduce((a, b) => a + b, 0)}/${funcVals.length * 3}`);
  return parts.join(' · ') || 'No details recorded';
}

function renderCheckinHistory() {
  const list = [...state.checkins].sort((a, b) => b.ts - a.ts).slice(0, 14);
  const el = $('#checkinHistory');
  el.innerHTML = list.length ? list.map(c => `
    <li class="entry-item">
      <div class="main">
        <div class="title">${fmtDateOnly(c.ts)}</div>
        <div class="sub">${escapeHtml(checkinSummary(c))}</div>
      </div>
      <button class="del-btn" data-del-checkin="${c.id}" aria-label="Delete">✕</button>
    </li>`).join('') : '<li class="empty-note">No check-ins yet.</li>';
}

// ---------- flares ----------

function renderFlareStatus() {
  const ongoing = state.flares.find(f => !f.endTs);
  const el = $('#flareStatus');
  if (!ongoing) {
    el.innerHTML = `
      <button type="button" id="startFlareBtn" class="primary-btn" style="width:100%">Log a flare</button>
      <p class="muted" style="margin-top:8px">Track a flare from when it begins to when you recover. Add details any time.</p>`;
    return;
  }
  const days = Math.max(1, Math.ceil((Date.now() - ongoing.startTs) / DAY));
  el.innerHTML = `
    <div class="flare-banner">
      <div class="flare-title">Flare in progress</div>
      <div class="flare-meta">Started ${fmtDateOnly(ongoing.startTs)} · Day ${days}</div>
      <div class="field-block" style="margin-top:12px">
        <span class="field-label">Peak severity so far</span>
        <div id="flareSevGroup" class="sev-grid" role="radiogroup" aria-label="Peak severity, 1 to 10"></div>
      </div>
      <div class="form" style="margin-top:12px">
        <label>
          Notes
          <textarea id="flareNotes" rows="2" placeholder="what this flare feels like, what helped">${escapeHtml(ongoing.notes || '')}</textarea>
        </label>
      </div>
      <div class="btn-row">
        <button type="button" id="saveFlareDetailsBtn" class="secondary-btn">Save details</button>
        <button type="button" id="endFlareBtn" class="primary-btn">Mark as recovered</button>
      </div>
    </div>`;
  $('#flareSevGroup').innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
    const hue = severityHue(n);
    const active = ongoing.peakSeverity === n ? 'active' : '';
    return `<button type="button" class="sev-btn ${active}" data-flare-sev="${n}" style="--hue:${hue}"><strong>${n}</strong></button>`;
  }).join('');
}

function renderFlareHistory() {
  const past = state.flares.filter(f => f.endTs).sort((a, b) => b.startTs - a.startTs);
  const el = $('#flareHistory');
  el.innerHTML = past.length ? past.map(f => {
    const days = Math.max(1, Math.round((f.endTs - f.startTs) / DAY));
    return `
      <li class="entry-item">
        <div class="main">
          <div class="title">${fmtDateOnly(f.startTs)} → ${fmtDateOnly(f.endTs)}</div>
          <div class="sub">${days} day${days === 1 ? '' : 's'}${f.peakSeverity ? ' · peak severity ' + f.peakSeverity + '/10' : ''}</div>
          ${f.notes ? `<div class="notes">${escapeHtml(f.notes)}</div>` : ''}
        </div>
        <button class="del-btn" data-del-flare="${f.id}" aria-label="Delete">✕</button>
      </li>`;
  }).join('') : '<li class="empty-note">No past flares recorded yet.</li>';
}

function renderFlareView() {
  renderFlareStatus();
  renderFlareHistory();
}

function renderAll() {
  renderDashboard();
  renderSymptomsView();
  renderMeds();
  renderInsights();
  renderCheckinHistory();
  renderFlareView();
  hydratePhotos();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- navigation ----------

function switchView(name, parentTab) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  const activeTabName = parentTab || name;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === activeTabName));
  $('#views').scrollTop = 0;
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
$('#goCheckin').addEventListener('click', () => switchView('checkin', 'symptoms'));
$('#goFlares').addEventListener('click', () => switchView('flares', 'symptoms'));
$$('[data-back]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.back)));

// ---------- settings drawer ----------

function openDrawer() {
  $('#settingsDrawer').classList.add('open');
  $('#settingsDrawer').setAttribute('aria-hidden', 'false');
  $('#drawerBackdrop').hidden = false;
  $('#menuBtn').setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  $('#settingsDrawer').classList.remove('open');
  $('#settingsDrawer').setAttribute('aria-hidden', 'true');
  $('#drawerBackdrop').hidden = true;
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}
$('#menuBtn').addEventListener('click', openDrawer);
$('#closeDrawerBtn').addEventListener('click', closeDrawer);
$('#drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#settingsDrawer').classList.contains('open')) closeDrawer();
});

// ---------- reusable 1-10 scale widget (severity, fatigue) ----------

function wireScale(groupSel, valueSel, labelSel, bands, initial) {
  let value = initial;
  function update(n) {
    value = n;
    $(valueSel).textContent = n;
    $(labelSel).textContent = labelFor(bands, n);
    $$(`${groupSel} .sev-btn`).forEach(b => b.classList.toggle('active', Number(b.dataset.sev) === n));
  }
  $(groupSel).addEventListener('click', e => {
    const btn = e.target.closest('.sev-btn');
    if (!btn) return;
    update(Number(btn.dataset.sev));
  });
  update(initial);
  return { get: () => value, set: update };
}

const severityScale = wireScale('#severityGroup', '#severityValue', '#severityLabel', SEVERITY_LABELS, 5);
const fatigueScale = wireScale('#fatigueGroup', '#fatigueValue', '#fatigueLabel', FATIGUE_LABELS, 5);

// ---------- symptom form ----------

function localDatetimeValue(ts = Date.now()) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

$('#symWhen').value = localDatetimeValue();
renderSymptomTypeOptions();
$('#symType').addEventListener('change', () => {
  const val = $('#symType').value;
  $('#customLabelWrap').hidden = val !== 'Other';
  $('#newSymptomWrap').hidden = val !== '__new__';
  if (val === '__new__') $('#newSymptomName').focus();
});
$('#addSymptomTypeBtn').addEventListener('click', () => {
  const name = $('#newSymptomName').value.trim();
  if (!name) return;
  addCustomSymptomType(name);
  $('#newSymptomWrap').hidden = true;
  $('#newSymptomName').value = '';
  showToast(`${name} added to your symptom list`);
});
$('#newSymptomName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('#addSymptomTypeBtn').click(); }
});

const selectedTriggers = new Set();
function renderTriggerChips() {
  $('#triggerGroup').innerHTML = TRIGGER_OPTIONS.map(t =>
    `<button type="button" class="chip ${selectedTriggers.has(t) ? 'active' : ''}" data-trigger="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join('') + Array.from(selectedTriggers).filter(t => !TRIGGER_OPTIONS.includes(t)).map(t =>
    `<button type="button" class="chip active" data-trigger="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join('');
}
renderTriggerChips();
$('#triggerGroup').addEventListener('click', e => {
  const btn = e.target.closest('[data-trigger]');
  if (!btn) return;
  const t = btn.dataset.trigger;
  selectedTriggers.has(t) ? selectedTriggers.delete(t) : selectedTriggers.add(t);
  renderTriggerChips();
});
$('#symTriggerOther').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const val = e.target.value.trim();
  if (val) { selectedTriggers.add(val); renderTriggerChips(); }
  e.target.value = '';
});

let pendingPhotoBlob = null;
let photoRemoved = false;
let editingEntryId = null;
let editingOriginalPhotoId = null;
$('#addPhotoBtn').addEventListener('click', () => $('#symPhoto').click());
$('#symPhoto').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingPhotoBlob = await resizeImageFile(file);
    photoRemoved = false;
    $('#photoPreview').src = URL.createObjectURL(pendingPhotoBlob);
    $('#photoPreview').hidden = false;
    $('#removePhotoBtn').hidden = false;
    $('#addPhotoBtn').textContent = 'Change photo';
  } catch (err) {
    alert('Could not read that photo.');
  }
});
$('#removePhotoBtn').addEventListener('click', () => {
  pendingPhotoBlob = null;
  photoRemoved = true;
  $('#symPhoto').value = '';
  $('#photoPreview').hidden = true;
  $('#photoPreview').removeAttribute('src');
  $('#removePhotoBtn').hidden = true;
  $('#addPhotoBtn').textContent = 'Add a photo';
});

function resetSymptomForm() {
  $('#symWhen').value = localDatetimeValue();
  severityScale.set(5);
  selectedTriggers.clear();
  renderTriggerChips();
  $('#customLabelWrap').hidden = true;
  $('#newSymptomWrap').hidden = true;
  $('#newSymptomName').value = '';
  $('#symNotes').value = '';
  pendingPhotoBlob = null;
  photoRemoved = false;
  $('#symPhoto').value = '';
  $('#photoPreview').hidden = true;
  $('#photoPreview').removeAttribute('src');
  $('#removePhotoBtn').hidden = true;
  $('#addPhotoBtn').textContent = 'Add a photo';
  editingEntryId = null;
  editingOriginalPhotoId = null;
  $('#symptomSubmitBtn').textContent = 'Save symptom';
  $('#cancelEditBtn').hidden = true;
}

async function startEditSymptom(id) {
  const entry = state.symptoms.find(s => s.id === id);
  if (!entry) return;
  editingEntryId = id;
  editingOriginalPhotoId = entry.photoId;
  photoRemoved = false;
  pendingPhotoBlob = null;

  $('#symType').value = allSymptomTypeValues().includes(entry.type) ? entry.type : 'Other';
  $('#symType').dispatchEvent(new Event('change'));
  if ($('#symType').value === 'Other') $('#symCustom').value = entry.type === 'Other' ? (entry.custom || '') : entry.type;

  severityScale.set(entry.severity);
  selectedTriggers.clear();
  (entry.triggers || []).forEach(t => selectedTriggers.add(t));
  renderTriggerChips();
  $('#symWhen').value = localDatetimeValue(entry.ts);
  $('#symNotes').value = entry.notes || '';

  $('#photoPreview').hidden = true;
  $('#photoPreview').removeAttribute('src');
  $('#removePhotoBtn').hidden = true;
  $('#addPhotoBtn').textContent = 'Add a photo';
  if (entry.photoId) {
    const blob = await loadPhotoBlob(entry.photoId);
    if (blob) {
      $('#photoPreview').src = URL.createObjectURL(blob);
      $('#photoPreview').hidden = false;
      $('#removePhotoBtn').hidden = false;
      $('#addPhotoBtn').textContent = 'Change photo';
    }
  }

  $('#symptomSubmitBtn').textContent = 'Save changes';
  $('#cancelEditBtn').hidden = false;
  switchView('symptoms');
  $('#symptomForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#cancelEditBtn').addEventListener('click', () => {
  $('#symptomForm').reset();
  resetSymptomForm();
});

$('#symptomForm').addEventListener('submit', async e => {
  e.preventDefault();
  let type = $('#symType').value;
  if (type === '__new__') {
    const name = $('#newSymptomName').value.trim();
    if (!name) { $('#newSymptomName').focus(); return; }
    addCustomSymptomType(name);
    type = name;
  }
  const fields = {
    type,
    custom: type === 'Other' ? $('#symCustom').value.trim() : '',
    severity: severityScale.get(),
    triggers: Array.from(selectedTriggers),
    notes: $('#symNotes').value.trim(),
    ts: new Date($('#symWhen').value).getTime(),
  };

  if (editingEntryId) {
    const entry = state.symptoms.find(s => s.id === editingEntryId);
    if (entry) {
      Object.assign(entry, fields);
      if (pendingPhotoBlob) {
        if (editingOriginalPhotoId) deletePhotoBlob(editingOriginalPhotoId);
        entry.photoId = uid();
        try { await savePhotoBlob(entry.photoId, pendingPhotoBlob); } catch (err) { console.warn('photo save failed', err); entry.photoId = null; }
      } else if (photoRemoved) {
        if (editingOriginalPhotoId) deletePhotoBlob(editingOriginalPhotoId);
        entry.photoId = null;
      }
      save();
    }
    e.target.reset();
    resetSymptomForm();
    renderAll();
    showToast('Symptom updated');
    return;
  }

  const entry = { id: uid(), ...fields, photoId: null };
  if (pendingPhotoBlob) {
    entry.photoId = uid();
    try { await savePhotoBlob(entry.photoId, pendingPhotoBlob); } catch (err) { console.warn('photo save failed', err); entry.photoId = null; }
  }
  state.symptoms.push(entry);
  save();
  e.target.reset();
  resetSymptomForm();
  renderAll();
  showToast('Symptom logged');
});

$('#quickSymptoms').addEventListener('click', e => {
  const btn = e.target.closest('[data-quick]');
  if (!btn) return;
  state.symptoms.push({ id: uid(), type: btn.dataset.quick, custom: '', severity: 5, triggers: [], notes: '', ts: Date.now(), photoId: null });
  save();
  renderAll();
  showToast(`${btn.dataset.quick} logged`);
});

$('#symptomFilterRow').addEventListener('click', e => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  symptomFilter = btn.dataset.filter;
  renderSymptomsView();
});

// ---------- daily check-in form ----------

const checkinState = { stiffness: null, sleepHours: null, sleepQuality: null, mood: null, func: { dressing: null, gripping: null, stairs: null, workday: null } };

function renderCheckinChips() {
  const groups = [
    ['#stiffnessGroup', STIFFNESS_OPTIONS, checkinState.stiffness],
    ['#sleepHoursGroup', SLEEP_HOURS_OPTIONS, checkinState.sleepHours],
    ['#sleepQualityGroup', SLEEP_QUALITY_OPTIONS, checkinState.sleepQuality],
    ['#moodGroup', MOOD_OPTIONS, checkinState.mood],
  ];
  groups.forEach(([sel, options, selected]) => {
    $(sel).innerHTML = options.map(o =>
      `<button type="button" class="chip ${o.key === selected ? 'active' : ''}" data-key="${o.key}">${escapeHtml(o.label)}</button>`
    ).join('');
  });
}
renderCheckinChips();

function renderFunctionOptions() {
  $$('.option-row').forEach(row => {
    const key = row.dataset.function;
    row.querySelector('.option-btns').innerHTML = FUNCTION_OPTIONS.map(o =>
      `<button type="button" class="option-btn ${checkinState.func[key] === o.value ? 'active' : ''}" data-func="${key}" data-value="${o.value}">${escapeHtml(o.label)}</button>`
    ).join('');
  });
}
renderFunctionOptions();

$('#checkinForm').addEventListener('click', e => {
  const optBtn = e.target.closest('.option-btn');
  if (optBtn) {
    const key = optBtn.dataset.func;
    const val = Number(optBtn.dataset.value);
    checkinState.func[key] = checkinState.func[key] === val ? null : val;
    renderFunctionOptions();
    return;
  }
  const chipBtn = e.target.closest('#stiffnessGroup [data-key], #sleepHoursGroup [data-key], #sleepQualityGroup [data-key], #moodGroup [data-key]');
  if (chipBtn) {
    const groupEl = chipBtn.parentElement;
    const key = chipBtn.dataset.key;
    const field = { stiffnessGroup: 'stiffness', sleepHoursGroup: 'sleepHours', sleepQualityGroup: 'sleepQuality', moodGroup: 'mood' }[groupEl.id];
    checkinState[field] = checkinState[field] === key ? null : key;
    renderCheckinChips();
  }
});

function resetCheckinForm() {
  fatigueScale.set(5);
  checkinState.stiffness = null;
  checkinState.sleepHours = null;
  checkinState.sleepQuality = null;
  checkinState.mood = null;
  checkinState.func = { dressing: null, gripping: null, stairs: null, workday: null };
  renderCheckinChips();
  renderFunctionOptions();
}

$('#checkinForm').addEventListener('submit', e => {
  e.preventDefault();
  const now = Date.now();
  const key = dateKey(now);
  const entry = {
    id: uid(),
    dateKey: key,
    ts: now,
    fatigue: fatigueScale.get(),
    stiffness: checkinState.stiffness,
    sleepHours: checkinState.sleepHours,
    sleepQuality: checkinState.sleepQuality,
    mood: checkinState.mood,
    func: { ...checkinState.func },
  };
  const idx = state.checkins.findIndex(c => c.dateKey === key);
  if (idx >= 0) state.checkins[idx] = entry; else state.checkins.push(entry);
  save();
  renderAll();
  showToast('Check-in saved');
});

// ---------- flares: start / update / recover ----------

document.addEventListener('click', e => {
  if (e.target.closest('#startFlareBtn')) {
    state.flares.push({ id: uid(), startTs: Date.now(), endTs: null, peakSeverity: null, notes: '' });
    save();
    renderFlareStatus();
    showToast('Flare logged');
    return;
  }
  const flareSevBtn = e.target.closest('[data-flare-sev]');
  if (flareSevBtn) {
    const ongoing = state.flares.find(f => !f.endTs);
    if (ongoing) { ongoing.peakSeverity = Number(flareSevBtn.dataset.flareSev); save(); renderFlareStatus(); }
    return;
  }
  if (e.target.closest('#saveFlareDetailsBtn')) {
    const ongoing = state.flares.find(f => !f.endTs);
    if (ongoing) { ongoing.notes = $('#flareNotes').value.trim(); save(); showToast('Saved'); }
    return;
  }
  if (e.target.closest('#endFlareBtn')) {
    const ongoing = state.flares.find(f => !f.endTs);
    if (ongoing && confirm('Mark this flare as recovered today?')) {
      ongoing.notes = $('#flareNotes') ? $('#flareNotes').value.trim() : ongoing.notes;
      ongoing.endTs = Date.now();
      save();
      renderAll();
      showToast('Flare marked recovered');
    }
    return;
  }
  const delFlare = e.target.closest('[data-del-flare]');
  if (delFlare) {
    if (confirm('Delete this flare record?')) {
      state.flares = state.flares.filter(f => f.id !== delFlare.dataset.delFlare);
      save();
      renderAll();
    }
  }
});

// ---------- deletes (symptoms, check-ins) ----------

document.addEventListener('click', e => {
  const edit = e.target.closest('[data-edit-symptom]');
  if (edit) { startEditSymptom(edit.dataset.editSymptom); return; }

  const del = e.target.closest('[data-del-symptom]');
  if (del) {
    const entry = state.symptoms.find(s => s.id === del.dataset.delSymptom);
    if (entry && entry.photoId) deletePhotoBlob(entry.photoId);
    state.symptoms = state.symptoms.filter(s => s.id !== del.dataset.delSymptom);
    save();
    renderAll();
    return;
  }
  const delCheckin = e.target.closest('[data-del-checkin]');
  if (delCheckin) {
    state.checkins = state.checkins.filter(c => c.id !== delCheckin.dataset.delCheckin);
    save();
    renderAll();
  }
});

// ---------- medication form ----------

$('#medQuantity').addEventListener('input', () => {
  $('#medThresholdWrap').hidden = $('#medQuantity').value === '';
});

$('#medForm').addEventListener('submit', e => {
  e.preventDefault();
  const lastTakenVal = $('#medLastTaken').value;
  const quantityVal = $('#medQuantity').value;
  const med = {
    id: uid(),
    name: $('#medName').value.trim(),
    dosage: $('#medDosage').value.trim(),
    intervalValue: Math.max(1, Number($('#medInterval').value) || 1),
    intervalUnit: $('#medIntervalUnit').value,
    lastTakenTs: lastTakenVal ? new Date(lastTakenVal).getTime() : null,
    quantityOnHand: quantityVal === '' ? null : Math.max(0, Math.round(Number(quantityVal))),
    refillThreshold: quantityVal === '' ? null : Math.max(0, Math.round(Number($('#medThreshold').value) || 5)),
    notes: $('#medNotes').value.trim(),
    active: true,
  };
  state.medications.push(med);
  save();
  e.target.reset();
  $('#medInterval').value = 1;
  $('#medIntervalUnit').value = 'day';
  $('#medThreshold').value = 5;
  $('#medThresholdWrap').hidden = true;
  renderAll();
  showToast(`${med.name} added`);
});

document.addEventListener('click', e => {
  const take = e.target.closest('[data-take]');
  if (take) markDoseTaken(take.dataset.take);

  const del = e.target.closest('[data-del-med]');
  if (del) {
    if (confirm('Remove this medication and its schedule?')) {
      state.medications = state.medications.filter(m => m.id !== del.dataset.delMed);
      save();
      renderAll();
    }
  }

  const toggle = e.target.closest('[data-toggle-med]');
  if (toggle) {
    const med = state.medications.find(m => m.id === toggle.dataset.toggleMed);
    if (med) { med.active = !med.active; save(); renderAll(); }
  }

  const refill = e.target.closest('[data-refill-med]');
  if (refill) addRefill(refill.dataset.refillMed);
});

// ---------- settings: export / import / wipe ----------

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `symptom-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.symptoms || !data.medications) throw new Error('not a recognized backup');
    if (confirm('This replaces your current data with the backup. Continue?')) {
      migrate(data);
      state = { symptoms: data.symptoms || [], medications: data.medications || [], doseLog: data.doseLog || [], checkins: data.checkins || [], flares: data.flares || [], customSymptomTypes: data.customSymptomTypes || [], severityScale: 10 };
      save();
      renderAll();
      showToast('Backup imported');
    }
  } catch (err) {
    alert('Could not read that file as a Symptom Tracker backup.');
  }
  e.target.value = '';
});

$('#wipeBtn').addEventListener('click', () => {
  if (confirm('This permanently erases all symptoms and medications on this device. This cannot be undone. Continue?')) {
    state = { symptoms: [], medications: [], doseLog: [], checkins: [], flares: [], customSymptomTypes: [], severityScale: 10 };
    save();
    renderAll();
    showToast('All data erased');
  }
});

// ---------- pick me up ----------
// Fully on-device: nothing typed here is sent anywhere. This is a curated
// message library with light keyword matching, not a live AI call — real
// personalization is a natural fit for the backend once accounts exist,
// but that shouldn't hold up something people can use for comfort today.

const PICK_ME_UP_THEMES = [
  { key: 'goodDay', words: ['good day', 'feeling good', 'feeling better', 'feel better', 'proud', 'did it', 'small win', 'grateful', 'thankful', 'happy today', 'better today', 'good news', 'feeling okay', 'feeling ok', 'feeling great', 'excited'] },
  { key: 'fatigue', words: ['tired', 'exhaust', 'fatigue', 'sleepy', 'drained', 'no energy', 'worn out'] },
  { key: 'pain', words: ['pain', 'hurt', 'hurting', 'ache', 'aching', 'sore'] },
  { key: 'lonely', words: ['alone', 'lonely', 'isolat', 'no one understands', 'nobody understands', 'no one gets it'] },
  { key: 'anxious', words: ['scared', 'afraid', 'anxious', 'anxiety', 'worried', 'worry', 'nervous', 'terrified'] },
  { key: 'frustrated', words: ['frustrat', 'angry', 'mad', 'furious', 'annoyed', 'hate this', 'sick of'] },
  { key: 'doctor', words: ['doctor', 'appointment', 'diagnos', 'specialist', 'hospital', 'er visit'] },
];

// goodDay is checked first, so a positive note gets a response that matches
// that energy instead of assuming distress — the tone still shapes how it's
// said (hopeful looks forward, optimistic celebrates, supportive just shares it).
const PICK_ME_UP_MESSAGES = {
  hopeful: {
    general: [
      "This chapter is hard, but it isn't the whole story. Better days are still being written, even if you can't see the page yet.",
      "You've gotten through every hard day so far. That's not luck. That's you, still here, still going.",
      "Flares end. Bad days pass. What you're feeling right now is real, and it's also temporary.",
      "Somewhere ahead of you is a good day you haven't had yet. Hold on for it.",
      "Healing isn't a straight line, but every version of you, even this one, is still moving forward.",
    ],
    goodDay: "Hold onto this feeling. Moments like this are proof better days are possible, and there will be more of them.",
    fatigue: "This exhaustion is real, and it won't own every day forever. Rest now. There's more in you than you can feel right now.",
    pain: "Pain distorts time. Today feels endless, but it will loosen its grip. You won't feel exactly like this forever.",
    lonely: "Chronic illness can feel isolating, but you are not as alone in this as it feels right now.",
    anxious: "Fear about your body is exhausting, but uncertainty isn't the same as a bad outcome. You're allowed to hope anyway.",
    frustrated: "That frustration means you still care about getting better. That fight in you is worth holding onto.",
    doctor: "Navigating doctors and diagnoses is its own exhausting battle. Every appointment, even the frustrating ones, is a step toward answers.",
  },
  optimistic: {
    general: [
      "You're doing something most people never have to: showing up for your body, every single day. That's genuinely impressive.",
      "You've made it through every hard day so far, one hundred percent of the time. Good odds you'll make it through this one too.",
      "Small wins add up faster than they feel like they do. You're further along than you think.",
      "There's a lighter day coming, maybe sooner than you expect. Keep an eye out for it.",
      "This hard moment is real, but it's one page in a much bigger, brighter story. Keep turning the page.",
      "You're allowed to laugh today. You're allowed to feel good today. This illness doesn't get to own all of you.",
    ],
    goodDay: "Look at that, a good day! Let yourself enjoy it fully. No guilt, no waiting for the other shoe to drop.",
    fatigue: "Being this tired and still here, still trying, that's real strength, even if it doesn't feel like it.",
    pain: "You're carrying something heavy and still functioning. However small today's version of 'functioning' looks, it counts.",
    lonely: "Even in a quiet, lonely moment, you reached out here. That's you refusing to carry this completely alone.",
    anxious: "It's okay to be scared and still take things one step at a time. You don't have to have it all figured out today.",
    frustrated: "It's okay to be angry at your body today. You can be frustrated and still be on your own side.",
    doctor: "Advocating for yourself in a doctor's office is hard work. The fact that you keep showing up for it says a lot about you.",
  },
  supportive: {
    general: [
      "This is genuinely hard, and you don't have to perform strength right now. It's okay to just feel this.",
      "You don't need to justify how much this hurts, or how tired you are. It's valid, exactly as it is.",
      "You're not being dramatic. You're not too sensitive. You're dealing with something real, every single day.",
      "It's exhausting to explain an illness people can't see. You don't have to explain it here. I already believe you.",
      "You don't have to be okay right now. You're allowed to just get through today.",
    ],
    goodDay: "I'm really glad today feels lighter. You deserve this good moment every bit as much as you deserved support on the hard ones.",
    fatigue: "This isn't 'just being tired.' It's a different kind of exhausted, and you don't owe anyone an explanation for needing to rest.",
    pain: "Your pain is real, even when it's invisible to everyone else. You don't have to prove it to be believed here.",
    lonely: "It makes sense that this feels lonely. An illness other people can't see is hard to be understood in. I see you.",
    anxious: "Being scared about your own body is one of the hardest, loneliest fears there is. It's completely valid.",
    frustrated: "You're allowed to be furious at a body that won't cooperate. That anger isn't ungrateful. It's honest.",
    doctor: "Feeling dismissed or unheard by doctors is its own kind of painful. Your symptoms are real, whether or not someone in a white coat validates them today.",
  },
};

function detectPickMeUpTheme(text) {
  const lower = text.toLowerCase();
  for (const theme of PICK_ME_UP_THEMES) {
    if (theme.words.some(w => lower.includes(w))) return theme.key;
  }
  return null;
}

let currentTone = null;
let lastLiftMessage = null;

// The first response always honors a detected theme exactly — that's the
// point of asking what's going on. Variety only kicks in once they've
// already seen that match and tap "Give me another", so repeats don't loop
// on the same single themed line forever.
function pickLiftMessage(tone, note, isReshuffle) {
  const pool = PICK_ME_UP_MESSAGES[tone];
  const theme = note ? detectPickMeUpTheme(note) : null;

  if (theme && pool[theme] && !isReshuffle) {
    lastLiftMessage = pool[theme];
    return pool[theme];
  }

  const candidates = theme && pool[theme] ? [pool[theme], ...pool.general] : [...pool.general];
  let msg = candidates[Math.floor(Math.random() * candidates.length)];
  if (candidates.length > 1 && msg === lastLiftMessage) {
    msg = candidates[(candidates.indexOf(msg) + 1) % candidates.length];
  }
  lastLiftMessage = msg;
  return msg;
}

$('#toneGroup').addEventListener('click', e => {
  const btn = e.target.closest('[data-tone]');
  if (!btn) return;
  currentTone = btn.dataset.tone;
  $$('#toneGroup .tone-card').forEach(c => c.classList.toggle('active', c === btn));
  $('#getLiftBtn').disabled = false;
  $('#getLiftBtn').textContent = 'Get a lift';
});

function showLift(isReshuffle) {
  if (!currentTone) return;
  const note = $('#pickMeUpNote').value.trim();
  $('#liftMessage').textContent = pickLiftMessage(currentTone, note, isReshuffle);
  $('#liftTag').textContent = currentTone;
  const section = $('#view-pickmeup-response');
  section.classList.remove('tone-hopeful', 'tone-optimistic', 'tone-supportive');
  section.classList.add(`tone-${currentTone}`);
  switchView('pickmeup-response', 'pickmeup');
}

$('#getLiftBtn').addEventListener('click', () => showLift(false));
$('#anotherLiftBtn').addEventListener('click', () => showLift(true));

// ---------- notifications ----------

let swRegistration = null;

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('service-worker.js');
  } catch (e) { console.warn('SW registration failed', e); }
  navigator.serviceWorker.addEventListener('message', evt => {
    if (evt.data && evt.data.type === 'notification-action') {
      if (evt.data.action === 'take') markDoseTaken(evt.data.medId);
    }
  });
}

function updateNotifyUI() {
  const supported = 'Notification' in window;
  const btn = $('#notifyBtn');
  const status = $('#notifyStatus');
  if (!supported) {
    btn.hidden = true;
    status.textContent = 'This browser does not support notifications. The dashboard will still show overdue doses whenever you open the app.';
    return;
  }
  if (Notification.permission === 'granted') {
    btn.textContent = 'Reminders on';
    btn.classList.add('on');
    status.textContent = 'Reminders are enabled. Install this app to your home screen for the most reliable background alerts.';
  } else if (Notification.permission === 'denied') {
    btn.textContent = 'Reminders blocked';
    btn.classList.remove('on');
    status.textContent = 'Notifications are blocked in your browser settings. You can still check the dashboard for overdue doses.';
  } else {
    btn.textContent = 'Enable reminders';
    btn.classList.remove('on');
    status.textContent = 'Turn on reminders to get an alert when a dose is due.';
  }
}

$('#notifyBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
    updateNotifyUI();
    if (Notification.permission === 'granted') showToast('Reminders enabled');
  } else if (Notification.permission === 'granted') {
    showToast('Reminders are already on');
  } else {
    alert('Notifications are blocked for this site. Enable them in your browser/site settings, then reload.');
  }
});

function notifyDue(med, next) {
  const title = `${med.name} is due`;
  const body = med.dosage ? `${med.dosage} · scheduled for ${fmtTime(next)}` : `Scheduled for ${fmtTime(next)}`;
  const opts = {
    body,
    tag: `dose-${med.id}`,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { medId: med.id },
    actions: [{ action: 'take', title: 'Mark as taken' }],
    requireInteraction: true,
  };
  if (swRegistration && swRegistration.showNotification) {
    swRegistration.showNotification(title, opts);
  } else if (Notification.permission === 'granted') {
    new Notification(title, opts);
  }
}

const notifiedSlots = {};

function checkDueDoses() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  state.medications.filter(m => m.active).forEach(med => {
    const next = nextDoseTime(med, now);
    if (next !== null && next <= now && notifiedSlots[med.id] !== next) {
      notifiedSlots[med.id] = next;
      notifyDue(med, next);
    }
  });
}

function handleUrlActions() {
  const params = new URLSearchParams(location.search);
  const markTaken = params.get('markTaken');
  if (markTaken) {
    markDoseTaken(markTaken);
    params.delete('markTaken');
    const clean = location.pathname + (params.toString() ? '?' + params.toString() : '');
    history.replaceState({}, '', clean);
  }
}

// ---------- cloud sync (Firebase) ----------
// Local storage stays the source of truth for instant loads; when signed in,
// every save() also mirrors to Firestore under users/{uid}. Security rules
// on the Firebase side ensure only that user can ever read or write it.

const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
const firestore = typeof firebase !== 'undefined' ? firebase.firestore() : null;

function userDocRef(uid) {
  return firestore.collection('users').doc(uid);
}

function hasLocalData() {
  return state.symptoms.length > 0 || state.medications.length > 0 || state.checkins.length > 0 || state.flares.length > 0;
}

async function pullCloudState(uid) {
  const snap = await userDocRef(uid).get();
  if (!snap.exists) return false;
  const cloud = snap.data();
  state = {
    symptoms: cloud.symptoms || [],
    medications: cloud.medications || [],
    doseLog: cloud.doseLog || [],
    checkins: cloud.checkins || [],
    flares: cloud.flares || [],
    customSymptomTypes: cloud.customSymptomTypes || [],
    severityScale: 10,
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  return true;
}

async function handleSignedIn(user) {
  currentUser = user;
  $('#accountSignedOut').hidden = true;
  $('#accountSignedIn').hidden = false;
  $('#accountEmail').textContent = user.email;
  $('#syncStatus').textContent = 'Syncing…';

  try {
    const snap = await userDocRef(user.uid).get();
    if (snap.exists) {
      const proceed = !hasLocalData() || confirm("You have data on this device that hasn't been synced yet. Signing in will replace it with your account's cloud data. Continue?");
      if (proceed) await pullCloudState(user.uid);
    } else {
      await userDocRef(user.uid).set(state);
    }
    $('#syncStatus').textContent = 'Synced';
  } catch (err) {
    console.warn('sync failed', err);
    $('#syncStatus').textContent = 'Sync error — changes are still saved on this device';
  }
  renderAll();
}

function handleSignedOut() {
  currentUser = null;
  $('#accountSignedOut').hidden = false;
  $('#accountSignedIn').hidden = true;
  $('#authForm').reset();
  $('#authError').hidden = true;
}

if (auth) {
  auth.onAuthStateChanged(user => { user ? handleSignedIn(user) : handleSignedOut(); });
}

let authMode = 'signin';
$('#authToggleModeBtn').addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  $('#authSubmitBtn').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  $('#authToggleModeBtn').textContent = authMode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in';
  $('#authError').hidden = true;
});

function friendlyAuthError(err) {
  const map = {
    'auth/invalid-email': "That email address doesn't look right.",
    'auth/user-not-found': 'No account found with that email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/email-already-in-use': 'An account already exists with that email.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Try again in a bit.',
    'auth/network-request-failed': "Couldn't reach the server. Check your connection.",
  };
  return map[err.code] || 'Something went wrong. Please try again.';
}

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!auth) return;
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  $('#authError').hidden = true;
  $('#authSubmitBtn').disabled = true;
  try {
    if (authMode === 'signin') {
      await auth.signInWithEmailAndPassword(email, password);
    } else {
      await auth.createUserWithEmailAndPassword(email, password);
    }
  } catch (err) {
    $('#authError').textContent = friendlyAuthError(err);
    $('#authError').hidden = false;
  }
  $('#authSubmitBtn').disabled = false;
});

$('#signOutBtn').addEventListener('click', () => { if (auth) auth.signOut(); });

// ---------- init ----------

initServiceWorker();
updateNotifyUI();
handleUrlActions();
renderAll();
setInterval(() => { renderDashboard(); checkDueDoses(); }, 30000);
checkDueDoses();
