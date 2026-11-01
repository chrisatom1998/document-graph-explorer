| tag | precision | recall | F1 | support | tp | fp | fn | shown as maybe (tp/fp) | 50/50 | 60/60 | 70/70 | decided by | caveat |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|
| wind ambience | 0.00 | 0.00 | 0.00 | 20 | 0 | 2 | 20 | 0/0 | no | no | no | tagger cat:wind ambience@0.05 |  |
| cymbal | 0.50 | 0.10 | 0.17 | 38 | 4 | 4 | 34 | 0/0 | no | no | no | tagger cymbals@0.45; tagger cymbals@0.45; one-shot@0.9801 |  |
| foley | 0.24 | 0.30 | 0.27 | 20 | 6 | 19 | 14 | 0/0 | no | no | no | tagger cat:foley@0.15 |  |
| hi-hat | 0.67 | 0.20 | 0.31 | 20 | 4 | 2 | 16 | 0/0 | no | no | no | tagger cat:hi-hat@0.15; one-shot@0.867 |  |
| vocal shout | 0.40 | 0.30 | 0.34 | 20 | 6 | 9 | 14 | 0/0 | no | no | no | tagger cat:vocal shout@0.03; clap-head@0.986 |  |
| clap | 0.83 | 0.24 | 0.37 | 21 | 5 | 1 | 16 | 0/0 | no | no | no | tagger cat:clap@0.5; clap-head@0.943; one-shot@0.8712 |  |
| drums | 0.28 | 0.88 | 0.42 | 49 | 43 | 112 | 6 | 0/9 | no | no | no | tagger drums@0.2928; clap-head@0.506; one-shot@0.7229 | old head trained on FSD50K eval: may be inflated |
| bell | 0.42 | 0.42 | 0.42 | 26 | 11 | 15 | 15 | 0/0 | no | no | no | tagger cat:bell@0.4454; clap-head@0.962 |  |
| piano | 0.29 | 0.75 | 0.42 | 20 | 15 | 36 | 5 | 0/0 | no | no | no | tagger piano@0.5337; clap-head@0.85; one-shot@0.6352 | old head trained on FSD50K eval: may be inflated |
| snare | 0.67 | 0.33 | 0.44 | 24 | 8 | 4 | 16 | 0/0 | no | no | no | clap-head@0.856; one-shot@0.5794 |  |
| machine ambience | 0.50 | 0.45 | 0.47 | 20 | 9 | 9 | 11 | 0/0 | no | no | no | tagger cat:machine ambience@0.2647 |  |
| tambourine | 0.83 | 0.33 | 0.48 | 15 | 5 | 1 | 10 | 0/0 | no | no | no | tagger cat:tambourine@0.1181; tagger cat:tambourine@0.1181; one-shot@0.5 |  |
| spoken phrase | 0.72 | 0.38 | 0.50 | 34 | 13 | 5 | 21 | 0/0 | no | no | no | clap-head@0.947 |  |
| water ambience | 0.38 | 0.75 | 0.50 | 20 | 15 | 25 | 5 | 3/12 | no | no | no | tagger cat:water ambience@0.3239; clap-head@0.935 maybe | old head trained on FSD50K eval: may be inflated |
| bird ambience | 0.73 | 0.40 | 0.52 | 20 | 8 | 3 | 12 | 8/3 | no | no | no | tagger cat:bird ambience@0.1277 (untested); clap-head@0.98 maybe |  |
| voice | 0.54 | 0.53 | 0.53 | 99 | 52 | 45 | 47 | 0/0 | yes | no | no | tagger cat:voice@0.587; clap-head@0.5; one-shot@0.7495 |  |
| animal sound | 0.71 | 0.48 | 0.58 | 31 | 15 | 6 | 16 | 0/0 | no | no | no | tagger cat:animal sound@0.2411 |  |
| bass guitar | 0.65 | 0.55 | 0.59 | 20 | 11 | 6 | 9 | 0/0 | yes | no | no | tagger cat:bass guitar@0.5765; one-shot@0.6537 |  |
| strings | 0.69 | 0.55 | 0.61 | 20 | 11 | 5 | 9 | 0/1 | yes | no | no | clap-head@0.924 | old head trained on FSD50K eval: may be inflated |
| kick | 0.58 | 0.67 | 0.62 | 21 | 14 | 10 | 7 | 0/0 | yes | no | no | tagger cat:kick@0.53; clap-head@0.951; one-shot@0.7824 | old head trained on FSD50K eval: may be inflated |
| organ | 0.77 | 0.53 | 0.62 | 19 | 10 | 3 | 9 | 0/0 | yes | no | no | tagger cat:organ@0.774; clap-head@0.92 | old head trained on FSD50K eval: may be inflated |
| whisper | 0.54 | 0.75 | 0.62 | 20 | 15 | 13 | 5 | 0/0 | yes | no | no | tagger cat:whisper@0.1115; clap-head@0.824 | old head trained on FSD50K eval: may be inflated |
| breath | 0.71 | 0.57 | 0.63 | 21 | 12 | 5 | 9 | 10/5 | yes | no | no | clap-head@0.983 |  |
| glockenspiel | 0.91 | 0.50 | 0.65 | 20 | 10 | 1 | 10 | 0/0 | yes | no | no | tagger cat:glockenspiel@0.3828 |  |
| crash cymbal | 0.79 | 0.58 | 0.67 | 19 | 11 | 3 | 8 | 0/0 | yes | no | no | tagger cat:crash cymbal@0.1631; clap-head@0.838 | old head trained on FSD50K eval: may be inflated |
| rain ambience | 0.64 | 0.80 | 0.71 | 20 | 16 | 9 | 4 | 0/0 | yes | yes | no | tagger cat:rain ambience@0.4504; clap-head@0.926 | old head trained on FSD50K eval: may be inflated |
| vocal laugh | 0.74 | 0.70 | 0.72 | 20 | 14 | 5 | 6 | 0/0 | yes | yes | yes | clap-head@0.965 | old head trained on FSD50K eval: may be inflated |
| electric guitar | 0.81 | 0.65 | 0.72 | 20 | 13 | 3 | 7 | 0/0 | yes | yes | no | clap-head@0.933 | old head trained on FSD50K eval: may be inflated |
| mallet instrument | 0.68 | 0.77 | 0.72 | 22 | 17 | 8 | 5 | 0/4 | yes | yes | no | clap-head@0.936 | old head trained on FSD50K eval: may be inflated |
| harp | 0.92 | 0.60 | 0.73 | 20 | 12 | 1 | 8 | 0/0 | yes | yes | no | clap-head@0.846 |  |
| siren | 0.67 | 0.80 | 0.73 | 20 | 16 | 8 | 4 | 0/0 | yes | yes | no | tagger cat:siren@0.277; clap-head@0.7545 | old head trained on FSD50K eval: may be inflated |
| whoosh | 0.92 | 0.60 | 0.73 | 20 | 12 | 1 | 8 | 0/0 | yes | yes | no | clap-head@0.941; one-shot@0.8215 | old head trained on FSD50K eval: may be inflated |
| crowd ambience | 0.78 | 0.70 | 0.74 | 20 | 14 | 4 | 6 | 0/0 | yes | yes | yes | clap-head@0.985 |  |
| environmental sound | 0.86 | 0.65 | 0.74 | 46 | 30 | 5 | 16 | 0/0 | yes | yes | no | tagger cat:environmental sound@0.4549 |  |
| vocal scream | 1.00 | 0.60 | 0.75 | 20 | 12 | 0 | 8 | 0/0 | yes | yes | no | tagger cat:vocal scream@0.1959 |  |
| harmonica | 0.63 | 0.95 | 0.76 | 20 | 19 | 11 | 1 | 0/0 | yes | yes | no | clap-head@0.752 |  |
| guitar | 0.75 | 0.78 | 0.77 | 59 | 46 | 15 | 13 | 0/0 | yes | yes | yes | tagger cat:guitar@0.3; one-shot@0.6598 |  |
| gong | 0.88 | 0.70 | 0.78 | 20 | 14 | 2 | 6 | 0/0 | yes | yes | yes | tagger cat:gong@0.2; clap-head@0.923 | old head trained on FSD50K eval: may be inflated |
| percussion | 0.93 | 0.67 | 0.78 | 115 | 77 | 6 | 38 | 1/1 | yes | yes | no | tagger cat:percussion@0.249 |  |
| finger snap | 1.00 | 0.65 | 0.79 | 20 | 13 | 0 | 7 | 0/0 | yes | yes | no | tagger cat:finger snap@0.175; clap-head@0.958; one-shot@0.9595 |  |
| vinyl scratch | 0.84 | 0.80 | 0.82 | 20 | 16 | 3 | 4 | 0/0 | yes | yes | yes | clap-head@0.595; one-shot@0.8286 |  |
| acoustic guitar | 1.00 | 0.75 | 0.86 | 20 | 15 | 0 | 5 | 0/0 | yes | yes | yes | clap-head@0.931 | old head trained on FSD50K eval: may be inflated |
| cowbell | 1.00 | 0.75 | 0.86 | 20 | 15 | 0 | 5 | 0/0 | yes | yes | yes | clap-head@0.964; one-shot@0.5 | old head trained on FSD50K eval: may be inflated |
| trumpet | 1.00 | 0.80 | 0.89 | 20 | 16 | 0 | 4 | 0/0 | yes | yes | yes | tagger trumpet@0.9486; clap-head@0.863 |  |
| accordion | 0.86 | 0.95 | 0.90 | 19 | 18 | 3 | 1 | 0/0 | yes | yes | yes | clap-head@0.959 | old head trained on FSD50K eval: may be inflated |
| tabla | 1.00 | 1.00 | 1.00 | 6 | 6 | 0 | 0 | 0/0 | yes | yes | yes | clap-head@0.732 | support < 10 |
