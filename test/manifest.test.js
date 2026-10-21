// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, POLL_INTERVALS } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/monitor.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { LATER_SCAN, create, createWorld, read } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

test('identity: name, image, cover, local transport, network category', () => {
  assert.equal(manifest.name, 'NetAlertX');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-netalertx:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-netalertx/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['network', 'security']);
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions', () => {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  const [major, minor] = match.slice(1).map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const result = await world.fake.sceneAction('mark_known', { mac: '02:00:5e:10:00:21' });
  const [action] = manifest.scene_actions;
  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(result.data.outputs).sort(), keysOf(action.outputs).sort());
  // "Continue only if" compares with ===: numbers, never booleans.
  for (const output of action.outputs) {
    assert.notEqual(output.type, 'boolean', output.key);
  }
  // The MAC address of a trigger is inserted as a variable: a string field.
  assert.equal(field(action.fields, 'mac').type, 'string');
});

test('the scene triggers the monitor fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const laptop = await create(world, '02005e100021');
  world.server.devices = structuredClone(LATER_SCAN);
  await read(world);
  Object.assign(world.server.row('02:00:5e:10:00:21'), { devPresentLastScan: 1 });
  await read(world);
  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} fired`);
    assert.deepEqual(
      Object.keys(data).sort(),
      [...new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)])].sort(),
      `${trigger.key} data`,
    );
    if (keysOf(trigger.fields).includes('device')) {
      assert.match(data.device, /^ext:test-integration:device:/);
    }
  }
  assert.equal(fired.get('device_returned').device, laptop.external_id);
});

test('every widget has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'poll_interval')), POLL_INTERVALS);
  assert.equal(field(manifest.config_schema, 'api_token').type, 'secret');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.equal(dynamic.length, 3);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
    assert.notEqual(entry.required, true, 'empty = any device');
  }
});

test('actions: no secret field, no default (the core applies none to actions)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of [...manifest.actions, ...manifest.scene_actions]) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${action.key}.${entry.key}`);
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
