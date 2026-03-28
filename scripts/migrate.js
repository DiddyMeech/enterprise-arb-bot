const { Pool } = require('pg');
const config = require('../packages/config');
const fs = require('fs');
const path = require('path');

async function migrate() {
    console.log("=== 🛠️ ENTERPRISE ARBITRAGE SQL MIGRATION ===");
    
    if (!config.DATABASE_URL) {
        console.error("❌ CRITICAL: DATABASE_URL missing from .env");
        process.exit(1);
    }
    
    const pool = new Pool({ connectionString: config.DATABASE_URL });
    
    try {
        const sqlPath = path.resolve(__dirname, './infra/phase2_migrations.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log(`📡 Connecting to PostgreSQL cluster at ${config.DATABASE_URL.split('@')[1]}...`);
        const res = await pool.query(sql);
        console.log(`✅ Phase 2 Migrations deployed perfectly across the cluster!`);
    } catch(e) {
        console.error(`❌ MIGRATION FAULT: ${e.message}`);
    } finally {
        await pool.end();
    }
}
migrate();
