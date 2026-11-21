#!/usr/bin/env python3
"""Triage a feedback issue made from .github/ISSUE_TEMPLATE/feedback.yml.

Reads the issue body (``--body-file PATH`` or the ``ISSUE_BODY`` environment
variable, never a command-line argument), takes exactly one fenced JSON block
from the Diagnostics section, validates it against
doc/feedback/feedback-public.schema.json and prints one JSON object:

    {"ok": bool, "report_id": str|null, "errors": [...], "warnings": [...],
     "labels": [...], "fingerprint": str|null, "comment": str}

``labels`` only ever holds values from a fixed allow-list built from
validated fields (kind:bug|ui|idea|question, os:macos|windows|linux,
v:<major>.<minor>). ``comment`` starts with COMMENT_MARKER, so the workflow can
find and update its one comment. Neither the comment nor the errors repeat
text from the issue: they name fields by schema path and quote only values
that passed an enum or pattern check.

Standard library only, Python 3.10+. The validator covers the subset of JSON
Schema the public schema uses (listed in its description); any other keyword
is an error, so the schema cannot silently outgrow it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

COMMENT_MARKER = "<!-- fastag-feedback-triage -->"
SCHEMA_ID = "fastag-feedback-public/1"
SCHEMA_PREFIX = "fastag-feedback-public/"
MAX_BODY_CHARS = 262_144        # GitHub caps issue bodies at 65,536 characters
MAX_BLOCK_BYTES = 64 * 1024     # the diagnostics JSON block
MAX_ERRORS = 25
MAX_DEPTH = 32

# Section headings are the form's field labels (feedback.yml). GitHub renders
# each field as "### <label>" followed by its value; empty fields read
# "_No response_".
SECTION_KIND = "Kind"
SECTION_REPORT_ID = "Report id"
SECTION_SUMMARY = "Summary"
SECTION_DIAGNOSTICS = "Diagnostics"
SECTION_ATTACHMENT = "Report file"
NO_RESPONSE = "_No response_"

KINDS = ("bug", "ui", "idea", "question")
OSES = ("macos", "windows", "linux")
DEFAULT_SCHEMA = Path(__file__).resolve().parent.parent / "doc" / "feedback" / "feedback-public.schema.json"

HEADING_RE = re.compile(r"^### +(\S.*?)\s*$")
FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
VERSION_RE = re.compile(r"^([0-9]{1,4})\.([0-9]{1,4})\.[0-9]+")
ATTACHMENT_RE = re.compile(
    r"https://github\.com/user-attachments/files/[0-9]+/([A-Za-z0-9._-]{1,200}\.zip)(?=[)\s\]>\"']|$)")
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


# ---------------------------------------------------------------- validator

class SchemaError(Exception):
    """The schema uses something the built-in validator does not support."""


SUPPORTED = {
    "$schema", "$id", "$defs", "title", "description",
    "type", "enum", "const", "required", "properties", "additionalProperties",
    "propertyNames", "maxProperties", "items", "maxItems", "minLength",
    "maxLength", "pattern", "minimum", "maximum", "anyOf", "$ref",
}


def _type_ok(value, name: str) -> bool:
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    if name == "string":
        return isinstance(value, str)
    if name == "boolean":
        return isinstance(value, bool)
    if name == "null":
        return value is None
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    raise SchemaError(f"unsupported type {name!r}")


def _safe_key(key: str) -> str:
    return key if SAFE_NAME_RE.match(key) else "<key withheld>"


class Validator:
    def __init__(self, schema: dict):
        self.root = schema
        self.errors: list[str] = []

    def _resolve(self, ref: str) -> dict:
        if not ref.startswith("#/$defs/"):
            raise SchemaError(f"unsupported $ref {ref!r}")
        name = ref[len("#/$defs/"):]
        try:
            return self.root["$defs"][name]
        except KeyError:
            raise SchemaError(f"unknown $ref {ref!r}") from None

    def _err(self, path: str, msg: str) -> None:
        if len(self.errors) < MAX_ERRORS:
            self.errors.append(f"{path or '(root)'}: {msg}")

    def check(self, value, schema: dict, path: str = "", depth: int = 0) -> bool:
        """Return True if value matches; record errors otherwise."""
        unknown = set(schema) - SUPPORTED
        if unknown:
            raise SchemaError(f"unsupported keywords {sorted(unknown)}")
        if depth > MAX_DEPTH:
            self._err(path, "nested too deeply")
            return False
        if "$ref" in schema:
            return self.check(value, self._resolve(schema["$ref"]), path, depth + 1)
        if "anyOf" in schema:
            for sub in schema["anyOf"]:
                trial = Validator(self.root)
                if trial.check(value, sub, path, depth + 1):
                    return True
            self._err(path, "matches none of the allowed forms")
            return False

        before = len(self.errors)
        if "type" in schema:
            types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(_type_ok(value, t) for t in types):
                self._err(path, f"expected {' or '.join(types)}")
                return False
        if "const" in schema and value != schema["const"]:
            self._err(path, "unexpected value")
        if "enum" in schema and not any(value == e and type(value) is type(e) for e in schema["enum"]):
            self._err(path, "value not in the allowed list")

        if isinstance(value, str):
            if "maxLength" in schema and len(value) > schema["maxLength"]:
                self._err(path, f"longer than {schema['maxLength']} characters")
            if "minLength" in schema and len(value) < schema["minLength"]:
                self._err(path, f"shorter than {schema['minLength']} characters")
            if "pattern" in schema and not re.search(schema["pattern"], value):
                self._err(path, "does not match the expected format")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if "minimum" in schema and value < schema["minimum"]:
                self._err(path, f"below {schema['minimum']}")
            if "maximum" in schema and value > schema["maximum"]:
                self._err(path, f"above {schema['maximum']}")
        if isinstance(value, list):
            if "maxItems" in schema and len(value) > schema["maxItems"]:
                self._err(path, f"more than {schema['maxItems']} items")
            if "items" in schema:
                for i, item in enumerate(value[: schema.get("maxItems", len(value))]):
                    self.check(item, schema["items"], f"{path}[{i}]", depth + 1)
        if isinstance(value, dict):
            for key in schema.get("required", []):
                if key not in value:
                    self._err(path, f"missing required field {key}")
            if "maxProperties" in schema and len(value) > schema["maxProperties"]:
                self._err(path, f"more than {schema['maxProperties']} fields")
            props = schema.get("properties", {})
            extra = schema.get("additionalProperties", True)
            for key, sub in value.items():
                child = f"{path}.{_safe_key(key)}" if path else _safe_key(key)
                if "propertyNames" in schema:
                    names = Validator(self.root)
                    if not names.check(key, schema["propertyNames"], child, depth + 1):
                        self._err(child, "field name not allowed")
                        continue
                if key in props:
                    self.check(sub, props[key], child, depth + 1)
                elif extra is False:
                    self._err(child, "field not allowed in the public export")
                elif isinstance(extra, dict):
                    self.check(sub, extra, child, depth + 1)
        return len(self.errors) == before


# ------------------------------------------------------------- body parsing

def split_sections(body: str) -> list[tuple[str, str]]:
    """Split a rendered issue form into (heading, text) pairs.

    "### " lines inside fenced code blocks are content, not headings.
    """
    sections: list[tuple[str, list[str]]] = []
    fence: str | None = None
    for line in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        m = FENCE_RE.match(line)
        if fence is None and m:
            fence = m.group(1)
        elif fence is not None and m and m.group(1)[0] == fence[0] \
                and len(m.group(1)) >= len(fence) and not m.group(2).strip():
            fence = None
        elif fence is None:
            h = HEADING_RE.match(line)
            if h:
                sections.append((h.group(1), []))
                continue
        if sections:
            sections[-1][1].append(line)
    return [(name, "\n".join(lines).strip()) for name, lines in sections]


def fenced_blocks(text: str) -> list[tuple[str, str]]:
    """Return (info string, content) for every fenced block; an unclosed block counts."""
    blocks: list[tuple[str, str]] = []
    fence: str | None = None
    info = ""
    buf: list[str] = []
    for line in text.split("\n"):
        m = FENCE_RE.match(line)
        if fence is None:
            if m:
                fence, info, buf = m.group(1), m.group(2).strip(), []
        elif m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not m.group(2).strip():
            blocks.append((info, "\n".join(buf)))
            fence = None
        else:
            buf.append(line)
    if fence is not None:
        blocks.append((info, "\n".join(buf)))
    return blocks


def _no_dupes(pairs):
    seen = {}
    for k, v in pairs:
        if k in seen:
            raise ValueError("duplicate field name")
        seen[k] = v
    return seen


def _reject_constant(name):
    raise ValueError("NaN or Infinity")


def section_value(sections, name):
    vals = [text for heading, text in sections if heading == name]
    return vals


# --------------------------------------------------------------- triage

def triage(body: str, schema: dict) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    labels: list[str] = []
    report_id = None
    fingerprint = None
    diag = None

    if len(body) > MAX_BODY_CHARS:
        body = body[:MAX_BODY_CHARS]
        warnings.append("issue body is longer than expected; only the start was read")
    sections = split_sections(body)

    # Form fields (text the user can edit freely; only validated values are used).
    def single(name):
        vals = section_value(sections, name)
        if len(vals) > 1:
            errors.append(f"section '{name}' appears {len(vals)} times; the form has it once")
            return None
        if not vals or vals[0] == NO_RESPONSE:
            return None
        return vals[0]

    form_kind = single(SECTION_KIND)
    form_kind = form_kind.strip().lower() if form_kind else None
    if form_kind is not None and form_kind not in KINDS:
        warnings.append("the Kind field is not one of bug, ui, idea, question")
        form_kind = None
    form_id = single(SECTION_REPORT_ID)
    form_id = form_id.strip().lower() if form_id else None
    if form_id is not None and not UUID_RE.match(form_id):
        warnings.append("the Report id field is not a report id made by the app")
        form_id = None

    # Diagnostics: exactly one fenced JSON block.
    diag_text = single(SECTION_DIAGNOSTICS)
    if diag_text is None:
        if not any(e.startswith(f"section '{SECTION_DIAGNOSTICS}'") for e in errors):
            errors.append("diagnostics missing: paste the app's Copy diagnostics output into the Diagnostics field")
    else:
        blocks = fenced_blocks(diag_text)
        if len(blocks) != 1:
            errors.append(f"the Diagnostics field must hold exactly one JSON block, found {len(blocks)}")
        else:
            info, content = blocks[0]
            if info.lower() not in ("json", ""):
                errors.append("the Diagnostics block is not marked as JSON")
            elif len(content.encode("utf-8")) > MAX_BLOCK_BYTES:
                errors.append(f"the Diagnostics block is larger than {MAX_BLOCK_BYTES // 1024} KB")
            else:
                try:
                    diag = json.loads(content, object_pairs_hook=_no_dupes, parse_constant=_reject_constant)
                except (ValueError, RecursionError):
                    errors.append("the Diagnostics block is not valid JSON (was it edited or cut off?)")

    if diag is not None:
        if not isinstance(diag, dict):
            errors.append("the Diagnostics block is not a JSON object")
            diag = None
        elif diag.get("schema") != SCHEMA_ID:
            s = diag.get("schema")
            if isinstance(s, str) and s.startswith(SCHEMA_PREFIX):
                errors.append("unknown diagnostics schema version; this triage knows " + SCHEMA_ID)
            else:
                errors.append("unknown diagnostics schema; expected " + SCHEMA_ID)
            diag = None

    if diag is not None:
        v = Validator(schema)
        if v.check(diag, schema):
            report_id = diag["id"]
        else:
            errors.extend("diagnostics " + e for e in v.errors)
            diag = None

    if diag is not None:
        if form_id is not None and form_id != report_id:
            errors.append("the Report id field does not match the id in the diagnostics (edited?)")
        if form_kind is not None and form_kind != diag["kind"]:
            warnings.append("the Kind field differs from the kind in the diagnostics; using the diagnostics")
        if diag.get("truncated"):
            warnings.append("the app shortened these fields: " + ", ".join(diag["truncated"]))
        labels.append("kind:" + diag["kind"])
        os_name = diag.get("platform", {}).get("os")
        if os_name in OSES:
            labels.append("os:" + os_name)
        m = VERSION_RE.match(diag.get("app", {}).get("version", ""))
        if m:
            labels.append(f"v:{int(m.group(1))}.{int(m.group(2))}")
        view = diag.get("view", {})
        run = diag.get("run", {})
        key = json.dumps([view.get("view"), view.get("dialog"), run.get("phase"), run.get("exit_code"),
                          labels[-1] if labels[-1].startswith("v:") else None])
        fingerprint = hashlib.sha256(key.encode()).hexdigest()[:12]
    elif form_kind is not None:
        labels.append("kind:" + form_kind)

    # Attachment: the zip in the Report file field (or, as a fallback, anywhere).
    att = single(SECTION_ATTACHMENT)
    names = ATTACHMENT_RE.findall(att or "") or ATTACHMENT_RE.findall(body)
    want = (report_id or form_id or "") + ".feedback.zip"
    if not names:
        warnings.append("attachment missing: drop the .feedback.zip the app revealed into the Report file field")
    elif (report_id or form_id) and want not in names:
        warnings.append("the attached zip is not named after this report id")

    ok = diag is not None and not errors
    return {
        "ok": ok,
        "report_id": report_id,
        "errors": errors,
        "warnings": warnings,
        "labels": sorted(set(labels)),
        "fingerprint": fingerprint,
        "comment": render_comment(ok, report_id, errors, warnings, labels, fingerprint),
    }


def _md_escape(text: str) -> str:
    """Neutralise markdown and HTML in our own messages (defence in depth)."""
    text = text.replace("\n", " ")
    return re.sub(r"([\\`*_{}\[\]()<>#+!|~@$&])", r"\\\1", text)


def render_comment(ok, report_id, errors, warnings, labels, fingerprint) -> str:
    lines = [COMMENT_MARKER, "**Automatic feedback check**", ""]
    if ok:
        lines.append(f"Diagnostics are valid ({SCHEMA_ID}), report id `{report_id}`.")
    else:
        lines.append("The diagnostics could not be used. A maintainer will still read this issue.")
    for title, items in (("Problems", errors), ("Notes", warnings)):
        if items:
            lines += ["", f"{title}:"] + [f"- {_md_escape(i)}" for i in items]
    if labels:
        lines += ["", "Labels: " + ", ".join(f"`{l}`" for l in sorted(set(labels)))]
    if fingerprint:
        lines += ["", f"Fingerprint (same view, phase, exit code and version): `fb-{fingerprint}`"]
    lines += ["", "Edit the issue to fix any of this; the check runs again. "
              "If you posted personal or patient data, see doc/feedback/README.md for how it is removed."]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--body-file", type=Path, help="issue body; default: $ISSUE_BODY")
    ap.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    args = ap.parse_args(argv)
    if args.body_file:
        with open(args.body_file, encoding="utf-8", errors="replace") as fh:
            body = fh.read(MAX_BODY_CHARS + 1)
    else:
        body = os.environ.get("ISSUE_BODY", "")
    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    result = triage(body, schema)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
