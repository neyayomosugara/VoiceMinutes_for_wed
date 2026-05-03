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
     PDF EXPORT — jsPDF
  ════════════════════════════════════════ */
  async function toPDF() {
    const data = getMinutesData();
    if (!data) return;
    if (!checkLib('jsPDF')) return;

    const opts = getOpts();
    Toast.show('PDFを生成中...', 'info');

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        putOnlyUsedFonts: true,
      });

      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const ml = 20, mr = 20, mt = 24, mb = 20;
      const contentW = W - ml - mr;

      let y = mt;

      const COLOR = {
        ink:        [28, 26, 23],
        inkSoft:    [61, 58, 53],
        inkMuted:   [112, 109, 101],
        inkFaint:   [168, 164, 155],
        accent:     [181, 57, 30],
        decision:   [23, 74, 53],
        decisionBg: [227, 238, 234],
        todoBg:     [245, 236, 226],
        todo:       [122, 56, 0],
        topicBg:    [228, 234, 245],
        topic:      [29, 52, 97],
        rule:       [221, 217, 206],
        paper:      [248, 246, 241],
      };

      const setFont = (size, style = 'normal', color = COLOR.ink) => {
        doc.setFontSize(size);
        doc.setTextColor(...color);
        doc.setFont('helvetica', style);
      };

      const hRule = (yPos, weight = 0.2, color = COLOR.rule) => {
        doc.setDrawColor(...color);
        doc.setLineWidth(weight);
        doc.line(ml, yPos, W - mr, yPos);
        return yPos;
      };

      const checkPage = (needed = 10) => {
        if (y + needed > H - mb - 10) {
          doc.addPage();
          y = mt;
          if (opts.includeHeader) drawPageHeader();
        }
      };

      const drawPageHeader = () => {
        doc.setFillColor(...COLOR.accent);
        doc.rect(0, 0, W, 1.5, 'F');
        if (opts.includeHeader) {
          setFont(7, 'normal', COLOR.inkFaint);
          doc.text(data.title.slice(0, 60), ml, 6);
          doc.text(fmtDate(), W - mr, 6, { align: 'right' });
          if (getOrgName()) doc.text(getOrgName(), W / 2, 6, { align: 'center' });
          hRule(9, 0.15, COLOR.rule);
          y = Math.max(y, 13);
        }
      };

      /* Title page */
      doc.setFillColor(...COLOR.accent);
      doc.rect(0, 0, W, 2, 'F');

      setFont(7.5, 'normal', COLOR.inkFaint);
      doc.text('MEETING MINUTES / 議事録', ml, mt);
      y = mt + 7;

      setFont(20, 'bold', COLOR.ink);
      const titleLines = doc.splitTextToSize(data.title, contentW);
      titleLines.forEach(line => { doc.text(line, ml, y); y += 8; });
      y += 1;

      doc.setFillColor(...COLOR.accent);
      doc.rect(ml, y, 20, 0.6, 'F');
      y += 5;

      const metaRows = [
        ['日時',   data.datetime + (data.duration && data.duration !== '00:00' ? ` （所要時間 ${data.duration}）` : '')],
        data.location  ? ['場所',   data.location]  : null,
        data.attendees ? ['出席者', data.attendees] : null,
        getAuthor()    ? ['作成者', getAuthor()]    : null,
      ].filter(Boolean);

      metaRows.forEach(([label, val]) => {
        checkPage(8);
        setFont(7.5, 'bold', COLOR.inkFaint);
        doc.text(label, ml, y);
        setFont(8.5, 'normal', COLOR.inkSoft);
        const valLines = doc.splitTextToSize(val, contentW - 28);
        valLines.forEach((line, li) => doc.text(line, ml + 28, y + li * 4.5));
        y += valLines.length * 4.5 + 1.5;
      });
      y += 3;
      hRule(y, 0.5, COLOR.ink);
      y += 6;

      const renderSection = (numStr, title, content) => {
        checkPage(18);
        setFont(7.5, 'normal', COLOR.inkFaint);
        doc.text(numStr, ml, y);
        setFont(11, 'bold', COLOR.ink);
        doc.text(title, ml + 10, y);
        y += 2;
        hRule(y, 0.3, COLOR.rule);
        y += 5;
        content();
        y += 4;
      };

      const bulletText = (text, color = COLOR.inkSoft, bgColor = null) => {
        checkPage(8);
        if (bgColor) {
          const lines = doc.splitTextToSize(text, contentW - 14);
          const bH = lines.length * 5.2 + 3;
          doc.setFillColor(...bgColor);
          doc.rect(ml, y - 4, contentW, bH, 'F');
        }
        doc.setFillColor(...color);
        doc.circle(ml + 2, y - 1, 0.8, 'F');
        setFont(9, 'normal', color);
        const lines = doc.splitTextToSize(text, contentW - 8);
        lines.forEach((line, li) => {
          if (li > 0) checkPage(6);
          doc.text(line, ml + 6, y + li * 5.2);
        });
        y += lines.length * 5.2 + 1;
      };

      let sectionNum = 1;
      const roman = ['I','II','III','IV','V','VI','VII','VIII'];

      if (data.topics.length > 0) {
        renderSection(roman[sectionNum - 1] + '.', '議題', () => {
          data.topics.forEach(t => {
            checkPage(8);
            doc.setFillColor(...COLOR.topicBg);
            const tw = doc.getStringUnitWidth(t) * 9 / doc.internal.scaleFactor + 6;
            doc.rect(ml, y - 4, Math.min(tw, contentW), 7, 'F');
            setFont(9, 'normal', COLOR.topic);
            doc.text(t.slice(0, 45), ml + 3, y);
            y += 9;
          });
        });
        sectionNum++;
      }

      renderSection(roman[sectionNum - 1] + '.', '決定事項', () => {
        if (data.decisions.length === 0) {
          setFont(8.5, 'italic', COLOR.inkFaint);
          doc.text('明示的な決定事項は検出されませんでした。', ml + 6, y);
          y += 7;
        } else {
          data.decisions.forEach(d => bulletText(d, COLOR.decision, COLOR.decisionBg));
        }
      });
      sectionNum++;

      renderSection(roman[sectionNum - 1] + '.', 'アクションアイテム', () => {
        if (data.todos.length === 0) {
          setFont(8.5, 'italic', COLOR.inkFaint);
          doc.text('アクションアイテムは検出されませんでした。', ml + 6, y);
          y += 7;
        } else {
          const col = [contentW * 0.55, contentW * 0.22, contentW * 0.23];
          const colX = [ml, ml + col[0], ml + col[0] + col[1]];
          doc.setFillColor(...COLOR.ink);
          doc.rect(ml, y - 4, contentW, 6, 'F');
          setFont(7, 'bold', [255, 255, 255]);
          doc.text('タスク', colX[0] + 2, y);
          doc.text('担当者', colX[1] + 2, y);
          doc.text('期限',   colX[2] + 2, y);
          y += 4;

          data.todos.forEach((t, i) => {
            checkPage(10);
            if (i % 2 === 0) {
              doc.setFillColor(...COLOR.paper);
              doc.rect(ml, y - 4, contentW, 8, 'F');
            }
            setFont(8.5, 'bold', COLOR.ink);
            const taskLines = doc.splitTextToSize(t.text, col[0] - 4);
            doc.text(taskLines[0], colX[0] + 2, y);
            setFont(8, 'normal', t.person ? COLOR.topic : COLOR.inkFaint);
            doc.text(t.person || '未定', colX[1] + 2, y);
            setFont(8, 'normal', t.deadline ? COLOR.accent : COLOR.inkFaint);
            doc.text(t.deadline || '未定', colX[2] + 2, y);
            hRule(y + 3, 0.15, COLOR.rule);
            y += 9;
          });
        }
      });
      sectionNum++;

      if (data.keyPoints.length > 0) {
        renderSection(roman[sectionNum - 1] + '.', '主な議論', () => {
          data.keyPoints.forEach(p => bulletText(p));
        });
        sectionNum++;
      }

      if (data.nextMeeting) {
        renderSection(roman[sectionNum - 1] + '.', '次回予定', () => {
          bulletText(data.nextMeeting);
        });
        sectionNum++;
      }

      if (opts.includeTranscript) {
        doc.addPage();
        y = mt;
        drawPageHeader();
        setFont(12, 'bold', COLOR.ink);
        doc.text('付録：文字起こし全文', ml, y);
        y += 8;
        hRule(y, 0.4, COLOR.ink);
        y += 6;

        getUtterances().forEach((u, i) => {
          checkPage(12);
          setFont(7.5, 'normal', COLOR.inkFaint);
          doc.text(String(i + 1).padStart(3, '0'), ml, y);
          setFont(8.5, 'normal', COLOR.inkSoft);
          const lines = doc.splitTextToSize(u.text, contentW - 12);
          lines.forEach((line, li) => {
            if (li > 0) checkPage(6);
            doc.text(line, ml + 10, y + li * 5);
          });
          y += lines.length * 5 + 2;
          hRule(y, 0.1, COLOR.rule);
          y += 3;
        });
      }

      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        setFont(7, 'normal', COLOR.inkFaint);
        doc.text(`${p} / ${totalPages}`, W / 2, H - 8, { align: 'center' });
        if (getOrgName() && opts.includeHeader) {
          doc.text(getOrgName(), ml, H - 8);
        }
      }

      doc.save(`minutes_${timestamp()}.pdf`);
      Toast.show('PDFを保存しました ✓', 'success');

    } catch (err) {
      console.error('PDF error:', err);
      Toast.show('PDF生成に失敗しました: ' + err.message, 'error');
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

  return { toPDF, toWord, toMarkdown, toText, toJSON };

})();
