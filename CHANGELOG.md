# Changelog

## Unreleased

### Added

- Opt-in **Save dictations for benchmarks** setting (off by default) that keeps the audio (WAV), raw Whisper transcript and final text of each completed dictation on the device.
- Saved dictations panel: reprocess the raw text with the current rules, re-transcribe the saved audio, compare runs side by side, add a manual reference transcript, and delete one or all dictations with disk usage shown. The panel shows the storage location and can open it; `LOCALWHISPER_DATA_DIR` overrides the base folder.

### Changed

- `stt-service.js` now exposes the raw Whisper transcript (`transcribeRaw`) and the replacement step (`applyPostProcessing`) separately.
- The `stt:transcribe` IPC call returns `{ text, rawText, benchmarkId, benchmarkError }` instead of a plain string.

## 1.1.0

### Added

- Global vocabulary prompt to help Whisper transcribe technical terms and names.
- Post-transcription replacement rules with live validation and a sample-text preview.
- Starter vocabulary for mixed Catalan and English software terminology.
- Glossary import and export as editable text files.
- Running app version in the main window header and title.

### Fixed

- Reject oversized replacement lists instead of cutting rules mid-word.
- Limit chained replacement expansion and report failures in the preview.
- Skip unknown glossary sections and preserve original file lines in import diagnostics.
- Warn about token-dense prompts using a conservative upper bound and correct the advice about Whisper retaining the end of overflowing prompts.

### Changed

- Update Electron to 45 and electron-builder to 26.18 to address development dependency advisories.
