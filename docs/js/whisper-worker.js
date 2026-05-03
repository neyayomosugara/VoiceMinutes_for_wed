/* ═══════════════════════════════════════════════
   WHISPER-WORKER.JS v2 — Multi-CDN fallback
   CDN order: jsdelivr → unpkg → esm.sh
   Runs as a Module Worker. Used when Web Speech API
   is unavailable (Brave, Firefox, etc.).
═══════════════════════════════════════════════ */

const CDNS = [
  'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2',
  'https://unpkg.com/@xenova/transformers@2.17.2',
];

let pipe = null;

async function loadLib() {
  for (const cdn of CDNS) {
    try {
      const lib = await import(cdn);
      console.log('[Whisper] loaded from:', cdn);
      return lib;
    } catch (e) {
      console.warn('[Whisper] CDN failed:', cdn, e.message);
    }
  }
  return null;
}

async function main() {
  const lib = await loadLib();
  if (!lib) {
    self.postMessage({ type: 'error', message: 'すべてのCDNからTransformers.jsの読み込みに失敗しました' });
    return;
  }

  const { pipeline, env } = lib;
  env.allowLocalModels = false;
  env.useBrowserCache  = true;

  try {
    pipe = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny',
      {
        quantized: true,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total > 0) {
            self.postMessage({ type: 'progress', pct: Math.round(p.loaded / p.total * 100) });
          }
        },
      }
    );
    self.postMessage({ type: 'ready' });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message });
  }
}

main();

/* Whisper hallucination suppression */
const HALLUCINATION = /^(\s*|\.{2,}|ご視聴ありがとうございました[。.]*|字幕[はが].{0,20}|Thank you for watching\.?|Subtitles by .+|翻訳:.+)$/i;

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe' || !pipe) return;
  try {
    const out  = await pipe(data.audio, {
      language:          data.lang || 'japanese',
      task:              'transcribe',
      return_timestamps: false,
    });
    const raw  = (out.text || '').trim();
    const text = HALLUCINATION.test(raw) ? '' : raw;
    self.postMessage({ type: 'result', text, id: data.id });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message });
  }
};
