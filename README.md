# Blood Sugar Correction Calculator

A simple web page that works out a mealtime **correction insulin dose** for a person whose blood sugar is above their correction level (300 mg/dL by default).

It is written for residents and patients: large text, plain words, one question at a time.

> **This tool does the math only.** It does not replace a doctor, nurse, or care plan. Every number it uses must come from the person's own orders.

## The formula

```
correction dose (units) = (current blood sugar − target blood sugar) ÷ correction factor
```

A dose is shown only when the reading is **above** the person's correction level. Example with a target of 150, a correction factor of 50 and a reading of 320:

```
(320 − 150) ÷ 50 = 3.4 units → rounded down to 3 units
```

## How to use it

Open `index.html` in any browser. There is nothing to install and no internet connection is needed. To share it with others, host the folder on any static web host (for example GitHub Pages).

1. **First time:** enter the person's numbers. They are saved on that device only.
2. **Each mealtime:** type the blood sugar, answer one question, and press **Work out my dose**.

### Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Target blood sugar | none, must be entered | 80–250 mg/dL |
| Correction factor | none, must be entered | Points (mg/dL) that 1 unit lowers blood sugar, 5–300 |
| Correction level | 300 mg/dL | Correct only above this number. Cannot be below the target |
| Largest correction dose | none, must be entered | The dose shown is never more than this, 1–50 units |
| Call-the-doctor level | 400 mg/dL | At or above this, the person is told to call |
| Rounding | Round down to a whole unit | Or round to the nearest half unit |
| Hours between doses | 4 hours | Window used for the "insulin still working" check, 2–8 hours |

Saving settings always requires confirming that the numbers come from the person's orders. After 90 days the page reminds the person to re-check them.

## What the tool calls out

| Situation | What happens |
| --- | --- |
| Blood sugar under 70 | No dose. Shows how to treat a low and when to call 911 |
| Blood sugar under 54, or meter says LO | Same, marked as very low, tell someone now |
| At or below the correction level | "No correction insulin needed" |
| Above the correction level | Shows the dose and the math behind it |
| Dose is more than the largest dose | Shows the largest dose and says to call the doctor or nurse |
| At or above the call-the-doctor level | Says to retest, call, check ketones (type 1), and when to call 911 |
| Meter says HI | No dose. Get help now |
| Rapid-acting insulin in the last few hours (answered Yes, or found in the log) | No dose to take. Says to call first, because doses can stack |
| Three high readings in a row in the log | Says to tell the doctor or nurse, the plan may need to change |
| Between 9 PM and 5 AM | Notes that bedtime and overnight corrections are often smaller |
| A number a meter cannot show (under 20 or over 600), or not a whole number | Asks the person to check what they typed |

A result is cleared from the screen as soon as the blood sugar or the answer changes, so an old dose is never left showing.

## Privacy

Settings and the log are stored in the browser on the device (`localStorage`). Nothing is sent anywhere. Do not use a shared device for more than one person, because the saved numbers belong to one person.

## Files

- `index.html`, `styles.css` – the page
- `calculator.js` – the dosing rules, with no page code, so they can be tested
- `app.js` – the page behaviour (settings, form, results, log)
- `tests/calculator.test.js` – tests for the dosing rules

## Tests

Requires Node.js 18 or newer.

```
node --test tests/calculator.test.js
```
