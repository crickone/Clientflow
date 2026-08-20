import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogForYear, seasonForMonth, upcomingDates, easterSunday } from "./seasonalCalendar";

test("easterSunday: known Gregorian values", () => {
  assert.deepEqual(easterSunday(2025), { month: 4, day: 20 });
  assert.deepEqual(easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(easterSunday(2027), { month: 3, day: 28 });
});

test("catalog: fixed + computed IE holidays land on the right dates (2026)", () => {
  const { dates } = catalogForYear(2026);
  const by = (id: string) => dates.find((d) => d.id === id)?.iso;
  assert.equal(by("new-year"), "2026-01-01");
  assert.equal(by("st-patricks"), "2026-03-17");
  assert.equal(by("easter-monday"), "2026-04-06");      // Easter Sun 2026-04-05 + 1
  assert.equal(by("may-day"), "2026-05-04");             // first Mon May
  assert.equal(by("june-bh"), "2026-06-01");            // first Mon Jun
  assert.equal(by("august-bh"), "2026-08-03");          // first Mon Aug
  assert.equal(by("october-bh"), "2026-10-26");         // last Mon Oct
  assert.equal(by("st-brigids"), "2026-02-02");         // first Mon Feb
  assert.equal(by("christmas"), "2026-12-25");
  assert.equal(by("st-stephens"), "2026-12-26");
});

test("catalog: St Brigid's Day honours the Friday-1-Feb exception", () => {
  const by = (y: number) => catalogForYear(y).dates.find((d) => d.id === "st-brigids")?.iso;
  assert.equal(by(2030), "2030-02-01"); // 1 Feb 2030 is a Friday → the holiday IS that Friday
  assert.equal(by(2026), "2026-02-02"); // 1 Feb 2026 is a Sunday → first Monday (2 Feb)
  assert.equal(by(2027), "2027-02-01"); // 1 Feb 2027 is a Monday → first Monday IS 1 Feb
});

test("catalog: awareness days (2026)", () => {
  const { dates } = catalogForYear(2026);
  const by = (id: string) => dates.find((d) => d.id === id)?.iso;
  assert.equal(by("valentines"), "2026-02-14");
  assert.equal(by("intl-womens-day"), "2026-03-08");
  assert.equal(by("intl-mens-day"), "2026-11-19");
  assert.equal(by("mothers-day-ie"), "2026-03-15");     // Easter 04-05 − 21 days
  assert.equal(by("fathers-day"), "2026-06-21");        // 3rd Sun Jun
  assert.equal(by("black-friday"), "2026-11-27");       // day after 4th Thu Nov
});

test("every catalog date carries a non-empty angle + valid iso", () => {
  const { dates } = catalogForYear(2026);
  assert.ok(dates.length >= 12);
  for (const d of dates) {
    assert.match(d.iso, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.angle.trim().length > 0, `${d.id} has an angle`);
  }
});

test("seasonForMonth: Irish/Celtic bands", () => {
  assert.equal(seasonForMonth(2), "spring");
  assert.equal(seasonForMonth(4), "spring");
  assert.equal(seasonForMonth(5), "summer");
  assert.equal(seasonForMonth(8), "autumn");
  assert.equal(seasonForMonth(11), "winter");
  assert.equal(seasonForMonth(1), "winter");
});

test("catalogForYear: four season bands with correct starts", () => {
  const { seasons } = catalogForYear(2026);
  assert.equal(seasons.length, 4);
  const spring = seasons.find((s) => s.season === "spring")!;
  assert.deepEqual(spring.months, [2, 3, 4]);
  assert.equal(spring.startIso, "2026-02-01");
});

test("upcomingDates: ascending, within window, wraps year-end", () => {
  const u = upcomingDates("2026-03-01", 30, 2026);
  assert.ok(u.length >= 2);
  assert.ok(u.every((d, i) => i === 0 || d.iso >= u[i - 1].iso), "ascending");
  assert.ok(u.every((d) => d.iso >= "2026-03-01" && d.iso <= "2026-03-31"));
  // Wrap: a window starting mid-December reaches into next January
  const wrap = upcomingDates("2026-12-20", 20, 2026);
  assert.ok(wrap.some((d) => d.id === "christmas"));
  assert.ok(wrap.some((d) => d.id === "new-year" && d.iso.startsWith("2027")), "wraps into next year");
});
