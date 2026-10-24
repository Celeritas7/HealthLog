// HealthLog — symptom log, food remedies, the "Did it help?" ask, the inbox
// and the merged timeline. Shared by the desktop and mobile pages.
//
// Tables: healthlog_symptoms, healthlog_food_remedies, healthlog_dismissals
// (all RLS "own rows"). Hub rules: nothing here reads setu_* or
// food_department_* or calls a Setu RPC — fd_dish_id / setu_spot_id are only
// carried through as stored.
//
// Local shape (cached under healthlog-log-v1):
//   symptoms: [{ id, rowId, symptom, startedOn, endedOn, severity, fever, notes, source, dirty, deleted }]
//   remedies: [{ id, rowId, name, kind, symptom, symptomId, takenOn, takenAt, timeOfDay,
//                effect, reliefHours, notes, placeName, fdDishId, setuSpotId, createdAt, source, dirty, deleted }]
//   dismissals: [{ key, date, dirty }]
// `id` is the row's local_id; symptomId points at a symptom's local id.

import { toMin, fmtTime, dayKey, addDays, daysBetween } from './healthlog-schedule.js';
export { fmtTime, dayKey };

const CACHE = 'healthlog-log-v1';

export const ASK_AFTER_MIN = 4 * 60;   // ask 4 h after the remedy was taken
export const ASK_LATE_MIN = 22 * 60;   // later than 22:00 → next morning
export const ASK_MORNING_MIN = 9 * 60; // morning asks go out at 09:00
export const TOD_TIME = { morning: '08:00', noon: '13:00', afternoon: '15:00', evening: '18:00', 'before bed': '22:00', night: '22:00' };
export const ANSWERS = [
  { key: 'helped', label: 'Helped', effect: 'good' },
  { key: 'bit', label: 'A bit', effect: 'some' },
  { key: 'no', label: 'No', effect: 'none' }
];
export const EFFECT_LABEL = { good: 'Helped', some: 'Helped a bit', none: "Didn't help" };
export const KINDS = [
  { key: 'dish', label: 'Dish', emoji: '🍲' },
  { key: 'drink', label: 'Drink', emoji: '🍵' },
  { key: 'restaurant_meal', label: 'Eating out', emoji: '🍽️' }
];
export const SEVERITY = ['mild', 'moderate', 'severe'];

// ---------- small helpers ----------
const pad = n => String(n).padStart(2, '0');
function nowHHMM(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function atMin(dateStr, min) { const d = new Date(dateStr + 'T00:00:00'); d.setMinutes(min); return d; }
function fmtDay(dateStr) { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtWhen(d) {
  const today = dayKey(new Date()), k = dayKey(d);
  const day = k === today ? 'today' : k === addDays(today, -1) ? 'yesterday' : k === addDays(today, 1) ? 'tomorrow' : fmtDay(k);
  return day + ', ' + fmtTime(nowHHMM(d));
}
function todOf(hhmm) {
  const m = toMin(hhmm);
  return m < 5 * 60 ? 'night' : m < 11 * 60 ? 'morning' : m < 15 * 60 ? 'noon' : m < 21 * 60 ? 'evening' : 'before bed';
}
export function newId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- cache ----------
export function emptyLog() { return { symptoms: [], remedies: [], dismissals: [] }; }
export function cacheLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (d && Array.isArray(d.symptoms) && Array.isArray(d.remedies)) return { dismissals: [], ...d };
  } catch (e) { }
  return null;
}
export function cacheSave(log) { try { localStorage.setItem(CACHE, JSON.stringify(log)); } catch (e) { } }
export function resetLog() { try { localStorage.removeItem(CACHE); } catch (e) { } }

const live = list => (list || []).filter(x => !x.deleted);
export function symptoms(log) { return live(log.symptoms); }
export function remedies(log) { return live(log.remedies); }
export function openSymptoms(log) { return symptoms(log).filter(s => !s.endedOn); }

