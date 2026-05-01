#!/usr/bin/env python3
"""
Usage: python analyze_image.py <image_path> [model]
Calls a local Ollama vision model and returns JSON:
  { analysis: str, model: str }
model defaults to SCOUT_VISION_MODEL env var or "gemma4:latest"
"""
import sys
import json
import base64
import os
import urllib.request
import urllib.error


OLLAMA_URL = os.environ.get("SCOUT_OLLAMA_URL", "http://localhost:11434") + "/api/generate"

PROMPT = (
    "Analyze this image thoroughly.\n"
    "1. Extract ALL visible text exactly as written - preserve line breaks and formatting.\n"
    "2. Describe what the image shows: layout, graphics, charts, icons, colors, and overall message.\n"
    "Start your response with 'TEXT:' followed by the extracted text (write 'none' if no text), "
    "then 'DESCRIPTION:' followed by your visual description."
)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: analyze_image.py <image_path> [model]"}))
        sys.exit(1)

    image_path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("SCOUT_VISION_MODEL", "gemma4:latest")

    try:
        with open(image_path, "rb") as f:
            image_b64 = base64.b64encode(f.read()).decode("utf-8")
    except OSError as e:
        print(json.dumps({"error": f"Cannot read image: {e}"}))
        sys.exit(1)

    payload = json.dumps({
        "model": model,
        "prompt": PROMPT,
        "images": [image_b64],
        "stream": False,
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"Ollama unreachable at {OLLAMA_URL}: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Ollama request failed: {e}"}))
        sys.exit(1)

    analysis = raw.get("response", "").strip()

    # Parse TEXT: / DESCRIPTION: sections if present
    extracted_text = ""
    description = analysis
    if "TEXT:" in analysis and "DESCRIPTION:" in analysis:
        try:
            text_start = analysis.index("TEXT:") + len("TEXT:")
            desc_start = analysis.index("DESCRIPTION:")
            extracted_text = analysis[text_start:desc_start].strip()
            description = analysis[desc_start + len("DESCRIPTION:"):].strip()
            if extracted_text.lower() == "none":
                extracted_text = ""
        except ValueError:
            pass

    print(json.dumps({
        "analysis": analysis,
        "extracted_text": extracted_text,
        "description": description,
        "model": model,
    }))


if __name__ == "__main__":
    main()
