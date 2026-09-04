require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.pqbdbjapmdskaziotrlk',
  password: process.env.DB_PASSWORD || 'Sinan@123@@',
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false
});

// Helper for queries
async function query(text, params = []) {
  return await pool.query(text, params);
}

async function get(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

async function all(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function run(text, params = []) {
  const res = await pool.query(text, params);
  return {
    rowCount: res.rowCount,
    rows: res.rows,
    lastInsertRowid: res.rows[0] ? (res.rows[0].id || res.rows[0].question_id) : null
  };
}

// Lightweight startup hook - schema & indexes are managed via migrate.js
async function initDb() {
  // Instant no-op at server runtime to avoid startup delays & cold-start latency
  return true;
}

// Export connection pool & helper methods
module.exports = {
  pool,
  query,
  get,
  all,
  run,
  initDb
};
