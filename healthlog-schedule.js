// HealthLog — dose scheduling engine.
// Per-medicine clock times, interval rules (daily / every-N-days / weekly),
// pack-quantity tracking, 48h auto-skip, and month-calendar cells.
//
// Medicine shape (all scheduling fields optional — sensible fallbacks):
//   { name, dose, slots:['morning'], days:30,
//     times:['09:00','15:00','21:00'],   // per-application clock times
//     rule:'daily'|'everyN'|'weekly', everyN:2, weekdays:[1],
//     qty:10 }                            // prescribed pack count, null for creams

export const SLOT_TIME = { morning: '08:00', noon: '13:00', evening: '18:00', night: '21:00' };
export const GRACE_MIN = 120;      // after this a due dose reads as missed
export const AUTOSKIP_HOURS = 48;  // untouched doses auto-skip, but stay overridable
export const REFILL_AT = 2;        // warn when this many doses remain in the pack
export const PRESS_MS = 600;       // long-press to untick

const DAY_MS = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toMin(hhmm) {
  const p = String(hhmm || '08:00').split(':');
  return (+p[0] || 0) * 60 + (+p[1] || 0);
}
export function fmtTime(hhmm) {
  const m = toMin(hhmm), h = Math.floor(m / 60), mm = m % 60;
  return (h % 12 === 0 ? 12 : h % 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
export function splitTime(hhmm) {
  const m = toMin(hhmm), h = Math.floor(m / 60), mm = m % 60;
  return { clock: (h % 12 === 0 ? 12 : h % 12) + ':' + String(mm).padStart(2, '0'), ampm: h >= 12 ? 'PM' : 'AM' };
}
export function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d + 'T00:00:00');
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY_MS);
}
export function weekdayName(dateStr) { return WD[new Date(dateStr + 'T00:00:00').getDay()]; }
export function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function medTimes(med) {
  return medSchedule(med).map(s => s.time);
}

// Time + the slot it came from, so dose keys stay identical to the ones the
// Home and Schedule screens write (visitId-medIndex-slot). Explicitly timed
// medicines (from the prescription import) have no slot and key by HHMM.
export function medSchedule(med) {
  if (med.times && med.times.length) {
    return med.times.slice()
      .sort((a, b) => toMin(a) - toMin(b))
      .map(t => ({ time: t, slot: null, id: String(t).replace(':', '') }));
  }
  return (med.slots && med.slots.length ? med.slots : ['morning'])
    .map(s => ({ time: SLOT_TIME[s] || '08:00', slot: s, id: s }))
    .sort((a, b) => toMin(a.time) - toMin(b.time));
}
export function medRule(med) {
  if (med.rule) return med.rule;
  if (+med.everyN > 1) return 'everyN';
  if (med.weekdays && med.weekdays.length) return 'weekly';
  return 'daily';
}
export function ruleLabel(med) {
  const r = medRule(med);
  if (r === 'everyN') return 'Every ' + (+med.everyN === 2 ? 'other day' : (+med.everyN) + ' days');
  if (r === 'weekly') return (med.weekdays || [1]).map(i => WD[i]).join(', ') + ' only';
  return 'Daily';
}

// How many doses of this medicine have ever been ticked (drives the pack count).
export function takenCount(taken, visitId, medIndex) {
  return takenBefore(taken, visitId, medIndex, null);
}

// Doses ticked strictly BEFORE dateStr (null = all time). Rendering a past day
// must not be affected by pills taken after it, or finished courses erase their
// own history.
export function takenBefore(taken, visitId, medIndex, dateStr) {
  const prefix = visitId + '-' + medIndex + '-';
  let n = 0;
  Object.keys(taken || {}).forEach(date => {
    if (dateStr && date >= dateStr) return;
    const day = taken[date] || {};
    Object.keys(day).forEach(k => { if (day[k] && k.indexOf(prefix) === 0) n++; });
  });
  return n;
}

export function lastTakenDate(taken, visitId, medIndex) {
  const prefix = visitId + '-' + medIndex + '-';
  let last = null;
  Object.keys(taken || {}).forEach(date => {
    const day = taken[date] || {};
    if (Object.keys(day).some(k => day[k] && k.indexOf(prefix) === 0)) {
      if (!last || date > last) last = date;
    }
  });
  return last;
}

