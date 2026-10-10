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

_on = False        # logging is allowed
_started = False   # a run was opened and still needs finish()
_mirror = {'points': [], 'sent': 0.0, 'busy': False}


def _auto_space():
    """Scripts run by hand (not through hf-launch.py) chart to <account>/dge-training-charts when an HF token is present."""
    if os.environ.get('TRACKIO_SPACE') is not None or not (os.environ.get('HF_TOKEN') or os.environ.get('HUGGING_FACE_HUB_TOKEN')): return None
    try:
        from huggingface_hub import whoami
        return f"{whoami()['name']}/dge-training-charts"
    except Exception as e:  # noqa: BLE001
        print(f'live charts off: {e}', flush=True); return None


def start(run_name, config, auto=False):
    """auto=True: also chart when TRACKIO_SPACE is unset but an HF token exists (set TRACKIO_SPACE= empty to opt out)."""
    global _on, _started
    space = os.environ.get('TRACKIO_SPACE') or (_auto_space() if auto else None)
    if not space: return
    if auto and not os.environ.get('TRACKIO_RUN'): os.environ['TRACKIO_RUN'] = f"{run_name}{time.strftime('-%m%d-%H%M-')}{os.urandom(2).hex()}"
    os.environ.setdefault('TRACKIO_SPACE', space)
    try:
        import trackio
        bucket = os.environ.get('TRACKIO_BUCKET') or space + '-bucket'   # resolved once: Trackio and the JSON mirror share it
        trackio.init(project=os.environ.get('TRACKIO_PROJECT', 'dge-tagger'), name=os.environ.get('TRACKIO_RUN') or run_name,
                     space_id=space, bucket_id=bucket, private=True, config={k: v for k, v in config.items() if isinstance(v, (int, float, str, bool))},
                     resume='allow')
        _on = _started = True
        _mirror.update(bucket=bucket,
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
        _on = False; print(f'live charts off: {e}', flush=True)   # stop logging, but finish() still closes the run


def _doc(done):
    pts = _mirror['points']; steps = [p for p in pts if 'epoch' not in p]
    keep = set(map(id, steps[::max(1, -(-len(steps) // 300))]))   # at most ~300 step points, every epoch point
    return json.dumps({'run': _mirror['run'], 'started': _mirror['started'], 'updated': round(time.time()), 'done': done,
                       'points': [p for p in pts if 'epoch' in p or id(p) in keep]}).encode()


def _upload(doc):
    from huggingface_hub import HfApi
    HfApi().batch_bucket_files(_mirror['bucket'], add=[(doc, _mirror['path'])])


def _push(done=False):
    """Upload the JSON mirror in the background; a slow or failed upload never holds up training."""
    if _mirror['busy']: return
    _mirror['busy'] = True; _mirror['sent'] = time.time()
    doc = _doc(done)

    def go():
        try: _upload(doc)
        except Exception as e:  # noqa: BLE001
            print(f'chart mirror {"final " if done else ""}upload failed: {e}', flush=True)
        finally: _mirror['busy'] = False
    thread = threading.Thread(target=go, daemon=True)
    thread.start()
    return thread


def finish():
    global _on, _started
    if not _started: return
    _on = False
    for _ in range(120):   # let a running background upload end first so it cannot overwrite the final file
        if not _mirror['busy']: break
        time.sleep(1)
    if _mirror['busy']:
        print('chart mirror final upload skipped: timed out waiting for an earlier upload', flush=True)
    else:
        try:
            thread = _push(done=True)
            thread.join(120)
            if thread.is_alive():
                print('chart mirror final upload timed out; publication is not confirmed', flush=True)
        except Exception as e:  # noqa: BLE001
            print(f'chart mirror final upload failed: {e}', flush=True)
    try:
        import trackio
        trackio.finish()
    except Exception as e:  # noqa: BLE001
        print(f'live charts finish failed: {e}', flush=True)
    _started = False



def summary(run_name, config, metrics):
    """One-shot jobs with no epochs (logistic-regression heads and the like): show the run as a single finished point.
    Training-side numbers only, same rule as above."""
    start(run_name, config, auto=True)
    log({'epoch': 1, **{k: float(v) for k, v in metrics.items()}}, step=1)
    finish()
