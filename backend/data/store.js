// Lightweight file-based JSON datastore.
// Good enough for a hackathon MVP - no native DB dependencies required.
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

const SEED = {
  users: [
    // Seeded government account so judges can log in immediately.
    // password: "Gov@1234" (hashed at first boot in server.js if missing)
  ],
  complaints: [],
  workerGrievances: [],
  sensitiveLocations: [
    { id: 'sl1', type: 'school', name: 'Chennai Public Higher Secondary School', lat: 13.0827, lng: 80.2707 },
    { id: 'sl2', type: 'hospital', name: 'Government General Hospital', lat: 13.0836, lng: 80.2750 },
    { id: 'sl3', type: 'school', name: 'St. Mary\'s Matriculation School', lat: 13.0674, lng: 80.2376 },
    { id: 'sl4', type: 'hospital', name: 'Apex City Hospital', lat: 13.0569, lng: 80.2425 },
    { id: 'sl5', type: 'school', name: 'Riverside Elementary School', lat: 13.0450, lng: 80.2101 }
  ],
  regions: [
    { id: 'r1', name: 'North Zone' },
    { id: 'r2', name: 'South Zone' },
    { id: 'r3', name: 'East Zone' },
    { id: 'r4', name: 'West Zone' },
    { id: 'r5', name: 'Central Zone' }
  ]
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(SEED, null, 2));
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    fs.writeFileSync(DB_FILE, JSON.stringify(SEED, null, 2));
    return JSON.parse(JSON.stringify(SEED));
  }
}

function save(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

module.exports = { load, save };
