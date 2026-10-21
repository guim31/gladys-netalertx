// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the device
// lists recorded on a real NetAlertX (plus unnamed devices with and without a
// vendor), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { CONFIG, FIRST_SCAN, LATER_SCAN, createServer, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const EXTRA = [
  { ...FIRST_SCAN[1], devMac: '64:E4:D5:B4:12:66', devName: '(unknown)', devVendor: 'Apple, Inc.' },
  { ...FIRST_SCAN[1], devMac: '64-e4-d5-b4-12-67', devName: '', devVendor: '', devLastIP: '' },
];

for (const language of LANGUAGES) {
  test(`every discovered device follows the Gladys rules (${language} names)`, async (t) => {
    const byMac = new Map(
      [...FIRST_SCAN, ...LATER_SCAN, ...EXTRA].map((row) => [row.devMac.toLowerCase(), row]),
    );
    const w = await createWorld({
      config: { ...CONFIG, language },
      server: createServer([...byMac.values()]),
    });
    t.after(() => w.app.stop());
    const devices = w.fake.discoveredDevices;
    // The summary, and the 8 rows with a real MAC address.
    assert.equal(devices.length, 9);

    const deviceIds = new Set();
    const deviceNames = new Set();
    for (const device of devices) {
      const where = device.name;
      assert.ok(device.name, 'a device has a name');
      assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
      deviceIds.add(device.external_id);
      deviceNames.add(device.name);

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
    // Unnamed devices are told apart by their vendor or their MAC address.
    assert.ok(deviceNames.has('Apple, Inc. 12:66'));
    assert.ok(deviceNames.has('64:e4:d5:b4:12:67'));
  });
}
