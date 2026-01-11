export async function fetchWithRetry(
  url: string,
  params?: { retries?: number; backoffMs?: number },
): Promise<Response> {
  const retries = params?.retries ?? 3;
  const backoffMs = params?.backoffMs ?? 1000;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return res;
      }
      lastResponse = res;
      lastError = new Error(`status=${res.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown fetch error');
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError ?? new Error('Fetch failed');
}
