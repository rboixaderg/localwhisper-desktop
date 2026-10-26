# Glossary internals: vocabulary prompt + replacements

This document explains what the glossary does, where it acts, and why it is
split into two layers. The README covers usage; this file covers mechanics,
limits and the reasons behind the design.

## 1. The problem

Speech-to-text models have no idea of your private vocabulary. Dictating
technical Catalan with English terms produces phonetic Catalan instead:

| You say | Stock `large-v3` writes |
| --- | --- |
| `deploy` | `de ploi` |
| `backend` | `bac em` |
| `code review` | `co de Raviev` |
| `deadline` | `de Adlina` |
| `pipeline` | `Pipalina` |

Two independent layers address this. They never talk to each other: one tries
to make the model produce the right tokens, the other repairs what the model got
wrong anyway.

## 2. Where the text changes

```
 microphone
     │
     ▼
 renderer: getUserMedia → 16 kHz mono WAV
     │
     ▼  base64 over IPC
 main: stt-service.transcribeAudio()
     │
     │  spawn whisper-cli -m MODEL -f input.wav -np -nt \
     │                    --prompt "<vocabulary>"  -l ca
     ▼
 ┌──────────────────────────────────────────────┐
 │ whisper.cpp (child process, fresh each run)  │
 │                                              │
 │  audio → encoder → embeddings                │
 │                        ↓                     │
 │  prompt → tokens →  decoder  ← embeddings    │
 │                        ↓                     │
 │                 generated text               │
 └──────────────────────────────────────────────┘
     │
     ▼  stdout or sidecar .txt
 main: applySubstitutions()          ← replacement layer
     │
     ▼  final text over IPC
 renderer textarea   /   main: clipboard + Cmd+V
```

**Layer 1 is inside the model, before generation.**
**Layer 2 is a plain string operation in Node, after generation.**

## 3. Layer 1 — the vocabulary prompt

### 3.1 Why a prompt works at all

Whisper is an encoder–decoder transformer. The encoder turns the audio into
embeddings; the decoder then generates the transcript token by token, and each
token is chosen from a probability distribution conditioned on (a) those
embeddings and (b) the tokens already produced.

`--prompt` injects tokens as if they had already been produced, before decoding
starts:

```
[Kubernetes][,][ deploy][,][ pull request][,][ deadline] → then the audio is transcribed
```

This is conditioning, not instruction. The model does not "read" the glossary
and obey it; the prompt only shifts probabilities towards spellings the model
already knows. That distinction explains every limitation below.

### 3.2 Budget and truncation

whisper.cpp uses at most `n_text_ctx / 2` tokens for the initial prompt, which
is **224 tokens** for the models this app targets. Anything beyond that is
dropped silently, so the order matters: put your most frequent terms first.
The UI shows an estimate (`characters / 4`) and turns red above the limit.

### 3.3 What it cannot do

- **It cannot teach a word.** If the weights never saw that spelling in that
  context, no prompt fixes it.
- **It is not reliable on Catalan-only fine-tunes.** Measured on
  `BSC-LT/whisper-large-v3-ca-punctuated-3370h`: the same prompt is ignored,
  loanwords keep Catalan spelling and get capitalised (`Sprint Planning`,
  `Grafanai`, `Pipalina`). Those models were trained to write English loanwords
  the Catalan way, so the prompt fights the weights and loses.
- **It does not persist.** Every recording spawns a new `whisper-cli`; there is
  no memory between dictations. The app re-sends the prompt every time.
- **It cannot be validated.** There is no way to know whether the model used
  it. Only the output tells you.

For long recordings, whisper.cpp also offers `--carry-initial-prompt`, which
re-prepends the prompt on every window. It is not enabled by default because it
increases the chance of repetition loops; add it to *Extra args* if you dictate
long texts and see consistency drift.

### 3.4 Code path

`src/main/stt-service.js` → `buildArgs()`:

```js
const prompt = normalizeGlossaryPrompt(glossaryPrompt);
const hasPromptArg = parsedExtra.some((a) => a === '--prompt' || a.startsWith('--prompt='));
if (prompt && !hasPromptArg) args.push('--prompt', prompt);
```

The prompt is passed as two separate argv entries, so commas, apostrophes and
quotes need no escaping. If you write `--prompt` yourself in *Extra args*, yours
wins and the field is ignored.

## 4. Layer 2 — replacements

Runs in the main process on the finished transcript, for every return path
(sidecar `.txt`, stdout, fallback), before the text is sent back to the
renderer or pasted.

### 4.1 Matching semantics

| Rule | Behaviour |
| --- | --- |
| Syntax | `wrong => right`, `wrong -> right`, `wrong = right` |
| Scope | Whole words only, using Unicode boundaries (`\p{L}`, `\p{N}`, `_`) |
| Case | Case-insensitive matching; replacement is inserted verbatim |
| Multi-word keys | Allowed; whitespace in the key matches any run of spaces |
| Order | Longer keys first, so `pull request` wins over `pull` |
| Chaining | Rules are applied sequentially: output of one rule can be matched by a later one |
| Literalness | The right side is inserted literally (`$&` is not expanded) |
| Comments | Lines starting with `#`, and blank lines, are ignored |

Because it is whole-word, `desbord => dashboard` leaves `desbordament` alone.

### 4.2 Limits

| Limit | Value | Enforced in |
| --- | --- | --- |
| Prompt length | 600 characters | `sanitizeConfig` |
| Replacements length | 4,000 characters | `sanitizeConfig` |
| Rules per list | 200 | `validateSubstitutions` |
| Left side length | 80 characters | `validateSubstitutions` |
| Imported file size | 128 KB | `main.js` (`fs.stat` before read) |

### 4.3 What it cannot do