// "Pack lasts longer": a qty course runs until the pills are gone, so a missed
// dose pushes the end out rather than burning a pill.
export function courseOver(med, start, dateStr, takenSoFar) {
  if (+med.qty > 0) return takenSoFar >= +med.qty;
  return daysBetween(start, dateStr) >= (+med.days || 1);
}
export function courseEndLabel(med, start, takenSoFar) {
  if (+med.qty > 0) {
    const left = Math.max(0, +med.qty - takenSoFar);
    const perDue = medTimes(med).length;
    const r = medRule(med);
    const everyDays = r === 'everyN' ? (+med.everyN || 2) : r === 'weekly' ? 7 : 1;
    return { left: left, days: Math.ceil(left / perDue) * everyDays };
  }
  return { left: null, days: Math.max(0, (+med.days || 1) - daysBetween(start, dayKey(new Date()))) };
}

export function dueOn(med, start, dateStr) {
  const off = daysBetween(start, dateStr);
  if (off < 0) return false;
  const r = medRule(med);
  if (r === 'everyN') return off % (+med.everyN || 2) === 0;
  if (r === 'weekly') return (med.weekdays || [1]).indexOf(new Date(dateStr + 'T00:00:00').getDay()) >= 0;
  return true;
}

// Every dose scheduled on dateStr, in clock order.
export function dosesForDay(visits, dateStr, taken) {
  const out = [];
  (visits || []).forEach(v => {
    (v.meds || []).forEach((med, mi) => {
      const before = takenBefore(taken, v.id, mi, dateStr);
      if (courseOver(med, v.date, dateStr, before)) return;
      if (!dueOn(med, v.date, dateStr)) return;
      const sched = medSchedule(med);
      sched.forEach((s, ti) => {
        out.push({
          key: v.id + '-' + mi + '-' + s.id,
          visitId: v.id, medIndex: mi, med: med, time: s.time, slot: s.slot, min: toMin(s.time),
          name: med.name, dose: med.dose || '', clinic: v.clinic,
          seq: sched.length > 1 ? (ti + 1) + ' of ' + sched.length + ' today' : '',
          qtyLeft: +med.qty > 0 ? Math.max(0, +med.qty - before) : null
        });
      });
    });
  });
  return out.sort((a, b) => a.min - b.min || a.name.localeCompare(b.name));
}

// State of one dose: taken | due | missed | autoskip | upcoming
export function doseState(dose, dateStr, taken, now) {
  const day = (taken || {})[dateStr] || {};
  if (day[dose.key]) return 'taken';
  const nowDate = dayKey(now);
  const ageH = (now - new Date(dateStr + 'T00:00:00')) / 3600000 - dose.min / 60;
  if (dateStr < nowDate && ageH > AUTOSKIP_HOURS) return 'autoskip';
  if (dateStr < nowDate) return 'missed';
  if (dateStr > nowDate) return 'upcoming';
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin > dose.min + GRACE_MIN) return 'missed';
  if (nowMin >= dose.min) return 'due';
  return 'upcoming';
}

// Doses bundled by clock time — the Today screen's hour blocks.
export function timeBlocks(doses, dateStr, taken, now) {
  const times = [];
  doses.forEach(d => { if (times.indexOf(d.time) < 0) times.push(d.time); });
  return times.map(t => {
    const items = doses.filter(d => d.time === t).map(d => ({ ...d, state: doseState(d, dateStr, taken, now) }));
    const done = items.filter(i => i.state === 'taken').length;
    const missed = items.filter(i => i.state === 'missed' || i.state === 'autoskip').length;
    const due = items.some(i => i.state === 'due');
    return {
      time: t, ...splitTime(t), items,
      done: done, missed: missed, total: items.length,
      settled: done + missed === items.length,     // collapse candidates
      status: due ? 'due' : missed ? 'missed' : done === items.length ? 'done' : 'upcoming'
    };
  });
}

// Month grid: one cell per day, dots coloured by outcome, capped at 4 + overflow.
export function monthCells(visits, monthDateStr, taken, now, cap) {
  const limit = cap || 4;
  const first = new Date(monthDateStr + 'T00:00:00');
  first.setDate(1);
  const startPad = first.getDay();
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const nowKey = dayKey(now);
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push({ blank: true, key: 'pad' + i });
  for (let d = 1; d <= daysIn; d++) {
    const ds = dayKey(new Date(first.getFullYear(), first.getMonth(), d));
    const doses = dosesForDay(visits, ds, taken);
    const dots = doses.map(x => doseState(x, ds, taken, now));
    cells.push({
      key: ds, date: ds, day: d, blank: false,
      isToday: ds === nowKey, isFuture: ds > nowKey,
      dots: dots.slice(0, limit),
      overflow: dots.length > limit ? dots.length - limit : 0,
      total: dots.length
    });
  }
  return cells;
}

