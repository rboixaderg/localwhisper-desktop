# LocalWhisper Desktop (MVP)

Aplicacio d'escriptori multiplataforma (Electron) per fer speech-to-text en local amb `whisper.cpp` i models custom.

## Que fa aquest MVP

- UI d'escriptori per configurar ruta del binari i model.
- Gravacio de microfon dins la propia app.
- Conversio a WAV 16 kHz en local.
- Execucio de `whisper.cpp` via subprocess local.
- Sense API externa ni serveis de tercers.

## Requisits

- Node.js 20+
- Un build funcional de `whisper.cpp` (executable `main` o `whisper-cli` segons la teva versio)
- Un model compatible (`.bin` o format suportat pel teu binari)

## Instal·lacio

```bash
npm install
npm run dev
```

## Us

1. Obre l'app.
2. Selecciona la ruta del binari de `whisper.cpp`.
3. Selecciona la ruta del model.
4. Opcional: configura llengua (`auto`, `ca`, `es`, `en`, ...).
5. Prem `Guardar configuracio`.
6. Prem `Iniciar gravacio`, parla, i `Aturar i transcriure`.

## Packaging

```bash
npm run dist
```

Genera paquets per Linux, Windows i macOS segons la plataforma on compilis.

## Notes tecniques

- La transcripcio depen dels flags disponibles al teu binari de `whisper.cpp`.
- Per defecte s'afegeix `-np -nt` i els args configurats a `Args extra`.
- Si el teu binari no suporta algun flag, elimina'l a `Args extra` o adapta `src/main/stt-service.js`.
