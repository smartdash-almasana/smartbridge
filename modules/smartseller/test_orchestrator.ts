import { runDailyClinicalV0 } from './src/v2/engine/run-daily-clinical-v0';
import { supabaseAdmin } from './src/v2/lib/supabase';
// Load .env by hand
import * as fs from 'fs';
const envFile = fs.readFileSync('.env.local', 'utf-8');
for (const line of envFile.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        let val = match[2];
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[match[1]] = val;
    }
}

async function main() {
    const tenant_id = 'fddb3c92-e118-4d85-8824-6185fe02f55c';
    const store_id = '0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2';
    const metric_date = '2026-03-07';

    console.log('Running test for', metric_date);
    const result = await runDailyClinicalV0({ tenant_id, store_id, metric_date });
    console.log('Result:', result.run_id);

    // Check DB
    const { data } = await supabaseAdmin.from('v2_snapshots').select('payload').eq('run_id', result.run_id).single();
    console.log('Payload in DB:', JSON.stringify(data?.payload, null, 2));
}

main().catch(console.error);
