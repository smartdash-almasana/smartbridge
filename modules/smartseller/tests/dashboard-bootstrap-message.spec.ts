import { expect, test } from '@playwright/test';
import { getNoScoreBootstrapMessage } from '../src/app/(v2)/dashboard/[store_id]/bootstrap-message';

test.describe('dashboard bootstrap no-score message', () => {
  test('pending/running shows in-progress message', async () => {
    expect(getNoScoreBootstrapMessage('pending')).toBe(
      'Bootstrap inicial en progreso. El score aparecerá al finalizar.',
    );
    expect(getNoScoreBootstrapMessage('running')).toBe(
      'Bootstrap inicial en progreso. El score aparecerá al finalizar.',
    );
  });

  test('failed shows retry message', async () => {
    expect(getNoScoreBootstrapMessage('failed')).toBe(
      'Bootstrap inicial falló. Se reintentará en background.',
    );
  });

  test('null/completed shows not-started message when no score', async () => {
    expect(getNoScoreBootstrapMessage(null)).toBe(
      'Sin score calculado aún. Bootstrap inicial todavía no se inició.',
    );
    expect(getNoScoreBootstrapMessage('completed')).toBe(
      'Sin score calculado aún. Bootstrap inicial todavía no se inició.',
    );
  });
});
