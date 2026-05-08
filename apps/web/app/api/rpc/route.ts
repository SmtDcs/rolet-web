import { NextRequest, NextResponse } from "next/server";

const UPSTREAM_RPC = process.env.RPCFAST_BACKEND_URL ?? "https://api.devnet.solana.com";

/**
 * Thin JSON-RPC proxy so the browser never talks to RPC Fast directly
 * (their Beam product doesn't set CORS headers for browser origins).
 * The frontend sends requests to /api/rpc, and this route forwards them
 * server-side to the real RPC endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const upstream = await fetch(UPSTREAM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const data = await upstream.text();

    return new NextResponse(data, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32000, message: String(err) }, id: null },
      { status: 502 }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
