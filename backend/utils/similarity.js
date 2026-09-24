// Simple Jaccard similarity over lowercase word tokens.
// Lightweight stand-in for an NLP similarity model - fast and dependency-free,
// good enough to flag likely duplicate complaint text for a hackathon MVP.
function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(textA, textB) {
  const a = tokenize(textA);
  const b = tokenize(textB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

module.exports = { jaccardSimilarity };
