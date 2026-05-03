/* ═══════════════════════════════════════════════
   SPEECH.JS — Web Speech API Wrapper
═══════════════════════════════════════════════ */

const Speech = (() => {

  let recognition = null;
  let isRunning   = false;
  let language    = 'ja-JP';

  /* Callbacks set by App */
  const cb = {
    onResult:   () => {},
    onPartial:  () => {},
    onStart:    () => {},
    onStop:     () => {},
    onError:    () => {},
    onAmplitude:() => {},
  };

  function isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
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
      /* Simulate amplitude variation based on speech activity */
      cb.onAmplitude(0.3 + Math.random() * 0.6);

      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          const text = transcript.trim();
          if (text.length > 0) cb.onResult(text);
        } else {
          interimText = transcript;
        }
      }
      cb.onPartial(interimText);
    };

    recognition.onerror = (e) => {
      /* Non-fatal: no speech detected, audio capture glitch → just restart */
      if (e.error === 'no-speech' || e.error === 'audio-capture') return;

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isRunning = false;
        cb.onError('permission_denied');
        return;
      }

      if (e.error === 'network') {
        cb.onError('network');
        return;
      }

      cb.onError(e.error);
    };

    recognition.onend = () => {
      cb.onAmplitude(0);
      if (isRunning) {
        /* Auto-restart for continuous recording */
        try { recognition.start(); } catch (_) {}
      } else {
        cb.onStop();
      }
    };

    return true;
  }

  async function start(lang) {
    language = lang || language;

    /* Request microphone permission explicitly first */
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());

    if (!recognition && !init()) {
      throw new Error('SpeechRecognition not supported');
    }

    recognition.lang = language;
    isRunning = true;
    recognition.start();
  }

  function stop() {
    isRunning = false;
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
  }

  function setLanguage(lang) {
    language = lang;
    if (recognition) recognition.lang = lang;
  }

  function on(event, handler) {
    if (cb[event] !== undefined) cb[event] = handler;
  }

  return { isSupported, start, stop, setLanguage, on };

})();
