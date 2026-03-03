#!/usr/bin/env python3
"""Benchmark OpenAI-compatible models for strict JSON output + speed.

Originally built for Chutes, but supports any OpenAI-compatible provider.
What it does:
- discovers models from provider model-list endpoint
- runs watchman-style JSON tasks against each model
- scores parse rate, schema compliance, latency, tokens/sec
- optionally writes best model + fallbacks into OpenContext runtime config
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
from typing import Any, Dict, List, Optional, Tuple

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
    parser = argparse.ArgumentParser(description="Benchmark OpenAI-compatible JSON output reliability + speed")
    parser.add_argument("--base-url", default="https://llm.chutes.ai/v1", help="Provider base URL")
    parser.add_argument("--models-url", default="", help="Override model-list endpoint URL")
    parser.add_argument("--chat-url", default="", help="Override chat-completions endpoint URL")
    parser.add_argument("--provider-name", default="openai_compatible", help="Label only (report metadata)")

    parser.add_argument("--api-key-env", default="CHUTES_API_KEY", help="Env var name for API key")
    parser.add_argument("--api-key", default="", help="Explicit API key (overrides env)")
    parser.add_argument("--auth-header", default="Authorization", help="Auth header name")
    parser.add_argument("--api-key-prefix", default="Bearer", help="Auth prefix (empty for raw key)")
    parser.add_argument(
        "--extra-header",
        action="append",
        default=[],
        help="Additional header key=value (repeatable)",
    )

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
    parser.add_argument("--models", default="", help="Comma-separated list of model IDs (bypasses /v1/models endpoint)")
    parser.add_argument("--delay-ms", type=int, default=0, help="Delay between requests")
    parser.add_argument("--top", type=int, default=20, help="Rows to print in leaderboard")
    parser.add_argument("--list-only", action="store_true", help="List models and exit")
    parser.add_argument("--output", default="", help="Output JSON file path")

    parser.add_argument(
        "--write-runtime",
        action="append",
        default=[],
        help="Write best model + fallbacks into runtime config file (repeatable)",
    )
    parser.add_argument("--fallback-count", type=int, default=3, help="How many fallback models to write")
    parser.add_argument("--include-api-key", action="store_true", help="Also persist API key into runtime file")
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


def parse_extra_headers(items: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for item in items:
        if "=" not in item:
            continue
        k, v = item.split("=", 1)
        k = k.strip()
        v = v.strip()
        if k:
            out[k] = v
    return out


def build_headers(args: argparse.Namespace, api_key: str) -> Dict[str, str]:
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
    }
    auth_header = (args.auth_header or "").strip()
    if auth_header and api_key:
        prefix = (args.api_key_prefix or "").strip()
        headers[auth_header] = f"{prefix} {api_key}".strip() if prefix else api_key
    headers.update(parse_extra_headers(args.extra_header or []))
    return headers


def endpoint_candidates(base_url: str, path: str) -> List[str]:
    base = base_url.rstrip("/")
    path = "/" + path.strip("/")
    candidates: List[str] = [f"{base}{path}"]

    # If caller gave host root, also try /v1/...
    if not base.endswith("/v1") and "/v1/" not in base:
        candidates.append(f"{base}/v1{path}")

    # If caller gave /v1 base, also try host root path for compatibility
    if base.endswith("/v1"):
        root = base[:-3].rstrip("/")
        if root:
            candidates.append(f"{root}{path}")

    seen = set()
    uniq: List[str] = []
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        uniq.append(c)
    return uniq


def extract_model_ids(payload: Any) -> List[str]:
    ids: List[str] = []
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            for item in payload.get("data", []):
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    ids.append(item["id"].strip())
                elif isinstance(item, str):
                    ids.append(item.strip())
        if not ids and isinstance(payload.get("models"), list):
            for item in payload.get("models", []):
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    ids.append(item["id"].strip())
                elif isinstance(item, str):
                    ids.append(item.strip())
    elif isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                ids.append(item["id"].strip())
            elif isinstance(item, str):
                ids.append(item.strip())
    return sorted(set([x for x in ids if x]))


def fetch_models(base_url: str, headers: Dict[str, str], timeout: float, models_url_override: str = "", models_list: str = "") -> Tuple[List[str], str]:
    if models_list:
        ids = [m.strip() for m in models_list.split(",") if m.strip()]
        return ids, "hardcoded_list"
    urls = [models_url_override] if models_url_override else endpoint_candidates(base_url, "/models")
    last_error = ""
    for url in urls:
        if not url:
            continue
        try:
            response = requests.get(url, headers=headers, timeout=timeout)
            if response.status_code >= 400:
                last_error = f"{url} -> HTTP {response.status_code}"
                continue
            payload = response.json()
            ids = extract_model_ids(payload)
            if ids:
                return ids, url
            last_error = f"{url} -> no model ids"
        except Exception as exc:
            last_error = f"{url} -> {exc}"
    raise RuntimeError(last_error or "no models endpoint succeeded")


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


def run_case(
    chat_urls: List[str],
    headers: Dict[str, str],
    model: str,
    case_payload: Dict[str, Any],
    max_tokens: int,
    timeout: float,
    response_format: str,
) -> CaseResult:
    body = build_body(model, case_payload, max_tokens, response_format)
    last_error = ""

    for url in chat_urls:
        start = time.perf_counter()
        try:
            response = requests.post(url, headers=headers, json=body, timeout=timeout)
            latency_ms = (time.perf_counter() - start) * 1000.0
        except Exception as exc:
            last_error = f"{url} -> {exc}"
            continue

        # If endpoint path is wrong, try next candidate
        if response.status_code in (404, 405):
            last_error = f"{url} -> HTTP {response.status_code}"
            continue

        if response.status_code != 200:
            return CaseResult(False, False, False, latency_ms, 0, raw_error=f"{url} -> HTTP {response.status_code}")

        try:
            data = response.json()
        except Exception as exc:
            return CaseResult(True, False, False, latency_ms, 0, raw_error=f"{url} -> invalid_json_response: {exc}")

        content = extract_message_content(data)
        obj = safe_json_loads(content)
        parse_ok = obj is not None
        schema_ok = schema_ok_watchman(obj or {})
        completion_tokens = int(((data.get("usage") or {}).get("completion_tokens") or 0))
        return CaseResult(True, parse_ok, schema_ok, latency_ms, completion_tokens, raw_error="")

    return CaseResult(False, False, False, 0.0, 0, raw_error=last_error or "no chat endpoint succeeded")


def format_num(value: Optional[float], ndigits: int = 2) -> str:
    if value is None:
        return "-"
    return f"{value:.{ndigits}f}"


def write_runtime_config(
    path: Path,
    args: argparse.Namespace,
    api_key: str,
    ranked_rows: List[Dict[str, Any]],
) -> None:
    if not ranked_rows:
        return
    best = ranked_rows[0]["model"]
    fallback_count = max(0, int(args.fallback_count))
    fallbacks = [row["model"] for row in ranked_rows[1 : 1 + fallback_count]]

    existing: Dict[str, Any] = {}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(existing, dict):
                existing = {}
        except Exception:
            existing = {}

    critic = existing.get("critic") if isinstance(existing.get("critic"), dict) else {}
    critic.update(
        {
            "model": best,
            "modelFallbacks": fallbacks,
            "baseUrl": args.base_url,
            "endpointPath": "/chat/completions",
            "authHeader": args.auth_header,
            "apiKeyPrefix": args.api_key_prefix,
            "apiKeyEnv": args.api_key_env,
            "responseFormatStrategy": "json_schema_then_json_object",
        }
    )
    if args.include_api_key:
        critic["apiKey"] = api_key

    existing["critic"] = critic
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()

    api_key = (args.api_key or "").strip() or os.environ.get(args.api_key_env, "").strip()
    if not api_key:
        print(
            f"ERROR: missing API key. Set --api-key or env var {args.api_key_env}",
            file=sys.stderr,
        )
        return 2

    headers = build_headers(args, api_key)

    try:
        models, models_url_used = fetch_models(args.base_url, headers, args.timeout, args.models_url, args.models)
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

    chat_urls = [args.chat_url] if args.chat_url else endpoint_candidates(args.base_url, "/chat/completions")
    chat_urls = [x for x in chat_urls if x]

    started_at = datetime.now(timezone.utc).isoformat()
    model_results: List[Dict[str, Any]] = []

    for index, model in enumerate(models, start=1):
        case_results: List[CaseResult] = []
        for case in TASKS:
            result = run_case(
                chat_urls,
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
        "provider_name": args.provider_name,
        "base_url": args.base_url,
        "models_url_used": models_url_used,
        "chat_url_candidates": chat_urls,
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

    if args.write_runtime:
        for raw_path in args.write_runtime:
            p = Path(raw_path).expanduser()
            write_runtime_config(p, args, api_key, ranked)
            print(f"Wrote best-model runtime config: {p}")

    print(f"\nSaved full JSON report to: {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
