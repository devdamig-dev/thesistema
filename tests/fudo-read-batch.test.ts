import assert from "node:assert/strict";
import test from "node:test";
import { runFudoReadBatch } from "../lib/integrations/fudo/read-batch";

test("Fudo imports at most three resource pages at once and preserves resource result order", async () => {
  const resources = ["products", "ingredients", "providers", "orders", "sales"];
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  let releaseFirst: () => void = () => {};
  const firstWave = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const pending = runFudoReadBatch(resources, async (resource) => {
    active++;
    peak = Math.max(peak, active);
    started.push(resource);
    if (started.length === 3) releaseFirst();
    await firstWave;
    active--;
    return resource.toUpperCase();
  });
  const results = await pending;
  assert.equal(peak, 3);
  assert.equal(started.length, 5);
  assert.deepEqual(results, resources.map((resource) => resource.toUpperCase()));
});

test("Fudo sync drains in-flight page persistence before reporting an unrelated read failure", async () => {
  let startedSlow = false;
  let finishedSlow = false;
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const batch = runFudoReadBatch(["bad", "slow", "another"], async (resource) => {
    if (resource === "bad") throw new Error("sanitized_provider_failure");
    if (resource === "slow") {
      startedSlow = true;
      await slow;
      finishedSlow = true;
    }
    return resource;
  });
  // Give the worker a chance to begin, then unblock persistence.
  await Promise.resolve();
  assert.equal(startedSlow, true);
  assert.equal(finishedSlow, false);
  releaseSlow();
  await assert.rejects(batch, /sanitized_provider_failure/);
  assert.equal(finishedSlow, true, "no page write is left running after failure finalization");
});

test("Fudo stops scheduling new resource GETs after failure and drains already-started reads", async () => {
  const resources = ["bad", "in-flight-1", "in-flight-2", "not-started-1", "not-started-2"];
  const started: string[] = [];
  const finished: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const batch = runFudoReadBatch(resources, async (resource) => {
    started.push(resource);
    if (resource === "bad") throw new Error("first_fudo_resource_failed");
    await gate;
    finished.push(resource);
    return resource;
  });

  // The first wave launches three resources concurrently; the initial
  // rejection must not schedule a fourth or fifth provider GET.
  await Promise.resolve();
  assert.deepEqual(started, resources.slice(0, 3));
  release();
  await assert.rejects(batch, /first_fudo_resource_failed/);
  assert.deepEqual(started, resources.slice(0, 3),
    "no new Fudo reads start after a detected provider failure");
  assert.deepEqual(finished, resources.slice(1, 3),
    "already-started resource reads settle before the failed run is finalized");
});

test("Fudo read batch handles empty resource lists without provider calls", async () => {
  let calls = 0;
  const results = await runFudoReadBatch([] as string[], async () => { calls++; return true; });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});
