// -----------------------------------------------------------------------------
// The monitor: reference list, scene events, states, persistence under /data,
// NetAlertX lost and back. The scans are the ones recorded from a real
// NetAlertX (first scan: 5 devices present; later scan: laptop and phone gone,
// laptop with "Alert down", a new tablet, tv acknowledged).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_EVENTS_PER_CYCLE, formatSeen } from '../src/monitor.js';
import {
  CONFIG,
  FIRST_SCAN,
  LATER_SCAN,
  create,
  createServer,
  createWorld,
  discovered,
  events,
  featureId,
  read,
} from './helpers/world.js';

const LAPTOP = '02005e100021';
const PHONE = '02005e100022';
const SUMMARY = 'network:summary';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('the first read only records the network: no scene event', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(events(w), []);
  // The summary and the 5 devices with a real MAC address.
  assert.equal(w.fake.discoveredDevices.length, 6);
  assert.equal(w.fake.discoveredDevices[0].name, 'NetAlertX network');
});

test('the later scan: departures, a down alert, a new device', async (t) => {
  const w = await world(t);
  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  assert.deepEqual(
    events(w).map(([key, data]) => [key, data.mac]),
    [
      ['device_left', '02:00:5e:10:00:21'],
      ['down_alert', '02:00:5e:10:00:21'],
      ['device_left', '02:00:5e:10:00:22'],
      ['new_device', '02:00:5e:10:00:24'],
    ],
  );
  const [, down] = events(w)[1];
  assert.deepEqual(down, {
    device: discovered(w, LAPTOP).external_id,
    mac: '02:00:5e:10:00:21',
    name: 'laptop.lan',
    ip: '192.0.2.21',
    // 14:38:18 UTC, in the time zone of Gladys.
    last_seen: '21/10/2026, 16:38',
  });
  assert.deepEqual(events(w)[3][1], {
    mac: '02:00:5e:10:00:24',
    name: 'tablet.lan',
    ip: '192.0.2.24',
    vendor: '(Unknown: locally administered)',
  });
  // Nothing more at the next read of the same list.
  await read(w);
  assert.equal(events(w).length, 4);
  // The phone comes back.
  Object.assign(w.server.row('02:00:5e:10:00:22'), { devPresentLastScan: 1 });
  await read(w);
  assert.deepEqual(events(w).at(-1), [
    'device_returned',
    {
      device: discovered(w, PHONE).external_id,
      mac: '02:00:5e:10:00:22',
      name: 'phone.lan',
      ip: '192.0.2.22',
    },
  ]);
});

test('a device that appears already acknowledged fires no new_device', async (t) => {
  const w = await world(t);
  w.server.devices.push({ ...FIRST_SCAN[1], devMac: '02:00:5e:10:00:30', devIsNew: 0 });
  await read(w);
  assert.deepEqual(events(w), []);
});

test('a restart keeps the reference: changes made meanwhile fire, the others do not', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const server = createServer(LATER_SCAN);
  const w = await world(t, { server, dataDir: first.dataDir });
  assert.deepEqual(
    events(w).map(([key]) => key),
    ['device_left', 'down_alert', 'device_left', 'new_device'],
  );
  const saved = JSON.parse(await readFile(join(first.dataDir, 'snapshot.json'), 'utf8'));
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.devices['02:00:5e:10:00:24'], {
    present: true,
    isNew: true,
    alertDown: false,
  });
});

test('a broken /data file is a fresh start, without events', async (t) => {
  const w = await world(t, { saved: { version: 9, devices: 'nope' } });
  assert.deepEqual(events(w), []);
});

test('the scene events of one read are capped', async (t) => {
  const w = await world(t);
  for (let i = 0; i < MAX_EVENTS_PER_CYCLE + 5; i += 1) {
    const suffix = (0x40 + i).toString(16);
    w.server.devices.push({ ...FIRST_SCAN[1], devMac: `02:00:5e:10:01:${suffix}`, devIsNew: 1 });
  }
  await read(w);
  assert.equal(events(w).length, MAX_EVENTS_PER_CYCLE);
});

test('archived devices are neither proposed nor counted nor announced', async (t) => {
  const w = await world(t);
  w.server.row('02:00:5e:10:00:22').devIsArchived = 1;
  w.server.devices.push({ ...FIRST_SCAN[1], devMac: '02:00:5e:10:00:31', devIsArchived: 1 });
  await read(w);
  assert.equal(discovered(w, PHONE), undefined);
  assert.equal(w.monitor.counts().online, 4);
  assert.deepEqual(events(w), []);
});

