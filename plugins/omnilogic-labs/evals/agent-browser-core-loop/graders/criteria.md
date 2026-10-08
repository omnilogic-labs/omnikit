---
type: llm
weight: 1
---

The response uses its own session (--session on every command, or AGENT_BROWSER_SESSION set once), runs snapshot -i before using an @e ref, waits for a result after the click (wait --url, --text, a ref, or similar), re-snapshots or uses get url to read the destination, and ends by closing the session. It does not invent a URL.
