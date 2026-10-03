// Small supervised heads over frozen CLAP embeddings. No model guesses are labels.
export function normalize(vector) {
  if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) throw new Error('Invalid embedding');
  const norm = Math.hypot(...vector);
  if (norm < 1e-10) throw new Error('Empty embedding');
  return vector.map(value => value / norm);
}

const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, value))));
export function predict(head, vector) {
  const x = normalize(vector);
  if (x.length !== head.weights.length) throw new Error('Embedding dimensions do not match');
  return sigmoid(head.bias + x.reduce((sum, value, i) => sum + value * head.weights[i], 0));
}

export function trainBinary(rows, label, { epochs = 1000, regularization = 0.01 } = {}) {
  const labeled = rows.filter(row => row.targets[label] === 0 || row.targets[label] === 1);
  const positives = labeled.filter(row => row.targets[label] === 1).length;
  const negatives = labeled.length - positives;
  if (!positives || !negatives) return null;
  const vectors = labeled.map(row => normalize(row.vector));
  const dimensions = vectors[0].length;
  if (vectors.some(vector => vector.length !== dimensions)) throw new Error('Inconsistent embedding dimensions');
  const weights = Array(dimensions).fill(0);
  let bias = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = weights.map(weight => regularization * weight);
    let biasGradient = 0;
    for (let index = 0; index < labeled.length; index++) {
      const y = labeled[index].targets[label];
      const x = vectors[index];
      const prediction = sigmoid(bias + x.reduce((sum, value, i) => sum + value * weights[i], 0));
      const error = (prediction - y) / (2 * (y ? positives : negatives));
      biasGradient += error;
      for (let i = 0; i < dimensions; i++) gradient[i] += error * x[i];
    }
    const rate = 1 / (1 + epoch / 500);
    for (let i = 0; i < dimensions; i++) weights[i] -= rate * gradient[i];
    bias -= rate * biasGradient;
  }
  return { label, weights, bias, positives, negatives, threshold: 0.5 };
}

export function evaluateByFamily(rows, labels) {
  const report = {};
  for (const label of labels) {
    const results = [];
    const skipped = [];
    for (const family of new Set(rows.map(row => row.family))) {
      const training = rows.filter(row => row.family !== family);
      const testing = rows.filter(row => row.family === family && row.targets[label] !== undefined);
      if (!testing.length) continue;
      const head = trainBinary(training, label);
      if (!head) { skipped.push(...testing.map(row => row.path)); continue; }
      for (const row of testing) {
        const score = predict(head, row.vector);
        results.push({ path: row.path, expected: row.targets[label], predicted: Number(score >= head.threshold), score });
      }
    }
    const tp = results.filter(row => row.expected === 1 && row.predicted === 1).length;
    const fp = results.filter(row => row.expected === 0 && row.predicted === 1).length;
    const fn = results.filter(row => row.expected === 1 && row.predicted === 0).length;
    report[label] = {
      tested: results.length, skipped, positiveTests: tp + fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      // Missing positive folds must never be reported as perfect accuracy.
      complete: skipped.length === 0 && tp + fn > 0,
      mistakes: results.filter(row => row.expected !== row.predicted), results,
    };
  }
  return report;
}
