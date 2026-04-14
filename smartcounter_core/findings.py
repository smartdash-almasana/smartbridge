"""Findings generation for smartcounter_core."""
from typing import Any, Dict, List

from smartcounter_core.models import Finding


def generate_findings(comparisons: List[Dict[str, Any]]) -> List[Finding]:
    findings = []
    for comp in comparisons:
        finding = Finding(
            entity_name=comp["entity_name"],
            difference=comp["difference"],
            source_a=comp["source_a"],
            source_b=comp["source_b"],
        )
        findings.append(finding)

    findings.sort(key=lambda x: abs(x.difference), reverse=True)
    return findings