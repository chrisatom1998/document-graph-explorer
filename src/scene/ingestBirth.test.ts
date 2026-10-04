import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INITIAL_NODE_CAPACITY, MAX_NODES } from '../config';
import {
  beginIngestBirth,
  clearIngestBirthSteer,
  clearPendingOrigin,
  clientToNdc,
  computeFitAllPose,
  decideIngestCamera,
  displayTravelPosition,
  easeOutBack,
  edgeKey,
  edgeRevealFactor,
  endIngestBirth,
  interpolateTravel,
  isIngestFraming,
  MATERIALIZE_MS,
  MATERIALIZE_MS_FLAT,
  noteIngestCameraSteer,
  projectNdcToGraphPlane,
  rememberCenterOrigin,
  rememberDropOrigin,
  rememberWorldOrigin,
  resolveIngestOrigin,
  snapshotIngestOrigin,
  travelProgress,
  wasIngestBirthSteered,
  writeSlotTravelPosition,
} from './ingestBirth';
import {
  ensureSlotCapacity,
  positionBuffer,
  resetPositionBuffer,
  slotMeta,
  spawnAtOfSlot,
  subscribeSlotCapacity,
} from './positionBuffer';

const pose = {
  px: 0,
  py: 0,
  pz: 160,
  tx: 0,
  ty: 0,
  tz: 0,
  fov: 55,
  aspect: 16 / 9,
};

describe('ingest origin', () => {
  afterEach(() => {
    clearPendingOrigin();
  });

  it('projects canvas-center NDC onto the graph plane at the orbit target', () => {
    const [x, y, z] = projectNdcToGraphPlane(0, 0, pose);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('projects a drop in the upper-right onto a point offset from the target', () => {
    const [x, y, z] = projectNdcToGraphPlane(0.6, 0.4, pose);
    expect(z).toBeCloseTo(0, 4);
    expect(x).toBeGreaterThan(20);
    expect(y).toBeGreaterThan(10);
  });

  it('converts client pixels to NDC against a canvas rect', () => {
    const ndc = clientToNdc(150, 50, { left: 100, top: 0, width: 200, height: 100 });
    expect(ndc.ndcX).toBeCloseTo(-0.5, 5);
    expect(ndc.ndcY).toBeCloseTo(0, 5);
  });

  it('resolves a recorded drop through the live camera pose', () => {
    rememberDropOrigin(200, 100);
    const point = resolveIngestOrigin({
      pose,
      rect: { left: 0, top: 0, width: 400, height: 200 },
    });
    expect(point[0]).toBeCloseTo(0, 4);
    expect(point[1]).toBeCloseTo(0, 4);
    expect(point[2]).toBeCloseTo(0, 4);
  });

  it('flattens origin z on the 2D ladder', () => {
    rememberWorldOrigin([4, 5, 9]);
    expect(resolveIngestOrigin({ pose, flat: true })).toEqual([4, 5, 0]);
  });

  it('snapshots the pending origin for the ingest run', () => {
    rememberCenterOrigin();
    const snapped = snapshotIngestOrigin({ pose, rect: { left: 0, top: 0, width: 100, height: 100 } });
    expect(snapped[2]).toBeCloseTo(0, 4);
  });
});

describe('origin spawn → home slot', () => {
  it('easeOutBack starts at 0 and ends at 1 with a brief overshoot', () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 5);
    expect(easeOutBack(1)).toBeCloseTo(1, 5);
    expect(easeOutBack(0.85)).toBeGreaterThan(1);
  });

  it('stays at the drop origin at t=0 and arrives at the home slot at t=1', () => {
    const origin: [number, number, number] = [2, -3, 1];
    const home: [number, number, number] = [20, 8, -4];
    const start = interpolateTravel(origin, home, 0, false);
    expect(start[0]).toBeCloseTo(origin[0], 5);
    expect(start[1]).toBeCloseTo(origin[1], 5);
    expect(start[2]).toBeCloseTo(origin[2], 5);
    const arrived = interpolateTravel(origin, home, 1, false);
    expect(arrived[0]).toBeCloseTo(home[0], 5);
    expect(arrived[1]).toBeCloseTo(home[1], 5);
    expect(arrived[2]).toBeCloseTo(home[2], 5);
  });

  it('is mid-flight at the halfway mark (not still at origin, not yet home)', () => {
    const origin: [number, number, number] = [0, 0, 0];
    const home: [number, number, number] = [10, 0, 0];
    const mid = displayTravelPosition({
      origin,
      home,
      spawnAt: 0,
      now: MATERIALIZE_MS / 2,
      reducedMotion: false,
      flat: false,
    });
    expect(mid[0]).toBeGreaterThan(2);
    expect(mid[0]).not.toBeCloseTo(10, 1);
    expect(travelProgress(MATERIALIZE_MS / 2, 0, MATERIALIZE_MS)).toBeCloseTo(0.5, 5);
  });

  it('uses a short 2D slide and keeps z on the map plane', () => {
    const pos = displayTravelPosition({
      origin: [0, 0, 8],
      home: [12, 4, 3],
      spawnAt: 0,
      now: MATERIALIZE_MS_FLAT / 2,
      reducedMotion: false,
      flat: true,
    });
    expect(pos[2]).toBe(0);
    expect(pos[0]).toBeGreaterThan(2);
    expect(pos[0]).not.toBeCloseTo(0, 1);
  });

  it('writes slot travel from the recorded origin toward the layout home', () => {
    resetPositionBuffer();
    positionBuffer.array = new Float32Array([30, 10, -6]);
    positionBuffer.count = 1;
    slotMeta.origin[0] = 1;
    slotMeta.origin[1] = 2;
    slotMeta.origin[2] = 3;
    slotMeta.hasOrigin[0] = 1;
    spawnAtOfSlot[0] = 1000;
    const out = { x: 0, y: 0, z: 0 };
    const animating = writeSlotTravelPosition(out, 0, 1000, { reducedMotion: false, flat: false });
    expect(animating).toBe(true);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.y).toBeCloseTo(2, 5);
    expect(out.z).toBeCloseTo(3, 5);

    writeSlotTravelPosition(out, 0, 1000 + MATERIALIZE_MS, { reducedMotion: false, flat: false });
    expect(out.x).toBeCloseTo(30, 5);
    expect(out.y).toBeCloseTo(10, 5);
    expect(out.z).toBeCloseTo(-6, 5);
    resetPositionBuffer();
  });
});

