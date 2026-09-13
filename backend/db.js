'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
}

function needsSSL(url) {
    if (!url) return false;
    if (url.includes('sslmode=require')) return true;
    if (url.includes('.render.com')) return true;
    if (url.includes('.neon.tech')) return true;
    if (process.env.PGSSLMODE === 'require') return true;
    return false;
}

const pool = new Pool({
    connectionString,
    ssl: needsSSL(connectionString) ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', (err) => console.error('PG pool error:', err.message));

async function initSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(schema);
    console.log('✅ Database schema ready');
}

module.exports = { pool, initSchema };
