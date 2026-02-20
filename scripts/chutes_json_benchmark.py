#!/usr/bin/env python3
"""Benchmark Chutes models for strict JSON output quality + speed.

This script is tailored for OpenContext watchman-style JSON tasks.
It can test all models from /v1/models and rank by:
- JSON parse rate
- Watchman schema compliance rate
- average tokens/sec
- average latency
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

WATCHMAN_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["violation", "rule", "reason", "correction_prompt", "confidence"],
    "properties": {
        "violation": {"type": "boolean"},
        "rule": {"type": "string"},
        "reason": {"type": "string"},
        "correction_prompt": {"type": "string"},
        "confidence": {"type": "number"},
    },
}

TASKS: List[Dict[str, Any]] = [
    {
        "name": "no_violation",
        "payload": {
            "debts": {
                "pendingCompactionCheckpoint": False,
                "pendingResearchCapture": False,
                "pendingFailureLookup": False,
            },
            "recentToolCalls": [{"tool": "bash", "commandText": "ls -la"}],
            "latestAssistant": {"text": "I will inspect files before making changes."},
        },
    },
    {
        "name": "checkpoint_overdue",
        "payload": {
            "debts": {
                "pendingCompactionCheckpoint": True,
                "pendingResearchCapture": False,
                "pendingFailureLookup": False,
            },
            "recentToolCalls": [
                {"tool": "bash", "commandText": "pytest -q"},
                {"tool": "bash", "commandText": "npm test"},
            ],
            "latestAssistant": {
                "text": "Continuing implementation without checkpoint despite many tool calls."
            },
        },
    },
    {
        "name": "failure_lookup_needed",
        "payload": {
            "debts": {
                "pendingCompactionCheckpoint": False,
                "pendingResearchCapture": False,
                "pendingFailureLookup": True,
            },
            "recentToolCalls": [
                {
                    "tool": "bash",
                    "commandText": "pytest tests/test_api.py",
                    "output": "AssertionError: expected 200 got 500",
                }
            ],
            "latestAssistant": {"text": "Retrying same approach now."},
        },
    },
]

SYSTEM_PROMPT = (
    "You are OpenContext watchman. Return ONLY a valid JSON object with keys: "
    "violation(boolean), rule(string), reason(string), correction_prompt(string), confidence(number). "
    "No markdown and no extra text."
)


@dataclass
class CaseResult:
    ok_http: bool
    parse_ok: bool
    schema_ok: bool
    latency_ms: float
    completion_tokens: int
    raw_error: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Chutes JSON output reliability + speed")
    parser.add_argument("--base-url", default="https://llm.chutes.ai/v1", help="OpenAI-compatible base URL")
    parser.add_argument("--api-key-env", default="CHUTES_API_KEY", help="Env var name for API key")
    parser.add_argument(
        "--response-format",
        choices=["json_object", "json_schema"],
        default="json_object",
        help="response_format mode to test",
    )
    parser.add_argument("--max-tokens", type=int, default=140, help="max completion tokens per case")
    parser.add_argument("--timeout", type=float, default=45.0, help="HTTP timeout seconds")
    parser.add_argument("--include-regex", default="", help="Only test model ids matching regex")
    parser.add_argument("--exclude-regex", default="", help="Skip model ids matching regex")
    parser.add_argument("--max-models", type=int, default=0, help="Limit number of models (0 = all)")
    parser.add_argument("--delay-ms", type=int, default=0, help="Delay between requests")
    parser.add_argument("--top", type=int, default=20, help="Rows to print in leaderboard")
    parser.add_argument("--list-only", action="store_true", help="List models and exit")
    parser.add_argument("--output", default="", help="Output JSON file path")
    return parser.parse_args()


def safe_json_loads(text: str) -> Optional[Dict[str, Any]]:
    text = (text or "").strip()
    if not text:
        return None
    try:
        obj = json.loads(text)
    except Exception:
        return None
    if isinstance(obj, dict):
        return obj
    return None


def extract_message_content(data: Dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


def schema_ok_watchman(obj: Dict[str, Any]) -> bool:
    required = ["violation", "rule", "reason", "correction_prompt", "confidence"]
    if any(key not in obj for key in required):
        return False
    if not isinstance(obj.get("violation"), bool):
        return False
    if not isinstance(obj.get("rule"), str):
        return False
    if not isinstance(obj.get("reason"), str):
        return False
    if not isinstance(obj.get("correction_prompt"), str):
        return False
    if not isinstance(obj.get("confidence"), (int, float)):
        return False
    return True


def build_body(model: str, case_payload: Dict[str, Any], max_tokens: int, response_format: str) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(case_payload, ensure_ascii=True)},
        ],
    }
    if response_format == "json_object":
        body["response_format"] = {"type": "json_object"}
    else:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "opencontext_watchman",
                "strict": True,
                "schema": WATCHMAN_SCHEMA,
            },
        }
    return body


def fetch_models(base_url: str, headers: Dict[str, str], timeout: float) -> List[str]:
    url = f"{base_url.rstrip('/')}/models"
    response = requests.get(url, headers=headers, timeout=timeout)
    response.raise_for_status()
    data = response.json().get("data", [])
    model_ids: List[str] = []
    for item in data:
        mid = item.get("id")
        if isinstance(mid, str) and mid.strip():
            model_ids.append(mid.strip())
    return sorted(set(model_ids))


def run_case(
    base_url: str,
    headers: Dict[str, str],
    model: str,
    case_payload: Dict[str, Any],
    max_tokens: int,
    timeout: float,
    response_format: str,
) -> CaseResult:
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = build_body(model, case_payload, max_tokens, response_format)

    start = time.perf_counter()
    try:
        response = requests.post(url, headers=headers, json=body, timeout=timeout)
        latency_ms = (time.perf_counter() - start) * 1000.0
    except Exception as exc:
        return CaseResult(False, False, False, 0.0, 0, raw_error=str(exc))

    if response.status_code != 200:
        return CaseResult(False, False, False, latency_ms, 0, raw_error=f"HTTP {response.status_code}")

    try:
        data = response.json()
    except Exception as exc:
        return CaseResult(True, False, False, latency_ms, 0, raw_error=f"invalid_json_response: {exc}")

    content = extract_message_content(data)
    obj = safe_json_loads(content)
    parse_ok = obj is not None
    schema_ok = schema_ok_watchman(obj or {})
    completion_tokens = int(((data.get("usage") or {}).get("completion_tokens") or 0))

    return CaseResult(True, parse_ok, schema_ok, latency_ms, completion_tokens, raw_error="")


def format_num(value: Optional[float], ndigits: int = 2) -> str:
    if value is None:
        return "-"
    return f"{value:.{ndigits}f}"


def main() -> int:
    args = parse_args()
    api_key = os.environ.get(args.api_key_env, "").strip()
    if not api_key:
        print(f"ERROR: missing API key in env var {args.api_key_env}", file=sys.stderr)
        return 2

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        models = fetch_models(args.base_url, headers, args.timeout)
    except Exception as exc:
        print(f"ERROR: failed to fetch model list: {exc}", file=sys.stderr)
        return 2

    if args.include_regex:
        inc = re.compile(args.include_regex)
        models = [m for m in models if inc.search(m)]
    if args.exclude_regex:
        exc_re = re.compile(args.exclude_regex)
        models = [m for m in models if not exc_re.search(m)]
    if args.max_models and args.max_models > 0:
        models = models[: args.max_models]

    if not models:
        print("No models selected.")
        return 1

    if args.list_only:
        for model in models:
            print(model)
        return 0

    started_at = datetime.now(timezone.utc).isoformat()
    model_results: List[Dict[str, Any]] = []

    for index, model in enumerate(models, start=1):
        case_results: List[CaseResult] = []
        for case in TASKS:
            result = run_case(
                args.base_url,
                headers,
                model,
                case["payload"],
                args.max_tokens,
                args.timeout,
                args.response_format,
            )
            case_results.append(result)
            if args.delay_ms > 0:
                time.sleep(args.delay_ms / 1000.0)

        ok_calls = [r for r in case_results if r.ok_http]
        parse_ok = sum(1 for r in ok_calls if r.parse_ok)
        schema_ok_count = sum(1 for r in ok_calls if r.schema_ok)
        latencies = [r.latency_ms for r in ok_calls if r.latency_ms > 0]

        tps_values: List[float] = []
        for r in ok_calls:
            if r.latency_ms > 0 and r.completion_tokens > 0:
                tps_values.append((r.completion_tokens * 1000.0) / r.latency_ms)

        parse_rate = (parse_ok / len(ok_calls)) if ok_calls else 0.0
        schema_rate = (schema_ok_count / len(ok_calls)) if ok_calls else 0.0
        avg_latency = statistics.mean(latencies) if latencies else None
        avg_tps = statistics.mean(tps_values) if tps_values else None

        model_results.append(
            {
                "model": model,
                "calls": len(case_results),
                "http_ok_calls": len(ok_calls),
                "http_error_calls": len(case_results) - len(ok_calls),
                "json_parse_rate": round(parse_rate, 4),
                "schema_compliance_rate": round(schema_rate, 4),
                "avg_latency_ms": round(avg_latency, 2) if avg_latency is not None else None,
                "avg_tokens_per_sec": round(avg_tps, 2) if avg_tps is not None else None,
                "raw_errors": [r.raw_error for r in case_results if r.raw_error],
            }
        )

        print(
            f"[{index}/{len(models)}] {model}  "
            f"json={parse_rate:.2f} schema={schema_rate:.2f} "
            f"tps={format_num(avg_tps)} lat_ms={format_num(avg_latency)}"
        )

    def rank_key(row: Dict[str, Any]) -> Any:
        return (
            row["schema_compliance_rate"],
            row["json_parse_rate"],
            (row["avg_tokens_per_sec"] or 0.0),
            -(row["avg_latency_ms"] or 1e9),
        )

    ranked = sorted(model_results, key=rank_key, reverse=True)

    report = {
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "base_url": args.base_url,
        "response_format": args.response_format,
        "tasks": [case["name"] for case in TASKS],
        "models_tested": len(ranked),
        "results": ranked,
    }

    out_path = args.output.strip()
    if not out_path:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out_path = f"scripts/chutes_json_benchmark_{timestamp}.json"
    output_file = Path(out_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("\n=== Leaderboard ===")
    print("Rank  Model                                               Schema  JSON    TPS     Lat(ms)")
    print("----  --------------------------------------------------  ------  ------  ------  -------")
    for rank, row in enumerate(ranked[: max(1, args.top)], start=1):
        print(
            f"{rank:>4}  {row['model'][:50]:<50}  "
            f"{row['schema_compliance_rate']:<6.2f}  "
            f"{row['json_parse_rate']:<6.2f}  "
            f"{format_num(row['avg_tokens_per_sec']):>6}  "
            f"{format_num(row['avg_latency_ms']):>7}"
        )

    print(f"\nSaved full JSON report to: {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
