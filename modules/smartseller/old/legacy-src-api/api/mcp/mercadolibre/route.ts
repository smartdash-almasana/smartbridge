import { NextRequest } from "next/server";
import { getActiveToken, isExpired, isReauthorizationRequiredError, refreshToken } from "@/lib/meli/token";
import { supabaseAdmin } from "@/lib/supabase-server";

const MELI_MCP_URL = "https://mcp.mercadolibre.com/mcp";

export async function GET(req: NextRequest) {
  return handleProxy(req);
}

export async function POST(req: NextRequest) {
  return handleProxy(req);
}

async function handleProxy(req: NextRequest) {
  const requestId = crypto.randomUUID();
  console.log(`[MCP_PROXY_${requestId}] Request received: ${req.method} ${req.url}`);
  const url = new URL(req.url);

  const queryUserId =
    url.searchParams.get("userId") ||
    url.searchParams.get("user_id");

  const headerUserId =
    req.headers.get("x-meli-user-id");

  const defaultUserId =
    process.env.MELI_DEFAULT_USER_ID;

  const userId =
    queryUserId ||
    headerUserId ||
    defaultUserId;

  if (!userId) {
    return Response.json({
      error: "missing_context_user_id",
      message:
        "Provide userId/user_id query param, x-meli-user-id header, or set MELI_DEFAULT_USER_ID",
    }, { status: 400 });
  }
  console.log("Using userId:", userId);

  // Lock logic for SSE
  const isSSERequest = req.method === "GET";
  let lockAcquired = false;

  const releaseLock = async () => {
    if (lockAcquired) {
      console.log(`[MCP_PROXY_${requestId}] Releasing lock for user ${userId}`);
      await supabaseAdmin
        .from("meli_sse_locks")
        .delete()
        .eq("token_hash", userId)
        .eq("client_id", requestId);
      lockAcquired = false;
    }
  };

  try {
    if (isSSERequest) {
      // 1. Cleanup expired locks for this user
      await supabaseAdmin
        .from("meli_sse_locks")
        .delete()
        .eq("token_hash", userId)
        .lt("expires_at", new Date().toISOString());

      // 2. Try to acquire lock
      const { error: lockErr } = await supabaseAdmin
        .from("meli_sse_locks")
        .insert({
          token_hash: userId,
          client_id: requestId,
          expires_at: new Date(Date.now() + 90000).toISOString() // 90s defensive TTL
        });

      if (lockErr) {
        console.warn(`[MCP_PROXY_${requestId}] Lock acquisition failed for user ${userId}:`, lockErr.message);
        return new Response(JSON.stringify({
          error: "conflict",
          message: `Only one SSE stream is allowed per session. (Lock error: ${lockErr.message})`
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      lockAcquired = true;
    }

    // 1. Obtener token activo
    let token = await getActiveToken(userId);

    // 2. Verificar expiración proactiva (Refresh if expired or < 2 mins)
    if (isExpired(token)) {
      console.log(`[MCP_PROXY_${requestId}] Token expired or soon to expire. Refreshing...`);
      try {
        token = await refreshToken(userId);
        console.log(`[MCP_PROXY_${requestId}] Refresh SUCCESS. New expiration: ${token.expires_at}`);
      } catch (e: any) {
        console.error(`[MCP_PROXY_${requestId}] Initial refresh failed:`, e);
        if (isReauthorizationRequiredError(e)) {
          return new Response(JSON.stringify({
            error: "reauthorization_required",
            action: "/api/meli/oauth/start",
          }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (e.message?.startsWith("REFRESH_FAILED")) {
          return new Response(`Token refresh failed. Your session might be invalid. Error: ${e.message}`, { status: 401 });
        }
        return new Response(`Token refresh network error: ${e.message}`, { status: 502 });
      }
    }

    // 3. Preparar headers base
    const requestHeaders = new Headers(req.headers);
    requestHeaders.delete("host");
    requestHeaders.delete("connection");
    requestHeaders.delete("content-length");
    requestHeaders.delete("transfer-encoding");
    requestHeaders.delete("authorization"); // Remove client auth
    if (!requestHeaders.has("accept")) {
      // Upstream MCP expects SSE responses by default
      requestHeaders.set("accept", "text/event-stream");
    }

    // 4. Leer body
    let requestBody: ArrayBuffer | undefined = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        const buf = await req.arrayBuffer();
        if (buf.byteLength > 0) {
          requestBody = buf;
        }
      } catch (e) {
        console.warn(`[MCP_PROXY_${requestId}] Failed to read request body:`, e);
      }
    }

    // 5. Helper fetch
    const doFetch = async (accessToken: string) => {
      const headers = new Headers(requestHeaders);
      headers.set("Authorization", `Bearer ${accessToken}`);

      return fetch(MELI_MCP_URL, {
        method: req.method,
        headers: headers,
        body: requestBody,
        cache: "no-store",
      });
    };

    // 6. Primer intento
    let upstreamRes = await doFetch(token.access_token);
    console.log(`[MCP_PROXY_${requestId}] Upstream Response: ${upstreamRes.status}`);

    // 7. Manejo de 401 (Token invalido/revocado por ML)
    if (upstreamRes.status === 401) {
      console.warn(`[MCP_PROXY_${requestId}] Upstream 401. Re-authenticating...`);
      try {
        const newToken = await refreshToken(userId);

        // Reintentamos
        upstreamRes = await doFetch(newToken.access_token);
        console.log(`[MCP_PROXY_${requestId}] Retry Response: ${upstreamRes.status}`);
      } catch (e: any) {
        console.error(`[MCP_PROXY_${requestId}] Retry refresh failed:`, e);
        if (isReauthorizationRequiredError(e)) {
          return new Response(JSON.stringify({
            error: "reauthorization_required",
            action: "/api/meli/oauth/start",
          }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (e.message?.startsWith("REFRESH_FAILED")) {
          return new Response(JSON.stringify({ error: "Token refresh failed during retry (credential invalid)", details: e.message }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ error: "Token refresh network failed during retry", details: e.message }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 8. Streaming de la respuesta
    const responseHeaders = new Headers(upstreamRes.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");

    let finalBody = upstreamRes.body;
    if (isSSERequest && finalBody) {
      const transform = new TransformStream({
        cancel() { releaseLock(); },
        flush() { releaseLock(); }
      });
      finalBody = finalBody.pipeThrough(transform);
    } else {
      // For non-SSE or empty body, release immediately
      await releaseLock();
    }

    return new Response(finalBody, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });

  } catch (error: any) {
    if (lockAcquired) await releaseLock();
    console.error(`[MCP_PROXY_${requestId}] Internal Proxy Error:`, error);
    if (isReauthorizationRequiredError(error)) {
      return new Response(JSON.stringify({
        error: "reauthorization_required",
        action: "/api/meli/oauth/start",
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Internal Proxy Error", details: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
