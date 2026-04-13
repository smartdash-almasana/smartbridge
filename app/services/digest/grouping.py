from types import MappingProxyType


GROUP_MAP: MappingProxyType[str, str] = MappingProxyType(
    {
        "order_missing_in_documents": "orders",
        "order_mismatch": "orders",
        "duplicate_order": "orders",
    }
)


def resolve_signal_group(signal_code: str) -> str:
    return GROUP_MAP.get(signal_code, "other")
