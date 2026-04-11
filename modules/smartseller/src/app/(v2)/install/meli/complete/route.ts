import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
    getPendingInstallation,
    markInstallationLinked,
    persistInstallationTokens,
    requestInitialBootstrap,
} from '@v2/lib/meli/installations';
import { upsertStoreAndMembership } from '@v2/lib/stores/linkStore';

function appBaseUrl(request: NextRequest): string {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') ?? 'http';
    if (host) return `${proto}://${host}`;
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installation_id');

    if (!installationId) {
        return NextResponse.json({ error: 'Missing installation_id' }, { status: 400 });
    }

    try {
        // Fetch installation first so linked installations can bypass login gate.
        const installation = await getPendingInstallation(installationId);
        if (installation.linked_store_id) {
            return NextResponse.redirect(new URL(`/dashboard/${installation.linked_store_id}`, appBaseUrl(request)));
        }

        const cookieStore = await cookies();
        const supabaseUser = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll: () => cookieStore.getAll(),
                    setAll: () => { },
                },
            },
        );

        const { data: { session } } = await supabaseUser.auth.getSession();
        const userId = session?.user?.id;

        if (!userId) {
            const loginUrl = new URL('/enter', appBaseUrl(request));
            // Set the `next` query param to return here after login
            loginUrl.searchParams.set('next', `/install/meli/complete?installation_id=${installationId}`);
            return NextResponse.redirect(loginUrl);
        }

        // Parse tokens and user payload 
        const { provider_key, external_account_id, access_token, refresh_token, expires_at, raw } = installation;
        const meliUser = raw as any;

        // Upsert store & membership
        const { storeId } = await upsertStoreAndMembership({
            userId,
            providerKey: provider_key as 'mercadolibre' | 'meli',
            externalAccountId: external_account_id,
            displayName: meliUser?.nickname ? `ML ${meliUser.nickname}` : `ML ${external_account_id}`,
        });

        // Persist tokens
        if (access_token && refresh_token && expires_at) {
            await persistInstallationTokens({
                storeId,
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: expires_at,
                raw: raw,
            });
        }

        // Mark as linked
        await markInstallationLinked(installationId, storeId, userId);
        await requestInitialBootstrap(installationId, 'v1');

        return NextResponse.redirect(new URL(`/dashboard/${storeId}`, appBaseUrl(request)));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error during installation completion';
        console.error('[install/meli/complete]', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
