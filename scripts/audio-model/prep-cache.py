"""Cache each extra training source's prepared output (the run 7+ sources hf-job.sh builds in every job) in the private
dataset <user>/dge-tagger-data under prep-cache/src/<name>/<key>/, so a later job with the same inputs downloads it in a
minute or two instead of fetching, decoding and rendering it again (round 9: ~41 min; round 10 longer).

The key covers everything that decides the output: the prepare script and every local module or data file it uses (found
by scanning it, recursively), the arguments that change the output, and a content fingerprint of each private input (a
dataset folder's tree hash, a dataset file's hash, a bucket file's content hash). Change any of them and the source is
rebuilt and re-cached; the others still come from the cache.

Usage (hf-job.sh):
  prep-cache.py key <script> [--data <repo>:<folder or file>]... [--bucket-file <bucket>:<path>]... [--arg <text>]...
  prep-cache.py get <name> <key> <dir>        exit 0 and fill <dir> on a hit, exit 1 on a miss
  prep-cache.py put <todo file>               upload every "<name> <key> <dir>" line of <todo file> (after the preps)

Only what the job itself built goes up: training windows and the job's own held-out eval sets (the prep cache already
holds those for the base sources), into the same private repo. Judge sets and their names or hashes never reach a job.
"""
import ast, hashlib, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = 'prep-cache v1'
NAME = re.compile(r'[\w.-]+\.(?:py|json)')


def deps(script):
    """The script plus every file in this folder it imports or names as a string of its own, recursively."""
    seen, todo = [], [os.path.basename(script)]
    while todo:
        f = todo.pop()
        if f in seen or not os.path.isfile(os.path.join(HERE, f)): continue
        seen.append(f)
        if f.endswith('.py'):
            for n in ast.walk(ast.parse(open(os.path.join(HERE, f)).read())):
                if isinstance(n, ast.Import): todo += [a.name + '.py' for a in n.names]
                elif isinstance(n, ast.ImportFrom) and n.module: todo.append(n.module + '.py')
                elif isinstance(n, ast.Constant) and isinstance(n.value, str) and NAME.fullmatch(n.value): todo.append(n.value)
    return sorted(seen)


def key(argv):
    from huggingface_hub import HfApi, get_bucket_file_metadata
    script, rest = argv[0], argv[1:]
    h = hashlib.sha256(VERSION.encode())
    for f in deps(script):
        h.update(f.encode() + b'\0' + open(os.path.join(HERE, f), 'rb').read() + b'\0')
    api = HfApi()
    for kind, val in zip(rest[::2], rest[1::2]):
        h.update(f'{kind}={val}\0'.encode())
        if kind == '--data':   # "<repo>:<path>": a folder's tree hash or a file's content hash, from the Hub
            repo, path = val.split(':', 1)
            info = api.get_paths_info(repo, [path.strip('/')], repo_type='dataset')
            if not info: raise SystemExit(f'{val} not found')
            i = info[0]; fp = getattr(i, 'tree_id', None) or (i.lfs.sha256 if getattr(i, 'lfs', None) else i.blob_id)
        elif kind == '--bucket-file':   # "<bucket>:<path>": content hash of one file in a bucket
            bucket, path = val.split(':', 1)
            fp = get_bucket_file_metadata(bucket, path).xet_file_data.file_hash
        elif kind == '--arg': fp = ''
        else: raise SystemExit(f'unknown option {kind}')
        h.update(f'{fp}\0'.encode())
    print(h.hexdigest()[:16])


def repo():
    from huggingface_hub import HfApi
    return HfApi().whoami()['name'] + '/dge-tagger-data'


def get(name, k, out):
    from huggingface_hub import HfApi, snapshot_download
    api, r, base = HfApi(), repo(), f'prep-cache/src/{name}/{k}'
    if not api.file_exists(r, f'{base}/DONE', repo_type='dataset'): sys.exit(1)
    try:
        shutil.rmtree(f'cache-{name}', ignore_errors=True)   # never mix in files left by an earlier failed get
        snapshot_download(r, repo_type='dataset', allow_patterns=[f'{base}/*'], local_dir=f'cache-{name}', max_workers=16)
        shutil.rmtree(out, ignore_errors=True); shutil.move(f'cache-{name}/{base}', out); shutil.rmtree(f'cache-{name}', ignore_errors=True)
        os.remove(os.path.join(out, 'DONE'))
    except Exception as e:
        print(f'{name}: prep cache {k} unreadable ({e}); preparing from scratch', flush=True); shutil.rmtree(out, ignore_errors=True); sys.exit(1)


def put(todo):
    from huggingface_hub import HfApi
    api, r = HfApi(), repo(); api.create_repo(r, repo_type='dataset', private=True, exist_ok=True); failed = 0
    for line in open(todo).read().split('\n'):
        if not line.strip(): continue
        name, k, d = line.split()
        base = f'prep-cache/src/{name}/{k}'
        try:
            api.upload_folder(repo_id=r, repo_type='dataset', folder_path=d, path_in_repo=base, allow_patterns=['*.npy', '*.json', 'prep.log'], commit_message=f'Prepared {name} {k}')
            api.upload_file(path_or_fileobj=b'ok', path_in_repo=f'{base}/DONE', repo_id=r, repo_type='dataset', commit_message=f'Prepared {name} {k} complete')
            print(f'cached {name} at {r}/{base}', flush=True)
        except Exception as e:
            print(f'{name}: prep cache upload failed ({e}); the next job rebuilds it', flush=True); failed += 1
    if failed: sys.exit(1)


if __name__ == '__main__':
    cmd, *a = sys.argv[1:]
    if cmd == 'key': key(a)
    elif cmd == 'get': get(*a)
    elif cmd == 'put': put(*a)
    elif cmd == 'deps': print(' '.join(deps(a[0])))
    else: raise SystemExit(__doc__)
