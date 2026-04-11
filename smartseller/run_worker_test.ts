import { runV2WebhookToDomainWorker } from './src/v2/ingest/webhook-to-domain-worker';

async function main() {
    try {
        console.log("Starting worker test...");
        const result = await runV2WebhookToDomainWorker(50);
        console.log("Worker Result:", result);
    } catch (e) {
        console.error("Worker error:", e);
    }
}

main();
