"""Score learned heads only where the browser enables them, outside whole one-shots."""
import math


def known_duration(duration):
    return (not isinstance(duration, bool) and isinstance(duration, (int, float))
            and math.isfinite(duration) and duration > 0)


def long_clip_metrics(truth, predicted, durations, max_seconds):
    if not (len(truth) == len(predicted) == len(durations)):
        raise ValueError('duration scoring inputs have different lengths')
    tp = fp = fn = positives = negatives = unknown = 0
    for positive, prediction, duration in zip(truth, predicted, durations):
        if not known_duration(duration):
            unknown += 1
            continue
        if duration <= max_seconds:
            continue
        positives += int(positive)
        negatives += int(not positive)
        tp += int(positive and prediction)
        fp += int(not positive and prediction)
        fn += int(positive and not prediction)
    return {'subset': f'held-out clips > {max_seconds} s', 'maxSeconds': max_seconds,
            'positives': positives, 'negatives': negatives, 'unknownDurations': unknown,
            'tp': tp, 'fp': fp, 'fn': fn,
            'precision': tp / (tp + fp) if tp + fp else 0.0,
            'recall': tp / (tp + fn) if tp + fn else 0.0}


def eligible_metrics(row, max_seconds, min_positives=10):
    """Fail closed unless a report proves the runtime's long-clip shipping route."""
    metrics = row.get('heldOutLongClip')
    if not isinstance(metrics, dict):
        return None, 'runtime-eligible long clips were not scored'
    if metrics.get('maxSeconds') != max_seconds:
        return None, 'long-clip boundary differs from the runtime model'
    counts = [metrics.get(k) for k in ('tp', 'fp', 'fn', 'positives', 'negatives', 'unknownDurations')]
    if any(type(v) is not int or v < 0 for v in counts):
        return None, 'invalid runtime-eligible confusion counts'
    tp, fp, fn, positives, negatives, unknown = counts
    if unknown:
        return None, 'held-out clip durations are missing or invalid'
    if tp + fn != positives or fp > negatives:
        return None, 'inconsistent runtime-eligible confusion counts'
    if positives < min_positives:
        return None, f'fewer than {min_positives} runtime-eligible held-out positives'
    return {**metrics, 'precision': tp / (tp + fp) if tp + fp else 0.0,
            'recall': tp / positives if positives else 0.0}, None
