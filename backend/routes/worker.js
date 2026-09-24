const express = require('express');
const { v4: uuid } = require('uuid');
const { load, save } = require('../data/store');
const { requireAuth, requireRole } = require('../middleware/auth');
const { titleForPoints, nextTitleInfo } = require('../utils/scoring');

const router = express.Router();

function fileUrl(req, filename) {
  if (!filename) return null;
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

// ==========================================================
// WORKER PROFILE / BENEFITS SUMMARY
// ==========================================================

router.get(
  '/me/summary',
  requireAuth,
  requireRole('worker'),
  (req, res) => {
    const db = load();

    const user = db.users.find((u) => u.id === req.user.id);

    if (!user) {
      return res.status(404).json({
        error: 'User not found.'
      });
    }

    const myTasks = db.complaints;

    const next = nextTitleInfo(user.points || 0);

    res.json({
      profile: {
        id: user.id,
        name: user.name,
        region: user.region,
        points: user.points || 0,
        bonusEarned: user.bonusEarned || 0,
        title: titleForPoints(user.points || 0),
        completedTasks: user.completedTasks || 0,
        nextTitle: next.nextTitle,
        pointsToNextTitle: next.pointsNeeded
      },

      taskCounts: {
        assigned: myTasks.filter(
          (c) => c.status === 'assigned'
        ).length,

        inProgress: myTasks.filter(
          (c) => c.status === 'in_progress'
        ).length,

        resolved: myTasks.filter(
          (c) => c.status === 'resolved'
        ).length,

        verified: myTasks.filter(
          (c) => c.status === 'verified'
        ).length
      }
    });
  }
);

// ==========================================================
// WORKER TASKS - TEMPORARY DEBUG VERSION
// ==========================================================

router.get(
  '/tasks',
  requireAuth,
  requireRole('worker'),
  (req, res) => {
    const db = load();

    // Only this worker's own assigned tasks (restored — was temporarily
    // showing all complaints to every worker for debugging).
    const tasks = db.complaints
      .filter((c) => c.assignedWorkerId === req.user.id)
      .sort(
        (a, b) =>
          (b.priorityScore || 0) -
          (a.priorityScore || 0)
      )
      .map((c) => ({
        ...c,
        photoBeforeUrl: fileUrl(req, c.photoBefore),
        photoAfterUrl: fileUrl(req, c.photoAfter)
      }));

    res.json({
      tasks
    });
  }
);

// ==========================================================
// WORKER GRIEVANCE
// ==========================================================

router.post(
  '/grievances',
  requireAuth,
  requireRole('worker'),
  (req, res) => {
    const { subject, description } = req.body || {};

    if (!subject || !description) {
      return res.status(400).json({
        error: 'subject and description are required.'
      });
    }

    const db = load();

    const grievance = {
      id: uuid(),
      workerId: req.user.id,
      workerName: req.user.name,
      region: req.user.region,
      subject,
      description,
      status: 'open',
      response: null,
      createdAt: new Date().toISOString(),
      respondedAt: null
    };

    db.workerGrievances.push(grievance);

    save(db);

    res.status(201).json({
      grievance
    });
  }
);

// ==========================================================
// WORKER - VIEW MY GRIEVANCES
// ==========================================================

router.get(
  '/grievances',
  requireAuth,
  requireRole('worker'),
  (req, res) => {
    const db = load();

    const list = db.workerGrievances
      .filter(
        (g) => g.workerId === req.user.id
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    res.json({
      grievances: list
    });
  }
);

module.exports = router;
