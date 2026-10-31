"""Rescore exported heads on the original uploader-held-out fingerprints, without fitting.

The immutable recorded report and baseline learned.json must be supplied separately
from the output directory, with their expected SHA256 digests. This catches an
accidental comparison against an already-shipped model or a different training run.
The input directory may contain merged shard files or shard-* subdirectories.
No audio is fetched, split is changed, threshold is selected, or model is trained.
Only report.json/report.txt are written, after all consistency checks succeed.

Example (see the evaluation's run-info.txt for the pinned inputs):
  python3 scripts/dj-effects/rescore.py ARTIFACTS EVALUATION \
    --recorded-report ORIGINAL_REPORT --recorded-report-sha256 SHA256 \
    --baseline-learned ORIGINAL_LEARNED --baseline-sha256 SHA256 \
    --heads-sha256 SHA256 --labels scripts/dj-effects/labels-tags.json
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

import numpy as np


METRICS = ('tp', 'fp', 'fn', 'precision', 'recall')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'{path}: duplicate JSON key {key}')
            result[key] = value
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=unique_object)


def pinned(path, expected, name):
    actual = digest(path)
    require(actual == expected, f'{name} SHA256 mismatch: expected {expected}, got {actual}')
    return load(path)


def heads_by_label(model, name):
    result = {}
    for head in model['heads']:
        label = head['label']
        require(label not in result, f'{name}: duplicate head {label}')
        weights = np.asarray(head['weights'], dtype=np.float64)
        require(weights.shape == (512,) and np.isfinite(weights).all(),
                f'{name}/{label}: invalid weights')
        require(math.isfinite(head['bias']) and .5 <= head['threshold'] < 1,
                f'{name}/{label}: invalid bias or threshold')
        result[label] = head
    return result


def finite_positive(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0)


def metrics(truth, predicted):
    tp = int((truth & predicted).sum())
    fp = int((~truth & predicted).sum())
    fn = int((truth & ~predicted).sum())
    return {'tp': tp, 'fp': fp, 'fn': fn,
            'precision': tp / (tp + fp) if tp + fp else 0.0,
            'recall': tp / (tp + fn) if tp + fn else 0.0}


def score(head, x, positive, rows):
    # train.py and learnedDjModel.ts both score a unit-normalised CLAP vector.
    z = x[rows] @ np.asarray(head['weights'], dtype=np.float64) + head['bias']
    probability = np.empty_like(z)
    nonnegative = z >= 0
    probability[nonnegative] = 1 / (1 + np.exp(-z[nonnegative]))
    exp_z = np.exp(z[~nonnegative])
    probability[~nonnegative] = exp_z / (1 + exp_z)
    return metrics(positive[rows], probability >= head['threshold'])


def same_metrics(actual, expected, description):
    for key in METRICS:
        require(key in expected and actual[key] == expected[key],
                f'{description}: {key} differs ({actual[key]} != {expected.get(key)})')


def validate_counts(row, positives, negatives, description):
    for key in ('tp', 'fp', 'fn'):
        require(type(row.get(key)) is int and row[key] >= 0,
                f'{description}: invalid {key}')
    require(row['tp'] + row['fn'] == positives and row['fp'] <= negatives,
            f'{description}: inconsistent confusion counts')
    expected = dict(row)
    tp, fp, fn = (row[k] for k in ('tp', 'fp', 'fn'))
    expected.update(precision=tp / (tp + fp) if tp + fp else 0.0,
                    recall=tp / (tp + fn) if tp + fn else 0.0)
    same_metrics(expected, row, description)


def render_report(report):
    provenance = report['rescoring']
    lines = [
        'Exported-head rescore; original splits, overlap exclusions, and thresholds unchanged.',
        'Aggregate and one-shot scores use the exact six-decimal exported weights and bias.',
        'Aggregate 70/70 is descriptive; ship.py selects shipping tiers from heldOutLongClip.',
        'Long-route scores use only explicit finite positive durations > 2.25 s.',
        f"Held-out: {report['heldOutClips']}; short: {provenance['heldOutShortClips']}; "
        f"long: {provenance['heldOutLongClips']}; unknown durations: {provenance['heldOutUnknownDurations']}.",
        f"Rounded versus recorded unrounded differences: {len(provenance['roundingDifferences'])}.",
        '',
        f"{'label':<16} {'all P/R':>13} {'long +/-':>13} {'long TP/FP/FN':>16} {'long P/R':>13}  current learned long P/R",
    ]
    for label, entry in report['labels'].items():
        current = next((c.get('heldOutLongClip') for c in entry.get('current', [])
                        if c['file'] == 'learned.json'), None)
        cur = f"{current['precision']:.4f}/{current['recall']:.4f}" if current else '-'
        route = entry.get('heldOutLongClip')
        if not route:
            lines.append(f"{label:<16} {'-':>13} {'-':>13} {'-':>16} {'-':>13}  {cur} ({entry['verdict']})")
            continue
        overall = f"{entry['precision']:.4f}/{entry['recall']:.4f}"
        counts = f"{route['positives']}/{route['negatives']}"
        confusion = f"{route['tp']}/{route['fp']}/{route['fn']}"
        pr = f"{route['precision']:.4f}/{route['recall']:.4f}"
        lines.append(f'{label:<16} {overall:>13} {counts:>13} {confusion:>16} {pr:>13}  {cur}')
    for difference in provenance['roundingDifferences']:
        lines.extend(['', f"Rounding difference: {difference['label']} / {difference['subset']}",
                      '  Recorded unrounded: ' + json.dumps(difference['recordedUnrounded'], sort_keys=True),
                      '  Exported rounded: ' + json.dumps(difference['exportedRounded'], sort_keys=True)])
    return '\n'.join(lines) + '\n'


def rescore(args):
    evaluation = Path(args.evaluation)
    recorded = pinned(args.recorded_report, args.recorded_report_sha256, 'recorded report')
    require('rescoring' not in recorded, 'recorded report must be the original training report')
    baseline = heads_by_label(pinned(args.baseline_learned, args.baseline_sha256,
                                    'baseline learned.json'), 'baseline learned.json')
    exported = heads_by_label(pinned(evaluation / 'heads.json', args.heads_sha256,
                                    'exported heads.json'), 'exported heads.json')
    short_model = load(args.short_clip)
    short_heads = heads_by_label(short_model, 'short-clip.json')
    require(short_model['blocks'] == ['clapRepeat'] and short_model['maxSeconds'] == 2.25,
            'short-clip.json must use clapRepeat with maxSeconds=2.25')
    mean, std = (np.asarray(short_model[key], dtype=np.float64) for key in ('mean', 'std'))
    require(mean.shape == std.shape == (512,) and np.isfinite(mean).all()
            and np.isfinite(std).all() and (std > 0).all(), 'invalid short-clip standardisation')
    spec = load(args.labels)
    require([entry['label'] for entry in spec['labels']] == list(recorded['labels']),
            'label specification/order differs from the original report')
    groups = {entry['label']: entry['group'] for entry in spec['labels']}
    overlaps = [set(group) for group in spec['overlap']]
    root = Path(args.artifacts)
    source_files = {}

    def sources(pattern):
        files = sorted(root.rglob(pattern), key=lambda path: path.name)
        require(files, f'no input files match {pattern}')
        require(len({p.name for p in files}) == len(files), f'ambiguous merged/sharded {pattern}')
        for path in files:
            source_files[str(path.relative_to(root))] = digest(path)
        return files

    manifests, render_manifests, durations_files = (sources(pattern) for pattern in
                                                    ('manifest-*.json', 'renders-*.json', 'durations-*.json'))
    suffixes = lambda paths: {p.stem.split('-', 1)[1] for p in paths}
    require(suffixes(manifests) == suffixes(render_manifests) == suffixes(durations_files),
            'manifest/render/duration shard sets differ')
    meta = {}
    for path in [*manifests, *render_manifests]:
        for clip in load(path)['clips']:
            identifier = clip['id']
            require(identifier not in meta, f'duplicate metadata for {identifier}')
            require(clip['split'] in ('train', 'heldout') and isinstance(clip['group'], str)
                    and isinstance(clip['labels'], list), f'invalid metadata for {identifier}')
            require(clip.get('kind') != 'render' or clip['split'] == 'train',
                    f'held-out render {identifier}')
            meta[identifier] = clip
    duration = {}
    for path in durations_files:
        for identifier, seconds in load(path).items():
            require(identifier in meta and meta[identifier].get('kind') != 'render',
                    f'duration without real-clip metadata: {identifier}')
            require(identifier not in duration, f'duplicate duration for {identifier}')
            duration[identifier] = seconds
    identifiers, vectors, seen = [], [], {}
    for path in sources('emb-*.jsonl'):
        for line_number, line in enumerate(path.read_text().splitlines(), 1):
            require(line.strip(), f'{path.name}:{line_number}: blank embedding row')
            row = json.loads(line)
            identifier, vector = row['id'], row['embedding']
            require(identifier in meta, f'embedding without metadata: {identifier}')
            array = np.asarray(vector, dtype=np.float64)
            require(array.shape == (512,) and np.isfinite(array).all()
                    and np.linalg.norm(array) > 0, f'invalid fingerprint: {identifier}')
            if identifier in seen:
                require(vector == seen[identifier], f'conflicting fingerprints: {identifier}')
                continue  # train.py uses the first row in flattened filename order.
            seen[identifier] = vector
            identifiers.append(identifier)
            vectors.append(vector)
    require(identifiers, 'no fingerprints')
    x = np.asarray(vectors, dtype=np.float64)
    x /= np.linalg.norm(x, axis=1, keepdims=True)
    short_x = (x - mean) / std
    label_sets = [set(meta[i]['labels']) for i in identifiers]
    uploader = np.array([meta[i]['group'] for i in identifiers])
    heldout = np.array([meta[i]['split'] == 'heldout' for i in identifiers])
    render = np.array([meta[i].get('kind') == 'render' for i in identifiers])
    primary = np.array([meta[i].get('round', 1) <= args.primary_round for i in identifiers])
    require(not set(uploader[heldout]) & set(uploader[~heldout]), 'uploader crosses train/heldout split')
    known = np.array([finite_positive(duration.get(i)) for i in identifiers])
    short = np.array([known[index] and duration[i] <= 2.25 for index, i in enumerate(identifiers)])
    long = known & ~short
    for field, actual in {'clips': len(identifiers), 'trainClips': int((~heldout).sum()),
                          'heldOutClips': int(heldout.sum()),
                          'primaryHeldOutClips': int((heldout & primary).sum()),
                          'heldOutUploaders': len(set(uploader[heldout]))}.items():
        require(recorded[field] == actual, f'{field} differs from the original report')
    clips_path = evaluation / 'clips.json'
    listed = load(clips_path)['clips']
    real_ids = {i for i in identifiers if meta[i].get('kind') != 'render'}
    require(len({c['id'] for c in listed}) == len(listed)
            and {c['id'] for c in listed} == real_ids, 'clips.json and embedded real-clip IDs differ')
    for clip in listed:
        original = meta[clip['id']]
        for key in ('split', 'round', 'labels', 'kind', 'username'):
            require(clip.get(key) == original.get(key), f"clips.json metadata differs: {clip['id']}/{key}")
    report = copy.deepcopy(recorded)
    rounding_differences = []
    compared = 0
    current_compared = 0

    def compare_export(label, subset, actual, original):
        nonlocal compared
        compared += 1
        if any(actual[key] != original.get(key) for key in METRICS):
            rounding_differences.append({'label': label, 'subset': subset,
                                         'recordedUnrounded': {k: original[k] for k in METRICS},
                                         'exportedRounded': actual})

    for label, entry in report['labels'].items():
        positive = np.array([label in labels for labels in label_sets])
        use = positive | np.array([not any(label == other or any(label in group and other in group
                                                                for group in overlaps)
                                           for other in labels) for labels in label_sets])
        train = use & ~heldout
        real_train = train & ~render
        test = use & heldout & primary
        extended = use & heldout
        counts = {'trainPositive': int(positive[real_train].sum()),
                  'trainNegative': int((~positive[real_train]).sum()),
                  'trainRenders': int((positive & train & render).sum()),
                  'testPositive': int(positive[test].sum()), 'testNegative': int((~positive[test]).sum()),
                  'trainUploaders': len(set(uploader[real_train & positive])),
                  'testUploaders': len(set(uploader[test & positive]))}
        require(entry['group'] == groups[label], f'{label}: label group differs')
        for key, value in counts.items():
            require(entry[key] == value, f'{label}: {key} differs from the original report')

        def route(head, rows):
            eligible = rows & long
            return {'positives': int(positive[eligible].sum()),
                    'negatives': int((~positive[eligible]).sum()),
                    # Unknown is counted in the eligible label/split population, never as long.
                    'unknownDurations': int((rows & ~known).sum()),
                    **score(head, x, positive, eligible), 'maxSeconds': 2.25,
                    'subset': 'held-out clips > 2.25 s'}

        current = entry.get('current', [])
        require(sum(c['file'] == 'learned.json' for c in current) == int(label in baseline),
                f'{label}: missing/duplicate baseline comparison')
        for old in current:
            is_short = old['file'] == 'short-clip.json'
            require(is_short or old['file'] == 'learned.json', f'{label}: unknown current-head file')
            heads = short_heads if is_short else baseline
            require(label in heads, f'{label}: comparison has no baseline head')
            head = heads[label]
            require(old['threshold'] == head['threshold'] and old['maybe'] == bool(head.get('maybe')),
                    f'{label}: baseline head properties differ')
            rows = test & short if is_short else test
            validate_counts(old, int(positive[rows].sum()), int((~positive[rows]).sum()),
                            f'{label}/current/{old["file"]}')
            same_metrics(score(head, short_x if is_short else x, positive, rows), old,
                         f'{label}/current/{old["file"]}')
            current_compared += 1
            if not is_short:
                old['heldOutLongClip'] = route(head, test)
                if (extended != test).any():
                    ext_current = entry.get('extended', {}).get('current')
                    require(ext_current is not None, f'{label}: missing extended current score')
                    same_metrics(score(head, x, positive, extended), ext_current, f'{label}/extended/current')
                    ext_current['heldOutLongClip'] = route(head, extended)
        if 'precision' not in entry:
            require(label not in exported, f'{label}: exported head was not tested')
            continue
        require(label in exported, f'{label}: tested head missing from heads.json')
        head = exported[label]
        require(head['threshold'] == entry['threshold'] and head['group'] == entry['group'],
                f'{label}: exported head threshold/group differs from report')
        validate_counts(entry, counts['testPositive'], counts['testNegative'], f'{label}/aggregate')
        aggregate = score(head, x, positive, test)
        compare_export(label, 'all primary held-out clips', aggregate, entry)
        entry.update(aggregate)
        p, r = aggregate['precision'], aggregate['recall']
        entry.update(f1=2 * p * r / (p + r) if p + r else 0.0,
                     passes70=min(p, r) >= .7, verdict='PASS 70/70' if min(p, r) >= .7 else 'below 70/70')
        rows = test & short
        old_short = entry.get('heldOutOneShot')
        require(old_short is not None, f'{label}: recorded one-shot score missing')
        positives, negatives = int(positive[rows].sum()), int((~positive[rows]).sum())
        require(old_short['positives'] == positives and old_short['negatives'] == negatives,
                f'{label}: one-shot population differs from the original report')
        short_score = score(head, x, positive, rows)
        if rows.any():
            validate_counts(old_short, positives, negatives, f'{label}/one-shot')
            compare_export(label, 'held-out clips <= 2.25 s', short_score, old_short)
        entry['heldOutOneShot'] = {'positives': positives, 'negatives': negatives, **short_score}
        entry['heldOutLongClip'] = route(head, test)
        if (extended != test).any():
            old_extended = entry.get('extended', {}).get('new')
            require(old_extended is not None, f'{label}: recorded extended score missing')
            extended_score = score(head, x, positive, extended)
            require(old_extended['positives'] == int(positive[extended].sum())
                    and old_extended['negatives'] == int((~positive[extended]).sum()),
                    f'{label}: extended population differs')
            validate_counts(old_extended, old_extended['positives'], old_extended['negatives'],
                            f'{label}/extended/new')
            compare_export(label, 'all extended held-out clips', extended_score, old_extended)
            old_extended.update(extended_score)
            old_extended['heldOutLongClip'] = route(head, extended)
    require(set(exported) == {label for label, row in report['labels'].items() if 'precision' in row},
            'exported/tested label sets differ')
    report['rescoring'] = {
        'kind': 'exported-head-route-rescore-v1', 'model': 'heads.json (exported rounded weights and bias)',
        'recordedReportSha256': args.recorded_report_sha256, 'headsSha256': args.heads_sha256,
        'baselineLearnedSha256': args.baseline_sha256, 'shortClipSha256': digest(args.short_clip),
        'labelsSha256': digest(args.labels), 'clipsSha256': digest(clips_path),
        'primaryRound': args.primary_round, 'maxSeconds': 2.25,
        'heldOutShortClips': int((heldout & short).sum()),
        'heldOutLongClips': int((heldout & long).sum()),
        'heldOutUnknownDurations': int((heldout & ~known).sum()),
        'recordedUnroundedComparisons': compared, 'verifiedCurrentComparisons': current_compared,
        'roundingDifferences': rounding_differences, 'sourceFileSha256': source_files,
        'note': 'No retraining, threshold selection, or split changes. Recorded unrounded confusion counts '
                'are compared with exported-head counts; any differences are preserved above. '
                'Full-precision coefficients were not exported, so unrounded predictions are not reconstructed.'}
    # All validation precedes writes; no runtime model or shipping output is touched here.
    (evaluation / 'report.json').write_text(json.dumps(report, indent=1) + '\n')
    (evaluation / 'report.txt').write_text(render_report(report))
    print(f"Verified {compared} exported/recorded comparisons and {current_compared} baseline comparisons; "
          f"{len(rounding_differences)} rounding differences.")
    print(f"Wrote {evaluation / 'report.json'} and {evaluation / 'report.txt'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifacts')
    parser.add_argument('evaluation')
    parser.add_argument('--recorded-report', required=True)
    parser.add_argument('--recorded-report-sha256', required=True)
    parser.add_argument('--baseline-learned', required=True)
    parser.add_argument('--baseline-sha256', required=True)
    parser.add_argument('--heads-sha256', required=True)
    parser.add_argument('--labels', default=str(Path(__file__).with_name('labels.json')))
    parser.add_argument('--short-clip', default='public/sound-model/short-clip.json')
    parser.add_argument('--primary-round', type=int, default=10**6)
    args = parser.parse_args()
    try:
        rescore(args)
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(1, f'rescore failed: {error}\n')


if __name__ == '__main__':
    main()
