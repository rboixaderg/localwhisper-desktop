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
6. Configure the global shortcut (default: `CommandOrControl+Shift+Space`).
7. Click `Save Configuration`.

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

## Packaging

```bash
npm run dist
```

Generates a `.dmg` in `dist/` for macOS. Linux builds produce `.AppImage`/`.deb`, Windows builds produce `.exe` (NSIS).

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
- If it still fails, the text is available in the clipboard (you can paste manually with `Cmd+V`).

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
- If your binary doesn't support a flag, remove it from `Extra args` or adapt `src/main/stt-service.js`.
- Automatic paste on macOS uses `osascript` + `System Events`. Not implemented for Windows/Linux in this version.
- Audio capture runs in the renderer process via `getUserMedia`, transcription runs in the main process via `spawn`.

## Development

```bash
npm run check                 # Syntax check all JS files
npm run dev                   # Run in development mode
npm run dist                  # Generate installable build
npm run generate:tray-icons   # Regenerate tray icons from code
```
