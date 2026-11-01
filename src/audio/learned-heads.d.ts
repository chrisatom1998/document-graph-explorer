declare module 'virtual:learned-heads' {
  export const linear: Record<string, {
    group: 'source' | 'production' | 'character';
    label: string;
    weights: number[];
    bias: number;
    threshold: number;
    maybe?: boolean;
    oneShot?: boolean;
  }>;
  export const neighbours: Record<string, unknown>;
}
