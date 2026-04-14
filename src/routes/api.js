import { Router } from 'express';
import { db } from '../db.js';
import { runAll, pollStep, researchStep, outreachStep, checkRepliesStep, bidDraftStep } from '../bot.js';
import { config } from '../config.js';

export const api = Router();

// --- Opportunities ---
api.get('/opportunities', async (req, res) => {
  const rows = await db.listOpportunities({ status: req.query.status });
  res.json(rows);
});

api.get('/opportunities/:id', async (req, res) => {
  const opp = await db.getOpportunity(req.params.id);
  if (!opp) return res.status(404).json({ error: 'not found' });
  const outreach = await db.listOutreachFor(req.params.id);
  const quotes = await db.listQuotesFor(req.params.id);
  res.json({ ...opp, outreach, quotes });
});

api.post('/opportunities/:id/status', async (req, res) => {
  await db.setOpportunityStatus(req.params.id, req.body.status);
  res.json({ ok: true });
});

// --- Outreach (all of it, for the flowchart) ---
api.get('/outreach', async (_req, res) => {
  res.json(await db.listAllOutreach());
});

// --- Bids / Approval queue ---
api.get('/bids', async (req, res) => {
  res.json(await db.listBids(req.query.status));
});

api.post('/bids/:id/approve', async (req, res) => {
  await db.updateBid(req.params.id, {
    status: 'approved',
    approved_at: new Date(),
  });
  // NOTE: Actual SAM.gov submission is not implemented here.
  // In human-approval mode, "approved" just means the user OK'd the draft.
  // You then submit on SAM.gov manually OR extend this route to use a SAM.gov
  // submission integration if/when one is available.
  res.json({ ok: true });
});

api.post('/bids/:id/reject', async (req, res) => {
  await db.updateBid(req.params.id, { status: 'rejected' });
  res.json({ ok: true });
});

api.post('/bids/:id/mark-submitted', async (req, res) => {
  await db.updateBid(req.params.id, {
    status: 'submitted',
    submitted_at: new Date(),
  });
  res.json({ ok: true });
});

api.post('/bids/:id/mark-won', async (req, res) => {
  const bid = (await db.listBids()).find(b => b.id === Number(req.params.id));
  if (!bid) return res.status(404).json({ error: 'not found' });
  await db.updateBid(bid.id, { status: 'won', result: 'won' });
  const opp = await db.getOpportunity(bid.opportunity_id);
  await db.setOpportunityStatus(bid.opportunity_id, 'won');
  await db.createProject({
    opportunity_id: bid.opportunity_id,
    bid_id: bid.id,
    title: opp?.title || 'Awarded project',
    award_amount: bid.bid_amount,
    status: 'active',
  });
  res.json({ ok: true });
});

api.post('/bids/:id/mark-lost', async (req, res) => {
  const bid = (await db.listBids()).find(b => b.id === Number(req.params.id));
  if (bid) {
    await db.updateBid(bid.id, { status: 'lost', result: 'lost' });
    await db.setOpportunityStatus(bid.opportunity_id, 'lost');
  }
  res.json({ ok: true });
});

// --- Projects (won & fulfilling) ---
api.get('/projects', async (_req, res) => {
  res.json(await db.listProjects());
});

api.post('/projects/:id', async (req, res) => {
  await db.updateProject(req.params.id, req.body);
  res.json({ ok: true });
});

// --- Suppliers ---
api.get('/suppliers', async (_req, res) => {
  res.json(await db.listSuppliers());
});

// --- Manual triggers ---
api.post('/run/all', async (_req, res) => { res.json(await runAll()); });
api.post('/run/poll', async (_req, res) => { res.json(await pollStep()); });
api.post('/run/research', async (_req, res) => { res.json(await researchStep()); });
api.post('/run/outreach', async (_req, res) => { res.json(await outreachStep()); });
api.post('/run/replies', async (_req, res) => { res.json(await checkRepliesStep()); });
api.post('/run/bids', async (_req, res) => { res.json(await bidDraftStep()); });

// --- Config info ---
api.get('/config', (_req, res) => {
  res.json({
    naicsCodes: config.naicsCodes,
    pscCodes: config.pscCodes,
    keywords: config.keywords,
    minScore: config.minScore,
    cronSchedule: config.cronSchedule,
    maxBidAmount: config.maxBidAmount,
    defaultMarginPct: config.defaultMarginPct,
    samKeyConfigured: Boolean(config.samApiKey),
    gmailConfigured: Boolean(config.googleRefreshToken),
    anthropicConfigured: Boolean(config.anthropicApiKey),
    serperConfigured: Boolean(config.serperApiKey),
  });
});
