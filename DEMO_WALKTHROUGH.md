# wreck-it product walkthrough

The final product video is the user-selected CapCut edit `1021.mov`, saved for the project as [wreck-it-demo.mp4](docs/demo/wreck-it-demo.mp4). It is **36.47 seconds, 1920×1080, 30 fps**, with the edited timing and original AAC audio preserved. The source MOV uses HEVC; the project MP4 uses H.264 for browser playback. [Conversion and verification details](docs/demo/final-video.json).

[Open the final video player](docs/demo/index.html) · [Download the final MP4](docs/demo/wreck-it-demo.mp4)

The final video and poster are linked near the top of the README. The script, narration, and export instructions below are production references; regenerating their drafts does not replace the selected final video.

## Original production plan

An approximately 70–85 second screen recording with AI voiceover. The audience is a developer using a coding agent on a local web app. The video shows the product workflow: start locally → focus a run → inspect a reproduced finding → read the report → review a generated regression test.

Use a calm, conversational English voice. Say the name as “wreck it.” Record the screen first, then align the narration in the editor. Show commands on screen without reading their punctuation aloud. Use 16:9 at 1920×1080 or 1440×900, large terminal text, and captions.

## Script and shot list

Times are editing targets; use the actual voiceover durations when aligning the final cut.

| Time | What viewers see | AI voiceover |
|---|---|---|
| 0–7s | wreck-it name and tagline; cut to the running app. | Meet wreck it. It turns your coding agent into a QA team for your local web app. |
| 7–17s | Show `npx skills add miyannishar/wreck-it`, then `npx @miyanishar/wreck-it setup`. Cut to the completed setup. | Start your app locally, install the skills, and set up the browser tools. Your agent uses them to explore the app and record what breaks. |
| 17–28s | In a real agent session, enter `/wreck focus checkout`. Show the agent's scope, then a brief browser interaction. | Ask it to test your app, or focus on one flow, like checkout. The agent walks through the flow, checks edge cases, and reproduces the problems it finds. |
| 28–40s | Change earbuds quantity from 1 to 3. Show the $239.97 line total, then checkout showing $79.99. Small caption: “Seeded demo app.” | Here is a seeded demo bug. Three pairs of earbuds should total two hundred thirty-nine dollars and ninety-seven cents. Checkout displays just seventy-nine ninety-nine. |
| 40–51s | Show a finding with its screenshot attached. Zoom into `lib/cart.ts:19` and `item.price`. | The finding includes reproduction steps, relevant screenshots, and the source location. Here, the subtotal adds each unit price once, ignoring the quantity. |
| 51–62s | Open the HTML report. Show the generated assertion, its real failure, the correction to `item.lineTotal`, and the passing result. | Open the report and review the generated Playwright test. This check fails on the buggy copy, then passes after the subtotal calculation is corrected. |
| 62–69s | End card: tagline and `github.com/miyannishar/wreck-it`. | Try wreck it on your next local build. Wreck your app before your users do. |

The machine-readable scene list is [docs/demo/scenes.json](docs/demo/scenes.json). [docs/demo/voiceover.txt](docs/demo/voiceover.txt) contains only spoken words, ready for a speech generator.

The generated first take uses the stock neural English voice `en-US-GuyNeural` at −3% rate. It is **68.444 seconds** including the pauses between scenes. The audio is in `.wreck-it/demo/media/voiceover.mp3`, captions in `voiceover.srt`, and exact scene boundaries in `timings.json`. Add brief visual holds as needed, or regenerate the audio after editing the script.

Open the [narrated preview](docs/demo/preview.html) and press Play to review the scenes with the AI voice. The [MP3](docs/demo/narration/voiceover.mp3), [captions](docs/demo/narration/voiceover.srt), and [scene timings](docs/demo/narration/timings.json) are also included as portable assets. This is a storyboard using real screenshots and filming cues. Replace the prompt card and report/test cards with your final screen footage.

### Export the preview as MP4

```bash
npm run demo:export
# Optional: choose a different speed or output path
npm run demo:export -- --speed 1.2 --out /absolute/path/wreck-it.mp4
```

The default export is the same narrated storyboard at **1.2× speed**, approximately **57 seconds**, in **1920×1080 at 30 fps**. It uses H.264 video, AAC audio, pitch-preserving audio acceleration, and MP4 fast start. Captions remain visible in the video; a separately timed SRT and scene timing JSON are saved beside it for editing. The default files are in `.wreck-it/demo/exports/`. This export uses the existing narration and does not call a speech service.

## Prepare the recording environment

From the repository root:

```bash
npm run demo:prepare
npm run demo:verify
npm run demo:start
```

`demo:prepare` creates two isolated app copies under `.wreck-it/demo/`, installs the published **@miyanishar/wreck-it@0.2.0**, installs the pinned browser tools, and builds both apps. The corrected copy changes only the subtotal expression in `lib/cart.ts`. It excludes `.env` files and the benchmark answer key from both copies. The original demo app and benchmark stay unchanged.

