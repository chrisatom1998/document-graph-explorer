# Archived data files

9 large data files from this folder (10.2 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py dj-fix-2026-10-06
```

| File | Size |
|---|---|
| `calibration/cal900-records.json` | 2.9 MB |
| `judge/branch/r1-giantsteps.json` | 0.2 MB |
| `judge/branch/r1-openmic-records.json` | 1.6 MB |
| `judge/branch/r2-mtgkey.json` | 0.2 MB |
| `judge/branch/r2-openmic-records.json` | 1.6 MB |
| `judge/main/r1-giantsteps.json` | 0.2 MB |
| `judge/main/r1-openmic-records.json` | 1.6 MB |
| `judge/main/r2-mtgkey.json` | 0.2 MB |
| `judge/main/r2-openmic-records.json` | 1.6 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
