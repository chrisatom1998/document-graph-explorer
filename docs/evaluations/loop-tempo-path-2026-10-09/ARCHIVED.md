# Archived data files

1 large data file from this folder (0.8 MB) is kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put it back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py loop-tempo-path-2026-10-09
```

| File | Size |
|---|---|
| `rows.json` | 0.8 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
