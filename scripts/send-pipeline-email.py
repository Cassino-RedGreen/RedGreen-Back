#!/usr/bin/env python3

import argparse
import glob
import html
import os
import smtplib
import ssl
import sys
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from urllib.parse import unquote

REQUIRED_VARS = ("EMAIL_TO", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT")
JUNIT_PATTERNS = ("reports/unit/junit.xml", "test-results/**/junit-*.xml")
STATUS_COLORS = {"SUCCESS": "#1a7f37", "FAILURE": "#cf222e", "UNSTABLE": "#9a6700"}
REPORT_PAGES = (
    ("Unit tests", "unit", "reports/unit/index.html", "index.html"),
    ("Code coverage", "unit", "reports/unit/coverage/lcov-report/index.html", "coverage/lcov-report/index.html"),
    ("API tests (E2E)", "e2e", "test-results/index.html", "index.html"),
)


def parse_args():
    env = os.environ.get
    parser = argparse.ArgumentParser(description="Send the pipeline result email.")
    parser.add_argument("--job", default=env("JOB_NAME", "RedGreen-Back"))
    parser.add_argument("--build-number", default=env("BUILD_NUMBER", "-"))
    parser.add_argument("--status", default=env("BUILD_STATUS", "UNKNOWN"))
    parser.add_argument("--failed-stage", default=env("FAILED_STAGE", ""))
    parser.add_argument("--branch", default=env("BRANCH_NAME") or env("GIT_BRANCH", "-"))
    parser.add_argument("--commit", default=env("GIT_COMMIT", "-"))
    parser.add_argument("--duration", default=env("BUILD_DURATION", "-"))
    parser.add_argument("--url", default=env("BUILD_URL", "-"))
    parser.add_argument("--image", default=env("PUBLISHED_IMAGE") or "not published in this build")
    parser.add_argument("--workspace", default=env("WORKSPACE", "."))
    parser.add_argument("--missing-reports", default=env("MISSING_REPORTS", ""))
    parser.add_argument("--report-server", default=env("REPORT_SERVER_URL", ""))
    parser.add_argument("--report-key", default=env("CI_PREFIX", ""))
    args = parser.parse_args()
    args.job = unquote(args.job)
    args.status = args.status.upper()
    args.missing_reports = [item.strip() for item in args.missing_reports.split(";") if item.strip()]
    return args


def load_smtp_config():
    missing = [name for name in REQUIRED_VARS if not os.environ.get(name, "").strip()]
    if missing:
        raise ValueError("missing required variables: " + ", ".join(missing))
    try:
        port = int(os.environ["SMTP_PORT"])
    except ValueError:
        raise ValueError(f"invalid SMTP_PORT: {os.environ['SMTP_PORT']!r}") from None
    recipients = [item.strip() for item in os.environ["EMAIL_TO"].split(",") if item.strip()]
    if not recipients:
        raise ValueError("EMAIL_TO has no addresses")
    return {
        "host": os.environ["SMTP_HOST"].strip(),
        "port": port,
        "sender": os.environ["EMAIL_FROM"].strip(),
        "recipients": recipients,
        "user": os.environ.get("SMTP_USER", "").strip(),
        "password": os.environ.get("SMTP_PASSWORD", ""),
        "starttls": os.environ.get("SMTP_STARTTLS", "false").strip().lower() in ("1", "true", "yes"),
    }


def summarize_tests(workspace):
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    files = []
    for pattern in JUNIT_PATTERNS:
        for path in sorted(glob.glob(os.path.join(workspace, pattern), recursive=True)):
            try:
                root = ET.parse(path).getroot()
            except (ET.ParseError, OSError) as error:
                print(f"Warning: could not read {path}: {error}", file=sys.stderr)
                continue
            suites = [root] if root.tag == "testsuite" else root.findall("testsuite")
            for suite in suites:
                for key in totals:
                    totals[key] += int(float(suite.get(key) or 0))
            files.append(os.path.relpath(path, workspace))
    return totals, files


def report_links(args):
    base = args.report_server.strip().rstrip("/")
    if not base:
        return []
    links = [("All reports", f"{base}/")]
    if args.report_key:
        for label, kind, local_path, remote_path in REPORT_PAGES:
            if os.path.isfile(os.path.join(args.workspace, local_path)):
                links.append((label, f"{base}/reports/{kind}/{args.report_key}/{remote_path}"))
    return links


def build_message(args, smtp, totals, files, links):
    passed = totals["tests"] - totals["failures"] - totals["errors"] - totals["skipped"]
    if files:
        tests_line = (
            f"{totals['tests']} tests: {passed} passed, {totals['failures']} failed, "
            f"{totals['errors']} errors, {totals['skipped']} skipped"
        )
    else:
        tests_line = "no JUnit report found in this build"

    rows = [
        ("Job", args.job),
        ("Build", f"#{args.build_number}"),
        ("Status", args.status),
    ]
    if args.status != "SUCCESS":
        rows.append(("Failed stage", args.failed_stage or "-"))
    rows += [
        ("Branch", args.branch),
        ("Commit", args.commit),
        ("Duration", args.duration),
        ("Published image", args.image),
        ("Tests", tests_line),
        ("Reports read", ", ".join(files) if files else "-"),
    ]
    if args.missing_reports:
        rows.append(("Missing reports", "; ".join(args.missing_reports)))
    rows.append(("Details", args.url))

    text = [f"Pipeline {args.job} #{args.build_number}: {args.status}", ""]
    text += [f"{label}: {value}" for label, value in rows]
    if links:
        text += ["", "Reports:"]
        text += [f"- {label}: {url}" for label, url in links]
    text += ["", "Automated message sent by Jenkins."]

    color = STATUS_COLORS.get(args.status, "#57606a")
    title = f"Pipeline {html.escape(args.job)} #{html.escape(str(args.build_number))}"
    table = "\n".join(
        f"<tr><th align='left' valign='top' style='padding:6px 16px 6px 0;color:#57606a;font-weight:normal;"
        f"white-space:nowrap'>{html.escape(label)}</th>"
        f"<td style='padding:6px 0;color:#1f2328'>{html.escape(str(value))}</td></tr>"
        for label, value in rows
    )
    buttons = "".join(
        f"<a href='{html.escape(url)}' style='display:inline-block;margin:0 8px 8px 0;padding:9px 14px;"
        f"border-radius:6px;background:#1f6feb;color:#ffffff;text-decoration:none;font-weight:bold'>"
        f"{html.escape(label)} &rarr;</a>"
        for label, url in links
    )
    reports_html = (
        f"<h3 style='margin:24px 0 12px;font-size:15px;color:#1f2328'>Reports</h3><div>{buttons}</div>"
        if links
        else ""
    )
    body_html = f"""<html><body style="margin:0;padding:0;background:#f6f8fa;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa"><tr><td align="center" style="padding:24px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #d0d7de;border-radius:8px">
<tr><td style="background:#172a4a;padding:24px;border-radius:8px 8px 0 0">
<div style="color:#ffffff;font-size:22px;font-weight:bold">{title}</div>
<div style="margin-top:10px"><span style="display:inline-block;padding:4px 10px;border-radius:12px;background:{color};color:#ffffff;font-size:13px;font-weight:bold">{html.escape(args.status)}</span></div>
</td></tr>
<tr><td style="padding:24px">
<table cellpadding="0" cellspacing="0" style="font-size:14px">{table}</table>
{reports_html}
<p style="margin:20px 0 0"><a href="{html.escape(args.url)}" style="color:#1f6feb;font-weight:bold">Open the build in Jenkins &rarr;</a></p>
</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #d0d7de;color:#57606a;font-size:12px">Automated message sent by Jenkins.</td></tr>
</table>
</td></tr></table>
</body></html>"""

    subject = f"[Jenkins] {args.job} #{args.build_number} - {args.status}"
    if args.status != "SUCCESS" and args.failed_stage:
        subject += f" ({args.failed_stage})"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp["sender"]
    message["To"] = ", ".join(smtp["recipients"])
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid()
    message.set_content("\n".join(text))
    message.add_alternative(body_html, subtype="html")
    return message


def send(message, smtp):
    if smtp["port"] == 465:
        client = smtplib.SMTP_SSL(smtp["host"], smtp["port"], timeout=30, context=ssl.create_default_context())
    else:
        client = smtplib.SMTP(smtp["host"], smtp["port"], timeout=30)
    with client:
        if smtp["starttls"] and smtp["port"] != 465:
            client.starttls(context=ssl.create_default_context())
        if smtp["user"]:
            client.login(smtp["user"], smtp["password"])
        client.send_message(message, to_addrs=smtp["recipients"])


def main():
    args = parse_args()
    try:
        smtp = load_smtp_config()
    except ValueError as error:
        print(f"Email configuration error: {error}.", file=sys.stderr)
        return 2

    totals, files = summarize_tests(args.workspace)
    message = build_message(args, smtp, totals, files, report_links(args))
    try:
        send(message, smtp)
    except (smtplib.SMTPException, OSError) as error:
        print(f"Failed to send email via {smtp['host']}:{smtp['port']}: {error}", file=sys.stderr)
        return 1

    print(f"Email sent to {', '.join(smtp['recipients'])} via {smtp['host']}:{smtp['port']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
