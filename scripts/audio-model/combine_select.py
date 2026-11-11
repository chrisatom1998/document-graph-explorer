"""Which run each app tag comes from when combine.py builds the browser model. Chosen on VALIDATION clips only.

Every run's thresholds.json (calibrate.py) carries, per output, the precision and recall at its cutoff on each training
source's validation clips (`<source>Val`: about 10% of artists / uploaders / instruments that train.py held out). The
runs share those validation clips, so they can be compared on them. The held-out test sets (eval.json from evaluate.py:
FSD50K eval, NSynth test, the DJ clip rounds, held-out Freesound uploaders) are NOT read here: they are the same corpora
the scoreboard judges, so picking on them makes the board's numbers optimistic. combine.py scores the finished model on
them once, after every choice is made, and picks.json keeps those numbers for the record only.

Rule per tag (unchanged apart from the clips it reads): a later run takes a tag from the shipped (first) run when its
mean min(precision, recall) over the validation sources both runs score (10+ positives and 10+ negatives each) is at
least MARGIN higher, and it does not fall below FLOOR precision or recall on a validation source where the shipped run
reached both. Among the runs that clear that, the largest gain wins (ties: the earlier run). Gains are compared, not raw
means, because a newer run may score more sources than an older one.
"""
import numpy as np

MIN_POS = MIN_NEG = 10
MARGIN = 0.01
FLOOR = 0.70


def val_rows(th_row):
    """{source: (precision, recall)} from one output's thresholds.json row: each validation source with enough clips."""
    if not th_row or not th_row.get('enabled'):
        return {}
    out = {}
    for k, v in th_row.items():
        # calibrate.py writes precision null when the cutoff flags no clip: that source scores 0, it is not left out.
        if k.endswith('Val') and isinstance(v, dict) and v.get('recall') is not None \
                and v.get('positives', 0) >= MIN_POS and v.get('negatives', 0) >= MIN_NEG:
            out[k[:-3]] = (float(v['precision'] or 0.0), float(v['recall']))
    return out


def merit(rows):
    return float(np.mean([min(p, r) for p, r in rows.values()])) if rows else None


def choose(tags, runs, keep=(), only=None, pin=None):
    """runs: [{'name', 'th' (thresholds.json)}], the shipped run first. Returns {tag: {'run', 'why', 'val'}}.

    `only` ({run: {tags}}) limits which tags a run may take; `pin` ({tag: run}) forces a run. Both are hand choices:
    combine.py accepts them only with --allow-hand-picks, and they must never come from test-set results."""
    only = only or {}; pin = pin or {}; picks = {}
    for tag in tags:
        val = {run['name']: {n: [round(p, 3), round(r, 3)] for n, (p, r) in val_rows(run['th'].get(tag)).items()} for run in runs}
        if tag in pin:
            picks[tag] = {'run': pin[tag], 'why': 'pinned by hand', 'val': val}
            continue
        # The baseline is the shipped run, or for an output only newer runs have, the first run that has it.
        allowed = lambda run: run['name'] not in only or tag in only[run['name']]
        if tag in runs[0]['th']:
            b0 = 0
        else:
            b0 = next((k for k, run in enumerate(runs) if tag in run['th'] and allowed(run)), None)
            assert b0 is not None, f'{tag}: no run allowed by --only has this output'
        base = val_rows(runs[b0]['th'].get(tag)); best, why = b0, 'shipped run' if b0 == 0 else 'first run with this output'
        if tag in keep:
            why = 'kept (long-recording threshold tuned on the shipped run)'
        elif not base:
            why = f'{why} (no validation source with 10+ positives and negatives)'
        else:
            passed = {n for n, (p, r) in base.items() if p >= FLOOR and r >= FLOOR}
            top = None
            for k, run in enumerate(runs[b0 + 1:], b0 + 1):
                if not allowed(run):
                    continue
                rs = val_rows(run['th'].get(tag)); common = set(rs) & set(base)
                if not common:
                    continue
                if any(n in passed and (rs[n][0] < FLOOR or rs[n][1] < FLOOR) for n in common):
                    continue
                b, m = merit({n: base[n] for n in common}), merit({n: rs[n] for n in common})
                if m - b >= MARGIN and (top is None or m - b > top):
                    best, top, why = k, m - b, f'validation mean min(P, R) {b:.3f} -> {m:.3f} over {", ".join(sorted(common))}'
        picks[tag] = {'run': runs[best]['name'], 'why': why, 'val': val}
    return picks
