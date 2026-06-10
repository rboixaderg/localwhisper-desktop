# LocalWhisper Desktop

Aplicacio d'escriptori multiplataforma (Electron) per fer speech-to-text 100% local amb `whisper.cpp` i models custom. Sense dependencia de cap servei extern.

## Que fa

- UI per configurar binari `whisper.cpp`, model, llengua i args extra.
- Gravacio de microfon dins la propia app.
- Conversio a WAV 16 kHz en local.
- Execucio de `whisper.cpp` via subprocess local.
- Tray/menu bar amb icona d'estat i controls.
- Shortcut global configurable per iniciar/aturar gravacio des de qualsevol app.
- Enganxat automatic del text transcrit a l'input actiu (quan la gravacio s'inicia via shortcut).
- Panel de permisos macOS amb boto per obrir els ajustos d'Accessibilitat.

## Requisits

- Node.js 20+
- Un build funcional de `whisper.cpp` (executable `whisper-cli` o `main` segons versio)
- Un model compatible (`.bin`, `.gguf` o el format que accepti el teu binari)
- macOS: permisos de Microfon i Accessibilitat

## Instal·lacio

```bash
npm install
npm run dev
```

## Us

### Configuracio

1. Obre l'app.
2. Selecciona la ruta del binari de `whisper.cpp`.
3. Selecciona la ruta del model.
4. Opcional: configura llengua (`auto`, `ca`, `es`, `en`, ...).
5. Opcional: afegeix args extra (`-ng`, `-otxt`, etc.).
6. Configura el shortcut global (per defecte `CommandOrControl+Shift+Space`).
7. Prem `Guardar configuracio`.

### Gravacio manual (dins l'app)

1. Prem `Iniciar gravacio`, parla, i prem `Aturar i transcriure`.
2. El text apareix al textarea. No s'enganxa automaticament a cap altra app.

### Gravacio amb shortcut global (dictat global)

1. Amb l'app oberta (finestra visible o amagada), ves a l'app on vols escriure.
2. Prem el shortcut configurat (per defecte `Cmd+Shift+Space`).
3. Parla. La icona del tray fara una pulsacio de microfon.
4. Torna a premer el shortcut per aturar.
5. La icona del tray canvia a un cercle pulsant (transcrivint) i despres s'enganxa el text automaticament a l'input actiu amb `Cmd+V`.

### Tray / menu bar

- **Doble clic** a la icona del tray: mostra la finestra.
- **Clic dret** al tray: menu amb `Iniciar gravacio`, `Aturar i transcriure`, `Mostrar/Amagar finestra`, `Sortir`.
- Icona del tray indica l'estat:
  - Microfon estatic: inactiu.
  - Microfon amb pulsacio: gravant.
  - Cercle amb pulsacio: processant, transcrivint o enganxant.
- Tooltip del tray mostra la fase actual.

### Shortcut global

- El camp de shortcut accepta combinacions en format Electron (`CommandOrControl+Shift+Space`).
- Per configurar-lo: fes clic al camp i prem la combinacio de tecles desitjada (cal com a minim un modificador: `CommandOrControl`, `Alt` o `Shift`).
- Si el shortcut esta ocupat per una altra app, es mostra un missatge d'error sota el camp.
- Per desactivar-lo, prem `Desactivar` o buida el camp i guarda.
- El shortcut es registra immediatament despres de guardar la configuracio, sense necessitat de reiniciar l'app.
- Nomes les gravacions iniciades amb shortcut enganxen automaticament el resultat.

### Permisos macOS

L'app necessita dos permisos:

- **Microfon**: es demana automaticament en obrir l'app.
- **Accessibilitat**: necessari per l'enganxat automatic (`Cmd+V`). El panel `Permisos macOS` te un boto `Obrir permisos d'Accessibilitat` que mostra el dialog natiu del sistema. Si no funciona, afegeix l'app manualment a **System Settings > Privacy & Security > Accessibility**.

En mode desenvolupament (`npm run dev`), l'app apareix com a **Electron** als permisos del sistema. En la build empaquetada, apareix com a **LocalWhisper**.

## Packaging

```bash
npm run dist
```

Genera `.dmg` a `dist/` per macOS. Per Linux genera `.AppImage`/`.deb`, per Windows `.exe` (NSIS).

## Troubleshooting

### El shortcut no respon

- Verifica que el shortcut no estigui ocupat per una altra app o pel sistema.
- Comprova l'estat sota el camp de shortcut: si hi ha un missatge en vermell, el registre ha fallat.
- Prova una combinacio diferent.

### Grava pero no transcriu

- Verifica que les rutes del binari i del model son correctes.
- Comprova que el binari te permisos d'execucio (`chmod +x`).
- Si hi ha error `exit 139` o `SIGSEGV`, afegeix `-ng` a `Args extra` per desactivar GPU a macOS.
- Si `whisper.cpp` no retorna text, prova de parlar mes estona o ajusta els args extra.

### Transcriu pero no enganxa

- Concedeix permisos d'Accessibilitat a l'app (Electron en dev, LocalWhisper en build).
- Ves a **System Settings > Privacy & Security > Accessibility** i assegura't que l'app hi es i esta activada.
- Si el problema persisteix, el text queda al porta-retalls (pots enganxar-lo manualment amb `Cmd+V`).

### La icona del tray no es veu

- En macOS, algunes apps poden ocultar icones del tray si la barra de menu esta plena. Prova de tancar altres apps amb icones de tray.

### L'app empaquetada no s'obre

- macOS pot bloquejar apps de desenvolupadors no identificats. Ves a **System Settings > Privacy & Security** i clica `Open Anyway`.

### Audio silencios

- Verifica que el microfon te permisos concedits a l'app.
- Comprova que el microfon no esta silenciat fisicament o pel sistema.
- Si el missatge "Audio silencios" apareix, parla mes a prop del microfon.

## Notes tecniques

- La transcripcio depen dels flags disponibles al teu binari de `whisper.cpp`.
- Per defecte s'afegeix `-np -nt` i els args configurats a `Args extra`.
- Si el teu binari no suporta algun flag, elimina'l a `Args extra` o adapta `src/main/stt-service.js`.
- L'enganxat automatic a macOS es fa via `osascript` + `System Events`. En Windows/Linux no esta implementat en aquesta versio.
- La captura d'audio es fa al proces renderer amb `getUserMedia`, la transcripcio al proces main amb `spawn`.

## Desenvolupament

```bash
npm run check          # Verifica sintaxi de tots els fitxers JS
npm run dev            # Executa en mode desenvolupament
npm run dist           # Genera build instal·lable
npm run generate:tray-icons  # Regenera les icones del tray
```
