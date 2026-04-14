import { request } from 'undici';
import { config } from '../config.js';

/**
 * Use Serper (https://serper.dev) to search the open web for suppliers/distributors
 * of whatever item the opportunity calls for.
 */
export async function searchSerper(queryText, num = 10) {
  if (!config.serperApiKey) return [];
  const { statusCode, body } = await request('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': config.serperApiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ q: queryText, num }),
  });
  const text = await body.text();
  if (statusCode >= 400) {
    console.warn('[serper]', statusCode, text.slice(0, 200));
    return [];
  }
  const json = JSON.parse(text);
  const organic = json.organic || [];
  return organic.map(r => ({
    name: r.title,
    website: r.link,
    email: null,
    source: 'serper',
    notes: r.snippet,
  }));
}

export async function findSuppliersFromWeb(requirements) {
  const q = `${requirements.item} supplier distributor manufacturer "contact" OR "quote"`;
  return searchSerper(q, 10);
}
