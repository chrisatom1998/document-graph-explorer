"""What counts as "drums" for the tagger (Chris's decision, 2026-10-31): any drum sound, including a single kick, snare,
hi-hat or cymbal one-shot, not only a full kit.

The prepared sets still carry the old kit-only meaning (labelmap.FSD50K maps only 'Drum_kit' to drums, some sources mark
a lone snare or clap stem as drums-absent). This rule is applied when items are loaded (train.py, evaluate.py,
calibrate.py, coverage.py) rather than in labelmap.py or labels_extra.py, because those files are part of the prep-cache
keys in hf-job.sh / prep-cache.py and editing them would re-run the ~3 h cached prep of every source.
No prepare*.py script may import this module (test_drum_sounds.py checks it), for the same reason.

The rule only ever adds "present": a clip with any drum sound present counts drums present at full weight, beating an
old drums-absent. A clip with no drum sound present keeps whatever drums label it had.
"""
# App tags that are a drum sound. Not here: clap, finger snap, 808 bass, shaker, cowbell, woodblock, steel drum, the broad
# 'percussion' / 'hand percussion' / 'percussion hit' tags (they also cover non-drum sounds) and 'reverse cymbal' (an effect).
DRUM_SOUNDS = (
    'kick', 'snare', 'snare roll', 'rimshot', 'tom', 'hi-hat', 'closed hi-hat', 'open hi-hat', 'hi-hat loop',
    'cymbal', 'crash cymbal', 'ride cymbal', 'drum fill', 'drum loop', 'breakbeat',
    'tabla', 'conga', 'bongo', 'djembe', 'cajon',
)
# FSD50K classes that are a drum sound (vocabulary.csv); 'Percussion' is broader and left out.
FSD50K_DRUM_CLASSES = ('Drum', 'Drum_kit', 'Bass_drum', 'Snare_drum', 'Hi-hat', 'Cymbal', 'Crash_cymbal', 'Tabla')


def _present(v):
    return v == 'present' if isinstance(v, str) else v is not None and float(v) >= 0.5


def apply(labels, weak_set=None):
    """Marks cat:drums present in a labels dict (in place) when any drum sound is present. Writes 'present' when the
    dict uses strings (eval sets), else 1.0. Removes cat:drums from weak_set so it trains at full weight.
    Returns True when it changed the label."""
    if not any(_present(labels.get(f'cat:{t}')) for t in DRUM_SOUNDS): return False
    old = labels.get('cat:drums')
    if _present(old): return False
    strings = isinstance(old, str) or any(isinstance(v, str) for v in labels.values())
    labels['cat:drums'] = 'present' if strings else 1.0
    if weak_set is not None: weak_set.discard('cat:drums')
    return True


def apply_items(items):
    """apply() over items ({'labels': {...}, 'weakAbsent': [...]}) in place; returns how many changed."""
    n = 0
    for it in items:
        weak = set(it.get('weakAbsent', []))
        if apply(it['labels'], weak):
            n += 1
            if 'weakAbsent' in it: it['weakAbsent'] = [c for c in it['weakAbsent'] if c in weak]
    return n
