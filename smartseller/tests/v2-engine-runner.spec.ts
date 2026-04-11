import { expect, test } from '@playwright/test';
import { runEngineForStoreWithDeps } from '../src/v2/engine/runner';

test.describe('v2 engine runner', () => {
  test('returns consistent output when RPC returns same payload', async () => {
    const fakeResult = { run_id: 'run-1', score: 10, signals: 1 };
    let calls = 0;

    const rpc = async () => {
      calls += 1;
      return { data: fakeResult, error: null };
    };

    const a = await runEngineForStoreWithDeps('store-1', rpc);
    const b = await runEngineForStoreWithDeps('store-1', rpc);

    expect(a).toEqual(fakeResult);
    expect(b).toEqual(fakeResult);
    expect(calls).toBe(2);
  });
});
