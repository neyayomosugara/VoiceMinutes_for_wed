/* ═══════════════════════════════════════════════
   EXPORTER.JS v3 — PDF / Word / MD / TXT / JSON
   Fixed: docx 7.8.2 UMD compatibility, lib check
═══════════════════════════════════════════════ */

const Exporter = (() => {

  /* ── Helpers ── */
  function getMinutesData() {
    const data = window._minutesData;
    if (!data) {
      Toast.show('まず議事録を生成してください', 'error');
      return null;
    }
    return data;
  }

  function checkLib(name) {
    const checks = window._libCheck || {};
    if (!checks[name]) {
      Toast.show(`${name} ライブラリの読み込みに失敗しました。インターネット接続を確認してリロードしてください。`, 'error');
      return false;
    }
    return true;
  }

  function getOpts() {
    return {
      includeHeader:     document.getElementById('pdf-header')?.checked ?? true,
      includeToc:        document.getElementById('pdf-toc')?.checked ?? false,
      includeTranscript: document.getElementById('pdf-transcript')?.checked ?? false,
      wordStyles:        document.getElementById('word-styles')?.checked ?? true,
      wordTranscript:    document.getElementById('word-transcript')?.checked ?? false,
    };
  }

  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  }

  function fmtDate() {
    const d = new Date();
    const Y = d.getFullYear(), M = d.getMonth()+1, D = d.getDate();
    const h = String(d.getHours()).padStart(2,'0'), m = String(d.getMinutes()).padStart(2,'0');
    return `${Y}年${M}月${D}日 ${h}:${m}`;
  }

  function getOrgName() {
    return document.getElementById('orgName')?.value.trim() || '';
  }
  function getAuthor() {
    return document.getElementById('authorName')?.value.trim() || '';
  }
  function getUtterances() {
    return window._utterances || [];
  }

  /* ════════════════════════════════════════
     PDF CORE — html2canvas → jsPDF
     Shared by toPDF() and toPrint().
     Returns a jsPDF instance, or null on error.
  ════════════════════════════════════════ */
  async function buildPDFDoc() {
    const minutesPaper = document.getElementById('minutesPaper');
    if (!minutesPaper || !minutesPaper.innerHTML.trim()) {
      Toast.show('まず議事録を生成してください', 'error');
      return null;
    }
    if (!checkLib('jsPDF')) return null;
    if (typeof html2canvas === 'undefined') {
      Toast.show('html2canvas が読み込まれていません。リロードしてください。', 'error');
      return null;
    }

    /* Temporarily ensure element is fully rendered */
    const prevDisplay = minutesPaper.style.display;
    minutesPaper.style.display = 'block';

    const canvas = await html2canvas(minutesPaper, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#f8f6f1',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    minutesPaper.style.display = prevDisplay;

    const { jsPDF } = window.jspdf;
    const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin  = 12;
    const usableW = pdf.internal.pageSize.getWidth()  - margin * 2;
    const usableH = pdf.internal.pageSize.getHeight() - margin * 2;
    const mmPerPx = usableW / canvas.width;
    const totalH  = canvas.height * mmPerPx;

    let placed = 0, first = true;
    while (placed < totalH) {
      if (!first) pdf.addPage();
      first = false;

      const sliceH  = Math.min(usableH, totalH - placed);
      const slicePx = Math.round(sliceH / mmPerPx);
      const srcY    = Math.round(placed / mmPerPx);

      const slice = document.createElement('canvas');
      slice.width  = canvas.width;
      slice.height = slicePx;
      slice.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);

      pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, usableW, sliceH);
      placed += sliceH;
    }

    return pdf;
  }

  /* ════════════════════════════════════════
     PDF DOWNLOAD
  ════════════════════════════════════════ */
  async function toPDF() {
    if (!getMinutesData()) return;
    Toast.show('PDFを生成中...', 'info');
    try {
      const pdf = await buildPDFDoc();
      if (!pdf) return;
      pdf.save(`minutes_${timestamp()}.pdf`);
      Toast.show('PDFを保存しました ✓', 'success');
    } catch (err) {
      console.error('PDF error:', err);
      Toast.show('PDF生成に失敗しました: ' + err.message, 'error');
    }
  }

  /* ════════════════════════════════════════
     PDF PRINT — open as blob URL → print dialog
  ════════════════════════════════════════ */
  async function toPrint() {
    if (!getMinutesData()) return;
    Toast.show('印刷用PDFを準備中...', 'info');
    try {
      const pdf = await buildPDFDoc();
      if (!pdf) return;

      const blob = pdf.output('blob');
      const url  = URL.createObjectURL(blob);
      const win  = window.open(url, '_blank');

      if (win) {
        /* Wait for the PDF viewer to load, then trigger print */
        win.addEventListener('load', () => {
          setTimeout(() => {
            win.print();
            setTimeout(() => URL.revokeObjectURL(url), 15000);
          }, 600);
        });
        /* Fallback if load event doesn't fire (some PDF viewers) */
        setTimeout(() => {
          try { win.print(); } catch (_) {}
          setTimeout(() => URL.revokeObjectURL(url), 15000);
        }, 2000);
      } else {
        /* Popup blocked — save as file instead */
        Toast.show('ポップアップがブロックされました。PDFとして保存します。', 'info');
        pdf.save(`minutes_${timestamp()}.pdf`);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Print error:', err);
      Toast.show('印刷の準備に失敗しました: ' + err.message, 'error');
    }
  }

  /* ════════════════════════════════════════
     WORD EXPORT — docx 7.8.2 (UMD)
  ════════════════════════════════════════ */
  async function toWord() {
    const data = getMinutesData();
    if (!data) return;
    if (!checkLib('docx')) return;
    if (!checkLib('FileSaver')) return;

    const opts = getOpts();
    Toast.show('Word文書を生成中...', 'info');

    try {
      /* docx 7.8.2 UMD exposes everything on window.docx */
      const D = window.docx;
      const {
        Document, Packer, Paragraph, Table, TableRow, TableCell,
        TextRun, HeadingLevel, AlignmentType, BorderStyle,
        ShadingType, WidthType
      } = D;

      const t = (text, opts = {}) => new TextRun({ text: String(text), ...opts });
      const para = (children, opts = {}) =>
        new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });

      const heading2 = (text) => para([
        t(text, { bold: true, size: 24, color: '1C1A17' })
      ], { heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 140 } });

      const bullet = (text, color = '3D3A35') => para([
        t(text, { size: 19, color })
      ], { bullet: { level: 0 }, spacing: { after: 80 } });

      const metaRow = (label, val) => para([
        t(label + '：', { bold: true, size: 19, color: 'A8A49B' }),
        t(val, { size: 19, color: '3D3A35' }),
      ], { spacing: { after: 60 } });

      const hrPara = () => para([], {
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'DDD9CE' } },
        spacing: { after: 200 },
      });

      const spacer = (after = 120) => para([], { spacing: { after } });

      const bodyChildren = [];

      /* Title */
      bodyChildren.push(
        para([t('MEETING MINUTES / 議事録', { size: 15, color: 'A8A49B' })], { spacing: { after: 80 } }),
        para([t(data.title, { bold: true, size: 40, color: '1C1A17' })], { spacing: { after: 160 } }),
        hrPara(),
      );

      /* Meta */
      const metaItems = [
        ['日時',   data.datetime + (data.duration !== '00:00' ? ` （所要時間 ${data.duration}）` : '')],
        data.location  ? ['場所',   data.location]  : null,
        data.attendees ? ['出席者', data.attendees] : null,
        getAuthor()    ? ['作成者', getAuthor()]    : null,
      ].filter(Boolean);

      metaItems.forEach(([label, val]) => {
        bodyChildren.push(metaRow(label, val));
      });
      bodyChildren.push(spacer(240));

      const roman = ['I','II','III','IV','V','VI','VII','VIII'];
      let si = 0;

      if (data.topics.length > 0) {
        bodyChildren.push(heading2(`${roman[si++]}.  議題`));
        data.topics.forEach(tv => bodyChildren.push(bullet(tv, '1D3461')));
        bodyChildren.push(spacer());
      }

      bodyChildren.push(heading2(`${roman[si++]}.  決定事項`));
      if (data.decisions.length > 0) {
        data.decisions.forEach(dv => bodyChildren.push(bullet(dv, '174A35')));
      } else {
        bodyChildren.push(para([t('明示的な決定事項は検出されませんでした。', { italics: true, color: 'A8A49B', size: 19 })], { spacing: { after: 80 } }));
      }
      bodyChildren.push(spacer());

      bodyChildren.push(heading2(`${roman[si++]}.  アクションアイテム`));
      if (data.todos.length > 0) {
        const headerRow = new TableRow({
          children: ['タスク', '担当者', '期限'].map((label, ci) =>
            new TableCell({
              children: [para([t(label, { bold: true, size: 17, color: 'FFFFFF' })])],
              shading: { fill: '1C1A17', type: ShadingType.CLEAR },
              width: ci === 0 ? { size: 55, type: WidthType.PERCENTAGE }
                              : { size: 22, type: WidthType.PERCENTAGE },
            })
          ),
        });

        const todoRows = data.todos.map((todo, i) =>
          new TableRow({
            children: [
              new TableCell({
                children: [para([t(todo.text, { size: 18 })])],
                shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F8F6F1', type: ShadingType.CLEAR },
              }),
              new TableCell({
                children: [para([t(todo.person || '未定', { size: 17, color: todo.person ? '1D3461' : 'A8A49B' })])],
                shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F8F6F1', type: ShadingType.CLEAR },
              }),
              new TableCell({
                children: [para([t(todo.deadline || '未定', { size: 17, color: todo.deadline ? 'B5391E' : 'A8A49B' })])],
                shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F8F6F1', type: ShadingType.CLEAR },
              }),
            ],
          })
        );

        bodyChildren.push(
          new Table({ rows: [headerRow, ...todoRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
          spacer(),
        );
      } else {
        bodyChildren.push(para([t('アクションアイテムは検出されませんでした。', { italics: true, color: 'A8A49B', size: 19 })], { spacing: { after: 80 } }));
        bodyChildren.push(spacer());
      }

      if (data.keyPoints.length > 0) {
        bodyChildren.push(heading2(`${roman[si++]}.  主な議論`));
        data.keyPoints.forEach(p => bodyChildren.push(bullet(p)));
        bodyChildren.push(spacer());
      }

      if (data.nextMeeting) {
        bodyChildren.push(heading2(`${roman[si++]}.  次回予定`));
        bodyChildren.push(bullet(data.nextMeeting));
        bodyChildren.push(spacer());
      }

      bodyChildren.push(
        hrPara(),
        para([t(
          `※ フィラーを自動除去し、話し言葉を整形しています。` +
          `解析元: ${data.stats.utterances}発言 / ${data.stats.chars.toLocaleString()}字 — 完全オフライン処理`,
          { size: 15, color: 'A8A49B', italics: true }
        )], { spacing: { after: 80 } }),
      );

      if (opts.wordTranscript && getUtterances().length > 0) {
        bodyChildren.push(spacer(600));
        bodyChildren.push(para([t('付録：文字起こし全文', { bold: true, size: 28, color: '1C1A17' })], {
          heading: HeadingLevel.HEADING_1, spacing: { after: 200 },
        }));
        bodyChildren.push(hrPara());
        getUtterances().forEach((u, i) =>
          bodyChildren.push(
            para([
              t(String(i + 1).padStart(3, '0') + '  ', { size: 15, color: 'A8A49B', font: 'Courier New' }),
              t(u.text, { size: 18, color: '3D3A35' }),
            ], { spacing: { after: 60 } })
          )
        );
      }

      const doc_obj = new Document({
        creator:      getAuthor() || 'Minutes App',
        title:        data.title,
        description:  '議事録',
        sections: [{
          properties: {
            page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } },
          },
          children: bodyChildren,
        }],
      });

      const blob = await Packer.toBlob(doc_obj);

      /* Use FileSaver if available, otherwise fallback */
      if (typeof window.saveAs === 'function') {
        window.saveAs(blob, `minutes_${timestamp()}.docx`);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `minutes_${timestamp()}.docx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }

      Toast.show('Wordファイルを保存しました ✓', 'success');

    } catch (err) {
      console.error('Word error:', err);
      Toast.show('Word生成に失敗しました: ' + (err.message || err), 'error');
    }
  }

  /* ════════════════════════════════════════
     MARKDOWN
  ════════════════════════════════════════ */
  function toMarkdown() {
    const data = getMinutesData();
    if (!data) return;

    const lines = [];
    const roman = ['I','II','III','IV','V','VI','VII','VIII'];
    let si = 0;

    lines.push(`# ${data.title}`, '');
    lines.push(`> Meeting Minutes / 議事録`, '');
    lines.push(`**日時:** ${data.datetime}${data.duration !== '00:00' ? ` （所要時間 ${data.duration}）` : ''}`);
    if (data.location)  lines.push(`**場所:** ${data.location}`);
    if (data.attendees) lines.push(`**出席者:** ${data.attendees}`);
    if (getAuthor())    lines.push(`**作成者:** ${getAuthor()}`);
    lines.push('', '---', '');

    if (data.topics.length > 0) {
      lines.push(`## ${roman[si++]}. 議題`, '');
      data.topics.forEach(t => lines.push(`- ${t}`));
      lines.push('');
    }

    lines.push(`## ${roman[si++]}. 決定事項`, '');
    if (data.decisions.length > 0) data.decisions.forEach(d => lines.push(`- ${d}`));
    else lines.push('- （明示的な決定事項なし）');
    lines.push('');

    lines.push(`## ${roman[si++]}. アクションアイテム`, '');
    if (data.todos.length > 0) {
      lines.push('| タスク | 担当者 | 期限 |', '|--------|--------|------|');
      data.todos.forEach(t => lines.push(`| ${t.text} | ${t.person || '未定'} | ${t.deadline || '未定'} |`));
    } else lines.push('（なし）');
    lines.push('');

    if (data.keyPoints.length > 0) {
      lines.push(`## ${roman[si++]}. 主な議論`, '');
      data.keyPoints.forEach(p => lines.push(`- ${p}`));
      lines.push('');
    }

    if (data.nextMeeting) {
      lines.push(`## ${roman[si++]}. 次回予定`, '');
      lines.push(`- ${data.nextMeeting}`, '');
    }

    lines.push('---');
    lines.push(`*${data.stats.utterances}発言 / ${data.stats.chars.toLocaleString()}字 — Minutes v1.0*`);

    download(`minutes_${timestamp()}.md`, lines.join('\n'));
    Toast.show('Markdownを保存しました ✓', 'success');
  }

  /* ════════════════════════════════════════
     PLAIN TEXT
  ════════════════════════════════════════ */
  function toText() {
    const data = getMinutesData();
    if (!data) return;

    const bar = '─'.repeat(50);
    const lines = [];
    const roman = ['I','II','III','IV','V','VI','VII','VIII'];
    let si = 0;

    lines.push('MEETING MINUTES / 議事録', bar);
    lines.push(`会議名：${data.title}`);
    lines.push(`日時　：${data.datetime}`);
    if (data.location)  lines.push(`場所　：${data.location}`);
    if (data.attendees) lines.push(`出席者：${data.attendees}`);
    if (getAuthor())    lines.push(`作成者：${getAuthor()}`);
    lines.push(bar, '');

    if (data.topics.length > 0) {
      lines.push(`${roman[si++]}. 議題`);
      data.topics.forEach(t => lines.push(`  ・${t}`));
      lines.push('');
    }

    lines.push(`${roman[si++]}. 決定事項`);
    if (data.decisions.length > 0) data.decisions.forEach(d => lines.push(`  ・${d}`));
    else lines.push('  （明示的な決定事項なし）');
    lines.push('');

    lines.push(`${roman[si++]}. アクションアイテム`);
    if (data.todos.length > 0) {
      data.todos.forEach(t =>
        lines.push(`  ・${t.text}  ［担当: ${t.person || '未定'}  期限: ${t.deadline || '未定'}］`)
      );
    } else lines.push('  （なし）');
    lines.push('');

    if (data.keyPoints.length > 0) {
      lines.push(`${roman[si++]}. 主な議論`);
      data.keyPoints.forEach(p => lines.push(`  ・${p}`));
      lines.push('');
    }

    if (data.nextMeeting) {
      lines.push(`${roman[si++]}. 次回予定`);
      lines.push(`  ・${data.nextMeeting}`, '');
    }

    lines.push(bar);
    lines.push(`${data.stats.utterances}発言 / ${data.stats.chars.toLocaleString()}字 — Minutes v1.0`);

    download(`minutes_${timestamp()}.txt`, lines.join('\n'));
    Toast.show('テキストを保存しました ✓', 'success');
  }

  /* ════════════════════════════════════════
     JSON
  ════════════════════════════════════════ */
  function toJSON() {
    const data = getMinutesData();
    if (!data) return;

    const payload = {
      _schema:    'minutes-v1',
      exportedAt: new Date().toISOString(),
      minutes:    data,
      transcript: getUtterances().map((u, i) => ({
        index: i + 1,
        text:  u.text,
        time:  u.time ? new Date(u.time).toISOString() : null,
      })),
    };

    download(`minutes_${timestamp()}.json`, JSON.stringify(payload, null, 2));
    Toast.show('JSONを保存しました ✓', 'success');
  }

  /* ── File download helper ── */
  function download(filename, content) {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      if (typeof window.saveAs === 'function') {
        window.saveAs(blob, filename);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (err) {
      console.error('Download error:', err);
      Toast.show('ダウンロードに失敗しました', 'error');
    }
  }

  return { toPDF, toPrint, toWord, toMarkdown, toText, toJSON };

})();
