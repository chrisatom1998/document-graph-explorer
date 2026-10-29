"""Dry-run the sound-tag training job. Does not start Hugging Face compute.

  python3 scripts/hf-sound-tags/plan.py
  python3 scripts/hf-sound-tags/plan.py --launch

--launch is refused unless HF_TOKEN (or HUGGING_FACE_HUB_TOKEN) is set and
DGE_HF_LAUNCH_CONFIRM=yes. It then runs hf-launch.py and hf-job.sh copied from
config repoSha, so the job script matches the commit the job clones.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def load_config(path: str | None = None) -> dict:
    with open(path or os.path.join(HERE, 'config.json')) as handle:
        return json.load(handle)


def token_status() -> dict:
    """Which credential slots are filled. Values are never returned."""
    env = [name for name in ('HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN') if os.environ.get(name)]
    cache = os.path.expanduser(os.path.join('~', '.cache', 'huggingface', 'token'))
    return {'env': env, 'cacheFile': os.path.exists(cache)}


def estimate(config: dict) -> dict:
    """Price the jobs launch() actually starts. Scoring runs inside the training job, so an eval step marked launched:false is not billed."""
    prices = config['pricesUsdPerHour']
    parts = []
    total = 0.0
    for name in ('train', 'eval'):
        step = config.get(name)
        if not step or step.get('launched') is False:
            continue
        rate = prices.get(step['flavor'])
        if rate is None:
            raise SystemExit(f"no price for flavor {step['flavor']}")
        cost = round(rate * step['hours'] * step['jobs'], 2)
        parts.append({'step': name, 'flavor': step['flavor'], 'hours': step['hours'], 'jobs': step['jobs'], 'usd': cost})
        total += cost
    total = round(total, 2)
    return {'parts': parts, 'usd': total, 'cap': config['maxCostUsd'], 'withinCap': total <= config['maxCostUsd']}


def overlap(train_ids: set[str], held_out_ids: set[str]) -> set[str]:
    return train_ids & held_out_ids


def _read_ids(path: str) -> set[str]:
    with open(path) as handle:
        return {line.strip() for line in handle if line.strip() and not line.startswith('#')}


def _abs(path: str) -> str:
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


def check_forbidden_overlap(config: dict) -> dict:
    """Refuse when a local training-id file shares an id with a forbidden-set file.

    Files live in forbiddenIdsDir (default scripts/hf-sound-tags/forbidden-ids/<set>.txt)
    and trainIdsFile. Missing files count as empty: the job's own drop list
    (tagger-r20, via R13_DATA) is what filters the private cache. This is the check
    launch() runs before it copies the launcher or starts a job.
    """
    directory = _abs(config.get('forbiddenIdsDir') or os.path.join(HERE, 'forbidden-ids'))
    held: set[str] = set()
    present = []
    for name in config.get('forbiddenSets', []):
        path = os.path.join(directory, f'{name}.txt')
        if os.path.isfile(path):
            present.append(name)
            held |= _read_ids(path)
    train_path = config.get('trainIdsFile')
    train = _read_ids(_abs(train_path)) if train_path and os.path.isfile(_abs(train_path)) else set()
    shared = overlap(train, held)
    if shared:
        raise SystemExit(f'refusing to launch: {len(shared)} training ids are in a forbidden set')
    return {'checked': True, 'forbiddenLists': present, 'trainIds': len(train), 'heldOutIds': len(held), 'overlap': 0}


PROTECTED = ('cmjatom/dge-all-tags-tagger-nc', 'cmjatom/dge-all-tags-tagger', 'cmjatom/dge-instrument-tagger')


def check_repos(config: dict) -> None:
    """The candidate must be a real, new repo id, never the shipped tagger or the run repo the base comes from."""
    repo = config['candidateRepo']
    if '<' in repo or repo.count('/') != 1:
        raise SystemExit(f'candidateRepo {repo!r} is a placeholder; set <user>/<name>')
    if repo in PROTECTED or repo == config.get('doNotOverwrite'):
        raise SystemExit(f'refusing to write to {repo}: protected model repo')


def timeout_text(hours: float) -> str:
    return f'{int(hours)}h' if float(hours).is_integer() else f'{int(round(hours * 60))}m'


def job_env(config: dict) -> dict[str, str]:
    """Everything hf-job.sh needs. It runs under set -u, so REPO_SHA, MODEL, EPOCHS, LR, BATCH and WEAK must be set, and
    JOB_HOURS must match the job timeout or training is budgeted past the time limit."""
    env = dict(config.get('jobEnv', {}))
    env.update({
        'REPO_SHA': config['repoSha'],
        'INIT_FROM': config['initFrom'],
        'RECALL_TAGS': ','.join(config['recallTags']),
        'POS_WEIGHT': str(config['posWeight']),
        'JOB_NAME': 'dge-sound-tag-recall',
        'HF_REPO': config['candidateRepo'],
        'OUT_DIR': config.get('outDir', ''),
    })
    env['JOB_HOURS'] = str(config['train']['hours'])
    missing = [k for k in ('REPO_SHA', 'MODEL', 'EPOCHS', 'LR', 'BATCH', 'WEAK') if not env.get(k)]
    if missing:
        raise SystemExit(f'job env is missing {missing} (hf-job.sh runs with set -u)')
    return env


def job_argv(config: dict) -> list[str]:
    train = config['train']
    env = job_env(config)
    pairs = [f'{key}={value}' for key, value in env.items()]
    python = os.environ.get('DGE_HF_PYTHON', sys.executable)   # an interpreter with huggingface_hub installed
    return [python, os.path.join(launcher_dir(config), 'hf-launch.py'), train['flavor'], timeout_text(train['hours']), *pairs]


def launcher_dir(config: dict) -> str:
    """hf-launch.py sends its own folder's hf-job.sh, while the job clones REPO_SHA for everything else. Use the launcher
    and job script from REPO_SHA so the two always match (extracted on --launch; this path is where they go)."""
    return os.path.join(ROOT, '.hf-launch', config['repoSha'][:12])


def extract_launcher(config: dict) -> None:
    import subprocess
    out = launcher_dir(config)
    os.makedirs(out, exist_ok=True)
    for name in ('hf-launch.py', 'hf-job.sh'):
        blob = subprocess.run(['git', 'show', f"{config['repoSha']}:scripts/audio-model/{name}"], cwd=ROOT, check=True,
                              capture_output=True).stdout
        with open(os.path.join(out, name), 'wb') as handle:
            handle.write(blob)


def launch(config: dict) -> int:
    """Start the job. Refuses unless the cost is inside the cap and the confirm latch is set."""
    cost = estimate(config)
    if not cost['withinCap']:
        raise SystemExit(f"estimate ${cost['usd']} is over the ${cost['cap']} cap")
    if os.environ.get('DGE_HF_LAUNCH_CONFIRM') != 'yes':
        raise SystemExit('refusing to launch: set DGE_HF_LAUNCH_CONFIRM=yes')
    if not token_status()['env']:
        raise SystemExit('refusing to launch: set HF_TOKEN or HUGGING_FACE_HUB_TOKEN')
    check_repos(config)
    if any(part['usd'] > config.get('maxJobUsd', 5) for part in cost['parts']):
        raise SystemExit('a single job estimate is over the per-job limit')
    check_forbidden_overlap(config)
    # Imported here so a dry run does not need huggingface_hub, and so this file
    # cannot start a job on import.
    import subprocess
    extract_launcher(config)
    print('launching', ' '.join(job_argv(config)), flush=True)
    return subprocess.call(job_argv(config), cwd=ROOT)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=os.path.join(HERE, 'config.json'))
    parser.add_argument('--launch', action='store_true')
    args = parser.parse_args()
    config = load_config(args.config)
    cost = estimate(config)
    creds = token_status()
    report = {
        'base': f"{config['baseRepository']}@{config['baseRevision'][:12]}",
        'method': config['method'],
        'recallTags': config['recallTags'],
        'cost': cost,
        'tokenPresent': bool(creds['env'] or creds['cacheFile']),
        'tokenEnv': creds['env'],
        'tokenCacheFile': creds['cacheFile'],
        'forbiddenSets': config['forbiddenSets'],
        'forbiddenOverlap': check_forbidden_overlap(config),
        'command': job_argv(config),
        'willLaunch': False,
    }
    print(json.dumps(report, indent=1))
    if not args.launch:
        print('dry run only; pass --launch with DGE_HF_LAUNCH_CONFIRM=yes to start the job')
        return 0
    return launch(config)


if __name__ == '__main__':
    sys.exit(main())
