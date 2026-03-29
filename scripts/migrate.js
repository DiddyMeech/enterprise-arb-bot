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
        const sqlPath = path.resolve(__dirname, '../infra/phase2_migrations.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log(`📡 Connecting to PostgreSQL cluster at ${config.DATABASE_URL.split('@')[1]}...`);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS migration_history (
                id SERIAL PRIMARY KEY,
                migration_name VARCHAR(255) UNIQUE NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        const check = await pool.query(`SELECT 1 FROM migration_history WHERE migration_name = 'phase2_migrations.sql'`);
        if (check.rows.length > 0) {
            console.log(`✅ Migration 'phase2_migrations.sql' has already been applied. Skipping.`);
        } else {
            const res = await pool.query(sql);
            await pool.query(`INSERT INTO migration_history (migration_name) VALUES ('phase2_migrations.sql')`);
            console.log(`✅ Phase 2 Migrations deployed perfectly across the cluster!`);
        }
    } catch(e) {
        console.error(`❌ MIGRATION FAULT: ${e.message}`);
    } finally {
        await pool.end();
    }
}
migrate();
