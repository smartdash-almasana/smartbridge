'use client';

import { useState } from 'react';

interface SyncResult {
    store_id: string;
    fetched_orders: number;
    inserted_webhooks: number;
    deduped_webhooks: number;
    domain_events_by_type: Record<string, number>;
}

interface ScoreResult {
    store_id: string;
    score: number;
    computed_at: string;
    active_signals?: Array<{
        signal_key: string;
        severity: 'info' | 'warning' | 'critical';
        evidence: Record<string, unknown>;
    }>;
}

interface SyncButtonProps {
    storeId: string;
}

function signalLabel(signalKey: string): string {
    if (signalKey === 'no_orders_7d') return 'Sin ventas recientes';
    if (signalKey === 'cancellation_spike') return 'Suba de cancelaciones';
    if (signalKey === 'unanswered_messages_spike') return 'Mensajes sin respuesta';
    if (signalKey === 'claims_opened') return 'Reclamos activos';
    if (signalKey === 'low_activity_14d') return 'Actividad comercial por debajo de lo esperado';
    return 'Alerta operativa activa';
}

function severityLabel(severity: 'info' | 'warning' | 'critical'): string {
    if (severity === 'critical') return 'Alta prioridad';
    if (severity === 'warning') return 'Prioridad media';
    return 'Prioridad baja';
}

function briefEvidence(evidence: Record<string, unknown>): string {
    const label = (key: string): string => {
        if (key === 'orders_created_7d') return 'Ordenes creadas en 7 dias';
        if (key === 'orders_cancelled_1d') return 'Cancelaciones hoy';
        if (key === 'orders_created_1d') return 'Ordenes creadas hoy';
        if (key === 'ratio') return 'Ratio observado';
        if (key === 'messages_received_1d') return 'Mensajes recibidos hoy';
        if (key === 'messages_answered_1d') return 'Mensajes respondidos hoy';
        if (key === 'claims_opened_14d') return 'Reclamos abiertos en 14 dias';
        if (key === 'orders_created_14d') return 'Ordenes creadas en 14 dias';
        if (key === 'messages_received_14d') return 'Mensajes recibidos en 14 dias';
        if (key === 'total_activity') return 'Actividad total en 14 dias';
        return key.replace(/_/g, ' ');
    };

    const entries = Object.entries(evidence).slice(0, 2);
    if (entries.length === 0) return 'Sin evidencia adicional';
    return entries.map(([key, value]) => `${label(key)}: ${String(value)}`).join(' | ');
}

export default function SyncButton({ storeId }: SyncButtonProps) {
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [score, setScore] = useState<ScoreResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function handleSync() {
        setSyncing(true);
        setError(null);
        setSyncResult(null);
        setScore(null);

        try {
            const syncRes = await fetch(`/api/meli/sync/${storeId}`, {
                method: 'POST',
                cache: 'no-store',
            });
            const syncData = await syncRes.json();

            if (!syncRes.ok) {
                setError(syncData?.error ?? `Sync failed (${syncRes.status})`);
                return;
            }
            setSyncResult(syncData);

            const scoreRes = await fetch(`/api/score/${storeId}?t=${Date.now()}`, {
                cache: 'no-store',
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                setScore(scoreData);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setSyncing(false);
        }
    }

    return (
        <div className="w-full md:w-auto">
            <button
                onClick={handleSync}
                disabled={syncing}
                className={`inline-flex w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold text-white transition md:w-auto ${
                    syncing ? 'bg-slate-400' : 'bg-[#0f2347] hover:bg-[#0b1b38]'
                }`}
            >
                {syncing ? 'Sincronizando...' : 'Actualizar ahora'}
            </button>

            {error && (
                <div className="mt-3 rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    Error: {error}
                </div>
            )}

            {syncResult && (
                <div className="mt-3 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-slate-700 shadow-sm">
                    <p className="font-black text-slate-900">Actualizacion completada</p>
                    <ul className="mt-3 space-y-1">
                        <li>Ordenes sincronizadas: <strong>{syncResult.fetched_orders}</strong></li>
                        <li>Eventos nuevos: <strong>{syncResult.inserted_webhooks}</strong></li>
                        <li>Eventos ya registrados: <strong>{syncResult.deduped_webhooks}</strong></li>
                    </ul>
                </div>
            )}

            {score && (
                <div className="mt-3 rounded-[20px] border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-slate-700 shadow-sm">
                    <p className="font-black text-slate-900">Lectura actualizada</p>
                    <p className="mt-2">Score actual: <strong>{score.score}</strong> / 100</p>
                    <p>Calculado: <strong>{new Date(score.computed_at).toLocaleString()}</strong></p>
                    <div className="mt-4">
                        <p className="font-black text-slate-900">Estado operativo</p>
                        {(score.active_signals ?? []).length === 0 ? (
                            <p className="mt-2 text-slate-600">No hay alertas operativas activas.</p>
                        ) : (
                            <ul className="mt-2 space-y-2">
                                {(score.active_signals ?? []).map((signal) => (
                                    <li key={signal.signal_key} className="rounded-2xl border border-sky-100 bg-white px-3 py-3">
                                        <p className="font-bold text-slate-900">
                                            {signalLabel(signal.signal_key)} [{severityLabel(signal.severity)}]
                                        </p>
                                        <p className="mt-1 text-xs text-slate-600">Evidencia: {briefEvidence(signal.evidence)}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
