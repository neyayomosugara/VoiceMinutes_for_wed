/* ═══════════════════════════════════════════════
   WHISPER-WORKER.JS — Transformers.js inference worker
   Runs as a Module Worker. Used when Web Speech API is unavailable.
═══════════════════════════════════════════════ */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels  = false;
env.useBrowserCache   = true;

let pipe = null;

async function load() {
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

load();

/* Whisper hallucination patterns to suppress */
const HALLUCINATION = /^(\s*|\.{2,}|ご視聴ありがとうございました[。.]*|字幕[はが].{0,20}|Thank you for watching\.?|Subtitles by .+)$/i;

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
