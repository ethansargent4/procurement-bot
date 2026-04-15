import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

let client;
function getClient() {
  if (!client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not set');
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

async function complete(system, user, maxTokens = 1024) {
  const resp = await getClient().messages.create({
    model: config.anthropicModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return resp.content.map(b => b.text || '').join('');
}

/** Extract structured JSON from LLM output (strips code fences). */
function parseJson(text) {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

/**
 * Summarize an opportunity's requirements: what's being procured, quantity, specs.
 * Used both to brief suppliers and to score.
 */
export async function extractRequirements(opp) {
  const system = `You extract procurement requirements from US federal (DLA/DoD) contracting notices that typically request parts by NSN (National Stock Number). Return ONLY JSON with these keys:
- nsn: string or null (format "1234-56-789-0123", 13 digits with dashes — extract from title/description)
- part_number: string or null (manufacturer P/N)
- cage_code: string or null (5-char approved source)
- item: short human description of the part
- quantity: number or null
- unit_of_issue: string or null (EA, BX, RO, etc.)
- specs: array of spec strings
- approved_sources: array of manufacturer names listed as acceptable
- delivery_location: string or null
- delivery_deadline: ISO date or null
- fob: "origin" | "destination" | null
- response_deadline: ISO date or null (when quote must be submitted to gov)
- key_terms: array of critical phrases (e.g. "QPL", "first article", "trace required")
Extract NSN carefully — it may appear as "NSN:", "NSN", "NIIN", or embedded in the description. Return nulls when absent.`;
  const user = `Title: ${opp.title}\nPSC: ${opp.psc || ''}\nNAICS: ${opp.naics || ''}\n\nDescription:\n${opp.description || '(none)'}`;
  const text = await complete(system, user, 1000);
  const parsed = parseJson(text);
  if (parsed) return parsed;

  // Regex fallback so we still get NSN even without LLM
  const nsnMatch = (opp.description || opp.title || '').match(/\b(\d{4}[- ]?\d{2}[- ]?\d{3}[- ]?\d{4})\b/);
  return {
    nsn: nsnMatch ? nsnMatch[1].replace(/\s/g, '-') : null,
    part_number: null, cage_code: null,
    item: opp.title, quantity: null, unit_of_issue: null,
    specs: [], approved_sources: [],
    delivery_location: null, delivery_deadline: null, fob: null,
    response_deadline: null, key_terms: [],
  };
}

/** Draft a supplier RFQ email body. */
export async function draftSupplierEmail(opp, requirements) {
  const system = 'You draft short, professional RFQ (Request for Quote) emails to industrial suppliers on behalf of a US government contractor. Be direct, list specs as bullets, ask for unit price, total, lead time, and payment terms. No pleasantries. Return ONLY the email body (no subject line).';
  const user = `Opportunity: ${opp.title}\nRequirements JSON:\n${JSON.stringify(requirements, null, 2)}\n\nWrite an RFQ email body.`;
  return complete(system, user, 700);
}

/** Parse a supplier reply into a structured quote. */
export async function parseQuoteReply(replyText) {
  const system = 'You extract quote details from supplier email replies. Return ONLY JSON with keys: unit_price (number or null), quantity (number or null), total_price (number or null), lead_time_days (number or null), currency (3-letter code, default USD), terms (string), confidence (0..1). Use null when absent.';
  const text = await complete(system, `Supplier reply:\n\n${replyText}`, 600);
  return parseJson(text) || { unit_price: null, quantity: null, total_price: null, lead_time_days: null, currency: 'USD', terms: '', confidence: 0 };
}

/** Draft a bid response for human approval. */
export async function draftBid(opp, quote, marginPct) {
  const markup = quote.total_price ? Number(quote.total_price) * (1 + marginPct / 100) : null;
  const system = 'You draft US federal contracting bid responses. Concise, professional, include pricing, delivery terms, and contractor obligations. Return ONLY the bid text.';
  const user = `Opportunity: ${opp.title}\nAgency: ${opp.agency}\nDescription: ${opp.description || ''}\n\nSelected supplier quote:\n${JSON.stringify(quote, null, 2)}\n\nOur bid amount (supplier cost + ${marginPct}% margin): $${markup?.toFixed(2) || 'TBD'}\n\nDraft a bid response.`;
  const text = await complete(system, user, 1200);
  return { draft_text: text, bid_amount: markup };
}
