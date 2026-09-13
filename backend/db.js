'use strict';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) { console.error('❌ DATABASE_URL missing'); process.exit(1); }

function needsSSL(u) {
    return !!u && (
        u.includes('sslmode=require') ||
        u.includes('.render.com') ||
        u.includes('.neon.tech') ||
        process.env.PGSSLMODE === 'require'
    );
}

const pool = new Pool({
    connectionString: url,
    ssl: needsSSL(url) ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', e => console.error('PG error:', e.message));

async function initSchema() {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('✅ DB schema ready');
}

module.exports = { pool, initSchema };
