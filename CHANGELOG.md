# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- NetAlertX in Gladys, read through its API (GraphQL, port 20212, API token), local only.
- A **NetAlertX network** device: devices online, offline, new and down, with history.
- One device per network device you choose to follow: **Presence** (usable with the user
  presence of Gladys), **IP address** and **Last seen**.
- Scene triggers: a new device joins the network (name, MAC address, vendor, IP), a device
  leaves the network, a device is back, a device with "Alert Down" is down.
- Scene action: mark a device as known in NetAlertX.
- Dashboard widget **Network watch**: devices online, new and down, with a **Known** button.
- Configuration actions: test the connection, mark every new device as known.
- English, French, German and Spanish, documentation included.

[Unreleased]: https://github.com/guim31/gladys-netalertx/commits/main
