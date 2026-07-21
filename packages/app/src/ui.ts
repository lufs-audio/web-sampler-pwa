// Shared throwaway UI. Its only job is to exercise every public SamplerEngine
// method so the wiring surface is proven end-to-end before Amacher builds the
// real UI. Used by both entries: main.ts (production shell) and demo.ts
// (self-contained published demo). Not the deliverable — the engine is.
import { PAD_COUNT, type EngineState, type SamplerEngine } from './engine/engine.ts';
import { loadDemoKit } from './demokit.ts';

export interface MountOptions {
  /** Caller decides how to init (production uses the served worklet; the demo a Blob URL). */
  init: () => Promise<void>;
  /** Optional hook after init (e.g. auto-load the demo kit). */
  afterInit?: () => void | Promise<void>;
}

export function mountUI(engine: SamplerEngine, opts: MountOptions): void {
  let selected = 0;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const padsEl = $('pads');
  const seqEl = $('seq');

  const download = (bytes: Uint8Array, name: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  function buildPads() {
    padsEl.innerHTML = '';
    for (let i = 0; i < PAD_COUNT; i++) {
      const el = document.createElement('div');
      el.className = 'pad';
      el.addEventListener('pointerdown', () => {
        selected = i;
        engine.trigger(i, 1);
        render(engine.state);
      });
      padsEl.appendChild(el);
    }
  }

  function buildSeq() {
    seqEl.innerHTML = '';
    for (let s = 0; s < engine.state.steps; s++) {
      const el = document.createElement('div');
      el.className = 'step';
      el.addEventListener('pointerdown', () => engine.toggleStep(selected, s));
      seqEl.appendChild(el);
    }
  }

  function render(st: EngineState) {
    [...padsEl.children].forEach((el, i) => {
      const p = st.pads[i];
      el.className = 'pad' + (p.hasAudio ? ' has' : '') + (i === selected ? ' sel' : '');
      el.innerHTML =
        `<div>${i + 1}${p.pitchSemitones ? ` ${p.pitchSemitones > 0 ? '+' : ''}${p.pitchSemitones}st` : ''}</div>` +
        `<div class="${p.verified || !p.hasAudio ? 'id' : 'warn'}">${p.hasAudio ? (p.verified ? p.id : 'UNVERIFIED') : ''}</div>`;
    });
    const sel = st.pads[selected];
    [...seqEl.children].forEach((el, s) => {
      el.className = 'step' + (sel.sequence[s] ? ' on' : '') + (st.playing && s === st.currentStep ? ' cur' : '');
    });
    $('bpmv').textContent = String(st.bpm);
    $('status').textContent = `pad ${selected + 1} · ${sel.hasAudio ? `${sel.durationS.toFixed(2)}s · ${sel.id}` : 'empty'} · ${st.playing ? 'playing' : 'stopped'}`;
  }

  function wireControls() {
    $('play').addEventListener('click', () => engine.play());
    $('stop').addEventListener('click', () => engine.stop());
    $<HTMLInputElement>('bpm').addEventListener('input', (e) => engine.setBpm(+(e.target as HTMLInputElement).value));
    $('rec').addEventListener('click', async () => {
      try {
        if (engine.state.recording) await engine.stopRecording();
        else await engine.recordToPad(selected);
      } catch {
        $('status').textContent = 'mic unavailable here — try the demo kit / load a file';
      }
    });
    $('kit').addEventListener('click', () => loadDemoKit(engine));
    $('chop').addEventListener('click', () => engine.chopToPads(selected, 16, 0));
    $('pitchdn').addEventListener('click', () => engine.setPadPitch(selected, engine.state.pads[selected].pitchSemitones - 1));
    $('pitchup').addEventListener('click', () => engine.setPadPitch(selected, engine.state.pads[selected].pitchSemitones + 1));
    $('stretch2').addEventListener('click', () => engine.applyStretch(selected, 2));
    $('crush').addEventListener('click', () => engine.applyBitcrush(selected, 6, 3));
    $('norm').addEventListener('click', () => engine.normalizePad(selected, -1));
    $('clear').addEventListener('click', () => engine.clearPad(selected));
    $('resample').addEventListener('click', () => engine.resampleSequenceToPad(selected, 1));
    $('expPad').addEventListener('click', () => {
      const w = engine.exportPadWav(selected);
      if (w) download(w, `pad-${selected + 1}.wav`);
    });
    $('expMix').addEventListener('click', () => download(engine.exportMixWav(1), 'mix.wav'));
    $('save').addEventListener('click', () => engine.saveProject());
    $('load').addEventListener('click', () => engine.loadProject());
    const file = $<HTMLInputElement>('file');
    $('loadFile').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      if (file.files?.[0]) await engine.loadFileToPad(selected, await file.files[0].arrayBuffer());
    });
  }

  $('startBtn').addEventListener('click', async () => {
    await opts.init();
    $('start').hidden = true;
    $('app').hidden = false;
    buildPads();
    buildSeq();
    wireControls();
    engine.on('state', (s) => render(s as EngineState));
    engine.on('levels', (l) => {
      ($('meter') as HTMLElement).style.width = Math.min(100, (l as { peak: number }).peak * 100) + '%';
    });
    if (opts.afterInit) await opts.afterInit();
    render(engine.state);
  });
}
