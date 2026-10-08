---
name: demo
description: A fixture skill for the build tests. It renders vars and host blocks.
license: MIT
metadata:
  author: fixture
---

# demo

Deep work runs on `{{tier.deep}}` and fast work on `{{tier.fast}}`. Role files live in `{{agents.dir}}`.

<!-- @if claude -->

Dispatch with the `{{tool.agent}}` tool and `{{tool.agentType}}`.

<!-- @endif -->
<!-- @if codex,agy -->

Dispatch with `{{tool.agent}}`.

<!-- @endif -->
