import { supabaseAdmin } from '../lib/supabase';

export async function logIngestAttempt(params: {
    event_id?: string | null;
    store_id: string;
    worker: string;
    status: 'ok' | 'error' | 'skipped';
    error_message?: string | null;
    error_detail?: any | null;
}): Promise<void> {
    try {
        await supabaseAdmin
            .from('v2_ingest_attempts')
            .insert({
                event_id: params.event_id ?? null,
                store_id: params.store_id,
                worker: params.worker,
                status: params.status,
                error_message: params.error_message ?? null,
                error_detail: params.error_detail ?? null,
            });
    } catch (err) {
        // Best effort: never throw on logging failure
        console.error('[ingest-attempts] Failed to log attempt:', err);
    }
}