// ---------- "Did it help?" ----------
// When the ask is due: taken_at, else the time_of_day's clock time, else when
// the row was created — plus 4 h. Past 22:00 or before 09:00 → 09:00.
export function askAt(r) {
  let base = null;
  if (r.takenOn && r.takenAt) base = atMin(r.takenOn, toMin(r.takenAt));
  else if (r.takenOn && TOD_TIME[(r.timeOfDay || '').toLowerCase()]) base = atMin(r.takenOn, toMin(TOD_TIME[r.timeOfDay.toLowerCase()]));
  else if (r.createdAt) base = new Date(r.createdAt);
  if (!base || isNaN(base)) return null;
  const t = new Date(base.getTime() + ASK_AFTER_MIN * 60000);
  const k = dayKey(t), m = t.getHours() * 60 + t.getMinutes();
  if (m > ASK_LATE_MIN) return atMin(addDays(k, 1), ASK_MORNING_MIN);
  if (m < ASK_MORNING_MIN) return atMin(k, ASK_MORNING_MIN);
  return t;
}
export function helpKey(r) { return 'remedy-help:' + r.id; }
export function isDismissed(log, key) { return (log.dismissals || []).some(d => d.key === key); }
export function helpPending(log, r) { return !r.effect && !isDismissed(log, helpKey(r)); }
export function helpDue(log, r, now) {
  if (!helpPending(log, r)) return false;
  const t = askAt(r);
  return !!t && t <= now;
}

// ---------- mutations (each returns a new log) ----------
const touch = (list, id, patch) => list.map(x => x.id === id ? { ...x, ...patch, dirty: true } : x);

export function addSymptom(log, f) {
  const s = {
    id: newId('sym'), rowId: null, symptom: f.symptom.trim(), startedOn: f.startedOn, endedOn: f.endedOn || '',
    severity: f.severity || '', fever: !!f.fever, notes: (f.notes || '').trim(), source: 'device', dirty: true
  };
  return { ...log, symptoms: [s, ...(log.symptoms || [])] };
}
export function endSymptom(log, id, date) { return { ...log, symptoms: touch(log.symptoms, id, { endedOn: date }) }; }
export function reopenSymptom(log, id) { return { ...log, symptoms: touch(log.symptoms, id, { endedOn: '' }) }; }

export function addRemedy(log, f) {
  const sym = f.symptomId ? symptoms(log).find(s => s.id === f.symptomId) : null;
  const r = {
    id: newId('rem'), rowId: null, name: f.name.trim(), kind: f.kind || 'dish',
    symptom: sym ? sym.symptom : (f.symptom || '').trim(), symptomId: sym ? sym.id : '',
    takenOn: f.takenOn, takenAt: f.takenAt || '', timeOfDay: f.takenAt ? todOf(f.takenAt) : '',
    effect: '', reliefHours: null, notes: (f.notes || '').trim(), placeName: (f.placeName || '').trim(),
    fdDishId: null, setuSpotId: null, createdAt: new Date().toISOString(), source: 'device', dirty: true
  };
  return { ...log, remedies: [r, ...(log.remedies || [])] };
}
export function answerRemedy(log, id, effect, hours) {
  const h = hours === '' || hours == null || isNaN(+hours) ? null : Math.max(0, +hours);
  return { ...log, remedies: touch(log.remedies, id, { effect, reliefHours: h }) };
}
export function dismiss(log, key, date) {
  if (isDismissed(log, key)) return log;
  return { ...log, dismissals: [...(log.dismissals || []), { key, date: date || dayKey(new Date()), dirty: true }] };
}
export function skipRemedy(log, id) {
  const r = remedies(log).find(x => x.id === id);
  return r ? dismiss(log, helpKey(r), r.takenOn) : log;
}
export function removeSymptom(log, id) {
  // remedies keep their symptom text; the link just goes (FK is ON DELETE SET NULL)
  return {
    ...log,
    symptoms: touch(log.symptoms, id, { deleted: true }),
    remedies: (log.remedies || []).map(r => r.symptomId === id ? { ...r, symptomId: '' } : r)
  };
}
export function removeRemedy(log, id) { return { ...log, remedies: touch(log.remedies, id, { deleted: true }) }; }

