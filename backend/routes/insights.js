const express = require('express');
const { load } = require('../data/store');
const { titleForPoints } = require('../utils/scoring');

const router = express.Router();

// ---- Real-time Civic Heat Map data ----
router.get('/heatmap', (req, res) => {
  const db = load();
  const points = db.complaints.map((c) => ({
    id: c.id,
    lat: c.lat,
    lng: c.lng,
    status: c.status,
    category: c.category,
    priorityScore: c.priorityScore,
    priorityLevel: c.priorityLevel,
    title: c.title,
    weight: Math.max(1, Math.min(10, Math.round((c.priorityScore || 1) / 2)))
  }));
  res.json({ points, sensitiveLocations: db.sensitiveLocations });
});

// ---- Authority Dashboard stats ----
router.get('/stats', (req, res) => {
  const db = load();
  const complaints = db.complaints;

  const byStatus = {};
  const byCategory = {};
  const byRegion = {};
  for (const c of complaints) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    const region = c.assignedRegion || 'Unassigned';
    byRegion[region] = (byRegion[region] || 0) + 1;
  }

  const total = complaints.length;
  const resolvedOrVerified = complaints.filter((c) => c.status === 'resolved' || c.status === 'verified').length;
  const verified = complaints.filter((c) => c.status === 'verified').length;
  const critical = complaints.filter((c) => c.priorityLevel === 'Critical').length;
  const avgResolutionHours =
    complaints
      .filter((c) => c.resolvedAt)
      .map((c) => (new Date(c.resolvedAt) - new Date(c.createdAt)) / 3600000)
      .reduce((a, b, _, arr) => a + b / arr.length, 0) || 0;

  res.json({
    total,
    resolvedOrVerified,
    verified,
    critical,
    pending: byStatus.pending || 0,
    inProgress: byStatus.in_progress || 0,
    assigned: byStatus.assigned || 0,
    avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
    byStatus,
    byCategory,
    byRegion
  });
});

// ---- Gamification: leaderboard ----
router.get('/leaderboard', (req, res) => {
  const db = load();
  const citizens = db.users
    .filter((u) => u.role === 'public')
    .map((u) => ({ id: u.id, name: u.name, points: u.points || 0, title: titleForPoints(u.points || 0) }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);

  const workers = db.users
    .filter((u) => u.role === 'worker')
    .map((u) => ({ id: u.id, name: u.name, points: u.points || 0, completedTasks: u.completedTasks || 0, region: u.region }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);

  res.json({ citizens, workers });
});

module.exports = router;
