# Writing for people and later reuse

Use this when another session, an automated consumer, or a later reader must
recover exact facts from the text. Keep the explanation understandable to the
person using it. Machine-readable detail is useful only when the task needs it.

- Use an absolute date when a relative date would become ambiguous after the
  handoff. Include a time zone when the time matters. "Tomorrow" can be fine in
  a live exchange with shared context.
- Identify files and commands precisely enough for the intended environment.
  A repository-relative path is often more portable than a machine-specific
  absolute path. State the working directory when a command depends on it.
- Use the consumer's required schema or status vocabulary when one exists.
  Otherwise use consistent, understandable labels. Distinguish a failed check
  from one that was not run.
- Make pronoun references unambiguous, especially where an excerpt may be read
  alone. Repeat a name when needed rather than applying a fixed distance rule.
- Group related facts so their conditions remain visible. Use tables or lists
  when they help retrieval, without breaking an explanation into isolated facts.
- Preserve exact identifiers, units, error messages, and syntax. Explain what
  they mean in surrounding prose when a human reader needs that context.

These are practical handoff conventions, not results of the language study.
Do not add schemas, full transcripts, or operational details to an ordinary
answer unless they help its intended use.
