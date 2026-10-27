# Changelog

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