describe('reduced-motion skip', () => {
  it('places the node at rest on the home slot with no travel', () => {
    const home: [number, number, number] = [14, -2, 5];
    expect(
      displayTravelPosition({
        origin: [0, 0, 0],
        home,
        spawnAt: 0,
        now: 10,
        reducedMotion: true,
        flat: false,
      }),
    ).toEqual(home);
  });

  it('still flattens z when reduced-motion lands on the 2D ladder', () => {
    expect(
      displayTravelPosition({
        origin: [0, 0, 9],
        home: [4, 5, 7],
        spawnAt: 0,
        now: 10,
        reducedMotion: true,
        flat: true,
      }),
    ).toEqual([4, 5, 0]);
  });
});

describe('ingest camera — do not steal on incremental add', () => {
  beforeEach(() => {
    endIngestBirth();
  });

  it('follows (eased fit-all) on the first ingest of an empty corpus', () => {
    expect(
      decideIngestCamera({ corpusWasEmpty: true, userSteered: false, reducedMotion: false }),
    ).toBe('follow');
  });

  it('snaps to fit-all under reduced motion on a first ingest', () => {
    expect(
      decideIngestCamera({ corpusWasEmpty: true, userSteered: false, reducedMotion: true }),
    ).toBe('snap');
  });

  it('leaves the camera alone when files are added to an existing corpus', () => {
    expect(
      decideIngestCamera({ corpusWasEmpty: false, userSteered: false, reducedMotion: false }),
    ).toBe('leave');
    beginIngestBirth({ corpusWasEmpty: false, reducedMotion: false });
    expect(isIngestFraming()).toBe(false);
  });

  it('stops following if the user steers during a first ingest', () => {
    beginIngestBirth({ corpusWasEmpty: true, reducedMotion: false });
    expect(isIngestFraming()).toBe(true);
    noteIngestCameraSteer();
    expect(isIngestFraming()).toBe(false);
    expect(
      decideIngestCamera({ corpusWasEmpty: true, userSteered: true, reducedMotion: false }),
    ).toBe('leave');
  });

  it('remembers a mid-birth steer past endIngestBirth for the settle handler', () => {
    beginIngestBirth({ corpusWasEmpty: true, reducedMotion: false });
    noteIngestCameraSteer();
    expect(wasIngestBirthSteered()).toBe(true);
    expect(endIngestBirth().shouldFinalFit).toBe(false);
    // Still set after the run so the ready-state settle can honor the steer
    expect(wasIngestBirthSteered()).toBe(true);
    clearIngestBirthSteer();
    expect(wasIngestBirthSteered()).toBe(false);
  });

  it('scopes steer memory to birth runs — ordinary navigation never sets it', () => {
    clearIngestBirthSteer();
    noteIngestCameraSteer(); // post-ready orbit/pan, no birth active
    expect(wasIngestBirthSteered()).toBe(false);
    // and a new birth run starts with a clean slate
    beginIngestBirth({ corpusWasEmpty: true, reducedMotion: false });
    expect(wasIngestBirthSteered()).toBe(false);
    expect(endIngestBirth().shouldFinalFit).toBe(true);
  });

  it('computes an eased fit-all pose around the growing set', () => {
    const array = new Float32Array([-10, 0, 0, 10, 0, 0]);
    const poseFit = computeFitAllPose({
      array,
      count: 2,
      viewDir: [0, 0, 1],
      fovDeg: 55,
      aspect: 1,
    });
    expect(poseFit.target[0]).toBeCloseTo(0, 5);
    expect(poseFit.radius).toBeCloseTo(10, 5);
    expect(poseFit.position[2]).toBeGreaterThanOrEqual(40);
  });

  it('restricts the fit to an explicit slot set (frameSet)', () => {
    const array = new Float32Array([-10, 0, 0, 10, 0, 0, 500, 0, 0]);
    const poseFit = computeFitAllPose({
      array,
      count: 3,
      viewDir: [0, 0, 1],
      fovDeg: 55,
      aspect: 1,
      slots: [0, 1], // the far outlier at slot 2 must not widen the frame
    });
    expect(poseFit.target[0]).toBeCloseTo(0, 5);
    expect(poseFit.radius).toBeCloseTo(10, 5);
  });

  it.each([390 / 844, 1, 16 / 9])('keeps node bounds in the viewport at aspect %s', (aspect) => {
    const positions = [
      new THREE.Vector3(-100, 0, 0),
      new THREE.Vector3(100, 0, 0),
      new THREE.Vector3(0, 100, 0),
      new THREE.Vector3(0, -100, 0),
      new THREE.Vector3(0, 0, 100),
    ];
    const fit = computeFitAllPose({
      array: positions.flatMap((position) => position.toArray()),
      count: positions.length,
      viewDir: [0.2, 0.1, 1],
      fovDeg: 55,
      aspect,
    });
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 4000);
    camera.position.fromArray(fit.position);
    camera.lookAt(new THREE.Vector3().fromArray(fit.target));
    camera.updateMatrixWorld();
    for (const center of positions) {
      for (const offset of [
        [3.5, 0, 0], [-3.5, 0, 0], [0, 3.5, 0],
        [0, -3.5, 0], [0, 0, 3.5], [0, 0, -3.5],
      ]) {
        const projected = center.clone().add(new THREE.Vector3().fromArray(offset)).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(Math.abs(projected.z)).toBeLessThan(1);
      }
    }
  });

  it('fits an explicit portrait selection without framing unrelated outliers', () => {
    const aspect = 390 / 844;
    const fit = computeFitAllPose({
      array: [-100, 0, 0, 100, 0, 0, 10000, 0, 0],
      count: 3,
      slots: [0, 1],
      viewDir: [0, 0, 1],
      fovDeg: 55,
      aspect,
    });
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 4000);
    camera.position.fromArray(fit.position);
    camera.lookAt(new THREE.Vector3().fromArray(fit.target));
    camera.updateMatrixWorld();
    expect(fit.target).toEqual([0, 0, 0]);
    for (const x of [-103.5, 103.5]) {
      expect(Math.abs(new THREE.Vector3(x, 0, 0).project(camera).x)).toBeLessThan(1);
    }
    expect(new THREE.Vector3(10000, 0, 0).project(camera).x).toBeGreaterThan(1);
  });
});

