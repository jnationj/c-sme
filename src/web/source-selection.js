(function (root) {
  "use strict";

  function toAtomic(value) {
    var match = String(value).match(/^(\d+)(?:\.(\d{1,6}))?$/);
    if (!match) throw new Error("invalid USD amount");
    return BigInt(match[1]) * 1000000n + BigInt((match[2] || "").padEnd(6, "0") || "0");
  }

  function fromAtomic(value) {
    var whole = value / 1000000n;
    var fraction = String(value % 1000000n).padStart(6, "0").replace(/0+$/, "");
    return fraction ? whole + "." + fraction : String(whole);
  }

  function create(steps, feeUsd) {
    var ids = steps.map(function (step) { return step.capabilityId; });
    if (new Set(ids).size !== ids.length) throw new Error("plan contains duplicate service IDs");
    var selected = new Set(steps.filter(function (step) {
      return step.selected === true || (step.selected !== false && step.recommended !== false);
    }).map(function (step) { return step.capabilityId; }));
    var fee = toAtomic(feeUsd);

    return {
      has: function (id) { return selected.has(id); },
      toggle: function (id, checked) {
        if (ids.indexOf(id) < 0) throw new Error("unknown service ID");
        if (checked) selected.add(id);
        else selected.delete(id);
      },
      ids: function () { return ids.filter(function (id) { return selected.has(id); }); },
      totals: function () {
        var data = steps.reduce(function (sum, step) {
          return selected.has(step.capabilityId) ? sum + toAtomic(step.usd) : sum;
        }, 0n);
        var count = selected.size;
        return {
          dataUsd: fromAtomic(data),
          feeUsd: count ? fromAtomic(fee) : "0",
          customerUsd: fromAtomic(data + (count ? fee : 0n)),
          count: count,
        };
      },
    };
  }

  function createConfirmation() {
    var generation = 0, planId = null, busy = false, quote = null;
    function current(ticket) {
      return ticket && ticket.generation === generation && ticket.planId === planId;
    }

    return {
      state: function () {
        return { busy: busy, valid: !!quote && quote.selectedServiceIds.length > 0, quote: quote };
      },
      invalidate: function () {
        generation++;
        planId = null;
        busy = false;
        quote = null;
      },
      submit: function (id, serviceIds, request) {
        generation++;
        planId = id;
        busy = true;
        quote = null;
        var ticket = { generation: generation, planId: id };
        var requested = serviceIds.slice();
        var staleResult = { stale: true };
        return Promise.resolve()
          .then(function () {
            return current(ticket) ? request({ planId: id, serviceIds: requested }) : staleResult;
          })
          .then(function (response) {
            if (response === staleResult) return response;
            if (!current(ticket)) return { stale: true };
            if (!response || response.id !== id || !Array.isArray(response.selectedServiceIds) ||
              response.selectedServiceIds.some(function (selectedId) {
                return typeof selectedId !== "string" || requested.indexOf(selectedId) < 0;
              })) {
              throw new Error("the server returned an invalid source selection");
            }
            quote = response;
            busy = false;
            return { stale: false, quote: response };
          })
          .catch(function (error) {
            if (!current(ticket)) return { stale: true };
            busy = false;
            quote = null;
            return { stale: false, error: error };
          });
      },
    };
  }

  root.CPilotSelection = { create: create, createConfirmation: createConfirmation };
})(typeof window === "undefined" ? globalThis : window);
