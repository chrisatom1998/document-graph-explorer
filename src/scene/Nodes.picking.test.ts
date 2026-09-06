import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { useUiStore } from '../store/uiStore';
import { instancedSphereRaycast } from './Nodes';
import { idOfSlot, positionBuffer, resetPositionBuffer, scaleOfSlot, slotMeta } from './positionBuffer';

describe('document picking visibility', () => {
  const geometry = new THREE.SphereGeometry(1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));

  beforeEach(() => {
    resetPositionBuffer();
    positionBuffer.array = new Float32Array([0, 0, 0]);
    positionBuffer.count = 1;
    idOfSlot[0] = 'document';
    scaleOfSlot[0] = 1;
    useUiStore.setState({ clusterCollapsed: false, topicNodesEnabled: true, dims: 3 });
  });

  afterEach(() => {
    resetPositionBuffer();
    useUiStore.setState({ clusterCollapsed: false, topicNodesEnabled: false });
  });

  it('stops hits while collapsed and restores picking when expanded', () => {
    const visibleHits: THREE.Intersection[] = [];
    instancedSphereRaycast.call(mesh, ray, visibleHits);
    expect(visibleHits).toHaveLength(1);
    expect(visibleHits[0].instanceId).toBe(0);

    useUiStore.getState().setClusterCollapsed(true);
    const collapsedHits: THREE.Intersection[] = [];
    instancedSphereRaycast.call(mesh, ray, collapsedHits);
    expect(collapsedHits).toHaveLength(0);

    useUiStore.getState().setClusterCollapsed(false);
    const expandedHits: THREE.Intersection[] = [];
    instancedSphereRaycast.call(mesh, ray, expandedHits);
    expect(expandedHits).toHaveLength(1);
  });

  it('also excludes hidden topic nodes in collapsed mode', () => {
    slotMeta.kind[0] = 1;
    useUiStore.getState().setClusterCollapsed(true);
    const hits: THREE.Intersection[] = [];
    instancedSphereRaycast.call(mesh, ray, hits);
    expect(hits).toHaveLength(0);
  });
});
