import { NextRequest, NextResponse } from "next/server";

const TARGET_HOST = process.env.JMAP_BACKEND_HOST || "mail.arhamworkspace.tech";
const TARGET_URL = `https://${TARGET_HOST}/.well-known/jmap`;

export async function GET(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("Host", TARGET_HOST);
  headers.delete("connection");
  headers.delete("content-length");

  try {
    const res = await fetch(TARGET_URL, {
      method: "GET",
      headers,
      redirect: "follow",
    });

    const body = await res.arrayBuffer();
    const resHeaders = new Headers(res.headers);
    resHeaders.set("Access-Control-Allow-Origin", req.headers.get("origin") || "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "*");

    return new NextResponse(body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    console.error(`JMAP discovery proxy error:`, err);
    return new NextResponse(JSON.stringify({ error: "proxy_error", message: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    },
  });
}
