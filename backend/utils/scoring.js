const { distanceMeters } = require('./geo');

// Base severity weight per category
const CATEGORY_WEIGHT = {
  garbage: 4,
  pothole: 6,
  streetlight: 3,
  water_leakage: 5,
  drainage: 6,
  electrical_hazard: 9,
  road_damage: 7,
  encroachment: 3,
  stray_animals: 4,
  other: 3
};

const SENSITIVE_RADIUS_METERS = 300;
const SENSITIVE_BONUS = 5;

const DUPLICATE_CONFIRM_WEIGHT = 2;
const MAX_DUPLICATE_BONUS = 20;

const AGE_WEIGHT_PER_DAY = 0.6;
const MAX_AGE_BONUS = 12;

// NEW: recurring issue intelligence
const RECURRING_RADIUS_METERS = 250;
const RECURRING_WEIGHT = 2.5;
const MAX_RECURRING_BONUS = 10;

// NEW: weather ML risk (see utils/weather.js for the model itself)
const WEATHER_MAX_BONUS = 8;

/**
 * AI Priority Scoring
 *
 * Considers:
 * 1. Severity of complaint
 * 2. Nearby school/hospital
 * 3. Crowd confirmations
 * 4. Complaint age
 * 5. Previous complaints of same type in same location
 * 6. Predicted weather risk (ML model over live forecast data)
 */
function computePriorityScore(
  {
    id = null,
    category,
    lat,
    lng,
    confirmationsCount = 0,
    createdAt
  },
  sensitiveLocations = [],
  allComplaints = [],
  weatherRisk = null
) {
  const reasons = [];

  // -----------------------------
  // 1. CATEGORY / SEVERITY
  // -----------------------------
  const categoryScore =
    CATEGORY_WEIGHT[category] ?? CATEGORY_WEIGHT.other;

  let score = categoryScore;

  reasons.push({
    factor: 'Issue severity',
    points: categoryScore,
    detail: `${category} severity weight`
  });

  // -----------------------------
  // 2. SENSITIVE LOCATION
  // -----------------------------
  let nearestSensitive = null;
  let nearestDistance = Infinity;

  for (const loc of sensitiveLocations) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);

    if (d < nearestDistance) {
      nearestDistance = d;
      nearestSensitive = loc;
    }
  }

  const nearSensitive =
    nearestDistance <= SENSITIVE_RADIUS_METERS;

  if (nearSensitive && nearestSensitive) {
    score += SENSITIVE_BONUS;

    reasons.push({
      factor: 'Sensitive location',
      points: SENSITIVE_BONUS,
      detail: `${nearestSensitive.type} "${nearestSensitive.name}" is ${Math.round(
        nearestDistance
      )}m away`
    });
  }

  // -----------------------------
  // 3. CROWD CONFIRMATIONS
  // -----------------------------
  const confirmationBonus = Math.min(
    confirmationsCount * DUPLICATE_CONFIRM_WEIGHT,
    MAX_DUPLICATE_BONUS
  );

  score += confirmationBonus;

  if (confirmationsCount > 0) {
    reasons.push({
      factor: 'Crowd confirmation',
      points: confirmationBonus,
      detail: `${confirmationsCount} citizen confirmation(s)`
    });
  }

  // -----------------------------
  // 4. COMPLAINT AGE
  // -----------------------------
  const ageDays = createdAt
    ? Math.max(
        0,
        (Date.now() - new Date(createdAt).getTime()) / 86400000
      )
    : 0;

  const ageBonus = Math.min(
    ageDays * AGE_WEIGHT_PER_DAY,
    MAX_AGE_BONUS
  );

  score += ageBonus;

  if (ageDays >= 1) {
    reasons.push({
      factor: 'Unresolved duration',
      points: Math.round(ageBonus * 10) / 10,
      detail: `Open for ${Math.round(ageDays * 10) / 10} day(s)`
    });
  }

  // -----------------------------
  // 5. RECURRING ISSUE HISTORY
  // -----------------------------
  let recurringCount = 0;

  for (const complaint of allComplaints) {
    // Don't compare complaint against itself
    if (id && complaint.id === id) continue;

    // Same complaint category only
    if (complaint.category !== category) continue;

    if (
      complaint.lat === undefined ||
      complaint.lng === undefined
    ) {
      continue;
    }

    const distance = distanceMeters(
      lat,
      lng,
      complaint.lat,
      complaint.lng
    );

    if (distance <= RECURRING_RADIUS_METERS) {
      recurringCount++;
    }
  }

  const recurringBonus = Math.min(
    recurringCount * RECURRING_WEIGHT,
    MAX_RECURRING_BONUS
  );

  score += recurringBonus;

  if (recurringCount > 0) {
    reasons.push({
      factor: 'Recurring location',
      points: recurringBonus,
      detail: `${recurringCount} previous ${category} issue(s) found within ${RECURRING_RADIUS_METERS}m`
    });
  }

  // -----------------------------
  // 6. WEATHER RISK (ML model over live forecast)
  // -----------------------------
  const weatherBonus = weatherRisk
    ? Math.round(weatherRisk.riskScore * WEATHER_MAX_BONUS * 10) / 10
    : 0;

  score += weatherBonus;

  if (weatherRisk && weatherRisk.factors && weatherRisk.factors.length) {
    for (const f of weatherRisk.factors) {
      reasons.push({
        factor: 'Weather risk',
        points: weatherBonus,
        detail: f.detail
      });
    }
  }

  // -----------------------------
  // FINAL SCORE
  // -----------------------------
  score = Math.round(score * 10) / 10;

  let level = 'Low';

  if (score >= 25) {
    level = 'Critical';
  } else if (score >= 17) {
    level = 'High';
  } else if (score >= 9) {
    level = 'Medium';
  }

  return {
    score,
    level,

    nearSensitiveLocation: nearSensitive,

    nearestSensitiveLocation:
      nearSensitive && nearestSensitive
        ? {
            name: nearestSensitive.name,
            type: nearestSensitive.type,
            distanceMeters: Math.round(nearestDistance)
          }
        : null,

    // NEW fields
    recurringCount,

    recurringRisk:
      recurringCount >= 3
        ? 'High'
        : recurringCount >= 1
        ? 'Medium'
        : 'Low',

    weatherRisk: weatherRisk
      ? { riskScore: weatherRisk.riskScore, label: weatherRisk.label, forecast: weatherRisk.forecast }
      : null,

    reasons
  };
}

