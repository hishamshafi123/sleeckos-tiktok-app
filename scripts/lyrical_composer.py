#!/usr/bin/env python3
"""
Sleeckos TikTok App - Lyrical Video Auto-Composer Script
Automates the creation of music/lyrical videos with dynamic, kinetic, word-level synchronized captions.

Requirements:
    pip install stable-ts faster-whisper moviepy pillow numpy torch

Author: Expert Python Automation Developer
"""

import os
import sys
import json
import argparse
import tempfile
import shutil
import time

# ==============================================================================
# 1. DEPENDENCY & ENVIRONMENT DIAGNOSTICS
# ==============================================================================
def check_dependencies():
    """Validates that all required third-party libraries are installed."""
    missing = []
    
    try:
        import stable_whisper
    except ImportError:
        missing.append("stable-ts")
        
    try:
        import moviepy
    except ImportError:
        missing.append("moviepy")
        
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        missing.append("pillow")
        
    try:
        import numpy
    except ImportError:
        missing.append("numpy")
        
    if missing:
        print("[!] Missing required Python dependencies!", file=sys.stderr)
        print("Please install them by running the following command:", file=sys.stderr)
        print(f"    pip install {' '.join(missing)} faster-whisper", file=sys.stderr)
        sys.exit(1)

# Run dependency check immediately upon execution
check_dependencies()

import numpy as np
import stable_whisper
from PIL import Image, ImageDraw, ImageFont

# MoviePy v1.x vs v2.x multi-version compatibility layer
try:
    from moviepy.editor import VideoFileClip, AudioFileClip, ImageClip, CompositeVideoClip
except ImportError:
    try:
        from moviepy import VideoFileClip, AudioFileClip, ImageClip, CompositeVideoClip
    except ImportError as e:
        print(f"[!] Critical Import Error: MoviePy is installed but could not be imported: {e}", file=sys.stderr)
        sys.exit(1)

# Verify FFmpeg is on PATH
if not shutil.which("ffmpeg"):
    print("[!] Warning: FFmpeg executable was not found on your system PATH.", file=sys.stderr)
    print("MoviePy requires FFmpeg to render videos. Please install it on your system.", file=sys.stderr)

# ==============================================================================
# 2. UTILITY & TYPOGRAPHY FUNCTIONS
# ==============================================================================
def loop_video_clip(bg_source, duration):
    """Compatible loop method for MoviePy v1.x and v2.x."""
    try:
        from moviepy.video.fx.all import loop
        return loop(bg_source, duration=duration)
    except ImportError:
        try:
            from moviepy.video.fx import loop
            return loop(bg_source, duration=duration)
        except ImportError:
            # MoviePy v2.x Clip built-in method
            if hasattr(bg_source, "loop"):
                return bg_source.loop(duration=duration)
            else:
                # Fallback manual repetition
                print("[*] Warning: loop fx not found, falling back to simple duration clamping.")
                return bg_source.with_duration(duration)

def resize_video_clip(clip, width, height):
    """Compatible resize method for MoviePy v1.x and v2.x."""
    try:
        if hasattr(clip, "resize"):
            return clip.resize(newsize=(width, height))
        elif hasattr(clip, "resized"):
            return clip.resized(newsize=(width, height))
    except Exception as e:
        print(f"[*] Warning: Resize failed: {e}. Keeping original size.")
    return clip

def crop_to_fill_video_clip(clip, width, height):
    """Resizes and crops a MoviePy clip to cover (fill) the target size without stretching."""
    try:
        # Calculate scale factor to cover the target box (cover aspect fit)
        scale_w = width / clip.w
        scale_h = height / clip.h
        scale_factor = max(scale_w, scale_h)
        
        new_w = int(clip.w * scale_factor)
        new_h = int(clip.h * scale_factor)
        
        # Resize first
        if hasattr(clip, "resize"):
            resized_clip = clip.resize(newsize=(new_w, new_h))
        elif hasattr(clip, "resized"):
            resized_clip = clip.resized(newsize=(new_w, new_h))
        else:
            resized_clip = clip
            
        # Center crop to cover width and height
        x1 = (new_w - width) // 2
        y1 = (new_h - height) // 2
        x2 = x1 + width
        y2 = y1 + height
        
        # Try multiple crop options for multi-version compatibility
        try:
            from moviepy.video.fx.all import crop
            return crop(resized_clip, x1=x1, y1=y1, x2=x2, y2=y2)
        except ImportError:
            try:
                from moviepy.video.fx.crop import crop
                return crop(resized_clip, x1=x1, y1=y1, x2=x2, y2=y2)
            except ImportError:
                try:
                    from moviepy.video.fx import crop
                    return crop(resized_clip, x1=x1, y1=y1, x2=x2, y2=y2)
                except ImportError:
                    if hasattr(resized_clip, "crop"):
                        return resized_clip.crop(x1=x1, y1=y1, x2=x2, y2=y2)
                    elif hasattr(resized_clip, "cropped"):
                        return resized_clip.cropped(x1=x1, y1=y1, x2=x2, y2=y2)
    except Exception as e:
        print(f"[*] Warning: Crop to fill failed: {e}. Falling back to standard resize.")
        return resize_video_clip(clip, width, height)
    return clip

