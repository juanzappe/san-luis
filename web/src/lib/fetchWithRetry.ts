/**
 * Retry wrapper con exponential backoff para llamadas a Supabase.
 * Reintenta automáticamente en errores de timeout o red,
 * pero NO en errores de auth o lógica.
 */

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
    lower.includes("abort")
  );
}

export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseDelay?: number;
    onRetry?: (attempt: number) => void;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelay = options?.baseDelay ?? 2000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts && isRetryableError(err)) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        options?.onRetry?.(attempt);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}
