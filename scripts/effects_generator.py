#!/usr/bin/env python3
import os
import sys
import math
import random
import subprocess

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
        img = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
        fade_height = 450
        start_y = 1280 - fade_height
        for y in range(start_y, 1280):
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
        max_r = (cx**2 + cy**2)**0.5
        for y in range(1280):
            for x in range(720):
                r = ((x - cx)**2 + (y - cy)**2)**0.5
                if r > 250:
                    ratio = (r - 250) / (max_r - 250)
                    opacity = int(ratio * 150)
                    img.putpixel((x, y), (0, 0, 0, min(opacity, 150)))
        img.save(radial_path, "PNG")
        print(f"[+] Radial vignette generated at: {radial_path}")
    else:
        print("[+] Radial vignette already exists.")

    # 3. Sunset Glow PNG (warm sun flare top-left corner)
    sunset_path = os.path.join(output_dir, "sunset_glow.png")
    if not os.path.exists(sunset_path):
        print("[*] Generating sunset lens flare...")
        img = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
        cx, cy = 0, 0
        max_r = 600.0
        for y in range(int(max_r)):
            for x in range(int(max_r)):
                if x < 720 and y < 1280:
                    r = (x**2 + y**2)**0.5
                    if r < max_r:
                        ratio = r / max_r
                        factor = (1.0 - ratio) ** 2
                        r_color = 255
                        g_color = int(140 + factor * 60)
                        b_color = int(20 + factor * 30)
                        opacity = int(factor * 160)
                        img.putpixel((x, y), (r_color, g_color, b_color, opacity))
        img.save(sunset_path, "PNG")
        print(f"[+] Sunset glow generated at: {sunset_path}")
    else:
        print("[+] Sunset glow already exists.")

    # 4. Emerald Deep Green Vignette PNG
    emerald_path = os.path.join(output_dir, "emerald_fade.png")
    if not os.path.exists(emerald_path):
        print("[*] Generating emerald deep green vignette...")
        img = Image.new("RGBA", (720, 1280), (0, 0, 0, 0))
        cx, cy = 360, 640
        max_r = (cx**2 + cy**2)**0.5
        for y in range(1280):
            for x in range(720):
                r = ((x - cx)**2 + (y - cy)**2)**0.5
                if r > 200:
                    ratio = (r - 200) / (max_r - 200)
                    opacity = int(ratio * 140)
                    img.putpixel((x, y), (5, 28, 15, min(opacity, 140)))
        img.save(emerald_path, "PNG")
        print(f"[+] Emerald vignette generated at: {emerald_path}")
    else:
        print("[+] Emerald vignette already exists.")

def make_blurred_particle(r, b, rgb, alpha):
    from PIL import Image, ImageDraw, ImageFilter
    w = 2 * r + 4 * b + 4
    if w % 2 != 0: w += 1
    sprite = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    draw = ImageDraw.Draw(sprite)
    cx = w // 2
    cy = w // 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(rgb[0], rgb[1], rgb[2], alpha))
    if b > 0:
        sprite = sprite.filter(ImageFilter.GaussianBlur(b))
    return sprite

