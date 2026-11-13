import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayIn, addDays, streaks, isDay, validTz } from '../js/days.js';
import { ideaFor, IDEAS } from '../js/ideas.js';

test('a day is the maker’s own day', () => {
  const t = new Date('2026-11-03T03:30:00Z');
  assert.equal(dayIn('UTC', t), '2026-11-03');
  assert.equal(dayIn('America/Los_Angeles', t), '2026-11-02');
  assert.equal(dayIn('Asia/Kolkata', t), '2026-11-03');
  assert.equal(dayIn('Not/AZone', t), '2026-11-03');
});

test('days and time zones are checked', () => {
  assert.ok(isDay('2026-02-28'));
  assert.ok(!isDay('2026-02-30'));
  assert.ok(!isDay('nope'));
  assert.ok(validTz('Europe/London'));
  assert.ok(!validTz('Mars/Olympus'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('streak counts back from today', () => {
  const s = streaks(['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-03');
  assert.deepEqual(s, { current: 3, longest: 3, total: 3 });
});

test('streak is still alive before today’s launch', () => {
  assert.equal(streaks(['2026-11-01', '2026-11-02'], '2026-11-03').current, 2);
});

test('a missed day ends the streak, longest remembers', () => {
  const s = streaks(['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-01'], '2026-11-03');
  assert.equal(s.current, 0);
  assert.equal(s.longest, 3);
  assert.equal(s.total, 4);
});

test('the idea of the day is the same for everyone and changes daily', () => {
  assert.equal(ideaFor('2026-11-03'), ideaFor('2026-11-03'));
  const week = new Set(Array.from({ length: 7 }, (_, i) => ideaFor(addDays('2026-11-03', i))));
  assert.ok(week.size > 1);
  assert.ok(IDEAS.includes(ideaFor('2026-11-03', -5)));
});
