"""App tags that get a tagger output ('cat:<label>') from run 7 on, beyond labelmap.CAT.

Kept out of labelmap.py on purpose: that file is part of the prepared-data cache key (hf-job.sh), and changing it would
re-run the ~3 h cached prep. train.py appends these to its class list; only the uncached run 7 sources label them
(prepare-iowa.py, prepare-vcsl.py with strong absences from those single-instrument sources; prepare-fsnew.py with
weak absences only).
"""
EXTRA_CAT = ['bongo', 'tuned percussion', 'banjo', 'mandolin', 'pitched vocal', 'shaker loop', 'synth hit', 'vocal shush']
