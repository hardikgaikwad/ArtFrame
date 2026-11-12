/** An error whose message is written for the artist and is safe to show as-is. */
export class UserFacingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UserFacingError';
  }
}

export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/** A plain-language message for any error; technical details only go to the console. */
export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) return error.message;
  if (isQuotaError(error)) {
    return 'There is no more space on this device for saved artworks. Delete some saved artworks and try again.';
  }
  console.error(error);
  return fallback;
}
