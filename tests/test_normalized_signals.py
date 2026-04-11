import pytest
import copy
from app.services.normalized_signals.service import (
    build_normalized_signals,
    _validate_output_contract
)

def build_base_payload():
    return {
        "module": "order_reconciliation",
        "generated_at": "2026-04-10T15:00:00+00:00",
        "findings": [
            {
                "type": "order_mismatch",
                "severity": "medium",
                "entity_ref": "order_123",
                "context": ["amount mismatch"]
            }
        ]
    }

def test_determinismo():
    payload = build_base_payload()
    ingestion_id = "ing_12345"
    
    result1 = build_normalized_signals(payload, ingestion_id)
    result2 = build_normalized_signals(copy.deepcopy(payload), ingestion_id)
    
    assert result1 == result2

def test_deduplicacion():
    base_payload = build_base_payload()
    ingestion_id = "ing_12345"
    
    single_result = build_normalized_signals(base_payload, ingestion_id)
    single_score = single_result["signals"][0]["priority_score"]
    
    dup_payload = build_base_payload()
    # Add identical finding to increase frequency
    dup_payload["findings"].append(dup_payload["findings"][0].copy())
    
    dup_result = build_normalized_signals(dup_payload, ingestion_id)
    
    assert len(dup_result["signals"]) == 1
    dup_score = dup_result["signals"][0]["priority_score"]
    
    # Frequency modifier increases the score
    assert dup_score > single_score

def test_identidad_estable():
    payload1 = build_base_payload()
    ingestion_id = "ing_12345"
    
    result1 = build_normalized_signals(payload1, ingestion_id)
    signal_id_1 = result1["signals"][0]["signal_id"]
    
    # Payload 2: Same entity, same source mapping, different severity and context
    payload2 = build_base_payload()
    payload2["findings"][0]["severity"] = "high"
    payload2["findings"][0]["context"] = ["completely different reason"]
    
    result2 = build_normalized_signals(payload2, ingestion_id)
    signal_id_2 = result2["signals"][0]["signal_id"]
    
    # Signal ID should remain completely stable
    assert signal_id_1 == signal_id_2

def test_validacion_estricta():
    ingestion_id = "ing_12345"
    
    # Invalid severity
    payload_inv_severity = build_base_payload()
    payload_inv_severity["findings"][0]["severity"] = "critical" # invalid
    with pytest.raises(ValueError, match="Unsupported finding severity"):
        build_normalized_signals(payload_inv_severity, ingestion_id)
        
    # Invalid entity_ref (does not have _)
    payload_inv_entity = build_base_payload()
    payload_inv_entity["findings"][0]["entity_ref"] = "order123" # invalid format
    with pytest.raises(ValueError, match="Invalid entity_ref format"):
        build_normalized_signals(payload_inv_entity, ingestion_id)
        
    # Invalid signal_code mapping
    payload_inv_code = build_base_payload()
    payload_inv_code["findings"][0]["type"] = "unknown_type_error"
    with pytest.raises(ValueError, match="Unsupported finding type for signal mapping"):
        build_normalized_signals(payload_inv_code, ingestion_id)

def test_ordering():
    payload = build_base_payload()
    payload["findings"] = [
        {
            "type": "order_mismatch",
            "severity": "medium",
            "entity_ref": "order_ccc"
        },
        {
            "type": "order_missing_in_events",
            "severity": "high",
            "entity_ref": "order_aaa"
        },
        {
            "type": "order_missing_in_documents",
            "severity": "low",
            "entity_ref": "order_bbb"
        }
    ]
    
    result = build_normalized_signals(payload, "ing_12345")
    signals = result["signals"]
    
    # Ordered by highest priority_score descending
    assert signals[0]["priority_score"] >= signals[1]["priority_score"]
    assert signals[1]["priority_score"] >= signals[2]["priority_score"]
    
def test_invariantes_output_contract():
    payload = build_base_payload()
    result = build_normalized_signals(payload, "ing_12345")
    
    # Validates ok directly
    _validate_output_contract(result)
    
    # Mutate to break contract
    mutated = copy.deepcopy(result)
    del mutated["signals"][0]["severity"]
    
    with pytest.raises(ValueError, match="Signal keys do not match required contract"):
        _validate_output_contract(mutated)

def test_limites_score():
    payload = build_base_payload()
    # Force high frequency to max out score modifier
    # base(medium: 55) + modifier(mismatch: 12) + freq = 67 + freq. CAP is 24 = 91. 
    # Force high severity to exceed 100
    payload["findings"][0]["severity"] = "high" # Base 80
    
    # Repeat finding purely over capacity (say 100 times)
    finding = payload["findings"][0].copy()
    payload["findings"] = [finding] * 100
    
    result = build_normalized_signals(payload, "ing_12345")
    
    # Total score shouldn't surpass 100
    score = result["signals"][0]["priority_score"]
    assert score <= 100
    assert score == 100 # Should be exactly 100 because 80 + 12 + 24 (cap) = 116 -> capped to 100

def test_signal_id_canonico_por_case_y_espacios():
    ingestion_id = "ing_12345"
    payload_a = {
        "module": "Concili_Simple",
        "findings": [
            {
                "type": "amount_mismatch",
                "severity": "high",
                "entity_ref": "Order_1",
            }
        ],
    }
    payload_b = {
        "module": " concili_simple ",
        "findings": [
            {
                "type": "amount_mismatch",
                "severity": "high",
                "entity_ref": " order_1 ",
            }
        ],
    }

    result_a = build_normalized_signals(payload_a, ingestion_id)
    result_b = build_normalized_signals(payload_b, ingestion_id)

    assert result_a["signals"][0]["signal_id"] == result_b["signals"][0]["signal_id"]

def test_dedup_preserva_contextos_unicos_deterministas():
    payload = {
        "module": "concili_simple",
        "findings": [
            {
                "type": "amount_mismatch",
                "severity": "high",
                "entity_ref": "order_1",
                "context": ["b_reason"],
            },
            {
                "type": "amount_mismatch",
                "severity": "high",
                "entity_ref": "order_1",
                "context": ["a_reason"],
            },
        ],
    }

    result = build_normalized_signals(payload, "ing_12345")
    assert len(result["signals"]) == 1
    assert result["signals"][0]["context"] == ["a_reason", "b_reason"]
