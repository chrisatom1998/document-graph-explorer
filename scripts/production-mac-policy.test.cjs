const test = require('node:test');
const assert = require('node:assert/strict');
const {validateEvent, assertComplete, pointerStatus, pointerBody, ASSETS} = require('./production-mac-policy.cjs');
const valid = () => ({repository:{full_name:'chrisatom1998/document-graph-explorer',private:false},
  deployment:{environment:'Production',production_environment:false,creator:{id:35613825},sha:'a'.repeat(40),id:1},
  deployment_status:{environment:'Production',state:'success',creator:{id:35613825},id:2,
    environment_url:'https://document-graph-explorer-abc123-chris-s-projects-f12cde19.vercel.app'}});
test('accepts observed Vercel Production payload despite false boolean and SHA ref', () => {
  assert.equal(validateEvent(valid()).tag, `mac-${'a'.repeat(40)}`);
});
for (const [name, mutate] of [
  ['preview', e => e.deployment.environment = 'Preview'],
  ['failed', e => e.deployment_status.state = 'failure'],
  ['spoofed deployment', e => e.deployment.creator.id = 1],
  ['spoofed status', e => e.deployment_status.creator.id = 1],
  ['another repository', e => e.repository.full_name = 'other/repo'],
  ['private repository costs', e => e.repository.private = true],
  ['another Vercel project', e => e.deployment_status.environment_url = 'https://other.vercel.app'],
  ['injected SHA', e => e.deployment.sha = 'main; echo unsafe'],
  ['status injection', e => e.deployment_status.id = '2\nINJECT=true'],
]) test(`rejects ${name}`, () => { const e = valid(); mutate(e); assert.throws(() => validateEvent(e)); });
test('requires both complete architectures and metadata', () => {
  const assets = ASSETS.map(name => ({name,state:'uploaded',size:12}));
  assertComplete(assets);
  assert.throws(() => assertComplete(assets.slice(1)));
  assert.throws(() => assertComplete([...assets,assets[0]]));
  assets[0].size = 2**31; assert.throws(() => assertComplete(assets));
});
test('stable landing carries monotonic status and immutable architecture URLs', () => {
  const meta = validateEvent(valid()); const body = pointerBody(meta);
  assert.equal(pointerStatus(body), 2); assert.equal(pointerStatus(''), 0);
  assert.ok(body.includes(`/releases/download/${meta.tag}/${ASSETS[0]}`));
  assert.ok(body.includes(`/releases/download/${meta.tag}/${ASSETS[1]}`));
});
test('rollback ordering uses status event, not source SHA or deployment ID', () => {
  const event = valid();
  const oldPointer = pointerBody({...validateEvent(event),statusId:900});
  event.deployment.sha = '0'.repeat(40);
  event.deployment.id = 1;
  event.deployment_status.id = 901;
  const rollback = validateEvent(event);
  assert.ok(rollback.statusId > pointerStatus(oldPointer));
  assert.equal(rollback.sha, '0'.repeat(40));
  assert.ok(pointerStatus(pointerBody(rollback)) > 900);
});

const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const workflow = readFileSync(join(__dirname, '../.github/workflows/production-mac.yml'), 'utf8');
function workflowScript(stepName) {
  const step = workflow.split(`      - name: ${stepName}\n`)[1];
  assert.ok(step, `Missing workflow step: ${stepName}`);
  const block = step.split('          script: |\n')[1];
  const lines = [];
  for (const line of block.split('\n')) {
    if (line && !line.startsWith('            ')) break;
    lines.push(line.slice(12));
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction('require', 'github', 'context', 'core', 'process', lines.join('\n'));
}
function releaseApi(releases = []) {
  const writes = [];
  const api = {
    listReleases: async () => { throw new Error('Use pagination'); },
    getReleaseByTag: async ({tag}) => {
      const release = releases.find(r => r.tag_name === tag && !r.draft);
      if (!release) throw Object.assign(new Error('Not found'), {status:404});
      return {data:release};
    },
    getRelease: async ({release_id}) => {
      const release = releases.find(r => r.id === release_id);
      if (!release) throw Object.assign(new Error('Not found'), {status:404});
      return {data:release};
    },
    createRelease: async fields => {
      const release = {id:releases.length + 100, assets:[], ...fields};
      writes.push(['create', fields]); releases.push(release); return {data:release};
    },
    updateRelease: async fields => {
      writes.push(['update', fields]);
      return {data:Object.assign(releases.find(r => r.id === fields.release_id), fields)};
    },
  };
  const outputs = {};
  return {
    github: {rest:{repos:api}, paginate:async (method, options) => {
      assert.equal(method, api.listReleases); assert.equal(options.per_page, 100);
      return releases;
    }},
    context:{repo:{owner:'chrisatom1998',repo:'document-graph-explorer'},payload:valid()},
    core:{setOutput:(name,value) => outputs[name] = value,notice:() => {},
      summary:{addLink:() => ({write:async () => {}})}},
    outputs, writes, releases,
  };
}
const workflowRequire = () => require('./production-mac-policy.cjs');
const prepareScript = workflowScript('Prepare private draft release');
const publishScript = workflowScript('Publish complete release and atomically replace download links');
const completeAssets = () => ASSETS.map(name => ({name,state:'uploaded',size:12}));
test('prepare reuses an existing draft even when tag lookup excludes it', async () => {
  const draft = {id:42,tag_name:validateEvent(valid()).tag,draft:true,assets:[]};
  const mock = releaseApi([{id:1,tag_name:'unrelated',draft:false},draft]);
  await prepareScript(workflowRequire,mock.github,mock.context,mock.core,{env:{}});
  assert.equal(mock.writes.length,0);
  assert.equal(mock.outputs.release_id,'42');
  assert.equal(mock.outputs.build,'true');
});
test('prepare creates a missing draft and passes its stable release ID', async () => {
  const mock = releaseApi();
  await prepareScript(workflowRequire,mock.github,mock.context,mock.core,{env:{}});
  assert.equal(mock.writes.length,1);
  assert.equal(mock.writes[0][1].draft,true);
  assert.equal(mock.outputs.release_id,'100');
});
test('publish reads complete draft by ID before updating both download links', async () => {
  const draft = {id:42,tag_name:validateEvent(valid()).tag,draft:true,assets:completeAssets()};
  const mock = releaseApi([draft]);
  await publishScript(workflowRequire,mock.github,mock.context,mock.core,{env:{RELEASE_ID:'42'}});
  assert.equal(mock.writes.length,2);
  assert.equal(mock.writes[0][1].release_id,42);
  assert.equal(mock.writes[0][1].draft,false);
  assert.equal(mock.writes[1][1].tag_name,'mac-downloads');
});
test('publish rejects incomplete drafts and mismatched release IDs without writes', async () => {
  for (const release of [
    {id:42,tag_name:validateEvent(valid()).tag,draft:true,assets:[]},
    {id:42,tag_name:'wrong-tag',draft:true,assets:completeAssets()},
  ]) {
    const mock = releaseApi([release]);
    await assert.rejects(publishScript(workflowRequire,mock.github,mock.context,mock.core,{env:{RELEASE_ID:'42'}}));
    assert.equal(mock.writes.length,0);
  }
});
