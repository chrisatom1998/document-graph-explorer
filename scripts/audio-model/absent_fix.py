"""Coverage idea #2 (train.py --absent-fix): stop teaching likely positives as negatives.

The JSON (scripts/audio-model/coverage/labelfix/build-absent-fix.py; private, cmjatom/dge-private-train coverage/v1/) holds
  {"drop": {item id: [tag, ...]}, "add": {item id: [tag, ...]}, ...}
built from out-of-fold round 11 teacher scores on train-side clips only.
- drop: a weak absence (a tag the source does not mention) that the teacher scores as likely present gets weight 0
  instead of --weak, so the clip no longer says "not <tag>".
- add: a confident missing positive becomes a present label at full weight.
- absent: a sure absence from the source's own rules (coverage effect pairs' dry copies, synth presets' safe negatives;
  coverage/merge-absent.py) becomes a full-weight negative, also where the source never scored the tag. It wins over drop and
  add for the same tag.
Both touch only weak absences: a clip's own present labels and its outright absences (round 10's absent_tags, run 9's
look-alike absences) are never changed. Like --soft, only the training targets change; validation keeps the clip's own labels.

Label cleanup (relabel(), reports/label-cleanup-2026-10-11): a positive that came from a word with a second meaning (a subway
"ride", a glass "break", a voice going "ohh") or from a synthetic NSynth patch named after a real instrument is not that sound.
- wrong: {item id: [tag]} the clip's own present tag becomes an outright absence.
- unsure: {item id: [tag]} the clip's own present tag becomes unknown (no target, no weight).
- relabel_rules: [{"id": regex, "wrong": [tag], "unsure": [tag], "absent": [tag]}] the same, for every item id the regex
  matches; "absent" also makes a tag the clip does not have an outright absence (a hard negative, e.g. "not a kick" on low
  synth bass notes).
Unlike the kinds above these change the clip's own labels, before merges and aliases, so validation and calibration see them too.
"""
import json
import re

FIX = {'drop': {}, 'add': {}, 'absent': {}, 'wrong': {}, 'unsure': {}, 'rules': []}


def load(path):
    d = json.load(open(path))
    FIX['drop'] = {k: set(v) for k, v in d.get('drop', {}).items()}
    FIX['add'] = {k: set(v) for k, v in d.get('add', {}).items()}
    FIX['absent'] = {k: set(v) for k, v in d.get('absent', {}).items()}
    FIX['wrong'] = {k: set(v) for k, v in d.get('wrong', {}).items()}
    FIX['unsure'] = {k: set(v) for k, v in d.get('unsure', {}).items()}
    FIX['rules'] = [(re.compile(r['id']), set(r.get('wrong', [])), set(r.get('unsure', [])), set(r.get('absent', [])))
                    for r in d.get('relabel_rules', [])]
    return len(FIX['drop']), len(FIX['add'])


def relabel(item_id, labels, weak_set):
    """Label cleanup: turn the clip's own wrong-sense positives into absences (wrong) or unknowns (unsure), and fill a rule's
    hard negatives (absent) where the clip does not have the tag. Edits labels and weak_set in place and returns how many
    labels changed; an unknown wins over an absence for the same tag."""
    wrong, unsure, absent = set(FIX['wrong'].get(item_id, ())), set(FIX['unsure'].get(item_id, ())), set()
    for rx, w, u, a in FIX['rules']:
        if rx.search(item_id): wrong |= w; unsure |= u; absent |= a
    n = 0
    for t in wrong | unsure | absent:
        c = f'cat:{t}'
        if labels.get(c, 0) >= 0.5:
            if t in unsure: labels.pop(c)
            elif t in wrong: labels[c] = 0.0
            else: continue   # a hard negative never overrides the clip's own positive
        elif t in absent and t not in unsure and (c not in labels or c in weak_set): labels[c] = 0.0
        else: continue
        weak_set.discard(c); n += 1
    return n


def edits(item_id, labels, weak_set):
    """{'cat:<tag>': (target, weight)} for one item; labels ({'cat:<tag>': value}) and weak_set are only read."""
    out = {}
    for kind, val in (('drop', (0.0, 0.0)), ('add', (1.0, 1.0)), ('absent', (0.0, 1.0))):   # later kinds win: absent > add > drop
        for t in FIX[kind].get(item_id, ()):
            c = f'cat:{t}'
            # drop/add touch weak absences only; a sure absence also fills a tag the source never scored
            if labels.get(c, 0) < 0.5 and (c in weak_set or (kind == 'absent' and c not in labels)): out[c] = val
    return out
