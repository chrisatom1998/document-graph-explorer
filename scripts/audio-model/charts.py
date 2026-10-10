"""Optional live training charts (Trackio) for HF training jobs.

Off unless TRACKIO_SPACE is set (e.g. cmjatom/dge-training-charts). Then every logged number is synced to that Hugging
Face Space, which is created PRIVATE if it does not exist yet. TRACKIO_PROJECT names the chart group (default dge-tagger)
and TRACKIO_RUN the run (default: the run folder's name).

Only training curves and aggregate scores go here: loss, learning rate, seconds per epoch and validation mAP (overall and
per training source). Never log per-clip or per-tag held-out results: the Space must hold nothing a judge set could leak.
Any Trackio failure is printed and ignored, so charts can never stop a training run.
"""
import os

_on = False


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
        print(f'live charts: https://huggingface.co/spaces/{space}', flush=True)
    except Exception as e:  # noqa: BLE001
        print(f'live charts off: {e}', flush=True)


def log(metrics, step=None):
    global _on
    if not _on: return
    try:
        import trackio
        trackio.log({k: float(v) for k, v in metrics.items()}, step=step)
    except Exception as e:  # noqa: BLE001
        _on = False; print(f'live charts off: {e}', flush=True)


def finish():
    if not _on: return
    try:
        import trackio
        trackio.finish()
    except Exception as e:  # noqa: BLE001
        print(f'live charts finish failed: {e}', flush=True)
