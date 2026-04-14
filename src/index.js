import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { config } from './config.js';
import { api } from './routes/api.js';
import { oauth } from './routes/oauth.js';
import { runAll } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '2mb' }));

// Optional dashboard password — very simple shared-secret gate.
app.use((req, res, next) => {
  if (!config.dashboardPassword) return next();
  if (req.path.startsWith('/oauth') || req.path === '/healthz') return next();
  const auth = req.headers.authorization || '';
  const ok = auth === `Bearer ${config.dashboardPassword}` || req.query.key === config.dashboardPassword;
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', api);
app.use('/oauth', oauth);

// Serve dashboard
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(config.port, () => console.log(`[web] listening on :${config.port}`));

// Cron
cron.schedule(config.cronSchedule, async () => {
  try { console.log('[cron]', await runAll()); } catch (e) { console.error('[cron]', e); }
});
