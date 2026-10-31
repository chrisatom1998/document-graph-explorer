"""Re-score FSD50K for every combine input under the same current label mapping.

Usage: python3 refresh-fsd50k-eval.py <eval-fsd50k-base> <run-dir> [...]
Uses each run's existing thresholds; never recalibrates on held-out clips. Updates
only the local eval-fsd50k rows, preserving every other historical benchmark.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

SCRIPTS = Path(__file__).resolve().parent


def refresh(eval_base, runs, runner=subprocess.run):
    for run in map(Path, runs):
        report_path = run / 'eval.json'
        report = json.loads(report_path.read_text())
        model = json.loads((run / 'log.json').read_text())['args']['model']
        with tempfile.TemporaryDirectory(prefix='fsd50k-eval-') as temp:
            out = Path(temp)
            runner([sys.executable, str(SCRIPTS / 'export.py'), str(run / 'model.pt'), str(out),
                    '--model', model], check=True)
            runner([sys.executable, str(SCRIPTS / 'evaluate.py'), str(out / 'model.onnx'),
                    str(run / 'thresholds.json'), str(out / 'eval.json'), str(eval_base)], check=True)
            fresh = json.loads((out / 'eval.json').read_text())
            if not fresh.get('eval-fsd50k'):
                raise ValueError(f'{run}: evaluation did not produce eval-fsd50k rows')
            report['eval-fsd50k'] = fresh['eval-fsd50k']
        report_path.write_text(json.dumps(report, indent=1) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('eval_base')
    ap.add_argument('runs', nargs='+')
    args = ap.parse_args()
    if Path(args.eval_base).name != 'eval-fsd50k':
        ap.error('eval_base must name the eval-fsd50k prepared set')
    refresh(args.eval_base, args.runs)


if __name__ == '__main__':
    main()
