#!/usr/bin/env python3
"""
Usage: python transcribe.py <video_or_audio_path> [model_size]
model_size: tiny | base | small (default: tiny)
Outputs JSON: { language, text, segments: [{start, end, text}] }
"""
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <file> [model_size]"}))
        sys.exit(1)

    file_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "tiny"

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"error": "faster_whisper not installed in this venv"}))
        sys.exit(1)

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments_gen, info = model.transcribe(file_path, beam_size=5)

    segments = []
    texts = []
    for seg in segments_gen:
        segments.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        texts.append(seg.text.strip())

    print(json.dumps({
        "language": info.language,
        "text": " ".join(texts),
        "segments": segments,
    }))

if __name__ == "__main__":
    main()
