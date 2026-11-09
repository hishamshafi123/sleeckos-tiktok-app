#!/usr/bin/python3
"""Run the Content Desk worker without putting its secret in process arguments.
Install root-owned mode 700 at /usr/local/sbin/sleeckos-content-desk-sync.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

container_name = os.environ.get("SLEECKOS_CONTAINER", "sleeckos-tiktok-app-app-1")
inspection = subprocess.run(["docker", "inspect", container_name], capture_output=True, text=True, check=True)
container = json.loads(inspection.stdout)[0]
env = dict(item.split("=", 1) for item in container["Config"]["Env"] if "=" in item)
secret = env.get("CRON_SECRET")
if not secret:
    sys.exit("Content Desk: CRON_SECRET is missing")
port = env.get("PORT", "3001")
if not port.isdigit() or not 1 <= int(port) <= 65535:
    sys.exit("Content Desk: invalid app port")
config = "\n".join([
    'url = "http://127.0.0.1:' + port + '/api/cron/content-desk"',
    "header = " + json.dumps("x-cron-secret: " + secret),
    "connect-timeout = 10", "max-time = 590", "silent", "show-error", "fail-with-body",
])
print(datetime.now(timezone.utc).isoformat(), "Content Desk collection", flush=True)
result = subprocess.run(["curl", "--config", "-"], input=config, text=True)
print(flush=True)
sys.exit(result.returncode)
