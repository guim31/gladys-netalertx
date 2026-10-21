// -----------------------------------------------------------------------------
// The monitor: reads the NetAlertX device list on its own timer, turns the
// differences with the previous read into scene events, and publishes the
// states of the devices created in Gladys. The SDK handlers, the scene action
// and the widget all go through it (src/app.js wires it).
//
// Reference list: the previous read, kept under /data (src/store.js). The very
// first read only records it (no trigger for the devices already there);
// afterwards a MAC address absent from the reference fires `new_device` when
// NetAlertX flags it new, and a change of "present in the last scan" fires
// `device_left` / `device_returned` (plus `down_alert` when "Alert down" is set).
// NetAlertX decides presence at each of its scans (every 5 minutes by
// default): the integration only reports it, it adds no delay of its own.
//
// States: only what changed (publishChangedStates), plus a heartbeat every 12
// hours. A present device is published "present" again at every NetAlertX scan
// that saw it (its last connection moved): the "Check user presence" scene
// action of Gladys reads the time of the last state, as it does with the
// lan-manager scans of the core.
//
// Logs: at info, only the lifecycle (start, NetAlertX lost and back, devices
// leaving and coming back, new devices, user actions). A read failing at every
// cycle is logged once, plus one line at recovery. LOG_LEVEL=debug shows every
// cycle.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { NetAlertXClient, NetAlertXError, displayName, normalizeMac } from './client.js';
import { buildHostDevice, buildSummaryDevice, hostIds, macOf, summaryIds } from './devices.js';
import { ERRORS, GladysError, REPORTS, STATUS, render, statusOf } from './messages.js';

const logger = createLogger({ name: 'netalertx' });

export const WIDGET_KEY = 'network';
export const TRIGGERS = {
  NEW_DEVICE: 'new_device',
  LEFT: 'device_left',
  RETURNED: 'device_returned',
  DOWN: 'down_alert',
};

export const DEFAULT_TIMINGS = {
  heartbeatMs: 12 * 60 * 60 * 1000,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
  // A Gladys polling anyway (onPoll fallback) does not read NetAlertX more often.
  minReadSpacingMs: 15000,
};

// Scene events per read: a NetAlertX database started from scratch while the
// container already had a reference would otherwise announce a whole network
// (the core accepts 300 events a minute).
export const MAX_EVENTS_PER_CYCLE = 20;

// Devices proposed in the Discover tab.
export const MAX_DISCOVERED = 500;

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

/**
 * "2026-10-21 14:38:18" (NetAlertX 26.x stores UTC) → "21/10/2026 16:38" in the
 * time zone of Gladys; '' when the value cannot be read.
 */
