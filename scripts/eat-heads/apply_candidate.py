"""Apply the candidate EAT heads + blend rules to the shipped app's decisions (offline, candidate only).

Input: shipped decisions from `scripts/eval-tag.ts --decisions <file>` and EAT embeddings of the same clips from
extract_eat.py. Output: the same JSON shape (clip id -> shown display keys) with each tag's rule applied. Tags whose
rule is `keep` (including the four with no head) pass through unchanged. With --set and --per-tag-csv it also writes
the per-tag 60/30 table and the summary for that set.

Usage: apply_candidate.py --heads candidate/eat-heads-2026-11-01.json --emb eat-judge.npz \
           --decisions shipped-decisions.json --out candidate-decisions.json \
           [--set items.json --per-tag-csv per-tag.csv --report-dir OUT]"""
import argparse, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--heads', required=True)
    ap.add_argument('--emb', required=True)
    ap.add_argument('--decisions', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--set')
    ap.add_argument('--per-tag-csv')
    ap.add_argument('--report-dir')
    a = ap.parse_args()
    spec = json.load(open(a.heads))
    dec = json.load(open(a.decisions))
    emb = C.load_emb(a.emb)
    ids = [i for i in dec if i in emb]
    missing = len(dec) - len(ids)
    X = np.array([emb[i] for i in ids])
    out = {i: list(dec[i]) for i in dec}
    for e in spec['tags']:
        op, t = e['rule']['op'], e['rule']['eat_min']
        if op == 'keep' or e['head'] is None:
            continue
        q = C.head_prob(e['head'], X)
        for i, p in zip(ids, q):
            shown = e['display_key'] in out[i]
            new = C.apply_rule((op, t), np.array([int(shown)]), np.array([p]))[0]
            if new and not shown:
                out[i].append(e['display_key'])
            elif shown and not new:
                out[i].remove(e['display_key'])
    json.dump(out, open(a.out, 'w'))
    print(f'{len(ids)} clips updated, {missing} without an embedding left as shipped -> {a.out}')
    if a.set and a.per_tag_csv:
        tags, key = C.load_tags(a.per_tag_csv)
        _, Y, S0 = C.load_set(a.set, a.decisions, tags, key)
        _, _, S1 = C.load_set(a.set, a.out, tags, key)
        rules = {e['tag']: e['rule']['op'] + (f" eat>={e['rule']['eat_min']:.3f}" if e['rule']['eat_min'] is not None
                                              else '') for e in spec['tags']}
        s = dict(shipped=C.summary(Y, S0), candidate=C.summary(Y, S1))
        print(json.dumps(s, indent=1))
        if a.report_dir:
            os.makedirs(a.report_dir, exist_ok=True)
            C.write_csv(C.per_tag_rows(Y, S1, tags, key, rules), f'{a.report_dir}/candidate-per-tag.csv')
            json.dump(s, open(f'{a.report_dir}/summary.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
