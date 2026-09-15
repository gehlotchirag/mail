import { NextRequest, NextResponse } from "next/server";

const TARGET_HOST = process.env.JMAP_BACKEND_HOST || "mail.arhamworkspace.tech";

async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const pathStr = path && path.length > 0 ? path.join("/") : "";
  const search = req.nextUrl.search;
  const targetUrl = `https://${TARGET_HOST}/jmap${pathStr ? `/${pathStr}` : "/"}${search}`;

  const headers = new Headers(req.headers);
  headers.set("Host", TARGET_HOST);
  headers.delete("connection");
  headers.delete("content-length");

  let body: BodyInit | undefined = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  try {
    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "follow",
    });

    const resBody = await res.arrayBuffer();
    const resHeaders = new Headers(res.headers);
    resHeaders.set("Access-Control-Allow-Origin", req.headers.get("origin") || "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    resHeaders.set("Access-Control-Allow-Headers", "*");

    return new NextResponse(resBody, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    });
  } catch (err) {
    console.error(`JMAP proxy error for ${targetUrl}:`, err);
    return new NextResponse(JSON.stringify({ error: "proxy_error", message: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxyRequest(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxyRequest(req, ctx);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxyRequest(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxyRequest(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return proxyRequest(req, ctx);
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    },
  });
}
