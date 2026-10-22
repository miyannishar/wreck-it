#!/usr/bin/env python3
"""Generate scene-aligned neural narration, captions, and a combined audio track."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def stamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def seconds(value):
    h, m, s, ms = map(int, re.split(r"[:,.]", value))
    return h * 3600 + m * 60 + s + ms / 1000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", default="en-US-GuyNeural")
    parser.add_argument("--rate", default="-3%")
    parser.add_argument("--script-only", action="store_true")
    args = parser.parse_args()
    scenes = json.loads((ROOT / "docs/demo/scenes.json").read_text())
    script = "\n\n".join(scene["narration"] for scene in scenes) + "\n"
    (ROOT / "docs/demo/voiceover.txt").write_text(script)
    print(f"Narration: {len(script.split())} words in {len(scenes)} scenes.", flush=True)
    if args.script_only:
        return
    try:
        import imageio_ffmpeg
        import edge_tts  # noqa: F401 — fail before starting if tooling is missing
    except ImportError:
        raise SystemExit("Install docs/demo/voice-requirements.txt in the demo voice virtual environment first.")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    out = ROOT / ".wreck-it/demo/media"
    out.mkdir(parents=True, exist_ok=True)
    subtitles = []
    timings = []
    audio = bytearray()
    sample_rate = 24000
    gap = b"\0" * (int(sample_rate * 0.5) * 2)
    for scene in scenes:
        text = scene["narration"]
        key = hashlib.sha256((args.voice + args.rate + text).encode()).hexdigest()
        prefix = out / scene["id"]
        text_file = prefix.with_suffix(".txt")
        mp3 = prefix.with_suffix(".mp3")
        srt = prefix.with_suffix(".srt")
        cache = prefix.with_suffix(".sha256")
        text_file.write_text(text)
        if not (mp3.exists() and srt.exists() and cache.exists() and cache.read_text() == key):
            print(f"Generating {scene['id']} with {args.voice}…", flush=True)
            subprocess.run([sys.executable, "-m", "edge_tts", "--voice", args.voice, f"--rate={args.rate}", "--file", str(text_file), "--write-media", str(mp3), "--write-subtitles", str(srt)], check=True, timeout=90)
            cache.write_text(key)
        wav = prefix.with_suffix(".wav")
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3), "-ar", str(sample_rate), "-ac", "1", "-c:a", "pcm_s16le", str(wav)], check=True)
        with wave.open(str(wav), "rb") as stream:
            assert stream.getframerate() == sample_rate and stream.getnchannels() == 1 and stream.getsampwidth() == 2
            frames = stream.readframes(stream.getnframes())
        start = len(audio) / (sample_rate * 2)
        duration = len(frames) / (sample_rate * 2)
        assert duration > 1, f"Empty narration clip: {scene['id']}"
        for block in re.split(r"\n\s*\n", srt.read_text().strip()):
            lines = block.splitlines()
            line = next((i for i, value in enumerate(lines) if " --> " in value), None)
            if line is None:
                continue
            begin, end = lines[line].split(" --> ")
            subtitles.append((start + seconds(begin), start + seconds(end), "\n".join(lines[line + 1:])))
        timings.append({**scene, "startSeconds": round(start, 3), "endSeconds": round(start + duration, 3), "durationSeconds": round(duration, 3), "audio": mp3.name})
        audio.extend(frames)
        audio.extend(gap)
    combined = out / "voiceover.wav"
    with wave.open(str(combined), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes(audio)
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(combined), "-codec:a", "libmp3lame", "-b:a", "192k", str(out / "voiceover.mp3")], check=True)
    assert subtitles, "No speech timing metadata returned; cannot create aligned captions."
    cues = []
    for i, (begin, end, text) in enumerate(subtitles):
        if i + 1 < len(subtitles):
            end = min(end, subtitles[i + 1][0] - 0.001)
        assert end > begin
        caption = "\n".join(textwrap.wrap(" ".join(text.split()), width=48))
        cues.append(f"{i + 1}\n{stamp(begin)} --> {stamp(end)}\n{caption}")
    (out / "voiceover.srt").write_text("\n\n".join(cues) + "\n")
    metadata = {"voice": args.voice, "rate": args.rate, "provider": "Microsoft Edge online neural speech via edge-tts", "durationSeconds": round(len(audio) / (sample_rate * 2), 3), "scriptSha256": hashlib.sha256(script.encode()).hexdigest(), "scenes": timings}
    (out / "timings.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Ready: {out / 'voiceover.mp3'} ({metadata['durationSeconds']} seconds)", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise SystemExit(f"Speech generation or audio conversion failed: {error}. The narration text is saved in docs/demo/voiceover.txt.")
