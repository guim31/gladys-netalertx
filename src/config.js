// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two reads of the NetAlertX device list. NetAlertX scans the
// network every 5 minutes by default (ARPSCAN_RUN_SCHD): reading more often
// only catches a scan sooner. The timer runs in the container (devices are
// published with should_poll: false).
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// Port of the NetAlertX API (GRAPHQL_PORT) since 2025, used when the address has none.
export const DEFAULT_API_PORT = 20212;

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  poll_interval: '60',
  language: 'fr',
};

/**
 * "192.168.1.10", "netalertx.lan:20212/", "https://nax.example.org" → a base URL
 * without trailing slash; null when the address is unusable.
 */
export function normalizeUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in logs and error messages.
  if (url.username || url.password) {
    return null;
  }
  const explicitPort = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:]+):\d+/i.test(withScheme);
  if (!explicitPort && url.protocol === 'http:') {
    url.port = String(DEFAULT_API_PORT);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const interval = String(source.poll_interval ?? '');
  return {
    url: normalizeUrl(source.url),
    token: typeof source.api_token === 'string' ? source.api_token.trim() : '',
    pollInterval: Number(
      POLL_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.poll_interval,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
