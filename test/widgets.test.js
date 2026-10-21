// -----------------------------------------------------------------------------
// The `network` widget: content within the budget of the core
// (validateWidgetContent), new and down devices, the "Known" buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LATER_SCAN, createServer, createWorld, read } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, language = 'en') {
  const ack = await w.fake.widgetGet('network', { settings: {}, language });
  assert.equal(ack.success, true);
  const { content: body } = ack.data;
  validateWidgetContent(body);
  return body;
}

const ofType = (body, type) => body.components.filter((component) => component.type === type);

test('new devices and devices down, each once, with "Known" buttons', async (t) => {
  const w = await world(t);
  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  const body = await content(w);
  assert.ok(body.components.length <= 8);
  assert.deepEqual(
    ofType(body, 'value').map((tile) => [tile.label, tile.value]),
    [
      ['Online', 4],
      ['New', 5],
      ['Down', 1],
    ],
  );
  const [status] = ofType(body, 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['docker-host', 'New · 192.0.2.1'],
      ['netalertx', 'New · 192.0.2.10'],
      ['phone', 'New · offline'],
      ['tablet', 'New · 192.0.2.24'],
      ['laptop', 'Down · 192.0.2.21'],
    ],
  );
  const buttons = ofType(body, 'button');
  assert.equal(buttons.length, 4);
  assert.deepEqual(
    buttons.map((button) => button.action.key),
    ['known_1', 'known_2', 'known_3', 'known_4'],
  );
  for (const button of buttons) {
    assert.ok(button.label.length <= 24, button.label);
    assert.notEqual(button.style, 'primary');
  }
});

test('a "Known" button marks the device, then the widget forgets it', async (t) => {
  const w = await world(t);
  const [button] = ofType(await content(w, 'fr'), 'button');
  assert.equal(button.label, 'Connu : docker-host');
  const ack = await w.fake.widgetAction('network', button.action.key, button.action.params, {
    settings: {},
  });
  assert.deepEqual(ack.data.message, {
    en: 'docker-host marked as known.',
    fr: 'docker-host marqué comme connu.',
    de: 'docker-host als bekannt markiert.',
    es: 'docker-host marcado como conocido.',
  });
  assert.equal(w.server.row('02:00:5e:10:00:01').devIsNew, 0);
  const again = await w.fake.widgetAction('network', button.action.key, button.action.params, {
    settings: {},
  });
  assert.equal(again.data.message.en, 'This device is no longer new.');
  const labels = ofType(await content(w), 'status')[0].items.map((item) => item.label);
  assert.ok(!labels.includes('docker-host'));
});

test('nothing to report: a caption under the tiles; NetAlertX not read: a waiting text', async (t) => {
  const w = await world(t);
  await w.fake.action('mark_all_known');
  const calm = await content(w, 'de');
  assert.deepEqual(
    ofType(calm, 'text').map((text) => text.text),
    ['Kein neues Gerät, kein ausgefallenes Gerät.'],
  );
  assert.equal(ofType(calm, 'status').length, 0);
  const server = createServer();
  server.down = true;
  const lost = await world(t, { server });
  const waiting = await content(lost, 'es');
  assert.deepEqual(waiting.components, [
    {
      type: 'text',
      variant: 'body',
      text: 'Esperando a NetAlertX: compruebe la configuración de la integración.',
    },
  ]);
});

test('the widget is refreshed when a device is created and when the list changes', async (t) => {
  const w = await world(t);
  const before = w.fake.widgetRefreshes.length;
  w.clock.advance(20_000);
  w.server.devices = structuredClone(LATER_SCAN);
  await read(w);
  assert.equal(w.fake.widgetRefreshes.length, before + 1);
  await read(w);
  assert.equal(w.fake.widgetRefreshes.length, before + 1, 'same list: no refresh');
  w.clock.advance(20_000);
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  assert.equal(w.fake.widgetRefreshes.length, before + 2);
});
