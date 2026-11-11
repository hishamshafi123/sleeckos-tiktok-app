"""Word timestamps for Content Desk, using the existing faster-whisper runtime."""
import json
import os
import sys
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("CONTENT_CLIP_WHISPER_MODEL", "base"), device="cpu", compute_type="int8", cpu_threads=2)
segments, _ = model.transcribe(sys.argv[1], word_timestamps=True, vad_filter=True, beam_size=3)
words = []
for segment in segments:
    for word in segment.words or []:
        if word.word.strip() and word.end > word.start:
            words.append({"word": word.word.strip(), "start": round(word.start, 3), "end": round(word.end, 3)})
with open(sys.argv[2], "w") as output:
    json.dump(words, output)
