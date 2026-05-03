/* ═══════════════════════════════════════════════
   SPEECH.JS v4 — Unified Speech Recognition
   ・Primary:  Web Speech API (Chrome, Edge)
   ・Fallback: WhisperEngine (Brave, Firefox, etc.)
   ・Mobile fix: commits interim text in onend to avoid
     silent result loss on Android Chrome
═══════════════════════════════════════════════ */

const Speech = (() => {

  let recognition  = null;
  let isRunning    = false;
  let language     = 'ja-JP';
  let restartTimer = null;
  let lastResultTime = 0;
  let watchdogTimer  = null;
  let lastInterim    = '';   /* mobile onend fix */
  let usingWhisper   = false;

  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const IS_IOS    = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const cb = {
    onResult:        () => {},
    onPartial:       () => {},
    onStart:         () => {},
    onStop:          () => {},
    onError:         () => {},
    onAmplitude:     () => {},
    onUnsupported:   () => {},
    onModelProgress: () => {},
  };

  /* ── Feature detection ── */
  function getSR() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function isNativeSupported() { return !!getSR(); }

  function isSupported() {
    return !!(getSR() ||
      (typeof WhisperEngine !== 'undefined' && WhisperEngine.isSupported()));
  }

  function isBrave() { return !!(navigator.brave && navigator.brave.isBrave); }
  function isMobile() { return IS_MOBILE; }
  function isIOS()    { return IS_IOS; }

  /* ── Amplitude monitor (desktop only; mobile uses simulated) ── */
  let audioCtx = null, analyser = null, micStream = null, ampTimer = null;

  async function startAmplitudeMonitor() {
    if (IS_MOBILE) {
      ampTimer = setInterval(() => {
        cb.onAmplitude(isRunning ? 0.25 + Math.random() * 0.5 : 0);
      }, 120);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(s).connect(analyser);
      micStream = s;
      const data = new Uint8Array(analyser.frequencyBinCount);
      ampTimer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, v) => a + v, 0) / data.length / 255;
        cb.onAmplitude(Math.min(1, avg * 3.5));
      }, 60);
    } catch (_) {
      ampTimer = setInterval(() => {
        cb.onAmplitude(isRunning ? 0.25 + Math.random() * 0.5 : 0);
      }, 120);
    }
  }

  function stopAmplitudeMonitor() {
    clearInterval(ampTimer); ampTimer = null;
    if (micStream) { try { micStream.getTracks().forEach(t => t.stop()); } catch (_) {} micStream = null; }
    if (audioCtx)  { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    cb.onAmplitude(0);
  }

  /* ── Mic permission probe ── */
  async function probeMicPermission() {
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) { throw err; }
    s.getTracks().forEach(t => t.stop());
    await new Promise(r => setTimeout(r, 200));
  }

  /* ── Init Web Speech recognition object ── */
  function init() {
    const SR = getSR();
    if (!SR) return false;

    recognition = new SR();
    recognition.lang            = language;
    recognition.continuous      = !IS_MOBILE;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('[Speech] onstart');
      lastResultTime = Date.now();
      cb.onStart();
      startWatchdog();
    };

    recognition.onresult = (e) => {
      lastResultTime = Date.now();
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          lastInterim = '';          /* clear pending interim */
          const text = t.trim();
          if (text.length > 0) {
            console.log('[Speech] final:', text);
            cb.onResult(text);
          }
        } else {
          interimText += t;
        }
      }
      if (interimText) lastInterim = interimText;
      cb.onPartial(interimText);
    };

    recognition.onerror = (e) => {
      console.warn('[Speech] error:', e.error);
      if (e.error === 'no-speech' || e.error === 'audio-capture' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isRunning = false; clearWatchdog(); cb.onError('permission_denied'); return;
      }
      if (e.error === 'network') {
        isRunning = false; clearWatchdog(); cb.onError('network'); return;
      }
    };

    recognition.onend = () => {
      console.log('[Speech] onend, isRunning=', isRunning);

      /* ── Mobile fix: Android Chrome sometimes fires onend without isFinal.
            Commit any pending interim text so it isn't lost. ── */
      if (IS_MOBILE && lastInterim.trim().length > 0) {
        const text = lastInterim.trim();
        lastInterim = '';
        cb.onResult(text);
        cb.onPartial('');
      }

      if (isRunning) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => { if (isRunning) tryStart(); }, 250);
      } else {
        clearWatchdog();
        cb.onStop();
      }
    };

    return true;
  }

  function tryStart() {
    if (!recognition || !isRunning) return;
    try {
      recognition.lang = language;
      recognition.start();
      console.log('[Speech] restarted');
    } catch (e) {
      console.warn('[Speech] start failed:', e.message);
      setTimeout(() => {
        if (isRunning && recognition) { try { recognition.start(); } catch (_) {} }
      }, 400);
    }
  }

  /* ── Watchdog: silent-failure recovery on mobile ── */
  function startWatchdog() {
    clearWatchdog();
    watchdogTimer = setInterval(() => {
      if (!isRunning) { clearWatchdog(); return; }
      if (Date.now() - lastResultTime > 30000) {
        console.warn('[Speech] watchdog: idle too long, force restart');
        lastResultTime = Date.now();
        try { recognition.abort(); } catch (_) {}
      }
    }, 5000);
  }
  function clearWatchdog() { clearInterval(watchdogTimer); watchdogTimer = null; }

  /* ── Whisper fallback: delegate all callbacks ── */
  function delegateToWhisper() {
    WhisperEngine.on('onStart',        ()    => { isRunning = true; cb.onStart(); });
    WhisperEngine.on('onResult',       text  => cb.onResult(text));
    WhisperEngine.on('onPartial',      text  => cb.onPartial(text));
    WhisperEngine.on('onStop',         ()    => { isRunning = false; cb.onStop(); });
    WhisperEngine.on('onError',        code  => cb.onError(code));
    WhisperEngine.on('onAmplitude',    val   => cb.onAmplitude(val));
    WhisperEngine.on('onModelProgress',pct   => cb.onModelProgress(pct));
  }

  /* ── Public: start ── */
  async function start(lang) {
    language = lang || language;

    if (!getSR()) {
      if (typeof WhisperEngine !== 'undefined' && WhisperEngine.isSupported()) {
        usingWhisper = true;
        delegateToWhisper();
        await WhisperEngine.start(language);
        isRunning = true;
        return;
      }
      cb.onUnsupported();
      throw Object.assign(new Error('SpeechRecognition not supported'), { name: 'NotSupportedError' });
    }

    usingWhisper = false;
    await probeMicPermission();
    if (!recognition) init();

    isRunning = true;
    startAmplitudeMonitor();

    recognition.lang       = language;
    recognition.continuous = !IS_MOBILE;
    try {
      recognition.start();
    } catch (e) {
      console.warn('[Speech] initial start failed:', e.message);
      try { recognition.abort(); } catch (_) {}
      await new Promise(r => setTimeout(r, 300));
      try {
        recognition.start();
      } catch (e2) {
        isRunning = false;
        stopAmplitudeMonitor();
        throw e2;
      }
    }
  }

  /* ── Public: stop ── */
  function stop() {
    console.log('[Speech] stop()');
    isRunning   = false;
    lastInterim = '';

    if (usingWhisper) {
      usingWhisper = false;
      clearWatchdog();
      WhisperEngine.stop();
      return;
    }

    clearTimeout(restartTimer);
    clearWatchdog();
    stopAmplitudeMonitor();
    if (recognition) { try { recognition.abort(); } catch (_) {} }
    cb.onStop();
  }

  function setLanguage(lang) {
    language = lang;
    if (recognition) recognition.lang = lang;
    if (usingWhisper && typeof WhisperEngine !== 'undefined') WhisperEngine.setLanguage(lang);
  }

  function on(event, handler) {
    if (event in cb) cb[event] = handler;
  }

  return {
    isSupported, isNativeSupported, isBrave, isMobile, isIOS,
    start, stop, setLanguage, on,
  };

})();
