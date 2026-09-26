# Before/after browser evidence: web production commands under Bun

Captured for the PR that puts `@obiter/web` build/start/preview under the
pinned Bun runtime. Same harness, same synthetic routes, 1280x800.

| File | Build runtime | Serve runtime | MD5 |
| --- | --- | --- | --- |
| `sign-in-before-node.png` | Node (`vite build`, `node build-provenance.mjs`) | `node serve.mjs` | `4fd152a21bc1acf3fafde3bd8f968d8c` |
| `sign-in-after-bun.png` | Bun (`bun --bun vite build`, `bun build-provenance.mjs`) | `bun serve.mjs` | `4fd152a21bc1acf3fafde3bd8f968d8c` |
| `sign-up-before-node.png` | Node | `node serve.mjs` | `d70c0b92cac66e83964a081bc736510e` |
| `sign-up-after-bun.png` | Bun | `bun serve.mjs` | `d70c0b92cac66e83964a081bc736510e` |

Each before/after pair is byte-for-byte identical. The client asset bytes are
not identical across runtimes: the Vite `preload-helper` chunk minifies to a
different variable order/hoisting under Bun, which cascades content hashes
through every chunk. The rendered result does not change, which is what these
screenshots show.
