"""Optional live training charts (Trackio) for HF training jobs.

Off unless TRACKIO_SPACE is set (e.g. cmjatom/dge-training-charts). Then every logged number is synced to that Hugging
Face Space, which is created PRIVATE if it does not exist yet. TRACKIO_PROJECT names the chart group (default dge-tagger)
and TRACKIO_RUN the run (default: the run folder's name).

Only training curves and aggregate scores go here: loss, learning rate, seconds per epoch and validation mAP (overall and
per training source). Never log per-clip or per-tag held-out results: the Space must hold nothing a judge set could leak.
Any Trackio failure is printed and ignored, so charts can never stop a training run.

The same points are also mirrored as one small JSON file per run, charts/<project>/<run>.json in the Space's private
bucket (TRACKIO_BUCKET, default <space>-bucket), at most once a minute, so the claude.ai "Training Charts" page can read
them through the Hugging Face connector.
"""
import json, os, threading, time

_on = False
_mirror = {'points': [], 'sent': 0.0, 'busy': False}


def start(run_name, config):
    global _on
    space = os.environ.get('TRACKIO_SPACE')
    if not space: return
    try:
        import trackio
        trackio.init(project=os.environ.get('TRACKIO_PROJECT', 'dge-tagger'), name=os.environ.get('TRACKIO_RUN') or run_name,
                     space_id=space, private=True, config={k: v for k, v in config.items() if isinstance(v, (int, float, str, bool))},
                     resume='allow')
        _on = True
        _mirror.update(bucket=os.environ.get('TRACKIO_BUCKET') or space + '-bucket',
                       path=f"charts/{os.environ.get('TRACKIO_PROJECT', 'dge-tagger')}/{os.environ.get('TRACKIO_RUN') or run_name}.json",
                       run=os.environ.get('TRACKIO_RUN') or run_name, started=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        print(f'live charts: https://huggingface.co/spaces/{space}', flush=True)
    except Exception as e:  # noqa: BLE001
        print(f'live charts off: {e}', flush=True)


def log(metrics, step=None):
    global _on
    if not _on: return
    try:
        import trackio
        values = {k: float(v) for k, v in metrics.items()}
        trackio.log(values, step=step)
        _mirror['points'].append({'step': step, 't': round(time.time()), **values})
        if time.time() - _mirror['sent'] > 60: _push()
    except Exception as e:  # noqa: BLE001
        _on = False; print(f'live charts off: {e}', flush=True)


def _push(wait=False):
    """Upload the JSON mirror in the background; a slow or failed upload never holds up training."""
    if _mirror['busy']: return
    _mirror['busy'] = True; _mirror['sent'] = time.time()
    pts = _mirror['points']; steps = [p for p in pts if 'epoch' not in p]
    keep = set(map(id, steps[::max(1, -(-len(steps) // 300))]))   # at most ~300 step points, every epoch point
    doc = json.dumps({'run': _mirror['run'], 'started': _mirror['started'], 'updated': round(time.time()), 'done': wait,
                      'points': [p for p in pts if 'epoch' in p or id(p) in keep]}).encode()

    def go():
        try:
            from huggingface_hub import HfApi
            HfApi().batch_bucket_files(_mirror['bucket'], add=[(doc, _mirror['path'])])
        except Exception as e:  # noqa: BLE001
            print(f'chart mirror upload failed: {e}', flush=True)
        finally:
            _mirror['busy'] = False
    t = threading.Thread(target=go, daemon=True); t.start()
    if wait: t.join(120)


def finish():
    if not _on: return
    for _ in range(120):
        if not _mirror['busy']: break
        time.sleep(1)
    _push(wait=True)
    try:
        import trackio
        trackio.finish()
    except Exception as e:  # noqa: BLE001
        print(f'live charts finish failed: {e}', flush=True)
