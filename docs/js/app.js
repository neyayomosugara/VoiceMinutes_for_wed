/* ═══════════════════════════════════════════════
   APP.JS — Main Application Controller
   v2: Brave対応 / モバイル最適化
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
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3500);
  }
  return { show };
})();

/* ── Panel switching ── */
function switchPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById(`panel-${id}`);
  const navs  = document.querySelectorAll(`[data-panel="${id}"]`);
  if (panel) panel.classList.add('active');
  navs.forEach(n => n.classList.add('active'));
}

function closeWelcome() {
  const modal = document.getElementById('welcomeModal');
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => modal.style.display = 'none', 300);
  try { localStorage.setItem('minutes_welcomed', '1'); } catch (_) {}
}

/* ════════════════════════════════════════════
   MAIN APP MODULE
════════════════════════════════════════════ */
const App = (() => {

  const state = {
    utterances:    [],
    isRecording:   false,
    startTime:     null,
    timerInterval: null,
    searchQuery:   '',
    mode:          'formal',
    language:      'ja-JP',
    speechSupported: true,
  };

  window._utterances  = state.utterances;
  window._minutesData = null;

  /* ── Init ── */
  function init() {
    Renderer.initWaveform();
    bindSpeechCallbacks();
    bindKeyboard();
    loadSettings();
    checkBrowserSupport();
    initDateTime();

    /* Welcome modal */
    try {
      if (!localStorage.getItem('minutes_welcomed')) {
        setTimeout(() => {
          const m = document.getElementById('welcomeModal');
          if (m) m.classList.add('show');
        }, 500);
      }
    } catch (_) {}

    /* Prevent page scroll on iOS when in standalone/PWA mode */
    document.addEventListener('touchmove', e => {
      if (e.target.closest('.transcript-paper, .minutes-container, .settings-sections, .export-grid')) return;
      e.preventDefault();
    }, { passive: false });
  }

  /* ── Browser support check ── */
  function checkBrowserSupport() {
    const supported = Speech.isSupported();
    state.speechSupported = supported;

    if (!supported) {
      showBrowserWarning();
      return;
    }

    /* iOS Safari has very limited support */
    if (Speech.isIOS()) {
      const ua = navigator.userAgent;
      if (!/CriOS|EdgiOS/i.test(ua)) {
        /* Safari iOS — limited */
        Toast.show('iOS Safariは音声認識の対応が不安定です。Chrome iOSをお試しください。', 'info');
      }
    }

    if (Speech.isBrave()) {
      Toast.show('Braveの設定で「Googleサービスを使用」を有効にしてください', 'info');
    }

    if (Speech.isMobile()) {
      console.log('[App] Mobile mode: continuous recognition will use auto-restart');
    }
  }

  function showBrowserWarning() {
    /* Insert a warning banner inline */
    const waveform = document.querySelector('.waveform-container');
    if (!waveform || document.getElementById('browserWarning')) return;

    const isFirefox = /Firefox/i.test(navigator.userAgent);
    const isSafari  = /Safari/i.test(navigator.userAgent) && !/Chrome|CriOS/i.test(navigator.userAgent);

    let message;
    if (Speech.isBrave()) {
      message = `<strong>⚠️ 音声認識を有効にしてください</strong><br>
        <strong>brave://settings/privacy</strong> → 「Googleサービスを使用」をオンにしてリロード`;
    } else if (isFirefox) {
      message = `<strong>⚠️ Firefoxは音声認識に未対応です</strong><br>
        <strong>Chrome / Edge</strong> でアクセスしてください`;
    } else if (isSafari) {
      message = `<strong>⚠️ このSafariは音声認識に未対応です</strong><br>
        <strong>Chrome / Edge</strong> でアクセスしてください`;
    } else {
      message = `<strong>⚠️ このブラウザは音声認識に未対応です</strong><br>
        <strong>Chrome / Edge</strong> でアクセスしてください`;
    }

    const banner = document.createElement('div');
    banner.id = 'browserWarning';
    banner.style.cssText = `
      margin: 8px var(--sp-8) 0;
      padding: 12px 16px;
      background: #fff8e1;
      border: 1px solid #f0c040;
      border-radius: 4px;
      font-size: 0.82rem;
      line-height: 1.6;
      color: #5a4000;
    `;
    banner.innerHTML = message + '<br><small style="opacity:0.7">（録音以外の機能はすべて使えます）</small>';
    waveform.insertAdjacentElement('afterend', banner);
  }

  /* Backward compat alias */
  function showBraveWarning() { showBrowserWarning(); }

  function showBraveWarning() {
    /* Insert an info banner below the waveform */
    const waveform = document.querySelector('.waveform-container');
    if (!waveform || document.getElementById('braveWarning')) return;

    const banner = document.createElement('div');
    banner.id = 'braveWarning';
    banner.style.cssText = `
      margin: 0 var(--sp-8);
      padding: var(--sp-3) var(--sp-4);
      background: #fff8e1;
      border: 1px solid #f0c040;
      border-radius: var(--radius-md);
      font-size: 0.8rem;
      line-height: 1.6;
      color: #5a4000;
    `;
    banner.innerHTML = `
      <strong>⚠️ 音声認識が利用できません</strong><br>
      Brave ブラウザをご利用の場合は、<strong>brave://settings/privacy</strong> → 
      「Google サービスを使用」を有効にしてページを再読み込みしてください。<br>
      または <strong>Chrome / Edge</strong> をご利用ください。<br>
      <small style="opacity:0.7">（文字起こし以外の機能はすべてご利用いただけます）</small>
    `;
    waveform.insertAdjacentElement('afterend', banner);
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
      Renderer.renderTranscript(
        state.utterances,
        state.searchQuery,
        document.getElementById('highlightKw')?.checked ?? true
      );
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
      Renderer.removePartial();
    });

    Speech.on('onAmplitude', (val) => {
      Renderer.setAmplitude(val);
      const levelEl = document.getElementById('waveLevel');
      if (levelEl) {
        levelEl.textContent = state.isRecording
          ? `${Math.round(val * 100)}%`
          : '— dB';
      }
    });

    Speech.on('onError', (code) => {
      let msg = '音声認識エラーが発生しました';
      if (code === 'permission_denied') {
        msg = 'マイクのアクセスが拒否されました。ブラウザのアドレスバーの🔒をタップして許可してください。';
      } else if (code === 'network') {
        msg = 'ネットワークエラー。オフライン環境では音声認識が利用できない場合があります。';
      }
      Toast.show(msg, 'error');
      stopRecording();
    });

    Speech.on('onUnsupported', () => {
      state.speechSupported = false;
      showBraveWarning();
      stopRecording();
    });

    /* Edit callback */
    Renderer.setEditCallback((index, newText) => {
      if (state.utterances[index]) {
        state.utterances[index].text = newText;
        Renderer.renderTranscript(
          state.utterances, state.searchQuery,
          document.getElementById('highlightKw')?.checked ?? true
        );
        updateStats();
      }
    });
  }

  /* ── Recording ── */
  async function toggleRecording() {
    if (state.isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    if (!state.speechSupported) {
      Toast.show('音声認識に対応したブラウザ（Chrome / Edge）をお使いください', 'error');
      return;
    }

    setStatus('processing', '許可確認中...');

    try {
      await Speech.start(state.language);
      state.isRecording = true;
      state.startTime   = state.startTime || Date.now();
      startTimer();

      const btn = document.getElementById('recordBtn');
      const lbl = document.getElementById('recordLabel');
      if (btn) btn.classList.add('active');
      if (lbl) lbl.textContent = '録音停止';

    } catch (err) {
      setStatus('idle', '待機中');
      const name = err.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        Toast.show('マイクのアクセスが拒否されました。ブラウザの設定から許可してください。', 'error');
      } else if (name === 'NotFoundError') {
        Toast.show('マイクが見つかりません。デバイスを確認してください。', 'error');
      } else if (name === 'NotSupportedError') {
        showBraveWarning();
        Toast.show('音声認識が利用できません。Chromeまたは設定を確認してください。', 'error');
      } else {
        Toast.show(`マイクエラー: ${err.message || name}`, 'error');
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
    if (state.timerInterval) return;
    state.timerInterval = setInterval(() => {
      if (!state.startTime) return;
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const el = document.getElementById('timerDisplay');
      if (el) el.textContent = `${m}:${s}`;
    }, 500);
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  function getElapsed() {
    const el = document.getElementById('timerDisplay');
    return el ? el.textContent : '00:00';
  }

  /* ── Status ── */
  function setStatus(type, text) {
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    if (dot) dot.className = `status-dot${
      type === 'live' ? ' live' :
      type === 'processing' ? ' processing' : ''
    }`;
    if (txt) txt.textContent = text;
  }

  /* ── Stats ── */
  function updateStats() {
    const totalChars  = state.utterances.reduce((a, u) => a + u.text.length, 0);
    const totalWords  = state.utterances.reduce((a, u) =>
      a + u.text.split(/[\s。、！？「」【】]+/).filter(Boolean).length, 0);

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
      attendees: document.getElementById('attendees')?.value.trim()    || '',
      location:  document.getElementById('location')?.value.trim()     || '',
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

    Toast.show('議事録を生成しました ✓');
  }

  /* ── Filter transcript ── */
  function filterTranscript(query) {
    state.searchQuery = query;
    Renderer.renderTranscript(
      state.utterances, query,
      document.getElementById('highlightKw')?.checked ?? true
    );
  }

  /* ── Mode ── */
  function setMode(mode) {
    state.mode = mode;
    document.getElementById('modeBtn-formal')?.classList.toggle('active', mode === 'formal');
    document.getElementById('modeBtn-concise')?.classList.toggle('active', mode === 'concise');
    /* Re-render if minutes exist */
    if (window._minutesData) Renderer.renderMinutes(window._minutesData, mode);
  }

  /* ── Language ── */
  function setLanguage(lang) {
    state.language = lang;
    Speech.setLanguage(lang);
    const label = document.getElementById('waveLabel');
    if (label) label.textContent = `AUDIO INPUT / ${lang.toUpperCase()}`;
  }

  /* ── Clear all ── */
  function clearAll() {
    if (state.utterances.length > 0 && !confirm('すべてのデータをクリアしますか？')) return;
    if (state.isRecording) stopRecording();

    state.utterances.length = 0;
    state.startTime = null;
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
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        toggleRecording();
        return;
      }
      if (e.code === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        switchPanel('minutes');
        generateMinutes();
        return;
      }
      if (e.code === 'KeyS' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        Exporter.toPDF();
        return;
      }
    });
  }

  /* ── Date helpers ── */
  function initDateTime() {
    const d = new Date();
    document.title = `Minutes — ${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  }

  function formatDatetime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const Y = d.getFullYear(), M = d.getMonth()+1, D = d.getDate();
    const days = ['日','月','火','水','木','金','土'];
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    return `${Y}年${M}月${D}日(${days[d.getDay()]}) ${h}:${m}`;
  }

  /* ── Settings persistence ── */
  function loadSettings() {
    try {
      const saved = localStorage.getItem('minutes_settings');
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg.orgName)    document.getElementById('orgName').value    = cfg.orgName;
        if (cfg.authorName) document.getElementById('authorName').value = cfg.authorName;
        if (cfg.language)   {
          document.getElementById('langSelect').value = cfg.language;
          setLanguage(cfg.language);
        }
      }
    } catch (_) {}

    ['orgName','authorName','langSelect'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', saveSettings);
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
    init, toggleRecording, generateMinutes,
    filterTranscript, setMode, setLanguage, clearAll,
    get isRecording() { return state.isRecording; },
  };

})();

/* ── Bootstrap ── */
document.addEventListener('DOMContentLoaded', () => App.init());
