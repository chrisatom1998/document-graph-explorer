# Python PEPs (held-out graph accuracy corpus)

61 Python Enhancement Proposals, copied unchanged from
https://github.com/python/peps (`peps/pep-NNNN.rst`, fetched 2026-10-06).
Each one states in its Copyright section that it is placed in the public
domain or under CC0-1.0-Universal.

`src/eval/graphAccuracy.test.ts` builds a graph from them exactly as the app
does for dropped `.rst` files and scores it against topic groups labelled by
the feature each PEP specifies (`PEP_GROUPS`). File names carry no topic
words, so only the text can link two PEPs.

Nothing in the app was tuned on these files. Keep it that way: a change made
to raise these scores turns the test into one more training set.
