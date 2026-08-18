# Howbout Companion web app

The installable web/PWA version of Howbout Companion. It is an independent, read-only calendar viewer; it does not provide Howbout account login or access private Howbout features.

See the [project README](../README.md) for Howbout export setup, the macOS/Linux app, privacy details, packaging, and the direct-account authorization gate.

## Develop

Node.js 22.13 or later is required.

```sh
npm ci
npm run dev
```

Both local server commands bind to `127.0.0.1`, so the app is available only on this computer.

Useful checks:

```sh
npm run lint
npm run typecheck
npm test
```

`npm test` builds the production worker, verifies the rendered Howbout shell and metadata, exercises the calendar endpoint's origin and URL controls, and checks recurrence, timezone, cancellation, color, and input-bound behavior with synthetic calendars.

For a production-mode local run:

```sh
npm run build
npm run start
```

## Calendar data flow

- `.ics` uploads are read and parsed in the browser. The application does not upload the selected file.
- Public Apple, Google, or Outlook feed URLs are sent to `POST /api/calendar` on the locally running companion service. The endpoint transiently handles both the capability-bearing feed URL and returned calendar data while it performs an allowlisted, size-limited fetch; responses are marked `no-store`.
- Parsed events are cached in browser local storage. If the user chooses **Remember on this device**, the public feed URL is also stored there.
- **Disconnect and erase local data** clears the app's local cache and remembered URL.

The application does not intentionally persist or log feed URLs or calendar bodies, but local machine and network logs remain the operator's responsibility. A public calendar link should be protected like a password and revoked at the calendar provider if exposed.

This project is configured for local use only and contains no hosting integration.
