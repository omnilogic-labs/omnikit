#!/bin/bash
# tokens.sh [base]: the context-size change from replacing the inbox tool and
# skill with omsg, and the bytes omsg prints in the common cases.
#
# Removed (from <base>, default the last commit before omsg landed): the
# mcp__omnilogic-labs__inbox tool definition as the model sees it (name,
# description and input schema as compact JSON) and the inbox skill's listing
# line. Added: the omsg skill's listing line and, in Claude, the mail rule told
# once per session. Tokens are estimated at 4 bytes per token.
set -e
source "$(dirname "$(realpath "$0")")/lib.sh"
base="${1:-$(git -C "$REPO" log --format=%H -1 --grep='^Add omsg core' main)^}"
git -C "$REPO" rev-parse -q --verify "$base" > /dev/null || fail "no base commit $base"
setup tokens

git -C "$REPO" show "$base:plugins/omnilogic-labs/hooks/register.tsx" > "$S/old-register.tsx"
git -C "$REPO" show "$base:plugins/omnilogic-labs/hooks/inbox.ts" > "$S/old-inbox.ts"
# The inbox tool's register call, evaluated with the constants it uses.
cat > "$S/inbox-tool.ts" << 'EOF'
const src = await Bun.file(process.argv[2]).text();
const consts = await Bun.file(process.argv[3]).text();
const start = src.indexOf("await $.tool.register({\n    name: INBOX_TOOL");
if (start < 0) throw new Error("no inbox tool in the base register.tsx");
const end = src.indexOf("\n  });", start);
const literal = src.slice(start + "await $.tool.register(".length, end + 4);
const constOf = (n: string) => {
  const m = consts.match(new RegExp(`const ${n} = ([^;]+);`));
  if (!m) throw new Error(`no const ${n}`);
  return m[1].replace(/ as const$/, "");
};
const def = new Function(
  "INBOX_TOOL", "KINDS", "STATES",
  `return (${literal});`
)("inbox", eval(constOf("KINDS")), eval(constOf("STATES")));
process.stdout.write(
  JSON.stringify({
    description: def.description,
    name: "mcp__omnilogic-labs__inbox",
    parameters: def.inputSchema,
  })
);
EOF
bun "$S/inbox-tool.ts" "$S/old-register.tsx" "$S/old-inbox.ts" > "$S/inbox-tool.json"

desc() { sed -n 's/^description: //p' | head -1; }
old_skill="- omnilogic-labs:inbox: $(git -C "$REPO" show "$base:src/skills/inbox/SKILL.md" | desc)"
new_skill="- omnilogic-labs:omsg: $(desc < "$REPO/src/skills/omsg/SKILL.md")"
rule="$(cd "$REPO" && bun -e 'import { MAIL_RULE } from "./plugins/omnilogic-labs/hooks/mail.ts"; process.stdout.write(MAIL_RULE)')"

b() { printf %s "$1" | wc -c; }
t() { echo $((($1 + 3) / 4)); }
tool=$(wc -c < "$S/inbox-tool.json")
os=$(b "$old_skill") ns=$(b "$new_skill") r=$(b "$rule")
removed=$((tool + os))
added=$((ns + r))
echo "base $(git -C "$REPO" rev-parse --short "$base") vs $(git -C "$REPO" rev-parse --short HEAD)"
echo "removed: inbox tool definition $tool B (~$(t "$tool") tok), inbox skill listing $os B (~$(t "$os") tok)"
echo "added:   omsg skill listing $ns B (~$(t "$ns") tok), Claude mail rule (once per session) $r B (~$(t "$r") tok)"
echo "net:     -$((removed - added)) B (~-$(t $((removed - added))) tok) per Claude session; -$((tool + os - ns)) B (~-$(t $((tool + os - ns))) tok) of standing listing"

# omsg's own output: a registered fake codex session mails the owner once.
echo "{\"session_id\":\"tok-$$\",\"cwd\":\"$S/work\"}" | omsg hook start --host codex --pid $$ > /dev/null
me="$(omsg --as owner --json who | jq -r '.[0].name')"
omsg --as "$me" send owner "hello" > /dev/null
read_bytes=$(omsg --as owner read | wc -c)
count_bytes=$(omsg --as owner count | wc -c)
echo "omsg read with one 5-byte message: $read_bytes B; omsg count with none: $count_bytes B"
echo "PASS"
