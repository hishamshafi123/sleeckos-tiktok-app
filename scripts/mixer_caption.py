"""Deterministic caption measurement and transparent PNGs; JSON in/out, no shell text."""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter


def caption(item):
    if not os.path.isfile(item["font"]):
        raise ValueError("Selected font file is missing. Restore it before rendering.")
    text = item["text"].strip()
    width, height = 1080, 1920
    safe_x, safe_y, safe_w, safe_h = 130, 308, 644, 842
    # Fit the complete glyph/shadow extent; never truncate or silently change text.
    lines = None
    for size in range(round(item["size"]), 39, -1):
        font = ImageFont.truetype(item["font"], size)
        candidate = []
        too_wide = False
        for paragraph in text.split("\n"):
            current = ""
            for word in paragraph.split():
                if font.getlength(word) > safe_w - 16:
                    too_wide = True
                    break
                trial = (current + " " + word).strip()
                if current and font.getlength(trial) > safe_w - 16:
                    candidate.append(current)
                    current = word
                else:
                    current = trial
            candidate.append(current)
        line_height = round(size * 1.22)
        block_h = len(candidate) * line_height
        if not too_wide and len(candidate) <= 6 and block_h <= 430:
            lines = candidate
            break
    if lines is None:
        raise ValueError("Text does not fit the safe area at a readable size. Shorten it or split it into separate texts.")
    center_y = 530 if item["position"] == "upper" else 920
    y = max(safe_y + 8, min(center_y - block_h // 2, safe_y + safe_h - block_h - 8))
    ink = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ink)
    for i, line in enumerate(lines):
        line_width = font.getlength(line)
        x = safe_x + 8 if item["align"] == "left" else safe_x + (safe_w - line_width) / 2
        draw.text((x, y + i * line_height), line, font=font, fill=(255, 255, 255, 255), anchor="lt")
    alpha = ink.getchannel("A")
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shadow_alpha = Image.new("L", (width, height), 0)
    shadow_alpha.paste(alpha, (2, 2))
    shadow.putalpha(shadow_alpha.filter(ImageFilter.GaussianBlur(2)).point(lambda v: round(v * .65)))
    result = Image.alpha_composite(shadow, ink)
    bounds = result.getbbox()
    if not bounds or bounds[0] < safe_x or bounds[1] < safe_y or bounds[2] > safe_x + safe_w or bounds[3] > safe_y + safe_h:
        raise ValueError("Text exceeds the safe area. Choose a shorter text or smaller type.")
    os.makedirs(os.path.dirname(item["output"]), exist_ok=True)
    temporary = item["output"] + "." + str(os.getpid()) + ".tmp"
    result.save(temporary, format="PNG")
    os.replace(temporary, item["output"])
    return {"fontSize": size, "lines": lines, "box": {"x": bounds[0], "y": bounds[1], "width": bounds[2] - bounds[0], "height": bounds[3] - bounds[1]}}


results = []
for item in json.load(sys.stdin):
    try:
        results.append({"key": item["key"], **caption(item)})
    except Exception as error:
        results.append({"key": item["key"], "error": str(error)})
json.dump(results, sys.stdout)
