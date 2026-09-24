const express = require('express');
const { load, save } = require('../data/store');
const { requireAuth, requireRole } = require('../middleware/auth');
const { titleForPoints } = require('../utils/scoring');

const router = express.Router();

// Stable tie-breakers make equally scored cases actionable: forecast risk,
// environmental exposure, then the longest waiting case take precedence.
function priorityComparator(a, b) {
  const scoreDelta = (b.priorityScore || 0) - (a.priorityScore || 0);
  if (scoreDelta) return scoreDelta;
  const weatherDelta = (b.weatherRisk?.riskScore || 0) - (a.weatherRisk?.riskScore || 0);
  if (weatherDelta) return weatherDelta;
  const surroundingsDelta = Number(Boolean(b.nearSensitiveLocation)) - Number(Boolean(a.nearSensitiveLocation));
  if (surroundingsDelta) return surroundingsDelta;
  return new Date(a.createdAt) - new Date(b.createdAt);
}

function priorityPercent(score) {
  return Math.min(100, Math.round(((score || 0) / 25) * 100));
}

router.get('/priority-queue', requireAuth, requireRole('government'), (req, res) => {
  const db = load();
  const workers = db.users.filter((u) => u.role === 'worker');
  const workload = new Map(workers.map((w) => [w.id, 0]));
  db.complaints
    .filter((c) => ['assigned', 'in_progress'].includes(c.status) && c.assignedWorkerId)
    .forEach((c) => workload.set(c.assignedWorkerId, (workload.get(c.assignedWorkerId) || 0) + 1));

  const cases = db.complaints
    .filter((c) => c.status === 'pending')
    .sort(priorityComparator)
    .slice(0, 5)
    .map((c, index) => {
      const caseRegion = c.region || c.assignedRegion || 'Central Zone';
      const reward = (c.priorityScore || 0) >= 17
        ? (c.priorityScore >= 25 ? { points: 25, bonusAmount: 500 } : { points: 15, bonusAmount: 300 })
        : null;
      return {
        ...c,
        region: caseRegion,
        rank: index + 1,
        priorityPercent: priorityPercent(c.priorityScore),
        crossAreaReward: reward,
        crossAreaWorkers: workers
        .filter((w) => w.region && w.region !== caseRegion)
        .map((w) => ({ id: w.id, name: w.name, region: w.region, activeTasks: workload.get(w.id) || 0 }))
        .sort((a, b) => a.activeTasks - b.activeTasks || a.name.localeCompare(b.name))
      };
    });

  res.json({ cases, tieBreakers: ['forecast risk', 'sensitive surroundings', 'longest waiting'] });
});

// ---- Government: view all worker grievances ----
router.get('/grievances', requireAuth, requireRole('government'), (req, res) => {
  const db = load();
  const { status } = req.query;
  let list = [...db.workerGrievances];
  if (status) list = list.filter((g) => g.status === status);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ grievances: list });
});

// ---- Government: respond to / resolve a worker grievance ----
router.post('/grievances/:id/respond', requireAuth, requireRole('government'), (req, res) => {
  const { response, status } = req.body || {};
  const db = load();
  const g = db.workerGrievances.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Grievance not found.' });
  g.response = response || g.response;
  g.status = status && ['open', 'in_review', 'resolved'].includes(status) ? status : 'resolved';
  g.respondedAt = new Date().toISOString();
  save(db);
  res.json({ grievance: g });
});

// ---- Government: list regions ----
router.get('/regions', requireAuth, requireRole('government'), (req, res) => {
  const db = load();
  res.json({ regions: db.regions });
});

// ---- Government: directory of all citizens/workers (lightweight admin view) ----
router.get('/users', requireAuth, requireRole('government'), (req, res) => {
  const db = load();
  const { role } = req.query;
  let list = db.users;
  if (role) list = list.filter((u) => u.role === role);
  res.json({
    users: list.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      region: u.region,
      points: u.points || 0,
      bonusEarned: u.bonusEarned || 0,
      title: titleForPoints(u.points || 0),
      completedTasks: u.completedTasks || 0,
      createdAt: u.createdAt
    }))
  });
});

module.exports = router;
