import { expect, test } from '@playwright/test';
import { deriveVitalSignsPanelData, type AreaKey, type MetricsRow } from '../src/app/(v2)/dashboard/[store_id]/vital-signs/VitalSignsClient';
import type { ScoreResponse } from '../src/v2/api/score';

function makeScore(activeSignals: ScoreResponse['active_signals']): ScoreResponse {
  return {
    store_id: 'store-1',
    score: 76,
    computed_at: '2026-03-15T20:00:00.000Z',
    run_id: 'run-1',
    snapshot_id: 'snap-1',
    active_signals: activeSignals,
  };
}

test.describe('vital signs area selector', () => {
  test('panel data is strictly derived from selected area key', async () => {
    const metricsRow: MetricsRow = {
      metric_date: '2026-03-15',
      metrics: {
        orders_created_1d: 9,
        orders_cancelled_1d: 2,
        messages_received_1d: 14,
        messages_answered_1d: 10,
        claims_opened_1d: 1,
      },
    };

    const scoreData = makeScore([
      { signal_key: 'cancellation_spike', severity: 'critical', evidence: { ratio: 0.4 } },
      { signal_key: 'unanswered_messages_spike', severity: 'warning', evidence: { messages_received_1d: 14 } },
      { signal_key: 'claims_opened', severity: 'warning', evidence: { claims_opened_14d: 2 } },
      { signal_key: 'low_activity_14d', severity: 'info', evidence: { total_activity: 2 } },
      { signal_key: 'no_orders_7d', severity: 'critical', evidence: { orders_created_7d: 0 } },
    ]);

    const logistic = deriveVitalSignsPanelData('logistica', scoreData, metricsRow);
    expect(logistic.selectedAreaLabel).toBe('Logistica');
    expect(logistic.areaMetricCards.map((card) => card.title)).toEqual(['Ordenes creadas hoy', 'Cancelaciones hoy']);
    expect(logistic.areaSignals.map((signal) => signal.signal_key)).toEqual(['cancellation_spike']);

    const attention = deriveVitalSignsPanelData('atencion', scoreData, metricsRow);
    expect(attention.selectedAreaLabel).toBe('Atencion');
    expect(attention.areaMetricCards.map((card) => card.title)).toEqual(['Mensajes recibidos hoy', 'Mensajes respondidos hoy']);
    expect(attention.areaSignals.map((signal) => signal.signal_key)).toEqual(['unanswered_messages_spike']);

    const reputation = deriveVitalSignsPanelData('reputacion', scoreData, metricsRow);
    expect(reputation.selectedAreaLabel).toBe('Reputacion');
    expect(reputation.areaMetricCards.map((card) => card.title)).toEqual(['Reclamos abiertos hoy']);
    expect(reputation.areaSignals.map((signal) => signal.signal_key)).toEqual(['claims_opened']);

    const competitiveness = deriveVitalSignsPanelData('competitividad', scoreData, metricsRow);
    expect(competitiveness.selectedAreaLabel).toBe('Competitividad');
    expect(competitiveness.areaMetricCards).toHaveLength(0);
    expect(competitiveness.areaSignals.map((signal) => signal.signal_key)).toEqual(['low_activity_14d', 'no_orders_7d']);

    const labels = (['logistica', 'atencion', 'reputacion', 'competitividad'] as AreaKey[]).map((area) =>
      deriveVitalSignsPanelData(area, scoreData, metricsRow).selectedAreaLabel,
    );
    expect(new Set(labels)).toEqual(new Set(['Logistica', 'Atencion', 'Reputacion', 'Competitividad']));
  });

  test('shows honest calibration state when area has no real data', async () => {
    const areas: AreaKey[] = ['logistica', 'atencion', 'reputacion', 'competitividad'];
    for (const area of areas) {
      const panel = deriveVitalSignsPanelData(area, null, null);
      expect(panel.areaMetricCards).toHaveLength(0);
      expect(panel.areaSignals).toHaveLength(0);
      expect(panel.hasPanelData).toBeFalsy();
    }
  });

  test('route /dashboard/[store_id]/vital-signs does not fail and supports area switches when authenticated', async ({
    page,
  }) => {
    const response = await page.goto('/dashboard/test/vital-signs');
    if (response) {
      expect(response.status()).not.toBe(500);
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/enter')) {
      expect(currentUrl).toContain('/enter');
      return;
    }

    const heading = page.getByRole('heading', { name: /- Signos Vitales/i });
    await expect(heading).toContainText('Logistica - Signos Vitales');

    await page.getByRole('button', { name: 'Atencion' }).click();
    await expect(heading).toContainText('Atencion - Signos Vitales');

    await page.getByRole('button', { name: 'Reputacion' }).click();
    await expect(heading).toContainText('Reputacion - Signos Vitales');

    await page.getByRole('button', { name: 'Competitividad' }).click();
    await expect(heading).toContainText('Competitividad - Signos Vitales');

    await page.getByRole('button', { name: 'Logistica' }).click();
    await expect(heading).toContainText('Logistica - Signos Vitales');
  });
});
