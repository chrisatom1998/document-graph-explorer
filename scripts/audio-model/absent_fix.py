"""Coverage idea #2 (train.py --absent-fix): stop teaching likely positives as negatives.

The JSON (scripts/audio-model/coverage/labelfix/build-absent-fix.py; private, cmjatom/dge-private-train coverage/v1/) holds
  {"drop": {item id: [tag, ...]}, "add": {item id: [tag, ...]}, ...}
built from out-of-fold round 11 teacher scores on train-side clips only.
- drop: a weak absence (a tag the source does not mention) that the teacher scores as likely present gets weight 0
  instead of --weak, so the clip no longer says "not <tag>".
- add: a confident missing positive becomes a present label at full weight.
Both touch only weak absences: a clip's own present labels and its outright absences (round 10's absent_tags, run 9's
look-alike absences) are never changed. Like --soft, only the training targets change; validation keeps the clip's own labels.
"""
import json

FIX = {'drop': {}, 'add': {}}


def load(path):
    d = json.load(open(path))
    FIX['drop'] = {k: set(v) for k, v in d.get('drop', {}).items()}
    FIX['add'] = {k: set(v) for k, v in d.get('add', {}).items()}
    return len(FIX['drop']), len(FIX['add'])


def edits(item_id, labels, weak_set):
    """{'cat:<tag>': (target, weight)} for one item; labels ({'cat:<tag>': value}) and weak_set are only read."""
    out = {}
    for kind, val in (('drop', (0.0, 0.0)), ('add', (1.0, 1.0))):   # add wins if a tag is listed in both
        for t in FIX[kind].get(item_id, ()):
            c = f'cat:{t}'
            if c in weak_set and labels.get(c, 0) < 0.5: out[c] = val
    return out
