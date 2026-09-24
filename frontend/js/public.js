// ==========================================================================
// CivicPulse - Public portal
// ==========================================================================
const PublicPortal = (() => {
  let reportMap, reportMarker, feedMap;
  let activeFeedbackComplaint = null;

  function init() {
    wireFileDrop('rp-photo-drop', 'rp-photo');
    document.querySelectorAll('#view-public [data-pv]').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.pv));
    });
    document.getElementById('report-form').addEventListener('submit', onSubmitReport);
    document.getElementById('btn-use-location').addEventListener('click', useMyLocation);
    document.getElementById('btn-refresh-mine').addEventListener('click', loadMine);
    document.getElementById('feed-category-filter').addEventListener('change', loadFeed);

    document.getElementById('feedback-close').addEventListener('click', () => hideModal('feedback-modal'));
    document.getElementById('fb-confirm-btn').addEventListener('click', () => submitFeedback(true));
    document.getElementById('fb-reject-btn').addEventListener('click', () => submitFeedback(false));

    initReportMap();
  }

  function switchView(name) {
    document.querySelectorAll('#view-public [data-pv]').forEach((b) => b.classList.toggle('active', b.dataset.pv === name));
    ['report', 'mine', 'feed', 'reputation', 'leaderboard', 'disaster'].forEach((v) => {
      document.getElementById(`pv-${v}`).classList.toggle('hidden', v !== name);
    });
    if (name === 'mine') loadMine();
    if (name === 'feed') loadFeed();
    if (name === 'reputation') loadReputation();
    if (name === 'leaderboard') loadLeaderboard();
    if (name === 'disaster') DisasterPrevention.renderPublic();
    if (name === 'report') setTimeout(() => reportMap && reportMap.invalidateSize(), 50);
  }

  function initReportMap() {
    if (reportMap || typeof L === 'undefined') { if (typeof L === 'undefined') Main.mapUnavailable('report-map'); return; }
    reportMap = L.map('report-map').setView([13.0827, 80.2707], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(reportMap);
    reportMap.on('click', (e) => setReportLocation(e.latlng.lat, e.latlng.lng));
  }

  function setReportLocation(lat, lng) {
    document.getElementById('rp-lat').value = lat.toFixed(6);
    document.getElementById('rp-lng').value = lng.toFixed(6);
    if (!reportMap) return;
    if (reportMarker) reportMap.removeLayer(reportMarker);
    reportMarker = L.marker([lat, lng]).addTo(reportMap);
  }

  function useMyLocation() {
    if (!navigator.geolocation) { toast('Geolocation not available in this browser.', 'error'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setReportLocation(latitude, longitude);
        if (reportMap) reportMap.setView([latitude, longitude], 15);
        toast('Location set from your device.', 'success');
      },
      () => toast('Could not get your location. Please click the map instead.', 'error')
    );
  }

  async function onSubmitReport(e) {
    e.preventDefault();
    if (!Session.hasRole('public')) { toast('Please log in as a citizen to report an issue.', 'error'); showModal('auth-modal'); return; }

    const slot = document.getElementById('report-alert-slot');
    slot.innerHTML = '';
    const lat = document.getElementById('rp-lat').value.trim();
    const lng = document.getElementById('rp-lng').value.trim();
    if (!lat || !lng) { slot.innerHTML = alertHtml('Please set a location by clicking the map or using your device location.'); return; }

    const fd = new FormData();
    fd.append('title', document.getElementById('rp-title').value.trim());
    fd.append('description', document.getElementById('rp-desc').value.trim());
    fd.append('category', document.getElementById('rp-category').value);
    fd.append('lat', lat);
    fd.append('lng', lng);
    fd.append('address', document.getElementById('rp-address').value.trim());
    fd.append('region', document.getElementById('rp-region').value);
    const photoInput = document.getElementById('rp-photo');
    if (photoInput.files[0]) fd.append('photoBefore', photoInput.files[0]);

    const btn = document.getElementById('rp-submit-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting…';
    try {
      const res = await Api.createComplaint(fd);
      if (res.duplicate) {
        slot.innerHTML = alertHtml(res.message, 'info');
        toast('Matched to an existing report — thanks for confirming it!', 'info');
      } else {
        slot.innerHTML = alertHtml(`Report submitted. Priority: ${res.complaint.priorityLevel} (score ${res.complaint.priorityScore}).`, 'success');
        toast('Report submitted successfully.', 'success');
      }
      document.getElementById('report-form').reset();
      document.getElementById('rp-photo-drop').textContent = 'Click to add a photo';
      document.getElementById('rp-photo-drop').classList.remove('has-file');
      if (reportMarker) { reportMap.removeLayer(reportMarker); reportMarker = null; }
      Main.refreshUserChip();
    } catch (err) {
      slot.innerHTML = alertHtml(err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Submit report';
    }
  }

  async function loadMine() {
    const el = document.getElementById('mine-list');
    if (!Session.hasRole('public')) { el.innerHTML = emptyState('Log in as a citizen to see your reports.'); return; }
    el.innerHTML = '<p>Loading…</p>';
    try {
      const { complaints } = await Api.listComplaints('?mine=true');
      if (!complaints.length) { el.innerHTML = emptyState('You haven\'t reported anything yet.', '📭'); return; }
      el.innerHTML = complaints.map(complaintCardHtml).join('');
      complaints.forEach((c) => {
        if (c.status === 'resolved') {
          const btn = document.getElementById(`fb-btn-${c.id}`);
          if (btn) btn.addEventListener('click', () => openFeedbackModal(c));
        }
      });
    } catch (err) {
      el.innerHTML = alertHtml(err.message);
    }
  }

  function complaintCardHtml(c) {
    const photos = [];
    if (c.photoBeforeUrl) photos.push(`<img src="${c.photoBeforeUrl}" alt="Before photo">`);
    if (c.photoAfterUrl) photos.push(`<img src="${c.photoAfterUrl}" alt="After photo">`);
    const feedbackBtn = c.status === 'resolved'
      ? `<button class="btn btn-amber btn-sm" id="fb-btn-${c.id}">Verify resolution</button>`
      : '';
    return `
      <div class="complaint-card">
        <div class="complaint-top">
          ${scoreBadgeHtml(c.priorityScore, c.priorityLevel)}
          <div style="flex:1">
            <div class="complaint-title">${escapeHtml(c.title)}</div>
            <div class="complaint-meta">
              ${statusChip(c.status)} ${priorityChip(c.priorityLevel)} ${weatherChip(c.weatherRisk)} ${recurringChip(c.recurringRisk, c.recurringCount)}
              <span>${categoryLabel(c.category)}</span>
              <span>${timeAgo(c.createdAt)}</span>
              <span>👍 ${c.confirmationsCount} confirmation${c.confirmationsCount === 1 ? '' : 's'}</span>
              ${c.nearSensitiveLocation ? `<span>🏫 Near ${escapeHtml(c.nearestSensitiveLocation?.name || 'sensitive site')}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="complaint-desc">${escapeHtml(c.description)}</div>
        ${photos.length ? `<div class="complaint-photos">${photos.join('')}</div>` : ''}
        ${c.assignedWorkerName ? `<p class="field-hint">Assigned to ${escapeHtml(c.assignedWorkerName)} · ${escapeHtml(c.assignedRegion || '')}</p>` : ''}
        ${c.feedbackRating ? `<p class="field-hint">Citizen rating: ${'★'.repeat(c.feedbackRating)}${'☆'.repeat(5 - c.feedbackRating)} ${c.feedbackComment ? '— ' + escapeHtml(c.feedbackComment) : ''}</p>` : ''}
        <div class="complaint-actions">${feedbackBtn}</div>
      </div>`;
  }

  function emptyState(msg, icon = '🗂️') {
    return `<div class="empty-state"><div class="icon">${icon}</div><p>${escapeHtml(msg)}</p></div>`;
  }

  async function loadFeed() {
    const el = document.getElementById('feed-list');
    el.innerHTML = '<p>Loading…</p>';
    const cat = document.getElementById('feed-category-filter').value;
    try {
      const { complaints } = await Api.listComplaints(cat ? `?category=${cat}` : '');
      if (!complaints.length) { el.innerHTML = emptyState('No reports yet — be the first!'); }
      else {
        el.innerHTML = complaints.map((c) => {
          const canConfirm = Session.hasRole('public') && c.reporterId !== Session.user.id && !['resolved', 'verified'].includes(c.status);
          const confirmBtn = canConfirm ? `<button class="btn btn-outline btn-sm" data-confirm="${c.id}">👍 I see this too</button>` : '';
          return complaintCardHtml(c).replace('<div class="complaint-actions">', `<div class="complaint-actions">${confirmBtn}`);
        }).join('');
        el.querySelectorAll('[data-confirm]').forEach((btn) => {
          btn.addEventListener('click', () => confirmComplaint(btn.dataset.confirm));
        });
        el.querySelectorAll('[id^="fb-btn-"]').forEach((btn) => {
          const id = btn.id.replace('fb-btn-', '');
          const c = complaints.find((x) => x.id === id);
          if (c) btn.addEventListener('click', () => openFeedbackModal(c));
        });
      }
      renderFeedHeatmap(cat);
    } catch (err) {
      el.innerHTML = alertHtml(err.message);
    }
  }

  async function confirmComplaint(id) {
    if (!Session.hasRole('public')) { toast('Log in as a citizen to confirm reports.', 'error'); showModal('auth-modal'); return; }
    try {
      await Api.confirmComplaint(id);
      toast('Thanks — this report\'s priority has been boosted.', 'success');
      Main.refreshUserChip();
      loadFeed();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function renderFeedHeatmap(cat) {
    if (typeof L === 'undefined') { Main.mapUnavailable('pv-heatmap'); return; }
    if (!feedMap) {
      feedMap = L.map('pv-heatmap').setView([13.0827, 80.2707], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(feedMap);
    }
    feedMap.eachLayer((l) => { if (l instanceof L.CircleMarker || l instanceof L.Marker) feedMap.removeLayer(l); });
    try {
      const { points, sensitiveLocations } = await Api.heatmap();
      const filtered = cat ? points.filter((p) => p.category === cat) : points;
      filtered.forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 6 + p.weight,
          fillColor: STATUS_MAP_COLOR[p.status] || '#5B6672',
          color: '#fff', weight: 1.5, fillOpacity: 0.75
        }).bindPopup(`<b>${escapeHtml(p.title)}</b><br>${STATUS_LABELS[p.status]} · Priority ${p.priorityScore} (${p.priorityLevel})`).addTo(feedMap);
      });
      sensitiveLocations.forEach((s) => {
        L.circleMarker([s.lat, s.lng], { radius: 5, color: '#E8A33D', fillColor: '#E8A33D', fillOpacity: 0.9 })
          .bindPopup(`${s.type === 'school' ? '🏫' : '🏥'} ${escapeHtml(s.name)}`).addTo(feedMap);
      });
      setTimeout(() => feedMap.invalidateSize(), 50);
    } catch (err) { /* silent */ }
  }

  function openFeedbackModal(c) {
    activeFeedbackComplaint = c;
    document.getElementById('feedback-alert-slot').innerHTML = '';
    const box = document.getElementById('feedback-before-after');
    box.innerHTML = '';
    if (c.photoBeforeUrl) box.innerHTML += `<div style="flex:1"><p class="field-hint">Before</p><img src="${c.photoBeforeUrl}" style="border-radius:8px;width:100%;height:110px;object-fit:cover"></div>`;
    if (c.photoAfterUrl) box.innerHTML += `<div style="flex:1"><p class="field-hint">After</p><img src="${c.photoAfterUrl}" style="border-radius:8px;width:100%;height:110px;object-fit:cover"></div>`;
    showModal('feedback-modal');
  }

  async function submitFeedback(verified) {
    if (!activeFeedbackComplaint) return;
    const slot = document.getElementById('feedback-alert-slot');
    try {
      await Api.feedbackComplaint(activeFeedbackComplaint.id, {
        rating: document.getElementById('fb-rating').value,
        comment: document.getElementById('fb-comment').value.trim(),
        verified
      });
      hideModal('feedback-modal');
      toast(verified ? 'Thanks — marked as verified fixed!' : 'Reopened for re-assignment.', verified ? 'success' : 'info');
      Main.refreshUserChip();
      loadMine();
      loadFeed();
    } catch (err) {
      slot.innerHTML = alertHtml(err.message);
    }
  }

  async function loadReputation() {
    const el = document.getElementById('reputation-card');
    if (!Session.hasRole('public')) { el.innerHTML = emptyState('Log in as a citizen to see your reputation.'); return; }
    try {
      const { user } = await Api.me();
      Session.user = { ...Session.user, ...user };
      el.innerHTML = `
        <div class="seal-badge" style="font-size:1.1rem;margin-bottom:14px"><span class="seal-icon">🏅</span>${escapeHtml(user.title)}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="kpi"><div class="kpi-label">Points</div><div class="kpi-value">${user.points}</div></div>
          <div class="kpi"><div class="kpi-label">Member since</div><div class="kpi-value" style="font-size:1.1rem">${new Date(user.createdAt).toLocaleDateString()}</div></div>
        </div>`;
    } catch (err) {
      el.innerHTML = alertHtml(err.message);
    }
  }

  async function loadLeaderboard() {
    const cEl = document.getElementById('leaderboard-citizens');
    const wEl = document.getElementById('leaderboard-workers');
    cEl.innerHTML = wEl.innerHTML = '<p>Loading…</p>';
    try {
      const { citizens, workers } = await Api.leaderboard();
      cEl.innerHTML = citizens.length ? citizens.map((u, i) => leaderRow(u, i, u.title)).join('') : emptyState('No citizens yet.');
      wEl.innerHTML = workers.length ? workers.map((u, i) => leaderRow(u, i, `${u.completedTasks} tasks done`)).join('') : emptyState('No workers yet.');
    } catch (err) {
      cEl.innerHTML = wEl.innerHTML = alertHtml(err.message);
    }
  }

  function leaderRow(u, i, sub) {
    return `<div class="leaderboard-row">
      <div class="rank-num ${i === 0 ? 'gold' : ''}">${i + 1}</div>
      <div class="name">${escapeHtml(u.name)}<div class="field-hint" style="margin:0">${escapeHtml(sub)}</div></div>
      <div class="pts">${u.points} pts</div>
    </div>`;
  }

  return { init, switchView };
})();
