// Production UI — the LUFS Web Sampler surface (Amacher).
//
// A pure view over the headless SamplerEngine: it subscribes to engine state,
// renders it, and calls documented engine methods on interaction (see
// docs/AMACHER-BRIEF.md §2 and docs/ui-study/). Two looks over one engine —
// Waveform (viz-forward, live master scope + per-pad thumbnails) and Grid
// (Swiss monospace matrix) — a shared focused step lane, a slide-in Settings
// drawer, drag-and-drop sample upload, and a responsive mobile treatment.
//
// mountUI keeps the shared entry contract: main.ts (served) and demo.ts
// (self-contained) both call it with { init, afterInit? }.
import { PAD_COUNT, type EngineState, type PadState, type SamplerEngine } from './engine/engine.ts';
import { loadDemoKit } from './demokit.ts';

export interface MountOptions {
  /** Caller decides how to init (served worklet vs. the demo's Blob URL). Called inside the tap handler. */
  init: () => Promise<void>;
  /** Optional hook after init (e.g. the demo auto-loads its kit). */
  afterInit?: () => void | Promise<void>;
}

type Look = 'wave' | 'grid';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function mountUI(engine: SamplerEngine, opts: MountOptions): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('stage');
  let selected = 0;
  let teardown: Array<() => void> = [];
  let currentLook: Look = 'wave';
  let deferredInstall: any = null;

  const setStatus = (t: string) => { const el = stage.querySelector('.status'); if (el) el.textContent = t; };
  const isUnverified = (p: PadState) => !p.hasAudio && !p.verified && !!p.checks && p.checks.length > 0;
  const idLabel = (p: PadState) => (p.hasAudio ? p.id : isUnverified(p) ? 'UNVERIFIED' : 'empty');

  function download(bytes: Uint8Array, name: string) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function flashPad(i: number) {
    const el = stage.querySelector('[data-pad="' + i + '"]');
    if (el) { el.classList.add('lit'); setTimeout(() => el.classList.remove('lit'), 150); }
  }

  // ---- the shared action router — every button across both looks + settings + mobile bar
  async function doAction(act: string, arg?: string) {
    const st = engine.state, sel = selected;
    switch (act) {
      case 'play': engine.play(); break;
      case 'stop': engine.stop(); break;
      case 'rec':
        try { if (st.recording) await engine.stopRecording(); else await engine.recordToPad(sel); }
        catch { setStatus('mic unavailable here — drop/load a file or tap demo kit'); }
        break;
      case 'kit': case 'reloadkit': loadDemoKit(engine); setStatus('demo kit loaded onto pads 1–4'); break;
      case 'chop': engine.chopToPads(sel, 16, 0); setStatus('chopped pad ' + (sel + 1) + ' → 16 pads'); break;
      case 'pitchup': engine.setPadPitch(sel, st.pads[sel].pitchSemitones + 1); break;
      case 'pitchdn': engine.setPadPitch(sel, st.pads[sel].pitchSemitones - 1); break;
      case 'gainup': engine.setPadGain(sel, st.pads[sel].gainDb + 1); break;
      case 'gaindn': engine.setPadGain(sel, st.pads[sel].gainDb - 1); break;
      case 'stretch': engine.applyStretch(sel, 2); setStatus('stretch ×2 baked into pad ' + (sel + 1)); break;
      case 'crush': engine.applyBitcrush(sel, 6, 3); setStatus('bitcrush 6-bit baked into pad ' + (sel + 1)); break;
      case 'norm': engine.normalizePad(sel, -1); setStatus('normalized pad ' + (sel + 1) + ' → -1 dBFS'); break;
      case 'choke': { const g = st.pads[sel].choke == null ? 1 : null; engine.setPadChoke(sel, g); setStatus('pad ' + (sel + 1) + (g ? ' → choke group 1' : ' choke off')); break; }
      case 'clear': engine.clearPad(sel); setStatus('cleared pad ' + (sel + 1)); break;
      case 'clearall': for (let i = 0; i < PAD_COUNT; i++) engine.clearPad(i); setStatus('all pads cleared'); break;
      case 'resample': runResample(arg != null ? +arg : sel); break;
      case 'exppad': { const w = engine.exportPadWav(sel); if (w) { download(w, 'pad-' + (sel + 1) + '.wav'); setStatus('exported pad ' + (sel + 1) + ' (24-bit wav)'); } else setStatus('pad ' + (sel + 1) + ' is empty'); break; }
      case 'expmix': { setStatus('rendering mix…'); const w = engine.exportMixWav(1); download(w, 'lws-mix.wav'); setStatus('exported mix (24-bit wav)'); break; }
      case 'save': await engine.saveProject(); setStatus('project saved (OPFS)'); break;
      case 'load': await engine.loadProject(); setStatus('project loaded (OPFS)'); break;
      case 'loadfile': fileInput.click(); break;
      case 'set-steps': engine.setSteps(+(arg || 16)); setStatus('steps → ' + arg); break;
      case 'settings-open': openSettings(); break;
      case 'settings-close': closeSettings(); break;
      case 'resume-audio': { const a = engine.getAnalyser(); try { (a?.context as AudioContext | undefined)?.resume(); } catch { /* ignore */ } renderSettings(); break; }
      case 'req-mic': await reqMic(); break;
      case 'req-midi': await reqMidi(); break;
      case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; renderSettings(); } else setStatus('install unavailable in this context'); break;
      case 'motion': document.body.classList.toggle('reduce-motion', arg === 'on'); document.querySelectorAll('#motionseg button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.arg === arg)); break;
    }
  }

  function runResample(dest: number) {
    const target = stage.querySelector('[data-pad="' + dest + '"]') || stage.querySelector('.resample');
    document.querySelectorAll('.sweep').forEach((s) => { s.classList.remove('go'); void (s as HTMLElement).offsetWidth; s.classList.add('go'); });
    setStatus('bouncing pattern → pad ' + (dest + 1) + ' …');
    engine.resampleSequenceToPad(dest, 1); // synchronous, deterministic offline render
    selected = dest;
    if (target) { target.classList.remove('bounce-flash'); void (target as HTMLElement).offsetWidth; target.classList.add('bounce-flash'); }
    const id = engine.state.pads[dest].id;
    setStatus('resampled pattern → pad ' + (dest + 1) + (id ? '  ·  ' + id : '') + '  (now a one-shot instrument)');
    engine.trigger(dest, 1);
  }

  // ---- permissions
  async function reqMic() {
    const el = document.querySelector('[data-set="mic"]') as HTMLElement | null;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); if (el) { el.textContent = 'granted'; el.className = 'spill ok'; } }
    catch { if (el) { el.textContent = 'blocked'; el.className = 'spill no'; } }
  }
  async function reqMidi() {
    const el = document.querySelector('[data-set="midi"]') as HTMLElement | null;
    const nav = navigator as any;
    if (!nav.requestMIDIAccess) { if (el) { el.textContent = 'unsupported'; el.className = 'spill warn'; } return; }
    try { const a = await nav.requestMIDIAccess({ sysex: false }); const n = a.inputs ? a.inputs.size : 0; if (el) { el.textContent = n ? n + ' input' + (n > 1 ? 's' : '') : 'granted · 0 in'; el.className = 'spill ok'; } }
    catch { if (el) { el.textContent = 'blocked'; el.className = 'spill no'; } }
  }

  // ---- settings drawer
  function openSettings() { renderSettings(); $('scrim').classList.add('open'); $('settings').classList.add('open'); }
  function closeSettings() { $('scrim').classList.remove('open'); $('settings').classList.remove('open'); }
  function renderSettings() {
    const st = engine.state;
    const set = (k: string, txt: string, cls?: string) => { const el = document.querySelector('[data-set="' + k + '"]') as HTMLElement | null; if (el) { el.textContent = txt; if (cls) el.className = 'spill ' + cls; } };
    const an = engine.getAnalyser();
    const ctx = an?.context as AudioContext | undefined;
    set('ctx', ctx ? ctx.state : (st.ready ? 'running' : '—'), ctx && ctx.state === 'running' ? 'ok' : 'warn');
    set('sr', engine.getSampleRate().toLocaleString() + ' Hz');
    const loaded = st.pads.filter((p) => p.hasAudio).length;
    const bad = st.pads.filter((p) => isUnverified(p)).length;
    set('verified', bad ? loaded + ' ok · ' + bad + ' unverified' : loaded + ' / ' + PAD_COUNT + ' loaded', bad ? 'warn' : 'ok');
    const mv = document.querySelector('[data-set="masterv"]') as HTMLElement | null; if (mv) mv.textContent = String(Math.round(st.masterGain * 100));
    const bv = document.querySelector('[data-set="bpmv"]') as HTMLElement | null; if (bv) bv.textContent = String(st.bpm);
    document.querySelectorAll('#stepseg button').forEach((b) => b.classList.toggle('on', +((b as HTMLElement).dataset.arg || 0) === st.steps));
    (document.querySelectorAll('#settings [data-range="master"]') as NodeListOf<HTMLInputElement>).forEach((r) => (r.value = String(Math.round(st.masterGain * 100))));
    (document.querySelectorAll('#settings [data-range="bpm"]') as NodeListOf<HTMLInputElement>).forEach((r) => (r.value = String(st.bpm)));
    const inst = document.querySelector('[data-set="install"]') as HTMLElement | null; if (inst) inst.textContent = deferredInstall ? 'install' : 'unavailable';
  }

  // ---- delegated interaction (attached once)
  function wireGlobal() {
    document.body.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      const c2 = t.closest('[data-step2]');
      if (c2 && stage.contains(c2)) { const [i, s] = (c2 as HTMLElement).dataset.step2!.split('-').map(Number); selected = i; engine.toggleStep(i, s); return; }
      const step = t.closest('[data-step]');
      if (step && stage.contains(step)) { engine.toggleStep(selected, +(step as HTMLElement).dataset.step!); return; }
      const pad = t.closest('[data-pad]');
      if (pad && stage.contains(pad)) { const i = +(pad as HTMLElement).dataset.pad!; selected = i; engine.trigger(i, 1); flashPad(i); LOOKS[currentLook].render(engine.state); return; }
      const sel = t.closest('[data-select]');
      if (sel && stage.contains(sel)) { selected = +(sel as HTMLElement).dataset.select!; LOOKS[currentLook].render(engine.state); return; }
    });
    document.body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const a = t.closest('[data-act]'); if (a) { doAction((a as HTMLElement).dataset.act!, (a as HTMLElement).dataset.arg); return; }
      const mb = t.closest('[data-mbar]'); if (mb && (mb as HTMLElement).dataset.mbar === 'play') { engine.state.playing ? engine.stop() : engine.play(); }
    });
    document.body.addEventListener('input', (e) => {
      const r = (e.target as HTMLElement).closest('[data-range]') as HTMLInputElement | null; if (!r) return;
      if (r.dataset.range === 'bpm') engine.setBpm(+r.value);
      if (r.dataset.range === 'master') engine.setMaster(+r.value / 100);
    });
    // drag-and-drop upload (routes through engine.loadFileToPad)
    const dropHost = (e: DragEvent) => { const h = (e.target as HTMLElement).closest('[data-pad],[data-row]'); return h && stage.contains(h) ? (h as HTMLElement) : null; };
    const clearHot = () => document.querySelectorAll('.drop-hot').forEach((x) => x.classList.remove('drop-hot'));
    (['dragenter', 'dragover'] as const).forEach((ev) => document.addEventListener(ev, (e) => {
      const dt = (e as DragEvent).dataTransfer; if (!dt || ![...dt.types].includes('Files')) return;
      e.preventDefault(); dt.dropEffect = 'copy'; document.body.classList.add('dragging');
      clearHot(); const h = dropHost(e as DragEvent); if (h) h.classList.add('drop-hot');
    }));
    document.addEventListener('dragleave', (e) => { const ev = e as DragEvent; if (ev.clientX <= 0 || ev.clientY <= 0 || ev.clientX >= innerWidth || ev.clientY >= innerHeight) { document.body.classList.remove('dragging'); clearHot(); } });
    document.addEventListener('drop', async (e) => {
      const dt = (e as DragEvent).dataTransfer; if (!dt) return; e.preventDefault();
      document.body.classList.remove('dragging'); const h = dropHost(e as DragEvent); clearHot();
      const start = h ? +(h.dataset.pad ?? h.dataset.row!) : selected;
      await handleFiles(dt.files, start);
    });
  }

  const AUDIO_RE = /\.(wav|mp3|aiff?|flac|ogg|m4a|aac)$/i;
  async function handleFiles(files: FileList, startPad: number) {
    const list = [...files].filter((f) => (f.type && f.type.startsWith('audio/')) || AUDIO_RE.test(f.name));
    if (!list.length) { setStatus('no audio files — need wav/mp3/aiff/flac/ogg/m4a'); return; }
    let pad = clamp(startPad, 0, PAD_COUNT - 1), loaded = 0;
    for (const f of list) {
      if (pad >= PAD_COUNT) break;
      try { await engine.loadFileToPad(pad, await f.arrayBuffer()); selected = pad; loaded++; pad++; }
      catch { setStatus("couldn't decode " + f.name + ' — left pad ' + (pad + 1) + ' as-is'); }
    }
    if (loaded) setStatus('loaded ' + loaded + ' sample' + (loaded > 1 ? 's' : '') + ' onto pad ' + (startPad + 1) + (loaded > 1 ? '–' + (startPad + loaded) : ''));
    LOOKS[currentLook].render(engine.state);
  }

  // ---- shared components
  function stepLaneHTML() {
    let cells = ''; for (let s = 0; s < 16; s++) cells += '<div class="cell" data-step="' + s + '"></div>';
    return '<div class="steplane"><div class="lh"><span class="t">step sequencer — pad <b data-selnum>1</b> <span data-selname></span></span><span class="meta" data-lanemeta></span></div><div class="cells">' + cells + '</div></div>';
  }
  function renderStepLane(root: ParentNode, st: EngineState) {
    const sel = st.pads[selected];
    const sn = root.querySelector('[data-selnum]'); if (sn) sn.textContent = String(selected + 1);
    const nm = root.querySelector('[data-selname]'); if (nm) nm.textContent = sel.hasAudio ? '· ' + sel.name : isUnverified(sel) ? '· unverified' : '· empty';
    const lm = root.querySelector('[data-lanemeta]'); if (lm) lm.textContent = sel.hasAudio ? `${sel.durationS.toFixed(2)}s · ${sel.gainDb > 0 ? '+' : ''}${sel.gainDb}dB${sel.choke != null ? ' · choke ' + sel.choke : ''}` : '—';
    root.querySelectorAll('.steplane .cell').forEach((el, s) => {
      el.classList.toggle('on', !!sel.sequence[s]);
      el.classList.toggle('cur', st.playing && s === st.currentStep);
      el.classList.toggle('hidden', s >= st.steps);
    });
  }
  function miniDotsHTML() { return '<span class="minidots" data-dots></span>'; }
  function renderMiniDots(el: Element | null, p: PadState, st: EngineState) {
    if (!el) return; let h = '';
    for (let s = 0; s < st.steps; s++) h += '<i class="' + (p.sequence[s] ? 'on' : '') + (st.playing && s === st.currentStep ? ' cur' : '') + '"></i>';
    el.innerHTML = h;
  }

  // ============================================================== WAVEFORM
  const WAVE = {
    build() {
      let tiles = '';
      for (let i = 0; i < PAD_COUNT; i++) {
        tiles += '<div class="tile" data-pad="' + i + '">' +
          '<div class="toprow"><span class="num">' + String(i + 1).padStart(2, '0') + '</span>' + miniDotsHTML() + '</div>' +
          '<canvas data-wc="' + i + '" width="220" height="80"></canvas>' +
          '<div class="row"><span class="nm" data-nm></span><span class="du" data-du></span></div>' +
          '<div class="id" data-id></div></div>';
      }
      stage.innerHTML =
        '<div class="scope"><div class="scopehd"><span class="sec-label">master out — live signal</span><span class="sec-label" data-scopemeta>—</span></div><canvas data-scope width="1200" height="176"></canvas></div>' +
        '<div class="cols"><div>' +
        '<div class="tiles">' + tiles + '</div>' + stepLaneHTML() +
        '</div>' +
        '<div class="side">' +
        '<div class="card">' +
        '<div class="transport"><button class="tbtn play" data-act="play">▶ play</button><button class="tbtn" data-act="stop">■ stop</button></div>' +
        '<div class="field"><div class="flabel"><span class="k">Tempo</span><span class="v t" data-bpmv>90</span></div><input type="range" data-range="bpm" min="60" max="180" value="90" aria-label="tempo"></div>' +
        '<div class="field"><div class="flabel"><span class="k">Master</span><span class="v" data-mv>90</span></div><input type="range" data-range="master" min="0" max="100" value="90" aria-label="master"></div>' +
        '</div>' +
        '<button class="resample" data-act="resample"><span class="sweep"></span><div class="big">↺ bounce</div><div class="sm">render the pattern into a waveform on the selected pad</div></button>' +
        '<div class="card"><div class="sec-label">selected · pad <b data-selnum style="color:var(--teal)">1</b></div>' +
        '<div class="grid2">' +
        '<button class="abtn" data-act="pitchdn">pitch −</button><button class="abtn" data-act="pitchup">pitch +</button>' +
        '<button class="abtn" data-act="stretch">stretch ×2</button><button class="abtn" data-act="crush">bitcrush</button>' +
        '<button class="abtn" data-act="norm">normalize</button><button class="abtn" data-act="chop">chop 16</button>' +
        '<button class="abtn" data-act="rec">rec mic</button><button class="abtn" data-act="loadfile">load file</button>' +
        '<button class="abtn" data-act="kit">demo kit</button><button class="abtn danger" data-act="clear">clear</button>' +
        '</div></div>' +
        '</div></div>' +
        '<div class="status"></div>';
      WAVE._runScope();
    },
    _runScope() {
      const cv = stage.querySelector('[data-scope]') as HTMLCanvasElement | null; if (!cv) return;
      const c = cv.getContext('2d')!; let raf = 0; let buf: Float32Array | null = null;
      const draw = () => {
        const an = engine.getAnalyser();
        const w = cv.width, h = cv.height; c.clearRect(0, 0, w, h);
        c.strokeStyle = 'rgba(251,249,226,.08)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
        if (an) {
          if (!buf || buf.length !== an.fftSize) buf = new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(buf);
          c.beginPath(); c.lineWidth = 2; c.strokeStyle = '#78BEBA';
          for (let i = 0; i < buf.length; i++) { const x = (i / buf.length) * w, y = h / 2 - buf[i] * h * 0.46; i ? c.lineTo(x, y) : c.moveTo(x, y); }
          c.stroke();
        }
        raf = requestAnimationFrame(draw);
      };
      draw(); teardown.push(() => cancelAnimationFrame(raf));
    },
    _thumb(i: number, st: EngineState) {
      const cv = stage.querySelector('[data-wc="' + i + '"]') as HTMLCanvasElement | null; if (!cv) return;
      const c = cv.getContext('2d')!, w = cv.width, h = cv.height; c.clearRect(0, 0, w, h);
      const p = st.pads[i];
      if (isUnverified(p)) { c.strokeStyle = 'rgba(211,82,51,.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(4, h / 2); c.lineTo(w - 4, h / 2); c.stroke(); return; }
      if (!p.hasAudio) return;
      const cols = 90; const pk = engine.peaks(i, cols); if (!pk) return;
      c.fillStyle = i === selected ? '#78BEBA' : 'rgba(159,193,208,.85)';
      const bw = w / cols, mid = h / 2;
      for (let k = 0; k < cols; k++) {
        const top = mid - (pk.max[k] || 0) * h * 0.46;
        const bot = mid - (pk.min[k] || 0) * h * 0.46;
        c.fillRect(k * bw, Math.min(top, bot), Math.max(1, bw - 0.6), Math.max(1, Math.abs(bot - top)));
      }
    },
    render(st: EngineState) {
      stage.querySelectorAll('.tile').forEach((el, i) => {
        const p = st.pads[i];
        el.classList.toggle('empty', !p.hasAudio && !isUnverified(p));
        el.classList.toggle('sel', i === selected);
        el.classList.toggle('unverified', isUnverified(p));
        const nm = el.querySelector('[data-nm]') as HTMLElement; nm.textContent = p.hasAudio ? p.name : '＋ drop / load';
        (el.querySelector('[data-du]') as HTMLElement).textContent = p.hasAudio ? p.durationS.toFixed(2) + 's' : '';
        const id = el.querySelector('[data-id]') as HTMLElement; id.textContent = idLabel(p); id.classList.toggle('unv', isUnverified(p));
        renderMiniDots(el.querySelector('[data-dots]'), p, st);
        WAVE._thumb(i, st);
      });
      renderStepLane(stage, st);
      const bv = stage.querySelector('[data-bpmv]'); if (bv) bv.textContent = String(st.bpm);
      const mv = stage.querySelector('[data-mv]'); if (mv) mv.textContent = String(Math.round(st.masterGain * 100));
      (stage.querySelectorAll('[data-range="bpm"]') as NodeListOf<HTMLInputElement>).forEach((r) => (r.value = String(st.bpm)));
      (stage.querySelectorAll('[data-range="master"]') as NodeListOf<HTMLInputElement>).forEach((r) => (r.value = String(Math.round(st.masterGain * 100))));
      stage.querySelectorAll('[data-selnum]').forEach((e) => (e.textContent = String(selected + 1)));
      stage.querySelector('.tbtn.play')?.classList.toggle('on', st.playing);
    },
    onStep() { WAVE.render(engine.state); },
    onLevels(l: { peak: number; voices: number }) {
      const m = stage.querySelector('[data-scopemeta]'); if (m) m.textContent = (l.peak > 0.001 ? 'peak ' + (20 * Math.log10(l.peak)).toFixed(1) + ' dB' : '—') + ' · ' + l.voices + ' voices';
    },
  };

  // ================================================================== GRID
  const GRID = {
    build() {
      let head = '<div class="mhead"><div>#</div><div class="l">content id</div><div>dur</div><div class="pi">pit</div><div class="ga">gain</div>';
      for (let s = 0; s < 16; s++) head += '<div>' + (s + 1) + '</div>'; head += '</div>';
      let rows = '';
      for (let i = 0; i < PAD_COUNT; i++) {
        let cells = ''; for (let s = 0; s < 16; s++) cells += '<div class="cell" data-step2="' + i + '-' + s + '"><div class="cellin"></div></div>';
        rows += '<div class="mrow" data-row="' + i + '"><div class="idx" data-select="' + i + '">' + String(i + 1).padStart(2, '0') + '</div>' +
          '<div class="id" data-pad="' + i + '" data-id></div><div class="du" data-du></div><div class="pi" data-pi></div><div class="ga" data-ga></div>' + cells + '</div>';
      }
      stage.innerHTML =
        '<div class="gwrap"><div class="bar">' +
        '<div class="stat"><span class="k">state</span><span class="v" data-play>stopped</span></div>' +
        '<div class="tbtns"><button class="gbtn play" data-act="play">play</button><button class="gbtn" data-act="stop">stop</button></div>' +
        '<div class="sld"><div class="lab"><span class="k">tempo</span><span class="v" data-bpmv>90 bpm</span></div><input type="range" data-range="bpm" min="60" max="180" value="90" aria-label="tempo"></div>' +
        '<div class="sld"><div class="lab"><span class="k">master</span><span class="v" data-mv>90%</span></div><input type="range" data-range="master" min="0" max="100" value="90" aria-label="master"></div>' +
        '<div class="stat"><span class="k">steps</span><span class="v" data-stepn>16</span></div>' +
        '</div>' +
        '<div class="matrix">' + head + rows + '</div>' +
        stepLaneHTML() +
        '<div class="resample"><div class="rl"><div class="t">↺ resampleSequenceToPad( <span data-selnum>1</span>, 1 )</div><div class="d">bounce the pattern back onto the selected pad — resample-as-instrument</div></div><button class="run" data-act="resample">run</button></div>' +
        '<div class="ops"><span class="lbl">selected pad</span>' +
        '<button class="gbtn" data-act="pitchdn">pitch −</button><button class="gbtn" data-act="pitchup">pitch +</button>' +
        '<button class="gbtn" data-act="gaindn">gain −</button><button class="gbtn" data-act="gainup">gain +</button>' +
        '<button class="gbtn" data-act="choke">choke</button><button class="gbtn" data-act="stretch">stretch</button>' +
        '<button class="gbtn" data-act="crush">crush</button><button class="gbtn" data-act="norm">normalize</button>' +
        '<button class="gbtn" data-act="chop">chop 16</button><button class="gbtn" data-act="kit">demo kit</button>' +
        '<button class="gbtn" data-act="rec">rec</button><button class="gbtn" data-act="loadfile">load file</button><button class="gbtn" data-act="clear">clear</button>' +
        '</div>' +
        '<div class="meterrow"><span class="k">master out</span><div class="meterwrap"><div class="m" data-meter></div></div></div>' +
        '</div><div class="status"></div>';
    },
    render(st: EngineState) {
      stage.querySelectorAll('.mrow').forEach((row, i) => {
        const p = st.pads[i];
        row.classList.toggle('sel', i === selected);
        row.classList.toggle('empty', !p.hasAudio && !isUnverified(p));
        const id = row.querySelector('[data-id]') as HTMLElement; id.textContent = idLabel(p); id.classList.toggle('unv', isUnverified(p));
        (row.querySelector('[data-du]') as HTMLElement).textContent = p.hasAudio ? p.durationS.toFixed(2) : '·';
        (row.querySelector('[data-pi]') as HTMLElement).textContent = p.pitchSemitones ? (p.pitchSemitones > 0 ? '+' : '') + p.pitchSemitones : '0';
        (row.querySelector('[data-ga]') as HTMLElement).textContent = (p.gainDb > 0 ? '+' : '') + p.gainDb;
        for (let s = 0; s < 16; s++) {
          const cell = row.querySelector('[data-step2="' + i + '-' + s + '"]') as HTMLElement | null; if (!cell) continue;
          cell.classList.toggle('on', !!p.sequence[s]);
          cell.classList.toggle('cur', st.playing && s === st.currentStep && s < st.steps);
          cell.style.display = s < st.steps ? 'block' : 'none';
        }
      });
      renderStepLane(stage, st);
      (stage.querySelector('[data-bpmv]') as HTMLElement).textContent = st.bpm + ' bpm';
      (stage.querySelector('[data-mv]') as HTMLElement).textContent = Math.round(st.masterGain * 100) + '%';
      (stage.querySelector('[data-stepn]') as HTMLElement).textContent = String(st.steps);
      (stage.querySelector('[data-play]') as HTMLElement).textContent = st.playing ? 'playing' : st.recording ? 'recording' : 'stopped';
      (stage.querySelectorAll('[data-range="bpm"]') as NodeListOf<HTMLInputElement>).forEach((r) => (r.value = String(st.bpm)));
      (stage.querySelectorAll('[data-range="master"]') as NodeListOf<HTMLInputElement>).forEach((r) => (r.value = String(Math.round(st.masterGain * 100))));
      stage.querySelectorAll('[data-selnum]').forEach((e) => (e.textContent = String(selected + 1)));
      stage.querySelector('.gbtn.play')?.classList.toggle('on', st.playing);
    },
    onStep() { GRID.render(engine.state); },
    onLevels(l: { peak: number; voices: number }) { const m = stage.querySelector('[data-meter]') as HTMLElement | null; if (m) m.style.width = Math.min(100, l.peak * 130) + '%'; },
  };

  const LOOKS: Record<Look, { build: () => void; render: (st: EngineState) => void; onStep: () => void; onLevels: (l: { peak: number; voices: number }) => void }> = { wave: WAVE, grid: GRID };

  function mountLook(look: Look) {
    teardown.forEach((fn) => fn()); teardown = [];
    currentLook = look;
    document.body.dataset.look = look;
    stage.className = look;
    LOOKS[look].build();
    teardown.push(engine.on('state', (s) => { LOOKS[look].render(s as EngineState); syncGlobal(s as EngineState); }));
    teardown.push(engine.on('step', () => LOOKS[look].onStep()));
    teardown.push(engine.on('levels', (l) => LOOKS[look].onLevels(l as { peak: number; voices: number })));
    LOOKS[look].render(engine.state); syncGlobal(engine.state);
    document.querySelectorAll('#switch button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.look === look));
  }
  function syncGlobal(st: EngineState) {
    const mp = document.querySelector('[data-mbar="play"]') as HTMLElement | null; if (mp) { mp.classList.toggle('on', st.playing); mp.textContent = st.playing ? '■' : '▶'; }
    const mb = document.querySelector('[data-mbpm]') as HTMLElement | null; if (mb) mb.textContent = String(st.bpm);
    if ($('settings').classList.contains('open')) renderSettings();
  }

  // ---- hidden multi-file picker (real loadFileToPad path)
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'audio/*'; fileInput.multiple = true; fileInput.id = 'fileInput'; fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', () => { if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files, selected); fileInput.value = ''; });

  // ---- custom cursor (uniform variant — not a lufs.audio hero page)
  function wireCursor() {
    const d = document.querySelector('.cur-dot') as HTMLElement, r = document.querySelector('.cur-ring') as HTMLElement;
    if (!d || !r) return;
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) { d.style.display = r.style.display = 'none'; return; }
    let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
    addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; d.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`; }, { passive: true });
    (function loop() { rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18; r.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`; requestAnimationFrame(loop); })();
    addEventListener('mouseover', (e) => { if ((e.target as HTMLElement).closest('button,input,[data-pad],[data-step],[data-step2],.tile')) r.classList.add('hot'); });
    addEventListener('mouseout', (e) => { if ((e.target as HTMLElement).closest('button,input,[data-pad],[data-step],[data-step2],.tile')) r.classList.remove('hot'); });
  }

  // ---- boot
  wireGlobal();
  wireCursor();
  $('switch').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) mountLook((b as HTMLElement).dataset.look as Look); });
  $('iosx')?.addEventListener('click', () => ($('ios').style.display = 'none'));
  addEventListener('keydown', (e) => {
    if ($('start').style.display !== 'none') return;
    if (e.key === 'Escape') closeSettings();
    if (e.key === '1') mountLook('wave'); if (e.key === '2') mountLook('grid');
    if (e.code === 'Space') { e.preventDefault(); engine.state.playing ? engine.stop() : engine.play(); }
  });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if ($('settings').classList.contains('open')) renderSettings(); });

  $('startBtn').addEventListener('click', async () => {
    try { await opts.init(); } catch (err) { console.error(err); setStatus('audio failed to start — reload and try again'); return; }
    $('start').style.display = 'none';
    $('chrome').style.display = 'flex';
    stage.style.display = 'block';
    $('foot').style.display = 'flex';
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) $('ios').style.display = 'flex';
    mountLook('wave');
    if (opts.afterInit) await opts.afterInit();
    if (engine.state.pads.some((p) => p.hasAudio)) engine.play();
    setStatus(engine.state.playing
      ? 'playing — hit a pad, drop or load samples, edit the lane, then resample it'
      : 'drop or load a sample onto a pad (or tap demo kit) — then sequence and resample');
  });
}
