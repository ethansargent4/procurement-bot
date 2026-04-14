-- Procurement bot schema

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,                       -- SAM.gov noticeId
  title TEXT NOT NULL,
  agency TEXT,
  naics TEXT,
  psc TEXT,                                  -- Product Service Code
  description TEXT,
  response_deadline TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  link TEXT,
  raw JSONB,
  score REAL,
  status TEXT NOT NULL DEFAULT 'new',
    -- new | researching | outreach | quoted | bid_draft
    -- | pending_approval | submitted | won | lost | skipped
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  website TEXT,
  source TEXT,                               -- manual | serper | sam_entity
  tags TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outreach (
  id SERIAL PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  supplier_email TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
    -- queued | sent | replied | quoted | declined | no_response
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  thread_id TEXT,
  message_id TEXT,
  last_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  outreach_id INT REFERENCES outreach(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  supplier_id INT,
  unit_price NUMERIC,
  quantity INT,
  total_price NUMERIC,
  lead_time_days INT,
  currency TEXT DEFAULT 'USD',
  terms TEXT,
  raw_text TEXT,
  parsed_confidence REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bids (
  id SERIAL PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  quote_id INT REFERENCES quotes(id),
  bid_amount NUMERIC,
  margin_pct REAL,
  draft_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
    -- draft | pending_approval | approved | submitted | rejected | won | lost
  approved_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id),
  bid_id INT REFERENCES bids(id),
  supplier_id INT REFERENCES suppliers(id),
  title TEXT NOT NULL,
  award_amount NUMERIC,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
    -- active | shipped | delivered | completed | issue
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opps_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_outreach_opp ON outreach(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_quotes_opp ON quotes(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_bids_status ON bids(status);