// ------------------------------------
// CIVIC REPUTATION TITLES
// ------------------------------------
const TITLES = [
  { min: 0, title: 'New Citizen' },
  { min: 20, title: 'Active Citizen' },
  { min: 50, title: 'Civic Contributor' },
  { min: 100, title: 'Clean City Champion' },
  { min: 200, title: 'Civic Hero' }
];

function titleForPoints(points) {
  let current = TITLES[0].title;

  for (const t of TITLES) {
    if (points >= t.min) {
      current = t.title;
    }
  }

  return current;
}

function nextTitleInfo(points) {
  const sorted = [...TITLES].sort(
    (a, b) => a.min - b.min
  );

  for (const t of sorted) {
    if (points < t.min) {
      return {
        nextTitle: t.title,
        pointsNeeded: t.min - points
      };
    }
  }

  return {
    nextTitle: null,
    pointsNeeded: 0
  };
}

// ------------------------------------
// REPUTATION POINTS
// ------------------------------------
const POINTS = {
  REPORT_COMPLAINT: 5,
  CROWD_CONFIRM: 2,
  REPORTER_VERIFIED_RESOLUTION: 10,
  WORKER_TASK_COMPLETE: 15,
  WORKER_SENSITIVE_BONUS: 5
};

/**
 * Temporary AI Resolution Verification
 * We'll upgrade this later to actual image comparison.
 */
function estimateResolutionConfidence(
  beforeFile,
  afterFile
) {
  if (!beforeFile || !afterFile) {
    return {
      confidence: 0,
      note: 'Missing before/after photo.'
    };
  }

  const sizeDelta = Math.abs(
    (afterFile.size || 0) -
      (beforeFile.size || 0)
  );

  const relDelta =
    sizeDelta /
    Math.max(beforeFile.size || 1, 1);

  const confidence = Math.min(
    0.95,
    0.4 + relDelta
  );

  return {
    confidence:
      Math.round(confidence * 100) / 100,

    note:
      confidence > 0.6
        ? 'Visual change detected between before/after photos - likely resolved.'
        : 'Low visual difference detected - recommend citizen review before closing.'
  };
}

module.exports = {
  computePriorityScore,
  titleForPoints,
  nextTitleInfo,
  POINTS,
  estimateResolutionConfidence,
  CATEGORY_WEIGHT
};