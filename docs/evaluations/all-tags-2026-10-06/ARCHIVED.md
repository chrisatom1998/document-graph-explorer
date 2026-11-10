# Archived data files

12 large data files from this folder (17.6 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py all-tags-2026-10-06
```

| File | Size |
|---|---|
| `jamendo-val-manifest.json` | 3.4 MB |
| `judge/branch/r1-giantsteps.json` | 0.2 MB |
| `judge/branch/r1-openmic-records.json` | 1.6 MB |
| `judge/branch/r2-mtgkey.json` | 0.2 MB |
| `judge/branch/r2-openmic-records.json` | 1.6 MB |
| `judge/main/r1-giantsteps.json` | 0.2 MB |
| `judge/main/r1-openmic-records.json` | 1.6 MB |
| `judge/main/r2-mtgkey.json` | 0.2 MB |
| `judge/main/r2-openmic-records.json` | 1.6 MB |
| `results/jamendo-main-f299e13/records.json` | 2.3 MB |
| `results/tinysol-main-b232c07/records.json` | 2.5 MB |
| `tinysol-manifest.json` | 2.0 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
