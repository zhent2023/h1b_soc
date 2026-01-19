export function computeMagnitude(vec: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const value = vec[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denom > 0 ? dot / denom : 0;
}

export function topK(scores: number[], k: number, threshold: number) {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
