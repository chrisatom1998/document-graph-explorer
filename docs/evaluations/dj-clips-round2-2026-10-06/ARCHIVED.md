# Archived data files

4 large data files from this folder (1.7 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py dj-clips-round2-2026-10-06
```

| File | Size |
|---|---|
| `mtg-key-manifest.json` | 0.4 MB |
| `results/mtg-key.json` | 0.2 MB |
| `results/openmic-clips.json` | 0.8 MB |
| `results/tempo-fix-116/mtg-key.json` | 0.2 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
