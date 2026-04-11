'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

const SIGNAL_KEYS = [
    'no_orders_7d',
    'cancellation_spike',
    'unanswered_messages_spike',
    'claims_opened',
    'low_activity_14d',
] as const;
type SignalKey = typeof SIGNAL_KEYS[number];

const SIGNAL_LABELS: Record<SignalKey, string> = {
    no_orders_7d: 'Sin ventas (7 días)',
    cancellation_spike: 'Pico de cancelaciones',
    unanswered_messages_spike: 'Mensajes sin respuesta',
    claims_opened: 'Reclamos abiertos',
    low_activity_14d: 'Baja actividad (14 días)',
};

const THRESHOLD_FIELDS: Record<SignalKey, Array<{ key: string; label: string; min: number; max: number; step: number }>> = {
    no_orders_7d: [
        { key: 'window_days', label: 'Ventana (días)', min: 1, max: 30, step: 1 },
        { key: 'min_orders', label: 'Min. ventas esperadas', min: 0, max: 999, step: 1 },
    ],
    cancellation_spike: [
        { key: 'window_days', label: 'Ventana (días)', min: 1, max: 30, step: 1 },
        { key: 'min_cancelled', label: 'Min. canceladas', min: 0, max: 999, step: 1 },
        { key: 'cancelled_ratio', label: 'Ratio máx. cancelaciones', min: 0, max: 1, step: 0.01 },
    ],
    unanswered_messages_spike: [
        { key: 'window_days', label: 'Ventana (días)', min: 1, max: 30, step: 1 },
        { key: 'min_pending', label: 'Min. mensajes pendientes', min: 1, max: 999, step: 1 },
    ],
    claims_opened: [
        { key: 'window_days', label: 'Ventana (días)', min: 1, max: 30, step: 1 },
        { key: 'min_opened', label: 'Min. reclamos', min: 1, max: 999, step: 1 },
    ],
    low_activity_14d: [
        { key: 'window_days', label: 'Ventana (días)', min: 1, max: 30, step: 1 },
        { key: 'min_activity', label: 'Actividad mínima', min: 0, max: 999, step: 1 },
        { key: 'max_activity', label: 'Actividad máxima (umbral)', min: 0, max: 999, step: 1 },
    ],
};

interface SignalRule {
    enabled: boolean;
    severity_override: null | 'low' | 'medium' | 'high';
    cooldown_hours: number;
    thresholds: Record<string, number>;
}

interface Policy {
    policy_id: string | null;
    enabled: boolean;
    channels: Record<string, boolean>;
    quiet_hours: { tz?: string; start?: string; end?: string };
    rules: Partial<Record<SignalKey, SignalRule>>;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '18px 20px',
    marginBottom: 12,
};

