/* ═══════════════════════════════════════════════
   NLP.JS — Japanese NLP Engine
   議事録自動生成のための日本語処理モジュール
═══════════════════════════════════════════════ */

const NLP = (() => {

  /* ── Keyword dictionaries ── */
  const KW = {
    decision: [
      '決定','決まり','決まった','決定した','合意した','合意','承認','採用','採択','可決',
      '承認された','確定','確定した','こととした','することとした','することにした',
      '方向で進める','で進める','に決定','で決定','問題ない','問題なし','OKとする',
      'そうしましょう','そうします','確認できました','了解しました'
    ],
    todo: [
      'してください','お願いします','お願いいたします','お願いできますか',
      '担当','担当してください','対応','対応してください','対応をお願い',
      '確認','確認してください','確認をお願い','調査','調査してください',
      '作成','作成してください','準備','準備してください','実施してください',
      '送ってください','連絡','連絡します','連絡してください','報告','報告してください',
      '提出','提出してください','やっておきます','やります','やることに','宿題',
      'アクション','フォローアップ','までにお願い','次回まで','今週中','今月中',
      'できますか','やっていただけますか','お願いできますでしょうか'
    ],
    topic: [
      'について','に関して','に関する','の件について','の話','テーマ','議題',
      'トピック','話題','議論','アジェンダ','本日の議題','次の議題','まず最初に',
      '続いて','次に','最後に','ということで'
    ],
    importance: [
      '重要','必要','課題','問題','提案','計画','方針','目標','予定','対応',
      '検討','確認','報告','共有','実施','進捗','状況','結果','成果','影響',
      'リスク','改善','検討事項','議論','優先','緊急','至急','留意','注意',
      '懸念','ポイント','まとめ','結論'
    ],
    fillers: [
      'えー','えーと','えっと','あのー','あの','まあ','まー','そうですね',
      'なんか','ちょっと','やっぱり','なんていうか','うーん','うん','んー',
      'んーと','そのー','こー','あれ','ですね','ですけど','なんというか',
      'というか','そうそう','はい、','はい。'
    ],
    normMap: [
      [/([だ])(\s*$|[。、])/g,  'です$2'],
      [/だね(\s*$|[。、])/g,   'ですね$1'],
      [/だよ(\s*$|[。、])/g,   'です$1'],
      [/じゃん/g,              'ではないでしょうか'],
      [/っていう/g,            'という'],
      [/って言/g,              'と言'],
      [/〜+/g,                ''],
      [/～+/g,                ''],
      [/、{2,}/g,             '、'],
      [/。{2,}/g,             '。'],
      [/！+/g,                '。'],
      [/ {2,}/g,              ' '],
      [/　/g,                 ''],
    ],
    personPattern: /([ぁ-んァ-ン一-龯々〆〇]{2,10})(さん|部長|課長|主任|係長|担当|氏|様|チーム|さま|くん|君|先生|社長|専務|常務|取締役)/,
    deadlinePattern: /(\d{1,2}\s*月\s*\d{1,2}\s*日(?:まで)?|今週中|今週|来週中|来週|今月中|今月|来月中|来月|本日中|今日中|明日中|明日|明後日|\d+日以内|\d+日後|\d+週間後|月末|今期|次回|次回まで)/,
    nextMeetingPattern: /(次回[^。]{0,50}|次の?(?:打ち合わせ|会議|ミーティング|MTG|mt)[^。]{0,50}|また来週[^。]{0,30})/,
    numberPattern: /(\d{1,3}(?:[,，]\d{3})*(?:\.\d+)?(?:\s*(?:円|万円|億円|千万円|%|％|個|件|名|人|回|ヶ月|ヵ月|カ月|ヶ月|週間|年|期|版|号|万|億))?|\d+:\d+)/g,
  };

  /* ── Split full text into sentences ── */
  function splitSentences(utterances) {
    const joined = utterances.map(u => u.text).join('。');
    return joined
      .split(/[。！？…]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 5 && !/^[\s。、！？]+$/.test(s));
  }

  /* ── Remove filler words ── */
  function removeFillers(text) {
    let t = text;
    KW.fillers.forEach(f => {
      const re = new RegExp(escRe(f), 'g');
      t = t.replace(re, '');
    });
    return t.trim();
  }

  /* ── Normalize to polite form ── */
  function normalize(text) {
    let t = removeFillers(text);
    KW.normMap.forEach(([re, rep]) => { t = t.replace(re, rep); });
    return t.trim();
  }

  /* ── Score sentence importance ── */
  function scoreSentence(s) {
    let score = 0;
    KW.importance.forEach(w => { if (s.includes(w)) score += 2; });
    if (/\d/.test(s)) score += 1;
    if (s.length >= 14 && s.length <= 100) score += 1;
    if (s.length < 8) score -= 3;
    if (s.length > 200) score -= 1;
    return score;
  }

  /* ── Extract topics ── */
  function extractTopics(sentences) {
    const found = [];
    const seen = new Set();
    sentences.forEach(s => {
      KW.topic.forEach(kw => {
        const idx = s.indexOf(kw);
        if (idx < 0) return;
        let pre = s.slice(Math.max(0, idx - 25), idx).trim();
        pre = pre.replace(/^[、。\s「『（(「【]+/g, '').trim();
        pre = pre.replace(/[、。\s）)」】]+$/g, '').trim();
        if (pre.length >= 2 && pre.length <= 25 && !seen.has(pre)) {
          seen.add(pre);
          found.push(pre);
        }
      });
    });
    return found.slice(0, 8);
  }

  /* ── Extract decisions ── */
  function extractDecisions(sentences) {
    const seen = new Set();
    return sentences
      .filter(s => {
        const hit = KW.decision.some(w => s.includes(w));
        if (!hit) return false;
        const key = s.slice(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10)
      .map(normalize);
  }

  /* ── Extract todos with metadata ── */
  function extractTodos(sentences) {
    const seen = new Set();
    return sentences
      .filter(s => {
        const hit = KW.todo.some(w => s.includes(w));
        if (!hit) return false;
        const key = s.slice(0, 30);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12)
      .map(s => {
        const norm = normalize(s);
        const personMatch = norm.match(KW.personPattern);
        const deadlineMatch = norm.match(KW.deadlinePattern);
        return {
          text: norm.length > 100 ? norm.slice(0, 98) + '…' : norm,
          person: personMatch ? personMatch[0] : null,
          deadline: deadlineMatch ? deadlineMatch[0] : null,
        };
      });
  }

  /* ── Extract key points ── */
  function extractKeyPoints(sentences, count = 8) {
    return sentences
      .map(s => [normalize(s), scoreSentence(s)])
      .filter(([s, sc]) => sc > 0 && s.length >= 12)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([s]) => s);
  }

  /* ── Extract next meeting ── */
  function extractNextMeeting(sentences) {
    for (const s of sentences) {
      const m = s.match(KW.nextMeetingPattern);
      if (m) return normalize(m[0].slice(0, 60));
    }
    return null;
  }

  /* ── Highlight text for transcript display ── */
  function highlightText(rawText, searchQuery = '') {
    let html = escHtml(rawText);

    // Number highlight (do first to avoid double-wrapping)
    html = html.replace(KW.numberPattern,
      '<span class="hl-number">$1</span>');

    // Decision keywords
    KW.decision.forEach(kw => {
      const re = new RegExp(escRe(escHtml(kw)), 'g');
      html = html.replace(re, `<span class="hl-decision">${escHtml(kw)}</span>`);
    });

    // ToDo keywords
    KW.todo.slice(0, 14).forEach(kw => {
      const re = new RegExp(escRe(escHtml(kw)), 'g');
      html = html.replace(re, `<span class="hl-todo">${escHtml(kw)}</span>`);
    });

    // Search query highlight
    if (searchQuery && searchQuery.length >= 1) {
      const qRe = new RegExp(escRe(escHtml(searchQuery)), 'gi');
      html = html.replace(qRe, m => `<mark class="search-match">${m}</mark>`);
    }

    return html;
  }

  /* ── Analyse utterances and build minutes data ── */
  function analyse(utterances, meta) {
    const sentences = splitSentences(utterances);
    return {
      title:       meta.title || '無題の会議',
      attendees:   meta.attendees || '',
      location:    meta.location || '',
      datetime:    meta.datetime,
      duration:    meta.duration,
      topics:      extractTopics(sentences),
      decisions:   extractDecisions(sentences),
      todos:       extractTodos(sentences),
      keyPoints:   extractKeyPoints(sentences),
      nextMeeting: extractNextMeeting(sentences),
      stats: {
        sentences:  sentences.length,
        chars:      utterances.reduce((a, u) => a + u.text.length, 0),
        utterances: utterances.length,
      },
    };
  }

  /* ── Custom keyword management ── */
  function setKeywords(type, arr) {
    if (KW[type] && Array.isArray(arr)) {
      KW[type] = arr.slice();
    }
  }

  function getKeywords(type) {
    return KW[type] ? KW[type].slice() : [];
  }

  /* ── Utilities ── */
  function escHtml(t) {
    return String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escRe(t) {
    return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ── Public API ── */
  return { analyse, highlightText, normalize, escHtml, escRe, KW, setKeywords, getKeywords };

})();
