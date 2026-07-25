import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // server.test.ts spawns node servers that bind to ports. Keep files sequential and
    // worker count bounded so a machine running other suites alongside this one does not
    // oversubscribe the CPU and blow boot timeouts. Insurance for future spawning tests too.
    fileParallelism: false,
    maxWorkers: 2,
    // Several suites defer heavy work into beforeAll (dynamic import of the server
    // module so mocks hoist first; spawning node servers). Under CPU contention the
    // default 10s hook budget is too tight and times the hook out intermittently —
    // give it headroom so a slow machine doesn't produce a false failure.
    hookTimeout: 30000,
    watch: false,
  },
});
