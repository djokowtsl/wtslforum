export function isPresignedUrlRetrievalFailure(cause: unknown): boolean {
  const message = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : '';

  return /failed to retrieve the presigned url/i.test(message);
}
