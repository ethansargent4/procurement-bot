import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  // Postgres (Railway auto-provides DATABASE_URL when you add the Postgres plugin)
  databaseUrl: process.env.DATABASE_URL || '',

  // --- SAM.gov ---
  samApiKey: process.env.SAM_API_KEY || '',
  samBaseUrl: 'https://api.sam.gov/opportunities/v2/search',

  // Broad supply-focused filters. Override via env.
  // Default NAICS covers wholesale/industrial supplies, machinery, motor vehicle parts, generators, etc.
  naicsCodes: (process.env.NAICS_CODES || '332,333,334,335,336,423,811').split(',').map(s => s.trim()).filter(Boolean),
  // PSC/FSC codes: 2500-2999 = vehicular, 6115 = generators, etc. Leave empty for any.
  pscCodes: (process.env.PSC_CODES || '').split(',').map(s => s.trim()).filter(Boolean),
  keywords: (process.env.KEYWORDS || '').split(',').map(s => s.trim()).filter(Boolean),
  setAsides: (process.env.SET_ASIDES || '').split(',').map(s => s.trim()).filter(Boolean),
  lookbackDays: parseInt(process.env.LOOKBACK_DAYS || '2', 10),
  minScore: parseFloat(process.env.MIN_SCORE || '0.3'),
  cronSchedule: process.env.CRON_SCHEDULE || '0 */4 * * *',

  // --- LLM (for quote parsing, supplier outreach drafts, bid drafts) ---
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  // --- Supplier discovery ---
  serperApiKey: process.env.SERPER_API_KEY || '', // https://serper.dev

  // --- Gmail OAuth ---
  // From Google Cloud Console → OAuth 2.0 Client ID (Web application)
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/google/callback',
  // Persisted after first OAuth flow. Store as JSON string in env for simplicity.
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  fromAddress: process.env.FROM_ADDRESS || '',
  fromName: process.env.FROM_NAME || 'Procurement',

  // --- Bidding guardrails (even in human-approval mode) ---
  maxBidAmount: parseFloat(process.env.MAX_BID_AMOUNT || '100000'),
  defaultMarginPct: parseFloat(process.env.DEFAULT_MARGIN_PCT || '15'),

  // --- Dashboard auth ---
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',
};
