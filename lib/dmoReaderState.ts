type MutableRef<T> = { current: T };

type DmoReaderState<T> = {
  parser: MutableRef<T | null>;
  activeFilename: MutableRef<string>;
  readBytes: MutableRef<number>;
  lastSentVersion: MutableRef<number>;
};

export function consumePendingDmoReaderReset<T>(
  pendingReset: MutableRef<boolean>,
  reader: DmoReaderState<T>,
): boolean {
  if (!pendingReset.current) return false;

  pendingReset.current = false;
  reader.parser.current = null;
  reader.activeFilename.current = '';
  reader.readBytes.current = 0;
  reader.lastSentVersion.current = -1;
  return true;
}
