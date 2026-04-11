import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { processWebhookEvent } from '@/lib/engine/smartseller/processor';

/**
 * Worker para procesar eventos de webhook pendientes.
 * Implementa el patrón de Worker Seguro con Claim Atómico y reintentos.
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('authorization');
    const cronToken = process.env.CRON_TOKEN;

    // Validación de seguridad (manteniendo el esquema existente)
    if (cronToken && authHeader !== `Bearer ${cronToken}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stats = {
        claimed: 0,
        done: 0,
        failed: 0,
        retried: 0
    };

    try {
        // 1. Claim atómico (pending -> processing) usando la función RPC en Supabase.
        // Esto garantiza que múltiples workers no procesen el mismo evento y respeta SKIP LOCKED.
        const { data: events, error: claimError } = await supabaseAdmin
            .rpc('claim_webhook_events', {
                batch_size: 50,
                worker_id: `worker-job-${Date.now()}`
            });

        if (claimError) throw claimError;
        if (!events || events.length === 0) {
            return NextResponse.json({ message: 'No pending events', stats });
        }

        stats.claimed = events.length;

        // 2. Procesamiento secuencial del batch reclamado
        for (const event of events) {
            try {
                // Ejecutar la lógica de negocio del motor SmartSeller
                await processWebhookEvent(event);

                // Éxito: Registrar como completado
                await supabaseAdmin
                    .from('webhook_events')
                    .update({
                        status: 'done',
                        processed_at: new Date().toISOString(),
                        last_error: null
                    })
                    .eq('id', event.id);

                stats.done++;
            } catch (err: any) {
                const errorMessage = err.message || 'Unknown processing error';
                const attempts = event.attempts || 0;

                if (attempts >= 8) {
                    // Fallo definitivo tras 8 reintentos
                    await supabaseAdmin
                        .from('webhook_events')
                        .update({
                            status: 'failed',
                            last_error: errorMessage,
                            processed_at: new Date().toISOString()
                        })
                        .eq('id', event.id);
                    stats.failed++;
                } else {
                    // Volver a 'pending' para reintentar con backoff en el próximo ciclo
                    await supabaseAdmin
                        .from('webhook_events')
                        .update({
                            status: 'pending',
                            last_error: errorMessage
                        })
                        .eq('id', event.id);
                    stats.retried++;
                }
            }
        }

        return NextResponse.json(stats);

    } catch (error) {
        console.error('[Job Error] Webhook worker failed:', error);
        return NextResponse.json({ error: 'Worker failure', stats }, { status: 500 });
    }
}
