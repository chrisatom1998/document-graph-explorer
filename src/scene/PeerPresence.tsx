import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useCollabStore } from '../collab/store';
import { positionBuffer, scaleOfSlot, slotOfId } from './positionBuffer';

function peerColor(id: string): string {
  const numeric = Array.from(id).reduce((total, ch) => total + ch.charCodeAt(0), 0);
  const hue = numeric % 360;
  return `hsl(${hue}, 82%, 66%)`;
}

function PeerMarker({ peerId, selectedId, displayName }: { peerId: string; selectedId: string | null; displayName?: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const color = useMemo(() => new THREE.Color(peerColor(peerId)), [peerId]);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh || !selectedId) return;
    const slot = slotOfId.get(selectedId);
    if (slot === undefined || slot >= positionBuffer.count) {
      group.visible = false;
      return;
    }
    const idx = slot * 3;
    const arr = positionBuffer.array;
    group.visible = true;
    group.position.set(arr[idx], arr[idx + 1], arr[idx + 2]);
    group.quaternion.copy(camera.quaternion);
    const baseScale = scaleOfSlot[slot] || 1.1;
    mesh.scale.setScalar(baseScale * 2.4);
  });

  if (!selectedId) return null;

  const slot = slotOfId.get(selectedId);
  if (slot === undefined || slot >= positionBuffer.count) return null;

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef} frustumCulled={false} renderOrder={10}>
        <torusGeometry args={[1.1, 0.08, 10, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} />
      </mesh>
      {displayName && (
        <Html position={[0, 2.4, 0]} center distanceFactor={18} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              whiteSpace: 'nowrap',
              fontSize: 10,
              lineHeight: 1.1,
              padding: '2px 6px',
              borderRadius: 999,
              background: 'rgba(11, 13, 24, 0.7)',
              border: `1px solid ${color.getStyle()}`,
              color: '#f5f7ff',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            {displayName}
          </div>
        </Html>
      )}
    </group>
  );
}

export default function PeerPresence() {
  const peers = useCollabStore((s) => s.peers);
  const session = useCollabStore((s) => s.session);
  const myClientId = session?.provider?.awareness.clientID;

  return (
    <>
      {Object.values(peers)
        .filter((peer) => String(peer.id) !== String(myClientId))
        .map((peer) => (
          <PeerMarker key={peer.id} peerId={peer.id} selectedId={peer.selectedId ?? null} displayName={peer.displayName} />
        ))}
    </>
  );
}
