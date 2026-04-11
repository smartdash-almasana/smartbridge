const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .find(l => l.startsWith('SUPABASE_DB_PASSWORD='))
    .split('=')[1]
    .replace(/"/g, '')
    .trim();

const connectionString = `postgres://postgres.bewjtoozxukypjbckcyt:${env}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

async function applyAndValidate() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log("Connected to DB.");

        const sql = fs.readFileSync('supabase/migrations/20260310_v3_canonical_core_base.sql', 'utf8');

        // Applying migration
        console.log("Applying V3 DDL...");
        await client.query(sql);
        console.log("Migration applied successfully.\n");

        // Validation
        const tables = [
            'v3_tenants', 'v3_sellers', 'v3_stores', 'v3_webhook_events',
            'v3_domain_events', 'v3_engine_runs', 'v3_snapshots',
            'v3_metrics_daily', 'v3_clinical_signals', 'v3_health_scores'
        ];

        console.log("Validating tables existence...");
        for (const t of tables) {
            const res = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        );
      `, [t]);
            console.log(`- ${t}: ${res.rows[0].exists ? 'OK' : 'MISSING'}`);
        }

        console.log("\nValidating triggers for updated_at...");
        const triggers = await client.query(`
      SELECT event_object_table, trigger_name 
      FROM information_schema.triggers 
      WHERE trigger_name LIKE 'trg_v3_%_set_updated_at';
    `);
        triggers.rows.forEach(r => console.log(`- Trigger ${r.trigger_name} on ${r.event_object_table}: OK`));

        console.log("\nValidating index idx_v3_webhook_events_store_status...");
        const index = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE indexname = 'idx_v3_webhook_events_store_status';
    `);
        if (index.rows.length > 0) {
            console.log(`- Index found: ${index.rows[0].indexdef}`);
        } else {
            console.log(`- Index MISSING`);
        }

    } catch (err) {
        console.error("Error during execution:", err);
    } finally {
        await client.end();
        console.log("Disconnected.");
    }
}

applyAndValidate();
