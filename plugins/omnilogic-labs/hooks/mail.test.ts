import { expect, test } from "claude-code/testing";

import {
  deliveredText,
  isSingleOmsg,
  mailArgs,
  parseCount,
  parseHookStart,
  parseRecords,
  questionnaireTitle,
} from "./mail";

test("parseHookStart reads the start line and refuses anything else", () => {
  const line = '{"name":"a","notify":"/n","seen":"/s","ownerNotify":"/on","ownerSeen":"/os"}';
  expect(parseHookStart(`noise\n${line}\n`)).toEqual({
    name: "a",
    notify: "/n",
    seen: "/s",
    ownerNotify: "/on",
    ownerSeen: "/os",
  });
  expect(parseHookStart("")).toBeNull();
  expect(parseHookStart("{not json")).toBeNull();
  expect(parseHookStart('{"name":""}')).toBeNull();
});

test("parseRecords and deliveredText give one line per message and the rest", () => {
  const records = parseRecords(
    '[{"id":"1","from":"x","body":"hi"},{"id":"2","from":"y","body":"yo"}]'
  );
  expect(deliveredText(records, 0)).toBe("omsg from x [1]: hi\nomsg from y [2]: yo");
  expect(deliveredText(records.slice(0, 1), 4)).toBe("omsg from x [1]: hi\n(+4 more: omsg read)");
  expect(parseRecords("[]")).toEqual([]);
  expect(parseRecords("")).toEqual([]);
  expect(parseRecords("{}")).toEqual([]);
});

test("parseCount is the number, 0 for nothing", () => {
  expect(parseCount("3\n")).toBe(3);
  expect(parseCount("")).toBe(0);
});

test("mailArgs maps /mail lines to owner commands", () => {
  expect(mailArgs("")).toEqual(["--as", "owner", "read"]);
  expect(mailArgs("reply ab12 ok then")).toEqual(["--as", "owner", "reply", "ab12", "ok then"]);
  expect(mailArgs("send all hello")).toEqual(["--as", "owner", "send", "all", "hello"]);
  expect(typeof mailArgs("send all")).toBe("string");
  expect(typeof mailArgs("delete 1")).toBe("string");
});

test("isSingleOmsg allows one plain omsg call only", () => {
  expect(isSingleOmsg("omsg who")).toBe(true);
  expect(isSingleOmsg('  omsg reply ab12 "thanks"')).toBe(true);
  for (const c of [
    "omsg x; rm -rf y",
    "omsg x && rm y",
    "omsg x | sh",
    "omsg send owner `id`",
    "omsg send owner $(id)",
    "omsg read > f",
    "omsg read < f",
    "omsg x\nrm y",
    "omsgx",
    "echo omsg",
  ]) {
    expect(isSingleOmsg(c)).toBe(false);
  }
});

test("questionnaireTitle finds a questionnaire page's title", () => {
  expect(questionnaireTitle('<title>A &amp; B</title><script id="q-spec"></script>')).toBe("A & B");
  expect(questionnaireTitle("<title>Plain</title>")).toBeNull();
});
