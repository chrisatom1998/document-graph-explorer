export interface TrainingRow { vector: number[]; targets: Record<string, number> }
export interface BinaryHead { label: string; weights: number[]; bias: number; positives: number; negatives: number; threshold: number }
export function trainBinary(rows: TrainingRow[], label: string, options?: {epochs?: number; regularization?: number}): BinaryHead | null;
export function predict(head: BinaryHead, vector: number[]): number;
