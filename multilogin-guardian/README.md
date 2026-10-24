# Multilogin Guardian Agent

A Python 3.9+ daemon that polls Multilogin cloud phones and stops profiles whose
running time exceeds a tag-based limit. It is designed to run continuously as an
unprivileged systemd service on a Linux VPS.

**Stopping phones is a real, state-changing operation.** Validate the configuration
and test with a non-critical cloud phone before relying on the daemon in production.
The build tests use mocked API responses; they do not verify a live Multilogin account.

## Default rules

| Profile tag | Maximum runtime |
| --- | ---: |
| `political` | 10 minutes |
| `general` | 10 minutes |
| `state` | 35 minutes |
| No recognized tag / untagged | 10 minutes |

Tags are case-insensitive. If a profile has multiple tags, the first tag in its
`tags` array that exists in `rules.by_tag` wins. If none match, `rules.default`
applies. A phone is stopped when its runtime is greater than or equal to the limit.

Only status `0` (Started) is eligible to stop. Status `1` (Starting), `2` (Shut down),
`3` (Expired), missing statuses, and missing runtime values are skipped.

## How a cycle works

1. When SleeckOS integration is enabled, the daemon fetches and applies its latest
   enforcement switch, polling interval, and rules. A cached config is used if the
   fetch fails; if no cache is usable, local rules still describe profiles but
   enforcement fails closed.
2. `GET /mobile_profiles/phone/list?is_running=true&page=N&page_size=100`
   retrieves every running profile, following pagination.
3. `POST /mobile_profiles/phone/statuses` retrieves exact runtimes in batches of
   at most 50 IDs (or the lower configured `batch_size`).
4. The rule engine matches tags and logs each profile's runtime and decision.
5. Unless SleeckOS enforcement is disabled, `POST /mobile_profiles/phone/stop`
   stops over-limit phones in batches of at most 50 IDs. Partial API failures are
   logged and do not crash later cycles.
6. When integration is enabled, a structured cycle report is queued locally and
   posted to SleeckOS. Empty, partial, and failed cycles are reported too.

All Multilogin requests use `Authorization: Bearer <automation_token>`. Use a
`no_exp` automation token with cloud-phone API access for an unattended daemon.

## Files

```text
multilogin-guardian/
├── agent.py
├── bulk_tag.py
├── config.json                 # local/real config; git-ignored
├── config.example.json         # sanitized tracked template
├── requirements.txt
├── setup.sh
├── multilogin-guardian.service
├── profiles_example.csv
├── tests/
└── README.md
```

## Quick installation on Ubuntu/Debian

Copy this directory to the VPS, then run:

```bash
cd multilogin-guardian
# config.json already contains a placeholder; replace it with the real token.
nano config.json
chmod 600 config.json
sudo bash setup.sh
```

The installer:

- installs Python 3 and venv with `apt-get` when needed;
- creates the unprivileged `guardian` system user and group;
- installs files under `/opt/multilogin-guardian`;
- creates `/opt/multilogin-guardian/.venv` and installs `requests`;
- creates guardian-owned `logs` and `state` directories with mode `0750`;
- sets config ownership/permissions to `guardian:guardian` and `0600`;
- installs the systemd unit and runs `systemctl daemon-reload`.

It deliberately **does not enable or start** the service. Review the installed
config, then start it:

```bash
sudo nano /opt/multilogin-guardian/config.json
sudo chmod 600 /opt/multilogin-guardian/config.json
sudo systemctl enable --now multilogin-guardian
sudo systemctl status multilogin-guardian
```

`setup.sh` is safe to rerun for upgrades: it preserves an existing regular
`/opt/multilogin-guardian/config.json` while replacing program files and recreating
the generated venv. Program files and the venv are root-owned; the application
directory is not writable by `guardian`. Only the logs and state directories are
service-user writable, while the config remains `guardian:guardian` and `0600`.
The installer rejects symlinked/special logs, state, and production config paths
rather than following them as root.

On RHEL/CentOS-family systems the installer uses `dnf` or `yum`. Python 3.9 or
newer and systemd are required; the installer checks the active Python version.

## Configuration

`config.json` has five sections:

- `multilogin`: API base URL, automation token, polling interval in seconds, and
  batch size. `batch_size` must be between 1 and 50.
- `rules.by_tag`: tag names mapped to `max_runtime_minutes` and an optional
  description. `rules.default` is required as the fallback.
