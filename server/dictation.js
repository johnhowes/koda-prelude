// Dictation (prelude/design-workspace, R-f2y, R-n5q, R-h4u): what the person
// says is turned into text on this computer, by a Whisper speech model that
// Prelude keeps in <home>/speech-models/. Choosing a model downloads it once,
// from Hugging Face: the one thing that goes outside. What's said never does.
//
// The set-up is the person's, on this machine, not any design's:
//   <home>/dictation.json   { status: none|downloading|ready, model, progress, switchingTo }
//
// While a model downloads, every page's channel hears `dictation-changed`
// (the live key "dictation"), and the microphone reloads to show how far it's
// got. Changing the model keeps the old one working until the new one is in,
// then removes the old one.
//
// Transcribing runs whisper.cpp's command-line program (whisper-cli, or
// PRELUDE_WHISPER) on the recording, after ffmpeg (or PRELUDE_FFMPEG) turns
// the browser's recording into the 16 kHz WAV it reads. Both are the
// person's to install; Prelude says so when they're missing.

import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const DICTATION_KEY = 'dictation';

export const SPEECH_MODELS = [
  { id: 'base.en', title: 'Quick', size: '142 MB', says: 'English only. Fast on any computer, but misses more.' },
  { id: 'small', title: 'Balanced', size: '466 MB', says: 'Many languages. A second or two per sentence on most laptops.' },
  { id: 'large-v3-turbo', title: 'Most accurate', size: '1.6 GB', says: 'Many languages, and best with technical words. Slow without a graphics card.' },
];

const modelUrl = id => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`;
const known = id => SPEECH_MODELS.some(model => model.id === id);

const run = (file, args, options = {}) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000, ...options }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stderr })); else resolve(String(stdout));
  });
});

export function createDictation({ home, live, fetcher = fetch }) {
  const file = join(home, 'dictation.json');
  const models = join(home, 'speech-models');
  const modelFile = id => join(models, `ggml-${id}.bin`);
  let download = null;   // { id, controller }

  const read = () => {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      return saved && typeof saved === 'object' ? saved : { status: 'none' };
    } catch { return { status: 'none' }; }
  };
  const write = state => {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    return state;
  };
  const changed = () => live.publish(DICTATION_KEY, 'dictation-changed');

  // A download that Prelude stopped in the middle of (it was closed) is gone:
  // say so as it is now.
  {
    const saved = read();
    if (saved.status === 'downloading') write({ status: 'none' });
    else if (saved.switchingTo) write({ ...saved, switchingTo: null });
  }

  /** Fetch a model into place, telling every page how far it's got. */
  const fetchModel = id => {
    const controller = new AbortController();
    download = { id, controller };
    (async () => {
      const part = `${modelFile(id)}.part`;
      try {
        mkdirSync(models, { recursive: true });
        const res = await fetcher(modelUrl(id), { signal: controller.signal, redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error(`Hugging Face answered ${res.status}.`);
        const total = Number(res.headers.get('content-length')) || 0;
        let got = 0;
        let told = -1;
        let toldAt = 0;
        const counted = Readable.fromWeb(res.body).on('data', chunk => {
          got += chunk.length;
          const progress = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
          if (progress !== told && Date.now() - toldAt > 500) {
            told = progress;
            toldAt = Date.now();
            const state = read();
            if (state.switchingTo === id) write({ ...state, progress });
            else write({ status: 'downloading', model: id, progress });
            changed();
          }
        });
        await pipeline(counted, createWriteStream(part));
        renameSync(part, modelFile(id));
        const state = read();
        // Switching: the new model is in, so the old one goes.
        if (state.switchingTo === id && state.model && state.model !== id) rmSync(modelFile(state.model), { force: true });
        write({ status: 'ready', model: id, progress: 100, switchingTo: null });
      } catch (error) {
        rmSync(part, { force: true });
        const state = read();
        if (state.switchingTo === id) write({ ...state, switchingTo: null, error: controller.signal.aborted ? undefined : `Couldn’t get the speech model: ${error.message}` });
        else write({ status: 'none', ...(controller.signal.aborted ? {} : { error: `Couldn’t get the speech model: ${error.message}` }) });
      } finally {
        if (download?.controller === controller) download = null;
        changed();
      }
    })();
  };

  return {
    /** The set-up as the microphone shows it. */
    state() {
      const { status = 'none', model, progress, switchingTo = null, error } = read();
      if (status === 'ready' && model && !existsSync(modelFile(model))) return { status: 'none' };
      return { status, ...(model ? { model } : {}), ...(progress !== undefined ? { progress } : {}), switchingTo, ...(error ? { error } : {}) };
    },

    /** Turn dictation on with a model: it starts downloading. */
    choose(id) {
      if (!known(id)) return { error: 'Choose one of the speech models.' };
      const now = read();
      if (now.status === 'ready' && now.model === id) return {};
      download?.controller.abort();
      write({ status: 'downloading', model: id, progress: 0 });
      fetchModel(id);
      return {};
    },

    /** Change the model: the one in use keeps working until the new one is in (R-h4u). */
    switchTo(id) {
      if (!known(id)) return { error: 'Choose one of the speech models.' };
      const now = read();
      if (now.status !== 'ready') return this.choose(id);
      if (now.model === id) return {};
      download?.controller.abort();
      write({ ...now, switchingTo: id, progress: 0, error: undefined });
      fetchModel(id);
      return {};
    },

    /** Stop downloading: dictation stays off, or on with the model it had. */
    cancel() {
      download?.controller.abort();
      download = null;
      const now = read();
      write(now.switchingTo ? { ...now, switchingTo: null } : { status: 'none' });
    },

    /** Remove the model: dictation is off until it's set up again. */
    remove() {
      download?.controller.abort();
      download = null;
      const now = read();
      for (const id of [now.model, now.switchingTo].filter(Boolean)) {
        rmSync(modelFile(id), { force: true });
        rmSync(`${modelFile(id)}.part`, { force: true });
      }
      write({ status: 'none' });
    },

    /**
     * What was said in a recording, as text, transcribed here. `prompt` is the
     * design's own words, so the model spells them right. Throws with a
     * sentence for the person when it can't.
     */
    async transcribe(recording, { prompt = '' } = {}) {
      const now = read();
      if (now.status !== 'ready' || !now.model || !existsSync(modelFile(now.model))) throw new Error('Dictation isn’t set up: choose a speech model first.');
      const work = mkdtempSync(join(tmpdir(), 'prelude-dictation-'));
      try {
        const input = join(work, 'said.webm');
        const wav = join(work, 'said.wav');
        writeFileSync(input, recording);
        try {
          await run(process.env.PRELUDE_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
        } catch (error) {
          throw new Error(error.code === 'ENOENT' ? 'Dictation needs ffmpeg on this computer, to read the recording. Install it, or set PRELUDE_FFMPEG.' : 'The recording couldn’t be read.');
        }
        let out;
        try {
          out = await run(process.env.PRELUDE_WHISPER || 'whisper-cli', ['-m', modelFile(now.model), '-f', wav, '-nt', '-np', '-l', now.model.endsWith('.en') ? 'en' : 'auto', ...(prompt ? ['--prompt', prompt.slice(0, 800)] : [])]);
        } catch (error) {
          throw new Error(error.code === 'ENOENT' ? 'Dictation needs whisper.cpp’s whisper-cli on this computer. Install it, or set PRELUDE_WHISPER.' : 'The speech model couldn’t transcribe that.');
        }
        return out.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },

    closeAll() { download?.controller.abort(); },
  };
}
