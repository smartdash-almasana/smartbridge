
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    service: 'clinical-engine',
    timestamp: new Date().toISOString()
  });
}
