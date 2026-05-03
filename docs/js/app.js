/* ═══════════════════════════════════════════════
   APP.JS — Main Application Controller
   Minutes v1.0
═══════════════════════════════════════════════ */

/* ── Toast utility ── */
const Toast = (() => {
  function show(message, kind = '') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;

    const el = document.createElement('div');
    el.className = `toast${kind ? ' toast-' + kind : ''}`;
    el.textContent = message;
    stack.appendChild(el);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });

    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3000);
  }
  return { show };
})();

/* ── Panel switching ── */
function switchPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById(`panel-${id}`);
  const nav   = document.querySelector(`[data-panel="${id}"]`);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');
}

/* ── Welcome modal ── */
function closeWelcome() {
  const modal = document.getElementById('welcomeModal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
  }
  try { localStorage.setItem('minutes_welcomed', '1'); } catch (_) {}
}

/* ════════════════════════════════════════════
   MAIN APP MODULE
════════════════════════════════════════════ */
const App = (() => {

  /* ── State ── */
  const state = {
    utterances:    [],
    isRecording:   false,
    startTime:     null,
    timerInterval: null,
    searchQuery:   '',
    mode:          'formal',
    language:      'ja-JP',
    fillerRemoval: true,
    amplitude:     0,
  };

  /* Store globally for Exporter access */
  window._utterances = state.utterances;

  /* ── Init ── */
  function init() {
    if (!Speech.isSupported()) {
      Toast.show('このブラウザは音声認識に対応していません（Chrome / Edge 推奨）', 'error');
      document.getElementById('recordBtn').disabled = true;
    }

    Renderer.initWaveform();
    bindSpeechCallbacks();
    bindKeyboard();
    initDateTime();
    loadSettings();

    /* Welcome modal */
    try {
      if (!localStorage.getItem('minutes_welcomed')) {
        setTimeout(() => {
          const m = document.getElementById('welcomeModal');
          if (m) m.classList.add('show');
        }, 400);
      }
    } catch (_) {}
  }

  /* ── Speech callbacks ── */
  function bindSpeechCallbacks() {
    Speech.on('onStart', () => {
      setStatus('live', '録音中');
      Renderer.setRecording(true);
    });

    Speech.on('onResult', (text) => {
      state.utterances.push({ text, time: Date.now() });
      Renderer.removePartial();
      Renderer.renderTranscript(state.utterances, state.searchQuery,
        document.getElementById('highlightKw')?.checked ?? true);
      updateStats();
      document.getElementById('generateBtn').disabled = false;
    });

    Speech.on('onPartial', (text) => {
      if (text.trim()) Renderer.appendPartial(text);
      else Renderer.removePartial();
    });

    Speech.on('onStop', () => {
      setStatus('idle', '待機中');
      Renderer.setRecording(false);
      Renderer.setAmplitude(0);
      Renderer.removePartial();
    });

    Speech.on('onAmplitude', (val) => {
      state.amplitude = val;
      Renderer.setAmplitude(val);
      document.getElementById('waveLevel').textContent =
        state.isRecording ? `${Math.round(val * 100)}%` : '— dB';
    });

    Speech.on('onError', (errCode) => {
      if (errCode === 'permission_denied') {
        Toast.show('マイクのアクセスが拒否されました。ブラウザの設定から許可してください。', 'error');
      } else if (errCode === 'network') {
        Toast.show('音声認識サービスへの接続に失敗しました', 'error');
      } else {
        Toast.show(`認識エラー: ${errCode}`, 'error');
      }
      stopRecording();
    });
  }

  /* ── Recording ── */
  async function toggleRecording() {
    if (state.isRecording) stopRecording();
    else await startRecording();
  }

  async function startRecording() {
    try {
      setStatus('processing', '許可確認中...');
      await Speech.start(state.language);
      state.isRecording = true;
      startTimer();

      const btn  = document.getElementById('recordBtn');
      const icon = document.getElementById('recordIcon');
      const lbl  = document.getElementById('recordLabel');
      if (btn)  btn.classList.add('active');
      if (lbl)  lbl.textContent = '録音停止';

    } catch (err) {
      setStatus('idle', '待機中');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        Toast.show('マイクのアクセスが拒否されました', 'error');
      } else if (err.name === 'NotFoundError') {
        Toast.show('マイクが見つかりません', 'error');
      } else {
        Toast.show('マイクへのアクセスに失敗しました', 'error');
      }
    }
  }

  function stopRecording() {
    state.isRecording = false;
    Speech.stop();
    stopTimer();

    const btn = document.getElementById('recordBtn');
    const lbl = document.getElementById('recordLabel');
    if (btn) btn.classList.remove('active');
    if (lbl) lbl.textContent = state.utterances.length > 0 ? '録音を再開' : '録音開始';

    Renderer.setRecording(false);
    Renderer.setAmplitude(0);
    Renderer.removePartial();
    setStatus('idle', '待機中');
  }

  /* ── Timer ── */
  function startTimer() {
    state.startTime = Date.now();
    state.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const el = document.getElementById('timerDisplay');
      if (el) el.textContent = `${m}:${s}`;
    }, 500);
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
  }

  function getElapsed() {
    const el = document.getElementById('timerDisplay');
    return el ? el.textContent : '00:00';
  }

  /* ── Status ── */
  function setStatus(type, text) {
    const dot  = document.getElementById('statusDot');
    const txt  = document.getElementById('statusText');
    if (dot) dot.className = `status-dot${type === 'live' ? ' live' : type === 'processing' ? ' processing' : ''}`;
    if (txt) txt.textContent = text;
  }

  /* ── Stats ── */
  function updateStats() {
    const totalChars = state.utterances.reduce((a, u) => a + u.text.length, 0);
    const totalWords = state.utterances.reduce((a, u) => a + u.text.split(/[\s。、！？]+/).filter(Boolean).length, 0);

    const cc = document.getElementById('charCount');
    const uc = document.getElementById('uttCount');
    const wc = document.getElementById('wordCount');
    if (cc) cc.textContent = totalChars.toLocaleString();
    if (uc) uc.textContent = state.utterances.length;
    if (wc) wc.textContent = totalWords.toLocaleString();
  }

  /* ── Generate minutes ── */
  function generateMinutes() {
    if (state.utterances.length === 0) {
      Toast.show('文字起こしデータがありません', 'error');
      return;
    }

    const meta = {
      title:     document.getElementById('sessionTitle')?.value.trim() || '無題の会議',
      attendees: document.getElementById('attendees')?.value.trim() || '',
      location:  document.getElementById('location')?.value.trim()  || '',
      datetime:  formatDatetime(state.startTime),
      duration:  getElapsed(),
    };

    const data = NLP.analyse(state.utterances, meta);
    window._minutesData = data;

    Renderer.renderMinutes(data, state.mode);

    const empty = document.getElementById('minutesEmpty');
    const paper = document.getElementById('minutesPaper');
    if (empty) empty.style.display = 'none';
    if (paper) paper.style.display = 'block';

    Toast.show('議事録を生成しました');
  }

  /* ── Filter transcript ── */
  function filterTranscript(query) {
    state.searchQuery = query;
    Renderer.renderTranscript(state.utterances, query,
      document.getElementById('highlightKw')?.checked ?? true);
  }

  /* ── Mode ── */
  function setMode(mode) {
    state.mode = mode;
    document.getElementById('modeBtn-formal')?.classList.toggle('active', mode === 'formal');
    document.getElementById('modeBtn-concise')?.classList.toggle('active', mode === 'concise');
  }

  /* ── Language ── */
  function setLanguage(lang) {
    state.language = lang;
    Speech.setLanguage(lang);
  }

  /* ── Filler toggle ── */
  function toggleFiller(enabled) {
    state.fillerRemoval = enabled;
  }

  /* ── Clear all ── */
  function clearAll() {
    if (state.utterances.length > 0 && !confirm('すべてのデータをクリアしますか？')) return;
    if (state.isRecording) stopRecording();
    state.utterances.length = 0;
    window._minutesData = null;

    Renderer.renderTranscript([], '', false);
    updateStats();

    const timer = document.getElementById('timerDisplay');
    if (timer) timer.textContent = '00:00';

    const empty = document.getElementById('minutesEmpty');
    const paper = document.getElementById('minutesPaper');
    if (empty) empty.style.display = '';
    if (paper) paper.innerHTML = '';

    document.getElementById('generateBtn').disabled = true;
    document.getElementById('recordLabel').textContent = '録音開始';
    Toast.show('クリアしました');
  }

  /* ── Keyboard shortcuts ── */
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const target = e.target.tagName;
      if (target === 'INPUT' || target === 'TEXTAREA' || target === 'SELECT') return;

      /* Space: toggle recording */
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleRecording();
        return;
      }
      /* Cmd/Ctrl + Enter: generate */
      if (e.code === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        switchPanel('minutes');
        generateMinutes();
        return;
      }
      /* Cmd/Ctrl + S: PDF */
      if (e.code === 'KeyS' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        Exporter.toPDF();
        return;
      }
    });
  }

  /* ── Date display ── */
  function initDateTime() {
    const d = new Date();
    const dateStr = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
    document.title = `Minutes — ${dateStr}`;
  }

  function formatDatetime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const Y = d.getFullYear(), M = d.getMonth()+1, D = d.getDate();
    const days = ['日','月','火','水','木','金','土'];
    const wd = days[d.getDay()];
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    return `${Y}年${M}月${D}日(${wd}) ${h}:${m}`;
  }

  /* ── Settings persistence ── */
  function loadSettings() {
    try {
      const saved = localStorage.getItem('minutes_settings');
      if (!saved) return;
      const cfg = JSON.parse(saved);

      if (cfg.orgName)    document.getElementById('orgName').value    = cfg.orgName;
      if (cfg.authorName) document.getElementById('authorName').value = cfg.authorName;
      if (cfg.language)   document.getElementById('langSelect').value  = cfg.language, setLanguage(cfg.language);
    } catch (_) {}

    /* Auto-save on change */
    ['orgName','authorName','langSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', saveSettings);
    });
  }

  function saveSettings() {
    try {
      localStorage.setItem('minutes_settings', JSON.stringify({
        orgName:    document.getElementById('orgName')?.value,
        authorName: document.getElementById('authorName')?.value,
        language:   document.getElementById('langSelect')?.value,
      }));
    } catch (_) {}
  }

  /* ── Public API ── */
  return {
    init,
    toggleRecording,
    generateMinutes,
    filterTranscript,
    setMode,
    setLanguage,
    toggleFiller,
    clearAll,
  };

})();

/* ── Bootstrap ── */
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
