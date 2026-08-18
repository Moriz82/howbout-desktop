"""Print a privacy-preserving inventory of Howbout HTTP flows.

Usage:
    mitmdump -nr /path/to/flows -q -s tools/inspect_capture.py

The capture may contain live credentials and personal calendar data. This addon
prints endpoint paths, status codes, header *names*, and JSON shapes only.
"""

from __future__ import annotations

import json
import hashlib
import re
from collections import Counter
from urllib.parse import parse_qsl, urlsplit

from mitmproxy import http


TARGET_HOSTS = {
    "api.howbout.app",
    "securetoken.googleapis.com",
    "identitytoolkit.googleapis.com",
}


def shape(value: object, depth: int = 0) -> object:
    if depth >= 4:
        return type(value).__name__
    if isinstance(value, dict):
        if value and all(str(key).isdigit() for key in value):
            first_value = next(iter(value.values()))
            return {"{id}": shape(first_value, depth + 1)}
        return {str(key): shape(child, depth + 1) for key, child in value.items()}
    if isinstance(value, list):
        return [shape(value[0], depth + 1)] if value else []
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string"


def body_shape(message: http.Message | None) -> object | None:
    if message is None or not message.raw_content:
        return None
    content_type = message.headers.get("content-type", "")
    if "json" in content_type:
        try:
            return shape(json.loads(message.get_text(strict=False)))
        except (ValueError, UnicodeDecodeError):
            return "invalid-json"
    if "x-www-form-urlencoded" in content_type:
        try:
            return sorted(key for key, _ in parse_qsl(message.get_text(strict=False)))
        except UnicodeDecodeError:
            return "form"
    return f"{len(message.raw_content)} bytes"


class Inventory:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, str], dict[str, object]] = {}
        self.counts: Counter[tuple[str, str, str]] = Counter()

    def response(self, flow: http.HTTPFlow) -> None:
        host = flow.request.pretty_host.lower()
        if host not in TARGET_HOSTS:
            return

        split = urlsplit(flow.request.pretty_url)
        normalized_path = re.sub(r"/(?=\d+(?:/|$))\d+", "/{id}", split.path)
        key = (host, flow.request.method, normalized_path)
        self.counts[key] += 1
        row = self.rows.setdefault(
            key,
            {
                "host": host,
                "method": flow.request.method,
                "path": normalized_path,
                "query_keys": sorted({name for name, _ in parse_qsl(split.query)}),
                "request_header_names": sorted(name.lower() for name in flow.request.headers.keys()),
                "request_shape": body_shape(flow.request),
                "origins": set(),
                "allow_origins": set(),
                "authorization_schemes": set(),
                "api_key_fingerprints": set(),
                "app_versions": set(),
                "statuses": set(),
                "response_header_names": set(),
                "response_shapes": [],
            },
        )
        if origin := flow.request.headers.get("origin"):
            row["origins"].add(origin)  # type: ignore[union-attr]
        if authorization := flow.request.headers.get("authorization"):
            row["authorization_schemes"].add(authorization.partition(" ")[0])  # type: ignore[union-attr]
        if api_key := flow.request.headers.get("x-api-key"):
            fingerprint = hashlib.sha256(api_key.encode()).hexdigest()[:12]
            row["api_key_fingerprints"].add(f"sha256:{fingerprint};length:{len(api_key)}")  # type: ignore[union-attr]
        if app_version := flow.request.headers.get("appversion"):
            row["app_versions"].add(app_version)  # type: ignore[union-attr]
        if flow.response is not None:
            row["statuses"].add(flow.response.status_code)  # type: ignore[union-attr]
            row["response_header_names"].update(  # type: ignore[union-attr]
                name.lower() for name in flow.response.headers.keys()
            )
            response_shape = body_shape(flow.response)
            if allow_origin := flow.response.headers.get("access-control-allow-origin"):
                row["allow_origins"].add(allow_origin)  # type: ignore[union-attr]
            if response_shape is not None and response_shape not in row["response_shapes"]:
                row["response_shapes"].append(response_shape)  # type: ignore[union-attr]

    def done(self) -> None:
        serializable = []
        for key in sorted(self.rows):
            row = dict(self.rows[key])
            row["count"] = self.counts[key]
            row["statuses"] = sorted(row["statuses"])
            row["response_header_names"] = sorted(row["response_header_names"])
            row["origins"] = sorted(row["origins"])
            row["allow_origins"] = sorted(row["allow_origins"])
            row["authorization_schemes"] = sorted(row["authorization_schemes"])
            row["api_key_fingerprints"] = sorted(row["api_key_fingerprints"])
            row["app_versions"] = sorted(row["app_versions"])
            serializable.append(row)
        print(json.dumps(serializable, indent=2, sort_keys=True))


addons = [Inventory()]
