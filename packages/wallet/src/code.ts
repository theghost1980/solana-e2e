/**
 * JSON.stringify for values that end up inside generated JavaScript source. JSON already escapes
 * quotes and backslashes; this also escapes characters that could close a surrounding <script> or
 * break older parsers (U+2028 and U+2029), so a value can never turn into code.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const UNSAFE: Record<string, string> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};
const UNSAFE_CHARS = new RegExp("[<>\\b\\f\\n\\r\\t\\0\\u2028\\u2029]", "g");

export function jsonForCode(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_CHARS, (char) => UNSAFE[char]!);
}
