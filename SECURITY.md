# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the latest release only.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | Yes                |
| < Latest| No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in LocalWhisper Desktop, please report it privately rather than opening a public issue.

**How to report:**

- Send an email to **rboixaderg@gmail.com** with a detailed description of the vulnerability.
- Include steps to reproduce, affected versions, and any potential impact.
- Allow up to **7 days** for an initial response.

**What to expect:**

1. We will acknowledge receipt of your report within 7 days.
2. We will investigate and confirm the vulnerability.
3. We will release a fix as soon as possible, typically within 30 days.
4. We will credit you in the release notes (unless you prefer to remain anonymous).

**Scope:**

This policy covers the LocalWhisper Desktop application code, its build configuration, and its dependencies (Electron, electron-builder).

LocalWhisper Desktop relies on external binaries (whisper.cpp and its models) for transcription. Vulnerabilities in those projects should be reported directly to their respective maintainers.

## Security Best Practices for Users

- Always build `whisper.cpp` from a trusted source or official repository.
- Keep both the application and your whisper.cpp binary up to date.
- Review the model files you download; only use models from trusted sources.
- The application stores configuration (including binary and model paths) locally in the Electron user data directory. No configuration is sent to any external service.
- Audio is recorded, processed, and transcribed entirely on your device. No audio data leaves your machine.
