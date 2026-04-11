type BootstrapStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BootstrapJobRow {
    installation_id: string;
    linked_store_id: string | null;
    bootstrap_status: BootstrapStatus | null;
}

export interface BootstrapRunSummary {
    scanned: number;
    claimed: number;
    completed: number;
    failed: number;
    stale_recovered: number;
}

export interface BootstrapWorkerDeps {
    markStaleRunningAsFailed: () => Promise<number>;
    listCandidates: (limit: number) => Promise<BootstrapJobRow[]>;
    claimJob: (installationId: string) => Promise<boolean>;
    executeBootstrap: (storeId: string) => Promise<void>;
    markCompleted: (installationId: string) => Promise<void>;
    markFailed: (installationId: string, message: string) => Promise<void>;
}

export async function runMeliBootstrapWorkerWithDeps(
    limit: number,
    deps: BootstrapWorkerDeps
): Promise<BootstrapRunSummary> {
    let scanned = 0;
    let claimed = 0;
    let completed = 0;
    let failed = 0;
    const stale_recovered = await deps.markStaleRunningAsFailed();

    const candidates = await deps.listCandidates(limit);
    scanned = candidates.length;

    for (const job of candidates) {
        if (completed + failed >= limit) break;
        if (!job.linked_store_id) continue;

        const lock = await deps.claimJob(job.installation_id);
        if (!lock) continue;
        claimed += 1;

        try {
            await deps.executeBootstrap(job.linked_store_id);
            await deps.markCompleted(job.installation_id);
            completed += 1;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await deps.markFailed(job.installation_id, message);
            failed += 1;
        }
    }

    return { scanned, claimed, completed, failed, stale_recovered };
}
