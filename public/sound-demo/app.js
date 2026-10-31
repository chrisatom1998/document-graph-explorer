// Page logic for public/sound-demo.html. Everything runs in the browser:
// nothing is uploaded, and no network requests are made.
import { analyze, noteName, toMono } from './analyze.js';
import { SAMPLES, SAMPLE_RATE } from './synth.js';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_SECONDS = 10;

const $ = (id) => document.getElementById(id);

let audioCtx = null;
let playing = null; // the sound currently playing, if any
let current = null; // { name, samples, sampleRate, analysis, fullSeconds }
const sampleCache = new Map();

function context() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function sampleAudio(sample) {
  if (!sampleCache.has(sample.id)) sampleCache.set(sample.id, sample.make());
  return sampleCache.get(sample.id);
}

// ---- playback -------------------------------------------------------------

function stopPlayback() {
  if (playing) {
    try {
      playing.stop();
    } catch {
      /* already stopped */
    }
    playing = null;
  }
  $('play').textContent = '▶ Play';
}

function startPlayback() {
  if (!current) return;
  const ctx = context();
  const buffer = ctx.createBuffer(1, current.samples.length, current.sampleRate);
  buffer.copyToChannel(current.samples, 0);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  source.buffer = buffer;
  source.connect(gain).connect(ctx.destination);
  source.onended = () => {
    if (playing === source) {
      playing = null;
      $('play').textContent = '▶ Play';
    }
  };
  source.start();
  playing = source;
  $('play').textContent = '■ Stop';
}

// ---- drawing --------------------------------------------------------------

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#8d73ff';
}

function prepareCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, rect.width, rect.height);
  return { g, width: rect.width, height: rect.height };
}

function drawWave(samples, peak) {
  const { g, width, height } = prepareCanvas($('wave'));
  const scale = peak > 1e-6 ? 0.92 / peak : 1;
  const mid = height / 2;
  g.strokeStyle = cssColor('--accent');
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x < width; x++) {
    const from = Math.floor((x / width) * samples.length);
    const to = Math.max(from + 1, Math.floor(((x + 1) / width) * samples.length));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      if (samples[i] < lo) lo = samples[i];
      if (samples[i] > hi) hi = samples[i];
    }
    g.moveTo(x + 0.5, mid - hi * scale * mid);
    g.lineTo(x + 0.5, mid - lo * scale * mid - 0.5);
  }
  g.stroke();
}

function drawSpectrum(spectrum) {
  const { g, width, height } = prepareCanvas($('spec'));
  const bands = spectrum.db.length;
  const gap = 1;
  const barWidth = Math.max(1, width / bands - gap);
  g.fillStyle = cssColor('--accent');
  for (let b = 0; b < bands; b++) {
    const level = (spectrum.db[b] + 60) / 60; // 0..1
    const barHeight = Math.max(1, level * (height - 4));
    g.fillRect(b * (width / bands), height - barHeight, barWidth, barHeight);
  }
}

// ---- results --------------------------------------------------------------

function brightnessWord(hz) {
  if (hz < 300) return 'very dark';
  if (hz < 1000) return 'dark';
  if (hz < 3000) return 'warm';
  if (hz < 6000) return 'bright';
  return 'very bright';
}

function factRows(m) {
  const rows = [
    ['Length', `${m.seconds.toFixed(2)} s`],
    ['Starts', m.attack < 0.03 ? 'instantly' : `fades in over ${Math.round(m.attack * 1000)} ms`],
    ['Audible for', `${m.activeSeconds.toFixed(2)} s`],
    ['Brightness', `${brightnessWord(m.centroid)} (${Math.round(m.centroid)} Hz on average)`],
    ['Deep bass', `${Math.round(m.lowShare * 100)}% of the energy`],
    ['Character', m.tonality >= 0.6 ? 'mostly musical' : m.tonality >= 0.3 ? 'a mix of musical and noisy' : 'mostly noise'],
  ];
  if (m.tonality >= 0.5) rows.push(['Main pitch', `${noteName(m.dominantHz) ?? '?'} (${Math.round(m.dominantHz)} Hz)`]);
  return rows;
}

function headlineFor(analysis) {
  const top = analysis.results[0];
  switch (analysis.verdict) {
    case 'likely':
      return `Looks like: ${top.label}`;
    case 'unsure':
      return `Maybe: ${top.label} (not very sure)`;
    case 'silent':
      return 'That clip is silent';
    default:
      return "Can't tell what this is";
  }
}

