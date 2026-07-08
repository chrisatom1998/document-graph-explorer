declare module 'd3-force-3d' {
  export interface SimNode {
    id?: string;
    index?: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
    [key: string]: unknown;
  }

  export interface SimLink<N = SimNode> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
    [key: string]: unknown;
  }

  export interface Force<N = SimNode> {
    (alpha: number): void;
    initialize?(nodes: N[], random?: () => number, nDim?: number): void;
  }

  export interface Simulation<N extends SimNode = SimNode> {
    tick(iterations?: number): this;
    restart(): this;
    stop(): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    numDimensions(): number;
    numDimensions(n: 1 | 2 | 3): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    on(typenames: string, listener: ((this: this) => void) | null): this;
  }

  export function forceSimulation<N extends SimNode = SimNode>(
    nodes?: N[],
    numDimensions?: 1 | 2 | 3,
  ): Simulation<N>;

  export interface LinkForce<N = SimNode> extends Force<N> {
    links(): SimLink<N>[];
    links(links: SimLink<N>[]): this;
    id(fn: (node: N) => string): this;
    distance(fn: number | ((link: SimLink<N>) => number)): this;
    strength(fn: number | ((link: SimLink<N>) => number)): this;
  }
  export function forceLink<N = SimNode>(links?: SimLink<N>[]): LinkForce<N>;

  export interface ManyBodyForce<N = SimNode> extends Force<N> {
    strength(s: number | ((node: N) => number)): this;
    distanceMax(d: number): this;
    distanceMin(d: number): this;
    theta(t: number): this;
  }
  export function forceManyBody<N = SimNode>(): ManyBodyForce<N>;

  export interface CenterForce<N = SimNode> extends Force<N> {
    strength(s: number): this;
  }
  export function forceCenter<N = SimNode>(x?: number, y?: number, z?: number): CenterForce<N>;

  export interface CollideForce<N = SimNode> extends Force<N> {
    radius(r: number | ((node: N) => number)): this;
    strength(s: number): this;
  }
  export function forceCollide<N = SimNode>(radius?: number): CollideForce<N>;

  export interface RadialForce<N = SimNode> extends Force<N> {
    radius(r: number | ((node: N) => number)): this;
    strength(s: number | ((node: N) => number)): this;
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
  }
  export function forceRadial<N = SimNode>(
    radius: number | ((node: N) => number),
    x?: number,
    y?: number,
    z?: number,
  ): RadialForce<N>;
}
