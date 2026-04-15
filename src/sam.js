import { request } from 'undici';
import { config } from './config.js';

function fmt(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/**
 * Poll SAM.gov Opportunities API for supply-type opportunities.
 * We filter by ptype=k,o (solicitation/combined) and the broad NAICS list in config.
 * Docs: https://open.gsa.gov/api/get-opportunities-public-api/
 */
export async function fetchOpportunities() {
  if (!config.samApiKey) throw new Error('SAM_API_KEY not set');

  const now = new Date();
  const past = new Date(now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000);

  // SAM.gov API only takes ONE ncode at a time reliably. Fan out.
  const naicsList = config.naicsCodes.length ? config.naicsCodes : [''];
  const all = [];
  const seen = new Set();

  for (const ncode of naicsList) {
    const params = new URLSearchParams({
      api_key: config.samApiKey,
      postedFrom: fmt(past),
      postedTo: fmt(now),
      limit: '100',
      ptype: 'o,k',
    });
    if (ncode) params.append('ncode', ncode);
    if (config.pscCodes.length) params.append('ccode', config.pscCodes.join(','));
    if (config.setAsides.length) params.append('typeOfSetAside', config.setAsides.join(','));

    const url = `${config.samBaseUrl}?${params.toString()}`;
    try {
      const { statusCode, body } = await request(url);
      const text = await body.text();
      if (statusCode >= 400) {
        console.warn(`[sam] ${statusCode} for ncode=${ncode}: ${text.slice(0, 200)}`);
        continue;
      }
      const json = JSON.parse(text);
      for (const o of json.opportunitiesData || []) {
        if (seen.has(o.noticeId)) continue;
        seen.add(o.noticeId);
        all.push(o);
      }
    } catch (e) {
      console.warn(`[sam] fetch error for ncode=${ncode}:`, e.message);
    }
  }

  return all;
}

/**
 * NSN-focused scoring. Rewards NSN/part-number patterns, numeric PSCs, and
 * hard-penalizes service/maintenance/construction titles. Returns 0..1.
 *
 * Tunable via env:
 *   EXCLUDE_KEYWORDS  — comma-separated substrings; any match in title => 0
 *   MAX_EST_VALUE     — if opp.awardAmount or estimated value exceeds this, => 0
 *                       (default 15000; set to 0 to disable)
 */
const NSN_RE = /\b\d{4}-?\d{2}-?\d{3}-?\d{4}\b/;
const PART_RE = /\b(p\/?n|part\s*(no|number|#)|nsn|national\s*stock)\b/i;
const QTY_RE = /\b(qty|quantity|each|ea\b|\bunits?\b)\s*[:\-]?\s*\d/i;

const DEFAULT_EXCLUDES = [
  'maintenance', 'repair', 'service', 'services', 'construction',
  'installation', 'janitorial', 'inspection', 'training', 'renovation',
  'demolition', 'landscaping', 'consulting', 'support services',
  'idiq services', 'painting', 'roofing', 'hvac',
];

export function scoreOpportunity(opp) {
  const title = (opp.title || '').toLowerCase();
  const desc = (opp.description || '').toLowerCase();
  const psc = (opp.classificationCode || '').toString();
  const haystack = `${title}\n${desc}`;

  // Hard exclude: service/maintenance/construction in title
  const excludes = config.excludeKeywords?.length ? config.excludeKeywords : DEFAULT_EXCLUDES;
  if (excludes.some(k => title.includes(k.toLowerCase()))) return 0;

  // Hard exclude: PSC is a letter (service), we only want numeric product PSCs
  if (psc && /^[A-Za-z]/.test(psc)) return 0;

  // Hard exclude: over max estimated value (if provided)
  const maxVal = config.maxEstValue;
  if (maxVal > 0) {
    const val = parseFloat(opp.award?.amount || opp.baseAndAllOptionsValue || 0);
    if (val && val > maxVal) return 0;
  }

  let score = 0.1; // base

  // Big reward: NSN pattern in description
  if (NSN_RE.test(haystack)) score += 0.5;
  // Medium reward: part-number language
  if (PART_RE.test(haystack)) score += 0.2;
  // Quantity language (clear supply request)
  if (QTY_RE.test(haystack)) score += 0.1;

  // PSC match against configured allowlist
  if (psc && config.pscCodes.length && config.pscCodes.some(c => psc.startsWith(c))) {
    score += 0.2;
  }
  // Numeric PSC even if not in allowlist = product, small reward
  else if (psc && /^\d/.test(psc)) {
    score += 0.05;
  }

  // Substantive description
  if (desc.length > 200) score += 0.05;

  // Response deadline in future
  if (opp.responseDeadLine) {
    const dl = new Date(opp.responseDeadLine);
    if (!Number.isNaN(dl.getTime()) && dl > new Date()) score += 0.05;
  }

  return Math.min(1, score);
}

/** Normalize a raw SAM opp to our DB row shape */
export function normalize(opp, score) {
  return {
    id: opp.noticeId,
    title: opp.title || 'Untitled',
    agency: opp.fullParentPathName || opp.departmentName || null,
    naics: opp.naicsCode || null,
    psc: opp.classificationCode || null,
    description: opp.description || null,
    response_deadline: opp.responseDeadLine ? new Date(opp.responseDeadLine) : null,
    posted_at: opp.postedDate ? new Date(opp.postedDate) : null,
    link: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
    raw: opp,
    score,
  };
}
