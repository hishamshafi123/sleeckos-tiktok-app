#!/usr/bin/env python3
import os
import sys

def generate_vignettes(output_dir="public/uploads/effects"):
    try:
        from PIL import Image
    except ImportError:
        print("[-] Pillow is not installed. Skipping image generation.")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    
    # 1. Bottom Fade Gradient PNG (captions legibility backing)
    bottom_fade_path = os.path.join(output_dir, "bottom_fade.png")
    if not os.path.exists(bottom_fade_path):
        print("[*] Generating bottom fade legibility vignette...")
        # Create clear RGBA canvas
        img = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
        # Smoothly interpolate the bottom 450 pixels to semi-transparent black
        fade_height = 450
        start_y = 1280 - fade_height
        for y in range(start_y, 1280):
            # Opacity scales from 0 (at start_y) up to 215/255 (at bottom) for rich contrast
            ratio = (y - start_y) / float(fade_height)
            opacity = int(ratio * 215)
            for x in range(720):
                img.putpixel((x, y), (0, 0, 0, opacity))
        img.save(bottom_fade_path, "PNG")
        print(f"[+] Bottom fade generated at: {bottom_fade_path}")
    else:
        print("[+] Bottom fade vignette already exists.")

    # 2. Radial Cinematic Vignette PNG
    radial_path = os.path.join(output_dir, "radial_vignette.png")
    if not os.path.exists(radial_path):
        print("[*] Generating radial cinematic vignette...")
        img = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
        cx, cy = 360, 640
        # Maximum radius to corner
        max_r = (cx**2 + cy**2)**0.5
        for y in range(1280):
            for x in range(720):
                # Distance from center
                r = ((x - cx)**2 + (y - cy)**2)**0.5
                if r > 250:
                    # Fade to black smoothly towards borders (max opacity 150/255 for aesthetic subtlety)
                    ratio = (r - 250) / (max_r - 250)
                    opacity = int(ratio * 150)
                    img.putpixel((x, y), (0, 0, 0, min(opacity, 150)))
        img.save(radial_path, "PNG")
        print(f"[+] Radial vignette generated at: {radial_path}")
    else:
        print("[+] Radial vignette already exists.")

if __name__ == "__main__":
    generate_vignettes()
