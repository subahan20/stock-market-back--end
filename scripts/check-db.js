/**
 * Status checker for the Supabase tables this app depends on.
 *
 * Reports:
 *   - Whether the table exists at all (via a 1-row probe).
 *   - Approximate row count.
 *   - Which migration file would create it if missing.
 *
 * Run:  node scripts/check-db.js
 * (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in `.env`)
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getSupabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../migrations');

const checks = [
  { table: env.tables.users, migration: '001_create_users_table.sql' },
  { table: env.tables.stocks, migration: '002_create_stocks_table.sql' },
  { table: env.tables.portfolio, migration: '003_create_portfolio_table.sql' },
  { table: env.tables.aiAnalysis, migration: '004_create_ai_analysis_table.sql' },
  { table: env.tables.watchlist, migration: '003_create_portfolio_table.sql' },
  { table: env.tables.alerts, migration: '003_create_portfolio_table.sql' },
  { table: env.tables.stockChartHistory, migration: '009_create_stock_chart_history.sql' },
  { table: env.tables.aiEmailReports, migration: '010_create_ai_email_reports.sql' },
];

function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') return true;
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    msg.includes('relation')
  );
}

async function probeTable(client, table) {
  // Use a real SELECT (not just HEAD/count) so PostgREST's PGRST205 surfaces in the error object.
  try {
    const { error, count } = await client.from(table).select('*', { count: 'exact' }).limit(1);
    if (error) {
      if (isMissingTableError(error)) return { exists: false };
      return { exists: true, rows: null, error: String(error.message || error.code) };
    }
    return { exists: true, rows: count ?? 0 };
  } catch (e) {
    return { exists: false, error: String(e?.message || e) };
  }
}

async function main() {
  const client = getSupabaseAdmin();
  if (!client) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.');
    process.exit(2);
  }
  console.log(`Supabase URL: ${env.supabaseUrl}\n`);
  console.log('Table status (table — exists — approx rows):');

  const missing = [];
  for (const { table, migration } of checks) {
    const r = await probeTable(client, table);
    const tag = r.exists ? '✓' : '✗';
    const rows = r.exists ? (r.rows == null ? 'n/a' : r.rows) : '—';
    console.log(`  ${tag}  ${table.padEnd(24)}  rows=${rows}${r.error ? '  (err: ' + r.error + ')' : ''}`);
    if (!r.exists) missing.push({ table, migration });
  }

  if (!missing.length) {
    console.log('\nAll required tables present.');
    return;
  }

  console.log('\nMissing tables. Paste each of the following SQL files into Supabase SQL Editor');
  console.log('(https://app.supabase.com → your project → SQL → New query → Run):\n');
  for (const { table, migration } of missing) {
    console.log(`──── ${table} ────────────────`);
    console.log(`-- File: backend/migrations/${migration}`);
    const sql = await readFile(path.join(migrationsDir, migration), 'utf8');
    console.log(sql.trim());
    console.log('');
  }

  console.log('\nAfter running each block in the SQL Editor, re-run:  node scripts/check-db.js');
}

main().catch((e) => {
  console.error('check-db failed:', e?.message || e);
  process.exit(1);
});