const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' };
const input: React.CSSProperties = {
    border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 10px', fontSize: 13,
    width: '100%', boxSizing: 'border-box', color: '#1e293b', background: '#f8fafc',
};
const selectStyle: React.CSSProperties = { ...input, cursor: 'pointer' };

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!checked)}
            style={{
                width: 42, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
                background: checked ? '#3b82f6' : '#cbd5e1', position: 'relative',
                transition: 'background 0.2s',
            }}
        >
            <span style={{
                display: 'block', width: 16, height: 16, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 3,
                left: checked ? 22 : 4,
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
        </button>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PolicyPanel({ storeId }: { storeId: string }) {
    const [policy, setPolicy] = useState<Policy | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [expanded, setExpanded] = useState<SignalKey | null>(null);

    const showToast = (msg: string, ok: boolean) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/policies/${storeId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: Policy = await res.json();
            setPolicy(data);
        } catch (e) {
            showToast(`Error cargando política: ${e instanceof Error ? e.message : e}`, false);
        } finally {
            setLoading(false);
        }
    }, [storeId]);

    useEffect(() => { load(); }, [load]);

    async function save() {
        if (!policy) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/policies/${storeId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(policy),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
            setPolicy(data);
            showToast('✓ Política guardada correctamente', true);
        } catch (e) {
            showToast(`Error al guardar: ${e instanceof Error ? e.message : e}`, false);
        } finally {
            setSaving(false);
        }
    }

    function updateRule(key: SignalKey, patch: Partial<SignalRule>) {
        setPolicy(p => {
            if (!p) return p;
            const prev = p.rules[key] ?? {};
            return { ...p, rules: { ...p.rules, [key]: { ...prev, ...patch } } };
        });
    }

    function updateThreshold(key: SignalKey, field: string, value: number) {
        setPolicy(p => {
            if (!p) return p;
            const rule = p.rules[key] ?? { enabled: true, severity_override: null, cooldown_hours: 24, thresholds: {} };
            return {
                ...p, rules: {
                    ...p.rules, [key]: {
                        ...rule, thresholds: { ...rule.thresholds, [field]: value },
                    },
                },
            };
        });
    }

    if (loading) return <p style={{ color: '#64748b', fontSize: 13, marginTop: 12 }}>Cargando configuración…</p>;
    if (!policy) return null;

    return (
        <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
                Alertas y prioridades
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                Configura reglas por señal operativa. {policy.policy_id ? 'Configuración guardada.' : 'Mostrando configuración por defecto.'}
            </p>

            {/* Global enable */}
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
                <Toggle checked={policy.enabled} onChange={v => setPolicy(p => p ? { ...p, enabled: v } : p)} />
                <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Prioridad general</span>
                    <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                        {policy.enabled ? 'Activas — las reglas configuradas abajo aplican' : 'Desactivadas — no se enviara ninguna alerta'}
                    </p>
                </div>
            </div>

            {/* Channels */}
            <div style={card}>
                <span style={{ ...label, marginBottom: 10 }}>Canales de notificacion</span>
                <div style={{ display: 'flex', gap: 24 }}>
                    {(['whatsapp', 'telegram', 'email'] as const).map(ch => (
                        <label key={ch} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                            <Toggle
                                checked={!!policy.channels[ch]}
                                onChange={v => setPolicy(p => p ? { ...p, channels: { ...p.channels, [ch]: v } } : p)}
                            />
                            {ch.charAt(0).toUpperCase() + ch.slice(1)}
                        </label>
                    ))}
                </div>
            </div>

            {/* Quiet hours */}
            <div style={card}>
                <span style={{ ...label, marginBottom: 10 }}>Horario silencioso (opcional)</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    {[
                        { key: 'tz' as const, label: 'Zona horaria', placeholder: 'America/Argentina/Buenos_Aires' },
                        { key: 'start' as const, label: 'Desde (HH:MM)', placeholder: '22:00' },
                        { key: 'end' as const, label: 'Hasta (HH:MM)', placeholder: '08:00' },
                    ].map(f => (
                        <div key={f.key}>
                            <span style={label}>{f.label}</span>
                            <input
                                style={input}
                                type="text"
                                placeholder={f.placeholder}
                                value={policy.quiet_hours?.[f.key] ?? ''}
                                onChange={e => setPolicy(p => p ? {
                                    ...p, quiet_hours: { ...p.quiet_hours, [f.key]: e.target.value },
                                } : p)}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Signal rules */}
            <div style={{ marginBottom: 8 }}>
                <span style={{ ...label, fontSize: 14 }}>Reglas por señal</span>
            </div>

            {SIGNAL_KEYS.map(key => {
                const rule = policy.rules[key] ?? { enabled: true, severity_override: null, cooldown_hours: 24, thresholds: {} };
                const isOpen = expanded === key;
                return (
                    <div key={key} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                        {/* Header */}
                        <div
                            onClick={() => setExpanded(isOpen ? null : key)}
                            style={{
                                padding: '14px 18px', cursor: 'pointer', display: 'flex',
                                alignItems: 'center', justifyContent: 'space-between',
                                background: isOpen ? '#f8fafc' : '#fff',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <Toggle
                                    checked={rule.enabled}
                                    onChange={v => { updateRule(key, { enabled: v }); }}
                                />
                                <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                                    {SIGNAL_LABELS[key]}
                                </span>
                                {!rule.enabled && (
                                    <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>desactivada</span>
                                )}
                            </div>
                            <span style={{ color: '#94a3b8', fontSize: 18 }}>{isOpen ? '▲' : '▼'}</span>
                        </div>

                        {/* Expanded config */}
                        {isOpen && (
                            <div style={{ padding: '14px 18px', borderTop: '1px solid #f1f5f9', display: 'grid', gap: 14 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                    {/* Severity override */}
                                    <div>
                                        <span style={label}>Prioridad manual</span>
                                        <select
                                            style={selectStyle}
                                            value={rule.severity_override ?? ''}
                                            onChange={e => updateRule(key, {
                                                severity_override: (e.target.value || null) as null | 'low' | 'medium' | 'high',
                                            })}
                                        >
                                            <option value="">Predeterminada (motor)</option>
                                            <option value="low">Baja</option>
                                            <option value="medium">Media</option>
                                            <option value="high">Alta</option>
                                        </select>
                                    </div>
                                    {/* Cooldown */}
                                    <div>
                                        <span style={label}>Cooldown (horas)</span>
                                        <input
                                            style={input}
                                            type="number"
                                            min={0}
                                            max={168}
                                            value={rule.cooldown_hours}
                                            onChange={e => updateRule(key, { cooldown_hours: Number(e.target.value) })}
                                        />
                                    </div>
                                </div>

                                {/* Thresholds */}
                                <div>
                                    <span style={{ ...label, color: '#64748b', fontWeight: 500 }}>Umbrales</span>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                                        {THRESHOLD_FIELDS[key].map(f => (
                                            <div key={f.key}>
                                                <span style={label}>{f.label}</span>
                                                <input
                                                    style={input}
                                                    type="number"
                                                    min={f.min}
                                                    max={f.max}
                                                    step={f.step}
                                                    value={rule.thresholds[f.key] ?? 0}
                                                    onChange={e => updateThreshold(key, f.key, Number(e.target.value))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Save button */}
            <div style={{ marginTop: 16 }}>
                <button
                    onClick={save}
                    disabled={saving}
                    style={{
                        padding: '10px 24px',
                        background: saving ? '#94a3b8' : '#0f172a',
                        color: '#fff', border: 'none', borderRadius: 8,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontWeight: 600, fontSize: 14,
                    }}
                >
                    {saving ? 'Guardando…' : 'Guardar configuración'}
                </button>
            </div>

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    padding: '12px 20px', borderRadius: 10,
                    background: toast.ok ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${toast.ok ? '#86efac' : '#fca5a5'}`,
                    color: toast.ok ? '#166534' : '#991b1b',
                    fontSize: 13, fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                }}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}
