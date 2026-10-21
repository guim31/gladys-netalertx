// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `network`.
//
// What a device box cannot show: the devices NetAlertX flags as new (not
// acknowledged yet) and the devices down (offline while "Alert down" is set),
// with a "Known" button for the first new ones. Budget (8 components, 2 texts,
// 1 status, 4 buttons): three tiles (online, new, down), one status list of 10
// rows at most (new first, then down), 4 buttons at most; a caption replaces
// the list when there is nothing to report.
//
// Button keys are numbered (`known_1`…): the core drops a button whose action
// key is already taken. The MAC address travels in `params`, which the core
// echoes from the content, never from the request.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { displayName } from './client.js';
import { WIDGET_KEY } from './monitor.js';
import { render, REPORTS } from './messages.js';

export const MAX_STATUS_ITEMS = 10;
export const MAX_BUTTONS = 4;
export const TTL_SECONDS = 60;
const BUTTON_PREFIX = 'known_';
const MAX_BUTTON_LABEL = 24;

export const TEXT = {
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  fresh: { en: 'New', fr: 'Nouveaux', de: 'Neu', es: 'Nuevos' },
  down: { en: 'Down', fr: 'Absents', de: 'Ausgefallen', es: 'Caídos' },
  isNew: { en: 'New', fr: 'Nouveau', de: 'Neu', es: 'Nuevo' },
  isDown: { en: 'Down', fr: 'Absent', de: 'Ausgefallen', es: 'Caído' },
  offline: { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' },
  known: { en: 'Known: ', fr: 'Connu : ', de: 'Bekannt: ', es: 'Conocido: ' },
  calm: {
    en: 'No new device, no device down.',
    fr: 'Aucun nouvel appareil, aucun appareil absent.',
    de: 'Kein neues Gerät, kein ausgefallenes Gerät.',
    es: 'Ningún dispositivo nuevo, ningún dispositivo caído.',
  },
  waiting: {
    en: 'Waiting for NetAlertX: check the configuration of the integration.',
    fr: "En attente de NetAlertX : vérifiez la configuration de l'intégration.",
    de: 'Warte auf NetAlertX: Prüfe die Konfiguration der Integration.',
    es: 'Esperando a NetAlertX: compruebe la configuración de la integración.',
  },
  gone: {
    en: 'This device is no longer new.',
    fr: "Cet appareil n'est plus nouveau.",
    de: 'Dieses Gerät ist nicht mehr neu.',
    es: 'Este dispositivo ya no es nuevo.',
  },
};

const t = (text, language) => text[language] ?? text.en;

// "laptop.home.lan" → "laptop": NetAlertX often names a device by its DNS
// name, too long for a row or a button. An IP address stays whole.
export const shortName = (device) => {
  const name = displayName(device);
  return /^[^\s.]+(\.[^\s.]+)+$/.test(name) && !/^[\d.]+$/.test(name) && !name.includes(':')
    ? name.split('.')[0]
    : name;
};
const clip = (value, max) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

function row(device, language, down) {
  const state = t(down ? TEXT.isDown : TEXT.isNew, language);
  // A new device offline says so; a device down shows the address it had.
  const detail = !down && !device.present ? t(TEXT.offline, language) : device.ip;
  return {
    label: clip(shortName(device), 40),
    value: clip(detail ? `${state} · ${detail}` : state, 40),
    color: down ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { language = 'en' }) {
      const view = monitor.view();
      if (!view.ready) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(TEXT.waiting, language) }],
        };
      }
      const components = [
        {
          type: 'value',
          label: t(TEXT.online, language),
          value: view.counts.online,
          icon: 'wifi',
          color: WIDGET_COLORS.SUCCESS,
        },
        {
          type: 'value',
          label: t(TEXT.fresh, language),
          value: view.counts.new,
          icon: 'alert-circle',
          color: view.counts.new > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        },
        {
          type: 'value',
          label: t(TEXT.down, language),
          value: view.counts.down,
          icon: 'wifi-off',
          color: view.counts.down > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
        },
      ];
      const rows = [
        // A new device that is also down is listed once, as down.
        ...view.fresh
          .filter((device) => !view.down.includes(device))
          .map((device) => row(device, language, false)),
        ...view.down.map((device) => row(device, language, true)),
      ].slice(0, MAX_STATUS_ITEMS);
      if (rows.length === 0) {
        components.push({ type: 'text', variant: 'caption', text: t(TEXT.calm, language) });
        return { ttl_seconds: TTL_SECONDS, components };
      }
      components.push({ type: 'status', items: rows });
      view.fresh.slice(0, MAX_BUTTONS).forEach((device, index) => {
        components.push({
          type: 'button',
          label: clip(`${t(TEXT.known, language)}${shortName(device)}`, MAX_BUTTON_LABEL),
          icon: 'check-circle',
          style: 'secondary',
          action: { key: `${BUTTON_PREFIX}${index + 1}`, params: { mac: device.mac } },
        });
      });
      return { ttl_seconds: TTL_SECONDS, components };
    },

    async action(monitor, { actionKey, params }) {
      const device = actionKey.startsWith(BUTTON_PREFIX)
        ? monitor.devices.get(params?.mac)
        : undefined;
      if (!device?.isNew) {
        return TEXT.gone;
      }
      const name = await monitor.markKnown(device.mac);
      return render(REPORTS.marked, { name });
    },
  },
};