export function formatSeen(value, language = 'en', timeZone = process.env.TZ) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const iso = value.trim().replace(' ', 'T');
  const date = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const options = { dateStyle: 'short', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, {
      ...options,
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    // An unknown TZ name: the time zone of the container.
    return new Intl.DateTimeFormat(LOCALES[language] ?? LOCALES.en, options).format(date);
  }
}

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] fetch, for the NetAlertX API
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {string} [options.timeZone] time zone of the dates shown (default: TZ)
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now, timeZone, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timeZone = timeZone ?? process.env.TZ;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.client = null;
    // Devices of the last read (archived ones excepted), by MAC address.
    this.devices = new Map();
    // Reference for the triggers: null until the first read ever.
    this.reference = null;
    // Last connection of each device when "present" was last published.
    this.presenceSeen = new Map();
    this.discoveryKey = null;
    this.widgetKey = null;
    this.connected = null;
    this.lastReadAt = -Infinity;
    this.cycleTimer = null;
    this.running = null;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.stopped = false;
    // Keys of the failures already logged, so a repeated one is not logged again.
    this.failing = new Set();
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message) {
    if (this.failing.has(key)) {
      logger.debug(message);
      return;
    }
    this.failing.add(key);
    logger[level](message);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.applyConfig(config);
    const saved = await this.store.load();
    if (saved && saved.version === 1 && saved.devices && typeof saved.devices === 'object') {
      this.reference = new Map(
        Object.entries(saved.devices)
          .filter(([mac]) => normalizeMac(mac) === mac)
          .map(([mac, entry]) => [
            mac,
            {
              present: Boolean(entry?.present),
              isNew: Boolean(entry?.isNew),
              alertDown: Boolean(entry?.alertDown),
            },
          ]),
      );
    }
    await this.publishDiscovered();
    logger.info(
      this.client
        ? `Started: NetAlertX read every ${config.pollInterval} s`
        : 'Started: waiting for the NetAlertX address and API token',
    );
    this.schedule();
    await this.runCycle();
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.applyConfig(config);
    this.discoveryKey = null;
    await this.publishDiscovered();
    this.gladys.forgetPublishedStates?.();
    this.presenceSeen.clear();
    this.connected = null;
    this.lastReadAt = -Infinity;
    await this.runCycle();
    this.requestRefresh();
  }

  async reconfigure(config) {
    const before = this.config;
    this.applyConfig(config);
    // The language of the names applies to the devices created from now on.
    this.discoveryKey = null;
    await this.publishDiscovered();
    this.schedule();
    if (before?.url !== config.url || before?.token !== config.token) {
      this.connected = null;
      this.lastReadAt = -Infinity;
      await this.runCycle();
    }
    this.requestRefresh();
  }

  applyConfig(config) {
    this.config = config;
    this.client =
      config.url && config.token
        ? new NetAlertXClient({ url: config.url, token: config.token, fetch: this.fetch })
        : null;
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.pollInterval * 1000);
    this.cycleTimer.unref?.();
  }

  // --- Reading NetAlertX -------------------------------------------------------

  async setConnected(connected, message) {
    const key = connected ? 'ok' : JSON.stringify(message);
    if (this.connected === key) {
      return;
    }
    this.connected = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  runCycle() {
    if (this.running || this.stopped) {
      return this.running;
    }
    this.running = this.cycle()
      .catch((err) => this.failed('cycle', 'error', `Read cycle failed: ${err.message}`))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll() {
    if (this.now() - this.lastReadAt >= this.timings.minReadSpacingMs) {
      await this.runCycle();
    }
  }

  async cycle() {
    if (!this.client) {
      await this.setConnected(false, STATUS.notConfigured);
      return;
    }
    let list;
    try {
      list = await this.client.listDevices();
    } catch (err) {
      this.lastReadAt = this.now();
      this.failed('read', 'warn', `NetAlertX unreachable: ${err.message}`);
      await this.setConnected(false, statusOf(err));
      return;
    }
    this.lastReadAt = this.now();
    this.recovered('read', 'NetAlertX reachable again');
    await this.setConnected(true);

    const active = list.filter((device) => !device.archived);
    const events = this.compare(active);
    this.devices = new Map(active.map((device) => [device.mac, device]));
    logger.debug(`Read cycle: ${active.length} device(s), ${events.length} event(s)`);

    await this.publishDiscovered();
    await this.publishStates();
    await this.fire(events);
    await this.saveReference();
    this.refreshIfChanged();
  }

  /** The scene events of a new read, against the reference; updates the reference. */
  compare(list) {
    const events = [];
    const next = new Map();
    for (const device of list) {
      next.set(device.mac, {
        present: device.present,
        isNew: device.isNew,
        alertDown: device.alertDown,
      });
      if (this.reference === null) {
        continue;
      }
      const before = this.reference.get(device.mac);
      if (!before) {
        if (device.isNew) {
          events.push({ trigger: TRIGGERS.NEW_DEVICE, device });
        }
        continue;
      }
      if (before.present !== device.present) {
        events.push({ trigger: device.present ? TRIGGERS.RETURNED : TRIGGERS.LEFT, device });
        if (!device.present && device.alertDown) {
          events.push({ trigger: TRIGGERS.DOWN, device });
        }
      }
    }
    this.referenceChanged =
      this.reference === null ||
      this.reference.size !== next.size ||
      [...next].some(([mac, entry]) => {
        const before = this.reference.get(mac);
        return (
          !before ||
          before.present !== entry.present ||
          before.isNew !== entry.isNew ||
          before.alertDown !== entry.alertDown
        );
      });
    this.reference = next;
    return events;
  }

  async saveReference() {
    if (!this.referenceChanged) {
      return;
    }
    this.referenceChanged = false;
    await this.store.save({ version: 1, devices: Object.fromEntries(this.reference) });
  }

  eventData(trigger, device) {
    const base = {
      mac: device.mac,
      name: displayName(device),
      ip: device.ip || null,
    };
    if (trigger === TRIGGERS.NEW_DEVICE) {
      return { ...base, vendor: device.vendor || null };
    }
    const data = { device: hostIds(this.gladys, device.mac).device, ...base };
    if (trigger === TRIGGERS.DOWN) {
      data.last_seen = formatSeen(device.lastSeen, this.config.language, this.timeZone) || null;
    }
    return data;
  }

  async fire(events) {
    for (const { trigger, device } of events.slice(0, MAX_EVENTS_PER_CYCLE)) {
      const name = displayName(device);
      if (trigger === TRIGGERS.NEW_DEVICE) {
        logger.info(
          `New device on the network: ${name === device.mac ? name : `${name} (${device.mac})`}`,
        );
      } else if (trigger !== TRIGGERS.DOWN) {
        logger.info(`${name} ${trigger === TRIGGERS.LEFT ? 'left the network' : 'is back'}`);
      }
      try {
        await this.gladys.publishSceneEvent(trigger, this.eventData(trigger, device));
        this.recovered('event', 'Scene events accepted again');
      } catch (err) {
        this.failed('event', 'warn', `Scene event ${trigger} refused: ${err.message}`);
      }
    }
    if (events.length > MAX_EVENTS_PER_CYCLE) {
      logger.warn(
        `${events.length - MAX_EVENTS_PER_CYCLE} more change(s) in one read, not sent to the scenes`,
      );
    }
  }

  // --- Gladys devices ----------------------------------------------------------

  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  discoveredDevices() {
    const language = this.config.language;
    const hosts = [...this.devices.values()]
      .slice(0, MAX_DISCOVERED)
      .map((device) => buildHostDevice(this.gladys, device, language));
    return [buildSummaryDevice(this.gladys, language), ...hosts];
  }

  /** Published again only when the list or a name changed. */
  async publishDiscovered() {
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices.map((device) => [device.external_id, device.name]));
    if (key === this.discoveryKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveryKey = key;
      this.recovered('discovery', 'Discovered devices published again');
    } catch (err) {
      this.failed('discovery', 'warn', `Publishing the discovered devices failed: ${err.message}`);
    }
  }

  async onDeviceCreated(device) {
    // The SDK forgot the states of the device: everything is published again.
    const mac = macOf(this.gladys, device.external_id);
    if (mac) {
      this.presenceSeen.delete(mac);
    }
    await this.publishStates();
    this.requestRefresh();
  }

  counts() {
    const devices = [...this.devices.values()];
    return {
      online: devices.filter((device) => device.present).length,
      offline: devices.filter((device) => !device.present).length,
      new: devices.filter((device) => device.isNew).length,
      down: devices.filter((device) => device.alertDown && !device.present).length,
    };
  }

  async publishStates() {
    if (this.lastReadAt === -Infinity || this.connected !== 'ok') {
      return;
    }
    const created = this.createdIds();
    const states = [];
    const summary = summaryIds(this.gladys);
    if (created.has(summary.device)) {
      for (const [key, value] of Object.entries(this.counts())) {
        states.push({ device_feature_external_id: summary[key], state: value });
      }
    }
    for (const device of this.devices.values()) {
      const ids = hostIds(this.gladys, device.mac);
      if (!created.has(ids.device)) {
        continue;
      }
      if (device.present && this.presenceSeen.get(device.mac) !== device.lastSeen) {
        // A new NetAlertX scan saw it: "present" again, even unchanged.
        this.gladys.forgetPublishedStates?.(ids.presence);
        this.presenceSeen.set(device.mac, device.lastSeen);
      }
      states.push({ device_feature_external_id: ids.presence, state: device.present ? 1 : 0 });
      if (device.ip) {
        states.push({ device_feature_external_id: ids.ip, text: device.ip });
      }
      const seen = formatSeen(device.lastSeen, this.config.language, this.timeZone);
      if (seen) {
        states.push({ device_feature_external_id: ids.last_seen, text: seen });
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.failed('publish', 'warn', `Publishing the states failed: ${err.message}`);
    }
  }

  // --- Actions -----------------------------------------------------------------

  requireClient() {
    if (!this.client) {
      throw new GladysError(STATUS.notConfigured, this.config.language);
    }
    return this.client;
  }

  /** Configuration action: read NetAlertX once and say what it holds. */
  async testConnection() {
    const client = this.requireClient();
    let list;
    try {
      list = await client.listDevices();
    } catch (err) {
      throw new GladysError(statusOf(err), this.config.language);
    }
    const active = list.filter((device) => !device.archived);
    await this.runCycle();
    return render(REPORTS.test, {
      total: active.length,
      online: active.filter((device) => device.present).length,
      fresh: active.filter((device) => device.isNew).length,
    });
  }

  /** Clear the "new" flag of one device in NetAlertX. Resolves the device name. */
  async markKnown(rawMac) {
    const mac = normalizeMac(rawMac);
    if (!mac) {
      throw new GladysError(
        render(ERRORS.mac, { value: String(rawMac ?? '').slice(0, 40) }),
        this.config.language,
      );
    }
    const client = this.requireClient();
    try {
      await client.markKnown(mac);
    } catch (err) {
      if (err instanceof NetAlertXError && err.kind === 'notFound') {
        throw new GladysError(render(ERRORS.unknownMac, { value: mac }), this.config.language);
      }
      if (err instanceof NetAlertXError && err.kind === 'auth') {
        throw new GladysError(STATUS.auth, this.config.language);
      }
      throw new GladysError(ERRORS.unavailable, this.config.language);
    }
    const device = this.devices.get(mac);
    const name = device ? displayName(device) : mac;
    logger.info(`${name} marked as known`);
    if (device) {
      device.isNew = false;
      const entry = this.reference?.get(mac);
      if (entry) {
        entry.isNew = false;
        this.referenceChanged = true;
        await this.saveReference();
      }
      await this.publishStates();
      this.refreshIfChanged();
    }
    return name;
  }

  /** Configuration action: every new device marked as known. */
  async markAllKnown() {
    const client = this.requireClient();
    const fresh = [...this.devices.values()].filter((device) => device.isNew);
    let count = 0;
    for (const device of fresh) {
      try {
        await client.markKnown(device.mac);
        device.isNew = false;
        const entry = this.reference?.get(device.mac);
        if (entry) {
          entry.isNew = false;
          this.referenceChanged = true;
        }
        count += 1;
      } catch (err) {
        if (err instanceof NetAlertXError && err.kind === 'notFound') {
          continue;
        }
        throw new GladysError(
          err instanceof NetAlertXError && err.kind === 'auth' ? STATUS.auth : ERRORS.unavailable,
          this.config.language,
        );
      }
    }
    logger.info(`${count} device(s) marked as known`);
    await this.saveReference();
    await this.publishStates();
    this.refreshIfChanged();
    return render(REPORTS.markedAll, { count });
  }

  // --- Widget -------------------------------------------------------------------

  /** What the widget shows: new devices, and devices down (offline with "Alert down"). */
  view() {
    const devices = [...this.devices.values()];
    const byName = (a, b) => displayName(a).localeCompare(displayName(b));
    return {
      ready: this.lastReadAt !== -Infinity && this.connected === 'ok',
      counts: this.counts(),
      fresh: devices.filter((device) => device.isNew).sort(byName),
      down: devices.filter((device) => device.alertDown && !device.present).sort(byName),
    };
  }

  refreshIfChanged() {
    const { fresh, down } = this.view();
    const key = JSON.stringify([
      fresh.map((device) => [device.mac, device.present]),
      down.map((device) => device.mac),
      this.counts().online,
    ]);
    if (key !== this.widgetKey) {
      this.widgetKey = key;
      this.requestRefresh();
    }
  }

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }
}
