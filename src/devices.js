// -----------------------------------------------------------------------------
// The Gladys devices of the integration (couples checked against the Gladys
// front, v5.2.0, by test/gladys-rules.test.js).
//
// - One "network" device, the summary of NetAlertX: devices online, offline,
//   new (not acknowledged yet) and down (offline while "Alert down" is set in
//   NetAlertX), four counter-sensor/integer features.
// - One device per network device the user chooses to follow (all of them are
//   proposed in the Discover tab, archived ones excepted), keyed on its MAC:
//     presence   presence-sensor/binary: the "presence detected" badge, usable
//                by the "Check user presence" scene action of Gladys;
//     ip         text/text, last IP address;
//     last_seen  text/text, last time NetAlertX saw it (local time of Gladys).
//
// Every device is published with should_poll: false: the monitor reads
// NetAlertX on its own timer (src/monitor.js).
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { displayName } from './client.js';

export const SUMMARY_TYPE = 'network';
export const SUMMARY_ID = 'summary';
export const HOST_TYPE = 'device';

export const SUMMARY_KEYS = { ONLINE: 'online', OFFLINE: 'offline', NEW: 'new', DOWN: 'down' };
export const HOST_KEYS = { PRESENCE: 'presence', IP: 'ip', LAST_SEEN: 'last_seen' };

// Display bounds of the counters (NetAlertX networks stay far below).
export const MAX_COUNT = 10000;

// Feature and device names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    summary: 'NetAlertX network',
    online: 'Devices online',
    offline: 'Devices offline',
    new: 'New devices',
    down: 'Down alerts',
    presence: 'Presence',
    ip: 'IP address',
    last_seen: 'Last seen',
  },
  fr: {
    summary: 'Réseau NetAlertX',
    online: 'Appareils en ligne',
    offline: 'Appareils hors ligne',
    new: 'Nouveaux appareils',
    down: "Alertes d'absence",
    presence: 'Présence',
    ip: 'Adresse IP',
    last_seen: 'Vu pour la dernière fois',
  },
  de: {
    summary: 'NetAlertX-Netzwerk',
    online: 'Geräte online',
    offline: 'Geräte offline',
    new: 'Neue Geräte',
    down: 'Ausfallalarme',
    presence: 'Anwesenheit',
    ip: 'IP-Adresse',
    last_seen: 'Zuletzt gesehen',
  },
  es: {
    summary: 'Red NetAlertX',
    online: 'Dispositivos en línea',
    offline: 'Dispositivos sin conexión',
    new: 'Dispositivos nuevos',
    down: 'Alertas de caída',
    presence: 'Presencia',
    ip: 'Dirección IP',
    last_seen: 'Visto por última vez',
  },
};

const names = (language) => NAMES[language] ?? NAMES.en;

/** "aa:bb:cc:dd:ee:ff" → the platform id of its device, "aabbccddeeff". */
export const macId = (mac) => mac.replace(/:/g, '');

export function summaryIds(gladys) {
  const ids = gladys.externalIds(SUMMARY_TYPE, SUMMARY_ID);
  return {
    device: ids.device,
    ...Object.fromEntries(Object.values(SUMMARY_KEYS).map((key) => [key, ids.feature(key)])),
  };
}

export function hostIds(gladys, mac) {
  const ids = gladys.externalIds(HOST_TYPE, macId(mac));
  return {
    device: ids.device,
    ...Object.fromEntries(Object.values(HOST_KEYS).map((key) => [key, ids.feature(key)])),
  };
}

/** The MAC address of a host device, from its external id (null if not one). */
export function macOf(gladys, externalId) {
  const prefix = gladys.externalIds(HOST_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length).split(':')[0];
  return /^[0-9a-f]{12}$/.test(id) ? id.match(/../g).join(':') : null;
}

const counter = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: MAX_COUNT,
});

const textFeature = (name, externalId) => ({
  name,
  external_id: externalId,
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: false,
  // NOT NULL in the core, even for a text (422 on "Add to Gladys" otherwise).
  min: 0,
  max: 0,
});

export function buildSummaryDevice(gladys, language = 'en') {
  const ids = summaryIds(gladys);
  const n = names(language);
  return {
    name: n.summary,
    external_id: ids.device,
    model: 'NetAlertX',
    should_poll: false,
    features: Object.values(SUMMARY_KEYS).map((key) => counter(n[key], ids[key])),
  };
}

/** @param {object} device a device of src/client.js (normalizeDevice) */
export function buildHostDevice(gladys, device, language = 'en') {
  const ids = hostIds(gladys, device.mac);
  const n = names(language);
  const params = [{ name: 'MAC', value: device.mac }];
  if (device.vendor) {
    params.push({ name: 'VENDOR', value: device.vendor.slice(0, 100) });
  }
  return {
    name: displayName(device).slice(0, 100),
    external_id: ids.device,
    model: 'NetAlertX',
    should_poll: false,
    params,
    features: [
      {
        name: n.presence,
        external_id: ids.presence,
        category: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1,
      },
      textFeature(n.ip, ids.ip),
      textFeature(n.last_seen, ids.last_seen),
    ],
  };
}
