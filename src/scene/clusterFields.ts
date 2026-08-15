export interface ClusterPoint {
  cluster: number;
  x: number;
  y: number;
  z: number;
}

export interface ClusterField {
  cluster: number;
  count: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

interface Accumulator {
  count: number;
  x: number;
  y: number;
  z: number;
  points: ClusterPoint[];
}

const MIN_RADIUS = 14;
const MAX_RADIUS = 92;

/**
 * Turns live node positions into stable, bounded cluster volumes. RMS spread
 * resists a single layout outlier while the population floor keeps compact
 * communities from collapsing into a pinprick.
 */
export function computeClusterFields(
  points: readonly ClusterPoint[],
  maxFields: number,
): ClusterField[] {
  if (maxFields <= 0) return [];

  const accumulators = new Map<number, Accumulator>();
  for (const point of points) {
    if (point.cluster < 0) continue;
    let acc = accumulators.get(point.cluster);
    if (!acc) {
      acc = { count: 0, x: 0, y: 0, z: 0, points: [] };
      accumulators.set(point.cluster, acc);
    }
    acc.count += 1;
    acc.x += point.x;
    acc.y += point.y;
    acc.z += point.z;
    acc.points.push(point);
  }

  return [...accumulators.entries()]
    .filter(([, acc]) => acc.count >= 2)
    .sort(([clusterA, a], [clusterB, b]) => b.count - a.count || clusterA - clusterB)
    .slice(0, maxFields)
    .map(([cluster, acc]) => {
      const x = acc.x / acc.count;
      const y = acc.y / acc.count;
      const z = acc.z / acc.count;
      let squaredDistance = 0;
      for (const point of acc.points) {
        const dx = point.x - x;
        const dy = point.y - y;
        const dz = point.z - z;
        squaredDistance += dx * dx + dy * dy + dz * dz;
      }
      const rmsSpread = Math.sqrt(squaredDistance / acc.count);
      const populationFloor = Math.sqrt(acc.count) * 3.2;
      const radius = Math.min(
        MAX_RADIUS,
        Math.max(MIN_RADIUS, rmsSpread * 1.65 + 8, populationFloor),
      );
      return { cluster, count: acc.count, x, y, z, radius };
    });
}
