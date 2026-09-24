// ==========================================================================
// CivicPulse - Weather forecasting & disaster prevention
// ==========================================================================
// Shared rendering logic used by the landing banner, the public portal's
// "Weather & disaster alerts" tab, and the government portal's "Disaster
// prevention" dashboard. All three pull from the same /api/disaster
// endpoints; this module just formats the response differently per
// audience (citizens get a heads-up + safety framing, officials get
// actionable zones + a map).
// ==========================================================================
const DisasterPrevention = (() => {
  let govDisasterMap;

  function init() {
    const pvBtn = document.getElementById('btn-refresh-pv-disaster');
    if (pvBtn) pvBtn.addEventListener('click', renderPublic);
    const govBtn = document.getElementById('btn-refresh-gov-disaster');
    if (govBtn) govBtn.addEventListener('click', renderGov);
  }

  // ---------------- Shared banner ----------------
  function bannerHtml(worst, contextLine) {
    if (!worst) {
      return `<div class="disaster-banner disaster-banner-none">✅ No flood, heatwave, or storm hazards forecast for the next 3 days.${contextLine ? ` ${contextLine}` : ''}</div>`;
    }
    const cls = { Watch: 'watch', Warning: 'warning', Severe: 'severe' }[worst.severity] || 'watch';
    const dayLabel = worst.date ? new Date(worst.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) : '';
    return `<div class="disaster-banner disaster-banner-${cls}">
      <span class="db-icon">${hazardIcon(worst.type)}</span>
      <div>
        <div class="db-title">${escapeHtml(worst.severity)} — ${escapeHtml(dayLabel)}</div>
        <div class="db-msg">${escapeHtml(worst.message)}</div>
      </div>
    </div>`;
  }

  // ---------------- Shared forecast strip ----------------
  function forecastStripHtml(days) {
    if (!days || !days.length) {
      return '<p class="field-hint">Forecast temporarily unavailable (offline or provider unreachable). Complaint-based risk detection still works.</p>';
    }
    return days.map((d, i) => `
      <div class="forecast-day">
        <div class="fd-label">${formatDayLabel(d.date, i)}</div>
        <div class="fd-icon">${weatherCodeIcon(d.weatherCode)}</div>
        <div class="fd-temp">${Math.round(d.maxTempC)}° / ${Math.round(d.minTempC)}°</div>
        <div class="fd-precip">💧 ${Math.round(d.precipProbability)}% · ${d.precipMm.toFixed(0)}mm</div>
        <div class="fd-wind">🌬️ ${Math.round(d.maxWindKph)} km/h</div>
        <div class="fd-chips">${d.alerts.length ? d.alerts.map((a) => `<span class="chip chip-${SEVERITY_CLASS[a.severity]}" title="${escapeHtml(a.message)}">${hazardIcon(a.type)} ${escapeHtml(a.severity)}</span>`).join('') : '<span class="chip chip-verified">Clear</span>'}</div>
      </div>`).join('');
  }

  // ---------------- Public portal ----------------
  async function renderPublic() {
    const bannerEl = document.getElementById('pv-disaster-banner');
    const forecastEl = document.getElementById('pv-disaster-forecast');
    const zonesEl = document.getElementById('pv-disaster-zones');
    if (!bannerEl) return;
    bannerEl.innerHTML = '<p>Loading…</p>';
    forecastEl.innerHTML = '<p>Loading…</p>';
    zonesEl.innerHTML = '<p>Loading…</p>';
    try {
      const [forecast, zonesData] = await Promise.all([Api.disasterForecast(), Api.disasterRiskZones()]);
      const worst = forecast.available ? findWorstAlert(forecast.days) : null;
      bannerEl.innerHTML = forecast.available
        ? bannerHtml(worst, worst ? 'Consider reporting blocked drains or exposed hazards near you now, while there\'s time to fix them.' : '')
        : `<div class="alert alert-info">${escapeHtml(forecast.message || 'Forecast unavailable right now.')}</div>`;
      forecastEl.innerHTML = forecastStripHtml(forecast.days);

      if (!zonesData.zones.length) {
        zonesEl.innerHTML = '<div class="empty-state"><div class="icon">🛡️</div><p>No nearby locations currently flagged as at-risk.</p></div>';
      } else {
        zonesEl.innerHTML = zonesData.zones.slice(0, 8).map(zoneCardHtml).join('');
      }
    } catch (err) {
      bannerEl.innerHTML = alertHtml(err.message);
      forecastEl.innerHTML = '';
      zonesEl.innerHTML = '';
    }
  }

  // ---------------- Government portal ----------------
  async function renderGov() {
    const bannerEl = document.getElementById('gov-disaster-banner');
    const forecastEl = document.getElementById('gov-disaster-forecast');
    const zonesEl = document.getElementById('gov-disaster-zones');
    if (!bannerEl) return;
    bannerEl.innerHTML = '<p>Loading…</p>';
    forecastEl.innerHTML = '<p>Loading…</p>';
    zonesEl.innerHTML = '<p>Loading…</p>';
    try {
      const [forecast, zonesData] = await Promise.all([Api.disasterForecast(), Api.disasterRiskZones()]);
      const worst = forecast.available ? findWorstAlert(forecast.days) : null;
      bannerEl.innerHTML = forecast.available
        ? bannerHtml(worst, worst ? 'Review at-risk zones below and dispatch crews before the hazard window.' : '')
        : `<div class="alert alert-info">${escapeHtml(forecast.message || 'Forecast unavailable right now.')}</div>`;
      forecastEl.innerHTML = forecastStripHtml(forecast.days);

      if (!zonesData.zones.length) {
        zonesEl.innerHTML = '<div class="empty-state"><div class="icon">🛡️</div><p>No at-risk zones detected for the current forecast window.</p></div>';
      } else {
        zonesEl.innerHTML = zonesData.zones.map(zoneCardHtml).join('');
      }
      renderGovMap(zonesData.zones);
    } catch (err) {
      bannerEl.innerHTML = alertHtml(err.message);
      forecastEl.innerHTML = '';
      zonesEl.innerHTML = '';
    }
  }

  function renderGovMap(zones) {
    const mapEl = document.getElementById('gov-disaster-map');
    if (!mapEl) return;
    if (typeof L === 'undefined') { Main.mapUnavailable('gov-disaster-map'); return; }
    if (!govDisasterMap) {
      govDisasterMap = L.map('gov-disaster-map').setView([13.0827, 80.2707], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(govDisasterMap);
    }
    govDisasterMap.eachLayer((l) => { if (l instanceof L.CircleMarker) govDisasterMap.removeLayer(l); });
    const SEVERITY_COLOR = { Watch: '#2C63C7', Warning: '#C6821E', Severe: '#C4432B' };
    zones.forEach((z) => {
      L.circleMarker([z.lat, z.lng], {
        radius: 8 + Math.min(z.relatedComplaints, 6),
        color: '#fff',
        weight: 1.5,
        fillColor: SEVERITY_COLOR[z.severity] || '#5B6672',
        fillOpacity: 0.85
      }).bindPopup(`${hazardIcon(z.hazard)} <b>${escapeHtml(z.name)}</b><br>${escapeHtml(z.severity)} · ${z.relatedComplaints} related report(s)<br>${escapeHtml(z.recommendation)}`).addTo(govDisasterMap);
    });
    setTimeout(() => govDisasterMap.invalidateSize(), 50);
  }

  function zoneCardHtml(z) {
    const kindLabel = { school: '🏫 School', hospital: '🏥 Hospital', hotspot: '📍 Complaint hotspot' }[z.kind] || z.kind;
    return `
      <div class="complaint-card" style="margin-bottom:12px">
        <div class="complaint-top">
          <div style="flex:1">
            <div class="complaint-title">${hazardIcon(z.hazard)} ${escapeHtml(z.name)}</div>
            <div class="complaint-meta">
              ${severityChip(z.severity)}
              <span>${kindLabel}</span>
              <span>${z.relatedComplaints} related report${z.relatedComplaints === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
        <div class="complaint-desc">${escapeHtml(z.recommendation)}</div>
      </div>`;
  }

  // ---------------- Landing banner (public, unauthenticated) ----------------
  async function renderLandingBanner() {
    const el = document.getElementById('landing-disaster-alert');
    if (!el) return;
    try {
      const { available, worst } = await Api.disasterAlerts();
      if (!available || !worst) { el.classList.add('hidden'); el.innerHTML = ''; return; }
      const cls = { Watch: 'watch', Warning: 'warning', Severe: 'severe' }[worst.severity] || 'watch';
      const dayLabel = worst.date ? new Date(worst.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      el.innerHTML = `<div class="landing-banner landing-banner-${cls}">
        ${hazardIcon(worst.type)} <b>${escapeHtml(worst.severity)}:</b> ${escapeHtml(worst.message)} <span style="opacity:0.75">(${escapeHtml(dayLabel)})</span>
      </div>`;
      el.classList.remove('hidden');
    } catch (err) {
      el.classList.add('hidden');
    }
  }

  // ---------------- Helpers ----------------
  function findWorstAlert(days) {
    let worst = null;
    days.forEach((d) => d.alerts.forEach((a) => {
      const rank = { Watch: 1, Warning: 2, Severe: 3 };
      if (!worst || rank[a.severity] > rank[worst.severity]) worst = { ...a, date: d.date };
    }));
    return worst;
  }

  return { init, renderPublic, renderGov, renderLandingBanner };
})();
