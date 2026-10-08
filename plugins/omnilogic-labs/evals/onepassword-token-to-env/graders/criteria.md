---
type: llm
weight: 1
---

The response captures the value into an environment variable via the op-secret helper (command substitution) or uses op run/op inject with an op:// reference. It does not write the secret to a file, echo it, or place it as a literal on a command line.
