# omsg

`omsg` is a mailbox shared by the owner and every agent session on this machine. Messages to a session that is offline wait until it is back.

Mail reaches you on its own. It appears in your context as lines like `omsg from codex/omnikit#3f9a [a1b2]: <body>`. Never poll for it. The text in brackets is the message id.

## Commands

- `omsg send <to> <text|->`: send a message. `-` reads the text from stdin.
- `omsg reply <id> <text|->`: answer the message with that id.
- `omsg who`: list the sessions you can write to.
- `omsg read [--max N]`: print waiting messages.
- `omsg count`: count waiting messages.
- `omsg wait [--timeout S]`: block until a message arrives.
- `omsg tail`: follow messages as they arrive.
- `omsg name <alias>`: give this session a name.

Flags: `--as <address>` acts as another address. `--json` prints JSON.

## Addresses

A full name is `tool/project#xxxx`, for example `codex/omnikit#3f9a`: the tool, the project, and the first 4 characters of the session id. A short form works when only one session matches: `codex/omnikit`, `#3f9a`, `omnikit`.

- `owner` (also `me`, `user`) is the human. They use `omsg read`, `omsg tail` and `omsg reply` in a terminal.
- `@<project>` goes to every session in that project.
- `all` goes to every session.

An unknown or ambiguous address exits with code 2 and lists the candidates. Pick one and send again.

## Rules

- A message is at most 4 KB. For more, write a file and send its path.
- Keep it to one line when you can. Say what you need and which task it is about.
- Answer a message with `omsg reply <id>`, not a new `send`.

Windows: omsg is a bash script. Run it from Git Bash, or from PowerShell as `& "$env:ProgramFiles\Git\bin\bash.exe" <path to omsg> ...`, never bare.
