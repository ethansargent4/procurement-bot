import { config } from './config.js';
import { db } from './db.js';
import { fetchOpportunities, scoreOpportunity, normalize } from './sam.js';
import { discoverSuppliers } from './suppliers/index.js';
import { extractRequirements, draftSupplierEmail, parseQuoteReply, draftBid } from './llm.js';
import { sendEmail, fetchReplies } from './gmail.js';

/** 1. Poll SAM.gov and upsert new opportunities. */
export async function pollStep() {
  const opps = await fetchOpportunities();
  let inserted = 0;
  for (const raw of opps) {
    const score = scoreOpportunity(raw);
    if (score < config.minScore) continue;
    const row = normalize(raw, score);
    await db.upsertOpportunity(row);
    inserted++;
  }
  return { fetched: opps.length, kept: inserted };
}

/** 2. For each 'new' opportunity, discover suppliers and queue outreach. */
export async function researchStep(limit = 5) {
  const opps = (await db.listOpportunities({ status: 'new' })).slice(0, limit);
  const results = [];
  for (const opp of opps) {
    await db.setOpportunityStatus(opp.id, 'researching');
    let requirements;
    try {
      requirements = await extractRequirements(opp);
    } catch (e) {
      console.warn('[research] req extract failed', opp.id, e.message);
      requirements = { item: opp.title, quantity: null, specs: [], delivery_location: null, delivery_deadline: null, key_terms: [] };
    }
    const suppliers = await discoverSuppliers(opp, requirements);
    for (const s of suppliers.slice(0, 5)) {
      if (!s.email) continue; // only contact suppliers with an email
      const sup = await db.upsertSupplier(s);
      await db.createOutreach({
        opportunity_id: opp.id,
        supplier_id: sup?.id || null,
        supplier_name: s.name,
        supplier_email: s.email,
      });
    }
    await db.setOpportunityStatus(opp.id, 'outreach');
    results.push({ opp: opp.id, suppliersQueued: suppliers.filter(s => s.email).length });
  }
  return results;
}

/** 3. Send queued outreach emails. */
export async function outreachStep(limit = 10) {
  const all = await db.listAllOutreach();
  const queued = all.filter(o => o.status === 'queued').slice(0, limit);
  const results = [];
  for (const o of queued) {
    const opp = await db.getOpportunity(o.opportunity_id);
    if (!opp) continue;
    try {
      const reqs = await extractRequirements(opp);
      const body = await draftSupplierEmail(opp, reqs);
      const subject = `RFQ: ${opp.title}`.slice(0, 120);
      const sent = await sendEmail({ to: o.supplier_email, subject, body });
      await db.updateOutreach(o.id, {
        status: 'sent',
        sent_at: new Date(),
        thread_id: sent.threadId,
        message_id: sent.messageId,
        last_message: body,
      });
      results.push({ outreachId: o.id, ok: true });
    } catch (e) {
      console.warn('[outreach] send failed', o.id, e.message);
      results.push({ outreachId: o.id, ok: false, error: e.message });
    }
  }
  return results;
}

/** 4. Check for supplier replies, parse into quotes. */
export async function checkRepliesStep() {
  const all = await db.listAllOutreach();
  const open = all.filter(o => o.status === 'sent' && o.thread_id);
  const results = [];
  for (const o of open) {
    try {
      const replies = await fetchReplies(o.thread_id);
      if (!replies.length) continue;
      const latest = replies[replies.length - 1];
      const parsed = await parseQuoteReply(latest.body || latest.snippet || '');
      await db.createQuote({
        outreach_id: o.id,
        opportunity_id: o.opportunity_id,
        supplier_id: o.supplier_id,
        unit_price: parsed.unit_price,
        quantity: parsed.quantity,
        total_price: parsed.total_price,
        lead_time_days: parsed.lead_time_days,
        currency: parsed.currency || 'USD',
        terms: parsed.terms || '',
        raw_text: latest.body || latest.snippet,
        parsed_confidence: parsed.confidence || 0,
      });
      await db.updateOutreach(o.id, { status: 'quoted', replied_at: new Date(), last_message: latest.body });
      results.push({ outreachId: o.id, ok: true });
    } catch (e) {
      console.warn('[replies] fetch failed', o.id, e.message);
    }
  }
  return results;
}

/** 5. For opportunities with at least one quote, draft a bid for human approval. */
export async function bidDraftStep() {
  const opps = await db.listOpportunities({ status: 'outreach' });
  const results = [];
  for (const opp of opps) {
    const quotes = await db.listQuotesFor(opp.id);
    if (!quotes.length) continue;
    const cheapest = quotes[0];
    if (!cheapest.total_price) continue;

    const { draft_text, bid_amount } = await draftBid(opp, cheapest, config.defaultMarginPct);
    if (bid_amount && bid_amount > config.maxBidAmount) {
      console.warn(`[bid] skipping ${opp.id}, bid $${bid_amount} > max $${config.maxBidAmount}`);
      continue;
    }
    await db.createBid({
      opportunity_id: opp.id,
      quote_id: cheapest.id,
      bid_amount,
      margin_pct: config.defaultMarginPct,
      draft_text,
    });
    await db.setOpportunityStatus(opp.id, 'pending_approval');
    results.push({ opp: opp.id, bid_amount });
  }
  return results;
}

/** Full pipeline. */
export async function runAll() {
  const out = {};
  try { out.poll = await pollStep(); } catch (e) { out.poll = { error: e.message }; }
  try { out.research = await researchStep(); } catch (e) { out.research = { error: e.message }; }
  try { out.outreach = await outreachStep(); } catch (e) { out.outreach = { error: e.message }; }
  try { out.replies = await checkRepliesStep(); } catch (e) { out.replies = { error: e.message }; }
  try { out.bids = await bidDraftStep(); } catch (e) { out.bids = { error: e.message }; }
  return out;
}
