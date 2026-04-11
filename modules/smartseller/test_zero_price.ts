import { runZeroPriceItemsWorker } from './src/v2/engine/zero-price-items-worker';

async function main() {
    console.log('Starting zero price items worker test...');

    // Usamos el tenant y store existente
    const tenant_id = 'fddb3c92-e118-4d85-8824-6185fe02f55c';
    const store_id = '0485e5e6-5bc9-4e85-bdbe-e0c9ff20a0e2';
    const metric_date = '2026-03-03';

    try {
        const result = await runZeroPriceItemsWorker({
            run_id: 'manual-test-run',
            tenant_id,
            store_id,
            metric_date
        });
        console.log('Worker Result:', result);
    } catch (err) {
        console.error('Worker failed:', err);
    }
}

main();
