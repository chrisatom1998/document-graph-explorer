# Archived data files

2 large data files from this folder (1.9 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py synth-clips-2026-10-05
```

| File | Size |
|---|---|
| `item-meta.json` | 0.3 MB |
| `manifest.json` | 1.6 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