// ---------- evening weather notes (healthlog_alert_events, written at 18:00 JST) ----------
// The newest run's lines (max 3), shown until the next run replaces them.
// Lines are symptom-tied rules plus the hub's risk flags (R046).
export async function fetchWarnings(sb, uid) {
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await sb.from('healthlog_alert_events').select('run_date,rank,line,weather_key,season')
    .eq('user_id', uid).gte('created_at', since)
    .order('run_date', { ascending: false }).order('rank', { ascending: true });
  if (r.error) return null;
  const rows = r.data || [];
  const runDate = rows.length ? rows[0].run_date : '';
  const run = rows.filter(x => x.run_date === runDate);
  return { runDate, lines: run.map(x => x.line), season: (run.find(x => x.season) || {}).season || '' };
}
export function warningKey(w) { return 'warnings:' + w.runDate; }
export function warningItems(log, w) {
  if (!w || !w.lines || !w.lines.length || isDismissed(log, warningKey(w))) return [];
  return [{ type: 'warning', key: warningKey(w), runDate: w.runDate, title: 'Weather note for tomorrow', sub: w.season ? 'Season: ' + w.season : 'From the 18:00 check', lines: w.lines }];
}

// ---------- inbox ----------
// Today's weather note first, then open "Did it help?" asks.
export function inboxItems(log, now, warnings) {
  const asks = remedies(log).filter(r => helpDue(log, r, now)).map(r => {
    const t = askAt(r);
    return {
      type: 'help', key: helpKey(r), remedy: r, at: t,
      title: 'Did the ' + r.name + ' help?',
      sub: [r.symptom ? 'For ' + r.symptom : '', 'taken ' + fmtDay(r.takenOn) + (r.takenAt ? ', ' + fmtTime(r.takenAt) : r.timeOfDay ? ', ' + r.timeOfDay : '')].filter(Boolean).join(' · ')
    };
  }).sort((a, b) => b.at - a.at);
  return [...(warnings || []), ...asks];
}

// ---------- merged timeline ----------
export function timeline(log, visits, limitDays) {
  const today = dayKey(new Date());
  const from = limitDays ? addDays(today, -limitDays) : '';
  const items = [];
  (visits || []).forEach(v => {
    if (!v.date || v.date < from) return;
    items.push({ type: 'visit', id: v.id, date: v.date, sortT: '12:00', icon: '🏥', title: v.concern || 'Clinic visit', sub: [v.clinic, v.doctor].filter(Boolean).join(' · ') });
  });
  symptoms(log).forEach(s => {
    if (s.startedOn < from && s.endedOn && s.endedOn < from) return;
    const days = daysBetween(s.startedOn, s.endedOn || today) + 1;
    items.push({
      type: 'symptom', id: s.id, date: s.startedOn, sortT: '00:00', icon: '🤒',
      title: s.symptom.charAt(0).toUpperCase() + s.symptom.slice(1),
      sub: [s.severity, s.fever ? 'fever' : '', s.notes].filter(Boolean).join(' · '),
      pill: s.endedOn ? (days === 1 ? '1 day' : days + ' days') : 'Open · day ' + days,
      tone: s.endedOn ? 'muted' : 'warn', open: !s.endedOn
    });
    if (s.endedOn && s.endedOn >= from) {
      items.push({ type: 'symptom-end', id: s.id + ':end', date: s.endedOn, sortT: '23:59', icon: '🌿', title: 'Better: ' + s.symptom, sub: 'after ' + (days === 1 ? '1 day' : days + ' days') });
    }
  });
  const now = new Date();
  remedies(log).forEach(r => {
    if (r.takenOn < from) return;
    const kind = KINDS.find(k => k.key === r.kind) || KINDS[0];
    const ask = helpPending(log, r) ? askAt(r) : null;
    items.push({
      type: 'remedy', id: r.id, date: r.takenOn, sortT: r.takenAt || TOD_TIME[(r.timeOfDay || '').toLowerCase()] || '12:00', icon: kind.emoji,
      title: r.name,
      sub: [r.takenAt ? fmtTime(r.takenAt) : r.timeOfDay, r.symptom ? 'for ' + r.symptom : '', r.placeName, r.notes].filter(Boolean).join(' · '),
      pill: r.effect ? EFFECT_LABEL[r.effect] + (r.reliefHours != null ? ' · ~' + r.reliefHours + ' h' : '') : ask && ask <= now ? 'In your inbox' : ask ? 'Ask ' + fmtWhen(ask) : '',
      tone: r.effect === 'good' ? 'good' : r.effect === 'some' ? 'some' : r.effect === 'none' ? 'muted' : 'info'
    });
  });
  const byDay = {};
  items.forEach(i => { (byDay[i.date] = byDay[i.date] || []).push(i); });
  return Object.keys(byDay).sort().reverse().map(date => ({
    date,
    label: date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    items: byDay[date].sort((a, b) => (a.sortT < b.sortT) - (a.sortT > b.sortT))
  }));
}

