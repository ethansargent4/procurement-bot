import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import path from 'node:path';

/**
 * Load a hand-curated supplier list from data/suppliers.csv.
 * CSV columns: name,email,website,tags,notes
 * tags is a semicolon-separated list (e.g. "generators;diesel")
 */
export async function loadManualSuppliers(filePath) {
  const p = filePath || path.resolve('data/suppliers.csv');
  try {
    const text = await readFile(p, 'utf8');
    const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
    return rows.map(r => ({
      name: r.name,
      email: r.email || null,
      website: r.website || null,
      source: 'manual',
      tags: r.tags ? r.tags.split(';').map(s => s.trim()).filter(Boolean) : [],
      notes: r.notes || null,
    })).filter(s => s.name);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[manual-suppliers]', e.message);
    return [];
  }
}

export function matchManualSuppliers(suppliers, requirements) {
  const needle = (requirements.item || '').toLowerCase();
  return suppliers.filter(s => {
    if (!s.tags || !s.tags.length) return false;
    return s.tags.some(t => needle.includes(t.toLowerCase()) || t.toLowerCase().includes(needle));
  });
}
