"""Turns a producer's sample library into weakly labelled training clips using folder and
file names. The vendor folder and words that only name a pack are ignored, so a pack called
"Glitch With Friends" does not label every file in it a glitch. Every clip records its vendor,
which becomes the split key: a model is tested only on brands it never trained on.
Usage: label-sample-library.py <files.txt> <library root> <out manifest.json> [cap per label]"""
import re, json, sys, collections, random
cat = json.load(open('src/audio/djCatalog.json'))['categories']
extra = {'riser':['uplifter','upsweep','build up fx','buildup fx'],'downlifter':['downsweep','down lifter','downer'],
 'impact':['impacts','hit fx'],'whoosh':['woosh','swoosh','whooshes'],'noise sweep':['sweep','sweeps','white noise'],
 'sub drop':['subdrop','sub drops'],'808 bass':['808','808s'],'reese bass':['reese'],'wobble bass':['wobble','wub','wubs'],
 'bass growl':['growl','growls'],'vocal chops':['vox chop','vocal chop','chops'],'synth pluck':['pluck','plucks'],
 'synth lead':['lead','leads'],'atmospheric pad':['pad','pads','atmos'],'synth stab':['stab','stabs'],
 'synth arpeggio':['arp','arps'],'kick':['kicks','kick drum'],'snare':['snares'],'clap':['claps'],
 'closed hi-hat':['closed hat','closed hats','chh','hihat closed','hat closed'],'open hi-hat':['open hat','open hats','ohh','hihat open','hat open'],
 'crash cymbal':['crash','crashes'],'ride cymbal':['ride','rides'],'rimshot':['rim','rims'],'tom':['toms'],
 'shaker':['shakers'],'percussion hit':['perc','percs'],'drum loop':['drum loops','drumloop','beat loop'],
 'top loop':['top loops'],'drum fill':['fill','fills'],'snare roll':['snare rolls','snare build'],
 'vinyl scratch':['scratch','scratches'],'stutter effect':['stutter'],'reverse effect':['reverse','reversed'],
 'sub bass':['sub bass','subs'],'synth chord':['chord','chords'],'foley hit':['foley'],'laser':['lasers','zap','zaps'],
 'vocal ad-lib':['adlib','ad lib','adlibs'],'vocal shout':['shout','shouts']}
# Pack and vendor words that would otherwise read as sound labels.
PACK_NOISE = re.compile(r'glitch with friends|sonic weaponry|black octopus|ghost syndicate|loop cult|virtual riot|'
                        r'construction kits?|project files|ableton|midi|stems?|tracklib|sample pack|vol \d+')
# "wet"/"dry" stem folders describe mixing, not an audible reverb or its absence.
SKIP = {'reverberant', 'dry', 'dark', 'fm synth', 'chorused'}
labels = {}
for c in cat:
    if c['group'] not in ('production', 'character') or c['label'] in SKIP: continue
    terms = {c['label'].lower(), *[a.lower() for a in c.get('aliases', [])], *extra.get(c['label'], [])}
    labels[c['label']] = [re.compile(r'(?<![a-z0-9])' + re.escape(t) + r'(?![a-z0-9])') for t in terms if len(t) > 2]
# A folder carrying a tempo or key names a song ("Pastel Rain - 128 BPM C Min"); its title words
# say nothing about the sound, so they are dropped from the folder and from the file names inside it.
SONG = re.compile(r'\d{2,3}\s*bpm|(?<![a-z0-9])[a-g][#b]?\s*(?:min|maj|minor|major)(?![a-z])', re.I)

def label_text(rel):
    """Searchable words for a library path (vendor folder excluded), minus pack and song titles."""
    parts = rel.split('/')[1:]; titles = []
    for p in parts[:-1]:
        if SONG.search(p):
            t = SONG.split(p)[0].lower()
            t = re.sub(r'^[^-]*? - ', '', t).strip(' -_')     # "Cymatics - Pastel Rain - " -> "pastel rain"
            if len(t) > 2: titles.append(t)
    text = ' '.join(parts).lower()
    for t in titles: text = text.replace(t, ' ')
    return PACK_NOISE.sub(' ', re.sub(r'[_\-\.]+', ' ', text))

def match(rel):
    text = label_text(rel)
    return [l for l, pats in labels.items() if any(p.search(text) for p in pats)]

def main():
    FILES, ROOT, OUT = sys.argv[1:4]; CAP = int(sys.argv[4]) if len(sys.argv) > 4 else 400
    ROOT = ROOT.rstrip('/') + '/'
    by_label = collections.defaultdict(list); vendors = collections.Counter()
    for line in open(FILES):
        path = line.strip(); rel = path[len(ROOT):]; vendor = rel.split('/')[0]
        hit = match(rel)
        # A file matching many unrelated labels is usually a kit or a mixed loop; skip it.
        if not hit or len(hit) > 2: continue
        for l in hit: by_label[l].append({'path': path, 'vendor': vendor})
    random.seed(20261004); clips = []
    for l, items in by_label.items():
        # Spread the cap across brands so no single vendor's style defines the label.
        random.shuffle(items); per = collections.defaultdict(list)
        for it in items: per[it['vendor']].append(it)
        chosen = []; i = 0
        while len(chosen) < CAP and any(i < len(v) for v in per.values()):
            for v in per.values():
                if i < len(v) and len(chosen) < CAP: chosen.append(v[i])
            i += 1
        for it in chosen:
            clips.append({'id': f"vault:{it['path'][len(ROOT):]}", 'path': it['path'], 'label': l,
                          'group': it['vendor'], 'source': 'vault', 'vendor': it['vendor']})
    json.dump({'kind': 'sample-library-manifest-v1', 'root': ROOT, 'capPerLabel': CAP,
               'labels': sorted(by_label), 'clips': clips}, open(OUT, 'w'))
    counts = collections.Counter(c['label'] for c in clips); avail = {l: len(v) for l, v in by_label.items()}
    print(f'clips selected: {len(clips)} across {len(counts)} labels (cap {CAP})')
    for l, n in sorted(avail.items(), key=lambda x: -x[1]):
        vend = len({c['vendor'] for c in clips if c['label'] == l})
        print(f'  {l:<20}{n:>6} available  {counts[l]:>4} chosen  from {vend} brands')

if __name__ == '__main__': main()
