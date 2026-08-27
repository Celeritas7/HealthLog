// HealthLog — shared data + schedule logic
const SYM = { USD: '$', INR: '₹', EUR: '€' };
const pad = n => String(n).padStart(2, '0');
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function todayISO() { return isoOf(new Date()); }
function shift(n) { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); }
function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

export const SLOTS = [
  { key: 'morning', label: 'Morning', emoji: '🌅', time: '8:00 AM' },
  { key: 'noon', label: 'Noon', emoji: '☀️', time: '1:00 PM' },
  { key: 'evening', label: 'Evening', emoji: '🌆', time: '6:00 PM' },
  { key: 'night', label: 'Night', emoji: '🌙', time: '9:00 PM' }
];

export function fmtDate(s) { return toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
export function fmtDateShort(s) { return toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
export function fmtMoney(n, cur) { return (SYM[cur] || '$') + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
export function visitTotal(v) { const c = v.costs || {}; return (+c.consult || 0) + (+c.meds || 0) + (+c.other || 0); }

export function medRange(v, med) {
  const s = toDate(v.date); const e = new Date(s);
  e.setDate(e.getDate() + ((+med.days || 1) - 1));
  return { start: isoOf(s), end: isoOf(e) };
}

export function activeCourses(visits, dateStr) {
  const out = [];
  visits.forEach(v => (v.meds || []).forEach((med, i) => {
    const r = medRange(v, med);
    if (r.start <= dateStr && dateStr <= r.end) {
      const dayNum = Math.round((toDate(dateStr) - toDate(r.start)) / 86400000) + 1;
      const days = +med.days || 1;
      out.push({ visitId: v.id, clinic: v.clinic, med, medIndex: i, start: r.start, end: r.end, dayNum, days, daysLeft: days - dayNum, pct: Math.round(dayNum / days * 100) });
    }
  }));
  return out;
}

export function dosesForDate(visits, dateStr) {
  const out = [];
  activeCourses(visits, dateStr).forEach(c => (c.med.slots || []).forEach(slot => {
    out.push({ id: c.visitId + '-' + c.medIndex + '-' + slot, slot, name: c.med.name, dose: c.med.dose, clinic: c.clinic });
  }));
  const order = { morning: 0, noon: 1, evening: 2, night: 3 };
  return out.sort((a, b) => order[a.slot] - order[b.slot]);
}

export function monthlyTotals(visits, n) {
  n = n || 8; const now = new Date(); const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    const total = visits.filter(v => v.date.slice(0, 7) === key).reduce((s, v) => s + visitTotal(v), 0);
    out.push({ label: d.toLocaleDateString('en-US', { month: 'short' }), key, total });
  }
  return out;
}

export function clinicTotals(visits) {
  const map = {};
  visits.forEach(v => { map[v.clinic] = (map[v.clinic] || 0) + visitTotal(v); });
  return Object.keys(map).map(name => ({ name, total: map[name] })).sort((a, b) => b.total - a.total);
}

const KEY = 'healthlog-v1';
export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.visits) && d.visits.length) return d; }
  } catch (e) { }
  return { visits: sampleVisits(), taken: {} };
}
export function saveData(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { } }

export function sampleVisits() {
  return [
    {
      id: 'v1', date: shift(-6), clinic: 'CityCare Family Clinic', doctor: 'Dr. Meera Nair', concern: 'Sore throat & fever',
      notes: 'Strep test negative. Rest, fluids, and a 7-day antibiotic course.', followUp: shift(3),
      meds: [
        { name: 'Amoxicillin', dose: '500 mg', slots: ['morning', 'evening'], days: 8 },
        { name: 'Paracetamol', dose: '650 mg', slots: ['morning', 'noon', 'night'], days: 5 }
      ],
      costs: { consult: 40, meds: 22, other: 0 }
    },
    {
      id: 'v2', date: shift(-52), clinic: 'Lakeside Dental Studio', doctor: 'Dr. Tom Alvarez', concern: 'Tooth sensitivity',
      notes: 'Enamel wear on the lower molars. Fluoride gel nightly for a month.', followUp: '',
      meds: [{ name: 'Fluoride gel', dose: '1.1%', slots: ['night'], days: 30 }],
      costs: { consult: 120, meds: 18, other: 0 }
    },
    {
      id: 'v3', date: shift(-95), clinic: 'CityCare Family Clinic', doctor: 'Dr. Meera Nair', concern: 'Seasonal allergies',
      notes: 'Pollen allergy flare-up. Antihistamine at night for two weeks.', followUp: '',
      meds: [{ name: 'Cetirizine', dose: '10 mg', slots: ['night'], days: 14 }],
      costs: { consult: 40, meds: 12, other: 0 }
    },
    {
      id: 'v4', date: shift(-137), clinic: 'Vista Eye Center', doctor: 'Dr. Hannah Cho', concern: 'Annual eye exam',
      notes: 'Vision stable at 20/20. Next exam in a year.', followUp: '', meds: [],
      costs: { consult: 85, meds: 0, other: 0 }
    },
    {
      id: 'v5', date: shift(-177), clinic: 'CityCare Family Clinic', doctor: 'Dr. Raj Patel', concern: 'Lower back pain',
      notes: 'Muscle strain — X-ray clear. Daily stretching, plus Vitamin D for the deficiency flagged in the blood panel.', followUp: '',
      meds: [
        { name: 'Ibuprofen', dose: '400 mg', slots: ['morning', 'evening'], days: 10 },
        { name: 'Vitamin D3', dose: '1000 IU', slots: ['morning'], days: 200 }
      ],
      costs: { consult: 40, meds: 15, other: 60 }
    },
    {
      id: 'v6', date: shift(-212), clinic: 'Downtown Diagnostics', doctor: 'Dr. Alan Reyes', concern: 'Annual blood panel',
      notes: 'All markers in range except Vitamin D — slightly low.', followUp: '', meds: [],
      costs: { consult: 0, meds: 0, other: 150 }
    }
  ];
}

