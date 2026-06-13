// The pre-generated reading bundle — all 1,728 placements (12 planets × 12
// signs × 12 houses) keyed by `${planet}-${sign}-${house}`. Fetched lazily,
// held in memory, and kept in a persistent service-worker cache so casts are
// instant and work offline.

let bundle = null;
let pending = null;

export function loadReadings() {
  if (bundle) return Promise.resolve(bundle);
  if (pending) return pending;
  pending = fetch('./readings.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => { bundle = j; return j; })
    .catch(err => { pending = null; throw err; });
  return pending;
}
