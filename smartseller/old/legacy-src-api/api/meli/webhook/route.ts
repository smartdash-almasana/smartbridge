import { NextRequest, NextResponse } from 'next/server';
import { storeMeliWebhookEvent } from '@/lib/services/smartseller/meli-webhook';

export const dynamic = 'force-dynamic';

/**
 * Endpoint para recibir webhooks de Mercado Libre.
 * 
 * Directiva: Responder HTTP 200 en <500ms y procesar async.
 */
export async function POST(request: NextRequest) {
    const startTime = Date.now();

    try {
        let rawText = '';
        try {
            rawText = await request.text();
        } catch (e) {
            console.warn('[Webhook] Failed to read raw request text');
            return NextResponse.json({ status: 'invalid_body_text' }, {
                status: 200,
                headers: {
                    'Cache-Control': 'no-store'
                }
            });
        }

        let body: any = null;
        let parseOk = true;
        let parseError: string | null = null;

        if (rawText) {
            try {
                body = JSON.parse(rawText);
            } catch (e: any) {
                console.warn('[Webhook] Received invalid JSON payload');
                parseOk = false;
                parseError = e.message;
            }
        } else {
            parseOk = false;
            parseError = 'empty_body';
        }

        const sellerIdHeader = request.headers.get('x-seller-id');

        const headersAllowlist: Record<string, string> = {
            'content-type': request.headers.get('content-type') || '',
            'user-agent': request.headers.get('user-agent') || '',
            'x-request-id': request.headers.get('x-request-id') || '',
            'x-seller-id': sellerIdHeader || ''
        };

        const result = await storeMeliWebhookEvent({
            rawText,
            parseOk,
            parseError,
            body,
            sellerIdOverride: sellerIdHeader,
            requestPath: request.nextUrl.pathname,
            headersAllowlist
        });

        const duration = Date.now() - startTime;

        if (result.success) {
            console.log(`[Webhook] ML event ${result.providerEventId} stored in ${duration}ms. Parse OK: ${parseOk}`);
        } else {
            console.error('[Webhook] Storage failed for event:', result.error);
        }

        return NextResponse.json({
            status: parseOk ? 'received' : 'invalid_json_stored',
            id: result.providerEventId,
            duration: `${duration}ms`
        }, {
            status: 200,
            headers: {
                'Cache-Control': 'no-store'
            }
        });

    } catch (error) {
        console.error('[Webhook API Error] Critical failure:', error);
        return NextResponse.json({ status: 'error_logged' }, {
            status: 200,
            headers: {
                'Cache-Control': 'no-store'
            }
        });
    }
}
