// HealthLog <-> Supabase: auth, merge sync, conflicts, local cache.
export const CFG = {
  url: 'https://wylxvmkcrexwfpjpbhyy.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5bHh2bWtjcmV4d2ZwanBiaHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzkxMDYsImV4cCI6MjA4NDIxNTEwNn0.6Bxo42hx4jwlJGWnfjiTpiDUsYfc1QLTN3YtrU1efak'
};

const CACHE = 'healthlog-v1';
const META  = 'healthlog-sync-meta';
let sb = null;

export async function init() {
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(CFG.url, CFG.key, {
    // detectSessionInUrl must be true so OAuth redirects can complete
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'healthlog-auth' }
  });
  return sb;
}
export function client() { return sb; }
export async function currentSession() {
  if (!sb) return null;
  try { const { data } = await sb.auth.getSession(); return (data && data.session) || null; } catch (e) { return null; }
}
export function onAuthChange(cb) { if (sb) sb.auth.onAuthStateChange((_e, s) => cb(s)); }

function warm(e) {
  const m = ((e && e.message) || '').toLowerCase();
  if (typeof navigator !== 'undefined' && !navigator.onLine) return "You're offline right now — everything you add is safe on this device and will sync when you're back.";
  if (m.includes('invalid login')) return "That email and password didn't match. Worth another try.";
  if (m.includes('email not confirmed')) return "Almost there — tap the confirmation link in your inbox, then come back and sign in.";
  if (m.includes('already registered') || m.includes('already been registered')) return 'You already have an account with this email — try signing in instead.';
  if (m.includes('password')) return 'Passwords need to be at least 6 characters.';
  if (m.includes('rate') || m.includes('too many')) return 'A few too many tries — give it a minute and go again.';
  if (m.includes('failed to fetch')) return "Couldn't reach the server. Your data is safe here; we'll sync when the connection is back.";
  return (e && e.message) ? e.message : 'Something went wrong on our side. Try once more in a moment.';
}

// Drop every cached copy and re-pull. Use when a device is out of step.
export function resetDevice() {
  try { localStorage.removeItem(CACHE); localStorage.removeItem(META); } catch (e) { }
}

export async function signInWithGoogle() {
  try {
    if (!sb) await init();
    const back = window.location.origin + window.location.pathname;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: back, queryParams: { prompt: 'select_account' } }
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, msg: warm(e) }; }
}

export async function signIn(email, pw) {
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: (email || '').trim(), password: pw || '' });
    if (error) throw error;
    return { ok: true, session: data.session };
  } catch (e) { return { ok: false, msg: warm(e) }; }
}
export async function signUp(email, pw) {
  try {
    const { data, error } = await sb.auth.signUp({ email: (email || '').trim(), password: pw || '' });
    if (error) throw error;
    if (data.session) return { ok: true, session: data.session };
    return { ok: true, session: null, msg: "Account created. Check your inbox for the confirmation link, then sign in — we'll be right here." };
  } catch (e) { return { ok: false, msg: warm(e) }; }
}
export async function resetPassword(email) {
  try {
    const { error } = await sb.auth.resetPasswordForEmail((email || '').trim());
    if (error) throw error;
    return { ok: true, msg: "If that email has an account, a reset link is on its way. Check your inbox (and spam) — then come back and sign in." };
  } catch (e) { return { ok: false, msg: warm(e) }; }
}
export async function signOut() { try { await sb.auth.signOut(); } catch (e) { } }

export async function deleteMyData() {
  try {
    const s = await currentSession();
    if (!s) return { ok: false, msg: 'Sign in first.' };
    const uid = s.user.id;
    await sb.from('healthlog_dose_logs').delete().eq('user_id', uid);
    await sb.from('healthlog_visits').delete().eq('user_id', uid);
    await sb.from('healthlog_conflicts').delete().eq('user_id', uid);
    await sb.from('healthlog_settings').delete().eq('user_id', uid);
    try { localStorage.removeItem(CACHE); localStorage.removeItem(META); } catch (e) { }
    await signOut();
    return { ok: true, msg: 'Your HealthLog data has been removed.' };
  } catch (e) { return { ok: false, msg: warm(e) }; }
}

