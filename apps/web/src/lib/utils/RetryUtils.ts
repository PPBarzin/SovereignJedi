/**
 * Exponential backoff with jitter and retry count.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries: number;
    backoffMs: number;
    onRetry?: (attempt: number, error: any) => void;
  }
): Promise<T> {
  const { retries, backoffMs, onRetry } = options;
  let lastError: any = null;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        if (onRetry) onRetry(i + 1, err);
        const delay = backoffMs * Math.pow(3, i);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
