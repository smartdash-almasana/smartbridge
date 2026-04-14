"""Data models for smartcounter_core."""
from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class Entity:
    entity_id: str
    canonical_name: str
    aliases: List[str]
    source_a: Dict[str, Any]
    source_b: Dict[str, Any]
    confidence: float
    validated: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "canonical_name": self.canonical_name,
            "aliases": self.aliases,
            "source_a": self.source_a,
            "source_b": self.source_b,
            "confidence": self.confidence,
            "validated": self.validated,
        }


@dataclass
class Uncertainty:
    value_a: str
    value_b: str
    similarity: float
    requires_validation: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "value_a": self.value_a,
            "value_b": self.value_b,
            "similarity": self.similarity,
            "requires_validation": self.requires_validation,
        }


@dataclass
class Finding:
    entity_name: str
    difference: int
    source_a: Dict[str, Any]
    source_b: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_name": self.entity_name,
            "difference": self.difference,
            "source_a": self.source_a,
            "source_b": self.source_b,
        }