def ensure_font(font_path_or_name):
    """
    Checks if a custom font is present or system fallbacks.
    If 'montserrat' is requested, it can dynamically pull it from a raw GitHub repo to cache locally.
    """
    # 1. Check direct file path if it exists
    if os.path.exists(font_path_or_name):
        return font_path_or_name
        
    # 2. Check under public/fonts/ in current directory (e.g., inside Docker container or local workspace)
    public_fonts_dir = os.path.join(os.getcwd(), "public", "fonts")
    
    # Try variations in public/fonts
    variations = [
        font_path_or_name,
        f"{font_path_or_name}.ttf",
        f"{font_path_or_name.replace('-Bold', '')}.ttf",
        f"{font_path_or_name.replace('-Black', '')}.ttf"
    ]
    for var in variations:
        path_in_public = os.path.join(public_fonts_dir, var)
        if os.path.exists(path_in_public):
            print(f"[+] Found baked-in font: {path_in_public}")
            return path_in_public

    # 3. Determine cache directory: prefer public/fonts if writable, fallback to a writable tmp directory
    cache_dir = public_fonts_dir
    if not os.path.exists(cache_dir):
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            cache_dir = os.path.join(tempfile.gettempdir(), "sleeckos_fonts")
            os.makedirs(cache_dir, exist_ok=True)
            
    # Check if cache_dir is writable by writing a small test file
    try:
        test_file = os.path.join(cache_dir, ".font_write_test")
        with open(test_file, "w") as f:
            f.write("test")
        os.unlink(test_file)
    except Exception:
        # If public/fonts is not writable, fall back to /tmp/sleeckos_fonts
        cache_dir = os.path.join(tempfile.gettempdir(), "sleeckos_fonts")
        os.makedirs(cache_dir, exist_ok=True)

    cache_path = os.path.join(cache_dir, f"{font_path_or_name}.ttf")
    if os.path.exists(cache_path):
        return cache_path

    # Direct fetch utility for Montserrat-Black or Montserrat if specified and not found
    if "montserrat" in font_path_or_name.lower():
        url = "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-Black.ttf"
        print(f"[*] Cache miss. Downloading '{font_path_or_name}' dynamically from: {url}")
        try:
            import urllib.request
            req = urllib.request.Request(
                url, 
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
            )
            with urllib.request.urlopen(req) as response, open(cache_path, 'wb') as out_file:
                shutil.copyfileobj(response, out_file)
            print(f"[+] Premium font cached successfully at {cache_path}")
            return cache_path
        except Exception as e:
            print(f"[-] Failed to download font: {e}. Falling back to system fonts.")
            
    # Standard Operating System Fallbacks
    fallbacks = []
    if sys.platform == "darwin":  # macOS
        fallbacks = [
            "/Library/Fonts/Arial Black.ttf",
            "/Library/Fonts/Impact.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Courier New.ttf"
        ]
    elif sys.platform.startswith("linux"):
        fallbacks = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/msttcorefonts/Arial_Black.ttf"
        ]
    elif sys.platform == "win32":
        fallbacks = [
            "C:\\Windows\\Fonts\\ariblk.ttf",
            "C:\\Windows\\Fonts\\impact.ttf",
            "C:\\Windows\\Fonts\\arial.ttf"
        ]
        
    for p in fallbacks:
        if os.path.exists(p):
            print(f"[*] Fallback system font selected: {p}")
            return p
            
    print("[!] No local system bold fonts found. PIL will fall back to its internal standard font.", file=sys.stderr)
    return None

def parse_hex_color(hex_str):
    """Converts hex strings (#FFFF00) to RGBA tuples."""
    hex_str = hex_str.lstrip('#')
    try:
        if len(hex_str) == 6:
            r, g, b = tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))
            return (r, g, b, 255)
        elif len(hex_str) == 8:
            return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4, 6))
    except ValueError:
        pass
    return (255, 255, 0, 255) # default neon yellow fallback

# ==============================================================================
# 3. TRANSCRIPTION & CAPTION CHUNKING LAYER
# ==============================================================================
def transcribe_audio(media_path, model_size="base", device="cpu"):
    """
    Uses stable-ts combined with faster-whisper to extract exact word-level
    timestamps, preventing drifting during musical intros or instrumentals.
    """
    print(f"[*] Initializing stable-ts with faster-whisper backend (Model: '{model_size}', Device: '{device}')...")
    
    # Select appropriate compute type
    compute_type = "float16" if device == "cuda" else "int8"
    
    # Load model
    model = stable_whisper.load_faster_whisper(model_size, device=device, compute_type=compute_type)
    
    print(f"[*] Transcribing audio track from: {media_path}")
    start_time = time.time()
    
    # Transcribe with stable alignment
    result = model.transcribe_stable(media_path)
    
    duration = time.time() - start_time
    print(f"[+] Transcription complete in {duration:.2f} seconds!")
    
    # Flatten segment words into structured JSON
    word_timestamps = []
    for segment in result.segments:
        for word in segment.words:
            # Clean punctuation and trailing whitespaces
            clean_word = word.word.strip()
            if clean_word:
                word_timestamps.append({
                    "word": clean_word,
                    "start": round(word.start, 3),
                    "end": round(word.end, 3)
                })
                
    return word_timestamps

def chunk_words(word_list, max_words=3, max_silence_gap=1.5):
    """
    Groups words into small, high-impact aesthetic chunks (max 1 to 3 words).
    Ensures silent gaps in music cleanly terminate chunks to prevent ghost text.
    """
    chunks = []
    current_chunk = []
    
    for word in word_list:
        if not current_chunk:
            current_chunk.append(word)
        else:
            # Check for silences/instrumentals between adjacent words
            gap = word['start'] - current_chunk[-1]['end']
            if len(current_chunk) >= max_words or gap > max_silence_gap:
                chunks.append(current_chunk)
                current_chunk = [word]
            else:
                current_chunk.append(word)
                
    if current_chunk:
        chunks.append(current_chunk)
        
    return chunks

def chunk_phrases(words, max_silence_gap=1.5, max_words=12):
    """
    Groups words into phrase-level segments for Brat/Word Builder progressive animation.
    Terminates phrase on silence gaps greater than max_silence_gap or when reaching max_words.
    """
    phrases = []
    current = []
    last_end = 0
    for w in words:
        if current and (w['start'] - last_end > max_silence_gap or len(current) >= max_words):
            phrases.append(current)
            current = []
        current.append(w)
        last_end = w['end']
    if current:
        phrases.append(current)
    return phrases

