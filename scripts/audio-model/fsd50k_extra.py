"""FSD50K human labels for app tags the cached FSD50K prep does not label (2026-10-10 label fix).

prepare-fsd50k.py labels a clip only for the tags labelmap.FSD50K maps. FSD50K also names these sounds, so they were
either ignored (hand percussion, shaker and foley hit were taught by Freesound uploader words alone) or taught wrongly
(a splashing-water clip was a strong "absent" for water ambience). The mapping follows each class's meaning in the
AudioSet ontology and the catalog description; it was fixed before any score with it existed.

It is applied when items are loaded (train.py, evaluate.py) rather than in labelmap.py, because labelmap.py is part
of the prep-cache key in hf-job.sh and editing it would force a full re-prep of every source.
A tag a clip may hold without FSD50K naming it (a conga is only "Drum" there) is left unlabelled, not absent.
"""
import csv, os, time

REPO, REV = 'Fhrozen/FSD50k', os.environ.get('FSD50K_REV', 'main')
# FSD50K class -> app tags it shows.
EXTRA = {
    'Tabla': ['hand percussion'], 'Tambourine': ['hand percussion'], 'Rattle_(instrument)': ['hand percussion', 'shaker'],
    'Thump_and_thud': ['foley hit'], 'Knock': ['foley hit'], 'Slam': ['foley hit'], 'Chink_and_clink': ['foley hit'],
    'Splash_and_splatter': ['water ambience'],
}
# Tags that are new to FSD50K here: a clip with none of their classes is absent only when it also has none of these
# broader classes, which can hide the sound (FSD50K has no conga, bongo, djembe, cajon or shaker class).
UNKNOWN_IF = {
    'hand percussion': {'Drum', 'Percussion', 'Musical_instrument', 'Music'},
    'shaker': {'Percussion', 'Musical_instrument', 'Music'},
    'foley hit': {'Domestic_sounds_and_home_sounds', 'Tools', 'Mechanisms', 'Wood', 'Glass', 'Door', 'Cupboard_open_or_close',
                  'Drawer_open_or_close', 'Dishes_and_pots_and_pans', 'Cutlery_and_silverware', 'Hammer', 'Coin_(dropping)', 'Crack'},
}

def fsd50k_classes(split):
    """{fname: set of FSD50K classes} for 'dev' or 'eval', from FSD50K's own label file."""
    from huggingface_hub import hf_hub_download
    for attempt in range(8):   # the Hub rate-limits file resolves (HTTP 429)
        try: path = hf_hub_download(REPO, f'labels/{split}.csv', repo_type='dataset', revision=REV); break
        except Exception as e:
            if attempt == 7: raise
            print(f'FSD50K labels/{split}.csv: {type(e).__name__}, retry {attempt + 1}', flush=True); time.sleep(min(300, 15 * 2 ** attempt))
    return {r['fname']: set(r['labels'].split(',')) for r in csv.DictReader(open(path))}

def labels_for(classes):
    """{cat:<tag>: True | False} for the tags above; a tag is missing when it is unknown for this clip."""
    present = {t for c in classes for t in EXTRA.get(c, [])}
    out = {}
    for tag in sorted({t for v in EXTRA.values() for t in v}):
        if tag in present: out[f'cat:{tag}'] = True
        elif not classes & UNKNOWN_IF.get(tag, set()): out[f'cat:{tag}'] = False
    return out

def relabel(items, split, strings=False, classes=None):
    """Adds the labels above to prepared FSD50K items in place (ids 'fsd50k:<fname>'). Present beats an existing absent;
    an existing present is never removed. strings=True writes 'present'/'absent' (eval sets), else 1.0/0.0 (training)."""
    classes = classes if classes is not None else fsd50k_classes(split)
    changed = 0
    for it in items:
        cls = classes.get(it['id'].split(':', 1)[1])
        if cls is None: continue
        for k, v in labels_for(cls).items():
            old = it['labels'].get(k)
            if old in (1.0, 'present') or (old is not None and not v): continue
            it['labels'][k] = ('present' if v else 'absent') if strings else float(v)
            changed += old != it['labels'][k]
    return changed
