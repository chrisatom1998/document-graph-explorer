| tag | precision | recall | F1 | support | tp | fp | fn | shown as maybe (tp/fp) | 50/50 | 60/60 | 70/70 | decided by | caveat |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|
| kick | 0.50 | 0.05 | 0.09 | 21 | 1 | 1 | 20 | 0/0 | no | no | no | tagger cat:kick@0.8951; clap-head@0.951; one-shot@0.7824 | old head trained on FSD50K eval: may be inflated |
| hi-hat | 0.60 | 0.15 | 0.24 | 20 | 3 | 2 | 17 | 0/0 | no | no | no | tagger cat:hi-hat@0.5413; one-shot@0.867 |  |
| foley | 0.23 | 0.40 | 0.30 | 20 | 8 | 26 | 12 | 0/0 | no | no | no | tagger cat:foley@0.4054 |  |
| bird ambience | 0.56 | 0.25 | 0.34 | 20 | 5 | 4 | 15 | 5/4 | no | no | no | tagger cat:bird ambience@0.4663 (untested); clap-head@0.98 maybe |  |
| wind ambience | 0.56 | 0.25 | 0.34 | 20 | 5 | 4 | 15 | 0/0 | no | no | no | tagger cat:wind ambience@0.5691 |  |
| clap | 0.71 | 0.24 | 0.36 | 21 | 5 | 2 | 16 | 0/0 | no | no | no | tagger cat:clap@0.5007; clap-head@0.943; one-shot@0.8712 |  |
| animal sound | 0.80 | 0.26 | 0.39 | 31 | 8 | 2 | 23 | 0/0 | no | no | no | tagger cat:animal sound@0.6985 |  |
| tambourine | 1.00 | 0.27 | 0.42 | 15 | 4 | 0 | 11 | 0/0 | no | no | no | tagger cat:tambourine@0.3385; tagger cat:tambourine@0.3385; one-shot@0.5 |  |
| snare | 0.67 | 0.33 | 0.44 | 24 | 8 | 4 | 16 | 0/0 | no | no | no | clap-head@0.856; one-shot@0.5794 |  |
| water ambience | 0.35 | 0.65 | 0.46 | 20 | 13 | 24 | 7 | 3/16 | no | no | no | tagger cat:water ambience@0.4426; clap-head@0.935 maybe | old head trained on FSD50K eval: may be inflated |
| bell | 0.52 | 0.42 | 0.47 | 26 | 11 | 10 | 15 | 0/0 | no | no | no | tagger cat:bell@0.4245; clap-head@0.962 |  |
| vocal shout | 0.53 | 0.45 | 0.49 | 20 | 9 | 8 | 11 | 0/0 | no | no | no | tagger cat:vocal shout@0.3786; clap-head@0.986 |  |
| voice | 0.51 | 0.47 | 0.49 | 99 | 46 | 44 | 53 | 0/0 | no | no | no | tagger cat:voice@0.7722; clap-head@0.5; one-shot@0.7495 |  |
| breath | 0.73 | 0.38 | 0.50 | 21 | 8 | 3 | 13 | 3/3 | no | no | no | clap-head@0.983 |  |
| spoken phrase | 0.72 | 0.38 | 0.50 | 34 | 13 | 5 | 21 | 0/0 | no | no | no | clap-head@0.947 |  |
| cymbal | 0.36 | 0.90 | 0.52 | 38 | 34 | 60 | 4 | 0/0 | no | no | no | tagger cymbals@0.5321; tagger cymbals@0.5321; one-shot@0.9801 |  |
| percussion | 0.93 | 0.36 | 0.52 | 115 | 41 | 3 | 74 | 1/1 | no | no | no | tagger cat:percussion@0.5744 |  |
| drums | 0.38 | 0.86 | 0.52 | 63 | 54 | 89 | 9 | 0/9 | no | no | no | tagger drums@0.3663; clap-head@0.506; one-shot@0.7229 | old head trained on FSD50K eval: may be inflated |
| machine ambience | 0.58 | 0.55 | 0.56 | 20 | 11 | 8 | 9 | 0/0 | yes | no | no | tagger cat:machine ambience@0.4003 |  |
| whisper | 0.50 | 0.65 | 0.56 | 20 | 13 | 13 | 7 | 0/0 | yes | no | no | tagger cat:whisper@0.2265; clap-head@0.824 | old head trained on FSD50K eval: may be inflated |
| bass guitar | 0.65 | 0.55 | 0.59 | 20 | 11 | 6 | 9 | 0/0 | yes | no | no | tagger cat:bass guitar@0.6984; one-shot@0.6537 |  |
| strings | 0.69 | 0.55 | 0.61 | 20 | 11 | 5 | 9 | 0/1 | yes | no | no | clap-head@0.924 | old head trained on FSD50K eval: may be inflated |
| environmental sound | 0.95 | 0.46 | 0.62 | 46 | 21 | 1 | 25 | 0/0 | no | no | no | tagger cat:environmental sound@0.6462 |  |
| organ | 0.77 | 0.53 | 0.62 | 19 | 10 | 3 | 9 | 0/0 | yes | no | no | tagger cat:organ@0.6879; clap-head@0.92 | old head trained on FSD50K eval: may be inflated |
| piano | 0.56 | 0.75 | 0.64 | 20 | 15 | 12 | 5 | 0/0 | yes | no | no | tagger piano@0.7598; clap-head@0.85; one-shot@0.6352 | old head trained on FSD50K eval: may be inflated |
| crash cymbal | 0.91 | 0.53 | 0.67 | 19 | 10 | 1 | 9 | 0/0 | yes | no | no | tagger cat:crash cymbal@0.5384; clap-head@0.838 | old head trained on FSD50K eval: may be inflated |
| rain ambience | 0.65 | 0.75 | 0.70 | 20 | 15 | 8 | 5 | 0/0 | yes | yes | no | tagger cat:rain ambience@0.5415; clap-head@0.926 | old head trained on FSD50K eval: may be inflated |
| siren | 0.64 | 0.80 | 0.71 | 20 | 16 | 9 | 4 | 0/0 | yes | yes | no | tagger cat:siren@0.2494; clap-head@0.7545 | old head trained on FSD50K eval: may be inflated |
| gong | 0.74 | 0.70 | 0.72 | 20 | 14 | 5 | 6 | 0/0 | yes | yes | yes | tagger cat:gong@0.2322; clap-head@0.923 | old head trained on FSD50K eval: may be inflated |
| vocal laugh | 0.74 | 0.70 | 0.72 | 20 | 14 | 5 | 6 | 0/0 | yes | yes | yes | clap-head@0.965 | old head trained on FSD50K eval: may be inflated |
| electric guitar | 0.81 | 0.65 | 0.72 | 20 | 13 | 3 | 7 | 0/0 | yes | yes | no | clap-head@0.933 | old head trained on FSD50K eval: may be inflated |
| vocal scream | 0.81 | 0.65 | 0.72 | 20 | 13 | 3 | 7 | 0/0 | yes | yes | no | tagger cat:vocal scream@0.3599 |  |
| mallet instrument | 0.68 | 0.77 | 0.72 | 22 | 17 | 8 | 5 | 0/4 | yes | yes | no | clap-head@0.936 | old head trained on FSD50K eval: may be inflated |
| harp | 0.92 | 0.60 | 0.73 | 20 | 12 | 1 | 8 | 0/0 | yes | yes | no | clap-head@0.846 |  |
| whoosh | 0.92 | 0.60 | 0.73 | 20 | 12 | 1 | 8 | 0/0 | yes | yes | no | clap-head@0.941; one-shot@0.8215 | old head trained on FSD50K eval: may be inflated |
| crowd ambience | 0.78 | 0.70 | 0.74 | 20 | 14 | 4 | 6 | 0/0 | yes | yes | yes | clap-head@0.985 |  |
| harmonica | 0.63 | 0.95 | 0.76 | 20 | 19 | 11 | 1 | 0/0 | yes | yes | no | clap-head@0.752 |  |
| guitar | 0.85 | 0.75 | 0.79 | 59 | 44 | 8 | 15 | 0/0 | yes | yes | yes | tagger cat:guitar@0.6501; one-shot@0.6598 |  |
| finger snap | 0.93 | 0.70 | 0.80 | 20 | 14 | 1 | 6 | 0/0 | yes | yes | yes | tagger cat:finger snap@0.2597; clap-head@0.958; one-shot@0.9595 |  |
| glockenspiel | 0.93 | 0.70 | 0.80 | 20 | 14 | 1 | 6 | 0/0 | yes | yes | yes | tagger cat:glockenspiel@0.2462 |  |
| acoustic guitar | 1.00 | 0.75 | 0.86 | 20 | 15 | 0 | 5 | 0/0 | yes | yes | yes | clap-head@0.931 | old head trained on FSD50K eval: may be inflated |
| cowbell | 1.00 | 0.75 | 0.86 | 20 | 15 | 0 | 5 | 0/0 | yes | yes | yes | clap-head@0.964; one-shot@0.5 | old head trained on FSD50K eval: may be inflated |
| trumpet | 0.94 | 0.85 | 0.90 | 20 | 17 | 1 | 3 | 0/0 | yes | yes | yes | tagger trumpet@0.6819; clap-head@0.863 |  |
| accordion | 0.86 | 0.95 | 0.90 | 19 | 18 | 3 | 1 | 0/0 | yes | yes | yes | clap-head@0.959 | old head trained on FSD50K eval: may be inflated |
| vinyl scratch | 1.00 | 0.85 | 0.92 | 20 | 17 | 0 | 3 | 0/0 | yes | yes | yes | clap-head@0.595; one-shot@0.8286 |  |
| tabla | 1.00 | 1.00 | 1.00 | 6 | 6 | 0 | 0 | 0/0 | yes | yes | yes | clap-head@0.732 | support < 10 |
