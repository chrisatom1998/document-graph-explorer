# Archived data files

2 large data files from this folder (12.2 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py short-clips-2026-10-04
```

| File | Size |
|---|---|
| `item-meta.json` | 0.6 MB |
| `manifest.json` | 11.6 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
