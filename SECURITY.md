# Security policy

## Supported versions

Security fixes go into the next release; only the latest release on the
[release page](https://github.com/okohlbacher/FASTag/releases/latest) is supported.

## Reporting a vulnerability

Do not open a public issue. Report it privately through GitHub:
**Security** tab of this repository, **Report a vulnerability**
([direct link](https://github.com/okohlbacher/FASTag/security/advisories/new)).
Include the FASTag version, the platform, and the steps or input that trigger the problem.

You will get an answer within a week. Once a fix is released, the advisory is published
with credit to the reporter unless you ask otherwise.

## Scope

FASTag reads untrusted files (mzML, mzPeak, MGF, FASTA, idXML, mzid, INI) and writes files
where it is told to; the desktop app starts the bundled command-line tool. Problems in those
paths (crashes or memory errors on crafted input, writing outside the requested outputs,
code execution) are in scope. Wrong scientific results are bugs, not vulnerabilities: report
them as an [issue](https://github.com/okohlbacher/FASTag/issues/new/choose).