def generate_particle_video(output_path, particle_type, width=720, height=1280, fps=25, duration=5):
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError:
        print("[-] Pillow is not installed. Skipping particle generation.")
        return

    print(f"[*] Pre-rendering particle overlay: {particle_type} -> {output_path}...")
    
    total_frames = int(fps * duration)
    particles = []
    
    if particle_type == "gold_dust.mp4":
        # ~80 small golden floating particles moving upwards
        for _ in range(85):
            r = random.randint(1, 3)
            b = random.randint(0, 1)
            alpha = random.randint(80, 180)
            sprite = make_blurred_particle(r, b, (255, 190, 50), alpha)
            particles.append({
                'x': random.uniform(0, width),
                'y': random.uniform(0, height),
                'vy': -random.uniform(2.0, 5.0),
                'vx_amp': random.uniform(0.5, 1.5),
                'vx_freq': random.uniform(0.02, 0.08),
                'vx_phase': random.uniform(0, 2 * math.pi),
                'sprite': sprite
            })
            
    elif particle_type == "bokeh.mp4":
        # ~15 large amber blurred bokeh circles moving slowly upwards
        for _ in range(15):
            r = random.randint(20, 45)
            b = random.randint(8, 15)
            alpha = random.randint(15, 30)
            sprite = make_blurred_particle(r, b, (255, 170, 30), alpha)
            particles.append({
                'x': random.uniform(-50, width + 50),
                'y': random.uniform(0, height),
                'vy': -random.uniform(0.8, 2.2),
                'vx_amp': random.uniform(0.2, 0.8),
                'vx_freq': random.uniform(0.005, 0.02),
                'vx_phase': random.uniform(0, 2 * math.pi),
                'sprite': sprite
            })
            
    elif particle_type == "fireflies.mp4":
        # ~25 lime-green glowing bugs with wandering Brownian motion
        for _ in range(25):
            # Combined sprite: green glow + bright core
            sprite = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
            draw = ImageDraw.Draw(sprite)
            draw.ellipse([16-8, 16-8, 16+8, 16+8], fill=(100, 230, 30, 85))
            sprite = sprite.filter(ImageFilter.GaussianBlur(3))
            
            draw_core = ImageDraw.Draw(sprite)
            draw_core.ellipse([16-2, 16-2, 16+2, 16+2], fill=(180, 255, 50, 255))
            
            particles.append({
                'x': random.uniform(0, width),
                'y': random.uniform(0, height),
                'vx': random.uniform(-2, 2),
                'vy': random.uniform(-2, -0.5),
                'sprite': sprite
            })
            
    elif particle_type == "snow.mp4":
        # ~100 white falling flakes
        for _ in range(95):
            r = random.randint(1, 4)
            b = random.randint(0, 1)
            alpha = random.randint(100, 220)
            sprite = make_blurred_particle(r, b, (240, 245, 255), alpha)
            particles.append({
                'x': random.uniform(0, width),
                'y': random.uniform(-50, height),
                'vy': random.uniform(3.0, 6.0),
                'vx_amp': random.uniform(1.0, 3.5),
                'vx_freq': random.uniform(0.03, 0.09),
                'vx_phase': random.uniform(0, 2 * math.pi),
                'sprite': sprite
            })
    else:
        print(f"[-] Unknown particle type: {particle_type}")
        return

    # Start ffmpeg process
    cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', f'{width}x{height}',
        '-pix_fmt', 'rgb24',
        '-r', str(fps),
        '-i', '-',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'superfast',
        '-crf', '24',
        output_path
    ]
    
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    try:
        for frame_idx in range(total_frames):
            frame_img = Image.new("RGB", (width, height), (0, 0, 0))
            
            for p in particles:
                if particle_type == "gold_dust.mp4":
                    p['y'] += p['vy']
                    p['x'] += p['vx_amp'] * math.sin(frame_idx * p['vx_freq'] + p['vx_phase'])
                    if p['y'] < -20:
                        p['y'] = height + 10
                        p['x'] = random.uniform(0, width)
                        
                elif particle_type == "bokeh.mp4":
                    p['y'] += p['vy']
                    p['x'] += p['vx_amp'] * math.sin(frame_idx * p['vx_freq'] + p['vx_phase'])
                    if p['y'] < -100:
                        p['y'] = height + 50
                        p['x'] = random.uniform(-50, width + 50)
                        
                elif particle_type == "fireflies.mp4":
                    p['vx'] += random.uniform(-0.4, 0.4)
                    p['vy'] += random.uniform(-0.4, 0.4)
                    p['vx'] = max(-2.5, min(2.5, p['vx']))
                    p['vy'] = max(-2.5, min(2.5, p['vy']))
                    p['vy'] -= 0.05
                    p['x'] += p['vx']
                    p['y'] += p['vy']
                    
                    if p['x'] < -10: p['x'] = width + 5
                    elif p['x'] > width + 10: p['x'] = -5
                    if p['y'] < -10: p['y'] = height + 5
                    elif p['y'] > height + 10: p['y'] = -5
                    
                elif particle_type == "snow.mp4":
                    p['y'] += p['vy']
                    p['x'] += p['vx_amp'] * math.sin(frame_idx * p['vx_freq'] + p['vx_phase'])
                    if p['y'] > height + 10:
                        p['y'] = -20
                        p['x'] = random.uniform(0, width)
                
                sw, sh = p['sprite'].size
                px = int(p['x'] - sw // 2)
                py = int(p['y'] - sh // 2)
                frame_img.paste(p['sprite'], (px, py), p['sprite'])
                
            process.stdin.write(frame_img.tobytes())
            
        process.stdin.close()
        process.wait()
        print(f"[+] Particle overlay generated at: {output_path}")
    except Exception as e:
        print(f"[-] Failed to generate particle overlay '{particle_type}': {e}")
        if process.stdin:
            try: process.stdin.close()
            except: pass
        process.wait()

def generate_all(output_dir="public/uploads/effects"):
    # 1. Vignettes
    generate_vignettes(output_dir)
    
    # 2. Particles
    particles = ["gold_dust.mp4", "bokeh.mp4", "fireflies.mp4", "snow.mp4"]
    for p in particles:
        p_path = os.path.join(output_dir, p)
        if not os.path.exists(p_path):
            generate_particle_video(p_path, p)
        else:
            print(f"[+] Particle overlay {p} already exists.")

if __name__ == "__main__":
    generate_all()
