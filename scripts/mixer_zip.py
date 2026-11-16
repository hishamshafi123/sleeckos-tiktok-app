"""Stream a ZIP of server-validated completed outputs without a second disk copy."""
import json
import sys
import zipfile

with zipfile.ZipFile(sys.stdout.buffer, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
    for item in json.load(sys.stdin):
        archive.write(item["path"], arcname=item["name"])
