# Mediaplane

> **Status: pre-alpha.** Milestone 1 (engine and CLI) is in progress. Nothing here is usable yet.

Mediaplane is an open-source control plane for a self-hosted media stack. You describe the
stack you want in one file, `stack.yaml`, and Mediaplane will:

- deploy it as a plain Docker Compose project that you can read, manage with other tools,
  or keep running without Mediaplane;
- generate every API key and password up front, so you never copy one between apps;
- wire the apps together through their own APIs: download clients, indexer sync, root
  folders, and the media-server and request-app connections;
- keep watching, and tell you when something was changed by hand, without overwriting it.

It runs as a single container on an existing Linux host (amd64 or arm64), with Jellyfin or
Plex as the media server.

## Design

- [M1 design: engine and CLI](docs/design/m1-engine-cli.md)
- [Architecture decision records](docs/adr/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
[SECURITY.md](SECURITY.md).

## Licence

[GPL-3.0](LICENSE)
