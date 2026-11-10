# Archived data files

5 large data files from this folder (6.6 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py structure-2026-10-06
```

| File | Size |
|---|---|
| `features/labels.json` | 0.9 MB |
| `features/shard-0.json.gz` | 1.5 MB |
| `features/shard-1.json.gz` | 1.6 MB |
| `features/shard-2.json.gz` | 1.4 MB |
| `features/shard-3.json.gz` | 1.3 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
