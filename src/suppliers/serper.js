import { request } from 'undici';
import { config } from '../config.js';

/**
 * Use Serper (https://serper.dev) to search the open web for suppliers/distributors.
 * For NSN part requests we fire multiple targeted queries instead of one generic one.
 */
async function searchSerper(queryText, num = 10) {
  if (!config.serperApiKey) return [];
  try {
    const { statusCode, body } = await request('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': config.serperApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ q: queryText, num }),
    });
    const text = await body.text();
    if (statusCode >= 400) {
      console.warn('[serper]', statusCode, text.slice(0, 200));
      return [];
    }
    const json = JSON.parse(text);
    return json.organic || [];
  } catch (e) {
    console.warn('[serper] fetch error:', e.message);
    return [];
  }
}

// Pull email addresses out of a text blob (title+snippet+link)
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
function extractEmails(...parts) {
  const joined = parts.filter(Boolean).join(' ');
  const found = joined.match(EMAIL_RE) || [];
  // Filter out obviously junk matches
  return [...new Set(found)].filter(e => !/example\.|test\.|sentry\./.test(e));
}

// Known NSN/military-parts distributor domains we trust as first-tier
const TRUSTED_DOMAINS = [
  'gsaadvantage.gov', 'dibbs.bsm.dla.mil', 'dla.mil',
  'nsn-now.com', 'nsnparts.com', 'iso-group.com', 'aviall.com',
  'ferguson.com', 'mcmaster.com', 'grainger.com', 'msc.com',
  'fastenal.com', 'aliancefastener.com', 'globalindustrial.com',
];
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function isTrusted(url) {
  const d = domainOf(url);
  return TRUSTED_DOMAINS.some(t => d === t || d.endsWith('.' + t));
}

function resultsToSuppliers(results, tag) {
  return results.map(r => ({
    name: r.title?.split(' - ')[0]?.slice(0, 120) || r.title || 'Unknown',
    website: r.link,
    email: extractEmails(r.title, r.snippet)[0] || null,
    source: `serper:${tag}`,
    notes: r.snippet,
    trusted: isTrusted(r.link),
    _domain: domainOf(r.link),
  }));
}

/**
 * NSN-driven supplier discovery. Fires up to 5 targeted queries in parallel:
 *   1. exact NSN + supplier/distributor
 *   2. exact NSN on GSA Advantage
 *   3. exact NSN on commercial NSN marketplaces
 *   4. part number + manufacturer
 *   5. generic item + RFQ contact (fallback)
 */
export async function findSuppliersFromWeb(requirements) {
  const nsn = requirements.nsn;
  const pn = requirements.part_number;
  const item = requirements.item;

  const queries = [];
  if (nsn) {
    queries.push([`"${nsn}" supplier OR distributor OR quote`, 'nsn-general']);
    queries.push([`"${nsn}" site:gsaadvantage.gov`, 'gsa']);
    queries.push([`"${nsn}" (nsnparts.com OR nsn-now.com OR iso-group.com)`, 'nsn-marketplaces']);
  }
  if (pn) {
    queries.push([`"${pn}" supplier distributor manufacturer quote email`, 'partnum']);
  }
  if (item && queries.length < 3) {
    queries.push([`${item} supplier distributor "request a quote" contact email`, 'item']);
  }
  if (queries.length === 0) return [];

  const batches = await Promise.all(queries.map(([q, tag]) =>
    searchSerper(q, 8).then(r => resultsToSuppliers(r, tag))
  ));

  // Flatten, dedupe by domain, sort trusted first, emails first
  const seen = new Set();
  const out = [];
  for (const batch of batches) {
    for (const s of batch) {
      if (!s._domain || seen.has(s._domain)) continue;
      seen.add(s._domain);
      out.push(s);
    }
  }
  out.sort((a, b) => {
    const ta = a.trusted ? 1 : 0, tb = b.trusted ? 1 : 0;
    if (ta !== tb) return tb - ta;
    const ea = a.email ? 1 : 0, eb = b.email ? 1 : 0;
    return eb - ea;
  });
  return out.slice(0, 20);
}
