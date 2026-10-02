export const BOT_RATING_METRICS = [
  {
    key: 'serve',
    label: 'Serve',
    sourceLabel: 'Serve (Overall)',
    components: ['1st Serve %', '1st Serve Won %', '2nd Serve Won %', 'Aces', 'Double Faults'],
    valueFormat: 'rating',
    direction: 'desc',
  },
  {
    key: 'return',
    label: 'Return',
    sourceLabel: 'Return (Overall)',
    components: ['1st Serve Return Points Won %', '2nd Serve Return Points Won %', 'Break Points Won %'],
    valueFormat: 'rating',
    direction: 'desc',
  },
  {
    key: 'pressure',
    label: 'Under Pressure',
    sourceLabel: 'Under Pressure',
    components: ['Break Points Won %', 'Break Points Saved %', 'Tie-breaks Won %', 'Deciding Sets Won %'],
    valueFormat: 'rating',
    direction: 'desc',
  },
] as const;

export type BotRating = typeof BOT_RATING_METRICS[number]['key'];