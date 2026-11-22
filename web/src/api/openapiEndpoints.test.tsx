import { afterEach, describe, expect, it, vi } from "vitest";
import { endpointsFromSpec, fetchOpenApiSpec, type OpenApiSpec } from "./apis.js";

describe("endpointsFromSpec (#182)", () => {
  it("returns no endpoints for a missing or path-less document", () => {
    expect(endpointsFromSpec(null)).toEqual([]);
    expect(endpointsFromSpec(undefined)).toEqual([]);
    expect(endpointsFromSpec({ openapi: "3.0.0" })).toEqual([]);
    expect(endpointsFromSpec({ openapi: "3.0.0", paths: {} })).toEqual([]);
  });

  it("lists method, path and summary for each operation", () => {
    const spec: OpenApiSpec = {
      openapi: "3.0.0",
      paths: {
        "/weather": {
          get: { summary: "Current weather" },
          post: { description: "Submit a reading", requestBody: { content: {} } },
        },
        "/forecast/{city}": {
          get: { summary: "  Forecast  " },
        },
      },
    };

    expect(endpointsFromSpec(spec)).toEqual([
      {
        method: "GET",
        path: "/weather",
        summary: "Current weather",
        parameters: [],
        hasRequestBody: false,
      },
      {
        method: "POST",
        path: "/weather",
        summary: "Submit a reading",
        parameters: [],
        hasRequestBody: true,
      },
      {
        method: "GET",
        path: "/forecast/{city}",
        summary: "Forecast",
        parameters: [],
        hasRequestBody: false,
      },
    ]);
  });

  it("orders methods within a path by HTTP_METHODS and ignores unsupported ones", () => {
    const spec: OpenApiSpec = {
      paths: {
        "/items": {
          delete: {},
          options: { summary: "ignored" },
          head: {},
          trace: {},
          get: {},
          patch: {},
          put: {},
          summary: "not an operation",
        },
      },
    };

    expect(endpointsFromSpec(spec).map((e) => e.method)).toEqual(["GET", "PUT", "PATCH", "DELETE"]);
  });

  it("sets summary to null when the operation has none", () => {
    const [endpoint] = endpointsFromSpec({ paths: { "/x": { get: {} } } });
    expect(endpoint.summary).toBeNull();
  });

  it("merges path-level parameters and lets operation parameters override them", () => {
    const spec: OpenApiSpec = {
      paths: {
        "/forecast/{city}": {
          parameters: [
            { name: "city", in: "path", description: "City name" },
            { name: "units", in: "query", description: "shared" },
          ],
          get: {
            parameters: [
              { name: "units", in: "query", required: true, description: "metric or imperial" },
              { name: "days", in: "query" },
            ],
          },
        },
      },
    };

    expect(endpointsFromSpec(spec)[0].parameters).toEqual([
      { name: "city", in: "path", required: true, description: "City name" },
      { name: "units", in: "query", required: true, description: "metric or imperial" },
      { name: "days", in: "query", required: false, description: null },
    ]);
  });

  it("resolves local $ref parameters and request bodies", () => {
    const spec: OpenApiSpec = {
      paths: {
        "/items": {
          post: {
            parameters: [{ $ref: "#/components/parameters/Trace" }, { $ref: "#/missing/ref" }],
            requestBody: { $ref: "#/components/requestBodies/Item" },
          },
        },
      },
      components: {
        parameters: { Trace: { name: "X-Trace", in: "header" } },
        requestBodies: { Item: { content: { "application/json": {} } } },
      },
    };

    const [endpoint] = endpointsFromSpec(spec);
    expect(endpoint.parameters).toEqual([
      { name: "X-Trace", in: "header", required: false, description: null },
    ]);
    expect(endpoint.hasRequestBody).toBe(true);
  });

  it("skips malformed path items, operations and parameters", () => {
    const spec = {
      paths: {
        "/bad": "not an object",
        "/list": [],
        "/ok": {
          get: "nope",
          post: {
            parameters: [null, "x", { name: "q" }, { in: "query" }, { name: "q", in: "query" }],
          },
        },
      },
    } as unknown as OpenApiSpec;

    expect(endpointsFromSpec(spec)).toEqual([
      {
        method: "POST",
        path: "/ok",
        summary: null,
        parameters: [{ name: "q", in: "query", required: false, description: null }],
        hasRequestBody: false,
      },
    ]);
  });
});

describe("fetchOpenApiSpec (#182)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests GET /apis/:id/openapi.json for an id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ openapi: "3.0.0", paths: {} }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const spec = await fetchOpenApiSpec("api 1");

    expect(spec).toEqual({ openapi: "3.0.0", paths: {} });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/apis\/api%201\/openapi\.json$/);
  });

  it("uses an absolute openapiUrl as-is", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchOpenApiSpec("https://gateway.example/apis/abc/openapi.json");

    expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.example/apis/abc/openapi.json");
  });

  it("throws the server's error message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "No OpenAPI document for this API" }), {
          status: 404,
        }),
      ),
    );

    await expect(fetchOpenApiSpec("abc")).rejects.toThrow("No OpenAPI document for this API");
  });
});
