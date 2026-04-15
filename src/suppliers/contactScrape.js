import { request } from 'undici';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK = /(example|test|sentry|wixpress|godaddy|squarespace|cloudflare|sentry\.io|noreply|no-reply)/i;

function pickBestEmail(candidates, domain) {
  const unique = [...new Set(candidates)].filter(e => !JUNK.test(e));
  if (unique.length === 0) return null;
  // Prefer sales@/rfq@/quotes@/info@ on same domain
  const sameDomain = unique.filter(e => e.endsWith('@' + domain));
  const pool = sameDomain.length ? sameDomain : unique;
  const priorities = ['rfq@', 'quote', 'sales@', 'info@', 'contact@', 'orders@'];
  for (const p of priorities) {
    const hit = pool.find(e => e.toLowerCase().startsWith(p));
    if (hit) return hit;
  }
  return pool[0];
}

async function fetchText(url, timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { 'user-agent': 'Mozilla/5.0 ProcurementBot/1.0' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (statusCode >= 400) return '';
    const text = await body.text();
    return text.slice(0, 200_000);
  } catch {
    return '';
  }
}

/**
 * Given a supplier homepage URL, try homepage and common contact URLs
 * and return the best email found. Returns null if none.
 */
export async function scrapeSupplierEmail(homepageUrl) {
  let host;
  try { host = new URL(homepageUrl).hostname.replace(/^www\./, ''); } catch { return null; }
  const base = `https://${host}`;
  const paths = ['', '/contact', '/contact-us', '/about', '/quote', '/rfq', '/sales'];
  const found = [];
  for (const p of paths) {
    const html = await fetchText(base + p);
    if (!html) continue;
    const emails = html.match(EMAIL_RE) || [];
    found.push(...emails);
    if (found.length >= 3) break;
  }
  return pickBestEmail(found, host);
}

/**
 * Batch-enrich a supplier list with emails by scraping contact pages.
 * Only hits suppliers that don't already have an email. Caps concurrency.
 */
export async function enrichSupplierEmails(suppliers, limit = 10) {
  const targets = suppliers.filter(s => !s.email && s.website).slice(0, limit);
  await Promise.all(targets.map(async s => {
    s.email = await scrapeSupplierEmail(s.website);
  }));
  return suppliers;
}
