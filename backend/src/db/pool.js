const { Pool } = require('pg');

// A single shared pool for the app. Never construct a client with
// interpolated SQL strings — always use parameterized queries ($1, $2, ...)
// so user input can't be used for SQL injection.
//
// PGSSL=require enables SSL for managed Postgres providers (Render, Railway,
// Heroku, RDS, Supabase, etc.) that terminate with a cert the Node default
// trust store won't validate. Off by default so local/dev Postgres (which
// usually isn't configured for SSL) keeps working unchanged.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = pool;
