# Archived data files

1 large data file from this folder (0.2 MB) is kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put it back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py hf-key-tempo-2026-10-06
```

| File | Size |
|---|---|
| `runs/tempo-v1/cv.json` | 0.2 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
