# LocalWhisper Desktop

Cross-platform desktop application (Electron) for 100% local speech-to-text using `whisper.cpp` and custom models. No external services required.

## What it does

- UI to configure `whisper.cpp` binary, model, language, and extra args.
- In-app microphone recording.
- Local WAV 16 kHz conversion.
- `whisper.cpp` execution via local subprocess.
- System tray with status icon and controls.
- Configurable global shortcut to start/stop recording from any app.
- Automatic paste of transcribed text into the active input (when recording starts via shortcut).
- macOS permissions panel with button to open Accessibility settings.

## Requirements

- Node.js 20+
- A working `whisper.cpp` build (`whisper-cli` or `main` executable, depending on your version)
- A compatible model (`.bin`, `.gguf`, or whatever format your binary accepts)
- macOS: Microphone and Accessibility permissions

## Getting whisper.cpp and a model

LocalWhisper does **not** bundle the transcription engine. You provide your own
`whisper.cpp` build and model. Both are free and open source.

### 1. Build the `whisper.cpp` binary

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build -j --config Release
```

This produces the CLI binary at `build/bin/whisper-cli` (older versions name it
`main`). That is the path you set in **Whisper binary path** in the app.

> Build options for GPU acceleration (CUDA, Vulkan, Metal/Core ML, etc.) are
> documented in the [whisper.cpp README](https://github.com/ggml-org/whisper.cpp#quick-start).
> On macOS, Metal is enabled by default.

### 2. Download a model

From inside the `whisper.cpp` folder, use the bundled script:

```bash
# multilingual models
sh ./models/download-ggml-model.sh base      # good balance for most users
sh ./models/download-ggml-model.sh small
sh ./models/download-ggml-model.sh large-v3-turbo

# English-only variants (smaller / faster)
sh ./models/download-ggml-model.sh base.en
```

Models are saved as `models/ggml-<name>.bin`. That is the path you set in
**Model path** in the app. You can also download them manually from
[huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp).

### Model sizes (pick based on RAM and speed)

| Model    | Disk    | Memory  | Notes                          |
| -------- | ------- | ------- | ------------------------------ |
| `tiny`   | 75 MiB  | ~273 MB | Fastest, lowest accuracy       |
| `base`   | 142 MiB | ~388 MB | Recommended starting point     |
| `small`  | 466 MiB | ~852 MB | Better accuracy                |
| `medium` | 1.5 GiB | ~2.1 GB | High accuracy, slower          |
| `large`  | 2.9 GiB | ~3.9 GB | Best accuracy, needs more RAM  |

> LocalWhisper records and converts audio to 16 kHz, 16-bit mono WAV, which is
> exactly the format `whisper-cli` expects — no extra conversion needed.

## Installation

```bash
npm install
npm run dev
```

## Usage

### Configuration

1. Open the app.
2. Select the `whisper.cpp` binary path.
3. Select the model path.
4. Optional: configure language (`auto`, `en`, `es`, `ca`, ...).
5. Optional: add extra args (`-ng`, `-otxt`, etc.).
6. Optional: fill in the **Vocabulary prompt** and **Replacements** glossary (see below).
7. Configure the global shortcut (default: `CommandOrControl+Shift+Space`).
8. Click `Save Configuration`.

### Technical vocabulary and anglicisms

> Internals, limits and design decisions: [`docs/GLOSSARY.md`](docs/GLOSSARY.md).

Speech models have no idea of your private vocabulary. If you dictate technical
Catalan with English terms (`deploy`, `pull request`, `deadline`), the model
spells them phonetically in Catalan (`bac em`, `de l'Adlina`). Two layers fix
this, and both work with **any** model:

**1. Vocabulary prompt** — sent to the decoder as `--prompt <text>`. It biases
the decoder towards those spellings. Keep the list short: the app sends at most
600 characters, and whisper keeps the last ~224 tokens of that submitted text.
The live counter uses a conservative UTF-8 byte bound, not an exact token count,
and warns when the prompt may exceed the budget. It can warn even when the real
count fits. `Load starter list` fills a generic Catalan + English software
vocabulary that you can then edit. Example:

```
Kubernetes, deploy, backend, frontend, code review, pull request,
deadline, roadmap, dashboard, Grafana, logs, pipeline, build, staging,
bucket, sprint, Notion, meeting, team
```

**2. Replacements** — applied to the transcription after the model runs. One
rule per line, `wrong => right` (`->` and `=` also work), whole words only and
case-insensitive. Lines starting with `#` are ignored. Invalid lines are
reported under the field (with their line number) instead of being silently
skipped, and the `Try it` box shows what a given transcript would become.
Example:

