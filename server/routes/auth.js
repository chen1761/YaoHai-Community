const SESSION_COOKIE = 'yaohai_session';
const SESSION_MAX_AGE = 12 * 60 * 60;

export async function handleAuthRoute(request, response, context) {
  const { pathname } = new URL(request.url, 'http://localhost');

  if (request.method === 'POST' && pathname === '/api/setup') {
    const body = await context.readJson(request);
    const created = await context.store.createOwner(body.username, body.password);
    if (!created) return context.sendJson(response, 409, { error: 'already_configured' });
    return context.sendJson(response, 201, { ok: true });
  }

  if (request.method === 'POST' && pathname === '/api/auth/login') {
    const body = await context.readJson(request);
    const session = await context.store.authenticate(body.username, body.password);
    if (!session) return context.sendJson(response, 401, { error: 'invalid_credentials' });
    response.setHeader('set-cookie', serializeSessionCookie(session.sessionId));
    return context.sendJson(response, 200, { ok: true });
  }

  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    context.store.revokeSession(readSessionCookie(request));
    response.setHeader('set-cookie', serializeSessionCookie('', 0));
    response.writeHead(204);
    response.end();
    return true;
  }

  return false;
}

export function requireSession(request, response, context) {
  if (context.store.isSessionValid(readSessionCookie(request))) return true;
  context.sendJson(response, 401, { error: 'authentication_required' });
  return false;
}

function readSessionCookie(request) {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return undefined;
}

function serializeSessionCookie(value, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
