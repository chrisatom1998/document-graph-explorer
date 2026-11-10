# Archived data files

10 large data files from this folder (16.0 MB) are kept outside the repository, in the private Hugging Face dataset
`cmjatom/dge-evaluation-archive`. The reports and small files stayed here.

To put them back (needs `HF_TOKEN`):

```
python3 scripts/fetch-evaluation-archive.py key-2026-10-06
```

| File | Size |
|---|---|
| `browser-cnn/mtg-key.json` | 0.2 MB |
| `features-v2/gs-key.json.gz` | 7.7 MB |
| `features-v2/mtg-500.json.gz` | 0.4 MB |
| `features-v2/test-gtzan.json.gz` | 1.1 MB |
| `features-v2/tune-gtzan.json.gz` | 1.0 MB |
| `features-v2/tune-mtg-c1.json.gz` | 0.6 MB |
| `features-v2/tune-mtg.json.gz` | 4.3 MB |
| `features/gs-key.json.gz` | 0.3 MB |
| `features/tune-mtg.json.gz` | 0.2 MB |
| `loops/fsl10k-473.json` | 0.3 MB |

They are also in git history at commit `a7d1a7fe023f`. Sizes and checksums: `docs/evaluations/archived-files.json`.
