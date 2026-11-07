/**
 * One sound at a time. Every media element that starts playing pauses every
 * other element that is playing, whichever player owns it (the bottom transport,
 * the inspector's clip player, the audio preview, detached `new Audio()`s).
 * Both start orders are covered because the rule lives here, not in each player.
 *
 * `play` does not bubble, so one capture listener on `document` sees all
 * in-page elements; `trackPlayback` covers elements that are not in the DOM.
 */
const playing = new Set<HTMLMediaElement>();
let installed = false;

function onPlay(event: Event): void {
  const started = event.target;
  if (!(started instanceof HTMLMediaElement)) return;
  for (const other of [...playing]) {
    if (other !== started) other.pause();
  }
  playing.add(started);
}

function onStop(event: Event): void {
  if (event.target instanceof HTMLMediaElement) playing.delete(event.target);
}

export function installSinglePlayer(): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  document.addEventListener('play', onPlay, true);
  document.addEventListener('pause', onStop, true);
  document.addEventListener('ended', onStop, true);
  return () => {
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('pause', onStop, true);
    document.removeEventListener('ended', onStop, true);
    playing.clear();
    installed = false;
  };
}

/** Subscribe a detached element (not in the DOM) to the same rule. */
export function trackPlayback(element: HTMLMediaElement): () => void {
  const start = () => onPlay({ target: element } as unknown as Event);
  const stop = () => playing.delete(element);
  element.addEventListener('play', start);
  element.addEventListener('pause', stop);
  element.addEventListener('ended', stop);
  return () => { stop(); element.removeEventListener('play', start); element.removeEventListener('pause', stop); element.removeEventListener('ended', stop); };
}
