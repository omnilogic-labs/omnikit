---
type: llm
weight: 1
---

The response identifies the most likely cause as using a key from the wrong Render account (or a stale cached key) since each account has its own authorized keys, and recommends switching to the key for the account that owns the service (ideally cached per account) and retrying, rather than retrying the same key or disabling host key checks.
