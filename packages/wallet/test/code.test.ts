import { expect, test } from "vitest";
import { jsonForCode } from "../src/code.js";

test("jsonForCode keeps the value but never emits characters that could become code", () => {
  const value = { name: '</script><script>alert(1)</script>', tricky: "a\u2028b\u2029c\nd\0e", quote: '"' };
  const out = jsonForCode(value);
  expect(out).not.toMatch(/[<>\u2028\u2029\n\0]/);
  // Still valid JavaScript (and JSON) that evaluates to the same value.
  expect(JSON.parse(out)).toEqual(value);
  expect(new Function(`return ${out};`)()).toEqual(value);
});
