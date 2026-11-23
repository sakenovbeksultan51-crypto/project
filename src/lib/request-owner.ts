const SESSION_COOKIE = 'tableflow_session';

export function requestOwner(request: Request) {
  const user = request.headers.get('oai-authenticated-user-id');
  if (user) return user;

  const session = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (session && /^[a-f0-9-]{36}$/i.test(session)) return `web:${session}`;

  const hostname = new URL(request.url).hostname;
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    ? 'local-development'
    : null;
}

export async function withBrowserSession(
  request: Request,
  handler: (request: Request) => Promise<Response>,
) {
  if (process.env.VERCEL !== '1' || requestOwner(request)) return handler(request);

  const session = crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set('cookie', `${headers.get('cookie') || ''}; ${SESSION_COOKIE}=${session}`);
  const response = await handler(new Request(request, { headers }));
  const responseHeaders = new Headers(response.headers);
  responseHeaders.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
