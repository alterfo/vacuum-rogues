import { describe, it, expect } from "vitest";
import {
  GAME_START_YEAR,
  toGameDate,
  formatGameDate,
} from "@/utils/gameCalendar";

describe("gameCalendar", () => {
  it("starts on day 1 of year 4000", () => {
    expect(GAME_START_YEAR).toBe(4000);
    expect(toGameDate(0)).toEqual({ year: 4000, month: 1, day: 1 });
    expect(formatGameDate(0)).toBe("1 января 4000 г.");
  });

  it("advances day within a month", () => {
    expect(toGameDate(14)).toEqual({ year: 4000, month: 1, day: 15 });
  });

  it("rolls into the next month after 30 days", () => {
    expect(toGameDate(30)).toEqual({ year: 4000, month: 2, day: 1 });
    expect(formatGameDate(30)).toBe("1 февраля 4000 г.");
  });

  it("rolls into the next year after 360 days", () => {
    expect(toGameDate(360)).toEqual({ year: 4001, month: 1, day: 1 });
  });

  it("clamps negative input to the start date", () => {
    expect(toGameDate(-5)).toEqual({ year: 4000, month: 1, day: 1 });
  });
});
