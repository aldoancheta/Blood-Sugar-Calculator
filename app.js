/* Page behaviour: settings, the calculator form, the result panel and the log. */
(function () {
  'use strict';

  var C = window.BSCalc;
  var SETTINGS_KEY = 'bsc.settings.v1';
  var LOG_KEY = 'bsc.log.v1';
  var LOG_LIMIT = 50;
  var NUMBER_FIELDS = ['target', 'cf', 'threshold', 'maxDose', 'callLevel', 'stackHours'];

  var $ = function (id) { return document.getElementById(id); };

  // ---------- storage (falls back to memory if the browser blocks it) ----------
  var memory = {};
  var storageWorks = true;

  function load(key) {
    try {
      var text = localStorage.getItem(key);
      return text ? JSON.parse(text) : (memory[key] || null);
    } catch (e) {
      return memory[key] || null;
    }
  }

  function save(key, value) {
    memory[key] = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      storageWorks = false;
      $('storage-warning').hidden = false;
    }
  }

  function loadSettings() {
    var saved = load(SETTINGS_KEY);
    if (!saved) return null;
    // Re-check saved values so a damaged or hand-edited entry can never drive a dose.
    var check = C.validateSettings(Object.assign({}, saved, { acknowledged: true }));
    if (Object.keys(check.errors).length) return null;
    check.values.savedAt = saved.savedAt;
    return check.values;
  }

  function loadLog() {
    var saved = load(LOG_KEY);
    if (!Array.isArray(saved)) return [];
    return saved.filter(function (e) { return e && typeof e.t === 'number'; });
  }

  var settings = loadSettings();
  var log = loadLog();

  // ---------- small helpers ----------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function units(n) { return n + (n === 1 ? ' unit' : ' units'); }

  function formatDose(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }

  function formatTime(t) {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatDateTime(t) {
    return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + formatTime(t);
  }

  function setError(field, message) {
    $('e-' + field).textContent = message || '';
    var input = $('s-' + field) || $(field);
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  // ---------- settings screen ----------
  function showSetup() {
    var form = $('settings-form');
    var current = settings || C.DEFAULTS;
    NUMBER_FIELDS.forEach(function (f) {
      $('s-' + f).value = current[f] == null ? '' : current[f];
      setError(f, '');
    });
    form.elements.rounding.value = current.rounding;
    $('s-ack').checked = false;
    setError('rounding', '');
    setError('acknowledged', '');

    $('setup-title').textContent = settings ? 'Change your numbers' : 'Set up your numbers';
    $('cancel-settings').hidden = !settings;
    $('setup').hidden = false;
    $('calc').hidden = true;
    $('log-section').hidden = true;
    $('open-settings').hidden = true;
    $('setup-title').scrollIntoView();
  }

  function saveSettings(event) {
    event.preventDefault();
    var form = $('settings-form');
    var raw = { rounding: form.elements.rounding.value, acknowledged: $('s-ack').checked };
    NUMBER_FIELDS.forEach(function (f) { raw[f] = $('s-' + f).value; });

    var check = C.validateSettings(raw);
    NUMBER_FIELDS.concat(['rounding', 'acknowledged']).forEach(function (f) {
      setError(f, check.errors[f]);
    });
    var firstBad = NUMBER_FIELDS.filter(function (f) { return check.errors[f]; })[0];
    if (Object.keys(check.errors).length) {
      if (firstBad) $('s-' + firstBad).focus();
      return;
    }

    settings = check.values;
    settings.savedAt = Date.now();
    save(SETTINGS_KEY, settings);
    showCalculator();
  }

  // ---------- calculator screen ----------
  function planItem(label, value) {
    var item = el('div');
    item.appendChild(el('span', null, label));
    item.appendChild(el('strong', null, value));
    return item;
  }

  function showCalculator() {
    var plan = $('plan');
    plan.replaceChildren(
      planItem('Target', settings.target + ' mg/dL'),
      planItem('1 unit lowers', settings.cf + ' points'),
      planItem('Correct above', settings.threshold + ' mg/dL'),
      planItem('Largest dose', units(settings.maxDose))
    );

    var review = $('review-note');
    review.hidden = !C.settingsNeedReview(settings.savedAt, Date.now());
    if (!review.hidden) {
      review.textContent = 'Your numbers were last checked on ' +
        new Date(settings.savedAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) +
        '. Ask your doctor or nurse if they are still right, then save them again in Settings.';
    }

    $('recent-legend').textContent =
      'Have you taken rapid-acting insulin in the last ' + settings.stackHours + ' hours?';

    resetCalcForm();
    $('setup').hidden = true;
    $('calc').hidden = false;
    $('log-section').hidden = false;
    $('open-settings').hidden = false;
    $('storage-warning').hidden = storageWorks;
    renderLog();
  }

  function resetCalcForm() {
    $('calc-form').reset();
    setError('bg', '');
    $('e-recent').textContent = '';
    clearResult();
  }

  function clearResult() {
    $('result').hidden = true;
    $('result').replaceChildren();
  }

  function calculate(event) {
    event.preventDefault();
    clearResult();

    var bgCheck = C.validateBg($('bg').value);
    var recent = $('calc-form').elements.recent.value;
    setError('bg', bgCheck.error);
    $('e-recent').textContent = recent ? '' : 'Please choose No or Yes.';
    if (bgCheck.error) { $('bg').focus(); return; }
    if (!recent) return;

    showResult({ bg: bgCheck.value, recentInsulin: recent === 'yes' });
  }

  function meterReading(flag) {
    setError('bg', '');
    $('e-recent').textContent = '';
    $('bg').value = '';
    showResult({ meter: flag });
  }

  function showResult(reading) {
    var now = Date.now();
    var outcome = C.evaluate(Object.assign({
      settings: settings,
      log: log,
      now: now,
      hour: new Date(now).getHours()
    }, reading));
    renderResult(outcome, reading);
  }

  // ---------- result panel ----------
  var FAST_SUGAR = [
    'Half a cup (4 ounces) of juice or regular soda, or',
    '3 to 4 glucose tablets, or',
    '1 tablespoon of sugar or honey'
  ];

  var EMERGENCY_HIGH = 'Call 911 if you feel very sick, are confused, have trouble breathing, or keep throwing up.';

  function list(items) {
    var ul = el('ul');
    items.forEach(function (text) { ul.appendChild(el('li', null, text)); });
    return ul;
  }

  function alertBox(title, text, urgent) {
    var box = el('div', 'alert' + (urgent ? ' urgent' : ''));
    box.appendChild(el('strong', null, title));
    box.appendChild(document.createTextNode(text));
    return box;
  }

  function mathBox(o) {
    var box = el('div', 'math');
    box.appendChild(el('strong', null, 'How this was worked out'));
    var raw = Math.round(o.rawDose * 100) / 100;
    var line = '(' + o.bg + ' − ' + settings.target + ') ÷ ' + settings.cf + ' = ' + raw + ' units';
    if (o.roundedDose !== raw) {
      line += settings.rounding === 'nearest-half'
        ? ', rounded to the nearest half unit: ' + formatDose(o.roundedDose)
        : ', rounded down to ' + formatDose(o.roundedDose);
    }
    if (o.capped) line += '. Your largest dose is ' + units(settings.maxDose) + '.';
    box.appendChild(document.createTextNode(line));
    return box;
  }

  function alertsFor(o) {
    var boxes = [];
    o.alerts.forEach(function (code) {
      if (code === 'very-high') {
        boxes.push(alertBox(
          'Your blood sugar is very high. Call your doctor or nurse.',
          'Wash and dry your hands and test again to be sure. If it is still ' + settings.callLevel +
          ' or higher, call your doctor or nurse now. If you have type 1 diabetes, check for ketones. ' +
          EMERGENCY_HIGH,
          true
        ));
      } else if (code === 'capped') {
        boxes.push(alertBox(
          'This is your largest allowed dose.',
          'The math gives ' + units(o.roundedDose) + ', but your largest dose is ' +
          units(settings.maxDose) + '. Do not take more than ' + units(settings.maxDose) +
          '. Call your doctor or nurse.',
          true
        ));
      } else if (code === 'repeated-high') {
        boxes.push(alertBox(
          'Your blood sugar keeps running high.',
          'Your last 3 readings were all above ' + settings.threshold +
          '. Tell your doctor or nurse. Your insulin plan may need to change.'
        ));
      } else if (code === 'late-night') {
        boxes.push(alertBox(
          'It is late.',
          'This calculator is for mealtimes. Correction doses at bedtime or overnight are often smaller. ' +
          'Check your plan or ask your doctor or nurse before you take this dose.'
        ));
      }
    });
    return boxes;
  }

  function renderResult(o, reading) {
    var panel = $('result');
    var kind = 'danger';
    var nodes = [];
    var loggedDose = 0;

    if (o.status === 'meter-hi') {
      nodes.push(el('h3', null, 'Get help now'));
      nodes.push(el('p', null, 'Your blood sugar is too high for your meter to read. Do not use this calculator for this reading.'));
      nodes.push(el('p', null, 'Call your doctor or nurse right now. ' + EMERGENCY_HIGH));
    } else if (o.status === 'severe-low' || o.status === 'low') {
      var severe = o.status === 'severe-low';
      nodes.push(el('h3', null, (severe ? 'Very low blood sugar.' : 'Low blood sugar.') + ' Do NOT take insulin.'));
      nodes.push(el('p', null, 'Eat or drink fast sugar now:'));
      nodes.push(list(FAST_SUGAR));
      nodes.push(el('p', null, 'Check your blood sugar again in 15 minutes. If it is still under ' + C.LOW + ', have fast sugar again.'));
      nodes.push(el('p', null, severe
        ? 'Tell someone near you right now. Call 911 if you cannot swallow, feel confused, or feel like you may pass out.'
        : 'Tell your doctor or nurse about this low. Call 911 if you cannot swallow, feel confused, or feel like you may pass out.'));
    } else if (o.status === 'no-correction') {
      kind = 'ok';
      nodes.push(el('h3', null, 'No correction insulin needed'));
      nodes.push(el('p', null, o.roundedToZero
        ? 'The math gives less than your smallest dose, so do not take correction insulin.'
        : 'Your blood sugar (' + o.bg + ') is not above your correction level (' + settings.threshold + ').'));
      nodes.push(el('p', null, 'If you take insulin for your meals, take your usual meal dose as ordered.'));
      nodes = nodes.concat(alertsFor(o));
    } else if (o.status === 'hold') {
      nodes.push(el('h3', null, 'Stop. Check before you take more insulin.'));
      nodes.push(el('p', null, o.lastLoggedDose && !reading.recentInsulin
        ? 'Your log shows you took ' + units(o.lastLoggedDose.dose) + ' at ' + formatTime(o.lastLoggedDose.t) + '.'
        : 'You took rapid-acting insulin in the last ' + settings.stackHours + ' hours.'));
      nodes.push(el('p', null, 'That insulin is still working. More insulin now could make your blood sugar drop too low. ' +
        'Call your doctor or nurse before you take any correction insulin.'));
      nodes = nodes.concat(alertsFor(o));
      var note = el('div', 'math');
      note.appendChild(el('strong', null, 'For your doctor or nurse'));
      note.appendChild(document.createTextNode(
        'Blood sugar ' + o.bg + '. The math gives ' + units(o.dose) +
        ' before counting the insulin already taken.'));
      nodes.push(note);
    } else if (o.status === 'dose') {
      kind = 'dose';
      loggedDose = o.dose;
      nodes.push(el('h3', null, 'Your correction dose'));
      var big = el('p', 'dose-number', formatDose(o.dose) + ' ');
      big.appendChild(el('small', null, o.dose === 1 ? 'unit' : 'units'));
      nodes.push(big);
      nodes.push(el('p', null, 'of rapid-acting insulin.'));
      nodes.push(el('p', null, 'This is the correction dose only. It does not include insulin for the food you eat.'));
      nodes = nodes.concat(alertsFor(o));
      nodes.push(mathBox(o));
    }

    var saveButton = el('button', 'primary',
      loggedDose ? 'I took ' + units(loggedDose) + '. Save to my log.' : 'Save this reading to my log');
    saveButton.type = 'button';
    saveButton.addEventListener('click', function () {
      addLogEntry({ t: Date.now(), bg: o.bg, dose: loggedDose });
      saveButton.replaceWith(el('p', 'saved', 'Saved to your log.'));
    });
    nodes.push(saveButton);

    panel.className = 'result ' + kind;
    panel.replaceChildren.apply(panel, nodes);
    panel.hidden = false;
    panel.scrollIntoView({ block: 'nearest' });
  }

  // ---------- log ----------
  function addLogEntry(entry) {
    log.push(entry);
    if (log.length > LOG_LIMIT) log = log.slice(log.length - LOG_LIMIT);
    save(LOG_KEY, log);
    renderLog();
  }

  function renderLog() {
    var ul = $('log-list');
    var newestFirst = log.slice().sort(function (a, b) { return b.t - a.t; });
    ul.replaceChildren.apply(ul, newestFirst.map(function (entry) {
      var li = el('li');
      var reading = typeof entry.bg === 'number' ? entry.bg + ' mg/dL' : 'Meter said ' + entry.bg;
      li.appendChild(el('strong', null, reading + (entry.dose > 0 ? ', took ' + units(entry.dose) : ', no correction insulin')));
      li.appendChild(el('span', null, formatDateTime(entry.t)));
      return li;
    }));
    $('log-empty').hidden = log.length > 0;
    $('clear-log').hidden = log.length === 0;
    $('clear-confirm').hidden = true;
  }

  function askClearLog() {
    $('clear-log').hidden = true;
    $('clear-confirm').hidden = false;
    $('clear-no').focus();
  }

  function clearLog() {
    log = [];
    save(LOG_KEY, log);
    renderLog();
  }

  // ---------- wiring ----------
  $('settings-form').addEventListener('submit', saveSettings);
  $('cancel-settings').addEventListener('click', showCalculator);
  $('open-settings').addEventListener('click', showSetup);
  $('calc-form').addEventListener('submit', calculate);
  $('meter-hi').addEventListener('click', function () { meterReading('HI'); });
  $('meter-lo').addEventListener('click', function () { meterReading('LO'); });
  $('clear-log').addEventListener('click', askClearLog);
  $('clear-yes').addEventListener('click', clearLog);
  $('clear-no').addEventListener('click', renderLog);

  // A result must never stay on screen after the inputs behind it change.
  $('bg').addEventListener('input', clearResult);
  $('calc-form').addEventListener('change', clearResult);

  if (settings) showCalculator();
  else showSetup();
})();
