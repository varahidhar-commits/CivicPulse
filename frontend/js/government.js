// ==========================================================================
// CivicPulse - Government portal
// ==========================================================================
const GovernmentPortal = (() => {
  let govMap, statusChart, categoryChart, regionChart, workersCache = [];

  function init() {
    document.querySelectorAll('#view-government [data-gv]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.gv));
    });
    document.getElementById('btn-refresh-gov').addEventListener('click', loadOverview);
    document.getElementById('btn-apply-gov-filter').addEventListener('click', loadComplaints);
  }

  function switchView(name) {
    document.querySelectorAll('#view-government [data-gv]').forEach((b) => b.classList.toggle('active', b.dataset.gv === name));
    ['overview', 'complaints', 'map', 'disaster', 'grievances', 'directory'].forEach((v) => {
      document.getElementById(`gv-${v}`).classList.toggle('hidden', v !== name);
    });
    if (name === 'overview') loadOverview();
    if (name === 'complaints') loadComplaints();
    if (name === 'map') loadGovMap();
    if (name === 'disaster') DisasterPrevention.renderGov();
    if (name === 'grievances') loadGrievances();
    if (name === 'directory') loadDirectory();
  }

  function welcomeText() {
    const u = Session.user;
    if (u) document.getElementById('gov-welcome').textContent = `Welcome, ${u.name.split('(')[0].trim()}`;
  }

  async function loadOverview() {
    welcomeText();
    try {
      const stats = await Api.stats();
      const kpis = document.getElementById('gov-kpis');
      kpis.innerHTML = [
        kpi('Total reports', stats.total, ''),
        kpi('Pending', stats.pending, 'Awaiting assignment'),
        kpi('In progress', stats.inProgress, 'Currently being worked'),
        kpi('Critical', stats.critical, 'Needs urgent attention'),
        kpi('Verified fixes', stats.verified, 'Confirmed by citizens'),
        kpi('Avg. resolution', `${stats.avgResolutionHours}h`, 'Report to resolve')
      ].join('');

      renderChart('chart-status', () => statusChart, (c) => statusChart = c, 'doughnut', Object.keys(stats.byStatus).map((k) => STATUS_LABELS[k] || k), Object.values(stats.byStatus), Object.keys(stats.byStatus).map((k) => STATUS_MAP_COLOR[k] || '#999'));
      renderChart('chart-category', () => categoryChart, (c) => categoryChart = c, 'bar', Object.keys(stats.byCategory).map(categoryLabel), Object.values(stats.byCategory), '#2C63C7');
      renderChart('chart-region', () => regionChart, (c) => regionChart = c, 'bar', Object.keys(stats.byRegion), Object.values(stats.byRegion), '#E8A33D', true);
      loadPriorityQueue();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadPriorityQueue() {
    const el = document.getElementById('priority-queue-list');
    if (!el) return;
    try {
      const { cases } = await Api.priorityQueue();
      if (!cases.length) {
        el.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>No pending cases. The dispatch queue is clear.</p></div>';
        return;
      }
      el.innerHTML = cases.map((c) => priorityQueueCard(c)).join('');
      cases.forEach((c) => {
        const button = document.getElementById(`cross-assign-${c.id}`);
        if (button) button.addEventListener('click', () => assignCrossArea(c.id));
      });
    } catch (err) {
      el.innerHTML = alertHtml(err.message);
    }
  }

  function priorityQueueCard(c) {
    const workers = c.crossAreaWorkers || [];
    const reward = c.crossAreaReward;
    const options = workers.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} — ${escapeHtml(w.region)} (${w.activeTasks} active)</option>`).join('');
    const weather = c.weatherRisk?.label || 'Forecast unavailable';
    const surroundings = c.nearSensitiveLocation
      ? `Near ${escapeHtml(c.nearestSensitiveLocation?.name || 'a sensitive location')}`
      : 'No sensitive site nearby';
    return `<div class="complaint-card priority-queue-item">
      <div class="complaint-top">
        <div class="queue-rank">#${c.rank}</div>
        <div style="flex:1">
          <div class="complaint-title">${escapeHtml(c.title)}</div>
          <div class="complaint-meta">
            ${priorityChip(c.priorityLevel)}
            <span><b>${c.priorityPercent}%</b> AI priority</span>
            <span>📍 ${escapeHtml(c.region || 'Central Zone')}</span>
            <span>🌦️ ${escapeHtml(weather)}</span>
            <span>🏥 ${surroundings}</span>
          </div>
        </div>
      </div>
      <div class="complaint-desc">${escapeHtml(c.description)}</div>
      <p class="field-hint">Tie handling: score → forecast risk → surroundings → longest waiting. ${c.priorityReasons?.map((r) => escapeHtml(r.detail)).join(' · ') || ''}</p>
      ${workers.length ? `<div class="cross-dispatch">
          <div><b>Cross-area assistance</b><br><span>${reward ? `On verified completion: +${reward.points} points and ₹${reward.bonusAmount} bonus.` : 'Available for dispatch; a cross-area bonus applies to High and Critical cases.'}</span></div>
          <div class="form-row" style="margin-top:8px"><select id="cross-worker-${c.id}">${options}</select><button class="btn btn-amber btn-sm" id="cross-assign-${c.id}">Dispatch with reward</button></div>
        </div>` : '<p class="field-hint">No registered worker from another service zone is currently available.</p>'}
    </div>`;
  }

  async function assignCrossArea(id) {
    const select = document.getElementById(`cross-worker-${id}`);
    if (!select?.value) return;
    try {
      await Api.assignComplaint(id, { workerId: select.value });
      toast('Cross-area worker dispatched with completion reward.', 'success');
      loadPriorityQueue();
      loadComplaints();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function kpi(label, value, sub) {
    return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
  }

  function renderChart(canvasId, getter, setter, type, labels, data, color, horizontal = false) {
    if (typeof Chart === 'undefined') {
      const canvas = document.getElementById(canvasId);
      if (canvas) canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'field-hint', textContent: 'Chart library unavailable (offline or CDN blocked).' }));
      return;
    }
    const existing = getter();
    if (existing) existing.destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    const chart = new Chart(ctx, {
      type,
      data: {
        labels,
        datasets: [{ label: 'Count', data, backgroundColor: Array.isArray(color) ? color : color, borderRadius: 6 }]
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        plugins: { legend: { display: type === 'doughnut' } },
        scales: type === 'doughnut' ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
    setter(chart);
  }

  async function ensureWorkers() {
    if (!workersCache.length) {
      const { workers } = await Api.workers();
      workersCache = workers;
    }
    return workersCache;
  }

  async function loadComplaints() {
    const el = document.getElementById('gov-complaints-list');
    el.innerHTML = '<p>Loading…</p>';
    const status = document.getElementById('gov-filter-status').value;
    const category = document.getElementById('gov-filter-category').value;
    const params = [];
    if (status) params.push(`status=${status}`);
    if (category) params.push(`category=${category}`);
    try {
      const [{ complaints }, workers] = await Promise.all([
        Api.listComplaints(params.length ? `?${params.join('&')}` : ''),
        ensureWorkers()
      ]);
      if (!complaints.length) { el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No complaints match these filters.</p></div>'; return; }
      el.innerHTML = complaints.map((c) => govComplaintCard(c, workers)).join('');
      complaints.forEach((c) => {
        const assignBtn = document.getElementById(`assign-btn-${c.id}`);
        if (assignBtn) assignBtn.addEventListener('click', () => assignComplaint(c.id));
      });
    } catch (err) {
      el.innerHTML = alertHtml(err.message);
    }
  }

  function govComplaintCard(c, workers) {
    const canAssign = c.status === 'pending';
    const workerOptions = workers.map((w) => `<option value="${w.id}">${escapeHtml(w.name)} — ${escapeHtml(w.region || '')}</option>`).join('');
    const assignBlock = canAssign ? `
      <div class="form-row" style="margin-top:10px">
        <select id="worker-select-${c.id}">${workerOptions || '<option disabled>No workers registered yet</option>'}</select>
        <button class="btn btn-primary btn-sm" id="assign-btn-${c.id}" ${workers.length ? '' : 'disabled'}>Assign &amp; dispatch</button>
      </div>` : '';
    const photos = [];
    if (c.photoBeforeUrl) photos.push(`<img src="${c.photoBeforeUrl}" alt="Before">`);
    if (c.photoAfterUrl) photos.push(`<img src="${c.photoAfterUrl}" alt="After">`);
    return `
      <div class="complaint-card">
        <div class="complaint-top">
          ${scoreBadgeHtml(c.priorityScore, c.priorityLevel)}
          <div style="flex:1">
            <div class="complaint-title">${escapeHtml(c.title)}</div>
            <div class="complaint-meta">
              ${statusChip(c.status)} ${priorityChip(c.priorityLevel)} ${weatherChip(c.weatherRisk)} ${recurringChip(c.recurringRisk, c.recurringCount)}
              <span>${categoryLabel(c.category)}</span>
              <span>Reported by ${escapeHtml(c.reporterName)} · ${timeAgo(c.createdAt)}</span>
              <span>👍 ${c.confirmationsCount}</span>
              ${c.nearSensitiveLocation ? `<span>🏫 Near ${escapeHtml(c.nearestSensitiveLocation?.name || '')}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="complaint-desc">${escapeHtml(c.description)}</div>
        ${c.recurringRisk && c.recurringRisk !== 'Low' ? `
  <div style="
    margin-top:10px;
    padding:10px 12px;
    border-radius:8px;
    background:#fff3cd;
    border-left:4px solid #ff9800;
  ">
    🔁 <b>Recurring Issue Risk: ${escapeHtml(c.recurringRisk)}</b><br>
    <span style="font-size:13px;">
      ${c.recurringCount || 0} similar previous issue(s) detected near this location.
    </span>
  </div>
` : ''}

${c.priorityReasons?.length ? `
  <div style="
    margin-top:10px;
    padding:10px 12px;
    border-radius:8px;
    background:#eef5ff;
  ">
    <b>🤖 Why AI gave this priority</b>
    <div style="margin-top:6px;font-size:13px;">
      ${c.priorityReasons.map(r =>
        `• ${escapeHtml(r.detail)} (+${r.points})`
      ).join('<br>')}
    </div>
  </div>
` : ''}
        ${c.address ? `<p class="field-hint">📍 ${escapeHtml(c.address)} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})</p>` : ''}
        ${photos.length ? `<div class="complaint-photos">${photos.join('')}</div>` : ''}
        ${c.assignedWorkerName ? `<p class="field-hint">Assigned to <b>${escapeHtml(c.assignedWorkerName)}</b> · ${escapeHtml(c.assignedRegion || '')}</p>` : ''}
        ${assignBlock}
      </div>`;
  }

  async function assignComplaint(id) {
    const select = document.getElementById(`worker-select-${id}`);
    if (!select || !select.value) { toast('No worker selected.', 'error'); return; }
    try {
      await Api.assignComplaint(id, { workerId: select.value });
      toast('Complaint assigned and dispatched.', 'success');
      loadComplaints();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadGovMap() {
    if (typeof L === 'undefined') { Main.mapUnavailable('gov-heatmap'); return; }
    if (!govMap) {
      govMap = L.map('gov-heatmap').setView([13.0827, 80.2707], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(govMap);
    }
    govMap.eachLayer((l) => { if (l instanceof L.CircleMarker) govMap.removeLayer(l); });
    try {
      const { points, sensitiveLocations } = await Api.heatmap();
      points.forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 6 + p.weight, fillColor: STATUS_MAP_COLOR[p.status] || '#5B6672', color: '#fff', weight: 1.5, fillOpacity: 0.75
        }).bindPopup(`<b>${escapeHtml(p.title)}</b><br>${STATUS_LABELS[p.status]} · Priority ${p.priorityScore} (${p.priorityLevel})`).addTo(govMap);
      });
      sensitiveLocations.forEach((s) => {
        L.circleMarker([s.lat, s.lng], { radius: 5, color: '#E8A33D', fillColor: '#E8A33D', fillOpacity: 0.9 })
          .bindPopup(`${s.type === 'school' ? '🏫' : '🏥'} ${escapeHtml(s.name)}`).addTo(govMap);
      });
      setTimeout(() => govMap.invalidateSize(), 50);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function loadGrievances() {
    const el = document.getElementById('gov-grievances-list');
    el.innerHTML = '<p>Loading…</p>';
    try {
      const { grievances } = await Api.govGrievances();
      if (!grievances.length) { el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No grievances submitted yet.</p></div>'; return; }
      el.innerHTML = grievances.map((g) => `
        <div class="card">
          <div class="complaint-top">
            <div style="flex:1">
              <div class="complaint-title">${escapeHtml(g.subject)}</div>
              <div class="complaint-meta">
                <span class="chip chip-${g.status === 'resolved' ? 'verified' : g.status === 'in_review' ? 'assigned' : 'pending'}">${g.status.replace('_', ' ')}</span>
                <span>From ${escapeHtml(g.workerName)} · ${escapeHtml(g.region || '')}</span>
                <span>${timeAgo(g.createdAt)}</span>
              </div>
            </div>
          </div>
          <div class="complaint-desc">${escapeHtml(g.description)}</div>
          ${g.response ? `<p class="field-hint"><b>Official response:</b> ${escapeHtml(g.response)}</p>` : ''}
          ${g.status !== 'resolved' ? `
            <div class="form-group" style="margin-top:10px">
              <textarea id="resp-${g.id}" placeholder="Write a response…"></textarea>
            </div>
            <div class="complaint-actions">
              <button class="btn btn-outline btn-sm" data-review="${g.id}">Mark in review</button>
              <button class="btn btn-primary btn-sm" data-resolve="${g.id}">Respond &amp; resolve</button>
            </div>` : ''}
        </div>`).join('');
      el.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', () => respondGrievance(btn.dataset.resolve, 'resolved')));
      el.querySelectorAll('[data-review]').forEach((btn) => btn.addEventListener('click', () => respondGrievance(btn.dataset.review, 'in_review')));
    } catch (err) {
      el.innerHTML = alertHtml(err.message);
    }
  }

  async function respondGrievance(id, status) {
    const textarea = document.getElementById(`resp-${id}`);
    try {
      await Api.respondGrievance(id, { response: textarea ? textarea.value.trim() : '', status });
      toast('Grievance updated.', 'success');
      loadGrievances();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadDirectory() {
    const wEl = document.getElementById('gov-worker-directory');
    const cEl = document.getElementById('gov-citizen-directory');
    wEl.innerHTML = cEl.innerHTML = '<p>Loading…</p>';
    try {
      const [{ users: workers }, { users: citizens }] = await Promise.all([Api.govUsers('worker'), Api.govUsers('public')]);
      wEl.innerHTML = workers.length ? tableHtml(workers, ['name', 'region', 'points', 'completedTasks'], ['Name', 'Region', 'Points', 'Tasks done']) : emptyMini('No field workers registered yet.');
      cEl.innerHTML = citizens.length ? tableHtml(citizens, ['name', 'points', 'title'], ['Name', 'Points', 'Title']) : emptyMini('No citizens registered yet.');
      workersCache = workers;
    } catch (err) {
      wEl.innerHTML = cEl.innerHTML = alertHtml(err.message);
    }
  }

  function emptyMini(msg) { return `<div class="empty-state"><p>${escapeHtml(msg)}</p></div>`; }

  function tableHtml(rows, fields, labels) {
    return `<table><thead><tr>${labels.map((l) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => `<tr>${fields.map((f) => `<td>${escapeHtml(String(r[f] ?? ''))}</td>`).join('')}</tr>`).join('')}
    </tbody></table>`;
  }

  return { init, switchView, loadOverview };
})();