# ==============================================================================
# 4. RENDERING & ANIMATION LAYER (Pillow + MoviePy)
# ==============================================================================
def render_chunk_image(words, active_index, width, height, font_path, font_size, active_color, stroke_width, stroke_color, y_position):
    """
    Renders a single frame image containing the word chunk, centering all words,
    and scaling up the active word (1.15x) while painting it in neon active_color.
    All background pixels remain fully transparent (RGBA).
    """
    # Create empty transparent canvas
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Load fonts
    try:
        if font_path:
            font_regular = ImageFont.truetype(font_path, font_size)
            font_active = ImageFont.truetype(font_path, int(font_size * 1.15))
        else:
            font_regular = ImageFont.load_default()
            font_active = ImageFont.load_default()
    except Exception as e:
        print(f"[-] Font load error: {e}. Falling back to standard PIL font.")
        font_regular = ImageFont.load_default()
        font_active = ImageFont.load_default()
        
    # Word Spacing width multiplier based on size
    space_width = int(font_size * 0.40)
    
    # Measure width of all words in their regular state to establish a stable layout
    word_widths = []
    for w in words:
        if hasattr(font_regular, "getbbox"):
            bbox = font_regular.getbbox(w['word'])
            w_w = bbox[2] - bbox[0]
        else:
            # PIL older compatibility fallback
            w_w = draw.textlength(w['word'], font=font_regular)
        word_widths.append(max(w_w, 10))
        
    # Total resting width of chunk line
    total_width = sum(word_widths) + space_width * (len(words) - 1)
    
    # Centering math
    center_x = width / 2
    start_x = center_x - total_width / 2
    
    # Calculate fixed center point for each word so words don't jitter horizontally
    word_centers = []
    current_x = start_x
    for w_width in word_widths:
        w_center = current_x + w_width / 2
        word_centers.append(w_center)
        current_x += w_width + space_width
        
    # Draw each word in the chunk
    for idx, w in enumerate(words):
        word_text = w['word']
        is_active = (idx == active_index)
        
        # Style active vs inactive words
        if is_active:
            font = font_active
            # Use assigned word active_color (which can be a list cycle/rainbow)
            text_color = w.get("active_color", active_color)
        else:
            font = font_regular
            text_color = (255, 255, 255, 255) # white
            
        # Get exact dimensions of current word to offset drawing perfectly
        if hasattr(font, "getbbox"):
            bbox = font.getbbox(word_text)
            w_w = bbox[2] - bbox[0]
            w_h = bbox[3] - bbox[1]
        else:
            w_w = draw.textlength(word_text, font=font)
            w_h = font_size
            
        # Align center of word text on its fixed resting center
        draw_x = word_centers[idx] - w_w / 2
        draw_y = y_position - w_h / 2
        
        # 1. Subtle drop shadow
        shadow_offset = max(2, int(font_size * 0.08))
        shadow_color = (0, 0, 0, 180) # transparent black
        draw.text(
            (draw_x + shadow_offset, draw_y + shadow_offset),
            word_text,
            font=font,
            fill=shadow_color,
            stroke_width=stroke_width,
            stroke_fill=(0, 0, 0, 255)
        )
        
        # 2. Main foreground text + outline stroke
        draw.text(
            (draw_x, draw_y),
            word_text,
            font=font,
            fill=text_color,
            stroke_width=stroke_width,
            stroke_fill=stroke_color
        )
        
    return image

def get_text_width(text, font):
    """Measures horizontal text width in pixels using PIL ImageFont."""
    try:
        # For modern Pillow (>= 9.2.0)
        bbox = font.getbbox(text)
        return bbox[2] - bbox[0]
    except Exception:
        # Fallback for older Pillow
        return font.getsize(text)[0]

def estimate_space_width(font):
    return get_text_width(" ", font)

def get_wrapped_lines_py(words, font, max_width):
    lines = []
    current_line = []
    space_width = estimate_space_width(font)
    current_width = 0
    
    for word_text in words:
        word_width = get_text_width(word_text, font)
        if not current_line:
            current_line.append(word_text)
            current_width = word_width
        else:
            new_width = current_width + space_width + word_width
            if new_width <= max_width:
                current_line.append(word_text)
                current_width = new_width
            else:
                lines.append(current_line)
                current_line = [word_text]
                current_width = word_width
    if current_line:
        lines.append(current_line)
    return lines

def get_optimal_font_size_py(words, max_width, max_height, font_path, base_font_size):
    min_font = 20
    max_font = base_font_size
    best_size = min_font
    
    low = min_font
    high = max_font
    
    while low <= high:
        mid = (low + high) // 2
        try:
            font = ImageFont.truetype(font_path, mid)
        except Exception:
            font = ImageFont.load_default()
            
        # Check fit
        lines = get_wrapped_lines_py(words, font, max_width)
        line_height = mid * 1.15
        total_height = line_height * len(lines) + 10 * (len(lines) - 1)
        
        fits = True
        # Check if any word width itself exceeds max_width
        for w in words:
            if get_text_width(w, font) > max_width:
                fits = False
                break
                
        if fits and total_height <= max_height:
            best_size = mid
            low = mid + 1
        else:
            high = mid - 1
            
    return best_size

