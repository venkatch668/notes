/**
 * The closing note.
 *
 * Shown once, after the day is put to bed. Chosen by date rather than at
 * random: re-opening the same day must show the same quote, or the moment
 * reads as a slot machine instead of a full stop.
 *
 * Chosen for engineers who are being hard on themselves at 7pm — about
 * finishing, about compounding effort, about the difference between motion and
 * progress. Nothing about hustle.
 */

export interface Quote {
  text: string;
  author: string;
}

const QUOTES: Quote[] = [
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Programs must be written for people to read, and only incidentally for machines to execute.', author: 'Harold Abelson' },
  { text: 'Amateurs sit and wait for inspiration. The rest of us just get up and go to work.', author: 'Stephen King' },
  { text: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupéry' },
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', author: 'James Clear' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'The best way out is always through.', author: 'Robert Frost' },
  { text: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { text: 'Slow is smooth, and smooth is fast.', author: 'Anonymous' },
  { text: 'Small daily improvements are the key to staggering long-term results.', author: 'Robin Sharma' },
  { text: 'The function of good software is to make the complex appear simple.', author: 'Grady Booch' },
  { text: 'Done is better than perfect.', author: 'Sheryl Sandberg' },
  { text: 'A year from now you may wish you had started today.', author: 'Karen Lamb' },
  { text: 'Deleted code is debugged code.', author: 'Jeff Sickel' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Not everything that is faced can be changed, but nothing can be changed until it is faced.', author: 'James Baldwin' },
  { text: 'Measure twice, cut once.', author: 'Proverb' },
  { text: 'The work will teach you how to do it.', author: 'Estonian proverb' },
  { text: 'Continuous improvement is better than delayed perfection.', author: 'Mark Twain' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
  { text: 'You can do anything, but not everything.', author: 'David Allen' },
  { text: 'Rest is not idleness. It is the price of tomorrow’s focus.', author: 'Anonymous' },
];

/**
 * Stable per day. A plain character sum over the date string is enough — the
 * requirement is "same day, same quote", not unpredictability.
 */
export function quoteForDay(dateKey: string): Quote {
  let sum = 0;
  for (let i = 0; i < dateKey.length; i += 1) sum += dateKey.charCodeAt(i) * (i + 1);
  return QUOTES[sum % QUOTES.length];
}

/**
 * A closing line matched to how the day actually went.
 *
 * Earned rather than automatic: telling someone they had a great day when they
 * finished nothing is how an app teaches you to ignore it.
 */
export function closingLine(done: number, open: number, focusMin: number): string {
  if (done === 0 && focusMin === 0) return 'A quiet one. Tomorrow is a fresh page.';
  if (done === 0) return `${focusMin} minutes of focus with nothing ticked off — the work still counts.`;
  if (open === 0) return 'Everything you set out to do is done. Close the laptop.';
  if (done >= 5) return `${done} finished. That is a genuinely good day.`;
  if (open > done * 2) return `${done} done, ${open} still open. Worth asking which of those are real.`;
  return `${done} done. Steady progress.`;
}
