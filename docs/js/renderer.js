/* ═══════════════════════════════════════════════
   RENDERER.JS — DOM Rendering Module
   Transcript and Minutes document rendering
═══════════════════════════════════════════════ */

const Renderer = (() => {

  /* ══════════════════════════════
     WAVEFORM CANVAS
  ══════════════════════════════ */
  let canvas, ctx, bars, animFrame;
  let amplitude = 0, isRecording = false;

  function initWaveform() {
    canvas = document.getElementById('waveCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    bars = new Float32Array(72).fill(0.03);
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    drawLoop();
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width  = canvas.offsetWidth  * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
  }

  function setAmplitude(val) { amplitude = val; }
  function setRecording(val) { isRecording = val; }

  function drawLoop() {
    animFrame = requestAnimationFrame(drawLoop);
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const N   = bars.length;
    const bW  = (W / N) * 0.52;
    const gap = (W / N) * 0.48;

    const now = Date.now();

    for (let i = 0; i < N; i++) {
      const tgt = isRecording
        ? amplitude * (0.2 + 0.8 * Math.abs(Math.sin(now * 0.0035 + i * 0.45)))
        : 0.025 + 0.018 * Math.sin(now * 0.0009 + i * 0.28);

      bars[i] += (tgt - bars[i]) * (isRecording ? 0.38 : 0.07);
      bars[i] = Math.max(0.012, Math.min(1, bars[i]));

      const x  = i * (bW + gap);
      const bH = bars[i] * H * 0.84;
      const y  = (H - bH) / 2;

      /* Warm red when recording, muted grey at rest */
      const alpha = isRecording ? 0.45 + bars[i] * 0.5 : 0.2 + bars[i] * 0.25;
      ctx.fillStyle = isRecording
        ? `rgba(181,57,30,${alpha})`
        : `rgba(112,109,101,${alpha})`;

      ctx.fillRect(x, y, bW, bH);
    }
  }

  /* ══════════════════════════════
     TRANSCRIPT
  ══════════════════════════════ */
  let editCallback = null;
  function setEditCallback(fn) { editCallback = fn; }

  function startEdit(utteranceDiv, index, currentText) {
    if (utteranceDiv.classList.contains('editing')) return;
    utteranceDiv.classList.add('editing');

    const textDiv = utteranceDiv.querySelector('.utterance-text');
    if (textDiv) textDiv.style.display = 'none';

    const textarea = document.createElement('textarea');
    textarea.className = 'utterance-edit-area';
    textarea.value = currentText;
    textarea.rows = Math.max(2, Math.ceil(currentText.length / 40));

    let isSaving = false;

    const saveEdit = () => {
      if (isSaving) return;
      isSaving = true;
      const newText = textarea.value.trim();
      if (newText && editCallback) {
        editCallback(index, newText);
      } else {
        utteranceDiv.classList.remove('editing');
        if (textDiv) textDiv.style.display = '';
        if (textarea.parentNode) textarea.remove();
      }
    };

    const cancelEdit = () => {
      if (isSaving) return;
      isSaving = true;
      utteranceDiv.classList.remove('editing');
      if (textDiv) textDiv.style.display = '';
      if (textarea.parentNode) textarea.remove();
    };

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    textarea.addEventListener('blur', saveEdit);

    utteranceDiv.insertBefore(textarea, textDiv ? textDiv.nextSibling : null);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function renderTranscript(utterances, searchQuery = '', highlights = true) {
    const paper = document.getElementById('transcriptPaper');
    const empty = document.getElementById('transcriptEmpty');
    if (!paper) return;

    if (utterances.length === 0) {
      empty && (empty.style.display = '');
      paper.innerHTML = '';
      paper.appendChild(empty || createEmptyState());
      return;
    }

    if (empty) empty.style.display = 'none';

    /* Build fragment for performance */
    const frag = document.createDocumentFragment();
    const query = searchQuery.trim().toLowerCase();

    utterances.forEach((u, i) => {
      if (query && !u.text.toLowerCase().includes(query)) return;

      const div = document.createElement('div');
      div.className = 'utterance';
      div.dataset.index = i;

      const numSpan = document.createElement('span');
      numSpan.className = 'utterance-num';
      numSpan.textContent = String(i + 1).padStart(3, '0');

      const textDiv = document.createElement('div');
      textDiv.className = 'utterance-text';
      textDiv.innerHTML = highlights
        ? NLP.highlightText(u.text, searchQuery)
        : NLP.escHtml(u.text);

      const timeDiv = document.createElement('div');
      timeDiv.className = 'utterance-time';
      timeDiv.textContent = formatTime(u.time);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'utterance-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'utterance-edit-btn';
      editBtn.title = '編集 (Ctrl+Enter で確定 / Esc でキャンセル)';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startEdit(div, i, u.text);
      });
      actionsDiv.appendChild(editBtn);

      div.appendChild(numSpan);
      div.appendChild(textDiv);
      div.appendChild(timeDiv);
      div.appendChild(actionsDiv);
      frag.appendChild(div);
    });

    /* Preserve scroll position if not at bottom */
    const atBottom = paper.scrollTop + paper.clientHeight >= paper.scrollHeight - 40;
    paper.innerHTML = '';
    paper.appendChild(frag);
    if (atBottom) paper.scrollTop = paper.scrollHeight;
  }

  function appendPartial(text) {
    const paper = document.getElementById('transcriptPaper');
    if (!paper) return;
    removePartial();

    if (!text.trim()) return;

    const div = document.createElement('div');
    div.className = 'utterance partial';
    div.id = '__partial__';

    const numSpan = document.createElement('span');
    numSpan.className = 'utterance-num';
    numSpan.textContent = '···';

    const textDiv = document.createElement('div');
    textDiv.className = 'utterance-text';
    textDiv.textContent = text;

    div.appendChild(numSpan);
    div.appendChild(textDiv);
    paper.appendChild(div);
    paper.scrollTop = paper.scrollHeight;
  }

  function removePartial() {
    const el = document.getElementById('__partial__');
    if (el) el.remove();
  }

  /* ══════════════════════════════
     MINUTES DOCUMENT
  ══════════════════════════════ */
  function renderMinutes(data, mode = 'formal') {
    const container = document.getElementById('minutesPaper');
    const empty     = document.getElementById('minutesEmpty');
    if (!container) return;

    if (empty) empty.style.display = 'none';
    container.style.display = 'block';

    const concise = mode === 'concise';

    /* Loading overlay */
    showGenerating(true);

    setTimeout(() => {
      container.innerHTML = buildMinutesHTML(data, concise);
      showGenerating(false);
    }, 350);
  }

  function buildMinutesHTML(d, concise) {
    const { e, num } = htmlHelpers();
    const sections = [];
    let sectionNum = 1;

    /* ── Document Header ── */
    const metaRows = [
      ['日時',   d.datetime + (d.duration !== '00:00' ? `（所要時間 ${d.duration}）` : '')],
      d.location  ? ['場所 / 形式', d.location]  : null,
      d.attendees ? ['出席者',       d.attendees] : null,
    ].filter(Boolean);

    const metaCells = metaRows.map(([label, val]) =>
      `<dt class="doc-meta-label">${e(label)}</dt><dd class="doc-meta-value">${e(val)}</dd>`
    ).join('');

    const header = `
      <div class="doc-header">
        <div class="doc-eyebrow">Meeting Minutes / 議事録</div>
        <h1 class="doc-title">${e(d.title)}</h1>
        <dl class="doc-meta-grid">${metaCells}</dl>
      </div>
    `;

    /* ── I. 議題 ── */
    if (d.topics.length > 0) {
      const chips = d.topics.map(t =>
        `<span class="topic-chip">${e(t)}</span>`
      ).join('');
      sections.push(section(num(sectionNum++), '議題 / Topics', `TOPICS ${d.topics.length}`,
        `<div class="topic-chips">${chips}</div>`
      ));
    }

    /* ── II. 決定事項 ── */
    const decisionContent = d.decisions.length > 0
      ? `<ul class="doc-bullet-list decision">${d.decisions.map(x =>
          `<li>${highlightDecision(e(x))}</li>`).join('')}</ul>`
      : `<p style="font-family:var(--font-jp);font-size:0.9rem;color:var(--clr-ink-faint);font-style:italic;padding:var(--sp-3) 0;">明示的な決定事項は検出されませんでした。</p>`;

    sections.push(section(num(sectionNum++), '決定事項', `DECISIONS ${d.decisions.length}`,
      decisionContent
    ));

    /* ── III. アクションアイテム ── */
    let todoContent;
    if (d.todos.length > 0) {
      const rows = d.todos.map(t => `
        <tr>
          <td class="todo-task">${e(t.text)}</td>
          <td>${t.person
            ? `<span class="todo-badge person">${e(t.person)}</span>`
            : `<span class="todo-badge unset">未定</span>`}</td>
          <td>${t.deadline
            ? `<span class="todo-badge deadline">${e(t.deadline)}</span>`
            : `<span class="todo-badge unset">未定</span>`}</td>
        </tr>
      `).join('');

      todoContent = `
        <table class="todo-table">
          <thead>
            <tr>
              <th>タスク</th>
              <th style="width:140px">担当者</th>
              <th style="width:120px">期限</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } else {
      todoContent = `<p style="font-family:var(--font-jp);font-size:0.9rem;color:var(--clr-ink-faint);font-style:italic;padding:var(--sp-3) 0;">アクションアイテムは検出されませんでした。</p>`;
    }

    sections.push(section(num(sectionNum++), 'アクションアイテム', `TODO ${d.todos.length}`,
      todoContent
    ));

    /* ── IV. 主な議論 (formal only) ── */
    if (!concise && d.keyPoints.length > 0) {
      const items = d.keyPoints.map(x =>
        `<li>${e(x)}</li>`
      ).join('');
      sections.push(section(num(sectionNum++), '主な議論', 'KEY POINTS',
        `<ul class="doc-bullet-list">${items}</ul>`
      ));
    }

    /* ── V. 次回予定 ── */
    if (d.nextMeeting) {
      sections.push(section(num(sectionNum++), '次回予定', 'NEXT',
        `<ul class="doc-bullet-list"><li>${e(d.nextMeeting)}</li></ul>`
      ));
    }

    /* ── Footnote ── */
    const footnote = `
      <p class="doc-footnote">
        ※ フィラー（えー、あのー等）を自動除去し、話し言葉を書き言葉に整形しています。<br>
        解析元: ${d.stats.utterances} 発言 / ${d.stats.sentences} 文 / ${d.stats.chars.toLocaleString()} 字
        — 完全オフライン処理（Minutes v1.0）
      </p>
    `;

    return header + sections.join('') + footnote;
  }

  function section(numStr, title, badge, content) {
    return `
      <div class="doc-section">
        <div class="doc-section-header">
          <span class="doc-section-num">${numStr}</span>
          <h2 class="doc-section-title">${title}</h2>
          <span class="doc-section-badge">${badge}</span>
        </div>
        ${content}
      </div>
    `;
  }

  function highlightDecision(html) {
    const KW_D = ['決定','合意','承認','採用','採択','確定'];
    KW_D.forEach(kw => {
      const re = new RegExp(NLP.escRe(kw), 'g');
      html = html.replace(re, `<strong>${kw}</strong>`);
    });
    return html;
  }

  function showGenerating(show) {
    let overlay = document.querySelector('.generating-overlay');
    if (!overlay && show) {
      overlay = document.createElement('div');
      overlay.className = 'generating-overlay';
      overlay.innerHTML = `
        <div class="dots-loader">
          <span></span><span></span><span></span>
        </div>
        <span class="generating-label">解析・生成中...</span>
      `;
      const container = document.getElementById('minutesContainer');
      if (container) container.style.position = 'relative', container.appendChild(overlay);
    }
    if (overlay) {
      setTimeout(() => overlay.classList.toggle('show', show), show ? 0 : 10);
    }
  }

  /* ── Helpers ── */
  function htmlHelpers() {
    const e = NLP.escHtml;
    const romanNumerals = ['I','II','III','IV','V','VI','VII','VIII'];
    const num = i => romanNumerals[i - 1] || String(i);
    return { e, num };
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  function createEmptyState() {
    const div = document.createElement('div');
    div.id = 'transcriptEmpty';
    div.className = 'transcript-empty';
    div.innerHTML = `
      <div class="empty-icon">🎙</div>
      <p>録音を開始すると、ここに発言がリアルタイムで記録されます</p>
      <p class="empty-hint">スペースキーでも録音を開始できます</p>
    `;
    return div;
  }

  /* ── Public API ── */
  return {
    initWaveform,
    setAmplitude,
    setRecording,
    renderTranscript,
    appendPartial,
    removePartial,
    renderMinutes,
    setEditCallback,
  };

})();