// ---------- sync ----------
function symptomFromRow(r) {
  return {
    id: r.local_id || r.id, rowId: r.id, symptom: r.symptom || '', startedOn: r.started_on, endedOn: r.ended_on || '',
    severity: r.severity || '', fever: !!r.fever, notes: r.notes || '', source: r.source || 'server'
  };
}
function symptomToRow(s, uid) {
  return {
    user_id: uid, local_id: s.id, symptom: s.symptom, started_on: s.startedOn, ended_on: s.endedOn || null,
    severity: s.severity || null, fever: !!s.fever, notes: s.notes || null, source: s.source || 'device',
    updated_at: new Date().toISOString()
  };
}
function remedyFromRow(r, symByRow) {
  return {
    id: r.local_id || r.id, rowId: r.id, name: r.name || '', kind: r.kind || 'dish',
    symptom: r.symptom || '', symptomId: (r.symptom_id && symByRow[r.symptom_id]) || '',
    takenOn: r.taken_on, takenAt: r.taken_at ? String(r.taken_at).slice(0, 5) : '', timeOfDay: r.time_of_day || '',
    effect: r.effect || '', reliefHours: r.relief_hours == null ? null : +r.relief_hours, notes: r.notes || '',
    placeName: r.place_name || '', fdDishId: r.fd_dish_id || null, setuSpotId: r.setu_spot_id || null,
    createdAt: r.created_at, source: r.source || 'server'
  };
}
function remedyToRow(r, uid, symRowId) {
  return {
    user_id: uid, local_id: r.id, name: r.name, kind: r.kind || 'dish', symptom: r.symptom || null,
    symptom_id: symRowId || null, taken_on: r.takenOn, taken_at: r.takenAt || null, time_of_day: r.timeOfDay || null,
    effect: r.effect || null, relief_hours: r.reliefHours, notes: r.notes || null, place_name: r.placeName || null,
    fd_dish_id: r.fdDishId || null, setu_spot_id: r.setuSpotId || null, source: r.source || 'device',
    updated_at: new Date().toISOString()
  };
}

// Rows that came from the server (rowId) update by id, so a row whose
// local_id was never set is not duplicated; new rows upsert on local_id.
async function pushRows(sb, table, uid, items, toRow) {
  for (const it of items) {
    const row = toRow(it);
    const q = it.rowId
      ? sb.from(table).update(row).eq('id', it.rowId).eq('user_id', uid)
      : sb.from(table).upsert(row, { onConflict: 'user_id,local_id' });
    const r = await q;
    if (r.error) throw r.error;
  }
}
async function deleteRows(sb, table, uid, items) {
  for (const it of items) {
    const q = sb.from(table).delete().eq('user_id', uid);
    const r = it.rowId ? await q.eq('id', it.rowId) : await q.eq('local_id', it.id);
    if (r.error) throw r.error;
  }
}

