/* ═══════════════════════════════════════════════
   SPEECH.JS — Web Speech API Wrapper
   v2: Brave / Android対応、フォールバック実装
═══════════════════════════════════════════════ */

const Speech = (() => {

  let recognition = null;
  let isRunning   = false;
  let language    = 'ja-JP';
  let restartTimer = null;

  const cb = {
    onResult:    () => {},
    onPartial:   () => {},
    onStart:     () => {},
    onStop:      () => {},
    onError:     () => {},
    onAmplitude: () => {},
    onUnsupported: () => {},
  };

  /* ── Feature detection ── */
  function getSR() {
    return window.SpeechRecognition
        || window.webkitSpeechRecognition
        || window.mozSpeechRecognition
        || window.msSpeechRecognition
        || null;
  }

  function isSupported() {
    return !!getSR();
  }

  /* Check if running in Brave */
  function isBrave() {
    return !!(navigator.brave && navigator.brave.isBrave);
  }

  /* ── Amplitude simulation via AudioContext ── */
  let audioCtx = null, analyser = null, micStream = null, ampTimer = null;

  async function startAmplitudeMonitor(stream) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      micStream = stream;

      const data = new Uint8Array(analyser.frequencyBinCount);
      ampTimer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const sum = data.reduce((a, v) => a + v, 0);
        const avg = sum / data.length / 255;
        cb.onAmplitude(Math.min(1, avg * 3.5));
      }, 60);
    } catch (e) {
      /* Fallback to random if AudioContext unavailable */
      ampTimer = setInterval(() => {
        cb.onAmplitude(isRunning ? 0.25 + Math.random() * 0.5 : 0);
      }, 100);
    }
  }

  function stopAmplitudeMonitor() {
    clearInterval(ampTimer);
    ampTimer = null;
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    cb.onAmplitude(0);
  }

  /* ── Init recognition ── */
  function init() {
    const SR = getSR();
    if (!SR) return false;

    recognition = new SR();
    recognition.lang              = language;
    recognition.continuous        = true;
    recognition.interimResults    = true;
    recognition.maxAlternatives   = 1;

    recognition.onstart = () => {
      isRunning = true;
      cb.onStart();
    };

    recognition.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const text = transcript.trim();
          if (text.length > 0) cb.onResult(text);
        } else {
          interimText += transcript;
        }
      }
      cb.onPartial(interimText);
    };

    recognition.onerror = (e) => {
      console.warn('SpeechRecognition error:', e.error);

      /* Non-fatal errors — just restart */
      if (e.error === 'no-speech' || e.error === 'audio-capture') {
        if (isRunning) {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            if (isRunning) tryRestart();
          }, 300);
        }
        return;
      }

      if (e.error === 'aborted') return; /* normal stop */

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isRunning = false;
        cb.onError('permission_denied');
        return;
      }

      if (e.error === 'network') {
        cb.onError('network');
        return;
      }

      /* Other errors: try restart once */
      if (isRunning) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (isRunning) tryRestart();
        }, 500);
      }
    };

    recognition.onend = () => {
      if (isRunning) {
        /* Auto-restart for continuous recording */
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (isRunning) tryRestart();
        }, 100);
      } else {
        cb.onStop();
      }
    };

    return true;
  }

  function tryRestart() {
    if (!recognition || !isRunning) return;
    try {
      recognition.lang = language;
      recognition.start();
    } catch (e) {
      /* Already started, ignore */
    }
  }

  /* ── Public: start ── */
  async function start(lang) {
    language = lang || language;

    /* 1. Request microphone permission */
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        throw Object.assign(new Error('No mic'), { name: 'NotFoundError' });
      }
      throw err;
    }

    /* 2. Start amplitude monitor (keep stream alive for analysis) */
    await startAmplitudeMonitor(stream);

    /* 3. Init SpeechRecognition */
    if (!getSR()) {
      /* Browser doesn't support speech API (e.g. Brave with flag disabled) */
      cb.onUnsupported();
      stopAmplitudeMonitor();
      throw Object.assign(new Error('SpeechRecognition not available'), { name: 'NotSupportedError' });
    }

    if (!recognition) init();

    recognition.lang = language;
    isRunning = true;

    /* Small delay to let mic settle */
    await new Promise(r => setTimeout(r, 150));

    try {
      recognition.start();
    } catch (e) {
      /* Already running */
    }
  }

  /* ── Public: stop ── */
  function stop() {
    isRunning = false;
    clearTimeout(restartTimer);
    stopAmplitudeMonitor();
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      try { recognition.stop();  } catch (_) {}
    }
    cb.onStop();
  }

  function setLanguage(lang) {
    language = lang;
    if (recognition) recognition.lang = lang;
  }

  function on(event, handler) {
    if (cb[event] !== undefined) cb[event] = handler;
  }

  return { isSupported, isBrave, start, stop, setLanguage, on };

})();
