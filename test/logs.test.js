// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (NetAlertX lost and back, devices leaving, coming back, new ones, user
// actions), never one line per read; a failure that repeats at every read is
// logged once, plus one line when it is over. Never the API token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LATER_SCAN, TOKEN, captureLogs, create, createWorld, read } from './helpers/world.js';

async function world(t) {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await create(w, 'network:summary');
  await create(w, '02005e100021');
  return w;
}

const strip = (lines) => lines.map((line) => line.text.replace(/^\[[^\]]+\] /, ''));

test('a normal read writes nothing at info', async (t) => {
  const w = await world(t);
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 5; i += 1) {
    w.server.scan(`2026-10-21 14:4${i}:00`);
    await read(w);
  }
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the reads', async (t) => {
  const w = await world(t);
  const lines = captureLogs(t, 'debug');
  await read(w);
  assert.ok(lines.some((line) => /Read cycle: 5 device\(s\), 0 event\(s\)/.test(line.text)));
});

test('departures and a new device are one info line each', async (t) => {
  const w = await world(t);
  const lines = captureLogs(t, 'info');
  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  assert.deepEqual(strip(lines), [
    '[INFO] [netalertx] laptop.lan left the network',
    '[INFO] [netalertx] phone.lan left the network',
    '[INFO] [netalertx] New device on the network: tablet.lan (02:00:5e:10:00:24)',
  ]);
});

test('NetAlertX unreachable at every read: one warning, then one line at recovery', async (t) => {
  const w = await world(t);
  const lines = captureLogs(t, 'info');
  w.server.down = true;
  for (let i = 0; i < 4; i += 1) {
    await read(w);
  }
  w.server.down = false;
  await read(w);
  await read(w);
  assert.deepEqual(strip(lines), [
    '[WARN] [netalertx] NetAlertX unreachable: ECONNREFUSED',
    '[INFO] [netalertx] NetAlertX reachable again',
  ]);
});

test('the API token never reaches the logs', async (t) => {
  const lines = captureLogs(t, 'debug');
  const w = await createWorld();
  t.after(() => w.app.stop());
  w.server.token = 't_other';
  await read(w);
  await w.fake.action('test_connection');
  await w.fake.sceneAction('mark_known', { mac: '02:00:5e:10:00:21' });
  assert.ok(lines.length > 0);
  assert.ok(!lines.some((line) => line.text.includes(TOKEN)));
});