def calculate_word_positions_py(lines, font, fontSize, canvas_width, canvas_height, margin):
    target_width = canvas_width - 2 * margin
    start_x = margin
    start_y = int(canvas_height * 0.2)
    space_width = get_text_width(" ", font)
    line_height = fontSize * 1.15
    line_spacing = 10
    
    current_y = start_y
    word_positions = []
    
    for i, line_words in enumerate(lines):
        if not line_words:
            continue
            
        is_last_line = (i == len(lines) - 1)
        
        # Calculate natural width with normal spaces
        sum_word_w = 0
        word_widths = []
        for w in line_words:
            w_w = get_text_width(w, font)
            sum_word_w += w_w
            word_widths.append(w_w)
            
        normal_gap_w = (len(line_words) - 1) * space_width
        natural_width = sum_word_w + normal_gap_w
        
        # Threshold: if natural width > 85% of target width, justify it even if last line
        is_full_enough = (natural_width / target_width) > 0.85
        should_left_align = (is_last_line and not is_full_enough) or len(line_words) == 1
        
        if should_left_align:
            curr_x = start_x
            for j, w in enumerate(line_words):
                word_positions.append({
                    "text": w,
                    "x": int(curr_x),
                    "y": int(current_y),
                    "font_size": fontSize
                })
                curr_x += word_widths[j] + space_width
        else:
            # Justified alignment
            available_space = target_width - sum_word_w
            gap = (available_space / (len(line_words) - 1)) if len(line_words) > 1 else 0
            curr_x = start_x
            for j, w in enumerate(line_words):
                word_positions.append({
                    "text": w,
                    "x": int(curr_x),
                    "y": int(current_y),
                    "font_size": fontSize
                })
                curr_x += word_widths[j] + gap
                
        current_y += line_height + line_spacing
        
    return word_positions

def render_brat_image(words, width, height, font_path, font_size, text_color, stroke_width, stroke_color, text_margin, bg_color, bg_opacity):
    # Determine text color (default black if none)
    if not text_color:
        txt_rgba = (0, 0, 0, 255)
    else:
        txt_rgba = parse_hex_color(text_color)
        
    # Determine background color
    if bg_color and bg_color.lower() not in ["none", "transparent", "null"]:
        r, g, b, _ = parse_hex_color(bg_color)
        bg_alpha = int(bg_opacity * 255)
        bg_fill = (r, g, b, bg_alpha)
    else:
        bg_fill = (0, 0, 0, 0)
        
    # Create canvas
    image = Image.new("RGBA", (width, height), bg_fill)
    draw = ImageDraw.Draw(image)
    
    # Word text list
    word_texts = [w['word'] for w in words]
    
    # Find optimal font size
    max_width = width - 2 * text_margin
    max_height = height * 0.6
    best_size = get_optimal_font_size_py(word_texts, max_width, max_height, font_path, font_size)
    
    # Load optimal font
    try:
        font = ImageFont.truetype(font_path, best_size)
    except Exception as e:
        print(f"[-] Font load error in Brat mode: {e}. Falling back to default.")
        font = ImageFont.load_default()
        
    # Wrap lines
    lines = get_wrapped_lines_py(word_texts, font, max_width)
    
    # Calculate positions
    word_positions = calculate_word_positions_py(lines, font, best_size, width, height, text_margin)
    
    # Draw words
    for item in word_positions:
        # Lowercase per Brat style specification
        txt = item['text'].lower()
        draw_x = item['x']
        draw_y = item['y']
        
        draw.text(
            (draw_x, draw_y),
            txt,
            font=font,
            fill=txt_rgba,
            stroke_width=stroke_width,
            stroke_fill=stroke_color
        )
        
    return image

