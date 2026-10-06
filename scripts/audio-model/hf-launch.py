"""Start scripts/audio-model/hf-job.sh on Hugging Face Jobs, stream its log into this one, and fail if the job fails.

Usage: HF_TOKEN=... python3 scripts/audio-model/hf-launch.py <flavor> <timeout> KEY=VALUE...   (env passed to the job)
"""
import os, sys, time
from huggingface_hub import cancel_job, fetch_job_logs, inspect_job, list_jobs, run_job, whoami

flavor, timeout, *pairs = sys.argv[1:]
env = dict(p.split('=', 1) for p in pairs)
user = whoami()['name']; env.setdefault('HF_REPO', f'{user}/dge-instrument-tagger')
# One tagger run at a time: a run this workflow started and then lost (a cancelled workflow) is stopped first.
for old in list_jobs(status=['RUNNING', 'SCHEDULING']):
    if getattr(old, 'name', None) == 'dge-instrument-tagger' or (getattr(old, 'labels', None) or {}).get('app') == 'dge-tagger':
        print(f'cancelling earlier tagger job {old.id}', flush=True); cancel_job(job_id=old.id)
script = open(os.path.join(os.path.dirname(__file__), 'hf-job.sh')).read()
job = run_job(image='pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime', command=['bash', '-c', script], env=env,
              secrets={'HF_TOKEN': os.environ['HF_TOKEN']}, flavor=flavor, timeout=timeout, name='dge-instrument-tagger',
              labels={'app': 'dge-tagger'})
open('hf-job-id', 'w').write(job.id)
print(f'job {job.id} on {flavor}: https://huggingface.co/jobs/{user}/{job.id}', flush=True)
while True:
    try:
        for line in fetch_job_logs(job_id=job.id, follow=True): print(line, flush=True)
    except Exception as e:
        print(f'(log stream interrupted: {e})', flush=True)
    stage = inspect_job(job_id=job.id).status.stage
    if stage not in ('RUNNING', 'SCHEDULING'): break
    time.sleep(30)
print(f'job {job.id} finished: {stage}')
sys.exit(0 if stage == 'COMPLETED' else 1)
