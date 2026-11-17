"""CPU logistic head used as a local smoke test of the train/eval split rules.

This is not the sound tagger. It checks that a head can be fit and scored with
the repo's bars, and that a training id listed in a held-out set is rejected.
"""
from __future__ import annotations

import json
import sys

import numpy as np

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import bars  # noqa: E402
from plan import overlap  # noqa: E402


def fit(features: np.ndarray, labels: np.ndarray, steps: int = 400, lr: float = 0.2, l2: float = 1e-2) -> tuple[np.ndarray, float]:
    """L2 logistic regression. features is (n, d), labels is (n,) of 0/1."""
    x = np.asarray(features, np.float64)
    y = np.asarray(labels, np.float64)
    weight = np.zeros(x.shape[1])
    bias = 0.0
    for _ in range(steps):
        z = x @ weight + bias
        pred = 1 / (1 + np.exp(-np.clip(z, -30, 30)))
        error = pred - y
        weight -= lr * (x.T @ error / len(y) + l2 * weight)
        bias -= lr * float(error.mean())
    return weight, float(bias)


def probabilities(features: np.ndarray, weight: np.ndarray, bias: float) -> np.ndarray:
    z = np.asarray(features, np.float64) @ weight + bias
    return 1 / (1 + np.exp(-np.clip(z, -30, 30)))


def counts(pred: np.ndarray, labels: np.ndarray, threshold: float) -> dict:
    shown = pred >= threshold
    y = np.asarray(labels).astype(bool)
    tp = int(np.sum(shown & y))
    fp = int(np.sum(shown & ~y))
    fn = int(np.sum(~shown & y))
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': precision, 'recall': recall,
            'tier': bars.head_tier(precision, recall, 'smoke')}


def refuse_overlap(train_ids, test_ids) -> None:
    shared = overlap(set(train_ids), set(test_ids))
    if shared:
        raise SystemExit(f'training ids overlap a held-out set: {sorted(shared)[:5]}')


def main() -> None:
    spec = json.load(sys.stdin)
    refuse_overlap(spec['trainIds'], spec['testIds'])
    weight, bias = fit(np.array(spec['trainX']), np.array(spec['trainY']))
    scored = counts(probabilities(np.array(spec['testX']), weight, bias), np.array(spec['testY']), spec.get('threshold', 0.5))
    json.dump({'bias': bias, 'weights': weight.tolist(), **scored}, sys.stdout)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
