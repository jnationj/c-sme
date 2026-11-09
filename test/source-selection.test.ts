import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Quote = {
  id: string;
  selectedServiceIds: string[];
  dataUsd: string;
  feeUsd: string;
  customerUsd: string;
};

type Confirmation = {
  state(): { busy: boolean; valid: boolean; quote: Quote | null };
  invalidate(): void;
  submit(
    planId: string,
    serviceIds: string[],
    request: (selection: { planId: string; serviceIds: string[] }) => Promise<Quote>,
  ): Promise<{ stale: boolean; quote?: Quote; error?: Error }>;
};

type SelectionApi = {
  create(steps: Array<{ capabilityId: string; recommended?: boolean; selected?: boolean }>, feeUsd: string): {
    ids(): string[];
  };
  createConfirmation(): Confirmation;
};

function selectionApi(): SelectionApi {
  const sandbox: { CPilotSelection?: SelectionApi } = {};
  const source = readFileSync(fileURLToPath(new URL("../src/web/source-selection.js", import.meta.url)), "utf8");
  runInNewContext(source, sandbox);
  if (!sandbox.CPilotSelection) throw new Error("source selection helper did not initialize");
  return sandbox.CPilotSelection;
}

describe("source selection confirmation", () => {
  it("submits recommended IDs and keeps the quote invalid until the server confirms it", async () => {
    const api = selectionApi();
    const defaults = api.create([
      { capabilityId: "recommended", recommended: true },
      { capabilityId: "optional", recommended: false },
    ], "0.02");
    const confirmation = api.createConfirmation();
    let resolveRequest!: (quote: Quote) => void;
    const request = (selection: { planId: string; serviceIds: string[] }) => {
      expect(selection).toEqual({ planId: "plan-a", serviceIds: ["recommended"] });
      return new Promise<Quote>((resolve) => { resolveRequest = resolve; });
    };

    const pending = confirmation.submit("plan-a", defaults.ids(), request);
    expect(confirmation.state()).toMatchObject({ busy: true, valid: false, quote: null });
    await Promise.resolve();
    resolveRequest({
      id: "plan-a",
      selectedServiceIds: ["recommended"],
      dataUsd: "0.005",
      feeUsd: "0.02",
      customerUsd: "0.025",
    });

    const result = await pending;
    expect(result).toMatchObject({ stale: false, quote: { selectedServiceIds: ["recommended"], customerUsd: "0.025" } });
    expect(confirmation.state()).toMatchObject({ busy: false, valid: true });
  });

  it("uses the server-confirmed selection and quote after a selection change", async () => {
    const confirmation = selectionApi().createConfirmation();
    const quote: Quote = {
      id: "plan-a",
      selectedServiceIds: ["optional"],
      dataUsd: "0.009",
      feeUsd: "0.02",
      customerUsd: "0.029",
    };

    const result = await confirmation.submit("plan-a", ["optional"], async (selection) => {
      expect(selection.serviceIds).toEqual(["optional"]);
      return quote;
    });

    expect(result.quote).toBe(quote);
    expect(confirmation.state()).toMatchObject({ valid: true, quote: { selectedServiceIds: ["optional"], customerUsd: "0.029" } });
  });

  it("keeps confirmation invalid after a failed selection request", async () => {
    const confirmation = selectionApi().createConfirmation();
    const result = await confirmation.submit("plan-a", ["recommended"], async () => {
      throw new Error("catalogue unavailable");
    });

    expect(result.error).toEqual(new Error("catalogue unavailable"));
    expect(confirmation.state()).toMatchObject({ busy: false, valid: false, quote: null });
  });

  it("does not let a stale plan response overwrite the newer confirmed plan", async () => {
    const confirmation = selectionApi().createConfirmation();
    let resolveOld!: (quote: Quote) => void;
    const oldRequest = confirmation.submit("old-plan", ["old"], () =>
      new Promise<Quote>((resolve) => { resolveOld = resolve; }));
    await Promise.resolve();
    const currentQuote: Quote = {
      id: "new-plan",
      selectedServiceIds: ["new"],
      dataUsd: "0.004",
      feeUsd: "0.02",
      customerUsd: "0.024",
    };
    const currentResult = await confirmation.submit("new-plan", ["new"], async () => currentQuote);

    resolveOld({
      id: "old-plan",
      selectedServiceIds: ["old"],
      dataUsd: "0.01",
      feeUsd: "0.02",
      customerUsd: "0.03",
    });

    expect(currentResult.quote).toBe(currentQuote);
    expect(await oldRequest).toEqual({ stale: true });
    expect(confirmation.state()).toMatchObject({ valid: true, quote: { id: "new-plan", customerUsd: "0.024" } });
  });

  it("never treats an empty confirmed selection as payable", async () => {
    const confirmation = selectionApi().createConfirmation();
    await confirmation.submit("plan-a", [], async () => ({
      id: "plan-a",
      selectedServiceIds: [],
      dataUsd: "0",
      feeUsd: "0",
      customerUsd: "0",
    }));

    expect(confirmation.state()).toMatchObject({ busy: false, valid: false, quote: { selectedServiceIds: [] } });
  });
});
