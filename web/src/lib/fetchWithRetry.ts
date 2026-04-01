/**
 * Retry wrapper con backoff para llamadas a Supabase.
 * Reintenta automáticamente en errores de timeout o red,
 * pero NO en errores de auth o lógica.
 */

const RETRY_DELAYS = [3000, 5000]; // 3s after 1st fail, 5s after 2nd

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("statement canceled") ||
    lower.includes("canceling statement") ||
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("socket") ||
    lower.includes("abort") ||
    lower.includes("failed to fetch") ||
    lower.includes("load failed")
  );
}

export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options?: {
    onRetry?: (attempt: number) => void;
  },
): Promise<T> {
  const maxAttempts = RETRY_DELAYS.length + 1; // 3 total

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts && isRetryableError(err)) {
        options?.onRetry?.(attempt);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}
