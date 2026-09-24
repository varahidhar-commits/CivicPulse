// ==========================================================================
// Weather Risk Prediction — feeds into AI Priority Scoring
// ==========================================================================
// Pulls a live short-range forecast from Open-Meteo (free, no API key) for
// the complaint's coordinates, then runs it through a small logistic-
// regression-style model to estimate how much upcoming weather should raise
// the urgency of THIS category of complaint (e.g. heavy rain forecast makes
// a blocked drain or open pothole far more dangerous; extreme heat makes an
// uncollected garbage pile more of a health risk).
//
// This is intentionally a lightweight, explainable model — hand-set weights
// over real weather features — consistent with the rest of the app's "AI"
// layer. The weights are exposed as constants so they can be replaced with
// weights learned from real incident/outcome data later without touching
// the calling code.
// ==========================================================================

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — forecasts don't need to be fetched more often
const forecastCache = new Map(); // key: "lat,lng" rounded -> { fetchedAt, data }

function cacheKey(lat, lng) {
  // Round to ~1.1km grid so nearby complaints share one API call
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Fetches today's precipitation probability/amount, max temperature, and
 * max wind speed for a location. Returns null on any failure (offline,
 * API down, no fetch available) so callers can degrade gracefully —
 * a missing forecast should never block a complaint from being filed.
 */
async function fetchForecast(lat, lng) {
  const key = cacheKey(lat, lng);
  const cached = forecastCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  if (typeof fetch !== 'function') return null; // Node <18 without global fetch

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,windspeed_10m_max` +
      `&timezone=auto&forecast_days=2`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.daily;
    if (!d || !d.time || !d.time.length) return null;

    const data = {
      precipProbability: d.precipitation_probability_max?.[0] ?? 0, // %
      precipMm: d.precipitation_sum?.[0] ?? 0, // mm today
      maxTempC: d.temperature_2m_max?.[0] ?? 28,
      maxWindKph: d.windspeed_10m_max?.[0] ?? 10,
      fetchedAt: new Date().toISOString()
    };
    forecastCache.set(key, { fetchedAt: Date.now(), data });
    return data;
  } catch (e) {
    return null; // offline / API unreachable / timed out — fail soft
  }
}

// How much each complaint category is affected by rain vs. heat (0-1 sensitivity)
const RAIN_SENSITIVITY = {
  drainage: 1.0,
  pothole: 0.8,
  water_leakage: 0.7,
  road_damage: 0.6,
  electrical_hazard: 0.9,
  streetlight: 0.3,
  garbage: 0.3,
  encroachment: 0.15,
  stray_animals: 0.2,
  other: 0.3
};
const HEAT_SENSITIVITY = {
  garbage: 0.8,
  stray_animals: 0.6,
  drainage: 0.2,
  water_leakage: 0.2,
  other: 0.2,
  pothole: 0.1,
  road_damage: 0.1,
  electrical_hazard: 0.1,
  streetlight: 0.1,
  encroachment: 0.1
};

// Hand-set logistic regression weights (swap for learned weights later)
const W_RAIN_PROB = 2.0;
const W_PRECIP_MM = 2.5;
const W_WIND = 0.8;
const W_HEAT = 2.0;
const BIAS = -2.0;

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Runs the logistic-regression-style weather risk model for a given
 * category against a fetched forecast. Returns a risk score 0-1, a label,
 * and human-readable factors for the "why" explanation panel.
 */
function predictWeatherRisk(category, forecast) {
  if (!forecast) {
    return { riskScore: 0, label: 'Unknown', factors: [], forecast: null };
  }

  const rainSens = RAIN_SENSITIVITY[category] ?? RAIN_SENSITIVITY.other;
  const heatSens = HEAT_SENSITIVITY[category] ?? HEAT_SENSITIVITY.other;

  const rainProbNorm = Math.min(forecast.precipProbability / 100, 1);
  const precipNorm = Math.min(forecast.precipMm / 30, 1); // 30mm+/day = heavy rain
  const windNorm = Math.min(forecast.maxWindKph / 60, 1);
  const heatNorm = Math.max(0, Math.min((forecast.maxTempC - 35) / 10, 1)); // risk ramps above 35°C

  const z =
    BIAS +
    rainSens * (W_RAIN_PROB * rainProbNorm + W_PRECIP_MM * precipNorm + W_WIND * windNorm) +
    heatSens * (W_HEAT * heatNorm);

  const riskScore = Math.round(sigmoid(z) * 100) / 100;

  let label = 'Low';
  if (riskScore >= 0.66) label = 'High';
  else if (riskScore >= 0.33) label = 'Elevated';

  const factors = [];
  if (rainSens >= 0.5 && forecast.precipProbability >= 40) {
    factors.push({
      detail: `${Math.round(forecast.precipProbability)}% chance of rain, ~${forecast.precipMm.toFixed(1)}mm expected today`,
      riskScore
    });
  }
  if (heatSens >= 0.5 && forecast.maxTempC >= 35) {
    factors.push({
      detail: `Forecast high of ${forecast.maxTempC.toFixed(1)}°C — elevated health/odor risk`,
      riskScore
    });
  }

  return { riskScore, label, factors, forecast };
}

/**
 * Convenience wrapper: fetch + predict in one call. Never throws —
 * returns a zero-risk "Unknown" result on any failure so the caller's
 * priority scoring always has something safe to add.
 */
async function getWeatherRisk(lat, lng, category) {
  const forecast = await fetchForecast(lat, lng);
  return predictWeatherRisk(category, forecast);
}

// ==========================================================================
// Disaster Prevention — multi-day city forecast + hazard classification
// ==========================================================================
// A second, complementary layer on top of the per-complaint risk model
// above. Instead of scoring one complaint, this pulls a several-day
// outlook for a location (typically the city center) and classifies each
// day against fixed severity thresholds for the three hazards that matter
// most for a municipal ops team here: flooding from heavy rain, heatwave,
// and damaging wind/storm. The goal is to surface a warning BEFORE the
// event, while there's still time to clear drains, pre-position crews, or
// warn citizens — not just react after a complaint comes in.
//
// Thresholds are simplified, explainable versions of IMD (India
// Meteorological Department) rainfall/heat/wind advisory bands. They are
// plain constants so a civic ops team can tune them without touching the
// classification logic.
// ==========================================================================

const DISASTER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const disasterForecastCache = new Map(); // key: "lat,lng,days" -> { fetchedAt, data }

/**
 * Fetches a multi-day daily forecast (default 5 days) for a location.
 * Returns an array of { date, precipMm, precipProbability, maxTempC,
 * minTempC, maxWindKph, weatherCode } or null on any failure — callers
 * must degrade gracefully (e.g. show "forecast unavailable").
 */
async function fetchDisasterForecast(lat, lng, days = 5) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${days}`;
  const cached = disasterForecastCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < DISASTER_CACHE_TTL_MS) {
    return cached.data;
  }

  if (typeof fetch !== 'function') return null;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,windspeed_10m_max,weathercode` +
      `&timezone=auto&forecast_days=${Math.min(Math.max(days, 1), 7)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.daily;
    if (!d || !d.time || !d.time.length) return null;

    const data = d.time.map((date, i) => ({
      date,
      precipMm: d.precipitation_sum?.[i] ?? 0,
      precipProbability: d.precipitation_probability_max?.[i] ?? 0,
      maxTempC: d.temperature_2m_max?.[i] ?? 30,
      minTempC: d.temperature_2m_min?.[i] ?? 22,
      maxWindKph: d.windspeed_10m_max?.[i] ?? 10,
      weatherCode: d.weathercode?.[i] ?? 0
    }));
    disasterForecastCache.set(key, { fetchedAt: Date.now(), data });
    return data;
  } catch (e) {
    return null; // offline / API unreachable / timed out — fail soft
  }
}

