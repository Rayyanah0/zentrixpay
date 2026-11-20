import { describe, it, expect } from "vitest";
import {
  BLOCKED_RESPONSE_HEADERS,
  MAX_HEADER_VALUE_CHARS,
  SAFE_RESPONSE_HEADERS,
  pickSafeResponseHeaders,
} from "./responseHeaders.js";

describe("pickSafeResponseHeaders", () => {
  it("never allowlists a blocked header", () => {
    for (const name of BLOCKED_RESPONSE_HEADERS) {
      expect(SAFE_RESPONSE_HEADERS).not.toContain(name);
    }
  });

  it("keeps allowlisted headers with lower-case names", () => {
    const h = new Headers({ ETag: '"v1"', "Retry-After": "5", "X-Other": "x" });
    expect(pickSafeResponseHeaders(h)).toEqual({ etag: '"v1"', "retry-after": "5" });
  });

  it("drops every blocked header", () => {
    const h = new Headers();
    for (const name of BLOCKED_RESPONSE_HEADERS) h.set(name, "value");
    expect(pickSafeResponseHeaders(h)).toEqual({});
  });

  it("drops headers named in Connection", () => {
    const h = new Headers({ connection: "close, Link", link: "<x>" });
    expect(pickSafeResponseHeaders(h)).toEqual({});
  });

  it("truncates very long values", () => {
    const h = new Headers({ link: "a".repeat(MAX_HEADER_VALUE_CHARS + 50) });
    expect(pickSafeResponseHeaders(h).link).toHaveLength(MAX_HEADER_VALUE_CHARS);
  });
});
