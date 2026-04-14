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
 * Heuristic score 0..1. Prefers supply-type NAICS, has clear description, deadline in future.
 * Swap for LLM-based scoring in llm.js if you want smarter ranking.
 */
export function scoreOpportunity(opp) {
  let score = 0.2; // base

  const haystack = [opp.title, opp.description, opp.classificationCode].filter(Boolean).join(' ').toLowerCase();

  if (config.keywords.length) {
    const hits = config.keywords.filter(k => haystack.includes(k.toLowerCase())).length;
    score += Math.min(0.4, hits * 0.1);
  } else {
    score += 0.2;
  }

  // NAICS match
  if (opp.naicsCode && config.naicsCodes.some(c => opp.naicsCode.startsWith(c))) {
    score += 0.2;
  }

  // Has clear response deadline in future
  if (opp.responseDeadLine) {
    const dl = new Date(opp.responseDeadLine);
    if (!Number.isNaN(dl.getTime()) && dl > new Date()) score += 0.1;
  }

  // Description is substantive
  if (opp.description && opp.description.length > 100) score += 0.1;

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
