// Saved dictations panel: list, side-by-side comparison of runs, reference
// transcript, reprocess / re-transcribe and deletion. Plain DOM + textContent
// only; all data comes from the main process over IPC.
(function initBenchmarksUi() {
  const api = window.localWhisperApi;
  const $ = (id) => document.getElementById(id);

  const els = {
    usage: $('benchmarkUsage'),
    status: $('benchmarkStatus'),
    list: $('benchmarkList'),
    refresh: $('refreshBenchmarks'),
    openFolder: $('openBenchmarksFolder'),
    directory: $('benchmarkDirectory'),
    deleteAll: $('deleteAllBenchmarks'),
    detail: $('benchmarkDetail'),
    title: $('benchmarkTitle'),
    audio: $('benchmarkAudio'),
    reprocess: $('reprocessBenchmark'),
    retranscribe: $('retranscribeBenchmark'),
    remove: $('deleteBenchmark'),
    runs: $('benchmarkRuns'),
    reference: $('benchmarkReference'),
    saveReference: $('saveReference')
  };

  const KIND_LABELS = {
    initial: 'Original dictation',
    reprocess: 'Reprocessed text',
    retranscribe: 'Re-transcribed audio'
  };

  let selectedId = null;
  let selectedHasRawText = false;
  let audioUrl = null;
  let audioForId = null;
  let busy = false;

  function setStatus(text, isError = false) {
    els.status.textContent = text || '';
    els.status.style.color = isError ? '#9f1d1d' : '#1f7a5a';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(ms) {
    return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : 'unknown duration';
  }

  function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    for (const child of children) node.appendChild(child);
    return node;
  }

  function syncButtons() {
    els.reprocess.disabled = busy || !selectedHasRawText;
    for (const button of [els.retranscribe, els.remove, els.saveReference, els.deleteAll]) {
      button.disabled = busy;
    }
    for (const button of els.runs.querySelectorAll('button')) {
      button.disabled = busy;
    }
  }

  function setBusy(value) {
    busy = value;
    syncButtons();
  }

  function syncSelectionHighlight() {
    for (const li of els.list.children || []) {
      li.className = li.dataset && li.dataset.id === selectedId ? 'selected' : '';
    }
  }

  async function run(label, task, targetId = null) {
    if (busy) return;
    setBusy(true);
    setStatus(label);
    try {
      await task();
    } catch (error) {
      setStatus(error.message || 'Operation failed.', true);
      // A failed run is stored too; refresh the view without clobbering a
      // different dictation the user switched to while this run was in flight.
      if (targetId && selectedId === targetId) {
        await openDictation(targetId, true).catch(() => {});
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    let result;
    try {
      result = await api.listBenchmarks();
    } catch (error) {
      setStatus(error.message || 'Could not load saved dictations.', true);
      return;
    }

    const { dictations, usage, directory } = result;
    els.directory.textContent = directory || '-';
    els.usage.textContent = usage.count
      ? `${usage.count} saved dictation${usage.count === 1 ? '' : 's'} · ${formatBytes(usage.bytes)} on disk`
      : 'No saved dictations';

    els.list.replaceChildren();
    for (const item of dictations) {
      const li = el('li', { className: item.id === selectedId ? 'selected' : '' }, [
        el('div', {
          text: `${formatDate(item.createdAt)} · ${formatDuration(item.durationMs)} · ${item.language}`
        }),
        el('div', {
          className: 'meta',
          text: `${item.runCount} run${item.runCount === 1 ? '' : 's'}${item.hasReference ? ' · reference' : ''}${item.preview ? ' · ' + item.preview : ''}`
        })
      ]);
      li.dataset.id = item.id;
      li.addEventListener('click', () => {
        openDictation(item.id).catch((error) => setStatus(error.message, true));
      });
      els.list.appendChild(li);
    }

    if (selectedId && !dictations.some((d) => d.id === selectedId)) closeDetail();
  }

  function closeDetail() {
    selectedId = null;
    selectedHasRawText = false;
    els.detail.hidden = true;
    els.runs.replaceChildren();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    els.audio.removeAttribute('src');
    audioForId = null;
    syncButtons();
  }

  function base64ToBlob(base64, type) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function loadAudio(id) {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    audioForId = id;
    els.audio.removeAttribute('src');
    try {
      const base64 = await api.getBenchmarkAudio(id);
      if (selectedId !== id) return;
      audioUrl = URL.createObjectURL(base64ToBlob(base64, 'audio/wav'));
      els.audio.src = audioUrl;
    } catch (error) {
      setStatus(error.message || 'Could not load the audio.', true);
    }
  }

  function settingsSummary(settings) {
    const w = (settings && settings.whisper) || {};
    const p = (settings && settings.postprocess) || {};
    const rules = (p.substitutions || '')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#')).length;
    return [
      `model: ${w.model || '-'}`,
      `language: ${w.language || 'auto'}`,
      `args: ${w.extraArgs || '-'}`,
      `prompt: ${w.glossaryPrompt || '-'}`,
      `rules: ${rules}`,
      p.substitutions ? `\n${p.substitutions}` : ''
    ].join('\n');
  }

  function textBlock(label, text) {
    return [el('div', { className: 'label', text: label }), el('pre', { text })];
  }

  function runCard(runItem, index, numbers) {
    const meta = [formatDate(runItem.createdAt), `v${runItem.appVersion || '?'}`];
    if (Number.isFinite(runItem.elapsedMs)) meta.push(`${(runItem.elapsedMs / 1000).toFixed(1)} s`);
    if (runItem.basedOnRunId && numbers.has(runItem.basedOnRunId)) {
      meta.push(`from raw of #${numbers.get(runItem.basedOnRunId)}`);
    }

    const children = [
      el('h4', { text: `#${index + 1} ${KIND_LABELS[runItem.kind] || runItem.kind}` }),
      el('p', { className: 'meta', text: meta.join(' · ') })
    ];

    if (runItem.error) {
      children.push(el('p', { className: 'error', text: `Error: ${runItem.error}` }));
    }
    if (typeof runItem.rawText === 'string') children.push(...textBlock('Raw Whisper text', runItem.rawText));
    if (typeof runItem.text === 'string') children.push(...textBlock('Final text', runItem.text));

    const details = el('details', {}, [
      el('summary', { text: 'Settings used' }),
      el('pre', { text: settingsSummary(runItem.settings) })
    ]);
    children.push(details);

    if (typeof runItem.rawText === 'string') {
      const button = el('button', { text: 'Reprocess this raw text' });
      button.disabled = busy;
      button.addEventListener('click', () => reprocess(runItem.id));
      children.push(button);
    }

    return el('div', { className: 'run-card' }, children);
  }

  function render(meta) {
    selectedHasRawText = meta.runs.some((r) => typeof r.rawText === 'string');
    els.title.textContent =
      `${formatDate(meta.createdAt)} · ${formatDuration(meta.durationMs)} · ${meta.language} · ${meta.source}`;
    els.reference.value = meta.reference ? meta.reference.text : '';

    const numbers = new Map(meta.runs.map((r, i) => [r.id, i + 1]));
    els.runs.replaceChildren();

    if (meta.reference) {
      els.runs.appendChild(
        el('div', { className: 'run-card reference' }, [
          el('h4', { text: 'Reference' }),
          el('p', { className: 'meta', text: `Saved ${formatDate(meta.reference.updatedAt)}` }),
          el('pre', { text: meta.reference.text })
        ])
      );
    }
    meta.runs.forEach((r, i) => els.runs.appendChild(runCard(r, i, numbers)));
    syncButtons();
  }

  async function openDictation(id, keepStatus = false) {
    selectedId = id;
    syncSelectionHighlight();
    const meta = await api.getBenchmark(id);
    if (selectedId !== id) return;
    els.detail.hidden = false;
    render(meta);
    if (!keepStatus) setStatus('');
    if (audioForId !== id) await loadAudio(id);
  }

  function reprocess(runId) {
    const id = selectedId;
    if (!id) return Promise.resolve();
    return run('Reprocessing the saved raw text…', async () => {
      await api.reprocessBenchmark(id, runId);
      if (selectedId === id) await openDictation(id, true);
      await refresh();
      setStatus('Reprocessed. Saved as a new run.');
    }, id);
  }

  els.reprocess.addEventListener('click', () => reprocess());

  els.retranscribe.addEventListener('click', () => {
    const id = selectedId;
    if (!id) return;
    run('Transcribing the saved audio…', async () => {
      await api.retranscribeBenchmark(id);
      if (selectedId === id) await openDictation(id, true);
      await refresh();
      setStatus('Transcribed again. Saved as a new run.');
    }, id);
  });

  els.saveReference.addEventListener('click', () => {
    const id = selectedId;
    if (!id) return;
    run('Saving reference…', async () => {
      const meta = await api.setBenchmarkReference(id, els.reference.value);
      if (selectedId === id) render(meta);
      await refresh();
      setStatus(meta.reference ? 'Reference saved.' : 'Reference removed.');
    }, id);
  });

  els.remove.addEventListener('click', () => {
    const id = selectedId;
    if (!id) return;
    if (!window.confirm('Delete this dictation, its audio and all its runs? This cannot be undone.')) return;
    run('Deleting…', async () => {
      await api.deleteBenchmark(id);
      if (selectedId === id) closeDetail();
      await refresh();
      setStatus('Dictation deleted.');
    }, id);
  });

  els.deleteAll.addEventListener('click', () => {
    if (!window.confirm('Delete ALL saved dictations, with their audio and runs? This cannot be undone.')) return;
    run('Deleting…', async () => {
      const count = await api.deleteAllBenchmarks();
      closeDetail();
      await refresh();
      setStatus(`Deleted ${count} dictation${count === 1 ? '' : 's'}.`);
    });
  });

  els.refresh.addEventListener('click', refresh);

  els.openFolder.addEventListener('click', () => {
    api.openBenchmarksFolder().catch((error) => setStatus(error.message || 'Could not open the folder.', true));
  });

  window.benchmarksUi = { refresh };
  refresh();
})();
