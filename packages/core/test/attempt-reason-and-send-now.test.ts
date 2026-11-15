/**
 * The reason an item's last attempt did not end in a confirmed delivery
 * (display only), and sendNow(): one replay pass of the same queue with the
 * same keys, without waiting for backoff.
 */
import { describe, expect, it } from "vitest";
import { claim, isSendable, retry, settle } from "../src/transitions.js";
import { DEFAULT_POLICY, ERROR_IN_PROGRESS, ERROR_KEY_CONFLICT, MemoryStore, Outbox, classifyResponse, classifyThrown, type AttemptOutcome, type OutboxItem } from "../src/index.js";
import { FakeServer } from "./fake-server.js";

const T0 = Date.parse("2026-11-15T12:00:00Z");

function sending(extra: Partial<OutboxItem> = {}): OutboxItem[] {
  return [{ key: "item-0001", kind: "post", payload: { text: "a" }, writtenAt: T0, state: "sending", attempts: 1, touched: true, claimedAt: T0, claimToken: "t", ...extra }];
}

function after(outcome: AttemptOutcome): OutboxItem {
  const items = sending();
  settle(items, "item-0001", "t", outcome, T0 + 1000, DEFAULT_POLICY);
  return items[0]!;
}

describe("lastAttempt: why the last attempt did not finish", () => {
  it("is no_answer when nothing came back: a network failure or a timeout", () => {
    expect(after(classifyThrown(new Error("Network request failed"))).lastAttempt).toBe("no_answer");
    expect(after({ type: "retry", noAnswer: true, timedOut: true }).lastAttempt).toBe("no_answer");
    expect(after(classifyResponse(0)).lastAttempt).toBe("no_answer");
  });

  it("is no_answer when a sender died mid-send and another takes the item over", () => {
    const items = sending({ claimedAt: T0 - 10 * 60 * 1000 });
    const taken = claim(items, "item-0001", "t2", T0, DEFAULT_POLICY);
    expect(taken).not.toBeNull();
    expect(items[0]!.lastAttempt).toBe("no_answer");
    expect(items[0]!.key).toBe("item-0001");
  });

  it("is server_busy for 408, 429 and 5xx, and while the server is still busy with the key", () => {
    for (const status of [408, 429, 500, 502, 503]) expect(after(classifyResponse(status)).lastAttempt, String(status)).toBe("server_busy");
    expect(after(classifyResponse(409, ERROR_IN_PROGRESS)).lastAttempt).toBe("server_busy");
  });

  it("is refused for any other 4xx and for a key the server holds with different content", () => {
    for (const status of [400, 404, 413, 422]) expect(after(classifyResponse(status)).lastAttempt, String(status)).toBe("refused");
    expect(after(classifyResponse(409, ERROR_KEY_CONFLICT)).lastAttempt).toBe("refused");
  });

  it("is cleared on delivery and when a person retries", () => {
    const items = sending({ lastAttempt: "no_answer" });
    settle(items, "item-0001", "t", { type: "sent" }, T0, DEFAULT_POLICY);
    expect(items[0]!.lastAttempt).toBeUndefined();

    const stuck = sending();
    settle(stuck, "item-0001", "t", classifyResponse(400), T0, DEFAULT_POLICY);
    expect(stuck[0]!.lastAttempt).toBe("refused");
    expect(retry(stuck, "item-0001", T0, () => "item-0002", DEFAULT_POLICY)).toMatchObject({ ok: true, newKey: false });
    expect(stuck[0]!.lastAttempt).toBeUndefined();
  });

  it("is never used to decide whether to send", () => {
    const base: OutboxItem = { key: "item-0001", kind: "post", payload: {}, writtenAt: T0, state: "waiting", attempts: 1, touched: true };
    for (const reason of ["no_answer", "server_busy", "refused"] as const) {
      expect(isSendable({ ...base, lastAttempt: reason }, T0, DEFAULT_POLICY)).toBe(isSendable(base, T0, DEFAULT_POLICY));
    }
  });

  it("is shown by list() after a lost answer", async () => {
    const server = new FakeServer();
    const outbox = new Outbox({ store: new MemoryStore(), send: server.sender({ loseResponses: 1 }), now: () => T0, policy: { claimRenewMs: 0 } });
    await outbox.add("post", { text: "hello" });
    await outbox.flush();
    const [entry] = await outbox.list();
    expect(entry?.item.lastAttempt).toBe("no_answer");
  });
});

describe("sendNow()", () => {
  it("replays the same item with the same key after a lost answer, and the server creates it once", async () => {
    const server = new FakeServer();
    const keysSeen: string[] = [];
    const send = server.sender({ loseResponses: 1 });
    const clock = { t: T0 };
    const outbox = new Outbox({
      store: new MemoryStore(),
      now: () => clock.t,
      policy: { claimRenewMs: 0 },
      send: (item, context) => {
        keysSeen.push(context.headers["Idempotency-Key"]!);
        return send(item, context);
      },
    });
    const added = await outbox.add("post", { text: "written in a tunnel" });

    // First attempt: the server creates the post, but the answer is lost.
    await outbox.flush();
    expect(server.created).toHaveLength(1);
    expect((await outbox.list())[0]?.item.lastAttempt).toBe("no_answer");

    // An ordinary flush waits for the backoff; sendNow does not.
    expect(await outbox.flush()).toMatchObject({ sent: 0 });
    expect(await outbox.sendNow()).toMatchObject({ sent: 1 });

    expect(keysSeen).toEqual([added.key, added.key]);
    expect(server.requests).toBe(2);
    expect(server.created).toHaveLength(1);
    expect(await outbox.list()).toEqual([]);
  });

  it("leaves items that wait for a person, and other people's items, alone", async () => {
    const server = new FakeServer();
    const outbox = new Outbox({ store: new MemoryStore(), send: server.sender(), now: () => T0, policy: { claimRenewMs: 0 } });
    await outbox.add("post", { text: "held" }, { owner: "a", decide: () => "hold" });
    await outbox.add("post", { text: "someone else's" }, { owner: "b" });
    expect(await outbox.sendNow("a")).toMatchObject({ sent: 0 });
    expect(server.created).toHaveLength(0);
    expect((await outbox.list()).map((e) => e.status).sort()).toEqual(["needs_confirmation", "waiting"]);
  });
});
