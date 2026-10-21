// -----------------------------------------------------------------------------
// The NetAlertX client against answers recorded from a real NetAlertX 26.10.0
// (test/fixtures/netalertx/, anonymized), served by a fake fetch.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FIELDS,
  NetAlertXClient,
  displayName,
  normalizeDevice,
  normalizeMac,
} from '../src/client.js';
import { FIRST_SCAN, LATER_SCAN, TOKEN, createServer, fixture } from './helpers/world.js';

const client = (server, token = TOKEN) =>
  new NetAlertXClient({ url: 'http://192.0.2.10:20212', token, fetch: server.fetch });

test('MAC addresses are normalized, anything else is refused', () => {
  assert.equal(normalizeMac('64-E4-D5-B4-12-66'), '64:e4:d5:b4:12:66');
  assert.equal(normalizeMac('64e4.d5b4.1266'), '64:e4:d5:b4:12:66');
  assert.equal(normalizeMac(' 64:e4:d5:b4:12:66 '), '64:e4:d5:b4:12:66');
  for (const value of ['internet', '64:e4:d5:b4:12', '64:e4:d5:b4:12:6g', '', null, 12]) {
    assert.equal(normalizeMac(value), null, String(value));
  }
});

test('GET /devices is read first: a real row of NetAlertX 26.10.0', async () => {
  const { devices: rows } = fixture('rest-devices.json');
  const server = createServer(rows);
  const devices = await client(server).listDevices();
  assert.deepEqual(
    server.requests.map((r) => `${r.method} ${r.path}`),
    ['GET /devices'],
  );
  assert.equal(devices.length, 2);
  assert.equal(devices[0].mac, '02:00:5e:10:00:21');
  assert.equal(devices[0].rawMac, '02:00:5e:10:00:21');
  assert.equal(devices[0].name, 'laptop.lan');
  assert.equal(devices[0].present, false);
  assert.equal(devices[0].alertDown, true);
});

test('an older NetAlertX without GET /devices is read through GraphQL, then directly', async () => {
  const server = createServer(LATER_SCAN);
  server.rest = false;
  const c = client(server);
  await c.listDevices();
  await c.listDevices();
  assert.deepEqual(
    server.requests.map((r) => `${r.method} ${r.path}`),
    ['GET /devices', 'POST /graphql', 'POST /graphql'],
  );
});

test('the recorded device list is read, without the "internet" pseudo-device', async () => {
  const server = createServer(LATER_SCAN);
  server.rest = false;
  const devices = await client(server).listDevices();
  assert.equal(LATER_SCAN.length, 7);
  assert.equal(devices.length, 6);
  assert.ok(!devices.some((device) => device.ip === '198.51.100.7'));
  const laptop = devices.find((device) => device.mac === '02:00:5e:10:00:21');
  assert.deepEqual(laptop, {
    mac: '02:00:5e:10:00:21',
    rawMac: '02:00:5e:10:00:21',
    name: 'laptop.lan',
    vendor: '(Unknown: locally administered)',
    ip: '192.0.2.21',
    present: false,
    isNew: true,
    alertDown: true,
    archived: false,
    firstSeen: '2026-10-21 14:36:18',
    lastSeen: '2026-10-21 14:38:18',
    group: '',
  });
  assert.equal(devices.find((device) => device.name === 'tv.lan').isNew, false);
});

test('the GraphQL query asks only for columns of the recorded answer', async () => {
  const server = createServer();
  server.rest = false;
  await client(server).listDevices();
  const { query } = server.requests[1].body;
  const recorded = new Set(Object.keys(FIRST_SCAN[0]));
  for (const field of DEVICE_FIELDS) {
    assert.ok(query.includes(field), field);
    assert.ok(recorded.has(field), `${field} is in the recorded answer`);
  }
});

