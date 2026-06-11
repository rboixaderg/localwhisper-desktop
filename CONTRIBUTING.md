# Contributing to LocalWhisper Desktop

Thank you for your interest in contributing.

## Getting started

1. Fork the repository.
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/localwhisper-desktop.git
   cd localwhisper-desktop
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run in development mode:
   ```bash
   npm run dev
   ```

## Development workflow

- Run `npm run check` before committing to verify syntax.
- Generate tray icons after modifying `scripts/generate-tray-icons.js`:
  ```bash
  npm run generate:tray-icons
  ```
- Build the packaged app:
  ```bash
  npm run dist
  ```

## Code style

- Use existing patterns from the codebase.
- Keep changes minimal and focused.
- Avoid adding external dependencies unless absolutely necessary.
- The project targets macOS as the primary platform. Cross-platform contributions are welcome but macOS-specific code should be clearly documented.

## Project structure

```
src/
  main/          Electron main process
    main.js          App lifecycle, IPC handlers
    config-store.js  Configuration persistence
    stt-service.js   whisper.cpp subprocess
    paste-service.js Clipboard + paste automation
    tray-manager.js  System tray icon and menu
    overlay-window.js  On-screen status overlay
    preload.js       Main window preload
    preload-overlay.js  Overlay window preload
  renderer/       Electron renderer (UI)
    index.html       Main window
    renderer.js      Main window logic
    overlay.html     Status overlay window
    styles.css       Main window styles
  shared/         Code shared across processes
    audio-utils.js   Audio capture and WAV encoding
    overlay.js       Overlay renderer logic
  assets/         Icons and images
build/           macOS entitlements, app icon
scripts/         Build and utility scripts
```

## Reporting issues

Before opening an issue, check:
- The [Troubleshooting](README.md#troubleshooting) section in the README.
- Existing open issues.

When reporting, include:
- macOS version
- `whisper.cpp` binary version
- Steps to reproduce
- Expected vs actual behavior
