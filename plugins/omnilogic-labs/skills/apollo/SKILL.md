---
name: apollo
description: >-
  Find and enrich people and companies in Apollo.io through its REST API while spending as few credits as possible. Use for "find leads in apollo", "apollo search", "get their email from apollo", "enrich these contacts", "apollo credits", or any Apollo.io prospecting task.
---

# apollo

`bin/apollo` (relative to this SKILL.md's directory) wraps the Apollo.io REST API. It is plain bash and needs `curl` and `jq`. On Windows run it from Git Bash, or from PowerShell as `& "$env:ProgramFiles\Git\bin\bash.exe" <skill dir>/bin/apollo ...`, never bare (Windows opens an "Open with" dialog and hangs).

## Credits are the budget

Apollo charges by endpoint, not by tool. The rule: **search free, then enrich only the people the owner actually wants.**

| Command                                       | Cost                                                              |
| --------------------------------------------- | ----------------------------------------------------------------- |
| `apollo credits`                              | 0                                                                 |
| `apollo people ...` (search)                  | 0, but no emails or phones, and last names are masked             |
| `apollo enrich --spend ...`                   | 1 lead credit per matched person; 0 when there is no match        |
| `apollo enrich --spend --phone --webhook URL` | up to 9 per person (8 more per mobile number). Avoid unless asked |
| `apollo org --spend <domain>`                 | 1 per company                                                     |
| `apollo companies --spend ...`                | 1 per page of up to 100                                           |

Every paid command refuses to run without `--spend`, prints the most it can cost, and afterwards reports what Apollo counted as used. Cached answers cost nothing, so a command whose answers are all cached runs without `--spend`. Before a paid run of more than about 25 credits, tell the owner the ceiling and get a yes. Never add `--phone` or `--personal-email` unless the owner asked for phones or personal emails.

## Cache: never pay twice

Every paid result is saved under `~/.local/share/apollo` (override with `APOLLO_CACHE_DIR`; directory 700, files 600) and is reused before any paid call:

- Enriched people are stored by Apollo id and indexed by email, LinkedIn URL, and name + company domain. A later `enrich` by any of those reads the cache, and only the people not yet cached are sent (and counted in the ceiling).
- `org` is cached by domain. `companies` and paid `api` calls are cached by exact request.
- `people` (free search) marks rows `cached true` when that person is already enriched.
- Entries never expire. Use `--refresh` only when the owner wants fresh data (for example someone changed jobs). `--personal-email` refetches people cached without personal emails. `--phone` always calls Apollo, because phones arrive by webhook and are never cached.
- No-match results are not cached; they cost nothing.
- `apollo cache` shows counts; `apollo cache show <id|email|linkedin url|domain>` prints one record.

Never delete the cache to "clean up": every file in it cost a credit.

## Key (bring your own)

The script reads `APOLLO_API_KEY`, else the file named by `APOLLO_API_KEY_FILE`, else `~/.config/apollo/api_key`. If none is set, fetch the key once with the `onepassword` skill's `bin/op-secret` and cache it:

```bash
<onepassword skill dir>/bin/op-secret --item "<apollo item>" --field credential --out ~/.config/apollo/api_key
```

A master API key covers every endpoint. A narrower key returns 403 on endpoints it was not granted. Never print the key.

## Workflow

1. `apollo credits` to see what is left.
2. Search for free. Narrow with filters until the list is about right:

   ```bash
   apollo people --title "head of marketing" --title "vp marketing" \
     --employees 51,200 --location "united states" --per-page 50
   apollo people --domain hubspot.com --seniority director --seniority vp
   apollo people --name "Grace Lee" --domain hubspot.com
   ```

   Output is TSV: `id name title company has_email direct_phone cached`. Skip rows with `has_email false` before enriching: they will usually cost a credit and return no email. Rows with `cached true` are free to enrich again.

3. Enrich the chosen ids (10 per API call, batched for you):

   ```bash
   apollo enrich --spend 5b957513324d446922d3991b 6100e8a2a867c900016e8be3
   apollo people --domain acme.com --title cto | awk -F'\t' '$5=="true"' | apollo enrich --spend -
   ```

   Output is TSV: `id name title company email email_status linkedin location`. Treat `email_status` other than `verified` as a guess.

4. Enrich one person you already know about without searching:

   ```bash
   apollo enrich --spend --linkedin https://www.linkedin.com/in/someone
   apollo enrich --spend --name "Jane Doe" --domain acme.com
   apollo enrich --spend --email jane@acme.com
   ```

## Saving tokens

- Default output is compact TSV with only the useful columns. Add `--json` only when you need a field the TSV leaves out.
- Use `--per-page` to fetch what you need. Free search pages are up to 100.
- Status lines (match counts, credit ceilings, credits used) go to stderr, data to stdout, so `> file.tsv` captures just the rows.

## Anything else

`apollo api METHOD PATH [JSON]` calls any endpoint, such as contacts, sequences, deals, or tasks. Known paid paths still need `--spend`:

```bash
apollo api POST /contacts/search '{"q_keywords":"acme","per_page":10}'
apollo api GET /organizations/5f5e2b...
```

Endpoints, filters, and credit rules: `references/api.md`.

## Errors

- `401`: wrong or missing key.
- `403`: the key lacks that endpoint's scope; use a master key.
- `422`: bad filter value (for example over 100 titles).
- `429`: rate limited; wait and retry once.
