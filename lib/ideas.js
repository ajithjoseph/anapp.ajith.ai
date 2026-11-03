// Small, one-day-sized app ideas. The idea of the day is the same for
// everyone on a given date, so makers can compare takes on it.
export const IDEAS = [
  'A tip calculator that splits the bill by what each person ordered',
  'A habit tracker with exactly one habit',
  'A "what should I cook" picker from three ingredients you have',
  'A countdown page you can share for any event',
  'A link-in-bio page generator',
  'A Pomodoro timer that logs what you worked on',
  'A color palette generator from a photo',
  'A QR code maker for Wi-Fi passwords',
  'A random team picker for game night',
  'A markdown resume builder with a print button',
  'A "did I drink enough water" tracker',
  'A plant watering reminder for your plants',
  'A gratitude journal: one line a day',
  'A unit converter for recipes',
  'A meeting cost calculator that ticks up live',
  'A typing speed test with real quotes',
  'A simple invoice generator that exports a PDF',
  'A personal changelog page for your projects',
  'A daily standup note writer (yesterday, today, blockers)',
  'A budget split for roommates',
  'A book quotes saver with tags',
  'A flashcard app for one topic you are learning',
  'A "first commit" README generator',
  'A tiny URL shortener',
  'A world clock for your remote team',
  'A packing list maker by trip type',
  'A mood check-in with a weekly chart',
  'A decision maker: weigh pros and cons with scores',
  'A screenshot beautifier: add a background and padding',
  'A reading time estimator for any pasted text',
  'A sign-up page for your next idea, with a waitlist counter',
  'A favicon generator from an emoji',
  'A JSON formatter and validator',
  'A daily prompt for writers',
  'A workout interval timer',
  'A "people to follow up with" list',
  'A random dinner spot picker from your own list',
  'A gift idea tracker for friends and family',
  'A commute cost calculator',
  'A bingo card generator for meetings or events',
  'A password strength checker that explains why',
  'A "focus mode" page that blocks nothing but tells you the time left',
  'A chore wheel for a household',
  'A subscription tracker that totals what you pay each month',
  'A snippet manager for code you reuse',
  'A birthday reminder page',
  'A trivia quiz on any topic you know well',
  'A tiny landing page A/B headline tester',
  'A "rate my idea" page where friends vote',
  'A daily step goal tracker',
  'A podcast episode notes keeper',
  'A simple poll you can share by link',
  'A kanban board with three columns, nothing more',
  'A time zone meeting planner',
  'A cover letter outline builder',
  'A sleep log with bedtime streaks',
  'A savings goal tracker with a progress bar',
  'A coffee brew ratio calculator',
  'A "what did I ship this year" timeline',
  'A pet feeding log for a family',
];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function ideaFor(day, offset = 0) {
  const i = (hash(day) + offset) % IDEAS.length;
  return IDEAS[(i + IDEAS.length) % IDEAS.length];
}
