import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl && config.databaseUrl.includes('railway') ? { rejectUnauthorized: false } : undefined,
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Convenience helpers
export const db = {
  async listOpportunities(filter = {}) {
    const where = [];
    const params = [];
    if (filter.status) { params.push(filter.status); where.push(`status = $${params.length}`); }
    const sql = `SELECT * FROM opportunities ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY score DESC NULLS LAST, posted_at DESC LIMIT 200`;
    return (await query(sql, params)).rows;
  },

  async upsertOpportunity(opp) {
    const sql = `
      INSERT INTO opportunities (id, title, agency, naics, psc, description, response_deadline, posted_at, link, raw, score, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new')
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        response_deadline = EXCLUDED.response_deadline,
        raw = EXCLUDED.raw,
        score = EXCLUDED.score,
        updated_at = now()
      RETURNING *
    `;
    const r = await query(sql, [
      opp.id, opp.title, opp.agency, opp.naics, opp.psc, opp.description,
      opp.response_deadline, opp.posted_at, opp.link, opp.raw, opp.score,
    ]);
    return r.rows[0];
  },

  async setOpportunityStatus(id, status) {
    await query('UPDATE opportunities SET status=$2, updated_at=now() WHERE id=$1', [id, status]);
  },

  async getOpportunity(id) {
    const r = await query('SELECT * FROM opportunities WHERE id=$1', [id]);
    return r.rows[0];
  },

  async listSuppliers() {
    return (await query('SELECT * FROM suppliers ORDER BY name')).rows;
  },

  async upsertSupplier(s) {
    const sql = `
      INSERT INTO suppliers (name, email, website, source, tags, notes)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    const r = await query(sql, [s.name, s.email || null, s.website || null, s.source || 'manual', s.tags || null, s.notes || null]);
    return r.rows[0];
  },

  async createOutreach(o) {
    const sql = `
      INSERT INTO outreach (opportunity_id, supplier_id, supplier_name, supplier_email, status)
      VALUES ($1,$2,$3,$4,'queued') RETURNING *
    `;
    const r = await query(sql, [o.opportunity_id, o.supplier_id || null, o.supplier_name, o.supplier_email]);
    return r.rows[0];
  },

  async updateOutreach(id, fields) {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map(k => fields[k]);
    await query(`UPDATE outreach SET ${sets} WHERE id=$1`, [id, ...values]);
  },

  async listOutreachFor(oppId) {
    return (await query('SELECT * FROM outreach WHERE opportunity_id=$1 ORDER BY created_at', [oppId])).rows;
  },

  async listAllOutreach() {
    return (await query('SELECT * FROM outreach ORDER BY created_at DESC LIMIT 500')).rows;
  },

  async createQuote(q) {
    const sql = `
      INSERT INTO quotes (outreach_id, opportunity_id, supplier_id, unit_price, quantity, total_price, lead_time_days, currency, terms, raw_text, parsed_confidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `;
    const r = await query(sql, [q.outreach_id, q.opportunity_id, q.supplier_id || null, q.unit_price, q.quantity, q.total_price, q.lead_time_days, q.currency || 'USD', q.terms, q.raw_text, q.parsed_confidence]);
    return r.rows[0];
  },

  async listQuotesFor(oppId) {
    return (await query('SELECT * FROM quotes WHERE opportunity_id=$1 ORDER BY total_price ASC NULLS LAST', [oppId])).rows;
  },

  async createBid(b) {
    const sql = `
      INSERT INTO bids (opportunity_id, quote_id, bid_amount, margin_pct, draft_text, status)
      VALUES ($1,$2,$3,$4,$5,'pending_approval') RETURNING *
    `;
    const r = await query(sql, [b.opportunity_id, b.quote_id, b.bid_amount, b.margin_pct, b.draft_text]);
    return r.rows[0];
  },

  async listBids(status) {
    const sql = status
      ? 'SELECT * FROM bids WHERE status=$1 ORDER BY created_at DESC'
      : 'SELECT * FROM bids ORDER BY created_at DESC';
    return (await query(sql, status ? [status] : [])).rows;
  },

  async updateBid(id, fields) {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map(k => fields[k]);
    await query(`UPDATE bids SET ${sets} WHERE id=$1`, [id, ...values]);
  },

  async listProjects() {
    return (await query('SELECT * FROM projects ORDER BY created_at DESC')).rows;
  },

  async createProject(p) {
    const sql = `
      INSERT INTO projects (opportunity_id, bid_id, supplier_id, title, award_amount, start_date, end_date, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `;
    const r = await query(sql, [p.opportunity_id, p.bid_id, p.supplier_id || null, p.title, p.award_amount, p.start_date || null, p.end_date || null, p.status || 'active', p.notes || null]);
    return r.rows[0];
  },

  async updateProject(id, fields) {
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map(k => fields[k]);
    await query(`UPDATE projects SET ${sets} WHERE id=$1`, [id, ...values]);
  },
};
