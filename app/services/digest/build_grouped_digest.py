from typing import Any

from app.services.digest.grouping import resolve_signal_group


def build_grouped_digest(digest: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    summary = digest.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("digest['summary'] must be a dict.")

    signals = summary.get("signals")
    if not isinstance(signals, list):
        raise ValueError("digest['summary']['signals'] must be a list.")

    groups: list[dict[str, Any]] = []
    index_by_group: dict[str, int] = {}

    for signal in signals:
        if not isinstance(signal, dict):
            raise ValueError("Each signal in digest['summary']['signals'] must be a dict.")

        signal_code = signal.get("signal_code")
        if not isinstance(signal_code, str):
            raise ValueError("Signal field 'signal_code' must be a string.")

        group = signal.get("group")
        if not isinstance(group, str) or not group.strip():
            group = resolve_signal_group(signal_code)

        if group not in index_by_group:
            index_by_group[group] = len(groups)
            groups.append({"group": group, "signals": []})

        groups[index_by_group[group]]["signals"].append(signal)

    return {"groups": groups}