// ---------- local cache ----------
export function cacheLoad() {
  try { const r = localStorage.getItem(CACHE); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
export function cacheSave(data) { try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch (e) { } }
export function meta() { try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch (e) { return {}; } }
export function setMeta(o) { try { localStorage.setItem(META, JSON.stringify(Object.assign(meta(), o))); } catch (e) { } }
export function queuePending() { setMeta({ pending: true }); }
export function isPending() { return !!meta().pending; }

// ---------- shape mapping ----------
function rowToVisit(v, meds) {
  return {
    id: v.local_id || v.id,
    rowId: v.id,
    date: v.visit_date,
    clinic: v.clinic_name || v.clinic || '',
    doctor: v.doctor || '',
    concern: v.concern || '',
    notes: v.notes || '',
    followUp: v.follow_up || '',
    source: v.source || 'server',
    meds: (meds || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(m => ({
      rowId: m.id,
      name: m.name, dose: m.dose || '', slots: m.slots || ['morning'], days: m.days || 1,
      times: m.times || null, rule: m.rule || null, everyN: m.every_n || null,
      weekdays: m.weekdays || null, qty: m.qty == null ? null : +m.qty,
      source: m.source || 'server'
    })),
    costs: { consult: +v.cost_consult || 0, meds: +v.cost_meds || 0, other: +v.cost_other || 0 }
  };
}

// healthlog_dose_logs keys on (medicine_id, log_date, slot). The app keys on
// '<visitLocalId>-<medIndex>-<slotId>', so both directions go through the
// medicine row uuid.
function medIndexById(visits) {
  const map = {};
  (visits || []).forEach(v => {
    (v.meds || []).forEach((m, i) => { if (m.rowId) map[m.rowId] = { visit: v.id, idx: i }; });
  });
  return map;
}
function rowIdForKey(visits, key) {
  // key = visitLocalId-medIndex-slotId ; visit ids may themselves contain '-'
  const parts = String(key).split('-');
  if (parts.length < 3) return null;
  const slot = parts[parts.length - 1];
  const idx = +parts[parts.length - 2];
  const visitId = parts.slice(0, parts.length - 2).join('-');
  const v = (visits || []).find(x => x.id === visitId);
  if (!v) return null;
  const m = (v.meds || [])[idx];
  return m && m.rowId ? { medicine_id: m.rowId, slot: slot } : null;
}
function flattenTaken(taken, visits) {
  const out = [];
  Object.keys(taken || {}).forEach(date => {
    const day = taken[date] || {};
    Object.keys(day).forEach(id => {
      if (!day[id]) return;
      const ref = rowIdForKey(visits, id);
      if (!ref) return;
      out.push({ medicine_id: ref.medicine_id, slot: ref.slot, log_date: date, taken: day[id] !== 'skip' });
    });
  });
  return out;
}
function nestTaken(rows, visits) {
  const out = {};
  const byId = medIndexById(visits);
  (rows || []).forEach(r => {
    const ref = byId[r.medicine_id];
    if (!ref || r.taken === false) return;
    const date = r.log_date;
    (out[date] = out[date] || {})[ref.visit + '-' + ref.idx + '-' + r.slot] = true;
  });
  return out;
}

export async function pull() {
  const s = await currentSession();
  if (!s) throw new Error('not signed in');
  const uid = s.user.id;
  const vr = await sb.from('healthlog_visits').select('*').eq('user_id', uid).order('visit_date', { ascending: false });
  if (vr.error) throw vr.error;
  const [mr, dr, cr] = await Promise.all([
    sb.from('healthlog_medicines').select('*').eq('user_id', uid),
    sb.from('healthlog_dose_logs').select('*').eq('user_id', uid),
    sb.from('healthlog_conflicts').select('*').eq('user_id', uid).eq('resolved', false).order('created_at', { ascending: false })
  ]);
  if (mr.error) throw mr.error;
  const byVisit = {};
  (mr.data || []).forEach(m => { (byVisit[m.visit_id] = byVisit[m.visit_id] || []).push(m); });
  const visits = (vr.data || []).map(v => rowToVisit(v, byVisit[v.id]));
  return {
    visits: visits,
    taken: nestTaken(dr.data, visits),
    conflicts: (cr && cr.data) || [],
    uid
  };
}

export async function push(data) {
  const s = await currentSession();
  if (!s) return { ok: false };
  const uid = s.user.id;
  for (const v of (data.visits || [])) {
    const row = {
      user_id: uid, local_id: v.id, visit_date: v.date, clinic_name: v.clinic || '', doctor: v.doctor || '',
      concern: v.concern || '', notes: v.notes || '', follow_up: v.followUp || null,
      cost_consult: (v.costs || {}).consult || 0, cost_meds: (v.costs || {}).meds || 0, cost_other: (v.costs || {}).other || 0,
      source: v.source || 'device', updated_at: new Date().toISOString()
    };
    const up = await sb.from('healthlog_visits').upsert(row, { onConflict: 'user_id,local_id' }).select('id').single();
    if (up.error || !up.data) continue;
    const meds = (v.meds || []).map((m, i) => ({
      user_id: uid, visit_id: up.data.id, name: (m.name || '').trim(), dose: m.dose || '',
      slots: (m.slots && m.slots.length ? m.slots : ['morning']), days: +m.days || 1, sort: i,
      times: m.times && m.times.length ? m.times : null,
      rule: m.rule || null, every_n: m.everyN || null,
      weekdays: m.weekdays && m.weekdays.length ? m.weekdays : null,
      qty: m.qty == null ? null : +m.qty,
      name_verified: false, source: m.source || 'device'
    })).filter(m => m.name);
    if (meds.length) await sb.from('healthlog_medicines').upsert(meds, { onConflict: 'visit_id,name,dose' });
  }
  // dose logs need the medicine uuids, so re-read what we just wrote
  const fresh = await pull().catch(() => null);
  const logs = flattenTaken(data.taken, (fresh && fresh.visits) || data.visits)
    .map(l => Object.assign({ user_id: uid, updated_at: new Date().toISOString() }, l));
  if (logs.length) await sb.from('healthlog_dose_logs')
    .upsert(logs, { onConflict: 'user_id,medicine_id,log_date,slot' });
  setMeta({ pending: false, lastSync: Date.now() });
  return { ok: true };
}

// ---------- merge: keep everything, tag the source, record conflicts ----------
const medKey = m => (m.name || '').trim().toLowerCase() + '|' + (m.dose || '').trim().toLowerCase();

export function merge(local, server) {
  const conflicts = [], out = [], seen = {};
  // Only trust "absent from server" as a deletion when the server actually
  // answered — otherwise a failed pull would wipe the device.
  const serverAnswered = Array.isArray(server && server.visits);
  (server.visits || []).forEach(sv => { seen[sv.id] = sv; });

  (local.visits || []).forEach(lv => {
    const sv = seen[lv.id];
    if (!sv) {
      // lv.rowId means this visit came from the server at some point. If the
      // server no longer has it, it was deleted elsewhere — respect that
      // instead of resurrecting it on the next push.
      if (serverAnswered && lv.rowId) return;
      out.push(Object.assign({}, lv, { source: lv.source || 'device' }));
      return;
    }
    delete seen[lv.id];
    const lm = lv.meds || [], sm = sv.meds || [], map = {};
    sm.forEach(m => { map[medKey(m)] = Object.assign({}, m, { source: 'server' }); });
    let added = 0;
    lm.forEach(m => { const k = medKey(m); if (!map[k]) { map[k] = Object.assign({}, m, { source: 'device' }); added++; } });
    const serverOnly = sm.filter(m => !lm.some(x => medKey(x) === medKey(m))).length;
    if (added > 0 && serverOnly > 0) {
      conflicts.push({
        kind: 'medicine',
        label: (sv.doctor || sv.clinic || sv.clinic_name || 'Visit ' + sv.date) + ' — kept ' + added + ' from this device and ' + serverOnly + ' from the server',
        detail: { visit: lv.id, device: added, server: serverOnly }
      });
    }
    out.push(Object.assign({}, sv, lv, {
      meds: Object.keys(map).map(k => map[k]),
      source: sv.source || 'server',
      notes: lv.notes || sv.notes || '',
      costs: lv.costs || sv.costs
    }));
  });
  Object.keys(seen).forEach(k => out.push(Object.assign({}, seen[k], { source: 'server' })));

  const taken = {};
  const dates = {};
  Object.keys(server.taken || {}).forEach(d => { dates[d] = 1; });
  Object.keys(local.taken || {}).forEach(d => { dates[d] = 1; });
  Object.keys(dates).forEach(d => {
    const sd = (server.taken || {})[d] || {}, ld = (local.taken || {})[d] || {};
    const day = Object.assign({}, sd);
    Object.keys(ld).forEach(id => {
      if (day[id] === undefined) { day[id] = ld[id]; return; }
      if (day[id] !== ld[id]) {
        conflicts.push({ kind: 'dose', label: 'A dose on ' + d + ' was marked differently on two devices — kept the synced one', detail: { date: d, dose: id, device: ld[id], server: sd[id] } });
      }
    });
    taken[d] = day;
  });

  out.sort((a, b) => a.date < b.date ? 1 : -1);
  return { visits: out, taken, conflicts };
}

export async function logConflicts(list) {
  if (!list || !list.length) return;
  const s = await currentSession();
  if (!s) return;
  try {
    await sb.from('healthlog_conflicts').insert(list.map(c => ({ user_id: s.user.id, kind: c.kind, label: c.label, detail: c.detail || null })));
  } catch (e) { }
}
export async function dismissConflict(id) {
  try { await sb.from('healthlog_conflicts').update({ resolved: true }).eq('id', id); } catch (e) { }
}

export async function syncNow(localData) {
  try {
    const server = await pull();
    const merged = merge(localData || { visits: [], taken: {} }, server);
    await push({ visits: merged.visits, taken: merged.taken });
    if (merged.conflicts.length) await logConflicts(merged.conflicts);
    const after = await pull();
    cacheSave({ visits: after.visits, taken: after.taken });
    setMeta({ lastSync: Date.now(), pending: false });
    return { ok: true, visits: after.visits, taken: after.taken, conflicts: after.conflicts, lastSync: Date.now() };
  } catch (e) {
    queuePending();
    return { ok: false, msg: warm(e) };
  }
}

// ---------- settings (theme / currency / budget) ----------
export async function getSettings() {
  try {
    const s = await currentSession();
    if (!s) return null;
    const r = await sb.from('healthlog_settings').select('*').eq('user_id', s.user.id).maybeSingle();
    if (r.error || !r.data) return null;
    return { theme: r.data.theme, currency: r.data.currency, budget: Number(r.data.budget) };
  } catch (e) { return null; }
}
export async function saveSettings(v) {
  try {
    const s = await currentSession();
    if (!s || !v) return { ok: false };
    const r = await sb.from('healthlog_settings').upsert({
      user_id: s.user.id, theme: v.theme, currency: v.currency, budget: v.budget, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    return { ok: !r.error };
  } catch (e) { return { ok: false }; }
}

export function lastSyncLabel() {
  const t = meta().lastSync;
  if (!t) return 'Not synced yet';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return 'Synced ' + mins + ' min ago';
  const h = Math.round(mins / 60);
  if (h < 24) return 'Synced ' + h + 'h ago';
  return 'Synced ' + new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