describe('edges appear only after both nodes exist', () => {
  it('stays hidden while either endpoint is missing', () => {
    expect(
      edgeRevealFactor({
        bothEndpointsExist: false,
        appearAt: undefined,
        now: 100,
        reducedMotion: false,
      }),
    ).toEqual({ factor: 0, appearAt: undefined });
  });

  it('fades in after both endpoints exist', () => {
    const start = edgeRevealFactor({
      bothEndpointsExist: true,
      appearAt: undefined,
      now: 200,
      reducedMotion: false,
      duration: 400,
    });
    expect(start.appearAt).toBe(200);
    expect(start.factor).toBe(0);

    const mid = edgeRevealFactor({
      bothEndpointsExist: true,
      appearAt: 200,
      now: 400,
      reducedMotion: false,
      duration: 400,
    });
    expect(mid.factor).toBeCloseTo(0.5, 5);

    const done = edgeRevealFactor({
      bothEndpointsExist: true,
      appearAt: 200,
      now: 600,
      reducedMotion: false,
      duration: 400,
    });
    expect(done.factor).toBe(1);
  });

  it('skips the fade under reduced motion once both endpoints exist', () => {
    expect(
      edgeRevealFactor({
        bothEndpointsExist: true,
        appearAt: undefined,
        now: 50,
        reducedMotion: true,
      }).factor,
    ).toBe(1);
  });

  it('keys an edge independently of endpoint order', () => {
    expect(edgeKey('a', 'b', 'semantic')).toBe(edgeKey('b', 'a', 'semantic'));
    expect(edgeKey('a', 'b', 'semantic')).not.toBe(edgeKey('a', 'b', 'keyword'));
  });
});

