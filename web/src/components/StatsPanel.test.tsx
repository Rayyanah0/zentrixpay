import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Issue #143: the stats panel filters totals and call history by the same date
// range and pages through calls.

const { mockFetchApiStats } = vi.hoisted(() => ({ mockFetchApiStats: vi.fn() }));

vi.mock("../api/apis.js", () => ({
  HTTP_METHODS: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  fetchMyApis: vi.fn(),
  createApi: vi.fn(),
  fetchApiStats: mockFetchApiStats,
  registerPublisher: vi.fn(),
  updateApi: vi.fn(),
  verifyApiOwnership: vi.fn(),
}));

import { StatsPanel } from "./ProviderDashboard.js";

function call(i: number) {
  return {
    id: `c${i}`,
    createdAt: "2026-01-02T00:00:00Z",
    method: "GET",
    path: "/x",
    responseStatus: 200,
    charged: true,
    amount: "0.01",
    payerAddress: "GABCDEFGHIJKLMNOP",
  };
}

function stats(overrides: Record<string, unknown> = {}) {
  return {
    apiId: "api1",
    calls: 120,
    chargedCalls: 100,
    revenue: "1.00",
    uniquePayers: 3,
    avgDurationMs: 10,
    refundedCalls: 0,
    refunded: "0",
    netRevenue: "1.00",
    currency: "USDC",
    recentCalls: Array.from({ length: 50 }, (_, i) => call(i)),
    pagination: { limit: 50, offset: 0, total: 120, hasMore: true },
    ...overrides,
  } as never;
}

function renderPanel(initial = stats()) {
  return render(<StatsPanel apiKey="key" apiId="api1" initial={initial} />);
}

describe("StatsPanel (#143)", () => {
  beforeEach(() => mockFetchApiStats.mockReset());

  it("applies the range to totals and history with an inclusive To day", async () => {
    mockFetchApiStats.mockResolvedValue(
      stats({
        calls: 0,
        recentCalls: [],
        pagination: { limit: 50, offset: 0, total: 0, hasMore: false },
      }),
    );
    renderPanel();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(mockFetchApiStats).toHaveBeenCalledWith("key", "api1", {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("shows a validation error and does not fetch for an inverted range", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert").textContent).toMatch(/From must be on or before To/);
    expect(mockFetchApiStats).not.toHaveBeenCalled();
  });

  it("pages forward with the same range", async () => {
    mockFetchApiStats.mockResolvedValue(
      stats({ pagination: { limit: 50, offset: 50, total: 120, hasMore: true } }),
    );
    renderPanel();
    expect(screen.getByText("Calls 1–50 of 120")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mockFetchApiStats).toHaveBeenCalledWith("key", "api1", { limit: 50, offset: 50 }),
    );
    await waitFor(() => expect(screen.getByText("Calls 51–100 of 120")).toBeTruthy());
  });

  it("hides paging for an empty range", () => {
    renderPanel(
      stats({
        calls: 0,
        recentCalls: [],
        pagination: { limit: 50, offset: 0, total: 0, hasMore: false },
      }),
    );
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });
});
