#!/usr/bin/env python3
import os
import sys
import argparse
from PIL import Image, ImageDraw, ImageFont

def resolve_font():
    cache_dir = "public/fonts"
    os.makedirs(cache_dir, exist_ok=True)
    font_path = os.path.join(cache_dir, "Inter-Bold.ttf")
    if os.path.exists(font_path):
        return font_path

    # Try downloading Inter-Bold from Google Fonts repository
    url = "https://github.com/google/fonts/raw/main/ofl/inter/Inter-Bold.ttf"
    try:
        import urllib.request
        import shutil
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        )
        with urllib.request.urlopen(req) as response, open(font_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        return font_path
    except Exception:
        pass

    # macOS and Linux fallbacks
    fallbacks = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf"
    ]
    for p in fallbacks:
        if os.path.exists(p):
            return p
    return None

def generate_watermark(handle, output_path):
    if not handle.startswith("@"):
        handle = "@" + handle

    # Resolve font
    font_file = resolve_font()
    font_size = 20
    if font_file:
        try:
            font = ImageFont.truetype(font_file, font_size)
        except Exception:
            font = ImageFont.load_default()
    else:
        font = ImageFont.load_default()

    # Calculate text dimensions
    # Support Pillow < 10.0 and >= 10.0
    if hasattr(font, "getbbox"):
        bbox = font.getbbox(handle)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    else:
        text_w, text_h = font.getsize(handle)

    # Padding inside the badge
    pad_x = 24
    pad_y = 12
    icon_width = 24  
    spacing = 10

    badge_w = pad_x * 2 + icon_width + spacing + text_w
    badge_h = pad_y * 2 + max(20, text_h)

    # Create RGBA image
    img = Image.new("RGBA", (badge_w, badge_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw rounded rectangle background (semi-transparent dark)
    # R=15, G=15, B=15, Alpha=130 (glassmorphic dark backdrop)
    draw.rounded_rectangle(
        [(0, 0), (badge_w - 1, badge_h - 1)],
        radius=14,
        fill=(15, 15, 15, 130),
        outline=(255, 255, 255, 45), # Elegant thin glass glow border
        width=1
    )

    # Draw a stylized icon (musical note with purple-pink color theme)
    icon_cy = badge_h // 2
    circle_r = 5
    circle_cx = pad_x + circle_r
    circle_cy = icon_cy + 4
    draw.ellipse(
        [(circle_cx - circle_r, circle_cy - circle_r), (circle_cx + circle_r, circle_cy + circle_r)],
        fill=(147, 51, 234, 230),  # Pulsing bright purple
    )
    # Stem
    draw.line(
        [(circle_cx + circle_r - 2, circle_cy), (circle_cx + circle_r - 2, icon_cy - 8)],
        fill=(236, 72, 153, 230),  # Pulsing hot pink
        width=2
    )
    # Flag
    draw.line(
        [(circle_cx + circle_r - 2, icon_cy - 8), (circle_cx + circle_r + 5, icon_cy - 6)],
        fill=(236, 72, 153, 230),
        width=2
    )

    # Draw handle text (elegant soft white with a subtle glow)
    text_x = pad_x + icon_width + spacing
    text_y = (badge_h - text_h) // 2 - 2  # Vertically centered
    
    draw.text((text_x, text_y), handle, fill=(255, 255, 255, 230), font=font)

    # Save PNG
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path, "PNG")
    print(f"[+] Watermark generated: {output_path} ({badge_w}x{badge_h})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--handle", required=True, help="TikTok user handle, e.g. @stoic_wisdom")
    parser.add_argument("--output", required=True, help="Output PNG file path")
    args = parser.parse_args()
    generate_watermark(args.handle, args.output)
