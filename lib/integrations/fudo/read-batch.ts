/**
 * Read-only Fudo O1 imports are executed in a bounded batch.
 *
 * Sequentially reading five resources can exceed a 60s serverless invocation:
 * each provider GET is allowed up to 15s. Limit concurrency to three resources
 * while ensuring every launched read/persistence operation settles before the
 * caller marks a sync run as completed or failed.
 *
 * Failures are rethrown only after all workers finish. That prevents orphan
 * writes to the staging cursor after a sync run has already been marked failed.
 */
const MAX_PARALLEL_FUDO_READS = 3;

export async function runFudoReadBatch<T, R>(
  resources: readonly T[],
  readResource: (resource: T) => Promise<R>,
): Promise<R[]> {
  if (resources.length === 0) return [];
  const results = new Array<R>(resources.length);
  const failures: unknown[] = [];
  let nextIndex = 0;

  await Promise.all(Array.from(
    { length: Math.min(MAX_PARALLEL_FUDO_READS, resources.length) },
    async () => {
      // Once a resource fails, do not initiate reads for resources that have
      // not started. Already-launched reads and page commits must still settle
      // before the failed run is finalized; their durable cursors permit retry.
      while (nextIndex < resources.length && failures.length === 0) {
        const index = nextIndex++;
        try {
          results[index] = await readResource(resources[index]);
        } catch (error) {
          failures.push(error);
          // Stop scheduling fresh provider reads, but drain existing workers
          // before the server finalizes the failed run.
        }
      }
    },
  ));

  if (failures.length) throw failures[0];
  return results;
}
