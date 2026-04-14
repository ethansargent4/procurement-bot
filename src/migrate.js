import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { query, pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
await query(sql);
console.log('[migrate] schema applied');
await pool.end();