`demo:verify` starts temporary local servers, replays the known bug twice in fresh contexts, captures screenshots, generates a candidate test with the published CLI, and runs that exact test against both copies. It checks the failing assertion and the passing result. The temporary servers stop afterward. The generated sample goes in [docs/demo/sample/](docs/demo/sample/).

`demo:start` keeps the recording apps running:

- Buggy app: <http://127.0.0.1:3100/login?next=/products/1>
- Corrected app: <http://127.0.0.1:3101/login?next=/products/1>
- Fake account on either copy: `demo@gadgetly.test` / `gadgetly123`

Keep the terminal open; Ctrl+C stops both servers. The apps use in-memory data, so restarting resets accounts, carts, and orders. Stop another service using port 3100 or 3101 before starting this setup.

For another take, restart `demo:start` and sign in again. To discard edits and rebuild the generated copies:

```bash
npm run demo:prepare -- --reset
```

Stop the demo servers first. This reset replaces only the generated app, corrected app, and replay workspace under `.wreck-it/demo/`.

## Record the actual agent segment

With `demo:start` still running, open a second terminal:

```bash
npm run demo:agent
```

This opens the installed Claude Code CLI in the buggy recording copy with this repository's local plugin. Paste [docs/demo/prompt.txt](docs/demo/prompt.txt). Other agents can use the same prompt in that app directory with the wreck-it skills and browser tools loaded; `/wreck` itself is the Claude Code plugin command.

Check that the browser tools are available before recording. If setup is needed, complete it and restart the agent first. Do not record npm downloads or tool installation delays. Capture the real prompt, scope, browser actions, and returned finding. Agent wording, duration, finding count, and finding IDs may vary.

Cut long waits and label the edit “time compressed.” If discovery misses the intended bug, rerun or use the labeled known-bug replay for that scene. Do not present replay footage as a new autonomous discovery result. The sample report is a scripted replay of one known defect; the live agent report is a separate artifact in `.wreck-it/demo/app/.wreck-it/`.

## Record the browser and evidence close-ups

1. In the buggy app, sign in and open `/products/1`. Add one pair of Aurora Wireless Earbuds to the cart.
2. Open `/cart`, change quantity to **3**, then press Tab. Wait for the line total to become **$239.97**. The subtotal remains **$79.99**.
3. Click Checkout. Hold the frame showing **Aurora Wireless Earbuds × 3**, **$239.97**, and **Total $79.99** together.
4. Show the finding with its relevant screenshot attached. The sample HTML report embeds its images and can be opened directly from disk.
5. Show `lib/cart.ts:19` in the generated app. The buggy expression is `sum + item.price`; the corrected copy uses `sum + item.lineTotal`.
6. Show [docs/demo/sample/WR-001.spec.ts](docs/demo/sample/WR-001.spec.ts), [test-results.txt](docs/demo/sample/test-results.txt), and [verification.json](docs/demo/sample/verification.json). The full raw Playwright results live under `.wreck-it/demo/replay/`. If filming a terminal replay, run `npm run demo:verify` and capture its real output.

The generated test creates a fresh fake account on every run. Its API calls arrange the cart; its browser steps change quantity and check checkout. Review generated tests before relying on them in your own app.

## AI voiceover and editing

Use the supplied narration rather than having the voice tool invent or rewrite product claims. Choose a neutral, warm English voice with a conversational pace. Add a short pause between scenes. Keep background music quiet or omit it so terminal and code explanations remain easy to follow.

For a local generation attempt with a neural online voice:

```bash
python3 -m venv .wreck-it/demo-voice-env
.wreck-it/demo-voice-env/bin/pip install -r docs/demo/voice-requirements.txt
.wreck-it/demo-voice-env/bin/python scripts/demo-voiceover.py
```

The script sends only the public narration text to the speech service. It produces individual MP3 clips, a combined voiceover, timing metadata, and subtitles under `.wreck-it/demo/media/`. Override the stock voice with `--voice <voice-name>`. It requires network access and never requests an account password or API key. See the [edge-tts project](https://github.com/rany2/edge-tts) for supported voices and usage.

After changing narration or regenerating the evidence, run `npm run demo:preview` to rebuild the preview and refresh its portable audio/caption assets.

Alternatively, paste [voiceover.txt](docs/demo/voiceover.txt) into [ElevenLabs Text to Speech](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech), choose an available narration voice, preview “wreck it” and the dollar amounts, and export the audio. Keep the wording intact. Use only a voice you are entitled to use.

In the editor, put the voiceover on the audio track, import the SRT captions, and cut the screen recording at each scene boundary. Narration should describe what is currently visible. Export an MP4 with H.264 video and AAC audio. Watch once with sound and once muted before adding it to the README.

## Completion

The selected CapCut edit is the final video, with a poster and sample report linked near the top of the README. The clip retains the seeded-app replay context. The video, poster, sample report, and production references are versioned with the project.