- `logging`: `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL`, rotating file path,
  maximum bytes per file, backup count, and console/journal output toggle.
  Relative file paths are resolved relative to the config file's directory.
- `notifications`: optional generic JSON webhook, with independent stop and error
  notification switches.
- `sleeckos`: optional integration settings. If the section is absent, integration
  is disabled and the daemon retains its original local-only behavior. The example
  file contains all defaults, including `enabled: false` and
  `base_url: http://127.0.0.1:3000`. Production must explicitly override the URL to
  its SleeckOS listener (port 3001 in the production deployment).

Runtime limits and polling intervals must be greater than zero. A missing or
placeholder token is rejected at startup rather than sending unauthenticated calls.
Enabling SleeckOS requires a real `sleeckos.shared_secret`; the placeholder is
rejected. Relative outbox and cache paths are resolved beside `config.json`.

### SleeckOS integration and recovery

With `sleeckos.enabled: true`, the daemon sends `x-guardian-secret` to
`GET /api/internal/multilogin-guardian/config` before every cycle. The returned
`enforcementEnabled`, `checkIntervalSeconds`, runtime rules, and `configVersion`
take effect immediately without a restart. Each valid response is atomically saved
to `state/remote-config.json` by default. If a fetch fails, the daemon logs and
optionally notifies, then uses the last good in-memory or disk-cached config. If
neither cache is usable, local rules and interval remain available for reporting,
but enforcement **fails closed** and no stop calls are made. Local-only operation
with integration disabled keeps its original enabled enforcement.

Remote `enforcementEnabled: false` is also a hard stop-call disable: inventory and
status checks continue and every profile decision is reported as `disabled`, but
the Multilogin stop endpoint is never called.

After every cycle, including empty cycles and top-level failures, the daemon sends
the structured report to `POST /api/internal/multilogin-guardian/events`. Reports
have a UUID `cycleId`, UTC timestamps, inventory completeness, profile decisions,
and per-profile stop outcomes with an `occurredAt` attempt timestamp. Empty
successful inventory is complete; otherwise `inventoryComplete` becomes true only
after all report rows are built. List and row-construction failures leave it false,
while per-batch status failures can produce a partial report with listed profiles.
Profiles with empty or invalid IDs are omitted with a partial issue. Invalid
runtimes become null. String limits use JavaScript-compatible UTF-16 code units,
and truncation never splits a Unicode surrogate pair. Profile and stop arrays are
capped at 5000 rows; excess rows are omitted with a partial issue while aggregate
counts describe the full cycle. Ambiguous counts, response-less transport errors,
non-JSON HTTP 200, HTTP 5xx, and HTTP 408/429 stop outcomes are `unknown`. Only
other 4xx responses and explicitly identified `fail_details` produce `failed`.

Reports are validated, appended, and fsynced to `state/reports.jsonl` before any
POST. Delivery is FIFO and capped at 20 reports per cycle so backlog recovery stays
bounded. After each acknowledgement the remaining queue is atomically rewritten.
Timeouts, auth failures, and 5xx responses leave the head queued for retry with the
same `cycleId`, which is safe because SleeckOS treats cycle IDs idempotently.
Deterministic HTTP 400/413/422 rejections instead move only that report to the
redacted `state/reports.jsonl.dead` sidecar, alert/log the rejection, and continue
with later reports. The sidecar preserves rejected reports for diagnosis.

On restart, a valid final JSON record without a newline is repaired before append.
Loading is byte-based, so malformed lines, torn UTF-8, and truncated final records
(including partial multibyte characters) are quarantined to the `.dead` sidecar
without discarding other valid pending reports or blocking future appends. Keep
the state directory intact and writable by `guardian`; do not delete queued reports
during an outage. Credentials are redacted from report data and are never
intentionally logged.

### Live reload

After editing `config.json`:

```bash
sudo systemctl reload multilogin-guardian
```

This sends SIGHUP. The daemon finishes its active cycle, then reloads rules, token,
polling interval, logging, and notification settings. If the new config is invalid,
it logs the error and keeps the previous working config.

Reload only covers `config.json`. After changing the systemd unit or Python code:

```bash
sudo systemctl daemon-reload   # only needed after a unit-file change
sudo systemctl restart multilogin-guardian
```

## Service operations and logs

```bash
sudo systemctl status multilogin-guardian
sudo journalctl -u multilogin-guardian -f
sudo journalctl -u multilogin-guardian --since today
sudo systemctl stop multilogin-guardian
sudo systemctl start multilogin-guardian
```

