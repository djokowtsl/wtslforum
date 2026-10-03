export function spoilerMarkupError(text: string) {
  if (/\|\|\s*\|\|/.test(text)) return 'Spoiler markers must contain text.';
  for (const line of text.split(/\r?\n/)) {
    if ((line.match(/\|\|/g) || []).length % 2 !== 0) {
      return 'Spoiler markers must be paired on the same line.';
    }
  }
  return null;
}