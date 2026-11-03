#!/usr/bin/env python3
"""Check the built CLI's option names/aliases against the authoritative manual."""

import argparse
import re
import subprocess
import sys
from pathlib import Path


# These options are omitted from --help when the linked libwebsockets lacks
# the corresponding feature/version. The manual covers all supported builds.
CONDITIONAL_OPTIONS = {
    "--ipv6", "--ping-interval", "--ssl", "--ssl-cert", "--ssl-key", "--ssl-ca"
}
OPTION = re.compile(r"^\s*(?:(-[A-Za-z0-9]),\s*)?(--[a-z][a-z0-9-]*)\b", re.MULTILINE)


def options(text):
    result = {}
    for match in OPTION.finditer(text):
        short, long = match.groups()
        if long in result:
            raise ValueError(f"duplicate option: {long}")
        result[long] = short
    if not result:
        raise ValueError("no option definitions found")
    return result


def section(text, heading, next_heading):
    if heading not in text:
        raise ValueError(f"missing section: {heading}")
    return text.split(heading, 1)[1].split(next_heading, 1)[0]


def compare(actual, documented, label, optional=()):
    errors = []
    for name in sorted(actual.keys() - documented.keys()):
        errors.append(f"{label}: undocumented option {name}")
    for name in sorted(documented.keys() - actual.keys() - set(optional)):
        errors.append(f"{label}: stale option {name}")
    for name in sorted(actual.keys() & documented.keys()):
        if actual[name] != documented[name]:
            errors.append(
                f"{label}: {name} short alias differs "
                f"({actual[name]!r} versus {documented[name]!r})"
            )
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path, help="native ttyd executable to inspect")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        help_text = subprocess.run(
            [str(args.binary.resolve()), "--help"], check=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=10
        ).stdout
        actual = options(section(help_text, "OPTIONS:", "\nVisit "))
        manual = options(section(
            (root / "man/ttyd.man.md").read_text(encoding="utf-8"), "# OPTIONS\n", "\n# "
        ))
        rendered = options(section(
            (root / "man/ttyd.1").read_text(encoding="utf-8"), ".SH OPTIONS\n", "\n.SH "
        ))
        errors = compare(actual, manual, "manual", CONDITIONAL_OPTIONS)
        errors += compare(rendered, manual, "generated man page")
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"CLI documentation check failed: {error}", file=sys.stderr)
        return 1
    if errors:
        print("CLI documentation check failed:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    print(f"CLI documentation consistent: {len(actual)} built options, {len(manual)} documented options")
    return 0


if __name__ == "__main__":
    sys.exit(main())
