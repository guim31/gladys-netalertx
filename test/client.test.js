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

test('the recorded device list is read, without the "internet" pseudo-device', async () => {
  const devices = await client(createServer(LATER_SCAN)).listDevices();
  assert.equal(LATER_SCAN.length, 7);
  assert.equal(devices.length, 6);
  assert.ok(!devices.some((device) => device.ip === '198.51.100.7'));
  const laptop = devices.find((device) => device.mac === '02:00:5e:10:00:21');
  assert.deepEqual(laptop, {
    mac: '02:00:5e:10:00:21',
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
  await client(server).listDevices();
  const { query } = server.requests[0].body;
  const recorded = new Set(Object.keys(FIRST_SCAN[0]));
  for (const field of DEVICE_FIELDS) {
    assert.ok(query.includes(field), field);
    assert.ok(recorded.has(field), `${field} is in the recorded answer`);
  }
});

test('the token travels as a Bearer header, and a refused token is an auth error', async () => {
  const server = createServer();
  await client(server).listDevices();
  assert.equal(server.requests[0].url, 'http://192.0.2.10:20212/graphql');
  await assert.rejects(client(server, 't_wrong').listDevices(), (err) => {
    assert.equal(err.kind, 'auth');
    assert.equal(err.status, 403);
    assert.doesNotMatch(err.message, /t_wrong/);
    return true;
  });
});

test('a GraphQL error, a non-JSON answer and a refused connection have their own kind', async () => {
  const graphqlError = {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => fixture('graphql-unknown-field.json'),
    }),
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
});

test('a request that hangs times out', async () => {
  const hanging = {
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
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
