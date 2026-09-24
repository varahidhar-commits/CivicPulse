const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { load, save } = require('../data/store');
const { JWT_SECRET, requireAuth } = require('../middleware/auth');
const { titleForPoints } = require('../utils/scoring');

const router = express.Router();

// Government accounts require this invite code to register (demo-simple access control).
const GOVERNMENT_INVITE_CODE = process.env.GOV_INVITE_CODE || 'GOV-2026-CIVIC';
// Worker accounts require this code so random citizens can't self-register as field workers.
const WORKER_INVITE_CODE = process.env.WORKER_INVITE_CODE || 'WORK-2026-FIELD';

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    region: u.region || null,
    points: u.points || 0,
    title: titleForPoints(u.points || 0),
    createdAt: u.createdAt
  };
}

function signToken(u) {
  return jwt.sign(
    { id: u.id, name: u.name, email: u.email, role: u.role, region: u.region || null },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

router.post('/register', (req, res) => {
  const { name, email, password, role, region, inviteCode } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required.' });
  }
  if (!['public', 'government', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'role must be public, government, or worker.' });
  }
  if (role === 'government' && inviteCode !== GOVERNMENT_INVITE_CODE) {
    return res.status(403).json({ error: 'Invalid government access code.' });
  }
  if (role === 'worker' && inviteCode !== WORKER_INVITE_CODE) {
    return res.status(403).json({ error: 'Invalid worker access code.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const db = load();
  const existing = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const user = {
    id: uuid(),
    name,
    email: String(email).toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    region: role !== 'public' ? region || 'Central Zone' : null,
    points: 0,
    completedTasks: 0,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  save(db);

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required.' });

  const db = load();
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const db = load();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user) });
});

// Lets the frontend list field workers for the "assign" dropdown, government-only.
router.get('/workers', requireAuth, (req, res) => {
  if (req.user.role !== 'government') return res.status(403).json({ error: 'Government access only.' });
  const db = load();
  const workers = db.users.filter((u) => u.role === 'worker').map(publicUser);
  res.json({ workers });
});

module.exports = router;
