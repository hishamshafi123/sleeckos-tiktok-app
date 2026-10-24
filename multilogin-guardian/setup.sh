#!/usr/bin/env bash
# Install Multilogin Guardian without starting it. Run as root on the Linux VPS.
set -Eeuo pipefail

APP_DIR="/opt/multilogin-guardian"
APP_USER="guardian"
APP_GROUP="guardian"
SERVICE_NAME="multilogin-guardian"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root: sudo bash setup.sh" >&2
  exit 1
fi

install_python() {
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import ensurepip, venv' >/dev/null 2>&1; then
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-venv
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 python3-pip
  else
    echo "No supported package manager found. Install Python 3.9+ and venv, then rerun." >&2
    exit 1
  fi
}

install_python
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "Python 3.9 or newer is required. Install a newer python3, then rerun." >&2
  exit 1
fi

if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${APP_GROUP}"
fi
if ! id "${APP_USER}" >/dev/null 2>&1; then
  NOLOGIN_SHELL="$(command -v nologin || true)"
  NOLOGIN_SHELL="${NOLOGIN_SHELL:-/usr/sbin/nologin}"
  useradd --system --gid "${APP_GROUP}" --home-dir "${APP_DIR}" \
    --no-create-home --shell "${NOLOGIN_SHELL}" "${APP_USER}"
fi

# Code and the venv stay root-owned. The service user can write only logs,
# durable state, and its own config contents, not program files or directory entries.
if [[ -L "${APP_DIR}" ]]; then
  echo "Refusing to install through a symlinked app directory: ${APP_DIR}" >&2
  exit 1
fi
install -d -o root -g root -m 0755 "${APP_DIR}"
if [[ -L "${APP_DIR}/logs" ]]; then
  echo "Refusing to use a symlinked logs directory: ${APP_DIR}/logs" >&2
  exit 1
fi
if [[ -e "${APP_DIR}/logs" && ! -d "${APP_DIR}/logs" ]]; then
  echo "Logs path exists but is not a directory: ${APP_DIR}/logs" >&2
  exit 1
fi
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0750 "${APP_DIR}/logs"
if [[ -L "${APP_DIR}/state" ]]; then
  echo "Refusing to use a symlinked state directory: ${APP_DIR}/state" >&2
  exit 1
fi
if [[ -e "${APP_DIR}/state" && ! -d "${APP_DIR}/state" ]]; then
  echo "State path exists but is not a directory: ${APP_DIR}/state" >&2
  exit 1
fi
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0750 "${APP_DIR}/state"

# Recreate the generated venv so root never executes an interpreter or pip from
# a service-user-writable installation left by an older installer.
if [[ -L "${APP_DIR}/.venv" ]]; then
  echo "Refusing to replace a symlinked venv: ${APP_DIR}/.venv" >&2
  exit 1
fi
if [[ -e "${APP_DIR}/.venv" && ! -d "${APP_DIR}/.venv" ]]; then
  echo "Venv path exists but is not a directory: ${APP_DIR}/.venv" >&2
  exit 1
fi
if [[ -d "${APP_DIR}/.venv" ]]; then
  rm -rf -- "${APP_DIR}/.venv"
fi
python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/python" -m pip install --requirement "${SOURCE_DIR}/requirements.txt"

install -o root -g root -m 0755 "${SOURCE_DIR}/agent.py" "${APP_DIR}/agent.py"
install -o root -g root -m 0755 "${SOURCE_DIR}/bulk_tag.py" "${APP_DIR}/bulk_tag.py"
install -o root -g root -m 0644 "${SOURCE_DIR}/requirements.txt" "${APP_DIR}/requirements.txt"
install -o root -g root -m 0644 "${SOURCE_DIR}/config.example.json" "${APP_DIR}/config.example.json"
install -o root -g root -m 0644 "${SOURCE_DIR}/profiles_example.csv" "${APP_DIR}/profiles_example.csv"
install -o root -g root -m 0644 "${SOURCE_DIR}/README.md" "${APP_DIR}/README.md"

# Preserve an existing production config during upgrades, but never follow a
# symlink or special file while applying root ownership/permissions.
if [[ -e "${APP_DIR}/config.json" || -L "${APP_DIR}/config.json" ]]; then
  if [[ -L "${APP_DIR}/config.json" || ! -f "${APP_DIR}/config.json" ]]; then
    echo "Production config must be a regular file, not a symlink/special file." >&2
    exit 1
  fi
else
  if [[ -f "${SOURCE_DIR}/config.json" ]]; then
    CONFIG_SOURCE="${SOURCE_DIR}/config.json"
  else
    CONFIG_SOURCE="${SOURCE_DIR}/config.example.json"
  fi
  install -o "${APP_USER}" -g "${APP_GROUP}" -m 0600 "${CONFIG_SOURCE}" "${APP_DIR}/config.json"
fi
chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/config.json"
chmod 0600 "${APP_DIR}/config.json"

install -o root -g root -m 0644 "${SOURCE_DIR}/${SERVICE_NAME}.service" \
  "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload

cat <<EOF

Multilogin Guardian is installed at ${APP_DIR}.
The service was NOT enabled or started.

Next steps:
  1. Set the real automation token and review runtime rules:
       sudo nano ${APP_DIR}/config.json
     (Re-running setup preserves this file. Keep its permissions at 600.)

  2. Enable and start the daemon:
       sudo systemctl enable --now ${SERVICE_NAME}

  3. Check status and follow logs:
       sudo systemctl status ${SERVICE_NAME}
       sudo journalctl -u ${SERVICE_NAME} -f

  4. After later config.json changes, reload without restarting:
       sudo systemctl reload ${SERVICE_NAME}

Use a no_exp automation token with cloud-phone API access. Stop commands are real.
EOF
