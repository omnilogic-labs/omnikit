---
type: llm
weight: 1
---

The response uses --session on every command, runs snapshot -i before using an @e ref, waits (wait --load networkidle or similar) after the click, re-snapshots or uses get url to read the destination, and ends by closing the session. It does not invent a URL.