def build_lyrical_overlay_clips(chunks, width, height, font_path, font_size, active_color, stroke_width, stroke_color, y_position, **kwargs):
    """
    Processes all word chunks to build a list of transparent, timed ImageClips
    representing active and inactive caption states. Supports multiple animation modes.
    """
    animation_mode = kwargs.get("animation_mode", "highlight")
    text_color = kwargs.get("text_color", None)
    text_margin = kwargs.get("text_margin", 50)
    bg_color = kwargs.get("bg_color", None)
    bg_opacity = kwargs.get("bg_opacity", 1.0)
    lofi_factor = kwargs.get("lofi_factor", 1)

    print(f"[*] Generating subtitle clips layer (Mode: '{animation_mode}', Lofi: {lofi_factor}, Margin: {text_margin})...")
    overlay_clips = []
    total_intervals = 0

    if animation_mode in ["brat", "word_builder"]:
        for phrase_idx, phrase in enumerate(chunks):
            phrase_start = phrase[0]['start']
            phrase_end = phrase[-1]['end'] + 0.3
            
            for i in range(len(phrase)):
                word = phrase[i]
                t0 = word['start']
                t1 = phrase[i+1]['start'] if (i + 1 < len(phrase)) else phrase_end
                duration = t1 - t0
                
                if duration <= 0.005:
                    continue
                    
                if animation_mode == "brat":
                    # Render cumulative words up to current index i
                    pil_img = render_brat_image(
                        words=phrase[0 : i+1],
                        width=width,
                        height=height,
                        font_path=font_path,
                        font_size=font_size,
                        text_color=text_color,
                        stroke_width=stroke_width,
                        stroke_color=stroke_color,
                        text_margin=text_margin,
                        bg_color=bg_color,
                        bg_opacity=bg_opacity
                    )
                else:  # word_builder
                    # Render standard chunk image with phrase[0 : i+1] visible and word index i active
                    # Also respect solid background if configured
                    if bg_color and bg_color.lower() not in ["none", "transparent", "null"]:
                        r, g, b, _ = parse_hex_color(bg_color)
                        bg_alpha = int(bg_opacity * 255)
                        bg_fill = (r, g, b, bg_alpha)
                    else:
                        bg_fill = (0, 0, 0, 0)
                        
                    # Standard chunk render but with progressive slice
                    pil_img_trans = render_chunk_image(
                        words=phrase[0 : i+1],
                        active_index=i,
                        width=width,
                        height=height,
                        font_path=font_path,
                        font_size=font_size,
                        active_color=active_color,
                        stroke_width=stroke_width,
                        stroke_color=stroke_color,
                        y_position=y_position
                    )
                    
                    if bg_fill != (0, 0, 0, 0):
                        pil_img = Image.new("RGBA", (width, height), bg_fill)
                        pil_img.alpha_composite(pil_img_trans)
                    else:
                        pil_img = pil_img_trans
                
                if lofi_factor > 1:
                    small_w = max(1, width // lofi_factor)
                    small_h = max(1, height // lofi_factor)
                    pil_img = pil_img.resize((small_w, small_h), Image.NEAREST).resize((width, height), Image.NEAREST)

                # Convert to RGB + Alpha masks
                img_np = np.array(pil_img)
                rgb_arr = img_np[:, :, :3]
                alpha_arr = img_np[:, :, 3] / 255.0

                try:
                    # MoviePy v1.x
                    mask_clip = ImageClip(alpha_arr, ismask=True).set_duration(duration)
                    clip = ImageClip(rgb_arr).set_duration(duration).set_mask(mask_clip)
                    clip = clip.set_start(t0)
                except TypeError:
                    # MoviePy v2.x
                    mask_clip = ImageClip(alpha_arr, is_mask=True).with_duration(duration)
                    clip = ImageClip(rgb_arr).with_duration(duration).with_mask(mask_clip)
                    clip = clip.with_start(t0)

                overlay_clips.append(clip)
                total_intervals += 1
    else:
        # Standard highlight mode
        for chunk_idx, chunk in enumerate(chunks):
            chunk_start = chunk[0]['start']
            chunk_end = chunk[-1]['end']

            events = [chunk_start, chunk_end]
            for w in chunk:
                events.append(w['start'])
                events.append(w['end'])

            events = sorted(list(set(events)))

            for i in range(len(events) - 1):
                t0 = events[i]
                t1 = events[i+1]
                duration = t1 - t0

                if duration <= 0.005:
                    continue

                t_mid = (t0 + t1) / 2
                active_word_idx = -1
                for word_idx, w in enumerate(chunk):
                    if w['start'] <= t_mid <= w['end']:
                        active_word_idx = word_idx
                        break

                # Solid background support
                if bg_color and bg_color.lower() not in ["none", "transparent", "null"]:
                    r, g, b, _ = parse_hex_color(bg_color)
                    bg_alpha = int(bg_opacity * 255)
                    bg_fill = (r, g, b, bg_alpha)
                else:
                    bg_fill = (0, 0, 0, 0)

                pil_img_trans = render_chunk_image(
                    words=chunk,
                    active_index=active_word_idx,
                    width=width,
                    height=height,
                    font_path=font_path,
                    font_size=font_size,
                    active_color=active_color,
                    stroke_width=stroke_width,
                    stroke_color=stroke_color,
                    y_position=y_position
                )

                if bg_fill != (0, 0, 0, 0):
                    pil_img = Image.new("RGBA", (width, height), bg_fill)
                    pil_img.alpha_composite(pil_img_trans)
                else:
                    pil_img = pil_img_trans

                if lofi_factor > 1:
                    small_w = max(1, width // lofi_factor)
                    small_h = max(1, height // lofi_factor)
                    pil_img = pil_img.resize((small_w, small_h), Image.NEAREST).resize((width, height), Image.NEAREST)

                img_np = np.array(pil_img)
                rgb_arr = img_np[:, :, :3]
                alpha_arr = img_np[:, :, 3] / 255.0

                try:
                    mask_clip = ImageClip(alpha_arr, ismask=True).set_duration(duration)
                    clip = ImageClip(rgb_arr).set_duration(duration).set_mask(mask_clip)
                    clip = clip.set_start(t0)
                except TypeError:
                    mask_clip = ImageClip(alpha_arr, is_mask=True).with_duration(duration)
                    clip = ImageClip(rgb_arr).with_duration(duration).with_mask(mask_clip)
                    clip = clip.with_start(t0)

                overlay_clips.append(clip)
                total_intervals += 1

    print(f"[+] Kinetic overlay building complete! Generated {total_intervals} caption sub-clips.")
    return overlay_clips

# ==============================================================================
# 5. CORE INTEGRATION PIPELINE
# ==============================================================================
def create_lyrical_video(input_path, background_path, output_path, **kwargs):
    """
    Main orchestration function running the full video composition pipeline.
    Supports standalone rendering, pre-rendered silent overlays, and instant static previews.
    """
    print("=" * 80)
    print("         SLEECKOS LYRICAL VIDEO COMPOSER PIPELINE")
    print("=" * 80)
    
    # Verify input exists
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found at: {input_path}")
        
    # Check if input is audio-only or video
    is_input_audio = False
    try:
        audio_check = AudioFileClip(input_path)
        audio_duration = audio_check.duration
        audio_check.close()
        # Test if it also has video dimensions
        try:
            vid_check = VideoFileClip(input_path)
            if vid_check.size and vid_check.size[0] > 0:
                is_input_audio = False
            else:
                is_input_audio = True
            vid_check.close()
        except Exception:
            is_input_audio = True
    except Exception as e:
        raise ValueError(f"Could not load input file as a valid audio/video file. Details: {e}")
        
    print(f"[+] Input recognized: {'AUDIO' if is_input_audio else 'VIDEO'} | Duration: {audio_duration:.2f} seconds")
    
    # Determine aspect ratio dimensions
    aspect_ratio = kwargs.get("aspect_ratio", "9:16")
    if aspect_ratio == "1:1":
        bg_width, bg_height = 720, 720
    elif aspect_ratio == "16:9":
        bg_width, bg_height = 1280, 720
    else:  # default 9:16
        bg_width, bg_height = 720, 1280
        
    print(f"[+] Aspect Ratio: {aspect_ratio} | Dimensions: {bg_width}x{bg_height}")
    
    # Check if solid background color canvas is used
    use_solid_bg_as_canvas = (kwargs.get("bg_color") and kwargs.get("bg_color").lower() not in ["none", "transparent", "null"])
    
    # Determine background video
    if not kwargs.get("only_overlay") and not kwargs.get("preview_frame") and not use_solid_bg_as_canvas:
        if is_input_audio:
            if not background_path:
                raise ValueError("A background image/video must be provided when the input is an audio file.")
            if not os.path.exists(background_path):
                raise FileNotFoundError(f"Background asset not found at: {background_path}")
        else:
            # For video input, the input itself acts as the background source
            background_path = input_path
            
    # 1. Step: Transcription Layer (Bypassed if --transcription-json is supplied)
    transcription_json_str = kwargs.get("transcription_json")
    if transcription_json_str:
        print("[*] Pre-transcribed JSON metadata provided. Bypassing Whisper alignment.")
        try:
            words = json.loads(transcription_json_str)
        except Exception as e:
            raise ValueError(f"Failed to parse --transcription-json payload. Error: {e}")
    else:
        # Extra parameters
        model_size = kwargs.get("model", "base")
        device = kwargs.get("device", "cpu")
        
        # Transcribe
        words = transcribe_audio(input_path, model_size=model_size, device=device)
        
    if not words:
        raise ValueError("No speech/lyrics translatable words were detected in the audio track!")
        
    print(f"[+] Loaded {len(words)} aligned words successfully.")
    
    # Save the aligned word-level JSON metadata if requested
    save_json_path = kwargs.get("save_json")
    if save_json_path:
        print(f"[*] Saving aligned words JSON to: {save_json_path}")
        try:
            if os.path.dirname(save_json_path):
                os.makedirs(os.path.dirname(os.path.abspath(save_json_path)), exist_ok=True)
            with open(save_json_path, "w", encoding="utf-8") as f:
                json.dump(words, f, indent=4, ensure_ascii=False)
            print(f"[+] Transcription JSON metadata saved successfully!")
        except Exception as e:
            print(f"[-] Warning: Failed to save aligned JSON metadata: {e}", file=sys.stderr)

    
    # Assign color cycle (Neon Palette) to words for "multiple neon colors" support
    colors_arg = kwargs.get("active_color", "multi")
    if colors_arg.lower() == "multi":
        # Cycle through premium neon colors (Yellow, Green, Cyan, Magenta, Orange, Pink)
        hex_list = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"]
        print("[*] Multiple Neon Colors selected. cycling palette: Yellow, Green, Cyan, Magenta, Orange, Pink")
    elif "," in colors_arg:
        hex_list = [c.strip() for c in colors_arg.split(",")]
        print(f"[*] Custom Multiple Neon Colors selected. cycling: {hex_list}")
    else:
        hex_list = [colors_arg]
        
    active_colors_rgba = [parse_hex_color(h) for h in hex_list]
    for idx, w in enumerate(words):
        w["active_color"] = active_colors_rgba[idx % len(active_colors_rgba)]
        
    # Resolve Font styling
    font_arg = kwargs.get("font", "Montserrat-Black")
    resolved_font_path = ensure_font(font_arg)
    
    font_size = kwargs.get("font_size", 48)
    stroke_width = kwargs.get("stroke_width", 5)
    stroke_color = parse_hex_color(kwargs.get("stroke_color", "#000000"))
    active_color = parse_hex_color("#FFFF00")
    
    # Align relative lower third coordinates (y-axis position)
    pos_y_ratio = kwargs.get("position_y", 0.75)
    target_y = int(bg_height * pos_y_ratio)
    
    animation_mode = kwargs.get("animation_mode", "highlight")
    
    # 2. Step: Chunk words based on animation mode
    max_chunk_words = kwargs.get("max_chunk_words", 3)
    max_silence = kwargs.get("max_silence", 1.5)
    
    if animation_mode in ["brat", "word_builder"]:
        chunks = chunk_phrases(words, max_silence_gap=max_silence, max_words=12)
    else:
        chunks = chunk_words(words, max_words=max_chunk_words, max_silence_gap=max_silence)
    
    # ──────────────────────────────────────────────────────────────────────────
    # MODE A: INSTANT PREVIEW FRAME MODE
    # ──────────────────────────────────────────────────────────────────────────
    preview_frame_path = kwargs.get("preview_frame")
    if preview_frame_path:
        print(f"[*] Instant Preview Frame Mode activated. Rendering frame to: {preview_frame_path}")
        os.makedirs(os.path.dirname(os.path.abspath(preview_frame_path)), exist_ok=True)
        
        # Render the first chunk with the first word active
        if chunks:
            test_chunk = chunks[0]
            if animation_mode == "brat":
                preview_img = render_brat_image(
                    words=[test_chunk[0]],
                    width=bg_width,
                    height=bg_height,
                    font_path=resolved_font_path,
                    font_size=font_size,
                    text_color=kwargs.get("text_color"),
                    stroke_width=stroke_width,
                    stroke_color=stroke_color,
                    text_margin=kwargs.get("text_margin", 50),
                    bg_color=kwargs.get("bg_color"),
                    bg_opacity=kwargs.get("bg_opacity", 1.0)
                )
            else:
                preview_img_trans = render_chunk_image(
                    words=test_chunk,
                    active_index=0,
                    width=bg_width,
                    height=bg_height,
                    font_path=resolved_font_path,
                    font_size=font_size,
                    active_color=test_chunk[0].get("active_color", active_colors_rgba[0]),
                    stroke_width=stroke_width,
                    stroke_color=stroke_color,
                    y_position=target_y
                )
                if use_solid_bg_as_canvas:
                    r, g, b, _ = parse_hex_color(kwargs.get("bg_color"))
                    bg_alpha = int(kwargs.get("bg_opacity", 1.0) * 255)
                    preview_img = Image.new("RGBA", (bg_width, bg_height), (r, g, b, bg_alpha))
                    preview_img.alpha_composite(preview_img_trans)
                else:
                    preview_img = preview_img_trans
        else:
            dummy_words = [{"word": "sleeckos", "start": 0.0, "end": 1.0}]
            if animation_mode == "brat":
                preview_img = render_brat_image(
                    words=dummy_words,
                    width=bg_width,
                    height=bg_height,
                    font_path=resolved_font_path,
                    font_size=font_size,
                    text_color=kwargs.get("text_color"),
                    stroke_width=stroke_width,
                    stroke_color=stroke_color,
                    text_margin=kwargs.get("text_margin", 50),
                    bg_color=kwargs.get("bg_color"),
                    bg_opacity=kwargs.get("bg_opacity", 1.0)
                )
            else:
                dummy_words.append({"word": "Lyrical", "start": 1.0, "end": 2.0})
                preview_img_trans = render_chunk_image(
                    words=dummy_words,
                    active_index=0,
                    width=bg_width,
                    height=bg_height,
                    font_path=resolved_font_path,
                    font_size=font_size,
                    active_color=active_colors_rgba[0],
                    stroke_width=stroke_width,
                    stroke_color=stroke_color,
                    y_position=target_y
                )
                if use_solid_bg_as_canvas:
                    r, g, b, _ = parse_hex_color(kwargs.get("bg_color"))
                    bg_alpha = int(kwargs.get("bg_opacity", 1.0) * 255)
                    preview_img = Image.new("RGBA", (bg_width, bg_height), (r, g, b, bg_alpha))
                    preview_img.alpha_composite(preview_img_trans)
                else:
                    preview_img = preview_img_trans
            
        lofi_factor = kwargs.get("lofi_factor", 1)
        if lofi_factor > 1:
            small_w = max(1, bg_width // lofi_factor)
            small_h = max(1, bg_height // lofi_factor)
            preview_img = preview_img.resize((small_w, small_h), Image.NEAREST).resize((bg_width, bg_height), Image.NEAREST)
            
        preview_img.save(preview_frame_path, "PNG")
        print(f"[+] Preview frame successfully generated and saved at: {preview_frame_path}")
        print("=" * 80)
        return
        
    print(f"[+] Grouped text into {len(chunks)} kinetic subtitle segments.")
    
    # 3. Render Caption Overlay Clips
    caption_overlays = build_lyrical_overlay_clips(
        chunks=chunks,
        width=bg_width,
        height=bg_height,
        font_path=resolved_font_path,
        font_size=font_size,
        active_color=active_color,
        stroke_width=stroke_width,
        stroke_color=stroke_color,
        y_position=target_y,
        **kwargs
    )
    
    fps = kwargs.get("fps", 60)
    if fps <= 0:
        fps = 60
        
    # ──────────────────────────────────────────────────────────────────────────
    # MODE B: PRE-RENDERED TRANSPARENT OVERLAY ONLY
    # ──────────────────────────────────────────────────────────────────────────
    if kwargs.get("only_overlay"):
        print("[*] Pre-Rendered Transparent Overlay Mode activated.")
        audio_clip = AudioFileClip(input_path)
        
        # Composite transparent overlays together directly
        final_clip = CompositeVideoClip(caption_overlays, size=(bg_width, bg_height))
        # MoviePy v1.x vs v2.x: set_audio → with_audio
        try:
            final_clip = final_clip.set_audio(audio_clip)
        except AttributeError:
            final_clip = final_clip.with_audio(audio_clip)
        
        print(f"[*] Pre-rendering transparent caption video overlay. Dimensions: {bg_width}x{bg_height} | FPS: {fps}")
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        
        # Render QuickTime Animation lossless alpha MOV
        final_clip.write_videofile(
            output_path,
            fps=fps,
            codec="png", # QuickTime lossless alpha transparency codec
            preset="medium",
            threads=4,
            temp_audiofile=f"/tmp/temp_overlay_audio_{os.getpid()}.mp3"
        )
        
        final_clip.close()
        audio_clip.close()
        for o in caption_overlays:
            o.close()
            
        print("=" * 80)
        print(f"[+] SUCCESS! Lossless transparent captions overlay pre-rendered at: {output_path}")
        print("=" * 80)
        return
        
    # ──────────────────────────────────────────────────────────────────────────
    # MODE C: STANDALONE DIRECT RENDER (Standard Video + Audio + Subtitles)
    # ──────────────────────────────────────────────────────────────────────────
    print("[*] Standalone Direct Composition mode selected. Loading backgrounds...")
    
    if use_solid_bg_as_canvas:
        r, g, b, _ = parse_hex_color(kwargs.get("bg_color"))
        bg_alpha = int(kwargs.get("bg_opacity", 1.0) * 255)
        # Create solid color background clip
        solid_img = Image.new("RGBA", (bg_width, bg_height), (r, g, b, bg_alpha))
        img_np = np.array(solid_img)
        rgb_arr = img_np[:, :, :3]
        alpha_arr = img_np[:, :, 3] / 255.0
        
        try:
            mask_clip = ImageClip(alpha_arr, ismask=True).set_duration(audio_duration)
            bg_clip = ImageClip(rgb_arr).set_duration(audio_duration).set_mask(mask_clip)
        except TypeError:
            mask_clip = ImageClip(alpha_arr, is_mask=True).with_duration(audio_duration)
            bg_clip = ImageClip(rgb_arr).with_duration(audio_duration).with_mask(mask_clip)
            
        audio_clip = AudioFileClip(input_path)
        try:
            bg_clip = bg_clip.set_audio(audio_clip)
        except AttributeError:
            bg_clip = bg_clip.with_audio(audio_clip)
            
    elif is_input_audio:
        is_bg_image = False
        try:
            img = Image.open(background_path)
            is_bg_image = True
            img.close()
        except Exception:
            is_bg_image = False
            
        if is_bg_image:
            try:
                bg_clip = ImageClip(background_path).set_duration(audio_duration)
            except (TypeError, AttributeError):
                bg_clip = ImageClip(background_path).with_duration(audio_duration)
            bg_clip = crop_to_fill_video_clip(bg_clip, bg_width, bg_height)
        else:
            bg_source = VideoFileClip(background_path)
            if bg_source.duration < audio_duration:
                bg_clip = loop_video_clip(bg_source, duration=audio_duration)
            else:
                bg_clip = bg_source.subclip(0, audio_duration)
            bg_clip = crop_to_fill_video_clip(bg_clip, bg_width, bg_height)
        
        audio_clip = AudioFileClip(input_path)
        try:
            bg_clip = bg_clip.set_audio(audio_clip)
        except AttributeError:
            bg_clip = bg_clip.with_audio(audio_clip)
    else:
        bg_clip = VideoFileClip(background_path)
        if bg_clip.w != bg_width or bg_clip.h != bg_height:
            bg_clip = crop_to_fill_video_clip(bg_clip, bg_width, bg_height)
            
        if bg_clip.audio is None:
            print("[!] Warning: Source video file does not have an active audio track!", file=sys.stderr)
            
    print("[*] Assembling composite media elements...")
    final_clip = CompositeVideoClip([bg_clip] + caption_overlays)
    
    print(f"[*] Rendering output MP4 container. Dimensions: {bg_width}x{bg_height} | Target Frame Rate: {fps}fps")
    final_clip.write_videofile(
        output_path,
        fps=fps,
        codec="libx264",
        audio_codec="aac",
        preset="medium",
        bitrate="5000k",
        threads=4,
        temp_audiofile=f"/tmp/temp_render_audio_{os.getpid()}.mp3"
    )
    
    final_clip.close()
    bg_clip.close()
    for o in caption_overlays:
        o.close()
        
    print("=" * 80)
    print(f"[+] SUCCESS! Lyrical video composed cleanly at: {output_path}")
    print("=" * 80)

# ==============================================================================
# 6. CLI INTERFACE EXECUTION
# ==============================================================================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Sleeckos Lyrical Video Composer CLI Tool - Kinetic typography rendering with word alignment."
    )
    
    # 1. Inputs/Outputs Group
    parser.add_argument("--input", "-i", required=True, help="Path to input audio or video file.")
    parser.add_argument("--background", "-b", default=None, help="Path to background video/image (required if input is audio).")
    parser.add_argument("--output", "-o", required=True, help="Path for rendered output file.")
    
    # 2. Pre-Rendering & Preview options
    parser.add_argument("--only-overlay", action="store_true", help="Pre-render only transparent captions video overlay ( lossy/lossless MOV ).")
    parser.add_argument("--preview-frame", default=None, help="Render a single PNG preview frame to this path and exit immediately.")
    parser.add_argument("--transcription-json", default=None, help="Aligned word-level JSON string to bypass Whisper transcription entirely.")
    
    # 3. Transcription settings
    parser.add_argument("--model", default="base", help="stable-ts whisper model size (tiny, base, small, medium, large). Default: base")
    parser.add_argument("--device", default="cpu", help="Compute hardware device ('cpu' or 'cuda'). Default: cpu")
    parser.add_argument("--save-json", default=None, help="Path to write the aligned word-level JSON metadata.")
    
    # 4. Styling & Positioning
    parser.add_argument("--font", default="Montserrat-Black", help="Font name or filepath to .ttf font (Montserrat-Black, Arial Black, Impact etc.).")
    parser.add_argument("--font-size", type=int, default=48, help="Base caption text font size. Default: 48")
    parser.add_argument("--active-color", default="multi", help="Hex color code or comma-separated list of hex codes, or 'multi' for cycling neon palette. Default: 'multi'")
    parser.add_argument("--stroke-width", type=int, default=5, help="Caption text thick black border stroke width. Default: 5")
    parser.add_argument("--stroke-color", default="#000000", help="Hex color code for the caption outline. Default: #000000 (Black)")
    parser.add_argument("--position-y", type=float, default=0.75, help="Vertical position fraction of screen height (e.g. 0.75 for lower third).")
    
    # 5. Rendering options
    parser.add_argument("--fps", type=int, default=60, help="Output target frame rate (e.g. 60 or 30). Default: 60")
    parser.add_argument("--max-chunk-words", type=int, default=3, help="Maximum words displayed on screen per caption chunk. Default: 3")
    parser.add_argument("--max-silence", type=float, default=1.5, help="Maximum silence gap in seconds before resetting subtitle chunk. Default: 1.5")
    parser.add_argument("--animation-mode", default="highlight", choices=["highlight", "word_builder", "brat"], help="Text animation/reveal mode.")
    parser.add_argument("--text-margin", type=int, default=50, help="Horizontal layout text margin in pixels.")
    parser.add_argument("--text-color", default=None, help="Hex text color override.")
    parser.add_argument("--bg-color", default=None, help="Hex solid background color.")
    parser.add_argument("--bg-opacity", type=float, default=1.0, help="Background opacity fraction.")
    parser.add_argument("--lofi-factor", type=int, default=1, help="Lofi pixelation scaling factor.")
    parser.add_argument("--aspect-ratio", default="9:16", choices=["9:16", "1:1", "16:9"], help="Layout aspect ratio.")
    
    args = parser.parse_args()
    
    try:
        create_lyrical_video(
            input_path=args.input,
            background_path=args.background,
            output_path=args.output,
            only_overlay=args.only_overlay,
            preview_frame=args.preview_frame,
            transcription_json=args.transcription_json,
            model=args.model,
            device=args.device,
            save_json=args.save_json,
            font=args.font,
            font_size=args.font_size,
            active_color=args.active_color,
            stroke_width=args.stroke_width,
            stroke_color=args.stroke_color,
            position_y=args.position_y,
            fps=args.fps,
            max_chunk_words=args.max_chunk_words,
            max_silence=args.max_silence,
            animation_mode=args.animation_mode,
            text_margin=args.text_margin,
            text_color=args.text_color,
            bg_color=args.bg_color,
            bg_opacity=args.bg_opacity,
            lofi_factor=args.lofi_factor,
            aspect_ratio=args.aspect_ratio
        )
    except Exception as err:
        print(f"\n[!] Video Composition Failed: {err}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(2)
