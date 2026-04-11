import { NextResponse } from "next/server";
import { fetchCasosCliente } from "@/lib/server/casos";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clienteId: string }> }
) {
  try {
    const { clienteId } = await params;
    const casos = await fetchCasosCliente(clienteId);
    return NextResponse.json({ casos });
  } catch (err) {
    return NextResponse.json({ casos: [] }, { status: 500 });
  }
}
