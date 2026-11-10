const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calculator.js');

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 10, 17, 0, 0);

const settings = (over) => Object.assign(
  { target: 150, cf: 50, threshold: 300, maxDose: 10, callLevel: 400, rounding: 'down-whole', stackHours: 4 },
  over
);

const run = (over) => C.evaluate(Object.assign(
  { bg: 320, recentInsulin: false, settings: settings(), log: [], now: NOW, hour: 12 },
  over
));

test('standard formula: (BG - target) / correction factor, rounded down', () => {
  const r = run({ bg: 320 });
  assert.equal(r.status, 'dose');
  assert.ok(Math.abs(r.rawDose - 3.4) < 1e-9);
  assert.equal(r.dose, 3);
  assert.deepEqual(r.alerts, []);
});

test('rounding modes', () => {
  assert.equal(run({ bg: 340 }).dose, 3); // 3.8 down to 3
  assert.equal(run({ bg: 340, settings: settings({ rounding: 'nearest-half' }) }).dose, 4); // 3.8 -> 4.0
  assert.equal(run({ bg: 330, settings: settings({ rounding: 'nearest-half' }) }).dose, 3.5); // 3.6 -> 3.5
  assert.equal(run({ bg: 320, settings: settings({ rounding: 'nearest-half' }) }).dose, 3.5); // 3.4 -> 3.5
  assert.equal(C.roundDose(3.75, 'nearest-half'), 4);
  assert.equal(C.roundDose(3.99, 'down-whole'), 3);
});

test('no correction at or below the correction level', () => {
  assert.equal(run({ bg: 300 }).status, 'no-correction');
  assert.equal(run({ bg: 300 }).dose, undefined);
  assert.equal(run({ bg: 180 }).status, 'no-correction');
  assert.equal(run({ bg: 301 }).status, 'dose');
  assert.equal(run({ bg: 301 }).dose, 3);
});

test('correction level can be changed per person', () => {
  const s = settings({ threshold: 280 });
  assert.equal(run({ bg: 290, settings: s }).status, 'dose');
  assert.equal(run({ bg: 290, settings: s }).dose, 2); // 140 / 50 = 2.8
  assert.equal(run({ bg: 280, settings: s }).status, 'no-correction');
});

test('low blood sugar never produces a dose', () => {
  assert.equal(run({ bg: 70 }).status, 'no-correction');
  assert.equal(run({ bg: 69 }).status, 'low');
  assert.equal(run({ bg: 54 }).status, 'low');
  assert.equal(run({ bg: 53 }).status, 'severe-low');
  assert.equal(run({ bg: undefined, meter: 'LO' }).status, 'severe-low');
  for (const bg of [69, 53]) assert.equal(run({ bg }).dose, undefined);
});

test('meter HI gives no dose', () => {
  const r = run({ bg: undefined, meter: 'HI' });
  assert.equal(r.status, 'meter-hi');
  assert.equal(r.dose, undefined);
});

test('dose is capped at the maximum and flagged', () => {
  const r = run({ bg: 600, settings: settings({ target: 100, cf: 25 }) });
  assert.equal(r.roundedDose, 20);
  assert.equal(r.dose, 10);
  assert.equal(r.capped, true);
  assert.ok(r.alerts.includes('capped'));
  assert.ok(r.alerts.includes('very-high'));
});

test('very high alert starts at the call level', () => {
  assert.ok(!run({ bg: 399 }).alerts.includes('very-high'));
  assert.ok(run({ bg: 400 }).alerts.includes('very-high'));
});

test('recent insulin puts the dose on hold', () => {
  const r = run({ recentInsulin: true });
  assert.equal(r.status, 'hold');
  assert.equal(r.dose, 3);
});

test('a logged dose inside the window puts the dose on hold', () => {
  const recent = [{ t: NOW - 2 * HOUR, bg: 310, dose: 3 }];
  const r = run({ log: recent });
  assert.equal(r.status, 'hold');
  assert.equal(r.lastLoggedDose.dose, 3);

  const old = [{ t: NOW - 5 * HOUR, bg: 310, dose: 3 }];
  assert.equal(run({ log: old }).status, 'dose');

  const readingOnly = [{ t: NOW - 1 * HOUR, bg: 200, dose: 0 }];
  assert.equal(run({ log: readingOnly }).status, 'dose');

  assert.equal(run({ log: [{ t: NOW - 4 * HOUR, bg: 310, dose: 3 }] }).status, 'dose');
});

test('three high readings in a row are flagged', () => {
  const log = [
    { t: NOW - 24 * HOUR, bg: 330, dose: 3 },
    { t: NOW - 12 * HOUR, bg: 'HI', dose: 0 }
  ];
  assert.ok(run({ log }).alerts.includes('repeated-high'));
  const mixed = [
    { t: NOW - 24 * HOUR, bg: 330, dose: 3 },
    { t: NOW - 12 * HOUR, bg: 180, dose: 0 }
  ];
  assert.ok(!run({ log: mixed }).alerts.includes('repeated-high'));
  assert.ok(!run({ log: [log[0]] }).alerts.includes('repeated-high'));
});

test('late-night doses are flagged', () => {
  assert.ok(run({ hour: 22 }).alerts.includes('late-night'));
  assert.ok(run({ hour: 3 }).alerts.includes('late-night'));
  assert.ok(!run({ hour: 5 }).alerts.includes('late-night'));
  assert.ok(!run({ hour: 20 }).alerts.includes('late-night'));
});

test('a dose that rounds to zero is reported as no correction', () => {
  const r = run({ bg: 200, settings: settings({ threshold: 150, cf: 100 }) });
  assert.equal(r.status, 'no-correction');
  assert.equal(r.roundedToZero, true);
});

test('settings validation', () => {
  const ok = { target: '150', cf: '50', threshold: '300', maxDose: '10', callLevel: '400', stackHours: '4', rounding: 'down-whole', acknowledged: true };
  const good = C.validateSettings(ok);
  assert.deepEqual(good.errors, {});
  assert.equal(good.values.target, 150);

  const blank = C.validateSettings(Object.assign({}, C.DEFAULTS, { acknowledged: false }));
  assert.deepEqual(Object.keys(blank.errors).sort(), ['acknowledged', 'cf', 'maxDose', 'target']);

  assert.ok(C.validateSettings(Object.assign({}, ok, { threshold: '140' })).errors.threshold);
  assert.ok(C.validateSettings(Object.assign({}, ok, { callLevel: '250' })).errors.callLevel);
  assert.ok(C.validateSettings(Object.assign({}, ok, { cf: '0' })).errors.cf);
  assert.ok(C.validateSettings(Object.assign({}, ok, { cf: '12.5' })).errors.cf);
  assert.ok(C.validateSettings(Object.assign({}, ok, { rounding: 'up' })).errors.rounding);
});

test('blood sugar entry validation', () => {
  assert.equal(C.validateBg('320').value, 320);
  assert.equal(C.validateBg(' 45 ').value, 45);
  assert.ok(C.validateBg('').error);
  assert.ok(C.validateBg('abc').error);
  assert.ok(C.validateBg('32.5').error);
  assert.ok(C.validateBg('-50').error);
  assert.ok(C.validateBg('601').error);
  assert.ok(C.validateBg('19').error);
});

test('settings review reminder after 90 days', () => {
  const DAY = 24 * HOUR;
  assert.equal(C.settingsNeedReview(NOW - 91 * DAY, NOW), true);
  assert.equal(C.settingsNeedReview(NOW - 30 * DAY, NOW), false);
  assert.equal(C.settingsNeedReview(undefined, NOW), false);
});
