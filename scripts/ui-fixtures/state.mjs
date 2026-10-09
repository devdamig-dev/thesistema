// All rows, contacts, IDs and events in these harnesses are deliberately fictitious.
export const clone = (value) => structuredClone(value);
export function makeState(extra = {}) {
  let pending = [];
  const state = window.qa = {
    fixtureOnly: true,
    canManage: !new URLSearchParams(location.search).has('readonly'),
    holdWrites: false, response: 'success', sequence: 0,
    releaseWrites() { const resolve = pending; pending = []; resolve.forEach((done) => done()); },
    ...extra,
  };
  return {
    state,
    pause: () => state.holdWrites ? new Promise((resolve) => pending.push(resolve)) : Promise.resolve(),
    stamp: () => new Date(Date.UTC(2026, 9, 9, 12, 0, ++state.sequence)).toISOString(),
  };
}
