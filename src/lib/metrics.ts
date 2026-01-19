type MetricTags = Record<string, string | number | boolean | null | undefined>;

export function logMetric(name: string, value: number, tags: MetricTags = {}) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const payload = {
    metric: name,
    value,
    ...tags,
    ts: new Date().toISOString(),
  };

  console.info(JSON.stringify(payload));
}
