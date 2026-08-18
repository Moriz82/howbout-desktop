# Howbout Companion

An independent, read-only desktop and web companion for viewing Howbout calendar exports on macOS, Linux, and the web. It provides a weekly calendar, an upcoming-plans view, search, manual refresh, and local `.ics` import without asking for a Howbout password.

> This project is not affiliated with or endorsed by Howbout Ltd. It does not provide official Howbout account login or use an official Howbout API.

## Connect a Howbout calendar

The most direct supported setup currently uses Howbout's iPhone calendar export:

1. In Howbout, open **Calendar**, tap **Settings**, and enable **Export to phone**.
2. In Apple Calendar, tap **Calendars** and make sure **Howbout** is enabled. On iOS 17 or later, Howbout may also need full Calendar access in iOS Settings.
3. Tap the info button beside the Howbout calendar, enable **Public Calendar**, choose **Share Link**, and copy the `webcal://` URL.
4. Open Howbout Companion, paste the link, and select **Connect my calendar**. On a shared computer, clear **Remember on this device**.

These steps follow [Howbout's official calendar-export guide](https://howbout.app/get-help/export-calendar/). Howbout notes that Android calendar exports generally remain mobile-only and may not sync to desktop.

You can also import an `.ics` file on every platform. File import is a snapshot; import a newer file to update it. Public feed URLs from Apple Calendar, Google Calendar, and Outlook are allowlisted, but only the Apple/iPhone flow above is documented by Howbout as a path for exporting Howbout plans.

A public calendar URL is effectively a password to that calendar. Do not share it, and turn off **Public Calendar** at the provider to revoke it.

## Run the web app

Requirements: Node.js 22.13 or later and npm.

```sh
cd web
npm ci
npm run dev
```

The local web server binds to `127.0.0.1`; it is not exposed to other devices on the network.

For a production-mode local check:

```sh
npm run build
npm run start
```

The web app can also be installed as a PWA when the browser exposes an install prompt.

## Run the desktop app

Requirements: Node.js 22.13 or later, npm, Rust 1.88 or later, and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode Command Line Tools. On Debian or Ubuntu, install the native packages first:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2
```

Then run the native app:

```sh
cd desktop
npm ci
npm run desktop:dev
```

## Test and package

```sh
cd web
npm ci
npm run lint
npm run typecheck
npm test

cd ../desktop
npm ci
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

Native bundles are written below `desktop/src-tauri/target/release/bundle/`. A local build packages only for the current operating system: `.app`/`.dmg` on macOS and `.deb`/`.AppImage` on Linux. GitHub Actions builds both macOS and Linux packages and uploads them as short-lived workflow artifacts. Development and CI bundles are unsigned. Public macOS distribution still requires Developer ID signing and notarization; production Linux packages should also be signed through the chosen release channel.

To reproduce the Linux x86_64 bundles locally with Docker, run these commands from the repository root. Separate mounts keep Linux `node_modules` and Rust output from replacing the host installation or macOS build:

```sh
docker build --platform linux/amd64 \
  -f tools/linux-builder.Dockerfile \
  -t howbout-linux-builder .

mkdir -p releases/linux-x86_64/target
docker run --rm --platform linux/amd64 \
  --mount type=bind,src="$PWD",dst=/work \
  --mount type=volume,dst=/work/desktop/node_modules \
  --mount type=bind,src="$PWD/releases/linux-x86_64/target",dst=/work/desktop/src-tauri/target \
  howbout-linux-builder \
  sh -c 'npm ci && npm run desktop:build -- --bundles deb'
```

The Debian package is written beneath `releases/linux-x86_64/target/release/bundle/deb/`. Build the AppImage on native Linux or use the Ubuntu CI job; `linuxdeploy` is not reliable under x86_64 emulation on Apple Silicon Docker.

## Privacy and limitations

- The app is read-only. It cannot create or edit plans, accept invitations, show friends or chats, or access other private Howbout features.
- There is no Howbout account sign-in. Calendar export or `.ics` import is the supported setup.
- Parsed events are cached in the browser or desktop webview on this device. **Disconnect and erase local data** clears that cache.
- An uploaded `.ics` file is parsed in the client. A pasted public feed URL must be fetched: the desktop app fetches it directly, while the web app sends it to its same-origin calendar endpoint. The application does not intentionally persist or log feed contents.
- If **Remember on this device** is enabled, desktop stores the feed URL in the operating system credential store; web stores it in browser local storage. Linux therefore needs a working Secret Service/keyring. Disable remembering if the device is shared.
- Refresh is manual, and calendar-provider export delays still apply.
- No analytics or mobile-app tracking SDKs are included.

## Direct-account integration gate

The sanitized traffic notes in [FLOW_ANALYSIS.md](./FLOW_ANALYSIS.md) document why direct Howbout login is not implemented: the captured session starts after login and omits the account/session exchange, renewal, and logout contracts. The original capture is sensitive evidence, not a source of reusable credentials or authorization.

Do not add private Howbout API calls or account login until there is explicit authorization to test them and either an official supported API/session contract from Howbout or an authorized, sanitized login-to-logout test flow. Any integration must also comply with [Howbout's Terms and Conditions](https://howbout.app/terms-and-conditions), including its restrictions on unauthorized automated access. Never copy tokens, cookies, client keys, App Check values, personal data, or other values from a traffic capture into code, fixtures, issues, logs, or CI secrets.