// Stacked Today alerts: refill, stop-date, finished course, follow-up.
// "Finished" only fires while the ending is still news (FINISHED_WINDOW days),
// otherwise every prescription in the history would alert forever.
export const FINISHED_WINDOW = 2;

export function alertsFor(visits, dateStr, taken, now, dismissed) {
  const out = [];
  const dz = dismissed || {};
  (visits || []).forEach(v => {
    (v.meds || []).forEach((med, mi) => {
      const seen = takenCount(taken, v.id, mi);
      const id = v.id + '-' + mi;
      if (+med.qty > 0) {
        const left = +med.qty - seen;
        if (left > 0 && left <= REFILL_AT) {
          out.push({ id: 'refill-' + id, kind: 'refill', icon: '💊', title: med.name + ' — ' + left + (left === 1 ? ' dose' : ' doses') + ' left', sub: 'Pack of ' + med.qty + ' · reorder soon' });
        }
        if (left <= 0) {
          const last = lastTakenDate(taken, v.id, mi);
          const age = last ? daysBetween(last, dateStr) : 999;
          if (age >= 0 && age <= FINISHED_WINDOW) {
            out.push({ id: 'done-' + id, kind: 'finished', icon: '✅', title: med.name + ' course finished', sub: 'All ' + med.qty + ' taken — stop as prescribed' });
          }
        }
      } else {
        const end = addDays(v.date, +med.days || 1);
        const leftDays = daysBetween(dateStr, end);
        if (leftDays <= 0 && leftDays >= -FINISHED_WINDOW) {
          out.push({ id: 'done-' + id, kind: 'finished', icon: '✅', title: med.name + ' course finished', sub: (+med.days) + ' days done on ' + fmtDate(end) + ' — stop as prescribed' });
        } else if (leftDays > 0 && leftDays <= 2) {
          out.push({ id: 'stop-' + id, kind: 'stop', icon: '🛑', title: med.name + ' stops in ' + leftDays + (leftDays === 1 ? ' day' : ' days'), sub: 'Last dose ' + fmtDate(end) + ' — do not continue' });
        }
      }
      if (medRule(med) === 'weekly' && !dueOn(med, v.date, dateStr) && !courseOver(med, v.date, dateStr, seen)) {
        let n = 1;
        while (n <= 7 && !dueOn(med, v.date, addDays(dateStr, n))) n++;
        if (n <= 7) out.push({ id: 'next-' + id, kind: 'next', icon: '📅', title: med.name + ' due ' + (n === 1 ? 'tomorrow' : weekdayName(addDays(dateStr, n))), sub: ruleLabel(med) + ' · ' + fmtTime(medTimes(med)[0]) });
      }
    });
    if (v.followUp) {
      const left = daysBetween(dateStr, v.followUp);
      if (left >= 0 && left <= 7) out.push({ id: 'fu-' + v.id, kind: 'followup', icon: '🗓', title: 'Follow-up ' + (left === 0 ? 'today' : left === 1 ? 'tomorrow' : 'in ' + left + ' days'), sub: (v.clinic || v.doctor || 'Clinic visit') + ' · ' + fmtDate(v.followUp) });
    }
  });
  return out.filter(a => !dz[a.id + '|' + dateStr]);
}

// One-time catch-up offer: every due dose from course start to yesterday,
// running courses only (finished ones stay blank).
export function backfillPlan(visits, dateStr, taken) {
  const plan = [];
  (visits || []).forEach(v => {
    (v.meds || []).forEach((med, mi) => {
      const seen = takenCount(taken, v.id, mi);
      if (courseOver(med, v.date, dateStr, seen)) return;
      let d = v.date;
      while (d < dateStr) {
        if (dueOn(med, v.date, d)) {
          medSchedule(med).forEach(s => {
            const key = v.id + '-' + mi + '-' + s.id;
            if (!((taken || {})[d] || {})[key]) plan.push({ date: d, key: key });
          });
        }
        d = addDays(d, 1);
      }
    });
  });
  return plan;
}
