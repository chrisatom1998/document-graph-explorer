"""Dry-run the sound-tag training job. Does not start Hugging Face compute.

  python3 scripts/hf-sound-tags/plan.py
  python3 scripts/hf-sound-tags/plan.py --launch

--launch is refused unless HF_TOKEN (or HUGGING_FACE_HUB_TOKEN) is set and
DGE_HF_LAUNCH_CONFIRM=yes. Even then it only shells out to
scripts/audio-model/hf-launch.py, which is the repo's existing Jobs launcher.
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
    prices = config['pricesUsdPerHour']
    parts = []
    total = 0.0
    for name in ('train', 'eval'):
        step = config[name]
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


def job_env(config: dict) -> dict[str, str]:
    tags = ','.join(config['recallTags'])
    return {
        'RECALL_TAGS': tags,
        'POS_WEIGHT': str(config['posWeight']),
        'JOB_NAME': 'dge-sound-tag-recall',
        'HF_REPO': config['candidateRepo'],
    }


def job_argv(config: dict) -> list[str]:
    train = config['train']
    env = job_env(config)
    timeout = f"{int(train['hours'])}h" if float(train['hours']).is_integer() else f"{train['hours']}h"
    pairs = [f'{key}={value}' for key, value in env.items()]
    return [sys.executable, os.path.join(ROOT, 'scripts', 'audio-model', 'hf-launch.py'), train['flavor'], timeout, *pairs]


def launch(config: dict) -> int:
    """Start the job. Refuses unless the cost is inside the cap and the confirm latch is set."""
    cost = estimate(config)
    if not cost['withinCap']:
        raise SystemExit(f"estimate ${cost['usd']} is over the ${cost['cap']} cap")
    if os.environ.get('DGE_HF_LAUNCH_CONFIRM') != 'yes':
        raise SystemExit('refusing to launch: set DGE_HF_LAUNCH_CONFIRM=yes')
    if not token_status()['env']:
        raise SystemExit('refusing to launch: set HF_TOKEN or HUGGING_FACE_HUB_TOKEN')
    # Imported here so a dry run does not need huggingface_hub, and so this file
    # cannot start a job on import.
    import subprocess
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
