const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

const { load, save } = require('./data/store');

const authRoutes = require('./routes/auth');
const complaintsRoutes = require('./routes/complaints');
const workerRoutes = require('./routes/worker');
const governmentRoutes = require('./routes/government');
const insightsRoutes = require('./routes/insights');
const disasterRoutes = require('./routes/disaster');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded proof photos
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/complaints', complaintsRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/government', governmentRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/disaster', disasterRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'civic-engagement-backend', time: new Date().toISOString() }));

// Serve the frontend (single deployable unit for the hackathon demo)
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// Centralized error handler (e.g. multer file-type/size errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

function ensureDemoAccounts() {
  const db = load();
  let changed = false;

  const demoAccounts = [
    { email: 'gov.demo@civic.app', name: 'Priya Sundaram (Zonal Officer)', role: 'government', region: 'Central Zone', password: 'Gov@1234' },
    { email: 'worker.demo@civic.app', name: 'Ravi Kumar (Field Worker)', role: 'worker', region: 'Central Zone', password: 'Work@1234' },
    { email: 'citizen.demo@civic.app', name: 'Ananya Rao', role: 'public', region: null, password: 'Citizen@1234' }
  ];

  for (const acc of demoAccounts) {
    const exists = db.users.find((u) => u.email === acc.email);
    if (!exists) {
      db.users.push({
        id: uuid(),
        name: acc.name,
        email: acc.email,
        passwordHash: bcrypt.hashSync(acc.password, 10),
        role: acc.role,
        region: acc.region,
        points: acc.role === 'public' ? 12 : 0,
        completedTasks: 0,
        createdAt: new Date().toISOString()
      });
      changed = true;
    }
  }
  if (changed) save(db);
}

ensureDemoAccounts();

app.listen(PORT, () => {
  console.log(`\nCivic Engagement Platform running at http://localhost:${PORT}`);
  console.log('Demo logins:');
  console.log('  Government -> gov.demo@civic.app / Gov@1234');
  console.log('  Worker     -> worker.demo@civic.app / Work@1234');
  console.log('  Citizen    -> citizen.demo@civic.app / Citizen@1234');
  console.log(`  Government registration code: ${process.env.GOV_INVITE_CODE || 'GOV-2026-CIVIC'}`);
  console.log(`  Worker registration code:     ${process.env.WORKER_INVITE_CODE || 'WORK-2026-FIELD'}\n`);
});
