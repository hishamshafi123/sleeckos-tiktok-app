#!/bin/sh
##
## Run INSIDE the Docker container:
##   docker compose exec app sh scripts/debug-overlay.sh "clr3"
##
## Or from the host:
##   docker compose exec app sh scripts/debug-overlay.sh "clr3"
##

TEMPLATE_NAME="${1:-clr3}"

echo "═══════════════════════════════════════════════════════════"
echo " OVERLAY DIAGNOSTIC — Template: $TEMPLATE_NAME"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. FFmpeg version
echo "── 1. FFmpeg Version ──────────────────────────────────────"
ffmpeg -version 2>&1 | head -3
echo ""

# 2. Check VP8/VP9 codec support
echo "── 2. VPX Codec Support ─────────────────────────────────"
ffmpeg -codecs 2>&1 | grep -i vpx
echo ""

# 3. Check ass/subtitles filter support
echo "── 3. ASS/Subtitles Filter Support ──────────────────────"
ffmpeg -filters 2>&1 | grep -iE "ass|subtitle"
echo ""

# 4. Find overlay files
echo "── 4. Overlay Files on Disk ─────────────────────────────"
echo "Searching for overlays in public/uploads/lyrical/overlays/..."
OVERLAY_DIR="public/uploads/lyrical/overlays"
if [ -d "$OVERLAY_DIR" ]; then
  ls -la "$OVERLAY_DIR/" 2>/dev/null | head -20
  OVERLAY_COUNT=$(find "$OVERLAY_DIR" -name "*.webm" | wc -l)
  READY_COUNT=$(find "$OVERLAY_DIR" -name "*.ready" | wc -l)
  echo ""
  echo "Total WebM files: $OVERLAY_COUNT"
  echo "Total .ready sentinels: $READY_COUNT"
else
  echo "Directory does not exist!"
fi
echo ""

# 5. Find overlay matching the template name
echo "── 5. Template Overlay File Analysis ────────────────────"
# Sanitize template name same way as code does
SANITIZED=$(echo "$TEMPLATE_NAME" | sed 's/[^a-zA-Z0-9]/_/g' | tr '[:upper:]' '[:lower:]')
echo "Sanitized template name: $SANITIZED"
echo "Looking for files matching: *${SANITIZED}*.webm"

MATCHES=$(find "$OVERLAY_DIR" -name "*${SANITIZED}*" 2>/dev/null)
if [ -z "$MATCHES" ]; then
  echo "⚠️  No overlay files found matching '$SANITIZED'"
  echo ""
  echo "All available overlay files:"
  ls "$OVERLAY_DIR/"*.webm 2>/dev/null || echo "  (none)"
else
  for F in $MATCHES; do
    echo ""
    echo "File: $F"
    ls -la "$F"
    
    # Check if .ready exists
    if [ -f "${F}.ready" ]; then
      echo "  .ready sentinel: EXISTS"
      cat "${F}.ready"
    elif echo "$F" | grep -q ".ready"; then
      continue
    else
      echo "  .ready sentinel: MISSING"
    fi
    
    # FFprobe the file
    if echo "$F" | grep -q ".webm$"; then
      echo ""
      echo "  FFprobe analysis:"
      ffprobe -v error -select_streams v:0 \
        -show_entries stream=codec_name,pix_fmt,width,height,duration,nb_frames \
        -of default=noprint_wrappers=1 "$F" 2>&1
      
      CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$F" 2>&1)
      PIX_FMT=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$F" 2>&1)
      
      echo ""
      echo "  ┌─────────────────────────────────────────────────────┐"
      echo "  │ CODEC: $CODEC"
      echo "  │ PIX_FMT: $PIX_FMT"
      if [ "$CODEC" = "vp8" ]; then
        echo "  │ ❌ VP8 DOES NOT SUPPORT ALPHA - THIS IS THE BUG!   │"
        echo "  │ Overlay has opaque black bg, hiding video behind it│"
      elif [ "$CODEC" = "vp9" ]; then
        if echo "$PIX_FMT" | grep -q "a"; then
          echo "  │ ✅ VP9 with alpha pixel format — should be OK      │"
        else
          echo "  │ ⚠️  VP9 but NO alpha in pixel format               │"
        fi
      else
        echo "  │ ⚠️  Unexpected codec: $CODEC                        │"
      fi
      echo "  └─────────────────────────────────────────────────────┘"
    fi
  done
fi
echo ""

# 6. Test render (3s, blue background + overlay)
echo "── 6. Test Composite Render ─────────────────────────────"
FIRST_OVERLAY=$(find "$OVERLAY_DIR" -name "*${SANITIZED}*.webm" 2>/dev/null | head -1)
if [ -n "$FIRST_OVERLAY" ]; then
  TEST_OUTPUT="/tmp/debug_test_output.mp4"
  echo "Compositing: blue background + overlay → $TEST_OUTPUT"
  echo ""
  
  CMD="ffmpeg -y \
    -f lavfi -i color=c=blue:s=720x1280:d=3:r=30 \
    -i \"$FIRST_OVERLAY\" \
    -filter_complex \"[0:v][1:v]overlay=0:0:shortest=1:format=auto[v]\" \
    -map \"[v]\" \
    -c:v libx264 -pix_fmt yuv420p -preset ultrafast \
    -t 3 \"$TEST_OUTPUT\""
  
  echo "Command: $CMD"
  echo ""
  
  eval $CMD 2>&1 | tail -5
  
  if [ -f "$TEST_OUTPUT" ]; then
    SIZE=$(stat -c%s "$TEST_OUTPUT" 2>/dev/null || stat -f%z "$TEST_OUTPUT" 2>/dev/null)
    echo ""
    echo "✅ Test output created: $TEST_OUTPUT ($SIZE bytes)"
    echo ""
    # Copy to public so it can be downloaded
    mkdir -p public/uploads/debug
    cp "$TEST_OUTPUT" "public/uploads/debug/test_composite.mp4"
    echo "📥 Download test video at: https://sleeckos.com/uploads/debug/test_composite.mp4"
  else
    echo "❌ Test output was NOT created"
  fi
else
  echo "⚠️  No overlay file found to test with"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo " DIAGNOSTIC COMPLETE"
echo "═══════════════════════════════════════════════════════════"
