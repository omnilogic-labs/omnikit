// Questionnaire page script. Classic script, no imports: build.mjs inlines it
// after the spec, which sits in <script type="application/json" id="q-spec">.
(function () {
  "use strict";

  var spec = JSON.parse(document.getElementById("q-spec").textContent);
  var questions = spec.questions;
  var STORE_KEY = "questionnaire:" + spec.title + ":" + questions.map((q) => q.id).join(",");

  // answers[id] = { choices: [value, ...], idk: bool, note: string }
  var answers = {};
  questions.forEach(function (q) {
    answers[q.id] = { choices: [], idk: false, note: "" };
  });
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (saved) {
      questions.forEach(function (q) {
        var s = saved[q.id];
        if (!s) return;
        var known = q.options.map((o) => o.value);
        answers[q.id] = {
          choices: (s.choices || []).filter((v) => known.indexOf(v) !== -1),
          idk: s.idk === true,
          note: typeof s.note === "string" ? s.note : "",
        };
      });
    }
  } catch (e) {
    // storage refused or corrupt: start empty
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(answers));
    } catch (e) {
      // per-viewer convenience only
    }
  }

  // ---------- text ----------

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>'
      );
  }

  // A small, safe markdown subset: paragraphs, - and 1. lists, # headings,
  // `code`, **bold**, *italic*, [links](https://...). Plain text renders as-is.
  function md(src) {
    if (!src) return "";
    return String(src)
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map(function (block) {
        var lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            "<ul>" +
            lines.map((l) => "<li>" + inline(l.replace(/^\s*[-*] /, "")) + "</li>").join("") +
            "</ul>"
          );
        }
        if (lines.every((l) => /^\s*\d+[.)] /.test(l))) {
          return (
            "<ol>" +
            lines.map((l) => "<li>" + inline(l.replace(/^\s*\d+[.)] /, "")) + "</li>").join("") +
            "</ol>"
          );
        }
        var h = /^#{1,6} (.*)$/.exec(block);
        if (h && lines.length === 1) return '<p class="md-h">' + inline(h[1]) + "</p>";
        return "<p>" + lines.map(inline).join("<br>") + "</p>";
      })
      .join("");
  }

  // ---------- answer block ----------

  function optionText(q, value) {
    var o = q.options.find((x) => x.value === value);
    if (!o) return value;
    return o.label === o.value ? o.label : o.label + " [" + o.value + "]";
  }

  function answerBlock() {
    var answered = questions.filter((q) => answers[q.id].idk || answers[q.id].choices.length > 0);
    var open = questions.filter((q) => answered.indexOf(q) === -1);
    var out = ["Answers: " + spec.title];
    out.push(
      "(" +
        answered.length +
        " of " +
        questions.length +
        " answered" +
        (open.length ? "; unanswered: " + open.map((q) => q.id).join(", ") : "") +
        ")"
    );
    questions.forEach(function (q) {
      var a = answers[q.id];
      out.push("");
      out.push(q.id + ". " + q.title + (q.blocking ? " [blocking]" : ""));
      var answer;
      if (a.idk) answer = "I don't know. Default applies: " + q.idk;
      else if (a.choices.length) answer = a.choices.map((v) => optionText(q, v)).join("; ");
      else answer = "(no answer yet)";
      out.push("  Answer: " + answer);
      if (a.note.trim()) out.push("  Note: " + a.note.trim().replace(/\s*\n\s*/g, " / "));
    });
    return out.join("\n");
  }

  // ---------- render ----------

  if (spec.intro) document.getElementById("q-intro").innerHTML = md(spec.intro);
  var list = document.getElementById("q-list");
  questions.forEach(function (q, i) {
    var multi = q.multi === true;
    var name = "q-" + i;
    var type = multi ? "checkbox" : "radio";
    var html = '<article class="q" id="q-card-' + i + '">';
    html += '<header class="q-head"><span class="q-id">' + esc(q.id) + "</span>";
    if (q.tag) html += '<span class="chip">' + esc(q.tag) + "</span>";
    if (q.blocking) html += '<span class="chip chip-block">Blocking</span>';
    html += '<span class="q-state" id="q-state-' + i + '"></span></header>';
    html += "<h2>" + esc(q.title) + "</h2>";
    if (q.background)
      html += '<section class="q-sec"><h3>Background</h3>' + md(q.background) + "</section>";
    if (q.what_happened)
      html += '<section class="q-sec"><h3>What happened</h3>' + md(q.what_happened) + "</section>";
    if (q.images && q.images.length) {
      html += '<div class="figs">';
      q.images.forEach(function (img) {
        html +=
          '<figure><img src="' +
          esc(img.path) +
          '" alt="' +
          esc(img.caption || "") +
          '" loading="lazy">' +
          (img.caption ? "<figcaption>" + inline(img.caption) + "</figcaption>" : "") +
          "</figure>";
      });
      html += "</div>";
    }
    html +=
      '<fieldset class="opts"><legend>' +
      (multi ? "Choose any that apply" : "Choose one") +
      "</legend>";
    q.options.forEach(function (o, j) {
      var id = name + "-opt-" + j;
      html +=
        '<label class="opt" for="' +
        id +
        '"><input type="' +
        type +
        '" id="' +
        id +
        '" name="' +
        name +
        '" value="' +
        esc(o.value) +
        '"><span class="opt-body"><span class="opt-label">' +
        esc(o.label) +
        "</span>" +
        (o.description ? '<span class="opt-desc">' + md(o.description) + "</span>" : "") +
        "</span></label>";
    });
    html +=
      '<label class="opt opt-idk" for="' +
      name +
      '-idk"><input type="' +
      type +
      '" id="' +
      name +
      '-idk" name="' +
      name +
      '" value="__idk__"><span class="opt-body"><span class="opt-label">I don\'t know</span>' +
      '<span class="opt-desc"><p>If you pick this: ' +
      inline(q.idk) +
      "</p></span></span></label>";
    html += "</fieldset>";
    html +=
      '<label class="note-label" for="' +
      name +
      '-note">Note (optional)</label><textarea class="note" id="' +
      name +
      '-note" rows="2" placeholder="Anything we should know about your answer"></textarea>';
    html += "</article>";
    list.insertAdjacentHTML("beforeend", html);
  });

  var output = document.getElementById("q-output");
  var plain = document.getElementById("q-plain");
  var progress = document.getElementById("q-progress");

  function syncInputs() {
    questions.forEach(function (q, i) {
      var a = answers[q.id];
      document.querySelectorAll('input[name="q-' + i + '"]').forEach(function (el) {
        el.checked = el.value === "__idk__" ? a.idk : !a.idk && a.choices.indexOf(el.value) !== -1;
      });
      document.getElementById("q-" + i + "-note").value = a.note;
    });
  }

  function refresh() {
    var text = answerBlock();
    output.value = text;
    plain.textContent = text;
    var done = 0;
    questions.forEach(function (q, i) {
      var a = answers[q.id];
      var ok = a.idk || a.choices.length > 0;
      if (ok) done++;
      var state = document.getElementById("q-state-" + i);
      state.textContent = ok ? "Answered" : "Open";
      state.className = "q-state " + (ok ? "is-done" : "is-open");
    });
    progress.textContent = done + " of " + questions.length + " answered";
    save();
  }

  list.addEventListener("change", function (e) {
    var m = /^q-(\d+)-(opt-\d+|idk)$/.exec(e.target.id || "");
    if (!m) return;
    var q = questions[Number(m[1])];
    var a = answers[q.id];
    var el = e.target;
    if (el.value === "__idk__") {
      a.idk = el.checked;
      if (el.checked) a.choices = [];
    } else if (q.multi === true) {
      a.idk = false;
      a.choices = a.choices.filter((v) => v !== el.value);
      if (el.checked) a.choices.push(el.value);
      // keep the spec's option order
      a.choices = q.options.map((o) => o.value).filter((v) => a.choices.indexOf(v) !== -1);
    } else if (el.checked) {
      a.idk = false;
      a.choices = [el.value];
    }
    syncInputs();
    refresh();
  });

  list.addEventListener("input", function (e) {
    var m = /^q-(\d+)-note$/.exec(e.target.id || "");
    if (!m) return;
    answers[questions[Number(m[1])].id].note = e.target.value;
    refresh();
  });

  // ---------- copy ----------

  var status = document.getElementById("q-status");

  function selectOutput() {
    output.hidden = false;
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
  }

  function copied(ok) {
    status.textContent = ok
      ? "Copied. Paste it into the chat."
      : "Copying was blocked here. The text is selected: press Ctrl+C (Cmd+C on a Mac), or long-press it and choose Copy.";
    status.className = "status " + (ok ? "is-ok" : "is-warn");
  }

  function legacyCopy() {
    selectOutput();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    copied(ok);
  }

  document.getElementById("q-copy").addEventListener("click", function () {
    var text = answerBlock();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        selectOutput();
        copied(true);
      }, legacyCopy);
    } else {
      legacyCopy();
    }
  });

  document.getElementById("q-select").addEventListener("click", function () {
    selectOutput();
    status.textContent = "Selected. Copy it with Ctrl+C (Cmd+C), or long-press and choose Copy.";
    status.className = "status";
  });

  var plainToggle = document.getElementById("q-plain-toggle");
  plainToggle.addEventListener("click", function () {
    var show = plain.hidden;
    plain.hidden = !show;
    output.hidden = show;
    plainToggle.textContent = show ? "Show the text box" : "Show as plain text";
  });

  document.getElementById("q-reset").addEventListener("click", function () {
    var btn = this;
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.textContent = "Click again to clear every answer";
      return;
    }
    btn.dataset.armed = "";
    btn.textContent = "Clear answers";
    questions.forEach(function (q) {
      answers[q.id] = { choices: [], idk: false, note: "" };
    });
    syncInputs();
    refresh();
  });

  syncInputs();
  refresh();
  window.questionnaire = { answerBlock: answerBlock, answers: answers };
})();
