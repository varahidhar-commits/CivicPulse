// ==========================================================================
// Disaster Prevention — city-wide forecast + at-risk zone detection
// ==========================================================================
// Turns the weather forecasting layer into something a municipal team can
// act on BEFORE a disaster happens: a multi-day hazard outlook for the
// city, plus a ranked list of "at-risk zones" produced by cross-referencing
// that forecast against sensitive locations (schools/hospitals) and
// unresolved complaints in flood-prone categories (drainage, potholes,
// water leakage, road damage, exposed electrical). A school near an
// unresolved blocked drain is low-key risky on a sunny day — it becomes an
// urgent pre-storm task the moment heavy rain is forecast.
// ==========================================================================
const express = require('express');
const { load } = require('../data/store');
const { distanceMeters } = require('../utils/geo');
const { fetchDisasterForecast, classifyDayRisk, worseSeverity, HAZARD_META } = require('../utils/weather');

const router = express.Router();

// Default forecast anchor — city center (Chennai). Callers may override with ?lat=&lng=
const CITY_CENTER = { lat: 13.0827, lng: 80.2707, name: 'Chennai' };

// Complaint categories that become genuinely dangerous in heavy rain
const FLOOD_PRONE_CATEGORIES = ['drainage', 'pothole', 'water_leakage', 'road_damage', 'electrical_hazard'];
// Complaint categories that get worse in extreme heat
const HEAT_PRONE_CATEGORIES = ['garbage', 'stray_animals'];

const OPEN_STATUSES = ['pending', 'assigned', 'in_progress'];
const SENSITIVE_RADIUS_M = 500; // "near" a school/hospital
const CLUSTER_RADIUS_M = 250; // grid size for grouping nearby flood-prone complaints

function severityWeight(sev) {
  return { None: 0, Watch: 1, Warning: 2, Severe: 3 }[sev] || 0;
}

// ---- Multi-day city forecast, classified into flood/heatwave/storm alerts ----
router.get('/forecast', async (req, res) => {
  const lat = parseFloat(req.query.lat) || CITY_CENTER.lat;
  const lng = parseFloat(req.query.lng) || CITY_CENTER.lng;
  const days = await fetchDisasterForecast(lat, lng, 5);

  if (!days) {
    return res.json({ available: false, location: { lat, lng }, days: [], message: 'Forecast temporarily unavailable — showing complaint data only.' });
  }

  const classified = days.map(classifyDayRisk);
  const worstSeverity = classified.reduce((w, d) => worseSeverity(w, d.worstSeverity), 'None');

  res.json({
    available: true,
    location: { lat, lng },
    days: classified,
    worstSeverity,
    hazardMeta: HAZARD_META
  });
});

// ---- Condensed banner: worst upcoming alert + exposure counts ----
router.get('/alerts', async (req, res) => {
  const db = load();
  const days = await fetchDisasterForecast(CITY_CENTER.lat, CITY_CENTER.lng, 3);
  const classified = days ? days.map(classifyDayRisk) : [];

  // Find the earliest day that carries the overall-worst severity, so the
  // banner can say "Warning — Sat" rather than just the max in isolation.
  let worst = null;
  for (const d of classified) {
    for (const a of d.alerts) {
      if (!worst || severityWeight(a.severity) > severityWeight(worst.severity)) {
        worst = { ...a, date: d.date };
      }
    }
  }

  const floodProneOpen = db.complaints.filter((c) => FLOOD_PRONE_CATEGORIES.includes(c.category) && OPEN_STATUSES.includes(c.status)).length;
  const heatProneOpen = db.complaints.filter((c) => HEAT_PRONE_CATEGORIES.includes(c.category) && OPEN_STATUSES.includes(c.status)).length;

  res.json({
    available: !!days,
    worst,
    exposure: { floodProneOpen, heatProneOpen, sensitiveLocations: db.sensitiveLocations.length }
  });
});

