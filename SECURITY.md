# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **API token of NetAlertX**, stored by Gladys in the integration configuration (a `secret`
  field) and sent only to the NetAlertX address you configure, in the `Authorization` header;
  it is never written to the logs or to `/data`;
- under `/data`, `snapshot.json`: the MAC addresses of the devices NetAlertX knows, with their
  present / new / alert-down flags (no name, no IP address);
- the network: HTTP(S) requests to the NetAlertX API only, on the local network (no cloud, no
  other outgoing connection). Prefer HTTPS behind a reverse proxy if the API crosses an
  untrusted network: the token travels in clear over plain HTTP.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and NetAlertX, the third-party service the integration talks to.
