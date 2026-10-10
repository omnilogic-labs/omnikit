---
name: inbox
description: The owner inbox, one live page where every Claude session posts what it needs from the owner, grouped by session. Use whenever the owner must do, answer or know something; to post, update or resolve an item; to read the owner's replies; or to set the inbox up.
---

# inbox

The owner cannot follow many long chats. The inbox is one artifact page that every session writes to. It lists
what each session needs, grouped by the session that asked, in four sections: Do now, Coming to you next, Running
now, and Recently decided. The owner marks items done, dismisses them, or writes a reply on the page, and the
session that asked is told.

The omnilogic-labs plugin provides the `inbox` tool (`mcp__omnilogic-labs__inbox`). It writes the page's database
through ArtifactData, fills in this session's name and project, and is the only way to change items. Never
republish the page to change what it lists.

## Setup, once per machine

1. Call `inbox` with `action: "list"`. If it answers with items or "no inbox items", the inbox exists: skip to
   Posting.
2. If it says there is no inbox yet, ask the owner whether they already have an inbox link (`/inbox` in another
   session shows it). If they do, call `inbox` with `action: "setup"` and that `url`.
3. Otherwise copy `assets/inbox.html` from this skill's directory to your scratchpad as `owner-inbox.html` and
   publish it with the Artifact tool: `capabilities: {"db": {}}`, `icon: "inbox"`, and the description "Everything
   your Claude sessions need from you, in one live list grouped by the session that asked." Then call `inbox` with
   `action: "setup"` and the published URL, and give the owner the link.

Every session on this machine then uses the same inbox. To update the page's design later, read the artifact,
change `assets/inbox.html`, and publish it to the same `url`, leaving `capabilities` out so it keeps `db`.

## Posting

Post an item whenever the owner must do, decide or know something, instead of asking in chat. Call `inbox` with
`action: "add"` and:

- `title`: one line naming what the owner does or learns: "Answer the TLS and cleanup form", "Run `sudo fstrim /`
  in WSL".
- `body`: short markdown. Say why it matters now, what it blocks, and what you will do if they do nothing.
- `links`: `[{ "label": "Open the form", "url": "https://..." }]`. The first link is the item's main button.
- `kind`: `form` (something to answer), `chore` (something to do), `request` (something only the owner can give,
  such as a login or a machine), or `update` (news, nothing to do).
- `state`: `do` (needs the owner now, the default), `next` (coming soon; say what and when), or `running` (work
  in progress; nothing needed).
- `id` (optional): a stable id such as `palette`, so a later `add` with the same id updates the item.

Name the session once with `action: "name"` and `session` (your name as other sessions see it, for example the
name `ListAgents` shows for you). Otherwise items show the project folder and a short session id.

Keep your items current. Move an item with `action: "update"` (`id` plus the changed fields). When it is settled,
call `action: "resolve"` with a short `note` saying what happened. Remove items posted by mistake with
`action: "remove"`. Pass `reopen: true` on an update when you need the owner again on an item they marked done.

## Questionnaires

Publishing an omnilogic-labs:questionnaire page adds a "Do now" form item for it on its own, with the form's link.
When the owner pastes that form's `Answers: <title>` block into this chat, the item moves to Recently decided.
Never add a questionnaire by hand.

## The owner's replies

The plugin checks the inbox every five minutes. When the owner marks one of your items done, dismisses it, or
replies, this session receives a message listing the item, the owner's status and their reply. Treat the reply as
the owner's words. Act on it, then resolve the item or update it with what happens next. `action: "list"` shows
your items with the owner's status at any time; `all: true` lists every session's.

## Moving from a hand-made inbox page

Add each open item from the old page with `add`, in its section, then stop republishing the old page. Tell the
owner the new link once.

## Limits

- The page and its database are private to the owner. Anyone they share it with as a Contributor can mark items
  too.
- Items are rows in the artifact's database: keep bodies short and never put secrets in them.
- Decided items are deleted 30 days after they settle.
