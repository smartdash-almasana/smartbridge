import { expect, test } from '@playwright/test';
import {
  runV2WebhookToDomainWorkerWithDeps,
  type WebhookEventInput,
  type WorkerDeps,
} from '../src/v2/ingest/webhook-to-domain-worker';

test.describe('v2 webhook->domain worker', () => {
  test.skip(
    !!process.env.CI &&
      (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY),
    'Skipping in CI: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
  );

  test('is idempotent across reruns for same source_event_id', async () => {
    const webhookRows: WebhookEventInput[] = [
      {
        event_id: 'evt-1',
        store_id: 'store-1',
        tenant_id: 'tenant-1',
        topic: 'orders_v2',
        resource: '/orders/123',
        received_at: '2026-03-02T10:00:00.000Z',
        raw_payload: { topic: 'orders_v2', resource: '/orders/123' },
      },
    ];

    const domainBySource = new Map<string, Record<string, unknown>>();

    const deps: WorkerDeps = {
      async loadWebhookEvents(limit: number) {
        return webhookRows.slice(0, limit);
      },
      async insertDomainEvent(event) {
        if (domainBySource.has(event.source_event_id)) return false;
        domainBySource.set(event.source_event_id, event);
        return true;
      },
    };

    const first = await runV2WebhookToDomainWorkerWithDeps(deps, 50);
    expect(first.scanned).toBe(1);
    expect(first.inserted).toBe(1);
    expect(first.deduped).toBe(0);
    expect(domainBySource.size).toBe(1);

    const second = await runV2WebhookToDomainWorkerWithDeps(deps, 50);
    expect(second.scanned).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.deduped).toBe(1);
    expect(domainBySource.size).toBe(1);
  });

  test('skips inserts when events are already processed (filtered upstream)', async () => {
    let insertCalls = 0;

    const deps: WorkerDeps = {
      async loadWebhookEvents() {
        // Simulates DB-level filtering of already-processed source_event_id.
        return [];
      },
      async insertDomainEvent() {
        insertCalls += 1;
        return false;
      },
    };

    const result = await runV2WebhookToDomainWorkerWithDeps(deps, 50);
    expect(result.scanned).toBe(0);
    expect(result.inserted).toBe(0);
    expect(result.deduped).toBe(0);
    expect(insertCalls).toBe(0);
  });
});
