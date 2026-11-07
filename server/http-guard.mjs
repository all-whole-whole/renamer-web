// Same-origin / local-host guards for the HTTP gateway.
//
// The host process is deliberately loopback-only, but a page on another origin
// must not be able to drive it. Comparing raw strings with `includes()` is not
// enough (`127.0.0.1:8758.evil.test` contains the expected text), so both the
// Host header and the Origin header are parsed and matched exactly.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function normalizeHostname(value) {
  return String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
}

function parseHostHeader(hostHeader) {
  const raw = String(hostHeader || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(`http://${raw}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return { hostname: normalizeHostname(url.hostname), port: url.port || '80' };
  } catch {
    return null;
  }
}

/** Is this Host header the configured local listener (or loopback on its port)? */
export function isAllowedHost(hostHeader, bind = {}) {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  const port = String(bind.port ?? '');
  if (port && parsed.port !== port) return false;
  const expected = normalizeHostname(bind.host || '127.0.0.1');
  return parsed.hostname === expected || LOOPBACK.has(parsed.hostname);
}

/**
 * A request without an Origin is allowed (CLI/curl); when an Origin is present
 * it must be the exact scheme+host+port of the request's Host header.
 */
export function isSameOrigin(origin, hostHeader, bind = {}) {
  if (origin === undefined || origin === null || origin === '') return true;
  if (!isAllowedHost(hostHeader, bind)) return false;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  return parsed.host.toLowerCase() === String(hostHeader || '').toLowerCase();
}