// Severity ordering, used to find the worst hazard across a window of days
const SEVERITY_RANK = { None: 0, Watch: 1, Warning: 2, Severe: 3 };
function worseSeverity(a, b) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

const HAZARD_META = {
  flood: { icon: '🌊', label: 'Flood risk' },
  heatwave: { icon: '🌡️', label: 'Heatwave' },
  storm: { icon: '🌪️', label: 'High wind / storm' }
};

/**
 * Classifies a single day's forecast into 0-3 hazard alerts (flood,
 * heatwave, storm), each with a severity of Watch / Warning / Severe.
 * Returns the original day fields plus `alerts` and `worstSeverity`.
 */
function classifyDayRisk(day) {
  const alerts = [];

  // --- Flood / heavy-rain risk (based on IMD daily rainfall bands) ---
  if (day.precipMm >= 115 || (day.precipMm >= 64 && day.precipProbability >= 70)) {
    alerts.push({ type: 'flood', severity: 'Severe', message: `Very heavy rain expected (~${day.precipMm.toFixed(0)}mm) — high flooding risk in low-lying and drainage-blocked areas.` });
  } else if (day.precipMm >= 64 || (day.precipMm >= 35 && day.precipProbability >= 60)) {
    alerts.push({ type: 'flood', severity: 'Warning', message: `Heavy rain expected (~${day.precipMm.toFixed(0)}mm, ${Math.round(day.precipProbability)}% chance) — waterlogging likely near blocked drains.` });
  } else if (day.precipMm >= 20 || day.precipProbability >= 70) {
    alerts.push({ type: 'flood', severity: 'Watch', message: `Rain likely (${Math.round(day.precipProbability)}% chance, ~${day.precipMm.toFixed(0)}mm) — monitor drainage complaints.` });
  }

  // --- Heatwave risk ---
  if (day.maxTempC >= 40) {
    alerts.push({ type: 'heatwave', severity: 'Severe', message: `Extreme heat expected (${day.maxTempC.toFixed(0)}°C) — heatwave health advisory.` });
  } else if (day.maxTempC >= 37) {
    alerts.push({ type: 'heatwave', severity: 'Warning', message: `High temperatures expected (${day.maxTempC.toFixed(0)}°C) — elevated heat-stress and waste-odor risk.` });
  }

  // --- Wind / storm risk ---
  if (day.maxWindKph >= 90) {
    alerts.push({ type: 'storm', severity: 'Severe', message: `Damaging winds expected (~${day.maxWindKph.toFixed(0)} km/h) — storm warning, risk to trees, hoardings, and power lines.` });
  } else if (day.maxWindKph >= 60) {
    alerts.push({ type: 'storm', severity: 'Warning', message: `Strong winds expected (~${day.maxWindKph.toFixed(0)} km/h) — secure loose structures, check exposed electrical lines.` });
  } else if (day.maxWindKph >= 40) {
    alerts.push({ type: 'storm', severity: 'Watch', message: `Gusty winds expected (~${day.maxWindKph.toFixed(0)} km/h).` });
  }

  const worstSeverity = alerts.reduce((worst, a) => worseSeverity(worst, a.severity), 'None');
  return { ...day, alerts, worstSeverity };
}

module.exports = {
  getWeatherRisk,
  predictWeatherRisk,
  fetchForecast,
  fetchDisasterForecast,
  classifyDayRisk,
  worseSeverity,
  SEVERITY_RANK,
  HAZARD_META
};
