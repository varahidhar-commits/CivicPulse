// ==========================================================================
// CivicPulse - main router & auth
// ==========================================================================
const Main = (() => {
  let currentView = 'landing';
  let authRole = 'public';
  let landingMap;

  const GOV_INVITE_HINT = 'Ask your department admin for the access code.';
  const WORKER_INVITE_HINT = 'Ask your department admin for the access code.';

  function init() {
    // Wire navigation and auth FIRST and unconditionally, so the app stays
    // usable even if a CDN asset (maps/charts) fails to load on a flaky network.
    wireNav();
    wireAuthModal();
    safely(() => PublicPortal.init());
    safely(() => GovernmentPortal.init());
    safely(() => WorkerPortal.init());
    safely(() => DisasterPrevention.init());
    restoreSession();
    safely(loadLandingStats);
    safely(loadLandingMap);
    safely(() => DisasterPrevention.renderLandingBanner());
  }

  function safely(fn) {
    try { const r = fn(); if (r && r.catch) r.catch(() => {}); } catch (e) { console.warn('Non-fatal init error:', e); }
  }

  // ---------------- Navigation ----------------
  function wireNav() {
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.addEventListener('click', () => goTo(el.dataset.nav));
    });
    document.getElementById('brand-home').addEventListener('click', () => goTo('landing'));
    document.getElementById('btn-login').addEventListener('click', () => openAuth('login'));
    document.getElementById('btn-signup').addEventListener('click', () => openAuth('register'));
  }

  function goTo(view) {
    if ((view === 'government' || view === 'worker') && !Session.hasRole(view === 'government' ? 'government' : 'worker')) {
      if (view === 'public' && Session.hasRole('public')) { /* fallthrough */ }
      else { openAuth('login', view); return; }
    }
    if (view === 'public' && !Session.hasRole('public')) { openAuth('login', 'public'); return; }

    currentView = view;
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.nav === view));
    ['landing', 'public', 'government', 'worker'].forEach((v) => {
      document.getElementById(`view-${v}`).classList.toggle('hidden', v !== view);
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (view === 'public') PublicPortal.switchView('report');
    if (view === 'government') GovernmentPortal.switchView('overview');
    if (view === 'worker') WorkerPortal.switchView('tasks');
  }

  // ---------------- Auth modal ----------------
  function wireAuthModal() {
    document.getElementById('auth-close').addEventListener('click', () => hideModal('auth-modal'));
    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const isLogin = tab.dataset.authTab === 'login';
        document.getElementById('login-form').classList.toggle('hidden', !isLogin);
        document.getElementById('register-form').classList.toggle('hidden', isLogin);
      });
    });
    document.querySelectorAll('#auth-role-switch button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#auth-role-switch button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        authRole = btn.dataset.role;
        updateAuthFormForRole();
      });
    });
    document.getElementById('login-form').addEventListener('submit', onLogin);
    document.getElementById('register-form').addEventListener('submit', onRegister);
    populateRegionSelect();
    updateAuthFormForRole();
  }

  function populateRegionSelect() {
    const sel = document.getElementById('reg-region');
    ['North Zone', 'South Zone', 'East Zone', 'West Zone', 'Central Zone'].forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r; opt.textContent = r;
      sel.appendChild(opt);
    });
  }

  function updateAuthFormForRole() {
    const isGov = authRole === 'government';
    const isWorker = authRole === 'worker';
    document.getElementById('reg-region-group').classList.toggle('hidden', !(isGov || isWorker));
    document.getElementById('reg-invite-group').classList.toggle('hidden', !(isGov || isWorker));
    document.getElementById('reg-invite-hint').textContent = isGov || isWorker ? GOV_INVITE_HINT : '';
    const hint = document.getElementById('login-demo-hint');
    if (authRole === 'government') hint.textContent = 'Demo login: gov.demo@civic.app / Gov@1234';
    else if (authRole === 'worker') hint.textContent = 'Demo login: worker.demo@civic.app / Work@1234';
    else hint.textContent = 'Demo login: citizen.demo@civic.app / Citizen@1234';
  }

  function openAuth(tab, forRole) {
    if (forRole) {
      authRole = forRole;
      document.querySelectorAll('#auth-role-switch button').forEach((b) => b.classList.toggle('active', b.dataset.role === forRole));
      updateAuthFormForRole();
    }
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.authTab === tab));
    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('auth-alert-slot').innerHTML = '';
    showModal('auth-modal');
  }

  async function onLogin(e) {
    e.preventDefault();
    const slot = document.getElementById('auth-alert-slot');
    slot.innerHTML = '';
    try {
      const { token, user } = await Api.login({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value
      });
      if (user.role !== authRole) {
        slot.innerHTML = alertHtml(`This account is registered as ${user.role}, not ${authRole}. Switch tabs above to log in correctly.`);
        return;
      }
      Session.token = token;
      Session.user = user;
      hideModal('auth-modal');
      toast(`Welcome back, ${user.name.split('(')[0].trim()}!`, 'success');
      afterLogin(user);
    } catch (err) {
      slot.innerHTML = alertHtml(err.message);
    }
  }

  async function onRegister(e) {
    e.preventDefault();
    const slot = document.getElementById('auth-alert-slot');
    slot.innerHTML = '';
    const payload = {
      name: document.getElementById('reg-name').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value,
      role: authRole
    };
    if (authRole !== 'public') {
      payload.region = document.getElementById('reg-region').value;
      payload.inviteCode = document.getElementById('reg-invite').value.trim();
    }
    try {
      const { token, user } = await Api.register(payload);
      Session.token = token;
      Session.user = user;
      hideModal('auth-modal');
      toast(`Account created. Welcome, ${user.name.split('(')[0].trim()}!`, 'success');
      afterLogin(user);
    } catch (err) {
      slot.innerHTML = alertHtml(err.message);
    }
  }

  function afterLogin(user) {
    refreshUserChip();
    goTo(user.role === 'government' ? 'government' : user.role === 'worker' ? 'worker' : 'public');
  }

  function restoreSession() {
    if (Session.isLoggedIn()) refreshUserChip();
  }

  function refreshUserChip() {
    const right = document.getElementById('topbar-right');
    const user = Session.user;
    if (!user) {
      right.innerHTML = `
        <button class="btn btn-outline btn-sm" style="border-color:rgba(255,255,255,0.4);color:#fff" id="btn-login">Log in</button>
        <button class="btn btn-amber btn-sm" id="btn-signup">Get started</button>`;
      document.getElementById('btn-login').addEventListener('click', () => openAuth('login'));
      document.getElementById('btn-signup').addEventListener('click', () => openAuth('register'));
      return;
    }
    right.innerHTML = `
      <div class="user-chip"><span class="avatar">${initials(user.name)}</span> ${escapeHtml(user.name.split('(')[0].trim())} <span style="opacity:0.6">· ${user.role}</span></div>
      <button class="btn btn-ghost btn-sm" style="color:#fff" id="btn-logout">Log out</button>`;
    document.getElementById('btn-logout').addEventListener('click', logout);
  }

  function logout() {
    Session.clear();
    refreshUserChip();
    goTo('landing');
    toast('Logged out.', 'info');
  }

  // ---------------- Landing page ----------------
  async function loadLandingStats() {
    try {
      const stats = await Api.stats();
      document.getElementById('landing-stat-total').textContent = stats.total;
      document.getElementById('landing-stat-verified').textContent = stats.verified;
      document.getElementById('landing-stat-critical').textContent = stats.critical;
    } catch (err) { /* silent on landing */ }
  }

  async function loadLandingMap() {
    if (typeof L === 'undefined') { mapUnavailable('landing-heatmap'); return; }
    landingMap = L.map('landing-heatmap').setView([13.0827, 80.2707], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(landingMap);
    try {
      const { points, sensitiveLocations } = await Api.heatmap();
      points.forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
          radius: 6 + p.weight, fillColor: STATUS_MAP_COLOR[p.status] || '#5B6672', color: '#fff', weight: 1.5, fillOpacity: 0.75
        }).bindPopup(`<b>${escapeHtml(p.title)}</b><br>${STATUS_LABELS[p.status]}`).addTo(landingMap);
      });
      sensitiveLocations.forEach((s) => {
        L.circleMarker([s.lat, s.lng], { radius: 5, color: '#E8A33D', fillColor: '#E8A33D', fillOpacity: 0.9 })
          .bindPopup(`${s.type === 'school' ? '🏫' : '🏥'} ${escapeHtml(s.name)}`).addTo(landingMap);
      });
    } catch (err) { /* silent */ }
  }

  function mapUnavailable(elId) {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = `<div class="empty-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:var(--radius-lg)"><div class="icon">🗺️</div><p>Map couldn't load (offline or CDN blocked). The rest of the app still works.</p></div>`;
  }

  return { init, goTo, refreshUserChip, mapUnavailable };
})();

document.addEventListener('DOMContentLoaded', Main.init);
