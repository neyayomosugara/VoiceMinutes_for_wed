/* ═══════════════════════════════════════════════
   SPEECH.JS v3 — Mobile-first Web Speech API Wrapper
   重要: Android Chromeは continuous: true をサポートしないため、
   モバイルでは continuous: false + 自動再起動ロジックを採用
═══════════════════════════════════════════════ */

const Speech = (() => {

  let recognition = null;
  let isRunning   = false;
  let language    = 'ja-JP';
  let restartTimer = null;
  let lastResultTime = 0;
  let watchdogTimer = null;

  /* Detect mobile device */
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const IS_IOS    = /iPhone|iPad|iPod/i.test(navigator.userAgent);

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
        || null;
  }

  function isSupported() {
    return !!getSR();
  }

  function isBrave() {
    return !!(navigator.brave && navigator.brave.isBrave);
  }

  function isMobile() { return IS_MOBILE; }
  function isIOS()    { return IS_IOS; }

  /* ── Amplitude monitor via AudioContext ── */
  let audioCtx = null, analyser = null, micStream = null, ampTimer = null;

  async function startAmplitudeMonitor() {
    /* On mobile, getting the stream interferes with SpeechRecognition.
       Skip AudioContext on mobile and use simulated amplitude during recognition. */
    if (IS_MOBILE) {
      ampTimer = setInterval(() => {
        if (isRunning) cb.onAmplitude(0.25 + Math.random() * 0.5);
        else cb.onAmplitude(0);
      }, 120);
      return;
    }

    /* Desktop: use real AudioContext */
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      console.warn('AudioContext failed, falling back:', e);
      ampTimer = setInterval(() => {
        if (isRunning) cb.onAmplitude(0.25 + Math.random() * 0.5);
        else cb.onAmplitude(0);
      }, 120);
    }
  }

  function stopAmplitudeMonitor() {
    clearInterval(ampTimer);
    ampTimer = null;
    if (micStream) {
      try { micStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      micStream = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
      audioCtx = null;
    }
    cb.onAmplitude(0);
  }

  /* ── Mic permission probe (mobile-safe) ── */
  async function probeMicPermission() {
    /* Quickly request and release the mic to trigger the permission dialog.
       On Android Chrome, this MUST happen before SpeechRecognition.start()
       or the recognition will fail silently. */
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      throw err;
    }
    /* Release immediately — SpeechRecognition will reacquire its own */
    stream.getTracks().forEach(t => t.stop());
    /* Small delay to let the OS release the resource */
    await new Promise(r => setTimeout(r, 200));
  }

  /* ── Init recognition object ── */
  function init() {
    const SR = getSR();
    if (!SR) return false;

    recognition = new SR();
    recognition.lang              = language;
    /* CRITICAL: Android Chrome ignores continuous=true. We use one-shot + restart. */
    recognition.continuous        = !IS_MOBILE;
    recognition.interimResults    = true;
    recognition.maxAlternatives   = 1;

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
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const text = transcript.trim();
          if (text.length > 0) {
            console.log('[Speech] final:', text);
            cb.onResult(text);
          }
        } else {
          interimText += transcript;
        }
      }
      cb.onPartial(interimText);
    };

    recognition.onerror = (e) => {
      console.warn('[Speech] error:', e.error);

      if (e.error === 'no-speech' || e.error === 'audio-capture' || e.error === 'aborted') {
        /* Non-fatal — onend handler will restart */
        return;
      }

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isRunning = false;
        clearWatchdog();
        cb.onError('permission_denied');
        return;
      }

      if (e.error === 'network') {
        isRunning = false;
        clearWatchdog();
        cb.onError('network');
        return;
      }

      /* Other errors: try to recover via onend */
    };

    recognition.onend = () => {
      console.log('[Speech] onend, isRunning=', isRunning);
      if (isRunning) {
        /* Restart for continuous behaviour (essential on mobile) */
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (isRunning) tryStart();
        }, 250);
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
      /* Already started, or in transition. Wait and retry once. */
      console.warn('[Speech] start failed:', e.message);
      setTimeout(() => {
        if (isRunning && recognition) {
          try { recognition.start(); } catch (_) {}
        }
      }, 400);
    }
  }

  /* ── Watchdog: detect silent failures on mobile ── */
  function startWatchdog() {
    clearWatchdog();
    watchdogTimer = setInterval(() => {
      if (!isRunning) {
        clearWatchdog();
        return;
      }
      const idle = Date.now() - lastResultTime;
      /* If no result/event for 30 seconds, force-restart */
      if (idle > 30000) {
        console.warn('[Speech] watchdog: idle too long, force restart');
        lastResultTime = Date.now();
        try { recognition.abort(); } catch (_) {}
      }
    }, 5000);
  }

  function clearWatchdog() {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  /* ── Public: start ── */
  async function start(lang) {
    if (!getSR()) {
      cb.onUnsupported();
      throw Object.assign(new Error('SpeechRecognition not supported'), { name: 'NotSupportedError' });
    }

    language = lang || language;

    /* 1. Trigger permission dialog & release mic */
    await probeMicPermission();

    /* 2. Init if needed */
    if (!recognition) init();

    /* 3. Start amplitude monitor (on desktop, gets its own stream) */
    isRunning = true;
    startAmplitudeMonitor();

    /* 4. Start recognition */
    recognition.lang = language;
    recognition.continuous = !IS_MOBILE;

    try {
      recognition.start();
    } catch (e) {
      /* Possibly already running — abort and retry */
      console.warn('[Speech] initial start failed:', e.message);
      try { recognition.abort(); } catch (_) {}
      await new Promise(r => setTimeout(r, 300));
      try { recognition.start(); } catch (e2) {
        isRunning = false;
        stopAmplitudeMonitor();
        throw e2;
      }
    }
  }

  /* ── Public: stop ── */
  function stop() {
    console.log('[Speech] stop()');
    isRunning = false;
    clearTimeout(restartTimer);
    clearWatchdog();
    stopAmplitudeMonitor();
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
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

  return {
    isSupported, isBrave, isMobile, isIOS,
    start, stop, setLanguage, on,
  };

})();
