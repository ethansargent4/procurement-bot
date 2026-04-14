import { runAll } from './bot.js';
import { pool } from './db.js';

runAll()
  .then(r => { console.log(JSON.stringify(r, null, 2)); return pool.end(); })
  .then(() => process.exit(0))
  .catch(async e => { console.error(e); await pool.end(); process.exit(1); });
