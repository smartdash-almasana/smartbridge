import { expect, test } from '@playwright/test';
import {
  __getRefreshLocksSize,
  __resetMeliTokenTestHooks,
  __setMeliTokenTestHooks,
  getValidToken,
} from '../src/v2/lib/meli-token';

test.describe('meli-token single-flight', () => {
  test.afterEach(() => {
    __resetMeliTokenTestHooks();
  });

  test('two concurrent getValidToken calls execute one refreshToken for same store', async () => {
    let refreshCalls = 0;

    __setMeliTokenTestHooks({
      readTokenSnapshotForStore: async () => ({
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expires_at: new Date(Date.now() - 5_000).toISOString(),
        status: 'active',
      }),
      refreshToken: async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'new-token';
      },
    });

    const [tokenA, tokenB] = await Promise.all([
      getValidToken('store-123'),
      getValidToken('store-123'),
    ]);

    expect(tokenA).toBe('new-token');
    expect(tokenB).toBe('new-token');
    expect(refreshCalls).toBe(1);
    expect(__getRefreshLocksSize()).toBe(0);
  });
});
