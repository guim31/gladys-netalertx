// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// - mark_known: clears the "new device" flag of a device in NetAlertX, the
//   "acknowledge" of its interface. Its `mac` field is a string, so a scene
//   started by the "New device" trigger passes {{triggerEvent.data.mac}}
//   (after a notification, for instance). Outputs are numbers, not booleans:
//   the core's "Continue only if" compares with === (Gladys 5.2.0).
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async mark_known(monitor, { fields }) {
    await monitor.markKnown(fields.mac);
    return { known: 1 };
  },
};
