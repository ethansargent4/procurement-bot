import { findSuppliersFromWeb } from './serper.js';
import { findRegisteredVendors } from './samEntities.js';
import { loadManualSuppliers, matchManualSuppliers } from './manual.js';
import { enrichSupplierEmails } from './contactScrape.js';

/**
 * Combine all three supplier sources, dedupe by (name + email).
 */
export async function discoverSuppliers(opp, requirements) {
  const [manual, webResults, vendorResults] = await Promise.all([
    loadManualSuppliers(),
    findSuppliersFromWeb(requirements),
    findRegisteredVendors(opp.naics),
  ]);

  const manualMatches = matchManualSuppliers(manual, requirements);

  const all = [...manualMatches, ...vendorResults, ...webResults];

  // Dedupe
  const seen = new Set();
  const out = [];
  for (const s of all) {
    const key = `${(s.name || '').toLowerCase()}|${(s.email || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }

  // Scrape contact pages to fill in missing emails (up to 10 suppliers)
  await enrichSupplierEmails(out, 10);

  // Prefer suppliers with an email (we can actually contact them)
  out.sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0));
  return out;
}