function renderResult() {
  const { name, samples, sampleRate, analysis, fullSeconds } = current;
  const m = analysis.measurements;

  $('result').hidden = false; // show first so the canvases have a size to draw into
  const headline = $('headline');
  headline.textContent = headlineFor(analysis);
  headline.className = `headline ${analysis.verdict}`;

  const seconds = fullSeconds ?? m.seconds;
  $('source').textContent = `${name} · ${seconds.toFixed(1)} s${seconds > MAX_SECONDS ? ' (first 10 s analysed)' : ''}`;

  const bars = $('bars');
  bars.replaceChildren();
  for (const r of analysis.results) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = r.label;
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${Math.round(r.score * 100)}%`;
    track.append(fill);
    const pct = document.createElement('span');
    pct.className = 'pct';
    pct.textContent = `${Math.round(r.score * 100)}%`;
    li.append(label, track, pct);
    bars.append(li);
  }

  const why = $('why');
  why.replaceChildren();
  const reasons = [...(analysis.why ?? [])];
  if (analysis.verdict === 'unclear' && analysis.allScores) {
    const best = analysis.allScores[0];
    reasons.push(
      `It doesn't fit any of the seven simple sound types well. The closest was ${best.label} at ${Math.round(best.score * 100)}%, which is too low to call.`,
    );
  }
  if (analysis.verdict === 'silent') reasons.push('There is nothing audible to measure.');
  for (const text of reasons) {
    const li = document.createElement('li');
    li.textContent = text;
    why.append(li);
  }

  const facts = $('facts');
  facts.replaceChildren();
  if (!m.silent) {
    for (const [term, value] of factRows(m)) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      facts.append(dt, dd);
    }
    drawWave(samples.subarray(0, Math.min(samples.length, Math.floor(sampleRate * MAX_SECONDS))), m.peak);
    drawSpectrum(m.spectrum);
  }
  $('bars').hidden = analysis.results.length === 0;
  $('fine').hidden = analysis.results.length === 0;
}

function showClip({ name, samples, sampleRate, fullSeconds }) {
  stopPlayback();
  current = { name, samples, sampleRate, fullSeconds, analysis: analyze(samples, sampleRate) };
  renderResult();
}

// ---- inputs ---------------------------------------------------------------

function showError(text) {
  const el = $('error');
  el.textContent = text;
  el.hidden = false;
}

function clearError() {
  $('error').hidden = true;
}

async function handleFile(file) {
  clearError();
  if (!file) return;
  if (file.size > MAX_BYTES) {
    showError('That file is over 25 MB. Try a shorter clip.');
    return;
  }
  try {
    const decoded = await context().decodeAudioData(await file.arrayBuffer());
    const keep = Math.floor(decoded.sampleRate * MAX_SECONDS);
    const channels = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c).subarray(0, keep));
    document.querySelectorAll('.sample[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    showClip({ name: file.name, samples: toMono(channels), sampleRate: decoded.sampleRate, fullSeconds: decoded.duration });
  } catch {
    showError("Couldn't read that file as audio. Try a WAV, MP3, M4A or OGG file.");
  }
}

function buildSampleButtons() {
  const grid = $('samples');
  for (const sample of SAMPLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample';
    button.setAttribute('aria-pressed', 'false');
    const title = document.createElement('b');
    title.textContent = sample.name;
    const blurb = document.createElement('span');
    blurb.textContent = sample.blurb;
    button.append(title, blurb);
    button.addEventListener('click', () => {
      clearError();
      grid.querySelectorAll('.sample').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      showClip({ name: `${sample.name} (built-in)`, samples: sampleAudio(sample), sampleRate: SAMPLE_RATE });
      startPlayback();
    });
    grid.append(button);
  }
}

function setupDropZone() {
  const drop = $('drop');
  const input = $('file');
  input.addEventListener('change', () => {
    void handleFile(input.files?.[0]);
    input.value = ''; // lets you pick the same file twice in a row
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    void handleFile(e.dataTransfer?.files?.[0]);
  });
  // A file dropped just outside the zone should not make the browser navigate to it.
  for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());
}

function runSelfCheck() {
  const chips = $('chips');
  let correct = 0;
  for (const sample of SAMPLES) {
    const result = analyze(sampleAudio(sample), SAMPLE_RATE);
    const heard = result.results[0]?.label ?? 'unclear';
    const ok = heard === sample.expected;
    if (ok) correct++;
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'miss';
    li.textContent = ok ? sample.name : `${sample.name} (heard: ${heard})`;
    chips.append(li);
  }
  $('check-summary').textContent =
    `The built-in sounds are generated by code, so their right answers are known. The listener got ${correct} of ${SAMPLES.length} right.` +
    (correct === SAMPLES.length ? ' That says nothing about how it does on recordings of your own, so treat those results as a best guess.' : '');
}

buildSampleButtons();
setupDropZone();
$('play').addEventListener('click', () => (playing ? stopPlayback() : startPlayback()));
window.addEventListener('resize', () => {
  if (current && !current.analysis.measurements.silent) {
    drawWave(current.samples, current.analysis.measurements.peak);
    drawSpectrum(current.analysis.measurements.spectrum);
  }
});
setTimeout(runSelfCheck, 0);
