---
name: RapidAPI subdomain configuration
description: Provider-host setup and TLS validation for this workspace's RapidAPI connector.
---

For the USA all-state lottery API, the RapidAPI connector must be configured with the provider subdomain `usa-lottery-result-all-state-api`, not a full hostname or URL. The proxy constructs the RapidAPI hostname from the configured subdomain; an invalid configured host can fail TLS validation before the provider receives a request.

**Why:** The connector's API requests failed with `ERR_TLS_CERT_ALTNAME_INVALID` before any provider response, while the documented provider hostname identifies this subdomain.

**How to apply:** If requests fail at TLS validation, inspect or reconnect the RapidAPI connection's host/subdomain setting before changing application routes or retrying provider calls.
