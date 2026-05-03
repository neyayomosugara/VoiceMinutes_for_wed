/* ═══════════════════════════════════════════════
   WHISPER-ENGINE.JS
   MediaRecorder + Transformers.js (Whisper) fallback STT.
   Activated automatically when Web Speech API is unavailable
   (Brave, Firefox, etc.). Runs entirely in the browser — no
   audio data is sent to any server.
═══════════════════════════════════════════════ */

const WhisperEngine = (() => {

  let worker   = null;
  let ready    = false;
  let recorder = null;
  let chunks   = [];
  let active   = false;
  let lang     = 'ja-JP';
  let stream   = null;
  let ampCtx   = null;
  let ampTimer = null;
  let jobId    = 0;

  const LANG = {
    'ja-JP': 'japanese',
    'en-US': 'english',
    'zh-CN': 'chinese',
    'ko-KR': 'korean',
  };

  const cb = {
    onResult:        () => {},
    onPartial:       () => {},
    onStart:         () => {},
    onStop:          () => {},
    onError:         () => {},
    onAmplitude:     () => {},
    onModelProgress: () => {},
  };

  /* ── Feature check ── */
  function isSupported() {
    return !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* ── Best available MIME type ── */
  function getMime() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  /* ── Worker ── */
  function ensureWorker() {
    if (worker) return;
    try {
      worker = new Worker('js/whisper-worker.js', { type: 'module' });
      worker.onmessage = ({ data }) => {
        switch (data.type) {
          case 'ready':    ready = true; break;
          case 'progress': cb.onModelProgress(data.pct); break;
          case 'result':   if (data.text) cb.onResult(data.text); break;
          case 'error':
            console.error('[WhisperEngine]', data.message);
            cb.onError('whisper_error');
            break;
        }
      };
      worker.onerror = (e) => {
        console.error('[WhisperEngine] worker error:', e);
        cb.onError('whisper_error');
      };
    } catch (e) {
      console.error('[WhisperEngine] failed to create worker:', e);
      worker = null;
    }
  }

  /* ── Decode blob → Float32 PCM @ 16kHz → send to worker ── */
  async function processBlob(blob, mime) {
    if (!ready || !worker) return;
    try {
      const buf    = await blob.arrayBuffer();
      const actx   = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const decoded = await actx.decodeAudioData(buf.slice(0));
      await actx.close();
      const f32 = new Float32Array(decoded.getChannelData(0));
      const id  = ++jobId;
      worker.postMessage(
        { type: 'transcribe', audio: f32, lang: LANG[lang] || 'japanese', id },
        [f32.buffer]
      );
    } catch (e) {
      console.warn('[WhisperEngine] processBlob:', e);
    }
  }

  /* ── 4-second chunk recording loop ── */
  function nextChunk(mime) {
    if (!active || !stream || !stream.active) return;
    chunks = [];

    let mr;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    } catch (_) {
      mr = new MediaRecorder(stream);
    }
    recorder = mr;

    mr.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    mr.onstop = async () => {
      if (chunks.length) {
        await processBlob(new Blob(chunks, { type: mime || 'audio/webm' }), mime);
      }
      if (active) nextChunk(mime);
    };
    mr.start();
    setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 4000);
  }

  /* ── Amplitude monitor ── */
  function startAmp() {
    try {
      ampCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ampCtx.createAnalyser();
      analyser.fftSize = 256;
      ampCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      ampTimer = setInterval(() => {
        if (!active) { clearInterval(ampTimer); ampTimer = null; return; }
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, v) => a + v, 0) / data.length / 255;
        cb.onAmplitude(Math.min(1, avg * 3.5));
      }, 60);
    } catch (_) {
      ampTimer = setInterval(() => {
        if (!active) { clearInterval(ampTimer); ampTimer = null; return; }
        cb.onAmplitude(0.2 + Math.random() * 0.5);
      }, 120);
    }
  }

  /* ── Public: start ── */
  async function start(l) {
    lang   = l || lang;
    active = true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    cb.onStart();
    startAmp();
    ensureWorker();
    nextChunk(getMime());
  }

  /* ── Public: stop ── */
  function stop() {
    active = false;
    clearInterval(ampTimer);
    ampTimer = null;
    if (ampCtx) { try { ampCtx.close(); } catch (_) {} ampCtx = null; }
    if (recorder && recorder.state === 'recording') { try { recorder.stop(); } catch (_) {} }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    cb.onAmplitude(0);
    cb.onStop();
  }

  function setLanguage(l) { lang = l; }
  function on(ev, fn) { if (ev in cb) cb[ev] = fn; }

  return { isSupported, start, stop, setLanguage, on };

})();