test('the token travels as a Bearer header, and a refused token is an auth error', async () => {
  const server = createServer();
  await client(server).listDevices();
  assert.equal(server.requests[0].url, 'http://192.0.2.10:20212/devices');
  await assert.rejects(client(server, 't_wrong').listDevices(), (err) => {
    assert.equal(err.kind, 'auth');
    assert.equal(err.status, 403);
    assert.doesNotMatch(err.message, /t_wrong/);
    return true;
  });
});

test('a GraphQL error, a non-JSON answer and a refused connection have their own kind', async () => {
  // An older NetAlertX (no GET /devices) whose GraphQL refuses the query.
  const graphqlError = {
    fetch: async (url) =>
      url.endsWith('/devices')
        ? { ok: false, status: 404, json: async () => ({ error: 'Not Found' }) }
        : { ok: true, status: 200, json: async () => fixture('graphql-unknown-field.json') },
  };
  await assert.rejects(
    new NetAlertXClient({ url: 'http://x', token: TOKEN, ...graphqlError }).listDevices(),
    { kind: 'format', message: /Cannot query field/ },
  );
  const html = {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }),
  };
  await assert.rejects(
    new NetAlertXClient({ url: 'http://x', token: TOKEN, ...html }).listDevices(),
    {
      kind: 'format',
    },
  );
  const server = createServer();
  server.down = true;
  await assert.rejects(client(server).listDevices(), { kind: 'network', message: 'ECONNREFUSED' });
  const proxyError = { fetch: async () => ({ ok: false, status: 502, json: async () => null }) };
  await assert.rejects(
    new NetAlertXClient({ url: 'http://x', token: TOKEN, ...proxyError }).listDevices(),
    { kind: 'http', status: 502 },
  );
  // A token pasted with an invisible character: the real fetch refuses the header.
  await assert.rejects(
    new NetAlertXClient({ url: 'http://192.0.2.10', token: 't_abc\u200b' }).listDevices(),
    { kind: 'auth' },
  );
});

test('a request that hangs times out', async () => {
  // The timer of AbortSignal.timeout does not keep the event loop alive (Node
  // 22): the hanging request holds a timer of its own, like a socket would.
  const hanging = {
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        const socket = setTimeout(resolve, 5000);
        init.signal.addEventListener('abort', () => {
          clearTimeout(socket);
          reject(init.signal.reason);
        });
      }),
  };
  await assert.rejects(
    new NetAlertXClient({ url: 'http://x', token: TOKEN, timeoutMs: 20, ...hanging }).listDevices(),
    { kind: 'timeout' },
  );
});

test('marking a device as known clears devIsNew; an unknown MAC is a notFound error', async () => {
  const server = createServer();
  await client(server).markKnown('02:00:5e:10:00:21');
  assert.deepEqual(server.requests.at(-1), {
    url: 'http://192.0.2.10:20212/device/02%3A00%3A5e%3A10%3A00%3A21/update-column',
    method: 'POST',
    path: '/device/02%3A00%3A5e%3A10%3A00%3A21/update-column',
    body: { columnName: 'devIsNew', columnValue: 0 },
  });
  assert.equal(server.row('02:00:5e:10:00:21').devIsNew, 0);
  await assert.rejects(client(server).markKnown('02:00:5e:10:00:99'), { kind: 'notFound' });
});

test('a device without a resolved name is shown by its vendor, else its MAC address', () => {
  const base = { devMac: '64:E4:D5:B4:12:66', devPresentLastScan: 1 };
  const unnamed = normalizeDevice({ ...base, devName: '(unknown)', devVendor: 'Apple, Inc.' });
  assert.equal(unnamed.name, '');
  assert.equal(displayName(unnamed), 'Apple, Inc. 12:66');
  const random = normalizeDevice({
    ...base,
    devName: '(name not found)',
    devVendor: '(Unknown: locally administered)',
  });
  assert.equal(displayName(random), '64:e4:d5:b4:12:66');
  assert.equal(normalizeDevice({ devMac: 'internet' }), null);
  assert.equal(normalizeDevice(null), null);
});
