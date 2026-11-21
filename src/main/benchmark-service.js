const { summarizeConfig, RUN_ID_PATTERN } = require('./benchmark-store');

/**
 * Orchestrates dictation runs on top of the benchmark store and the
 * transcription service. It keeps the two concerns apart: the store only
 * persists data, and `stt` only runs Whisper / applies replacement rules.
 *
 *   stt.transcribeRaw({ audioBase64, config })   -> raw Whisper text
 *   stt.applyPostProcessing(rawText, config)     -> final text
 */
function createBenchmarkService({ store, stt, now = Date.now }) {
  async function failRun(id, run, error) {
    try {
      await store.addRun(id, { ...run, error: error.message || String(error) });
    } catch {
      // Recording the failure is best effort; the original error wins.
    }
  }

  /**
   * Live dictation. Saves the audio first (when enabled), so an error while
   * transcribing never loses the recording.
   */
  async function dictate({ audioBase64, source, config }) {
    const result = { text: '', rawText: '', benchmarkId: null, benchmarkError: '' };
    let id = null;

    if (config.saveBenchmarks === true) {
      try {
        const meta = await store.createDictation({
          audio: Buffer.from(audioBase64, 'base64'),
          language: config.language,
          source
        });
        id = meta.id;
        result.benchmarkId = id;
      } catch (error) {
        result.benchmarkError = error.message || 'Could not save the dictation.';
      }
    }

    const settings = summarizeConfig(config);
    const started = now();

    let rawText;
    try {
      rawText = await stt.transcribeRaw({ audioBase64, config });
    } catch (error) {
      if (id) {
        await failRun(id, { kind: 'initial', settings, elapsedMs: now() - started }, error);
        error.message += ' The audio was kept in Saved dictations.';
      }
      throw error;
    }

    let text;
    try {
      text = stt.applyPostProcessing(rawText, config);
    } catch (error) {
      if (id) {
        await failRun(id, { kind: 'initial', rawText, settings, elapsedMs: now() - started }, error);
        error.message += ' The audio and raw text were kept in Saved dictations.';
      }
      throw error;
    }

    result.rawText = rawText;
    result.text = text;

    if (id) {
      try {
        await store.addRun(id, { kind: 'initial', rawText, text, settings, elapsedMs: now() - started });
      } catch (error) {
        result.benchmarkError = error.message || 'Could not save the result.';
      }
    }

    return result;
  }

  /**
   * Re-applies the current replacement rules to a saved raw transcript.
   * Never runs Whisper. Defaults to the latest run that has raw text.
   */
  async function reprocess(id, baseRunId, config) {
    const meta = await store.getDictation(id);
    let base;
    if (baseRunId) {
      if (!RUN_ID_PATTERN.test(baseRunId)) throw new Error('Invalid run id.');
      base = meta.runs.find((run) => run.id === baseRunId);
    } else {
      base = [...meta.runs].reverse().find((run) => typeof run.rawText === 'string');
    }
    if (!base || typeof base.rawText !== 'string') {
      throw new Error('This dictation has no raw transcript to reprocess. Re-transcribe the audio instead.');
    }

    // The raw text came from the base run's Whisper settings; only the
    // replacement rules are current.
    const settings = {
      whisper: base.settings && base.settings.whisper ? base.settings.whisper : summarizeConfig({}).whisper,
      postprocess: summarizeConfig(config).postprocess
    };
    const started = now();

    let text;
    try {
      text = stt.applyPostProcessing(base.rawText, config);
    } catch (error) {
      await failRun(id, { kind: 'reprocess', basedOnRunId: base.id, rawText: base.rawText, settings }, error);
      throw error;
    }

    return store.addRun(id, {
      kind: 'reprocess',
      basedOnRunId: base.id,
      rawText: base.rawText,
      text,
      settings,
      elapsedMs: now() - started
    });
  }

  /** Runs Whisper again on the saved audio with the current configuration. */
  async function retranscribe(id, config) {
    const audio = await store.getAudio(id);
    const settings = summarizeConfig(config);
    const started = now();

    let rawText;
    try {
      rawText = await stt.transcribeRaw({ audioBase64: audio.toString('base64'), config });
    } catch (error) {
      await failRun(id, { kind: 'retranscribe', settings, elapsedMs: now() - started }, error);
      throw error;
    }

    let text;
    try {
      text = stt.applyPostProcessing(rawText, config);
    } catch (error) {
      await failRun(id, { kind: 'retranscribe', rawText, settings, elapsedMs: now() - started }, error);
      throw error;
    }

    return store.addRun(id, { kind: 'retranscribe', rawText, text, settings, elapsedMs: now() - started });
  }

  return { dictate, reprocess, retranscribe };
}

module.exports = { createBenchmarkService };
