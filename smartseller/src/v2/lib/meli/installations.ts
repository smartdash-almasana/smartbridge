import { supabaseAdmin } from '@v2/lib/supabase';
import type { ExchangedTokens } from '@v2/lib/meli/oauth';

type BootstrapStatus = 'pending' | 'running' | 'completed' | 'failed' | null;

interface PersistInstallationTokensInput {
    storeId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    raw?: unknown;
}

export async function persistInstallationTokens(input: PersistInstallationTokensInput): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v2_oauth_tokens')
        .upsert(
            {
                store_id: input.storeId,
                access_token: input.accessToken,
                refresh_token: input.refreshToken,
                expires_at: input.expiresAt,
                status: 'active',
                updated_at: new Date().toISOString(),
                raw: input.raw ?? null,
            },
            { onConflict: 'store_id' }
        );

    if (error) {
        throw new Error(`[meli/installations] token persist failed: ${error.message}`);
    }
}

export interface PendingInstallationInput {
    providerKey: string;
    stateId: string;
    externalAccountId: string;
    tokens: ExchangedTokens;
}

export async function createPendingInstallation(input: PendingInstallationInput): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .insert({
            provider_key: input.providerKey,
            state_id: input.stateId,
            external_account_id: input.externalAccountId,
            access_token: input.tokens.access_token,
            refresh_token: input.tokens.refresh_token,
            expires_at: input.tokens.expires_at,
            raw: input.tokens.raw as any,
        })
        .select('installation_id')
        .single();

    if (error || !data) {
        throw new Error(`[meli/installations] Failed to create pending installation: ${error?.message}`);
    }

    return data.installation_id;
}

export async function getPendingInstallation(installationId: string) {
    const { data, error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .select('*')
        .eq('installation_id', installationId)
        .single();

    if (error || !data) {
        throw new Error(`[meli/installations] Pending installation not found: ${error?.message}`);
    }

    return data;
}

export async function markInstallationLinked(
    installationId: string,
    storeId: string,
    userId: string
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('v2_oauth_installations')
        .update({
            linked_store_id: storeId,
            linked_by_user_id: userId,
            linked_at: new Date().toISOString(),
        })
        .eq('installation_id', installationId);

    if (error) {
        throw new Error(`[meli/installations] Failed to mark installation linked: ${error.message}`);
    }
}

export async function requestInitialBootstrap(
    installationId: string,
    version = 'v1'
): Promise<void> {
    return requestInitialBootstrapWithDeps(
        installationId,
        version,
        {
            async readStatus(id) {
                const { data, error } = await supabaseAdmin
                    .from('v2_oauth_installations')
                    .select('bootstrap_status')
                    .eq('installation_id', id)
                    .limit(1)
                    .maybeSingle<{ bootstrap_status: BootstrapStatus }>();
                if (error) throw new Error(`[meli/installations] Failed to read bootstrap status: ${error.message}`);
                return data ?? null;
            },
            async setPending(id, nowIso, requestedVersion) {
                const { data, error } = await supabaseAdmin
                    .from('v2_oauth_installations')
                    .update({
                        bootstrap_status: 'pending',
                        bootstrap_requested_at: nowIso,
                        bootstrap_started_at: null,
                        bootstrap_completed_at: null,
                        bootstrap_error: null,
                        bootstrap_version: requestedVersion,
                    })
                    .eq('installation_id', id)
                    .or('bootstrap_status.is.null,bootstrap_status.eq.pending,bootstrap_status.eq.failed')
                    .select('installation_id');
                if (error) throw new Error(`[meli/installations] Failed to request initial bootstrap: ${error.message}`);
                return data?.length ?? 0;
            },
        }
    );
}

interface RequestInitialBootstrapDeps {
    readStatus: (installationId: string) => Promise<{ bootstrap_status: BootstrapStatus } | null>;
    setPending: (installationId: string, nowIso: string, version: string) => Promise<number>;
}

export async function requestInitialBootstrapWithDeps(
    installationId: string,
    version: string,
    deps: RequestInitialBootstrapDeps
): Promise<void> {
    const current = await deps.readStatus(installationId);
    if (!current) {
        throw new Error('[meli/installations] Installation not found while requesting bootstrap');
    }

    // One-shot semantics: never reset active/completed work.
    if (current.bootstrap_status === 'completed' || current.bootstrap_status === 'running') {
        return;
    }

    const updatedRows = await deps.setPending(installationId, new Date().toISOString(), version);
    if (updatedRows === 0) {
        // Concurrency-safe no-op: status changed to running/completed between read and update.
        return;
    }
}