export async function pullLog(sb, uid) {
  const since = addDays(dayKey(new Date()), -120);
  // dismissals: recent ones, plus every "Did it help?" skip (those never expire)
  const [sr, rr, dr, hr] = await Promise.all([
    sb.from('healthlog_symptoms').select('*').eq('user_id', uid).order('started_on', { ascending: false }),
    sb.from('healthlog_food_remedies').select('*').eq('user_id', uid).order('taken_on', { ascending: false }),
    sb.from('healthlog_dismissals').select('alert_key,alert_date').eq('user_id', uid).gte('alert_date', since),
    sb.from('healthlog_dismissals').select('alert_key,alert_date').eq('user_id', uid).like('alert_key', 'remedy-help:%')
  ]);
  if (sr.error) throw sr.error;
  if (rr.error) throw rr.error;
  if (dr.error) throw dr.error;
  if (hr.error) throw hr.error;
  const seen = new Set();
  const dis = [...(dr.data || []), ...(hr.data || [])].filter(d => {
    const k = d.alert_key + '|' + d.alert_date;
    return seen.has(k) ? false : seen.add(k);
  });
  const syms = (sr.data || []).map(symptomFromRow);
  const symByRow = {};
  syms.forEach(s => { symByRow[s.rowId] = s.id; });
  return {
    symptoms: syms,
    remedies: (rr.data || []).map(r => remedyFromRow(r, symByRow)),
    dismissals: dis.map(d => ({ key: d.alert_key, date: d.alert_date }))
  };
}

// Push what changed here, then re-read. Returns the server copy; call
// rebase() with the live state afterwards so edits made mid-sync survive.
export async function syncLog(sb, uid, local) {
  try {
    const dirtySym = (local.symptoms || []).filter(s => s.dirty);
    await deleteRows(sb, 'healthlog_symptoms', uid, dirtySym.filter(s => s.deleted));
    await pushRows(sb, 'healthlog_symptoms', uid, dirtySym.filter(s => !s.deleted), s => symptomToRow(s, uid));

    const dirtyRem = (local.remedies || []).filter(r => r.dirty);
    await deleteRows(sb, 'healthlog_food_remedies', uid, dirtyRem.filter(r => r.deleted));
    const pushRem = dirtyRem.filter(r => !r.deleted);
    if (pushRem.length) {
      // symptom_id needs the symptom's row uuid, which new symptoms only have now
      const ids = await sb.from('healthlog_symptoms').select('id,local_id').eq('user_id', uid);
      if (ids.error) throw ids.error;
      const rowOf = {};
      (ids.data || []).forEach(x => { rowOf[x.local_id || x.id] = x.id; });
      await pushRows(sb, 'healthlog_food_remedies', uid, pushRem, r => remedyToRow(r, uid, rowOf[r.symptomId]));
    }

    const dis = (local.dismissals || []).filter(d => d.dirty);
    if (dis.length) {
      const r = await sb.from('healthlog_dismissals').upsert(
        dis.map(d => ({ user_id: uid, alert_key: d.key, alert_date: d.date })),
        { onConflict: 'user_id,alert_key,alert_date', ignoreDuplicates: true });
      if (r.error) throw r.error;
    }
    return { ok: true, log: await pullLog(sb, uid) };
  } catch (e) {
    return { ok: false, msg: (e && e.message) || String(e) };
  }
}

// Server copy + anything dirty in the live state that this sync did not send
// (changed while it was in flight). Mutations always make new objects, so an
// item identical to the one in `sent` is now on the server.
export function rebase(server, live, sent) {
  const keep = (srv, loc, was, key) => {
    const old = new Set(was || []);
    const dirty = (loc || []).filter(x => x.dirty && !old.has(x));
    const ids = new Set(dirty.map(x => x[key]));
    return [...dirty, ...srv.filter(x => !ids.has(x[key]))];
  };
  return {
    symptoms: keep(server.symptoms, live.symptoms, sent.symptoms, 'id'),
    remedies: keep(server.remedies, live.remedies, sent.remedies, 'id'),
    dismissals: keep(server.dismissals, live.dismissals, sent.dismissals, 'key')
  };
}