```
bac em => backend
buquet d'estagint => bucket de staging
Pipalina => pipeline
desbord => dashboard
```

Measured behaviour on a Catalan sentence with English terms: without the prompt
the output is unusable for the technical words (`de ploi del bac em`, `co de
Raviev`); with the prompt plus two replacement rules it is letter-perfect.

The prompt layer pays off most on multilingual checkpoints (`large-v3`,
`large-v3-turbo`). Catalan-only fine-tunes tend to ignore it, because they were
trained to write English loanwords with Catalan spelling. The replacement layer
is completely independent of the model.

The glossary is global for the app: one vocabulary prompt and one rule list,
stored in your own `config.json`. Nothing is hardcoded and nothing is shared
between installations.

**Sharing and backups.** `Export…` writes a `localwhisper-glossary.txt` you can
commit, copy to another machine or send to a colleague. `Import…` reads it
back, shows a confirmation listing any invalid lines, and fills the fields —
you still have to click `Save Configuration`, like any other change. A file
without `[prompt]` / `[substitutions]` sections is treated as a plain rule
list, so pasting one around works without ceremony.

### Manual recording (in-app)

1. Click `Start Recording`, speak, then click `Stop & Transcribe`.
2. The text appears in the textarea. It is not automatically pasted into any other app.

### Global shortcut recording (system-wide dictation)

1. With the app open (window visible or hidden), switch to the target app.
2. Press the configured shortcut (default `Cmd+Shift+Space`).
3. Speak. The tray icon will pulse with a microphone animation.
4. Press the shortcut again to stop.
5. The tray icon changes to a pulsing ring (transcribing), then the text is pasted automatically into the active input via `Cmd+V`.

### System tray

- **Double-click** tray icon: show window.
- **Right-click** tray icon: menu with `Start Recording`, `Stop & Transcribe`, `Show/Hide Window`, `Quit`.
- Tray icon shows state:
  - Static microphone: idle.
  - Pulsing microphone: recording.
  - Pulsing ring: processing, transcribing, or pasting.
- Tray tooltip shows the current phase.

### Global shortcut

- The shortcut field accepts Electron accelerator format (`CommandOrControl+Shift+Space`).
- To configure: click the field and press the desired key combination (at least one modifier required: `CommandOrControl`, `Alt`, or `Shift`).
- If the shortcut is taken by another app, an error message is shown below the field.
- To disable it, click `Disable` or clear the field and save.
- The shortcut is registered immediately after saving, no restart needed.
- Only recordings started via shortcut trigger automatic paste.

### macOS permissions

The app needs two permissions:

- **Microphone**: requested automatically when the app opens.
- **Accessibility**: required for automatic paste (`Cmd+V`). The `macOS Permissions` panel has an `Open Accessibility Permissions` button that shows the native system dialog. If it doesn't work, manually add the app in **System Settings > Privacy & Security > Accessibility**.

In development mode (`npm run dev`), the app appears as **Electron** in system permissions. In the packaged build, it appears as **LocalWhisper**.

## Privacy

LocalWhisper Desktop processes all audio entirely on your device:

- **Audio capture** happens via your operating system's microphone API.
- **Audio conversion** (WAV encoding) happens locally in the renderer process.
- **Transcription** is performed by your local `whisper.cpp` binary spawned as a child process.
- **No audio or text is sent to any external service.** The app itself makes no network requests.
- The only data stored on disk is the configuration file (paths to your `whisper.cpp` binary, model, language, and shortcut preferences) in the Electron user data directory.

If you use the auto-paste feature (macOS only), transcribed text is temporarily placed in your system clipboard to simulate `Cmd+V`. The text remains in your clipboard after the operation.

## Packaging

```bash
npm run dist
```

Generates a `.dmg` in `dist/` for macOS. Linux builds produce `.AppImage`/`.deb`, Windows builds produce `.exe` (NSIS).

### Building from source (no certificate required)

You do **not** need any Apple Developer certificate to build and run LocalWhisper
yourself. Building locally is fully supported out of the box:

```bash
npm install
npm run dist        # produces dist/LocalWhisper-<version>.dmg
```

`electron-builder` uses ad-hoc signing when no Developer ID is configured, so the
`.dmg` is created and the app runs on the machine that built it without any
warnings.