// Theme palettes — applied as CSS custom properties on :root
export const THEMES = {
  'Clinical Light': {
    bg: '#f7f9fb', rail: '#edf1f6', card: '#ffffff', hover: '#f0f4f8',
    text: '#16232e', label: '#5b7185', muted: '#93a5b5', line: '#e2e9f0',
    header: 'rgba(247,249,251,.94)', cardShadow: '0 4px 15px rgba(23,42,58,.06)',
    h1: '#0ea5a4', h1d: '#0f766e', g1: 'rgba(14,165,164,.30)',
    h2: '#2563eb', h2d: '#1d4ed8', g2: 'rgba(37,99,235,.30)',
    h3: '#16a34a', h3d: '#15803d', g3: 'rgba(22,163,74,.30)',
    h4: '#ea580c', h4d: '#c2410c', g4: 'rgba(234,88,12,.30)',
    dateFilter: 'none'
  },
  'Warm Cream': {
    bg: '#faf6ef', rail: '#f1ead9', card: '#fffdf8', hover: '#f5efe3',
    text: '#3a2f25', label: '#8a7a66', muted: '#b3a48e', line: '#e8dfcd',
    header: 'rgba(250,246,239,.94)', cardShadow: '0 4px 15px rgba(80,60,30,.07)',
    h1: '#e2604a', h1d: '#c74a36', g1: 'rgba(226,96,74,.30)',
    h2: '#b45309', h2d: '#92400e', g2: 'rgba(180,83,9,.30)',
    h3: '#65a30d', h3d: '#4d7c0f', g3: 'rgba(101,163,13,.30)',
    h4: '#be123c', h4d: '#9f1239', g4: 'rgba(190,18,60,.30)',
    dateFilter: 'none'
  },
  'Lavender Mist': {
    bg: '#f4f2fa', rail: '#eae7f4', card: '#ffffff', hover: '#efecf8',
    text: '#2a2438', label: '#6f6790', muted: '#a49dc0', line: '#e0dbef',
    header: 'rgba(244,242,250,.94)', cardShadow: '0 4px 15px rgba(60,45,110,.07)',
    h1: '#7c3aed', h1d: '#6d28d9', g1: 'rgba(124,58,237,.30)',
    h2: '#4f46e5', h2d: '#4338ca', g2: 'rgba(79,70,229,.30)',
    h3: '#0d9488', h3d: '#0f766e', g3: 'rgba(13,148,136,.30)',
    h4: '#db2777', h4d: '#be185d', g4: 'rgba(219,39,119,.30)',
    dateFilter: 'none'
  },
  'Ocean Teal': {
    bg: '#07171a', rail: '#0b2226', card: '#102c31', hover: '#163b41',
    text: '#e8f4f4', label: '#7fa8ab', muted: '#4d7276', line: '#1d444a',
    header: 'rgba(7,23,26,.94)', cardShadow: '0 4px 15px rgba(0,0,0,.25)',
    h1: '#2dd4bf', h1d: '#14b8a6', g1: 'rgba(45,212,191,.30)',
    h2: '#38bdf8', h2d: '#0ea5e9', g2: 'rgba(56,189,248,.30)',
    h3: '#4ade80', h3d: '#22c55e', g3: 'rgba(74,222,128,.30)',
    h4: '#fb923c', h4d: '#f97316', g4: 'rgba(251,146,60,.30)',
    dateFilter: 'invert(.55)'
  },
  'Midnight': {
    bg: '#0a0a0f', rail: '#12121a', card: '#1a1a25', hover: '#222230',
    text: '#f0f0f5', label: '#8888aa', muted: '#555566', line: '#2a2a3a',
    header: 'rgba(10,10,15,.94)', cardShadow: '0 4px 15px rgba(0,0,0,.2)',
    h1: '#8b5cf6', h1d: '#7c3aed', g1: 'rgba(139,92,246,.35)',
    h2: '#3b82f6', h2d: '#2563eb', g2: 'rgba(59,130,246,.35)',
    h3: '#22c55e', h3d: '#16a34a', g3: 'rgba(34,197,94,.35)',
    h4: '#f97316', h4d: '#ea580c', g4: 'rgba(249,115,22,.35)',
    dateFilter: 'invert(.55)'
  }
};
export function applyTheme(name) {
  const t = THEMES[name] || THEMES['Clinical Light'];
  const map = {
    bg: '--hl-bg', rail: '--hl-rail', card: '--hl-card', hover: '--hl-hover',
    text: '--hl-text', label: '--hl-label', muted: '--hl-muted', line: '--hl-line',
    header: '--hl-header', cardShadow: '--hl-card-shadow',
    h1: '--hl-h1', h1d: '--hl-h1d', g1: '--hl-g1',
    h2: '--hl-h2', h2d: '--hl-h2d', g2: '--hl-g2',
    h3: '--hl-h3', h3d: '--hl-h3d', g3: '--hl-g3',
    h4: '--hl-h4', h4d: '--hl-h4d', g4: '--hl-g4',
    dateFilter: '--hl-date-filter'
  };
  const rs = document.documentElement.style;
  Object.keys(map).forEach(k => rs.setProperty(map[k], t[k]));
  document.body.style.background = t.bg;
}
