export type LiveData<T> = { data: T; unavailable: boolean };

/** A failed feed is unavailable, not a successfully loaded empty board. */
export async function readLiveData<T>(load: () => Promise<T>, empty: T): Promise<LiveData<T>> {
  try {
    return { data: await load(), unavailable: false };
  } catch (error) {
    console.error('[wtsl] Live data unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return { data: empty, unavailable: true };
  }
}
