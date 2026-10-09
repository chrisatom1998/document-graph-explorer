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