test('states go to the devices created in Gladys only, all of them again at creation', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.states, []);
  const summary = await create(w, SUMMARY);
  assert.equal(w.fake.lastState(featureId(summary, 'online')), 5);
  assert.equal(w.fake.lastState(featureId(summary, 'offline')), 0);
  assert.equal(w.fake.lastState(featureId(summary, 'new')), 5);
  assert.equal(w.fake.lastState(featureId(summary, 'down')), 0);
  const laptop = await create(w, LAPTOP);
  assert.equal(w.fake.lastState(featureId(laptop, 'presence')), 1);
  assert.equal(w.fake.lastState(featureId(laptop, 'ip')), '192.0.2.21');
  assert.equal(w.fake.lastState(featureId(laptop, 'last_seen')), '21/10/2026, 16:37');
  assert.ok(!w.fake.states.some((s) => s.device_feature_external_id.includes(PHONE)));

  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  assert.equal(w.fake.lastState(featureId(laptop, 'presence')), 0);
  assert.equal(w.fake.lastState(featureId(summary, 'down')), 1);
  assert.equal(w.fake.lastState(featureId(summary, 'offline')), 2);
});

test('"present" is published again at each NetAlertX scan, not at each read', async (t) => {
  const w = await world(t);
  const laptop = await create(w, LAPTOP);
  const presence = featureId(laptop, 'presence');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === presence).length;
  const before = count();
  await read(w);
  await read(w);
  assert.equal(count(), before, 'same scan: nothing again');
  w.server.scan();
  await read(w);
  assert.equal(count(), before + 1, 'a new scan saw it: present again');
});

test('NetAlertX unreachable: status shown, nothing fired; back: states resume', async (t) => {
  const w = await world(t);
  const summary = await create(w, SUMMARY);
  w.server.down = true;
  await read(w);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  w.server.down = false;
  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.lastState(featureId(summary, 'online')), 4);
  assert.equal(events(w).length, 4);
});

test('a wrong token or a missing configuration is said in the Configuration screen', async (t) => {
  const server = createServer();
  server.token = 't_other';
  const w = await world(t, { server });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused the API token/);
  const empty = await world(t, { config: {} });
  assert.match(empty.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  assert.equal(empty.server.requests.length, 0);
});

test('a new configuration is used at once, the language names the new devices', async (t) => {
  const w = await world(t, { config: {} });
  await w.fake.configUpdated({ ...CONFIG, language: 'fr' });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  const summary = discovered(w, SUMMARY);
  assert.equal(summary.name, 'Réseau NetAlertX');
  assert.equal(featureId(discovered(w, LAPTOP), 'presence') !== undefined, true);
  assert.equal(discovered(w, LAPTOP).features[0].name, 'Présence');
});

test('a reconnection publishes everything again', async (t) => {
  const w = await world(t);
  const summary = await create(w, SUMMARY);
  const before = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await w.monitor.running;
  assert.ok(w.fake.states.length >= before + 4);
  assert.equal(w.fake.lastState(featureId(summary, 'online')), 5);
});

test('the monitor reads NetAlertX on its own timer, never through onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const server = createServer();
  const { registerHandlers } = await import('../src/app.js');
  const { createFakeGladys } = await import('@gladysassistant/integration-sdk/testing');
  const { Store } = await import('../src/store.js');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const gladys = createFakeGladys({ config: { ...CONFIG, poll_interval: '30' } });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-netalertx-'))),
    fetch: server.fetch,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;
  const reads = () => server.requests.filter((r) => r.path === '/graphql').length;
  assert.equal(reads(), 1);
  for (const device of gladys.fake.discoveredDevices) {
    assert.equal(device.should_poll, false);
  }
  t.mock.timers.tick(30_000);
  await app.monitor.running;
  t.mock.timers.tick(30_000);
  await app.monitor.running;
  assert.equal(reads(), 3);
});

test('the onPoll fallback does not read NetAlertX more than every 15 s', async (t) => {
  const w = await world(t);
  const summary = await create(w, SUMMARY);
  const reads = () => w.server.requests.filter((r) => r.path === '/graphql').length;
  const before = reads();
  await w.fake.poll(summary);
  assert.equal(reads(), before);
  w.clock.advance(15_000);
  await w.fake.poll(summary);
  assert.equal(reads(), before + 1);
});

test('dates are shown in the time zone of Gladys, in the language of the configuration', () => {
  assert.equal(formatSeen('2026-10-21 14:38:18', 'fr', 'Europe/Paris'), '21/10/2026 16:38');
  assert.equal(formatSeen('2026-10-21 14:38:18', 'en', 'UTC'), '21/10/2026, 14:38');
  assert.equal(formatSeen('2026-10-21T14:38:18+02:00', 'de', 'UTC'), '21.10.26, 12:38');
  assert.equal(formatSeen('not a date', 'en', 'UTC'), '');
  assert.equal(formatSeen('', 'en', 'UTC'), '');
  assert.equal(formatSeen('2026-10-21 14:38:18', 'es', 'Not/AZone').length > 0, true);
});
