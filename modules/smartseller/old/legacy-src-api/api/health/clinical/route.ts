import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

const SHIPMENT_SLA_KEY = "sla_breach_risk";
const QUESTION_SLA_KEY = "sla_questions_overdue";
const ACTIVE_STATUS = "active";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sellerUuid =
    req.headers.get("x-meli-user-id") ??
    searchParams.get("user_id") ??
    searchParams.get("seller_uuid");

  if (!sellerUuid) {
    return NextResponse.json({
      error_code: "missing_context",
      message: "The x-meli-user-id header or seller_uuid query param is required.",
      timestamp: new Date().toISOString(),
      request_id: req.headers.get("x-request-id") ?? undefined
    }, { status: 400 });
  }

  const { data: seller, error: sellerError } = await supabaseAdmin
    .from("sellers")
    .select("seller_uuid")
    .eq("provider_key", "meli")
    .eq("external_id", sellerUuid)
    .maybeSingle();

  if (sellerError) {
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }

  if (!seller?.seller_uuid) {
    return NextResponse.json({
      error_code: "seller_not_found",
      message: "The requested seller was not found in the clinical system.",
      timestamp: new Date().toISOString(),
      request_id: req.headers.get("x-request-id") ?? undefined
    }, { status: 404 });
  }

  const { count: shipmentRiskCount, error: shipmentError } = await supabaseAdmin
    .from("signal_state")
    .select("*", { count: "exact", head: true })
    .eq("signal_key", SHIPMENT_SLA_KEY)
    .eq("status", ACTIVE_STATUS)
    .eq("seller_uuid", seller.seller_uuid);

  if (shipmentError) {
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }

  const { count: questionRiskCount, error: questionError } = await supabaseAdmin
    .from("signal_state")
    .select("*", { count: "exact", head: true })
    .eq("signal_key", QUESTION_SLA_KEY)
    .eq("status", ACTIVE_STATUS)
    .eq("seller_uuid", seller.seller_uuid);

  if (questionError) {
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }

  const shipment = shipmentRiskCount ?? 0;
  const question = questionRiskCount ?? 0;
  const healthScore = clamp(100 - shipment * 20 - question * 10, 0, 100);

  return NextResponse.json({
    seller_uuid: seller.seller_uuid,
    shipment_risk_count: shipment,
    question_risk_count: question,
    health_score: healthScore,
    meta: { monitor_version: "sla_clinical_v1" },
  });
}
