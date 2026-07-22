#!/usr/bin/env python3
"""Build self-hosted static font set for SleeckOS music niche.

Sources: github.com/google/fonts (OFL-licensed).
- Families with repo statics (Barlow, Barlow Condensed, Anton) are copied as-is.
- Variable-only families are instanced with fontTools varLib.instancer,
  pinning ALL axes so outputs are fully static (no fvar) — required by
  FFmpeg drawtext / Pillow which cannot select variation axes.
"""
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS_DIR = os.path.join(ROOT, "public", "fonts")
VAR_DIR = os.path.join(ROOT, "scratch", "fonts_var")
os.makedirs(VAR_DIR, exist_ok=True)

GH = "https://raw.githubusercontent.com/google/fonts/main/ofl"

WEIGHT_NAMES = {
    100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular",
    500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black",
}

# Families whose repo directory contains ready-made static TTFs.
# (slug, family-prefix, {weight: repo-file}, dest-name-fn)
DIRECT = {
    "barlow": ("barlow", {400: "Barlow-Regular.ttf", 600: "Barlow-SemiBold.ttf",
                          700: "Barlow-Bold.ttf", 800: "Barlow-ExtraBold.ttf"}),
    "barlowcondensed": ("barlowcondensed", {500: "BarlowCondensed-Medium.ttf",
                                            600: "BarlowCondensed-SemiBold.ttf",
                                            700: "BarlowCondensed-Bold.ttf"}),
    "anton": ("anton", {400: "Anton-Regular.ttf"}),
}

# Variable-only families: slug -> (repo dir, variable file, axes to pin besides wght,
#                                   prefix for output names, weights, italic weights)
VARIABLE = {
    "inter": ("inter", "Inter[opsz,wght].ttf", {"opsz": 14}, "Inter",
              [100, 200, 300, 400, 500, 600, 700, 800, 900], []),
    "ibmplexsans": ("ibmplexsans", "IBMPlexSans[wdth,wght].ttf", {"wdth": 100}, "IBMPlexSans",
                    [400, 500, 600, 700], []),
    "archivo": ("archivo", "Archivo[wdth,wght].ttf", {"wdth": 100}, "Archivo",
                [400, 600, 700, 800, 900], []),
    "oswald": ("oswald", "Oswald[wght].ttf", {}, "Oswald",
               [400, 500, 600, 700], []),
    "publicsans": ("publicsans", "PublicSans[wght].ttf", {}, "PublicSans",
                   [400, 600, 700, 800, 900], []),
    "librefranklin": ("librefranklin", "LibreFranklin[wght].ttf", {}, "LibreFranklin",
                      [400, 600, 700, 800, 900], []),
    "sourcesans3": ("sourcesans3", "SourceSans3[wght].ttf", {}, "SourceSans3",
                    [400, 600, 700, 900], []),
}

# Italic variable fonts (only Public Sans per spec: italic 400, 700)
VARIABLE_ITALIC = {
    "publicsans": ("publicsans", "PublicSans-Italic[wght].ttf", {}, "PublicSans", [400, 700]),
}

MIN_SIZE = 5000


def valid_ttf(path: str) -> bool:
    if not os.path.exists(path) or os.path.getsize(path) < MIN_SIZE:
        return False
    with open(path, "rb") as f:
        magic = f.read(4)
    return magic in (b"\x00\x01\x00\x00", b"OTTO")


def download(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if len(data) < MIN_SIZE:
        raise RuntimeError(f"download too small ({len(data)} B): {url}")
    with open(dest, "wb") as f:
        f.write(data)


def dest_path(slug: str, prefix: str, weight: int, italic: bool = False) -> str:
    if italic:
        suffix = "Italic" if weight == 400 else f"{WEIGHT_NAMES[weight]}Italic"
    else:
        suffix = WEIGHT_NAMES[weight]
    return os.path.join(FONTS_DIR, slug, f"{prefix}-{suffix}.ttf")


def instance(var_path: str, axes: dict, out_path: str) -> None:
    axis_args = [f"{k}={v}" for k, v in axes.items()]
    cmd = [sys.executable, "-m", "fontTools.varLib.instancer", var_path,
           *axis_args, "-o", out_path, "--update-name-table"]
    subprocess.run(cmd, check=True, capture_output=True)


def main() -> None:
    written, failed = [], []

    # 1) Direct statics
    for slug, (repo, files) in DIRECT.items():
        os.makedirs(os.path.join(FONTS_DIR, slug), exist_ok=True)
        for weight, fname in sorted(files.items()):
            dest = dest_path(slug, fname.split("-")[0], weight)
            try:
                download(f"{GH}/{repo}/{fname}", dest)
                written.append(dest)
            except Exception as e:  # noqa: BLE001
                failed.append((dest, str(e)))

    # 2) Variable -> static instances (upright)
    for slug, (repo, varfile, fixed, prefix, weights, _ital) in VARIABLE.items():
        os.makedirs(os.path.join(FONTS_DIR, slug), exist_ok=True)
        var_path = os.path.join(VAR_DIR, varfile.replace("[", "_").replace("]", "_"))
        if not os.path.exists(var_path):
            try:
                download(f"{GH}/{repo}/{urllib.request.quote(varfile)}", var_path)
            except Exception as e:  # noqa: BLE001
                failed.append((slug, f"variable download failed: {e}"))
                continue
        for w in weights:
            dest = dest_path(slug, prefix, w)
            try:
                instance(var_path, {**fixed, "wght": w}, dest)
                written.append(dest)
            except Exception as e:  # noqa: BLE001
                failed.append((dest, str(e)))

    # 3) Variable -> static instances (italic)
    for slug, (repo, varfile, fixed, prefix, weights) in VARIABLE_ITALIC.items():
        var_path = os.path.join(VAR_DIR, varfile.replace("[", "_").replace("]", "_"))
        if not os.path.exists(var_path):
            try:
                download(f"{GH}/{repo}/{urllib.request.quote(varfile)}", var_path)
            except Exception as e:  # noqa: BLE001
                failed.append((slug, f"italic variable download failed: {e}"))
                continue
        for w in weights:
            dest = dest_path(slug, prefix, w, italic=True)
            try:
                instance(var_path, {**fixed, "wght": w}, dest)
                written.append(dest)
            except Exception as e:  # noqa: BLE001
                failed.append((dest, str(e)))

    # 4) Validate everything on disk
    bad = [p for p in written if not valid_ttf(p)]
    for p in bad:
        failed.append((p, "invalid TTF magic/size after write"))
    ok = [p for p in written if p not in bad]

    total_bytes = sum(os.path.getsize(p) for p in ok)
    print(f"\n✅ {len(ok)} font files written ({total_bytes/1024/1024:.1f} MB)")
    for p in ok:
        rel = os.path.relpath(p, FONTS_DIR)
        print(f"   {rel}  {os.path.getsize(p)//1024} KB")
    if failed:
        print(f"\n❌ {len(failed)} failures:")
        for p, err in failed:
            print(f"   {p}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
