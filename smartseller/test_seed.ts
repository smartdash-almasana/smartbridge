import { seedSnapshotClinicalInputs } from './src/v2/engine/snapshot-clinical-inputs';
import { runDailyClinicalV0 } from './src/v2/engine/run-daily-clinical-v0';
import { supabaseAdmin } from './src/v2/lib/supabase';

async function main() {
    const tenant_id = 'fddb3c92-e118-4d85-8824-6185fe02f55c';
    const store_id = '0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2';
    const run_id = 'test-' + Date.now();
    const metric_date = '2026-03-08';

    console.log('Running test for', run_id);
    const result = await seedSnapshotClinicalInputs({ tenant_id, store_id, run_id, metric_date });
    console.log('Seeded:', result);

    // Check DB
    const { data } = await supabaseAdmin.from('v2_snapshots').select('payload').eq('snapshot_id', result.snapshot_id).single();
    console.log('Payload in DB:', JSON.stringify(data?.payload, null, 2));
}

main().catch(console.error);
