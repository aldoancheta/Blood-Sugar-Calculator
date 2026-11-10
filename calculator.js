/*
 * Blood sugar correction dose logic.
 * Pure functions only (no DOM, no storage) so the dosing rules can be tested with Node.
 *
 * Standard correction formula:
 *   correction dose (units) = (current BG - target BG) / correction factor
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BSCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LOW = 70; // below this: low blood sugar, never give insulin
  var SEVERE_LOW = 54; // below this: severe low
  var BG_MIN = 20; // lowest reading a home meter reports as a number
  var BG_MAX = 600; // highest reading a home meter reports as a number
  var LATE_START_HOUR = 21; // 9 PM
  var LATE_END_HOUR = 5; // 5 AM
  var REVIEW_DAYS = 90; // remind the person to re-check settings after this long

  // Target, correction factor and maximum dose have no default on purpose:
  // they must come from the person's own orders.
  var DEFAULTS = {
    target: null,
    cf: null,
    threshold: 300,
    maxDose: null,
    callLevel: 400,
    rounding: 'down-whole',
    stackHours: 4
  };

  var LIMITS = {
    target: [80, 250],
    cf: [5, 300],
    threshold: [100, 500],
    maxDose: [1, 50],
    callLevel: [200, 600],
    stackHours: [2, 8]
  };

  var ROUNDING_MODES = ['down-whole', 'nearest-half'];

  function toInt(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? value : NaN;
    var text = String(value == null ? '' : value).trim();
    return /^\d+$/.test(text) ? parseInt(text, 10) : NaN;
  }

  function roundDose(raw, mode) {
    if (mode === 'nearest-half') return Math.round(raw * 2) / 2;
    return Math.floor(raw);
  }

  var FIELD_NAMES = {
    target: 'Target blood sugar',
    cf: 'Correction factor',
    threshold: 'Correction level',
    maxDose: 'Largest correction dose',
    callLevel: 'Call-the-doctor level',
    stackHours: 'Hours between doses'
  };

  /** Checks raw settings. Returns { values, errors } where errors is keyed by field. */
  function validateSettings(raw) {
    var values = {};
    var errors = {};
    Object.keys(LIMITS).forEach(function (field) {
      var n = toInt(raw[field]);
      var min = LIMITS[field][0];
      var max = LIMITS[field][1];
      values[field] = n;
      if (isNaN(n)) errors[field] = 'Enter a whole number.';
      else if (n < min || n > max) {
        errors[field] = FIELD_NAMES[field] + ' must be between ' + min + ' and ' + max + '.';
      }
    });
    if (!errors.threshold && !errors.target && values.threshold < values.target) {
      errors.threshold = 'This cannot be lower than your target blood sugar.';
    }
    if (!errors.callLevel && !errors.threshold && values.callLevel < values.threshold) {
      errors.callLevel = 'This cannot be lower than your correction level.';
    }
    values.rounding = raw.rounding;
    if (ROUNDING_MODES.indexOf(raw.rounding) === -1) errors.rounding = 'Choose how to round.';
    if (!raw.acknowledged) errors.acknowledged = 'Please check this box to continue.';
    return { values: values, errors: errors };
  }

  /** Checks a typed blood sugar reading. Returns { value } or { error }. */
  function validateBg(raw) {
    var n = toInt(raw);
    if (isNaN(n)) return { error: 'Type your blood sugar as a whole number, like 320.' };
    if (n > BG_MAX) {
      return { error: 'That number is higher than a meter can show. Check the number. If your meter says HI, press "Meter says HI".' };
    }
    if (n < BG_MIN) {
      return { error: 'That number is lower than a meter can show. Check the number. If your meter says LO, press "Meter says LO".' };
    }
    return { value: n };
  }

  function lastDoseWithin(log, now, hours) {
    var windowMs = hours * 60 * 60 * 1000;
    var latest = null;
    log.forEach(function (entry) {
      if (!(entry.dose > 0) || entry.t > now || now - entry.t >= windowMs) return;
      if (!latest || entry.t > latest.t) latest = entry;
    });
    return latest;
  }

  function isHighReading(bg, threshold) {
    return bg === 'HI' || (typeof bg === 'number' && bg > threshold);
  }

  function previousTwoWereHigh(log, threshold) {
    var recent = log
      .slice()
      .sort(function (a, b) { return b.t - a.t; })
      .slice(0, 2);
    return recent.length === 2 && recent.every(function (e) { return isHighReading(e.bg, threshold); });
  }

  function isLateNight(hour) {
    return hour >= LATE_START_HOUR || hour < LATE_END_HOUR;
  }

  /**
   * Works out what to do for one reading.
   *
   * input: {
   *   bg: whole number (already validated), or meter: 'HI' | 'LO'
   *   recentInsulin: true if the person says they took rapid-acting insulin recently
   *   settings: validated settings
   *   log: [{ t: ms timestamp, bg: number | 'HI' | 'LO', dose: units taken }]
   *   now: ms timestamp
   *   hour: local hour of day, 0-23
   * }
   *
   * status is one of:
   *   'meter-hi'       too high to read, get help, no dose
   *   'severe-low'     below 54 or meter says LO, no insulin
   *   'low'            below 70, no insulin
   *   'no-correction'  not above the correction level (or the dose rounds to zero)
   *   'dose'           take `dose` units
   *   'hold'           a dose was calculated but may stack on recent insulin
   */
  function evaluate(input) {
    var s = input.settings;
    var log = input.log || [];
    var out = { status: '', bg: input.bg, alerts: [] };

    if (input.meter === 'HI') { out.status = 'meter-hi'; out.bg = 'HI'; return out; }
    if (input.meter === 'LO') { out.status = 'severe-low'; out.bg = 'LO'; return out; }
    if (input.bg < SEVERE_LOW) { out.status = 'severe-low'; return out; }
    if (input.bg < LOW) { out.status = 'low'; return out; }

    if (input.bg >= s.callLevel) out.alerts.push('very-high');

    if (input.bg <= s.threshold) { out.status = 'no-correction'; return out; }

    var raw = (input.bg - s.target) / s.cf;
    var rounded = roundDose(raw, s.rounding);
    var capped = rounded > s.maxDose;
    out.rawDose = raw;
    out.roundedDose = rounded;
    out.capped = capped;
    out.dose = capped ? s.maxDose : rounded;

    if (capped) out.alerts.push('capped');
    if (previousTwoWereHigh(log, s.threshold)) out.alerts.push('repeated-high');

    var loggedDose = lastDoseWithin(log, input.now, s.stackHours);
    if (input.recentInsulin || loggedDose) {
      out.status = 'hold';
      out.lastLoggedDose = loggedDose;
    } else if (out.dose > 0) {
      out.status = 'dose';
      if (isLateNight(input.hour)) out.alerts.push('late-night');
    } else {
      out.status = 'no-correction';
      out.roundedToZero = true;
    }
    return out;
  }

  function settingsNeedReview(savedAt, now) {
    return typeof savedAt === 'number' && now - savedAt > REVIEW_DAYS * 24 * 60 * 60 * 1000;
  }

  return {
    LOW: LOW,
    SEVERE_LOW: SEVERE_LOW,
    BG_MIN: BG_MIN,
    BG_MAX: BG_MAX,
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    roundDose: roundDose,
    validateSettings: validateSettings,
    validateBg: validateBg,
    evaluate: evaluate,
    settingsNeedReview: settingsNeedReview
  };
});
