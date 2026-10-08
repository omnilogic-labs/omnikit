# Rewrites

Before and after pairs, with the reason for each change. The "before" versions
are all grammatical and fluent. That is the point: the problem is rarely bad
grammar, it is a sentence built to sound good rather than to be understood.

## 1. The claim arrives last

**Before**

> Given that the daemon holds one WebAssembly instance for every session, and
> that a double free returns success while poisoning the allocator, the blast
> radius of a single handle-management mistake is every session on the machine.

**After**

> One mistake in handle management can kill every session on the machine. All
> sessions share one WebAssembly instance, and freeing a terminal twice reports
> success while leaving the allocator broken.

The reader now knows the consequence before they read the mechanism. The
mechanism still follows in full.

## 2. Invented vocabulary

**Before**

> The seam is the load-bearing part here: it is what lets a second engine slot in
> without the daemon knowing.

**After**

> The engine interface in `src/engine/types.ts` is what makes a second emulator
> possible. The daemon calls that interface and never calls a library directly.

"Seam" and "load-bearing" are metaphors the writer chose. The replacement names
the actual file and says what it does.

## 3. Abstraction instead of measurement

**Before**

> Throughput is more than adequate for the fan-out design, with significant
> headroom on all three streams.

**After**

> Throughput is 128 to 142 MiB/s on the recorded corpus, 449 to 562 MiB/s on
> plain text, and 89 to 93 MiB/s on colour-heavy output. The threshold that would
> have changed the design is 20 MiB/s.

"Adequate" and "significant headroom" are judgements. The numbers let the reader
judge for themselves, and they stay true when the threshold changes.

## 4. The em dash aside

**Before** (the one em dash in this repository, kept as the example to remove)

> The client library is Bun-only — which is fine for a Bun web server in front of
> the daemon — so the browser gets frames over a WebSocket instead.

**After**

> The client library only runs on Bun. That is fine, because the web server in
> front of the daemon is also Bun. The browser gets frames over a WebSocket
> instead.

Three facts were packed into one sentence with two asides. Splitting them makes
each one checkable, and shows that the middle clause was doing real work rather
than decoration.

## 5. Contrast the reader did not ask for

**Before**

> This is not a performance problem, it is a policy problem.

**After**

> The mechanism is fast enough. The limit is set in bytes, and bytes are the
> wrong unit for a client on the other end of a network.

The "not X, it is Y" shape implies the reader suspected a performance problem.
The rewrite says what is true without arguing with a position nobody held.

## 6. One sentence doing four jobs

**Before**

> The daemon owns the size of a session and the most recent attacher wins, which
> is fine for one user on two terminals and wrong for two users, though the
> product will have to decide whether later attachers are clamped, told, or
> refused.

**After**

> The daemon owns the size of a session. Whoever attached most recently sets it,
> and the earlier client is not told. That works for one person with two
> terminals. It breaks for two people. Nobody has decided whether later attachers
> should be clamped, notified, or refused.

Five facts, five sentences. Nothing was cut.

## 7. Hedging that hides the confidence

**Before**

> It seems like this might possibly be an allocator artefact of some kind, though
> that is not entirely certain.

**After**

> This is probably an artefact of libghostty's allocator. The evidence is that it
> reproduces without the daemon, and that it depends on the terminal's memory
> layout when it is freed rather than on how much data passed through it. It has
> not been confirmed upstream.

The confidence is stated once, the evidence is given, and the limit of the claim
is explicit.

## 8. Inanimate subjects

**Before**

> The measurement wants to say that the bound is really a time budget.

**After**

> The measurement shows that a client which pauses for 50 milliseconds is treated
> as lagging. That means the limit behaves as a time budget, not a size.

A measurement does not want anything. Naming what it shows, and then drawing the
conclusion separately, makes both checkable.

## 9. Context the reader does not have

**Before**

> Corpses restore fine, but a mismatch is listed and not decoded.

**After**

> A session restored from a snapshot after the daemon restarts is called a
> corpse. Corpses restore correctly. If the snapshot was written by a different
> build of the terminal library, the daemon lists the session but does not decode
> it, and says which two builds disagree.

The first version assumes the reader knows a project term and a rule. The second
supplies both in one extra sentence each.

## 10. A heading that asks instead of tells

**Before**

> ### So how bad is the Windows situation?

**After**

> ### Windows runs sessions, slowly, and cannot be reached the same way

A reader scanning the headings now knows the answer without opening the section.

## 11. The closing line that repeats the section

**Before**

> ...and so the fast client received every byte while the stopped one was
> repainted on recovery.
>
> In short, the mechanism works exactly as designed.

**After**

> ...and so the fast client received every byte while the stopped one was
> repainted on recovery.

The summary added nothing that the preceding sentence had not just said.

## 12. Compression that only the author can undo

**Before**

> Snapshot compatibility keyed on the pin rather than the format is the cheapest
> rule that can never be wrong, at the cost of every release invalidating the
> fleet.

**After**

> The daemon refuses to read a snapshot unless it was written by the exact same
> build of the terminal library. That rule can never produce a wrong screen,
> which is why it was chosen. The cost is that updating the library makes every
> saved session on every machine unreadable.

The original packs a rule, its justification and its cost into one sentence with
three noun phrases doing the work. The rewrite gives each its own sentence.

## A whole paragraph

**Before**

> The one row the proof of concept does not simply clear is trap isolation, and
> it clears in the project's favour differently than feared: the shared instance
> is robust to everything a session's own output can do to it, and fragile only
> to a control-flow bug in our own handle management, which instance-per-session
> would contain.

**After**

> Fault isolation is the one question without a clean answer, and the answer is
> better than expected. No sequence of bytes a session prints can break the
> shared WebAssembly instance: the fuzz corpus feeds it random bytes and random
> escape sequences and it never faults. It breaks only when werk's own code
> mishandles a terminal handle, for example by freeing one twice. Giving each
> session its own instance would limit that damage to one session.

The rewrite is longer. It is also readable once, by someone who has not been
following the work, which the original is not.
