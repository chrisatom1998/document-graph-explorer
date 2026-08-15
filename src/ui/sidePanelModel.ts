import type { DocNode, Edge } from '../model/types';

export interface ConnectionRow {
  edge: Edge;
  neighborId: string;
  neighbor: DocNode | undefined;
}

/** Connections shown before "Show all", and evidence lines shown per row. */
export const CONNECTIONS_COLLAPSED = 8;
export const EVIDENCE_COLLAPSED = 1;
