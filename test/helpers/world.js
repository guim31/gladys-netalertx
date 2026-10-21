// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake NetAlertX API (answers
// shaped like the real ones recorded in test/fixtures/netalertx/), a manual
// clock, a temporary /data, and the integration wired on top through
// registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/netalertx/${name}`, import.meta.url), 'utf8'));

/** Device rows of a recorded GraphQL answer. */
export const rows = (name) => fixture(name).data.devices.devices;

export const FIRST_SCAN = rows('graphql-devices-first-scan.json');
export const LATER_SCAN = rows('graphql-devices-later-scan.json');

export const TOKEN = 't_testtoken0123456789';
export const CONFIG = { url: '192.0.2.10', api_token: TOKEN, language: 'en' };

/**
 * Fake NetAlertX: `server.devices` is the device table (GraphQL rows), edited by
 * the tests like a scan would; `server.down = true` refuses connections,
 * `server.token` is the API_TOKEN it accepts.
 */
export function createServer(devices = FIRST_SCAN) {
  const server = {
    devices: structuredClone(devices),
    token: TOKEN,
    down: false,
    requests: [],
    async fetch(url, init = {}) {
      const { pathname } = new URL(url);
      const body = init.body ? JSON.parse(init.body) : undefined;
      server.requests.push({ url, method: init.method ?? 'GET', path: pathname, body });
      if (server.down) {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      }
      const reply = (status, json) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => structuredClone(json),
      });
      if (init.headers?.Authorization !== `Bearer ${server.token}`) {
        return reply(403, fixture('forbidden.json'));
      }
      if (pathname === '/graphql' && init.method === 'POST') {
        return reply(200, {
          data: { devices: { count: server.devices.length, devices: server.devices } },
        });
      }
      const match = /^\/device\/([^/]+)\/update-column$/.exec(pathname);
      if (match && init.method === 'POST') {
        const mac = decodeURIComponent(match[1]).toLowerCase();
        const row = server.devices.find((device) => device.devMac.toLowerCase() === mac);
        if (!row) {
          return reply(404, fixture('update-column-not-found.json'));
        }
        row[body.columnName] = body.columnValue;
        return reply(200, fixture('update-column-ok.json'));
      }
      return reply(404, { success: false, error: 'Not Found' });
    },
    /** The row of a MAC address, to edit it like a NetAlertX scan would. */
    row(mac) {
      return server.devices.find((device) => device.devMac === mac);
    },
    /** A scan: every present device gets a new last connection. */
    scan(at = '2026-10-21 14:45:00') {
      for (const device of server.devices) {
        if (device.devPresentLastScan === 1) {
          device.devLastConnection = at;
        }
      }
    },
  };
  return server;
}

/** A manual clock. */
export function createClock(start = Date.parse('2026-10-21T14:40:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.server] from createServer
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {object} [options.saved] content of /data/snapshot.json before the start
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 */
export async function createWorld({
  config = CONFIG,
  server = createServer(),
  devices = [],
  saved,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-netalertx-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const store = new Store(dataDir);
  if (saved) {
    await store.save(saved);
    await store.flush();
  }
  const clock = createClock();
  const app = registerHandlers(gladys, {
    store,
    fetch: server.fetch,
    timers: false,
    now: clock.now,
    timeZone: 'Europe/Paris',
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, server, clock, store, dataDir };
}

/** One read of NetAlertX, a minute later. */
export async function read(world) {
  world.clock.advance(60_000);
  await world.monitor.runCycle();
}

/** The device published for a MAC address (or the summary), from the last discovery list. */
export const discovered = (world, externalIdEnd) =>
  world.fake.discoveredDevices.find((device) => device.external_id.endsWith(externalIdEnd));

/** Create a discovered device in Gladys, as the user would. */
export async function create(world, externalIdEnd) {
  const device = discovered(world, externalIdEnd);
  if (!device) {
    throw new Error(`${externalIdEnd} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** The scene events fired so far, as `[key, data]`. */
export const events = (world) => world.fake.sceneEvents.map((event) => [event.key, event.data]);

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
