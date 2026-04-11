import { expect, test } from '@playwright/test';
import { runMeliBootstrapWorkerWithDeps } from '../src/app/(v2)/api/worker/meli-bootstrap/worker';

type Status = 'pending' | 'running' | 'completed' | 'failed';

interface JobState {
  installation_id: string;
  linked_store_id: string | null;
  bootstrap_status: Status;
  stale?: boolean;
  shouldFail?: boolean;
}

function makeDeps(seed: JobState[]) {
  const jobs = new Map(seed.map((j) => [j.installation_id, { ...j }]));

  return {
    jobs,
    deps: {
      async markStaleRunningAsFailed() {
        let recovered = 0;
        for (const job of jobs.values()) {
          if (job.bootstrap_status === 'running' && job.stale) {
            job.bootstrap_status = 'failed';
            recovered += 1;
          }
        }
        return recovered;
      },
      async listCandidates() {
        return [...jobs.values()]
          .filter((j) => j.bootstrap_status === 'pending' || j.bootstrap_status === 'failed')
          .map((j) => ({
            installation_id: j.installation_id,
            linked_store_id: j.linked_store_id,
            bootstrap_status: j.bootstrap_status,
          }));
      },
      async claimJob(installationId: string) {
        const job = jobs.get(installationId);
        if (!job) return false;
        if (job.bootstrap_status !== 'pending' && job.bootstrap_status !== 'failed') return false;
        job.bootstrap_status = 'running';
        return true;
      },
      async executeBootstrap(storeId: string) {
        const job = [...jobs.values()].find((j) => j.linked_store_id === storeId);
        if (job?.shouldFail) throw new Error('boom');
      },
      async markCompleted(installationId: string) {
        const job = jobs.get(installationId);
        if (job) job.bootstrap_status = 'completed';
      },
      async markFailed(installationId: string) {
        const job = jobs.get(installationId);
        if (job) job.bootstrap_status = 'failed';
      },
    },
  };
}

test.describe('meli bootstrap worker', () => {
  test('processes pending and marks completed', async () => {
    const { jobs, deps } = makeDeps([
      { installation_id: 'i1', linked_store_id: 's1', bootstrap_status: 'pending' },
    ]);

    const res = await runMeliBootstrapWorkerWithDeps(5, deps);
    expect(res.claimed).toBe(1);
    expect(res.completed).toBe(1);
    expect(jobs.get('i1')?.bootstrap_status).toBe('completed');
  });

  test('marks failed when execution errors', async () => {
    const { jobs, deps } = makeDeps([
      { installation_id: 'i2', linked_store_id: 's2', bootstrap_status: 'pending', shouldFail: true },
    ]);

    const res = await runMeliBootstrapWorkerWithDeps(5, deps);
    expect(res.failed).toBe(1);
    expect(jobs.get('i2')?.bootstrap_status).toBe('failed');
  });

  test('recovers stale running before claim cycle', async () => {
    const { jobs, deps } = makeDeps([
      { installation_id: 'i3', linked_store_id: 's3', bootstrap_status: 'running', stale: true },
    ]);

    const res = await runMeliBootstrapWorkerWithDeps(5, deps);
    expect(res.stale_recovered).toBe(1);
    expect(jobs.get('i3')?.bootstrap_status).toBe('completed');
  });
});
