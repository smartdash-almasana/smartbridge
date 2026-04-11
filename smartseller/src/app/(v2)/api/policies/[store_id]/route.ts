// ============================================================================
// SmartSeller V2 — GET / POST /api/policies/[store_id]
//
// GET:  Returns the stored policy or default policy (without inserting).
// POST: Validates + upserts the policy.
//
// Contract V0 rules keys: no_orders_7d | cancellation_spike |
//   unanswered_messages_spike | claims_opened | low_activity_14d
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@v2/lib/supabase';

// ─── Contracts ────────────────────────────────────────────────────────────────

const KNOWN_SIGNAL_KEYS = [
    'no_orders_7d',
    'cancellation_spike',
    'unanswered_messages_spike',
    'claims_opened',
    'low_activity_14d',
] as const;

type SignalKey = typeof KNOWN_SIGNAL_KEYS[number];
type SeverityOverride = null | 'low' | 'medium' | 'high';

interface SignalRule {
    enabled: boolean;
    severity_override: SeverityOverride;
    cooldown_hours: number;
    thresholds: Record<string, number>;
}

type RulesMap = Partial<Record<SignalKey, SignalRule>>;

interface PolicyBody {
    enabled: boolean;
    channels: Record<string, boolean>;
    quiet_hours: { tz?: string; start?: string; end?: string };
    rules: RulesMap;
}

interface PolicyRow {
    policy_id: string;
    tenant_id: string;
    store_id: string;
    enabled: boolean;
    channels: Record<string, boolean>;
    quiet_hours: Record<string, string>;
    rules: RulesMap;
    created_at: string;
    updated_at: string;
}

// Default thresholds per signal (V0)
const DEFAULT_RULES: Record<SignalKey, SignalRule> = {
    no_orders_7d: {
        enabled: true,
        severity_override: null,
        cooldown_hours: 24,
        thresholds: { window_days: 7, min_orders: 1 },
    },
    cancellation_spike: {
        enabled: true,
        severity_override: null,
        cooldown_hours: 12,
        thresholds: { window_days: 1, min_cancelled: 1, cancelled_ratio: 0.3 },
    },
    unanswered_messages_spike: {
        enabled: true,
        severity_override: null,
        cooldown_hours: 6,
        thresholds: { window_days: 1, min_pending: 5 },
    },
    claims_opened: {
        enabled: true,
        severity_override: null,
        cooldown_hours: 48,
        thresholds: { window_days: 14, min_opened: 1 },
    },
    low_activity_14d: {
        enabled: true,
        severity_override: null,
        cooldown_hours: 72,
        thresholds: { window_days: 14, min_activity: 0, max_activity: 3 },
    },
};

function defaultPolicy(storeId: string, tenantId = ''): Omit<PolicyRow, 'policy_id' | 'created_at' | 'updated_at'> {
    return {
        tenant_id: tenantId,
        store_id: storeId,
        enabled: true,
        channels: { whatsapp: false, telegram: false, email: false },
        quiet_hours: {},
        rules: DEFAULT_RULES,
    };
}

// ─── Auth helpers (shared with sync endpoint) ─────────────────────────────────

async function getSessionUserId(request: NextRequest): Promise<string | null> {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll(), setAll: () => { } } }
    );
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
}

async function getMembership(userId: string, storeId: string): Promise<{ tenant_id: string } | null> {
    const { data } = await supabaseAdmin
        .from('v2_store_memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .eq('store_id', storeId)
        .limit(1)
        .maybeSingle<{ tenant_id: string }>();
    return data ?? null;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateRules(rules: unknown): { valid: true; data: RulesMap } | { valid: false; error: string } {
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
        return { valid: false, error: 'rules must be an object' };
    }
    const map = rules as Record<string, unknown>;
    for (const key of Object.keys(map)) {
        if (!(KNOWN_SIGNAL_KEYS as readonly string[]).includes(key)) {
            return { valid: false, error: `Unknown signal key: ${key}` };
        }
        const rule = map[key] as Record<string, unknown>;
        if (typeof rule.enabled !== 'boolean') return { valid: false, error: `${key}.enabled must be boolean` };
        if (rule.severity_override !== null && !['low', 'medium', 'high'].includes(rule.severity_override as string)) {
            return { valid: false, error: `${key}.severity_override must be null|low|medium|high` };
        }
        const cooldown = Number(rule.cooldown_hours);
        if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 168) {
            return { valid: false, error: `${key}.cooldown_hours must be int 0..168` };
        }
        if (typeof rule.thresholds !== 'object' || rule.thresholds === null) {
            return { valid: false, error: `${key}.thresholds must be an object` };
        }
    }
    return { valid: true, data: map as RulesMap };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ store_id: string }> }
) {
    const { store_id } = await params;
    const userId = await getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const membership = await getMembership(userId, store_id);
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabaseAdmin
        .from('v2_notification_policies')
        .select('*')
        .eq('store_id', store_id)
        .limit(1)
        .maybeSingle<PolicyRow>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!data) {
        // Return default without persisting
        return NextResponse.json({
            ...defaultPolicy(store_id, membership.tenant_id),
            policy_id: null,
            created_at: null,
            updated_at: null,
        });
    }

    // Merge with defaults so any missing signal keys are present
    const mergedRules = { ...DEFAULT_RULES, ...data.rules };
    return NextResponse.json({ ...data, rules: mergedRules });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ store_id: string }> }
) {
    const { store_id } = await params;
    const userId = await getSessionUserId(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const membership = await getMembership(userId, store_id);
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    let body: PolicyBody;
    try {
        body = await request.json() as PolicyBody;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate
    if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be boolean' }, { status: 422 });
    }

    const rulesValidation = validateRules(body.rules ?? {});
    if (!rulesValidation.valid) {
        return NextResponse.json({ error: rulesValidation.error }, { status: 422 });
    }

    const { data, error } = await supabaseAdmin
        .from('v2_notification_policies')
        .upsert(
            {
                tenant_id: membership.tenant_id,
                store_id,
                enabled: body.enabled,
                channels: body.channels ?? { whatsapp: false, telegram: false, email: false },
                quiet_hours: body.quiet_hours ?? {},
                rules: rulesValidation.data,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'store_id' }
        )
        .select('*')
        .single<PolicyRow>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 200 });
}
