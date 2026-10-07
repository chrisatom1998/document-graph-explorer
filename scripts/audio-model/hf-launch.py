"""Start scripts/audio-model/hf-job.sh on Hugging Face Jobs, stream its log into this one, and fail if the job fails.
A GitHub-hosted runner is stopped after 6 h (which would cancel the job), so after FOLLOW_HOURS (default 5.25) this stops
following, writes hf-job-detached and exits 0; the job keeps going and uploads its own results.

Usage: HF_TOKEN=... python3 scripts/audio-model/hf-launch.py <flavor> <timeout> KEY=VALUE...   (env passed to the job)
"""
import os, sys, time
from huggingface_hub import cancel_job, fetch_job_logs, inspect_job, list_jobs, run_job, whoami

flavor, timeout, *pairs = sys.argv[1:]
env = dict(p.split('=', 1) for p in pairs)
user = whoami()['name']; env.setdefault('HF_REPO', f'{user}/dge-instrument-tagger')
# JOB_NAME (default dge-instrument-tagger) names the run's lane: one job per lane at a time, so a job this workflow
# started and then lost (a cancelled workflow) is stopped first, while a run in another lane keeps going.
name = env.get('JOB_NAME') or 'dge-instrument-tagger'
for old in list_jobs(status=['RUNNING', 'SCHEDULING']):
    if name in (getattr(old, 'name', None), (getattr(old, 'labels', None) or {}).get('lane')):   # older clients drop name
        print(f'cancelling earlier tagger job {old.id}', flush=True); cancel_job(job_id=old.id)
script = open(os.path.join(os.path.dirname(__file__), env.get('JOB_SCRIPT') or 'hf-job.sh')).read()   # JOB_SCRIPT: hf-effects-job.sh
job = run_job(image='pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime', command=['bash', '-c', script], env=env,
              secrets={'HF_TOKEN': os.environ['HF_TOKEN']}, flavor=flavor, timeout=timeout, name=name,
              labels={'app': 'dge-tagger', 'lane': name})
open('hf-job-id', 'w').write(job.id)
deadline = time.time() + float(os.environ.get('FOLLOW_HOURS', '5.25')) * 3600
print(f'job {job.id} on {flavor}: https://huggingface.co/jobs/{user}/{job.id}', flush=True)
while True:
    try:
        for line in fetch_job_logs(job_id=job.id, follow=True):
            print(line, flush=True)
            if time.time() > deadline: break
    except Exception as e:
        print(f'(log stream interrupted: {e})', flush=True)
    stage = inspect_job(job_id=job.id).status.stage
    if stage not in ('RUNNING', 'SCHEDULING'): break
    if time.time() > deadline:
        open('hf-job-detached', 'w').write(job.id)
        print(f'job {job.id} still {stage}; no longer following it here (runner time limit). It uploads its own results.')
        sys.exit(0)
    time.sleep(30)
print(f'job {job.id} finished: {stage}')
sys.exit(0 if stage == 'COMPLETED' else 1)
