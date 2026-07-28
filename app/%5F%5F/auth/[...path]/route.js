const FIREBASE_AUTH_ORIGIN = "https://meetspot-production.firebaseapp.com";

async function proxyFirebaseAuth(request, { params }) {
  const { path } = await params;
  const incomingUrl = new URL(request.url);
  const target = new URL(`/__/auth/${path.join("/")}`, FIREBASE_AUTH_ORIGIN);
  target.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const dynamic = "force-dynamic";
export const GET = proxyFirebaseAuth;
export const POST = proxyFirebaseAuth;
