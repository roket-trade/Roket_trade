import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveTransactions } from "@/components/LiveTransactions";

const rows = vi.hoisted(() => [
  {
    id: "tx-deposit-1",
    type: "deposit",
    amount: 250,
    created_at: "2026-10-26T09:15:00.000Z",
  },
  {
    id: "tx-withdrawal-1",
    type: "withdrawal",
    amount: 75,
    created_at: "2026-10-26T08:45:00.000Z",
  },
]);

const db = vi.hoisted(() => ({ rpcFails: false, tableFails: false }));

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    in: () => query,
    eq: () => query,
    order: () => query,
    limit: () =>
      Promise.resolve(
        db.tableFails
          ? { data: null, error: { message: "permission denied" } }
          : { data: rows, error: null },
      ),
  };

  return {
    supabase: {
      from: () => query,
      rpc: () =>
        Promise.resolve(
          db.rpcFails
            ? { data: null, error: { message: "function not found" } }
            : { data: rows, error: null },
        ),
    },
  };
});

describe("LiveTransactions", () => {
  beforeEach(() => {
    db.rpcFails = false;
    db.tableFails = false;
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("merges the latest completed Supabase transactions into the simulated feed", async () => {
    render(<LiveTransactions />);

    await waitFor(() => expect(screen.getAllByText("Roket User")).toHaveLength(2));

    expect(screen.getByText("+$250")).toBeInTheDocument();
    expect(screen.getByText("−$75")).toBeInTheDocument();

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem").length).toBeLessThanOrEqual(5);
  });

  it("falls back to the transactions table when the RPC is unavailable", async () => {
    db.rpcFails = true;
    render(<LiveTransactions />);

    await waitFor(() => expect(screen.getAllByText("Roket User")).toHaveLength(2));
    expect(screen.getByText("+$250")).toBeInTheDocument();
  });

  it("keeps the simulated feed alive when Supabase is unreadable", async () => {
    db.rpcFails = true;
    db.tableFails = true;
    render(<LiveTransactions />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.queryByText("Roket User")).toBeNull();
  });

  it("keeps looping the merged feed without overflowing the list", async () => {
    vi.useFakeTimers();
    render(<LiveTransactions />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByText("Roket User")).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeLessThanOrEqual(5);
    expect(screen.getAllByText("Roket User").length).toBeGreaterThan(0);
  });
});
