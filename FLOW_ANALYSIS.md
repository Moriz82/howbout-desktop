# Sanitized Howbout capture analysis

## Scope and handling

- Source: `/Users/moriz/Downloads/flows(2)` (mitmproxy flow dump, 766,255 bytes)
- SHA-256: `5a556a305dc01167af6e2fb260d435d709f9293e8539af70b3934782e66893a2`
- Reader: mitmproxy 12.2.2
- Parsed HTTP flows: 54
- The source was read only. No token, cookie, API-key value, personal identifier, query value, or JSON scalar value is reproduced here.

The capture contains an already-authenticated iOS/Capacitor session. It does **not** contain initial Howbout login, account creation, logout, or renewal of the Howbout API session.

## Host inventory

| Count | Host | Role inferred from the captured routes |
| ---: | --- | --- |
| 24 | `api.howbout.app` | Howbout REST API: 12 CORS preflights and 12 authenticated calls |
| 10 | `calendar.google.com` | Legacy CalDAV discovery/access attempts |
| 5 | `*.skadsdkless.appsflyersdk.com` | AppsFlyer attribution/conversion telemetry |
| 4 | `cdp-eu.customer.io` | Customer.io settings, identity, device, and behavioral analytics |
| 2 | `api.revenuecat.com` | Subscription/offerings lookup |
| 2 | `*.launches.appsflyersdk.com` | AppsFlyer launch/event telemetry |
| 2 | `www.googleapis.com` | Google OAuth token refresh attempts |
| 1 each | `securetoken.googleapis.com`, `firebaselogging-pa.googleapis.com`, `*.ingest.sentry.io`, `app-analytics-services.com`, `gspe1-ssl.ls.apple.com` | Firebase token refresh/logging, Sentry, analytics, and Apple service traffic |

No WebSocket upgrade or WebSocket message was present. The chat data seen here is fetched over REST.

## Howbout HTTP contract observed

All 12 non-OPTIONS calls used HTTP/2, returned 200, and shared this envelope:

```text
response_data: route-specific object/string
user_id: integer
```

Dynamic user/event identifiers below are deliberately shown as `{id}`.

| Method and route | Query or request shape | Response data shape observed |
| --- | --- | --- |
| `GET /api/users/self` | Query: `include_gamification`, `include_preferences`, `last_synced_at`, `new_sync_system`, `profile_picture_hash` | `feature_toggle_overrides`, `primary_phone_num`, `user`, `user_preferences`; `user` includes birthday, creation time, email, expected login type, ID, region, and name |
| `GET /api/users/{id}/events` (4 calls) | Query: `from`, `include_ideas`, `include_unread_chat_events`, `last_updated`, `user_ids` | `all_event_ids`, `events`, `profile_pictures`, `user_events`; event objects include title, description, start/end, location, recurrence, host/invitees, visibility/state, and IDs |
| `GET /api/events/{id}` | Query: `normalised` | `event`, `polls`, `profile_pictures`, per-user `requests`, per-user `users` |
| `POST /api/users/{id}/activity-feed` | JSON: `latest_seen_timestamp`, `limit`, `page`, `seen_items`, `sync_from`, `use_dynamodb_data` | `has_friend_activities`, `items`, `marked_as_read_items`, `unread_count` |
| `GET /api/events/{id}/chat-messages` | Query: `deleted_messages`, `existing_messages`, `limit`, `offset`, `use_uuids` | `invalid`, `missing`, `reactions`, `read_receipts` |
| `GET /api/users/{id}/integrations/google-calendar/calendars` | No body | `calendars` array (empty in this sample) |
| `POST /api/users/{id}/shared-calendars` | JSON: `upload_type`, `shared_calendars[]`; each calendar has `id`, `name`, `visibility`, `delete[]`, `events[]`; events include title, description, location, start/end, recurrence, availability/state, and ID | String acknowledgement |
| `POST /api/users/{id}/monetisation/entitlements` | JSON: `entitlements`, `expired_subscription`, `id_with_prefix`, `new_subscription` | `entitlements` |
| `PUT /api/events/{id}/invite` | JSON: `chat_muted`, `countdown`, `state`, `visibility` | String acknowledgement |

Observed query typing:

- `normalised` was boolean.
- `from` and `last_synced_at` were date/datetime-shaped.
- `include_*`, `new_sync_system`, `use_uuids`, `limit`, and `offset` were integer-shaped in this client (likely 0/1 for flags, but the capture alone does not prove all accepted encodings).
- `last_updated`, `profile_picture_hash`, and `user_ids` must be treated as opaque strings until more cases are captured or documented.

## API authentication and browser feasibility

The Howbout requests establish a clear two-header session contract:

- `Authorization: Bearer <Howbout session JWT>`
- `x-api-key: <stable client key>`

The API bearer was the same across all 12 calls. Structurally it is an HS256 JWT with a 1,200-second lifetime and claims named `device_id`, `exp`, `iat`, `iss`, `jti`, `nbf`, `prv`, `remember_token`, and `sub`. The API key was a stable 32-byte value. Neither value is reproduced or committed.

This bearer is **not** the Firebase ID/access token refreshed earlier in the capture: one-way fingerprint comparison showed different credentials, different signature algorithms, and different lifetimes. Therefore Firebase login alone is insufficient to call `api.howbout.app`; an additional Howbout session-mint/exchange step exists but is absent from this dump.

The captured API traffic originated from `capacitor://localhost`. Browser use appears technically feasible:

