// ==========================================================================
// CivicPulse - API client + session state
// ==========================================================================
const API_BASE = window.location.origin + '/api';

const Session = {
  get token() { return localStorage.getItem('civic_token'); },
  set token(v) { v ? localStorage.setItem('civic_token', v) : localStorage.removeItem('civic_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('civic_user') || 'null'); } catch (e) { return null; }
  },
  set user(v) { v ? localStorage.setItem('civic_user', JSON.stringify(v)) : localStorage.removeItem('civic_user'); },
  clear() { this.token = null; this.user = null; },
  isLoggedIn() { return !!this.token && !!this.user; },
  hasRole(role) { return this.isLoggedIn() && this.user.role === role; }
};

async function apiRequest(path, { method = 'GET', body, isForm = false, auth = true } = {}) {
  const headers = {};
  if (auth && Session.token) headers['Authorization'] = `Bearer ${Session.token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
  });

  let data;
  try { data = await res.json(); } catch (e) { data = {}; }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const Api = {
  // Auth
  register: (payload) => apiRequest('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload, auth: false }),
  me: () => apiRequest('/auth/me'),
  workers: () => apiRequest('/auth/workers'),

  // Complaints
  createComplaint: (formData) => apiRequest('/complaints', { method: 'POST', body: formData, isForm: true }),
  listComplaints: (query = '') => apiRequest(`/complaints${query}`, { auth: false }),
  getComplaint: (id) => apiRequest(`/complaints/${id}`, { auth: false }),
  confirmComplaint: (id) => apiRequest(`/complaints/${id}/confirm`, { method: 'POST' }),
  assignComplaint: (id, payload) => apiRequest(`/complaints/${id}/assign`, { method: 'POST', body: payload }),
  startComplaint: (id) => apiRequest(`/complaints/${id}/start`, { method: 'POST' }),
  resolveComplaint: (id, formData) => apiRequest(`/complaints/${id}/resolve`, { method: 'POST', body: formData, isForm: true }),
  feedbackComplaint: (id, payload) => apiRequest(`/complaints/${id}/feedback`, { method: 'POST', body: payload }),

  // Worker
  workerSummary: () => apiRequest('/worker/me/summary'),
  workerTasks: () => apiRequest('/worker/tasks'),
  submitGrievance: (payload) => apiRequest('/worker/grievances', { method: 'POST', body: payload }),
  myGrievances: () => apiRequest('/worker/grievances'),

  // Government
  govGrievances: (query = '') => apiRequest(`/government/grievances${query}`),
  respondGrievance: (id, payload) => apiRequest(`/government/grievances/${id}/respond`, { method: 'POST', body: payload }),
  govRegions: () => apiRequest('/government/regions'),
  priorityQueue: () => apiRequest('/government/priority-queue'),
  govUsers: (role) => apiRequest(`/government/users${role ? `?role=${role}` : ''}`),

  // Insights
  heatmap: () => apiRequest('/insights/heatmap', { auth: false }),
  stats: () => apiRequest('/insights/stats', { auth: false }),
  leaderboard: () => apiRequest('/insights/leaderboard', { auth: false }),

  // Disaster prevention
  disasterForecast: () => apiRequest('/disaster/forecast', { auth: false }),
  disasterAlerts: () => apiRequest('/disaster/alerts', { auth: false }),
  disasterRiskZones: () => apiRequest('/disaster/risk-zones', { auth: false })
};