// ---- At-risk zones: forecast hazards cross-referenced with real locations ----
router.get('/risk-zones', async (req, res) => {
  const db = load();
  const days = await fetchDisasterForecast(CITY_CENTER.lat, CITY_CENTER.lng, 3);
  const classified = days ? days.map(classifyDayRisk) : [];

  // Peak severity per hazard type across the 3-day window
  const peak = { flood: 'None', heatwave: 'None', storm: 'None' };
  classified.forEach((d) => d.alerts.forEach((a) => { peak[a.type] = worseSeverity(peak[a.type], a.severity); }));

  const zones = [];

  // 1) Sensitive locations (schools/hospitals) near open flood-prone complaints
  if (severityWeight(peak.flood) >= severityWeight('Watch')) {
    db.sensitiveLocations.forEach((loc) => {
      const nearby = db.complaints.filter(
        (c) => FLOOD_PRONE_CATEGORIES.includes(c.category) && OPEN_STATUSES.includes(c.status) && distanceMeters(loc.lat, loc.lng, c.lat, c.lng) <= SENSITIVE_RADIUS_M
      );
      if (nearby.length) {
        zones.push({
          name: loc.name,
          kind: loc.type, // school | hospital
          lat: loc.lat,
          lng: loc.lng,
          hazard: 'flood',
          severity: peak.flood,
          relatedComplaints: nearby.length,
          recommendation: `${nearby.length} unresolved drainage/road issue(s) within ${SENSITIVE_RADIUS_M}m of this ${loc.type} — clear or barricade before the rain arrives.`
        });
      }
    });
  }

  // 2) Simple grid-clustering of flood-prone complaints into hotspots
  if (severityWeight(peak.flood) >= severityWeight('Watch')) {
    const clusters = new Map(); // key: rounded lat,lng -> { lat, lng, complaints: [] }
    db.complaints
      .filter((c) => FLOOD_PRONE_CATEGORIES.includes(c.category) && OPEN_STATUSES.includes(c.status))
      .forEach((c) => {
        // ~250m grid at this latitude
        const gridSize = CLUSTER_RADIUS_M / 111000;
        const key = `${Math.round(c.lat / gridSize)},${Math.round(c.lng / gridSize)}`;
        if (!clusters.has(key)) clusters.set(key, { lat: c.lat, lng: c.lng, complaints: [] });
        clusters.get(key).complaints.push(c);
      });
    clusters.forEach((cluster) => {
      if (cluster.complaints.length >= 2) {
        const categories = [...new Set(cluster.complaints.map((c) => c.category))];
        zones.push({
          name: cluster.complaints[0].address || `Near (${cluster.lat.toFixed(3)}, ${cluster.lng.toFixed(3)})`,
          kind: 'hotspot',
          lat: cluster.lat,
          lng: cluster.lng,
          hazard: 'flood',
          severity: peak.flood,
          relatedComplaints: cluster.complaints.length,
          recommendation: `Cluster of ${cluster.complaints.length} unresolved reports (${categories.map(categoryLabel).join(', ')}) — prioritize a crew here ahead of the rain.`
        });
      }
    });
  }

  // 3) Heatwave exposure: garbage/stray-animal complaints near sensitive locations
  if (severityWeight(peak.heatwave) >= severityWeight('Warning')) {
    db.sensitiveLocations
      .filter((loc) => loc.type === 'hospital')
      .forEach((loc) => {
        const nearby = db.complaints.filter(
          (c) => HEAT_PRONE_CATEGORIES.includes(c.category) && OPEN_STATUSES.includes(c.status) && distanceMeters(loc.lat, loc.lng, c.lat, c.lng) <= SENSITIVE_RADIUS_M
        );
        if (nearby.length) {
          zones.push({
            name: loc.name,
            kind: loc.type,
            lat: loc.lat,
            lng: loc.lng,
            hazard: 'heatwave',
            severity: peak.heatwave,
            relatedComplaints: nearby.length,
            recommendation: `${nearby.length} uncollected waste/animal report(s) near this hospital — clear before peak heat raises health risk.`
          });
        }
      });
  }

  zones.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.relatedComplaints - a.relatedComplaints);

  res.json({ peakSeverity: peak, zones, windowDays: classified.map((d) => ({ date: d.date, worstSeverity: d.worstSeverity })) });
});

function categoryLabel(cat) {
  const labels = {
    garbage: 'Garbage / waste',
    pothole: 'Pothole',
    streetlight: 'Streetlight',
    water_leakage: 'Water leakage',
    drainage: 'Drainage',
    electrical_hazard: 'Electrical hazard',
    road_damage: 'Road damage',
    encroachment: 'Encroachment',
    stray_animals: 'Stray animals',
    other: 'Other'
  };
  return labels[cat] || cat;
}

module.exports = router;
