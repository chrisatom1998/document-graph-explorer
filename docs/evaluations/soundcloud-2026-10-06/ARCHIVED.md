# Archived data files

2 large data files from this folder (0.8 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py soundcloud-2026-10-06
```

| File | Size |
|---|---|
| `manifest.json` | 0.3 MB |
| `results/base-records.json` | 0.5 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
