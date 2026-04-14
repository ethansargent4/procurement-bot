import { google } from 'googleapis';
import { config } from './config.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

export function oauthClient() {
  const c = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
  if (config.googleRefreshToken) {
    c.setCredentials({ refresh_token: config.googleRefreshToken });
  }
  return c;
}

export function authUrl() {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

export async function exchangeCode(code) {
  const c = oauthClient();
  const { tokens } = await c.getToken(code);
  return tokens; // caller should persist refresh_token
}

function gmailClient() {
  return google.gmail({ version: 'v1', auth: oauthClient() });
}

function makeRawMessage({ to, from, subject, body, threadHeaders = {} }) {
  const headers = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    ...Object.entries(threadHeaders).map(([k, v]) => `${k}: ${v}`),
  ];
  const msg = headers.join('\r\n') + '\r\n\r\n' + body;
  return Buffer.from(msg).toString('base64url');
}

export async function sendEmail({ to, subject, body, threadId }) {
  if (!config.googleRefreshToken) throw new Error('Gmail not authorized. Visit /oauth/google to connect.');
  const from = `${config.fromName} <${config.fromAddress}>`;
  const raw = makeRawMessage({ to, from, subject, body });
  const gmail = gmailClient();
  const r = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId },
  });
  return { messageId: r.data.id, threadId: r.data.threadId };
}

/**
 * Pull replies from a given thread. Returns any messages NOT authored by us.
 */
export async function fetchReplies(threadId) {
  if (!config.googleRefreshToken) return [];
  const gmail = gmailClient();
  const r = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const msgs = r.data.messages || [];
  const ours = new Set();
  for (const m of msgs) {
    const from = (m.payload.headers || []).find(h => h.name.toLowerCase() === 'from')?.value || '';
    if (config.fromAddress && from.toLowerCase().includes(config.fromAddress.toLowerCase())) ours.add(m.id);
  }
  const replies = msgs.filter(m => !ours.has(m.id)).map(m => ({
    id: m.id,
    snippet: m.snippet,
    body: extractBody(m.payload),
    internalDate: m.internalDate,
  }));
  return replies;
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8');
    }
  }
  for (const part of payload.parts || []) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}