A certificate (Apple Developer ID + notarization) is **only** needed if you want
to *distribute* the build to other people without macOS showing a security
prompt. See [Release build notes](#release-build-notes) below.

#### Opening a downloaded (unsigned) build on macOS

If you download a `.dmg` that was **not** notarized (e.g. a community build),
macOS Gatekeeper will block it on first launch because of the quarantine
attribute. Two ways to open it:

- **System Settings → Privacy & Security → Open Anyway**, or
- remove the quarantine flag from a terminal:

  ```bash
  xattr -dr com.apple.quarantine /Applications/LocalWhisper.app
  ```

This is expected for any unsigned macOS app and does not affect builds you
compiled yourself.

### Release build notes

**macOS:**
- The `.dmg` is produced by `electron-builder` and includes the app bundle.
- For distribution outside the Mac App Store, the app must be **notarized** by Apple. Without notarization, macOS Gatekeeper will block the app on first launch. Users can override this via **System Settings > Privacy & Security > Open Anyway**.
- To notarize, set the `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` environment variables before running `npm run dist`. Electron-builder will handle notarization automatically.
- Code signing requires a valid Apple Developer ID certificate.

**Windows:**
- The NSIS installer is unsigned by default. Windows SmartScreen may show a warning on first run.
- Code signing requires an Extended Validation (EV) or OV Code Signing Certificate.

**Linux:**
- AppImage and `.deb` packages are unsigned by default.
- Distribution can be done via Flathub, Snap Store, or direct download.

**Development builds:**
- Running `npm run dev` uses an unsigned development binary. OS security warnings are expected and can be dismissed.
- In development mode, the app appears as **Electron** in system permissions (not **LocalWhisper**).

## Development

```bash
npm run check                 # Syntax check all JS files
npm run dev                   # Run in development mode
npm run dist                  # Generate installable build
npm run generate:tray-icons   # Regenerate tray icons from code
```

## Troubleshooting

### Shortcut not responding

- Make sure the shortcut isn't taken by another app or the system.
- Check the status below the shortcut field: a red message means registration failed.
- Try a different key combination.

### Records but doesn't transcribe

- Verify the binary and model paths are correct.
- Make sure the binary has execute permissions (`chmod +x`).
- If you get an `exit 139` or `SIGSEGV` error, add `-ng` to `Extra args` to disable GPU on macOS.
- If `whisper.cpp` returns no text, try speaking longer or adjust the extra args.

### Transcribes but doesn't paste

- Grant Accessibility permissions to the app (Electron in dev, LocalWhisper in build).
- Go to **System Settings > Privacy & Security > Accessibility** and make sure the app is listed and enabled.
- On Windows/Linux, automatic paste is not supported. The text is in the clipboard — paste manually with `Ctrl+V`.
- If paste still fails, the text is available in the clipboard.

### Tray icon not visible

- On macOS, some apps can hide tray icons if the menu bar is full. Try closing other tray apps.

### Packaged app won't open

- macOS may block apps from unidentified developers. Go to **System Settings > Privacy & Security** and click `Open Anyway`.

### Silent audio

- Make sure the microphone has been granted permissions to the app.
- Check the microphone isn't muted physically or by the system.
- If the "Silent audio" message appears, try speaking closer to the microphone.

## Technical notes

- Transcription depends on the flags available in your `whisper.cpp` binary.
- By default, `-np -nt` and any args in `Extra args` are appended.
- The vocabulary prompt is passed as `--prompt <text>` (two separate argv entries, no quoting needed). If you already pass `--prompt` in `Extra args`, that one wins and the field is ignored. The app keeps the first 600 characters; whisper.cpp keeps the last ~224 tokens of that submitted text. The UI warns using a conservative UTF-8 byte upper bound, not a tokenizer count.
- Replacements are applied to the final text in `src/main/stt-service.js`, so they also affect automatic paste and the in-app textarea. Matching is whole-word and case-insensitive, longer keys first, and rules are applied in sequence.
- Glossary limits: 600 characters for the prompt, 4,000 for the rule list, 200 rules, 80 characters per left side, 128 KB per imported file. Oversized replacement lists are rejected on save, export and import, never cut mid-rule. Chained replacements stop with an error above 500,000 output characters or 100,000 matches.
- See [`docs/GLOSSARY.md`](docs/GLOSSARY.md) for the full mechanics, the IPC contract, and the rejected alternatives.
- If your binary doesn't support a flag, remove it from `Extra args` or adapt `src/main/stt-service.js`.
- Automatic paste is only supported on macOS (uses `osascript` + `System Events`). On Windows/Linux, the transcribed text is placed in the clipboard for manual paste.
- Audio capture runs in the renderer process via `getUserMedia`, transcription runs in the main process via `spawn`.
- Recording is limited to 5 minutes to prevent excessive memory usage.
