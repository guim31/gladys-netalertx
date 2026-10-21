// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the monitor, so index.js stays a few lines and the tests drive
// the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { INIT_FAILED } from './messages.js';
import { Monitor } from './monitor.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'netalertx-app' });

// A configuration action displays what it resolves, in the user's language,
// while a thrown error shows a single string: the expected failures (NetAlertX
// unreachable, token refused) are answered, not thrown.
const answered =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.messages) {
        return err.messages;
      }
      throw err;
    }
  };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, now, timeZone, timings
 */
export function registerHandlers(gladys, options = {}) {
  const monitor = new Monitor({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    now: options.now,
    timeZone: options.timeZone,
    timings: options.timings,
  });

  // Resolved once the monitor has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await monitor.resync(config);
        return;
      }
      started = true;
      await monitor.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  // The Discover tab asks for a refresh: read NetAlertX again.
  gladys.onScanRequest(whenReady(() => monitor.runCycle()));

  // Devices are published with should_poll: false (read by the monitor's own
  // timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady(() => monitor.poll()));

  gladys.onDeviceCreated(whenReady((device) => monitor.onDeviceCreated(device)));

  gladys.onConfigUpdated(whenReady((newConfig) => monitor.reconfigure(normalizeConfig(newConfig))));

  const actions = {
    test_connection: () => monitor.testConnection(),
    mark_all_known: () => monitor.markAllKnown(),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, whenReady(answered(handler)));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(monitor, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(monitor, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady(
        answered((actionKey, params, context = {}) =>
          widget.action(monitor, { actionKey, params, ...context }),
        ),
      ),
    );
  }

  return {
    monitor,
    ready,
    actions: Object.keys(actions),
    stop: () => monitor.stop(),
  };
}
