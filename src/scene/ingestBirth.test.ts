import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_NODES } from '../config';
import {
  beginIngestBirth,
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
  setRunIngestOrigin,
  snapshotIngestOrigin,
  travelProgress,
  writeSlotTravelPosition,
} from './ingestBirth';
import {
  hasOriginOfSlot,
  originOfSlot,
  positionBuffer,
  resetPositionBuffer,
  spawnAtOfSlot,
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
    setRunIngestOrigin(null);
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
    originOfSlot[0] = 1;
    originOfSlot[1] = 2;
    originOfSlot[2] = 3;
    hasOriginOfSlot[0] = 1;
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

  it('computes an eased fit-all pose around the growing set', () => {
    const array = new Float32Array([-10, 0, 0, 10, 0, 0]);
    const poseFit = computeFitAllPose({
      array,
      count: 2,
      viewDir: [0, 0, 1],
      fovDeg: 55,
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
      slots: [0, 1], // the far outlier at slot 2 must not widen the frame
    });
    expect(poseFit.target[0]).toBeCloseTo(0, 5);
    expect(poseFit.radius).toBeCloseTo(10, 5);
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
  it('keeps origin buffers sized for MAX_NODES', () => {
    expect(originOfSlot.length).toBe(MAX_NODES * 3);
    expect(hasOriginOfSlot.length).toBe(MAX_NODES);
  });
});
