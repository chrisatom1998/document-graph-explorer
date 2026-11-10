# Archived data files

1 large data file from this folder (1.0 MB) is kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put it back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py edm-genre-tags-2026-10-05
```

| File | Size |
|---|---|
| `openmic-main.json` | 1.0 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