// Everything of this user's in the log tables. Hub-flag events have no rule
// to cascade from, so events are deleted directly.
export async function deleteAll(sb, uid) {
  for (const t of ['healthlog_food_remedies', 'healthlog_symptoms', 'healthlog_dismissals', 'healthlog_alert_events', 'healthlog_alert_rules']) {
    const r = await sb.from(t).delete().eq('user_id', uid);
    if (r.error) throw r.error;
  }
  resetLog();
}

// ---------- view model (same bindings on desktop and mobile) ----------
// `c` is the page component: c.state.{log, logForm, lf, lfErr, helpHours, logDays},
// c.setState, c.saveLog(log), c.M (healthlog-data.js).
export function logVals(c) {
  const st = c.state, log = st.log || emptyLog(), now = new Date();
  const today = dayKey(now);
  const lf = st.lf || {};
  const set = patch => c.setState({ lf: { ...lf, ...patch }, lfErr: '' });
  const tone = yes => ({
    bg: yes ? 'linear-gradient(135deg,var(--hl-h1),var(--hl-h1d))' : 'transparent',
    col: yes ? '#ffffff' : 'var(--hl-label)',
    bd: yes ? 'transparent' : 'var(--hl-line)'
  });
  const pillTone = {
    warn: ['#c2410c', '#ea580c'], good: ['var(--hl-h3d)', '#16a34a'], some: ['#b45309', '#d97706'],
    info: ['#1d4ed8', '#2563eb'], muted: ['var(--hl-label)', '#64748b']
  };
  const open = openSymptoms(log);

  const inbox = inboxItems(log, now, warningItems(log, st.warn)).map(it => {
    if (it.type === 'warning') {
      return {
        ...it, icon: '🌤️', isHelp: false, isWarning: true,
        lines: it.lines.map((text, i) => ({ text, key: 'l' + i })),
        onDismiss: () => c.saveLog(dismiss(c.state.log, it.key, it.runDate))
      };
    }
    const r = it.remedy, hrs = (st.helpHours || {})[r.id] ?? '';
    const answer = eff => c.saveLog(answerRemedy(c.state.log, r.id, eff, (c.state.helpHours || {})[r.id]));
    return {
      ...it, icon: '🍵', isHelp: true, isWarning: false, lines: [],
      hours: hrs,
      onHours: e => c.setState({ helpHours: { ...(c.state.helpHours || {}), [r.id]: e.target.value } }),
      answers: ANSWERS.map(a => ({ label: a.label, onPick: () => answer(a.effect) })),
      onSkip: () => c.saveLog(skipRemedy(c.state.log, r.id))
    };
  });

  const days = st.logDays || 30;
  const tl = timeline(log, st.visits, days).map(g => ({
    ...g,
    items: g.items.map(i => {
      const t = pillTone[i.tone] || pillTone.info;
      return {
        ...i,
        hasPill: !!i.pill,
        pillCol: t[0], pillBg: 'color-mix(in srgb,' + t[1] + ' 12%,transparent)',
        canEnd: i.type === 'symptom' && !!i.open,
        canDelete: i.type === 'symptom' || i.type === 'remedy',
        onEnd: () => c.saveLog(endSymptom(c.state.log, i.id, today)),
        onDelete: () => {
          if (c.state.confirmLogDel !== i.id) { c.setState({ confirmLogDel: i.id }); return; }
          c.setState({ confirmLogDel: '' });
          c.saveLog(i.type === 'symptom' ? removeSymptom(c.state.log, i.id) : removeRemedy(c.state.log, i.id));
        },
        delLabel: st.confirmLogDel === i.id ? 'Delete?' : '🗑'
      };
    })
  }));

  const openForm = kind => c.setState({
    logForm: kind, lfErr: '',
    lf: kind === 'symptom'
      ? { symptom: '', startedOn: today, severity: 'mild', fever: false, notes: '' }
      : { name: '', kind: 'dish', symptomId: open.length ? open[0].id : '', takenOn: today, takenAt: nowHHMM(now), placeName: '', notes: '' }
  });
  const save = () => {
    if (st.logForm === 'symptom') {
      if (!(lf.symptom || '').trim()) { c.setState({ lfErr: 'What are you feeling? Add a word or two.' }); return; }
      if (!lf.startedOn) { c.setState({ lfErr: 'Pick the day it started.' }); return; }
      c.saveLog(addSymptom(c.state.log, lf));
    } else {
      if (!(lf.name || '').trim()) { c.setState({ lfErr: 'What did you have? Add its name.' }); return; }
      if (!lf.takenOn) { c.setState({ lfErr: 'Pick the day you had it.' }); return; }
      c.saveLog(addRemedy(c.state.log, lf));
    }
    c.setState({ logForm: '', lf: {}, lfErr: '' });
  };
  const symOpts = [{ id: '', label: 'None' }, ...open.map(s => ({ id: s.id, label: s.symptom }))];

  return {
    inbox, inboxCount: inbox.length, hasInbox: inbox.length > 0, noInbox: inbox.length === 0,
    inboxBannerText: inbox.length === 1 ? '1 thing is waiting for you' : inbox.length + ' things are waiting for you',
    openSymptomsLabel: open.length ? 'Open: ' + open.map(s => s.symptom).join(', ') : 'No open symptoms',
    logTimeline: tl, logEmpty: tl.length === 0,
    logMoreLabel: 'Show ' + (days + 60) + ' days',
    onLogMore: () => c.setState({ logDays: days + 60 }),
    onAddSymptom: () => openForm('symptom'),
    onAddRemedy: () => openForm('remedy'),
    logFormOpen: !!st.logForm,
    logFormSymptom: st.logForm === 'symptom',
    logFormRemedy: st.logForm === 'remedy',
    logFormTitle: st.logForm === 'symptom' ? 'Log a symptom' : 'Log a food remedy',
    onLogClose: () => c.setState({ logForm: '', lfErr: '' }),
    onLogSave: save,
    lfErr: st.lfErr || false,
    // symptom form
    lfSymptom: lf.symptom || '', onLfSymptom: e => set({ symptom: e.target.value }),
    lfStarted: lf.startedOn || '', onLfStarted: e => set({ startedOn: e.target.value }),
    lfSevBtns: SEVERITY.map(s => ({ label: s.charAt(0).toUpperCase() + s.slice(1), ...tone(lf.severity === s), onPick: () => set({ severity: lf.severity === s ? '' : s }) })),
    lfFeverBtn: { label: lf.fever ? '🌡 Fever: yes' : '🌡 Fever: no', ...tone(!!lf.fever), onPick: () => set({ fever: !lf.fever }) },
    lfNotes: lf.notes || '', onLfNotes: e => set({ notes: e.target.value }),
    // remedy form
    lfName: lf.name || '', onLfName: e => set({ name: e.target.value }),
    lfKindBtns: KINDS.map(k => ({ label: k.emoji + ' ' + k.label, ...tone(lf.kind === k.key), onPick: () => set({ kind: k.key }) })),
    lfSymBtns: symOpts.map(o => ({ label: o.label, ...tone((lf.symptomId || '') === o.id), onPick: () => set({ symptomId: o.id }) })),
    lfTakenOn: lf.takenOn || '', onLfTakenOn: e => set({ takenOn: e.target.value }),
    lfTakenAt: lf.takenAt || '', onLfTakenAt: e => set({ takenAt: e.target.value }),
    lfPlace: lf.placeName || '', onLfPlace: e => set({ placeName: e.target.value }),
    lfAskHint: (() => {
      if (st.logForm !== 'remedy' || !lf.takenOn) return '';
      const t = askAt({ takenOn: lf.takenOn, takenAt: lf.takenAt, createdAt: now.toISOString() });
      return t ? "We'll ask if it helped " + fmtWhen(t) + '.' : '';
    })()
  };
}
