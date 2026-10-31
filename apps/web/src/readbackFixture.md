# Synthetic P9 readbacks

`createReadbackFixture` is a test-only gate for the three adverse scenarios found in P9 review: (1) committed or uncommitted attachment after a lost acknowledgement and reload, (2) overlapping A/B thread-link reads where the older failure must not permit late navigation, and (3) unchanged roster facts observed at advancing times versus a genuine semantic change. Reads are immediate until `arm()`; afterward each keyed read waits for an explicit `resolve` or `reject`, so tests choose completion order. `advanceObservation()` changes only the observation clock; fixtures keep their semantic facts unchanged unless a test explicitly changes them.

Keep supplied rooms, sessions and responses visibly synthetic. This utility coordinates only test readbacks; it is not a timer, production API or general request-mocking layer.
