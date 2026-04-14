import { Router } from 'express';
import { authUrl, exchangeCode } from '../gmail.js';

export const oauth = Router();

oauth.get('/google', (_req, res) => {
  res.redirect(authUrl());
});

oauth.get('/google/callback', async (req, res) => {
  try {
    const tokens = await exchangeCode(req.query.code);
    res.type('html').send(`<!doctype html>
<h1>Gmail connected</h1>
<p>Copy this refresh token into your Railway env as <code>GOOGLE_REFRESH_TOKEN</code> and redeploy:</p>
<pre style="background:#f4f4f4;padding:12px;border-radius:6px;word-break:break-all;">${tokens.refresh_token || '(no refresh_token — re-run with prompt=consent)'}</pre>
<p>Then <a href="/">go to dashboard</a>.</p>`);
  } catch (e) {
    res.status(500).send(e.message);
  }
});
