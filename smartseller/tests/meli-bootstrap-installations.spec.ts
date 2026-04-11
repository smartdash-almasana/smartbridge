import { expect, test } from '@playwright/test';
import { requestInitialBootstrapWithDeps } from '../src/v2/lib/meli/installations';

test.describe('meli bootstrap enqueue guard', () => {
  test('does not reset completed or running', async () => {
    let setPendingCalls = 0;

    await requestInitialBootstrapWithDeps('inst-completed', 'v1', {
      async readStatus() {
        return { bootstrap_status: 'completed' };
      },
      async setPending() {
        setPendingCalls += 1;
        return 1;
      },
    });

    await requestInitialBootstrapWithDeps('inst-running', 'v1', {
      async readStatus() {
        return { bootstrap_status: 'running' };
      },
      async setPending() {
        setPendingCalls += 1;
        return 1;
      },
    });

    expect(setPendingCalls).toBe(0);
  });

  test('allows pending, failed and null bootstrap status', async () => {
    let setPendingCalls = 0;
    const run = async (status: 'pending' | 'failed' | null) =>
      requestInitialBootstrapWithDeps(`inst-${String(status)}`, 'v1', {
        async readStatus() {
          return { bootstrap_status: status };
        },
        async setPending() {
          setPendingCalls += 1;
          return 1;
        },
      });

    await run('pending');
    await run('failed');
    await run(null);

    expect(setPendingCalls).toBe(3);
  });
});

