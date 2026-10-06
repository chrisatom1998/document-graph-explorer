"""Run one evaluation task as N parallel Hugging Face Jobs (scripts/hf-eval/job.sh), wait for all of them, download
their outputs and report wall-clock and cost. Launched by .github/workflows/hf-eval.yml; HF_TOKEN comes from the
repository secret and is only passed to the jobs as a secret.

Usage: python3 scripts/hf-eval/launch.py <task> <parts> <flavor> <timeout> <max_cost_usd> <out_dir> KEY=VALUE...
  KEY=VALUE pairs are passed to every job's environment (APP_SHA, HARNESS_SHA, TASK_ARGS, ...).
Refuses to start when parts x timeout x the flavor's price could pass max_cost_usd. Writes <out_dir>/part-<i>/ (each
job's outputs), <out_dir>/logs/part-<i>.log and <out_dir>/hf-cost.json, and appends a summary to $GITHUB_STEP_SUMMARY.
Exits 1 if any job did not complete.
"""
import json, os, re, sys, time, urllib.request
from datetime import datetime, timezone
from huggingface_hub import cancel_job, fetch_job_logs, inspect_job, run_job, snapshot_download, whoami

task, parts, flavor, timeout, max_cost, out = sys.argv[1:7]
parts, max_cost = int(parts), float(max_cost)
env = dict(p.split('=', 1) for p in sys.argv[7:])
IMAGE = 'node:24-bookworm'

def hours(t):
    m = re.fullmatch(r'(\d+(?:\.\d+)?)([smhd]?)', t)
    if not m: sys.exit(f'timeout must look like 90m or 2h, got {t!r}')
    return float(m[1]) * {'s': 1 / 3600, 'm': 1 / 60, 'h': 1, 'd': 24, '': 1 / 3600}[m[2]]

hw = {h['name']: h for h in json.load(urllib.request.urlopen('https://huggingface.co/api/jobs/hardware', timeout=60))}
if flavor not in hw: sys.exit(f'unknown flavor {flavor}; one of {sorted(hw)}')
per_hour = hw[flavor]['unitCostUSD'] * 60
worst = parts * hours(timeout) * per_hour
print(f'{parts} x {flavor} ({hw[flavor]["cpu"]}, ${per_hour:.2f}/h), timeout {timeout}: worst case ${worst:.2f}, limit ${max_cost:.2f}')
if worst > max_cost:
    sys.exit(f'::error::worst-case cost ${worst:.2f} is over the ${max_cost:.2f} limit; lower parts or timeout, or raise max_cost')

user = whoami()['name']
run_key = env.setdefault('RUN_KEY', f'{task}-{int(time.time())}')
env.update(TASK=task, PARTS=str(parts), HF_DATASET=f'{user}/dge-eval-runs', JOB_CPUS=hw[flavor]['cpu'].split()[0])
script = open(os.path.join(os.path.dirname(__file__), 'job.sh')).read()
# RESCORE=<run key>: start nothing; download that earlier run's parts so collect can score them again.
rescore = env.pop('RESCORE', '')
if rescore: run_key = env['RUN_KEY'] = rescore
jobs = []
for i in range(0 if rescore else parts):
    job = run_job(image=IMAGE, command=['bash', '-c', script], env={**env, 'PART': str(i)},
                  secrets={'HF_TOKEN': os.environ['HF_TOKEN']}, flavor=flavor, timeout=timeout,
                  name=f'dge-eval-{task}-{i}', labels={'app': 'dge-eval', 'run': run_key[:100]})
    jobs.append(job.id)
    print(f'part {i}: https://huggingface.co/jobs/{user}/{job.id}', flush=True)
open('hf-job-ids', 'w').write('\n'.join(jobs))
t0 = time.time()
deadline = t0 + float(os.environ.get('FOLLOW_HOURS', '5.5')) * 3600
seen_end = {}
while jobs:
    stages = [inspect_job(job_id=j).status.stage for j in jobs]
    for j, s in zip(jobs, stages):
        if s not in ('RUNNING', 'SCHEDULING') and j not in seen_end: seen_end[j] = time.time()
    print(f'{(time.time() - t0) / 60:5.1f} min: ' + ' '.join(f'{k}:{s}' for k, s in enumerate(stages)), flush=True)
    if len(seen_end) == len(jobs): break
    if time.time() > deadline:
        for j in jobs: cancel_job(job_id=j)
        sys.exit('::error::jobs still running at the follow limit; cancelled')
    time.sleep(60)
wall = (max(seen_end.values()) - t0) / 60 if jobs else 0

os.makedirs(f'{out}/logs', exist_ok=True)
rows, failed = [], []
for i, j in enumerate(jobs):
    info = inspect_job(job_id=j)
    start, end = info.started_at or info.created_at, info.finished_at
    minutes = ((end - start).total_seconds() / 60) if (start and end) else (seen_end[j] - t0) / 60
    rows.append({'part': i, 'job': j, 'stage': info.status.stage, 'minutes': round(minutes, 1)})
    try: log = list(fetch_job_logs(job_id=j))
    except Exception as e: log = [f'(logs unavailable: {e})']
    open(f'{out}/logs/part-{i}.log', 'w').write('\n'.join(log) + '\n')
    if info.status.stage != 'COMPLETED':
        failed.append(i); print(f'--- part {i} {info.status.stage}: last 60 log lines ---\n' + '\n'.join(log[-60:]))
    else:
        print(f'--- part {i} completed in {minutes:.1f} min; last 5 lines ---\n' + '\n'.join(log[-5:]))
job_minutes = sum(r['minutes'] for r in rows)
cost = job_minutes / 60 * per_hour
report = {'task': task, 'run_key': run_key, 'flavor': flavor, 'parts': parts, 'usd_per_hour': round(per_hour, 4),
          'wall_clock_min': round(wall, 1), 'job_minutes': round(job_minutes, 1), 'cost_usd': round(cost, 3),
          'worst_case_usd': round(worst, 2), 'failed_parts': failed, 'jobs': rows,
          'finished': datetime.now(timezone.utc).isoformat(timespec='seconds')}
snapshot_download(f'{user}/dge-eval-runs', repo_type='dataset', allow_patterns=[f'runs/{run_key}/*'], local_dir=f'{out}/.dl')
src = f'{out}/.dl/runs/{run_key}'
for d in (os.listdir(src) if os.path.isdir(src) else []): os.replace(f'{src}/{d}', f'{out}/{d}')
json.dump(report, open(f'{out}/hf-cost.json', 'w'), indent=1)
summary = (f'### HF eval `{task}`\n{parts} x {flavor}: wall clock {wall:.1f} min, {job_minutes:.1f} job-minutes, '
           f'cost ${cost:.3f} (worst case ${worst:.2f}). Failed parts: {failed or "none"}.\n')
print(summary)
if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(summary)
sys.exit(1 if failed else 0)
