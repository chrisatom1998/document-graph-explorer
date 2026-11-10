# Archived data files

3 large data files from this folder (1.7 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py tempo-2026-10-06
```

| File | Size |
|---|---|
| `features/gtzan-test.json.gz` | 0.6 MB |
| `features/holdout.json.gz` | 0.3 MB |
| `features/tune.json.gz` | 0.8 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