- **It has no context.** If you legitimately dictate the "wrong" form, it gets
  rewritten too. This is the price of being deterministic.
- **It cannot fix meaning**, only strings. A wrong word you never listed stays
  wrong.
- **It does not touch text already pasted** into another app.
- **It cannot be validated against audio**, only against sample text (`Try it`).

### 4.4 Code path

`src/shared/glossary.js` → `applySubstitutions(text, rules)`, called from
`finish()` in `transcribeAudio()`.

## 5. Configuration and storage

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `glossaryPrompt` | string | `''` | Stored already normalized: single line, comma separated |
| `substitutions` | string | `''` | Stored raw, one rule per line |

Storage is the app's `config.json`, one file per user:

| Platform | Path |
| --- | --- |
| macOS (packaged) | `~/Library/Application Support/LocalWhisper/config.json` |
| macOS (`npm run dev`) | `~/Library/Application Support/Electron/config.json` |
| Windows | `%APPDATA%\LocalWhisper\config.json` |
| Linux | `~/.config/LocalWhisper/config.json` |

The glossary is **global for the app**: one prompt and one rule list, not one
per model or per language. Nothing is hardcoded and nothing is shared between
installations. The schema leaves room to add per-profile glossaries later
without migrating existing files.

## 6. Glossary files

`Export…` / `Import…` use plain text, so the file survives email, Git and
manual editing:

```
# LocalWhisper glossary v1
# Share this file, or keep it as a backup. Edit it with any text editor.

[prompt]
Kubernetes, deploy, pull request, deadline

[substitutions]
bac em => backend
buquet d'estagint => bucket de staging
```

Parser behaviour:

- Comments (`#`) and blank lines are ignored.
- CRLF (Windows) and LF both work.
- A file **without sections** is treated as a plain rule list, so pasting a
  rules file around works with no ceremony.
- An unknown section (e.g. `[modelos]`) is reported with its line number and
  skipped; the rest of the file still loads.
- Invalid rules are reported line by line; the valid ones still load.
- Empty or larger-than-128 KB files are rejected.
- Import **fills the fields but never saves**: you still press
  `Save Configuration`.

## 7. UI feedback contract

Validation, the token estimate and the preview all come from one IPC call,
`glossary:describe` (`src/main/main.js`). The renderer never re-implements the
parsing rules.

Request:

```json
{ "glossaryPrompt": "Kubernetes, deploy", "substitutions": "bac em => backend", "sampleText": "el bac em" }
```

Response:

```json
{
  "ruleCount": 1,
  "problems": [{ "line": 3, "text": "Pipalina", "reason": "missing separator (use =>, -> or =)" }],
  "promptTokens": 5,
  "promptTokenLimit": 224,
  "preview": "el backend",
  "starterPrompt": "Kubernetes, deploy, release, ..."
}
```

`promptTokens` is a `characters / 4` estimate, not a real BPE count: whisper's
tokenizer is not available in the app. It is accurate enough to warn before
silent truncation, not to optimise a prompt to the last token.

## 8. Measured behaviour

Two Catalan sentences with English terms, macOS Catalan TTS voice (Montserrat),
16 kHz mono, `-l ca`, `ggml-large-v3.bin`:

| Configuration | Result for the technical terms |
| --- | --- |
| No glossary | `l'esprim planint`, `de ploi del bac em`, `co de Raviev`, `buquet destegint`, `vil del Pipelín` |
| Prompt only | `sprint planning`, `deploy`, `code review`, `dashboard`, `logs`, `pipeline`, `build` okay; `bac em`, `buquet d'estagint` remain |
| Prompt + 3 rules | letter-perfect |

Caveats: synthetic speech, two sentences, one voice. The gains are large and
qualitative (unusable → usable), not a WER benchmark.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Prompt has no effect | Catalan-only fine-tune | Use a multilingual model (`large-v3`, `large-v3-turbo`) |
| Prompt has partial effect | Model too small (turbo) | Use `large-v3`, or cover the rest with rules |
| Token counter is red | Over 224 tokens | Reorder: most frequent first, delete the rest |
| A rule never fires | Left side does not match the actual output | Copy the wrong text from a real transcript |
| A rule fires too often | Left side is a common word | Use a more specific key, or delete the rule |
| Text changes that you did not want | Rule applied to legitimate text | Remove the rule; there is no context detection |
| Imported file complains | Unknown section or invalid line | Fix the line, or delete the `[...]` header |

## 10. Rejected options and non-goals

| Option | Why not |
| --- | --- |
| Per-profile glossaries | Users switch model rarely; global is simpler. Schema stays compatible |
| "Add rule" from a text selection | Produces one-off rules from whole sentences; better to learn from correction pairs later |
| LLM post-correction pass | Adds 1–2 s per phrase and can rewrite, summarise or invent content. Unacceptable for dictation |
| Fine-tuning on your own audio | Needs 10–50 h of transcribed audio and risks degrading everything else |
| `--carry-initial-prompt` by default | Raises the chance of repetition loops on long audio |

## 11. Test coverage

`test/main.test.js` covers the pure logic, so none of it needs Electron:

| Suite | Covers |
| --- | --- |
| `normalizeGlossaryPrompt` | separators, quotes, length cap |
| `parseSubstitutions` / `validateSubstitutions` | syntax, comments, duplicates, reported line numbers |
| `applySubstitutions` | whole words, case folding, multi-word keys, ordering, `$` literalness |
| `estimatePromptTokens` / `starterPrompt` | budget accuracy, starter list stays generic and under the cap |
| `serializeGlossary` / `parseGlossaryFile` | round-trip, CRLF, headerless files, unknown sections, size guard |
| `buildArgs` | prompt passed as two argv entries, not duplicated, language flag |
| `sanitizeConfig glossary fields` | defaults, normalization, caps, non-string input |
