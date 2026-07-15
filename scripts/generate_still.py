#!/usr/bin/env python3
import os
import sys
import argparse
from PIL import Image, ImageDraw, ImageFont

def parse_hex_color(hex_str, opacity=255):
    hex_str = hex_str.lstrip('#')
    if len(hex_str) == 3:
        hex_str = ''.join([c*2 for c in hex_str])
    r = int(hex_str[0:2], 16)
    g = int(hex_str[2:4], 16)
    b = int(hex_str[4:6], 16)
    return (r, g, b, int(opacity))

def wrap_text(text, font, max_width, draw):
    words = text.split(' ')
    lines = []
    current_line = []
    for word in words:
        test_line = ' '.join(current_line + [word]) if current_line else word
        bbox = draw.textbbox((0, 0), test_line, font=font)
        w = bbox[2] - bbox[0]
        if w <= max_width:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]
    if current_line:
        lines.append(' '.join(current_line))
    return lines

def main():
    parser = argparse.ArgumentParser(description="Generate transparent text overlay PNG using Pillow.")
    parser.add_argument("--text", required=True, help="Text to render")
    parser.add_argument("--font-size", type=int, default=32, help="Font size")
    parser.add_argument("--font-color", default="#FFFFFF", help="Font color hex")
    parser.add_argument("--bg-color", default="#000000", help="Background color hex")
    parser.add_argument("--bg-opacity", type=float, default=0.85, help="Background opacity (0.0 to 1.0)")
    parser.add_argument("--position-y", type=float, default=75, help="Y percent of screen height (e.g. 75)")
    parser.add_argument("--style", default="news-lower-third", choices=["news-lower-third", "breaking-headline", "subtitle-box", "quote-card"], help="Style key")
    parser.add_argument("--accent-color", default="#E11D48", help="Accent color hex")
    parser.add_argument("--author", default="", help="Author name (for quote-card)")
    parser.add_argument("--font-family", default="", help="Font family name (e.g. Inter, Oswald, Roboto)")
    parser.add_argument("--width", type=int, default=720, help="Canvas width")
    parser.add_argument("--height", type=int, default=1280, help="Canvas height")
    parser.add_argument("--output", required=True, help="Output path for the PNG")
    
    args = parser.parse_args()
    
    # 1. Create transparent canvas
    img = Image.new("RGBA", (args.width, args.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 2. Determine fonts
    font_dir = os.path.join(os.getcwd(), "public", "fonts")
    if not os.path.exists(font_dir):
        # Fallback to current directory or system fonts
        font_dir = "public/fonts"
        
    font_map = {
        "news-lower-third": "Inter-Bold.ttf",
        "breaking-headline": "Oswald-Bold.ttf",
        "subtitle-box": "Inter-Bold.ttf",
        "quote-card": "Lora-Bold.ttf"
    }

    family_map = {
        "Inter": ("Inter-Regular.ttf", "Inter-Bold.ttf"),
        "IBM Plex Sans": ("IBMPlexSans-Regular.ttf", "IBMPlexSans-Bold.ttf"),
        "Source Sans 3": ("SourceSans3-Regular.ttf", "SourceSans3-Bold.ttf"),
        "Libre Franklin": ("LibreFranklin-Regular.ttf", "LibreFranklin-Bold.ttf"),
        "Archivo": ("Archivo-Regular.ttf", "Archivo-Bold.ttf"),
        "Barlow": ("Barlow-Regular.ttf", "Barlow-Bold.ttf"),
        "Barlow Condensed": ("BarlowCondensed-Regular.ttf", "BarlowCondensed-Bold.ttf"),
        "Roboto": ("Roboto-Regular.ttf", "Roboto-Bold.ttf"),
        "Roboto Condensed": ("RobotoCondensed-Regular.ttf", "RobotoCondensed-Bold.ttf"),
        "Oswald": ("Oswald-Regular.ttf", "Oswald-Bold.ttf"),
        "Anton": ("Anton-Regular.ttf", "Anton-Regular.ttf"),
        "Public Sans": ("PublicSans-Regular.ttf", "PublicSans-Bold.ttf"),
        "Lora": ("Lora-Regular.ttf", "Lora-Bold.ttf"),
    }
    
    selected_font_file = None
    subtext_font_file = "Inter-Regular.ttf"

    if args.font_family in family_map:
        reg_file, bold_file = family_map[args.font_family]
        selected_font_file = bold_file
        subtext_font_file = reg_file
    else:
        selected_font_file = font_map.get(args.style, "Inter-Bold.ttf")

    font_path = os.path.join(font_dir, selected_font_file)
    if not os.path.exists(font_path):
        # fallback to any available .ttf in directory
        if os.path.exists(font_dir) and os.listdir(font_dir):
            for f in os.listdir(font_dir):
                if f.endswith(".ttf"):
                    font_path = os.path.join(font_dir, f)
                    break
        else:
            font_path = None # will load default font
            
    # Load fonts
    try:
        if font_path:
            font = ImageFont.truetype(font_path, args.font_size)
            header_font = ImageFont.truetype(os.path.join(font_dir, "Inter-Bold.ttf"), max(14, int(args.font_size * 0.55)))
            quote_symbol_font = ImageFont.truetype(os.path.join(font_dir, "Lora-Bold.ttf"), int(args.font_size * 2))
        else:
            font = ImageFont.load_default()
            header_font = ImageFont.load_default()
            quote_symbol_font = ImageFont.load_default()
    except Exception as e:
        print(f"Font loading failed: {e}. Falling back to default font.", file=sys.stderr)
        font = ImageFont.load_default()
        header_font = ImageFont.load_default()
        quote_symbol_font = ImageFont.load_default()
        
    # Formatting values
    margin_x = 40
    content_width = args.width - (margin_x * 2)
    bg_opacity_val = int(args.bg_opacity * 255)
    
    text_color = parse_hex_color(args.font_color, 255)
    bg_color = parse_hex_color(args.bg_color, bg_opacity_val)
    accent_color = parse_hex_color(args.accent_color, 255)
    
    # 3. Layout and Draw style
    if args.style == "news-lower-third":
        # Wrap text
        lines = wrap_text(args.text, font, content_width - 40, draw)
        
        # Calculate height
        line_heights = [draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] for line in lines]
        total_text_height = sum(line_heights) + (10 * (len(lines) - 1))
        
        card_padding_y = 20
        card_padding_x = 24
        card_height = total_text_height + (card_padding_y * 2)
        card_width = content_width
        
        # Y position
        center_y = int(args.height * (args.position_y / 100))
        top_y = center_y - (card_height // 2)
        bottom_y = top_y + card_height
        
        left_x = margin_x
        right_x = left_x + card_width
        
        # Draw background strip
        draw.rectangle([left_x, top_y, right_x, bottom_y], fill=bg_color)
        
        # Draw red border line on the left side
        border_width = 6
        draw.rectangle([left_x, top_y, left_x + border_width, bottom_y], fill=accent_color)
        
        # Draw text
        curr_y = top_y + card_padding_y
        for line in lines:
            draw.text((left_x + card_padding_x, curr_y), line, font=font, fill=text_color)
            curr_y += draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] + 10

    elif args.style == "breaking-headline":
        headline_text = args.text.strip().upper()
        # Wrap text
        lines = wrap_text(headline_text, font, content_width - 40, draw)
        
        # Calculate dimensions
        line_heights = [draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] for line in lines]
        total_text_height = sum(line_heights) + (10 * (len(lines) - 1))
        
        header_text = "★ BREAKING NEWS"
        header_bbox = draw.textbbox((0, 0), header_text, font=header_font)
        header_height = header_bbox[3] - header_bbox[1]
        
        card_padding_y = 20
        card_padding_x = 24
        card_height = header_height + 8 + total_text_height + (card_padding_y * 2)
        card_width = content_width
        
        # Y position
        center_y = int(args.height * (args.position_y / 100))
        top_y = center_y - (card_height // 2)
        bottom_y = top_y + card_height
        
        left_x = margin_x
        right_x = left_x + card_width
        
        # Draw background strip
        draw.rectangle([left_x, top_y, right_x, bottom_y], fill=bg_color)
        
        # Draw red border line on the left side
        border_width = 6
        draw.rectangle([left_x, top_y, left_x + border_width, bottom_y], fill=accent_color)
        
        # Draw "★ BREAKING NEWS" header
        draw.text((left_x + card_padding_x, top_y + card_padding_y), header_text, font=header_font, fill=accent_color)
        
        # Draw text
        curr_y = top_y + card_padding_y + header_height + 8
        for line in lines:
            draw.text((left_x + card_padding_x, curr_y), line, font=font, fill=text_color)
            curr_y += draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] + 10

    elif args.style == "subtitle-box":
        # Wrap text
        lines = wrap_text(args.text, font, content_width - 48, draw)
        
        # Calculate height
        line_heights = [draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] for line in lines]
        total_text_height = sum(line_heights) + (10 * (len(lines) - 1))
        
        card_padding_y = 20
        card_padding_x = 24
        card_height = total_text_height + (card_padding_y * 2)
        card_width = content_width
        
        # Y position
        center_y = int(args.height * (args.position_y / 100))
        top_y = center_y - (card_height // 2)
        bottom_y = top_y + card_height
        
        left_x = margin_x
        right_x = left_x + card_width
        
        # Draw rounded background card
        draw.rounded_rectangle([left_x, top_y, right_x, bottom_y], radius=8, fill=bg_color, outline=(255,255,255,25), width=1)
        
        # Draw centered text
        curr_y = top_y + card_padding_y
        for line in lines:
            line_bbox = draw.textbbox((0, 0), line, font=font)
            line_w = line_bbox[2] - line_bbox[0]
            # Center horizontally inside the card
            text_x = left_x + (card_width - line_w) // 2
            draw.text((text_x, curr_y), line, font=font, fill=text_color)
            curr_y += line_bbox[3] - line_bbox[1] + 10

    elif args.style == "quote-card":
        # Wrap text
        lines = wrap_text(args.text, font, content_width - 80, draw)
        
        # Calculate height
        line_heights = [draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] for line in lines]
        total_text_height = sum(line_heights) + (10 * (len(lines) - 1))
        
        author_text = f"— {args.author}" if args.author else ""
        author_font = ImageFont.truetype(os.path.join(font_dir, "Inter-Regular.ttf"), max(14, int(args.font_size * 0.6)))
        
        author_height = 0
        if author_text:
            author_bbox = draw.textbbox((0, 0), author_text, font=author_font)
            author_height = author_bbox[3] - author_bbox[1] + 10
            
        card_padding_y = 30
        card_padding_x = 40
        card_height = total_text_height + author_height + (card_padding_y * 2)
        card_width = content_width
        
        # Y position
        center_y = int(args.height * (args.position_y / 100))
        top_y = center_y - (card_height // 2)
        bottom_y = top_y + card_height
        
        left_x = margin_x
        right_x = left_x + card_width
        
        # Draw rounded background card
        draw.rounded_rectangle([left_x, top_y, right_x, bottom_y], radius=12, fill=bg_color, outline=(255,255,255,20), width=1)
        
        # Draw big quote mark in top left
        draw.text((left_x + 15, top_y + 10), "“", font=quote_symbol_font, fill=accent_color)
        
        # Draw text
        curr_y = top_y + card_padding_y + 10
        for line in lines:
            draw.text((left_x + card_padding_x, curr_y), line, font=font, fill=text_color)
            curr_y += draw.textbbox((0,0), line, font=font)[3] - draw.textbbox((0,0), line, font=font)[1] + 10
            
        # Draw author if exists
        if author_text:
            author_bbox = draw.textbbox((0, 0), author_text, font=author_font)
            author_w = author_bbox[2] - author_bbox[0]
            # Align right
            draw.text((right_x - card_padding_x - author_w, curr_y), author_text, font=author_font, fill=(161, 161, 170, 255))
            
    # 4. Save PNG output
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    img.save(args.output, "PNG")
    print(f"[+] Output PNG generated successfully at: {args.output}")

if __name__ == "__main__":
    main()
