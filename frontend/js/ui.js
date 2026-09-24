// ==========================================================================
// CivicPulse - shared UI helpers
// ==========================================================================

function toast(message, type = 'info') {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function alertHtml(message, type = 'error') {
  return `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

const STATUS_LABELS = {
  pending: 'Pending',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  verified: 'Verified'
};
const CATEGORY_LABELS = {
  garbage: 'Garbage / waste',
  pothole: 'Pothole',
  streetlight: 'Streetlight',
  water_leakage: 'Water leakage',
  drainage: 'Drainage',
  electrical_hazard: 'Electrical hazard',
  road_damage: 'Road damage',
  encroachment: 'Encroachment',
  stray_animals: 'Stray animals',
  other: 'Other'
};
const STATUS_MAP_COLOR = {
  pending: '#5B6672',
  assigned: '#2C63C7',
  in_progress: '#6B4FBB',
  resolved: '#C6821E',
  verified: '#2F8F5B'
};

function statusChip(status) {
  return `<span class="chip chip-${status}">${STATUS_LABELS[status] || status}</span>`;
}
function priorityChip(level) {
  const cls = (level || 'low').toLowerCase();
  return `<span class="chip chip-${cls}">${level || 'Low'}</span>`;
}
function categoryLabel(cat) { return CATEGORY_LABELS[cat] || cat; }

// Weather ML risk chip — shows the live-forecast-driven priority boost
function weatherChip(weatherRisk) {
  if (!weatherRisk || !weatherRisk.label || weatherRisk.label === 'Unknown') return '';
  const cls = weatherRisk.label.toLowerCase(); // low | elevated | high
  const icon = weatherRisk.label === 'High' ? '⛈️' : weatherRisk.label === 'Elevated' ? '🌧️' : '🌤️';
  return `<span class="chip chip-weather-${cls}" title="Weather risk score ${weatherRisk.riskScore ?? ''}">${icon} Weather: ${weatherRisk.label}</span>`;
}

// Recurring-location risk chip — flags a hotspot with repeat issues of the same type
function recurringChip(recurringRisk, recurringCount) {
  if (!recurringRisk || recurringRisk === 'Low') return '';
  return `<span class="chip chip-recurring-${recurringRisk.toLowerCase()}" title="${recurringCount || 0} similar nearby report(s)">🔁 Recurring: ${recurringRisk}</span>`;
}

// ---- Disaster prevention: severity chip + weather-code icon helpers ----
const SEVERITY_CLASS = { None: 'low', Watch: 'medium', Warning: 'high', Severe: 'critical' };
function severityChip(severity) {
  const cls = SEVERITY_CLASS[severity] || 'low';
  return `<span class="chip chip-${cls}">${severity}</span>`;
}
const HAZARD_ICON = { flood: '🌊', heatwave: '🌡️', storm: '🌪️' };
function hazardIcon(type) { return HAZARD_ICON[type] || '⚠️'; }

// Open-Meteo WMO weather codes -> a simple emoji for the forecast strip
function weatherCodeIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌦️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code >= 95) return '⛈️';
  return '🌥️';
}

function formatDayLabel(dateStr, index) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function scoreBadgeHtml(score, level) {
  return `<div class="score-badge" title="Priority score"><span class="n">${score ?? '-'}</span><span class="l">${level || ''}</span></div>`;
}

// Simple file-input "drop zone" wiring: click zone -> opens file input, shows filename when chosen.
function wireFileDrop(dropId, inputId) {
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  if (!drop || !input) return;
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) {
      drop.textContent = `✓ ${input.files[0].name}`;
      drop.classList.add('has-file');
    } else {
      drop.textContent = 'Click to add a photo';
      drop.classList.remove('has-file');
    }
  });
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
