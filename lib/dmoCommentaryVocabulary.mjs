/**
 * Every word the commentary booth can say, taken from the sentence templates
 * in dmoCommentary.mjs. Live lines made on demand must use only these words
 * (plus the players' names and numbers), so the speech service cannot be
 * used to say anything else.
 *
 * tests/dmoCommentaryPhrasebook.test.mjs regenerates this list from the
 * source and fails if it is out of date: after changing commentary wording,
 * run `node scripts/update-commentary-vocabulary.mjs`.
 */

/** Words inside string and template literals, ignoring `${...}` expressions and comments. */
export function extractDmoCommentaryVocabulary(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');
  const words = new Set();
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const match of code.matchAll(literal)) {
    const text = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    for (const word of text.toLowerCase().replace(/[’']/g, "'").split(/[^\p{L}\p{N}_']+/u)) {
      const clean = word.replace(/^'+|'+$/g, '');
      if (clean && /\p{L}/u.test(clean)) words.add(clean);
    }
  }
  return [...words].sort();
}

export const DMO_COMMENTARY_VOCABULARY = Object.freeze([
  'a', 'about', 'absolutely', 'accepts', 'action', 'ad', 'adjusts', 'admire', 'adv', 'after',
  'again', 'against', 'agree', 'agreed', 'ahead', 'alive', 'all', 'an', 'and', 'angles',
  'another', 'answer', 'answers', 'anything', 'apiece', 'approach', 'are', 'as', 'at', 'atp',
  'attention', 'au', 'auto', 'away', 'back', 'backs', 'ball', 'balls', 'baseline', 'battle',
  'be', 'before', 'begin', 'behind', 'belongs', 'between', 'big', 'bite', 'blink', 'blinks', 'both',
  'bounce', 'break', 'breaks', 'breather', 'brilliant', 'brings', 'business', 'but', 'by',
  'came', 'can', 'can\'t', 'catches', 'chance', 'change', 'changes', 'cheap', 'clay', 'clean',
  'clear', 'close', 'closed', 'closes', 'come', 'comes', 'coming', 'complain', 'consolidated',
  'consolidates', 'contest', 'continues', 'control', 'converted', 'corners', 'costly', 'could',
  'count', 'counting', 'court', 'courts', 'craft', 'credit', 'crew', 'crowd', 'damage', 'decide', 'deep',
  'defended', 'defending', 'delivers', 'delivery', 'deserved', 'deuce', 'developing', 'did',
  'didn\'t', 'difference', 'differently', 'digging', 'digs', 'disagreement', 'distance',
  'dmotournamentname', 'do', 'does', 'don\'t', 'done', 'double', 'down', 'dragged', 'each',
  'early', 'earn', 'earned', 'easy', 'edge', 'edges', 'eight', 'elo', 'en', 'end', 'ends',
  'every', 'everything', 'everything\'s', 'exactly', 'exchange', 'faces', 'fair', 'far', 'fault',
  'faults', 'feel', 'female', 'few', 'fifth', 'final', 'finally', 'find', 'finding', 'finds', 'finish',
  'finished', 'finishes', 'firm', 'first', 'five', 'for', 'forget', 'forth', 'forward', 'found',
  'four', 'fourth', 'free', 'fresh', 'from', 'front', 'gains', 'game', 'games', 'gap', 'gave', 'gb', 'get',
  'gets', 'gift', 'gifted', 'give', 'gives', 'giving', 'go', 'goes', 'going', 'gone', 'good',
  'goods', 'got', 'grass', 'gratefully', 'had', 'handle', 'hands', 'hang', 'hangs', 'happily',
  'hard', 'has', 'have', 'having', 'head', 'hello', 'here', 'history', 'hit', 'hits', 'hitting',
  'hold', 'holds', 'hour', 'how', 'huge', 'hurts', 'i', 'i\'d', 'i\'ll', 'i\'m', 'ie',
  'immediately', 'important', 'in', 'inch', 'incredible', 'indeed', 'initiative', 'into',
  'intrigued', 'is', 'it', 'it\'s', 'join', 'just', 'keep', 'keeping', 'keeps', 'kept', 'key',
  'kilometres', 'kind', 'landing', 'lands', 'last', 'leads', 'legs', 'length', 'let', 'let\'s',
  'lets', 'level', 'like', 'line', 'little', 'locked', 'long', 'look', 'looking', 'lose', 'lot',
  'love', 'lovely', 'luck', 'made', 'magnificent', 'makes', 'making', 'male', 'marathon',
  'margins', 'match', 'mattered', 'matters', 'may', 'metre', 'mind', 'missed', 'misses', 'mjs',
  'model', 'moment', 'momentum', 'more', 'move', 'moved', 'moves', 'narrows', 'near', 'need',
  'needed', 'needs', 'neither', 'nerve', 'nerves', 'never', 'new', 'next', 'nine', 'no', 'nor',
  'not', 'nothing', 'now', 'number', 'numbers', 'of', 'off', 'oh', 'on', 'once', 'one', 'open',
  'opened', 'opening', 'other', 'out', 'outlasts', 'outside', 'over', 'overtime', 'owes',
  'painful', 'paints', 'part', 'patience', 'picking', 'pinning', 'plan', 'play', 'played', 'player',
  'players', 'plenty', 'point', 'points', 'pressure', 'prevails', 'punished', 'puts', 'quick',
  'quickly', 'quit', 'r', 'rally', 'rankings', 'ratings', 'ready', 'really', 'regroup', 'reply',
  'reset', 'respond', 'responds', 'response', 'return', 'returner', 'returns', 'reward',
  'rhythm', 'right', 'roll', 'rolling', 'row', 'run', 'running', 's', 'saved', 'saves', 'says',
  'score', 'seals', 'second', 'see', 'sees', 'sending', 'serve', 'served', 'server', 'serves',
  'service', 'set', 'sets', 'settles', 'settling', 'seven', 'share', 'shifting', 'shot', 'shots',
  'should', 'shrinking', 'side', 'signs', 'simple', 'six', 'slate', 'small', 'smart', 'so',
  'some', 'somebody', 'something', 'speak', 'square', 'stage', 'stands', 'start', 'stay',
  'stays', 'still', 'sting', 'story', 'straight', 'stretching', 'stuff', 'superb', 'sure',
  'swing', 'swings', 'take', 'takes', 'tell', 'ten', 'tennis', 'terrific', 'testing', 'thank',
  'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'then', 'there', 'there\'s', 'these',
  'they', 'thing', 'things', 'third', 'this', 'three', 'through', 'tide', 'tie', 'time', 'to', 'too', 'took', 'top',
  'tour', 'towards', 'traded', 'trading', 'trouble', 'true', 'turn', 'turning', 'two', 'under',
  'underway', 'unfolds', 'unreturned', 'up', 'us', 'use', 'value', 'want', 'wanted', 'was',
  'watch', 'way', 'we', 'we\'re', 'welcome', 'well', 'went', 'what', 'where', 'whether', 'who',
  'who\'s', 'wide', 'will', 'win', 'winner', 'winning', 'wins', 'wipes', 'with', 'without',
  'won', 'won\'t', 'word', 'work', 'worked', 'worst', 'wouldn\'t', 'wraps', 'wta', 'wtsl', 'yes',
  'yet', 'you',
]);