describe('slot metadata capacity', () => {
  afterEach(() => {
    resetPositionBuffer();
  });

  it('starts at INITIAL_NODE_CAPACITY and grows on demand, preserving contents', () => {
    expect(slotMeta.capacity).toBe(INITIAL_NODE_CAPACITY);
    expect(slotMeta.origin.length).toBe(INITIAL_NODE_CAPACITY * 3);
    expect(slotMeta.hasOrigin.length).toBe(INITIAL_NODE_CAPACITY);
    slotMeta.origin[0] = 7;
    slotMeta.hasOrigin[0] = 1;
    slotMeta.kind[1] = 1;
    slotMeta.ghost[2] = 1;
    ensureSlotCapacity(INITIAL_NODE_CAPACITY + 1);
    expect(slotMeta.capacity).toBe(INITIAL_NODE_CAPACITY + 1);
    expect(slotMeta.origin.length).toBe((INITIAL_NODE_CAPACITY + 1) * 3);
    expect(slotMeta.origin[0]).toBe(7);
    expect(slotMeta.hasOrigin[0]).toBe(1);
    expect(slotMeta.kind[1]).toBe(1);
    expect(slotMeta.ghost[2]).toBe(1);
  });

  it('clamps growth at MAX_NODES and shrinks back to the initial capacity on reset', () => {
    ensureSlotCapacity(MAX_NODES * 2);
    expect(slotMeta.capacity).toBe(MAX_NODES);
    expect(slotMeta.origin.length).toBe(MAX_NODES * 3);
    resetPositionBuffer();
    expect(slotMeta.capacity).toBe(INITIAL_NODE_CAPACITY);
    expect(slotMeta.origin.length).toBe(INITIAL_NODE_CAPACITY * 3);
  });

  it('notifies capacity subscribers on growth only', () => {
    let calls = 0;
    const off = subscribeSlotCapacity(() => {
      calls++;
    });
    ensureSlotCapacity(INITIAL_NODE_CAPACITY + 1);
    expect(calls).toBe(1);
    ensureSlotCapacity(INITIAL_NODE_CAPACITY); // already covered — no-op
    expect(calls).toBe(1);
    resetPositionBuffer(); // shrink is a capacity change too
    expect(calls).toBe(2);
    off();
    ensureSlotCapacity(INITIAL_NODE_CAPACITY + 1);
    expect(calls).toBe(2);
  });
});
