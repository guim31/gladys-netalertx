import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LATER_SCAN, createServer, createWorld, events, read } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('mark_known clears the flag in NetAlertX, whatever the MAC format', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('mark_known', { mac: '02-00-5E-10-00-21' });
  assert.deepEqual(ack, { success: true, data: { outputs: { known: 1 } } });
  assert.equal(w.server.row('02:00:5e:10:00:21').devIsNew, 0);
  assert.equal(w.monitor.counts().new, 4);
});

test('the MAC address of the "new device" trigger is what the action needs', async (t) => {
  const w = await world(t);
  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  const [, data] = events(w).find(([key]) => key === 'new_device');
  const ack = await w.fake.sceneAction('mark_known', { mac: data.mac });
  assert.equal(ack.success, true);
  assert.equal(w.server.row(data.mac).devIsNew, 0);
  // Acknowledged: no new event at the next read, and the reference is saved.
  await read(w);
  assert.equal(events(w).filter(([key]) => key === 'new_device').length, 1);
});

test('mark_known errors: invalid MAC, unknown device, NetAlertX down', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  const invalid = await w.fake.sceneAction('mark_known', { mac: 'not-a-mac' });
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /not a MAC address/);
  const unknown = await w.fake.sceneAction('mark_known', { mac: '02:00:5e:10:00:99' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /does not know the device 02:00:5e:10:00:99/);
  server.down = true;
  const down = await w.fake.sceneAction('mark_known', { mac: '02:00:5e:10:00:21' });
  assert.equal(down.success, false);
  assert.match(down.error, /cannot be reached/);
});

test('configuration actions: test the connection, mark every new device as known', async (t) => {
  const w = await world(t);
  const tested = await w.fake.action('test_connection');
  assert.equal(tested.success, true);
  assert.equal(tested.data.message.en, 'Connected to NetAlertX: 5 device(s), 5 online, 5 new.');
  const marked = await w.fake.action('mark_all_known');
  assert.equal(marked.data.message.fr, '5 appareil(s) marqué(s) comme connu(s) dans NetAlertX.');
  assert.equal(w.monitor.counts().new, 0);
  assert.ok(w.server.devices.filter((d) => d.devMac.includes(':')).every((d) => d.devIsNew === 0));
});

test('configuration actions answer in words when NetAlertX refuses', async (t) => {
  const server = createServer();
  const w = await world(t, { server });
  server.token = 't_changed';
  const tested = await w.fake.action('test_connection');
  assert.equal(tested.success, true);
  assert.match(tested.data.message.en, /refused the API token/);
  const marked = await w.fake.action('mark_all_known');
  assert.match(marked.data.message.de, /lehnt das API-Token ab/);
});