- Every real call had a matching `OPTIONS` preflight.
- Preflights returned 204 and `Access-Control-Allow-Origin: *`.
- Allowed methods included `DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT`.
- Allowed request headers explicitly included `authorization`, `appversion`, `featuretoggles`, `x-api-key`, and the observed device/Firebase headers.
- No Howbout request Cookie or response Set-Cookie appeared, and `Access-Control-Allow-Credentials` was absent.
- All actual API responses were marked `private, no-cache`; HSTS and the other standard security-header families were present.

The real calls also sent `appversion: 16.1.0` and a 64-byte `featuretoggles` header. Some routes sent locale/timezone/device, Firebase/FCM, live-activity, and build metadata. Treat those as optional route-specific metadata unless live testing or official documentation proves otherwise; do not clone mobile-only tracking headers into a desktop client by default.

## Login/session evidence and missing link

The only identity exchange captured was:

```text
POST https://securetoken.googleapis.com/v1/token?key=<redacted>
request JSON keys: grantType, refreshToken
request header: x-firebase-appcheck=<redacted>
response: 200
response keys: access_token, expires_in, id_token, project_id,
               refresh_token, token_type, user_id
```

Safe structural findings:

- Grant type was `refresh_token`.
- Firebase access and ID tokens were the same RS256 JWT in this response, with a 3,600-second lifetime.
- The Firebase token identified `google.com` as the sign-in provider.
- The refresh credential was not rotated in this exchange (same one-way fingerprint before and after).
- A 948-byte Firebase App Check value accompanied the request.
- The Firebase token did not match the Howbout API bearer.

What this dump does **not** show:

- The initial Google/Firebase authorization-code or PKCE flow.
- The endpoint/request that exchanges Firebase/Google identity for the custom Howbout HS256 JWT.
- How the 20-minute Howbout JWT is renewed.
- Account creation, OTP fallback, device registration, logout, or token revocation.

Do not implement login by importing the captured refresh token, JWT, App Check value, or API key. To finish real login safely, obtain either official Howbout client/API configuration or one authorized, sanitized capture covering: logged out -> Google sign-in -> Howbout account/session exchange -> one Howbout JWT renewal -> logout.

## Google Calendar behavior

The mobile client made two identical failed sequences:

1. CalDAV `PROPFIND` discovery attempts returned 405.
2. User-scoped CalDAV attempts returned 401.
3. `POST https://www.googleapis.com/oauth2/v4/token` with form keys `client_id`, `enable_granular_consent`, `grant_type`, `include_granted_scopes`, and `refresh_token` returned 400 `invalid_grant`.

This is a failed/stale integration path, not a working reference implementation. A desktop/web build should use an authorized Google OAuth installed-app/web flow with PKCE and the supported Google Calendar API, or Howbout's own documented integration endpoint. It must not reuse the captured Google credential or legacy CalDAV sequence.

## Privacy and security findings

The dump should be treated as highly sensitive even though this report is sanitized. It contains sufficient raw material to expose or correlate:

- Howbout/Firebase/Google access and refresh credentials, a Howbout API key, App Check, FCM, RevenueCat, AppsFlyer, Sentry, and analytics credentials/identifiers.
- Account profile fields including name, email, phone, birthday, region, login type, and internal IDs.
- Calendar/event titles, descriptions, locations, timestamps, recurrence data, participants, friend identities, activity, and chat metadata.
- Customer.io telemetry containing device ID/name/token/model, OS/app versions, locale/timezone/network/screen data, identity traits, contact/calendar/push-permission state, social/calendar counts, and plan-count behavioral metrics.

Security implications for the new client:

- A client-distributed `x-api-key` is not a secret and cannot be the authorization boundary; user authorization must remain enforced by the bearer/session.
- Wildcard CORS is not by itself an authentication bypass here because there are no credential cookies, but any site can call the API if it obtains a bearer and the client key. XSS/token storage therefore matters.
- For the web app, prefer a same-origin backend-for-frontend that keeps upstream credentials server-side and gives the browser a Secure, HttpOnly, SameSite session cookie. Avoid storing refresh/session credentials in `localStorage`.
- For macOS/Linux desktop, use system-browser OAuth/deep links and store long-lived credentials only in macOS Keychain or Linux Secret Service. Keep short-lived access tokens in memory where practical.
- Keep Firebase and Howbout token managers separate; never send a Firebase ID token where the custom Howbout bearer is expected.
- Do not reproduce Customer.io, AppsFlyer, Sentry replay, or device/permission telemetry by default. Add telemetry only with a clear purpose, data minimization, consent, and a disclosed retention policy.
- Do not commit the dump or any extracted scalar values. Because a decrypted capture exists, revoke/rotate affected user credentials if it has left the trusted machine or been shared beyond the intended development scope.

## Implementation priorities derived from the evidence

1. Build the shared calendar/events UI against typed interfaces matching the captured response envelope and routes.
2. Put the API behind a single client that injects the authorized client configuration, handles 401/429, and never logs headers/bodies containing identity or calendar data.
3. Implement token storage/renewal only after the missing Howbout session exchange is confirmed.
4. Use REST refresh/polling first; there is no WebSocket evidence to justify a socket client.
5. Keep Google Calendar integration disabled or clearly marked unavailable until a clean OAuth grant succeeds.
6. Make third-party analytics opt-in or omit them from the first-party desktop/web build.

## Reproducible sanitized inspection

The repository contains a value-redacting mitmproxy addon:

```sh
cd /Users/moriz/Projects/howbout-desktop
mitmdump -q -nr /Users/moriz/Downloads/'flows(2)' \
  -s tools/inspect_capture.py
```

That command prints routes, query **names**, header **names**, response statuses, JSON field/type shapes, app version, origins, and one-way API-key fingerprints. It must never be changed to print raw authorization, cookie, query, form, or body scalar values.
