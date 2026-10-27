import { describe, expect, it } from "vitest";
import { AttemptLimiter } from "./rate-limit.js";

describe("AttemptLimiter", () => {
  it("allows up to the limit per key, then refuses until the window ends", () => {
    let now = 0;
    const l = new AttemptLimiter(3, 1000, () => now);
    expect([l.allow("a"), l.allow("a"), l.allow("a"), l.allow("a")]).toEqual([true, true, true, false]);
    expect(l.allow("b")).toBe(true);
    now = 1000;
    expect(l.allow("a")).toBe(true);
  });

  it("forgets expired entries when it grows large", () => {
    let now = 0;
    const l = new AttemptLimiter(1, 10, () => now);
    for (let i = 0; i < 10_001; i++) l.allow(`k${i}`);
    now = 100;
    l.allow("fresh");
    expect(l.allow("k0")).toBe(true);
  });
});
