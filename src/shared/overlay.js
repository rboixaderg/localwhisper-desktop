(function () {
  var indicator = document.getElementById('indicator');

  if (!window.overlayApi || typeof window.overlayApi.onPhase !== 'function') return;

  var micSvg =
    '<svg viewBox="0 0 24 24" class="mic-icon">' +
    '<rect x="8.5" y="3" width="7" height="12" rx="3.5"/>' +
    '<rect x="6.5" y="11.1" width="1.8" height="1.6" rx="0.9"/>' +
    '<rect x="15.7" y="11.1" width="1.8" height="1.6" rx="0.9"/>' +
    '<path d="M8.3 12.3A3.7 3.7 0 0 0 15.7 12.3" stroke="currentColor" stroke-width="1.8" fill="none"/>' +
    '<rect x="11.1" y="17" width="1.8" height="1.6" rx="0.5"/>' +
    '<rect x="8.7" y="18.6" width="6.6" height="1.8" rx="0.9"/>' +
    '</svg>';

  var spinnerSvg =
    '<svg viewBox="0 0 24 24" class="spinner-icon">' +
    '<circle cx="12" cy="12" r="9"/>' +
    '</svg>';

  window.overlayApi.onPhase(function (payload) {
    if (!payload) return;

    var phase = payload.phase || '';

    if (phase === 'recording') {
      indicator.innerHTML = micSvg;
      indicator.className = 'recording';
    } else if (phase === 'processing' || phase === 'transcribing' || phase === 'pasting') {
      indicator.innerHTML = spinnerSvg;
      indicator.className = phase;
    } else {
      indicator.innerHTML = '';
      indicator.className = '';
    }
  });
})();
