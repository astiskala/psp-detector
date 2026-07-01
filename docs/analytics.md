# Analytics: events, dimensions & dashboard

This document describes how PSP Detector's telemetry surfaces in Google
Analytics, the custom dimensions that make event parameters reportable, and the
Looker Studio dashboard built on top of them. For _what_ is collected and the
privacy guarantees, see the **Privacy & Telemetry** section of the
[README](../README.md). For the implementation, see
[`src/services/telemetry.ts`](../src/services/telemetry.ts).

## Where the data lives

Telemetry is sent via the GA4 Measurement Protocol to the **PSP Detector** GA4
property (`Account a398615484` / `Property 542435591`). Events appear within
seconds in GA4 under **Reports → Realtime** and, for development builds
(`NODE_ENV=development`), in **Admin → DebugView**.

Raw events show up automatically, but their **parameters do not appear in
reports or explorations until they are registered as custom dimensions**. That
registration has now been done (see below), which is what makes breakdowns such
as "detections by PSP name" possible.

## Event catalog

Every event also carries these automatic parameters: `event_source`
(`chrome_extension`), `extension_version`, `session_id`,
`engagement_time_msec`, and coarse user context — `user_country`,
`user_timezone`, `user_os`, and `ui_language` (see "User context" below). The
table below lists the event-specific parameters.

| Event                 | Fired when                                | Event-specific parameters                                                          |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `extension_installed` | Extension is first installed              | —                                                                                  |
| `extension_updated`   | Extension updates to a new version        | —                                                                                  |
| `popup_opened`        | User opens the toolbar popup              | —                                                                                  |
| `scan_requested`      | A detection scan starts                   | `entry_point`                                                                      |
| `scan_skipped`        | A scan is skipped (exempt/restricted URL) | `skip_reason`, `entry_point`                                                       |
| `psp_detected`        | A provider is detected on a page          | `provider_name`, `provider_slug`, `provider_type`, `match_type`, `evidence_domain` |
| `psp_not_detected`    | A scan completes with no provider found   | `entry_point`                                                                      |
| `scan_error`          | A scan fails                              | `error_code`, `component`                                                          |
| `history_opened`      | The history/options page is opened        | —                                                                                  |
| `history_exported`    | History is exported                       | `format`, `row_count_bucket`                                                       |
| `settings_opened`     | The settings dialog is opened             | —                                                                                  |
| `telemetry_changed`   | User toggles the telemetry setting        | `enabled`                                                                          |

Event names and the `entry_point` values are defined as constants in
`TELEMETRY_EVENTS` and `TELEMETRY_ENTRY_POINTS` in `telemetry.ts`; `trackEvent`
ignores any name not in that list.

## Registered custom dimensions

These event-scoped custom dimensions are registered in GA4
(**Admin → Data display → Custom definitions**). Each maps a display name to
the event parameter of the same lowercase key.

| Display name      | Event parameter     | Notes                                               |
| ----------------- | ------------------- | --------------------------------------------------- |
| Provider Name     | `provider_name`     | PSP/provider name, e.g. Stripe, Adyen               |
| Provider Type     | `provider_type`     | PSP / Orchestrator / TSP                            |
| Match Type        | `match_type`        | How it was detected (`matchString` / `regex`)       |
| Evidence Domain   | `evidence_domain`   | PSP-owned hostname only                             |
| Entry Point       | `entry_point`       | `tab_update`, `tab_activation`, `redetect`, `popup` |
| Skip Reason       | `skip_reason`       | `exempt_domain`, `special_url`                      |
| Error Code        | `error_code`        | Coded scan-error reason                             |
| Component         | `component`         | Component where an error occurred                   |
| Export Format     | `format`            | History export format (e.g. `csv`)                  |
| Row Count Bucket  | `row_count_bucket`  | Coarse export size bucket, e.g. `11-50`             |
| Telemetry Enabled | `enabled`           | Whether telemetry was turned on or off              |
| Extension Version | `extension_version` | Version that sent the event                         |
| User Country      | `user_country`      | Country (ISO-2) from Cloudflare trace lookup        |
| User Timezone     | `user_timezone`     | IANA timezone, e.g. `Asia/Singapore`                |
| Operating System  | `user_os`           | OS platform, e.g. `mac` / `win` / `linux`           |
| UI Language       | `ui_language`       | Browser UI language, e.g. `en-GB`                   |

The `provider_slug` parameter is still sent on `psp_detected` but is **not**
registered as a dimension, since `provider_name` already identifies the
provider. Register it the same way if you ever need slug-level reporting.

### Important: custom dimensions are not retroactive

GA4 only indexes a custom dimension from the moment it is created
(registered 2026-06-29). Events recorded **before** that date show `(not set)`
for these dimensions, even though the parameter was present in the payload.
Breakdowns such as "detections by Provider Name" therefore start sparse and
fill in as new data arrives — give it a day or two of traffic.

## User context (country, timezone, OS, language)

GA4 does **not** geolocate Measurement Protocol events (unlike gtag/GTM), so
the standard Country, Region, City, and device dimensions stay `(not set)`.
To capture coarse user context the extension therefore sends it explicitly, in
a privacy-preserving way (see `getUserContext` in
[`src/services/telemetry.ts`](../src/services/telemetry.ts)):

- `user_country` — resolved from Cloudflare trace
  (`https://www.cloudflare.com/cdn-cgi/trace`) and sent as ISO-2 only. Raw IP
  values are never persisted by the extension; only the country code is cached
  in session storage.
- `user_timezone` — the IANA timezone (`Intl.DateTimeFormat`).
- `user_os` — `chrome.runtime.getPlatformInfo()`.
- `ui_language` — `chrome.i18n.getUILanguage()` (falls back to
  `navigator.language`).

**Rollout caveat:** this context is only attached by builds that include the
`getUserContext` change. Values appear in GA4 only after a new build is
released, users update, and GA processes the (newly registered) custom
dimensions — it does not backfill historical events.

## The dashboard

A Looker Studio report, **PSP Detector – Usage Dashboard**, is connected
directly to the GA4 property and refreshes automatically:

<https://lookerstudio.google.com/reporting/00abf44c-3fc7-4701-a79d-832440389a6c>

It currently contains:

- A **date-range control** to scope every chart to a time window.
- An **events overview table** — every event name and its `Event count`.
- A **PSP detections by provider** bar chart — `Provider Name` × `Event count`
  (populates going forward, per the note above).
- A **usage-over-time** time series — `Event count` by date.

### Adding more views

To break any event down by one of its parameters, add a chart and pick the
matching custom dimension as the dimension and `Event count` as the metric.
Useful additions: `Match Type` and `Entry Point` (pie or bar), `Skip Reason`,
and `Extension Version` for adoption by release.

To make the provider chart show **only** detection events and drop the
`(not set)` bar, give it a chart-level filter of `Event name` equal to
`psp_detected` (Setup → Filter → Add a filter).

## Keeping this in sync with the code

When you add or change a telemetry parameter in `telemetry.ts` (or a call
site), register a matching custom dimension in GA4 so it becomes reportable,
then add it to the tables above. New events also need to accrue data before
they appear as dimension values.
