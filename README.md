# NetAlertX for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings
[NetAlertX](https://github.com/netalertx/NetAlertX) (formerly Pi.Alert), the open-source network
presence scanner, into Gladys: the presence of the devices of your network, counters for the whole
network, and a scene trigger when an unknown device connects.

> **Tested against a real NetAlertX (26.10.0, in Docker), not yet on a real home installation:
> feedback welcome** on the [Gladys forum](https://community.gladysassistant.com).

## Features

- **NetAlertX network** device: devices online, offline, new (not acknowledged yet) and down
  (offline with "Alert Down" set in NetAlertX), as counters with history.
- **One device per network device you follow**, chosen in the Discover tab: **Presence**
  (presence sensor, usable with the user presence of Gladys), **IP address** and **Last seen**.
- **Scene triggers**: a new device joins the network (name, MAC address, vendor, IP), a device
  leaves, a device is back, a watched device is down.
- **Scene action**: mark a device as known in NetAlertX (its MAC address can come from the trigger).
- **Dashboard widget** "Network watch": devices online, new devices and devices down, with a
  **Known** button.
- Configuration actions: test the connection, mark every new device as known.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- NetAlertX reachable from Gladys, with its API (port 20212 by default, `GRAPHQL_PORT`) and its
  API token (`API_TOKEN`, Settings → General). Tested with NetAlertX 26.10.0.

## Installation

In Gladys, **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-netalertx`. Then, in the Configuration tab, enter the address of
the NetAlertX API and its API token. The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- The integration reads the device list of NetAlertX through `GET /devices`
  (`Authorization: Bearer <API_TOKEN>`), or its GraphQL API on older versions, every minute by
  default, on its own timer (the devices are
  published with `should_poll: false`).
- It compares each read with the previous one, kept under `/data`: a MAC address never seen
  before and flagged new fires **new device**, a change of "present in the last scan" fires
  **left** / **back** (and **down** when "Alert Down" is set). The first read only records the
  network.
- "Mark as known" clears `devIsNew` through `POST /device/<mac>/update-column`, as the NetAlertX
  interface does.
- Local only: no cloud, no account. The token is stored by Gladys and never logged.

## Limitations

- Presence is only as fresh as the NetAlertX scans (every 5 minutes by default): the integration
  reads, it does not scan.
- "Last seen" assumes NetAlertX stores UTC dates (26.x); older versions stored local time.
- Phones with a private (random) MAC address per network show as a new device per network.
- Up to 500 devices in the Discover tab; archived devices are ignored; 20 scene events per read at
  most (the next ones follow at the next reads).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and a fake NetAlertX that serves answers
recorded on a real NetAlertX 26.10.0 (`test/fixtures/netalertx/`, anonymized). See `CLAUDE.md`
for the project rules.

## Credits

- [NetAlertX](https://github.com/netalertx/NetAlertX) by jokob-sk and contributors (GPL-3.0): this
  integration only talks to its API, it contains none of its code. Its documentation of the
  [API](https://docs.netalertx.com/API/) was the reference.
- Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and
  the official JavaScript template.
- Cover: the NetAlertX logo, from `front/img/svg/netalertx_blue_docs.svg` of the NetAlertX
  repository (GPL-3.0), in the black and white of its main logo.

Not affiliated with NetAlertX.

## License

Apache-2.0, see [LICENSE](LICENSE).