SIGTERM/SIGINT lets an active API cycle finish, prevents a new cycle, logs
`Guardian stopped.`, and exits. The systemd stop timeout is disabled so systemd
does not kill an active cycle; stopping can therefore wait for in-flight batches
(the API and webhook requests themselves have timeouts). systemd restarts
unexpected failures after 10 seconds.

With `logging.console: true`, log entries go to both the systemd journal and the
rotating file. The default file is `/opt/multilogin-guardian/logs/guardian.log`,
rotated at 10 MB with five backups. Format:

```text
2026-01-15 14:25:04 | INFO     | Running profiles: 3
```

The unit uses `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`,
and only grants write access to the logs and state directories. The daemon refuses
to run as root.

## Bulk tagging

`bulk_tag.py` accepts CSV or JSON and calls `PUT /mobile_profiles/phone/update`
once per profile. Individual failures are reported and processing continues; any
failure produces a nonzero exit code.

**Warning:** this utility replaces the full tags list with the single supplied
`account_type`. It does not preserve other existing tags.

CSV:

```csv
profile_id,account_type
619005104636297579,political
618154668161237077,state
```

JSON object mapping:

```json
{
  "619005104636297579": "political",
  "618154668161237077": "state"
}
```

JSON list is also accepted:

```json
[
  {"profile_id": "619005104636297579", "account_type": "political"},
  {"profile_id": "618154668161237077", "account_type": "state"}
]
```

Run it as the `guardian` user so it can read the private config:

```bash
sudo -u guardian /opt/multilogin-guardian/.venv/bin/python \
  /opt/multilogin-guardian/bulk_tag.py /path/to/profiles.csv \
  --config /opt/multilogin-guardian/config.json
```

Malformed rows and duplicate profile IDs are rejected before any API update starts.

## Webhook notifications

Set `notifications.enabled` to `true` and provide an HTTP(S) `webhook_url`.
Stop notifications use this JSON shape:

```json
{
  "title": "Multilogin Guardian: Profiles Stopped",
  "message": "Stopped 3 profile(s).",
  "profiles": ["phone-01", "phone-02", "phone-03"],
  "timestamp": "2026-01-15T14:25:04Z"
}
```

Error notifications use title `Multilogin Guardian: Error`. Webhook failures are
logged and never interrupt phone monitoring.

## Troubleshooting

- **HTTP 401 / authentication failed:** verify the automation token, its expiry,
  and cloud-phone API permissions. Update `config.json`, then reload the service.
- **Service exits with a configuration error:** check the journal. Real Multilogin
  and enabled-integration secrets are required; placeholders are rejected.
- **Phones are not stopping:** inspect the per-profile status/runtime lines. Only
  status `0` with `running_time_secs` at or above the selected limit is eligible.
  Also check whether SleeckOS has disabled enforcement.
- **Unexpected rule selected:** tags use first-recognized-tag order. Check the
  profile's `tags` array, cycle tag breakdown, and remote-config fallback messages.
- **Config changes are ignored:** use `sudo systemctl reload multilogin-guardian`;
  check the journal for a validation error and fallback to the previous config.
  Remote SleeckOS values override local rules and interval while integration is on.
- **Log/state permission errors:** keep both `/opt/multilogin-guardian/logs` and
  `/opt/multilogin-guardian/state` owned by `guardian:guardian`; systemd only allows
  writes beneath those directories.
- **SleeckOS is unreachable:** monitoring continues with cached config; without a
  usable cache, local rules are reported but enforcement is disabled. Check the
  journal and `state/reports.jsonl`; up to 20 queued reports retry per cycle.
  Restore API access rather than deleting the outbox.
- **Reports are rejected or the outbox was interrupted:** inspect the redacted
  `state/reports.jsonl.dead` sidecar and journal. Deterministic validation failures
  and malformed records are isolated there so later reports can continue.
- **API errors:** a failed cycle is logged and retried at the next interval. Status
  and stop batches fail independently so one bad batch does not discard all others.

The Multilogin token and Guardian shared secret are never intentionally logged. Do
not paste real config files or credentials into tickets, chat, or source control.

## Local development and tests

Only `requests` is required at runtime. Tests use standard-library `unittest` and
mocked HTTP/API objects:

```bash
cd multilogin-guardian
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall agent.py bulk_tag.py tests
bash -n setup.sh
```

No test starts or stops a real cloud phone. For the first live verification, use a
non-critical profile, confirm its tags and status in the logs, and watch both the
stop response and Multilogin UI before deploying broader limits.
