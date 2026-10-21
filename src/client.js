// -----------------------------------------------------------------------------
// NetAlertX API client (the backend on GRAPHQL_PORT, 20212 by default).
//
// - The device list is read through GraphQL (`POST /graphql`, NetAlertX 24.x
//   and later), asking only for columns every version has: GraphQL refuses
//   the whole query (HTTP 200 with `errors`) on a field it does not know, so
//   newer columns (devIsSleeping, devPrimaryIPv4...) are never requested.
// - "Mark as known" clears `devIsNew` through the REST endpoint
//   `POST /device/<mac>/update-column` (the call the NetAlertX interface makes).
//
// Both authenticate with `Authorization: Bearer <API_TOKEN>`; a wrong or empty
// token is a 403 `{ success: false, message: "ERROR: Not authorized" }`.
// The token never appears in an error message or a log line.
// -----------------------------------------------------------------------------

export const REQUEST_TIMEOUT_MS = 10000;

export const DEVICE_FIELDS = [
  'devMac',
  'devName',
  'devVendor',
  'devLastIP',
  'devPresentLastScan',
  'devIsNew',
  'devAlertDown',
  'devFirstConnection',
  'devLastConnection',
  'devGroup',
  'devIsArchived',
];

const DEVICES_QUERY = `{ devices { count devices { ${DEVICE_FIELDS.join(' ')} } } }`;

// Names NetAlertX gives a device it could not resolve.
const UNNAMED = new Set(['', '(unknown)', '(name not found)']);

/** An API failure; `kind`: auth | notFound | http | network | timeout | format. */
export class NetAlertXError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'NetAlertXError';
    this.kind = kind;
    this.status = status;
  }
}

/** "AA-BB-CC-DD-EE-FF", "aabb.ccdd.eeff", "aa:bb:..." → "aa:bb:cc:dd:ee:ff"; null otherwise. */
export function normalizeMac(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12 || !/^[0-9a-f:.\-\s]+$/i.test(value.trim())) {
    return null;
  }
  return hex.match(/../g).join(':');
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const flag = (value) => value === 1 || value === '1' || value === true;

/**
 * One row of the device list, as the rest of the code uses it. Rows without
 * a real MAC address (the "internet" pseudo-device that holds the public IP)
 * are dropped: they are not devices of the network.
 */
export function normalizeDevice(row) {
  const mac = normalizeMac(row?.devMac);
  if (!mac) {
    return null;
  }
  const name = text(row.devName);
  return {
    mac,
    name: UNNAMED.has(name.toLowerCase()) ? '' : name,
    vendor: text(row.devVendor),
    ip: text(row.devLastIP),
    present: flag(row.devPresentLastScan),
    isNew: flag(row.devIsNew),
    alertDown: flag(row.devAlertDown),
    archived: flag(row.devIsArchived),
    firstSeen: text(row.devFirstConnection),
    lastSeen: text(row.devLastConnection),
    group: text(row.devGroup),
  };
}

/** The name to show: the NetAlertX one, else the vendor, else the MAC address. */
export function displayName(device) {
  if (device.name) {
    return device.name;
  }
  // "(Unknown: locally administered)": a private (random) MAC, no vendor.
  if (device.vendor && !device.vendor.startsWith('(')) {
    return `${device.vendor} ${device.mac.slice(-5)}`;
  }
  return device.mac;
}

export class NetAlertXClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of the API (see normalizeUrl)
   * @param {string} options.token API_TOKEN of NetAlertX
   * @param {Function} [options.fetch]
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token, fetch: fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS }) {
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new NetAlertXError('timeout', `No answer within ${this.timeoutMs / 1000} s`);
      }
      throw new NetAlertXError('network', err?.cause?.code ?? err?.message ?? 'Network error');
    }
    const data = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      throw new NetAlertXError('auth', 'API token refused', response.status);
    }
    if (response.status === 404) {
      throw new NetAlertXError('notFound', data?.error ?? 'Not found', 404);
    }
    if (!response.ok) {
      throw new NetAlertXError('http', `HTTP ${response.status}`, response.status);
    }
    if (data === null || typeof data !== 'object') {
      throw new NetAlertXError('format', 'The answer is not JSON (is this the API port?)');
    }
    return data;
  }

  /** Every device of NetAlertX with a MAC address, archived ones included. */
  async listDevices() {
    const data = await this.request('/graphql', { method: 'POST', body: { query: DEVICES_QUERY } });
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0];
      throw new NetAlertXError(
        'format',
        `GraphQL: ${String(first?.message ?? first).slice(0, 200)}`,
      );
    }
    const rows = data?.data?.devices?.devices;
    if (!Array.isArray(rows)) {
      throw new NetAlertXError('format', 'GraphQL: no device list in the answer');
    }
    return rows.map(normalizeDevice).filter(Boolean);
  }

  /** Clear the "new device" flag of one device (404 when NetAlertX does not know it). */
  async markKnown(mac) {
    const data = await this.request(`/device/${encodeURIComponent(mac)}/update-column`, {
      method: 'POST',
      body: { columnName: 'devIsNew', columnValue: 0 },
    });
    if (data.success === false) {
      throw new NetAlertXError('http', String(data.error ?? data.message ?? 'Refused'));
    }
  }
}
