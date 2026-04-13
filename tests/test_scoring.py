import io
import pandas as pd
from app.services.scoring import compute_quality_score, compute_risk_score, compute_priority

def test_scoring_clean_dataset():
    df_raw = pd.DataFrame([
        {"order_id": "A1", "amount": "1000"},
        {"order_id": "A2", "amount": "2000"}
    ])
    mapping = {"order_id": "order_id", "amount": "amount"}
    
    q_score = compute_quality_score(df_raw, mapping)
    assert q_score > 0.8
    
    clean_data = [
        {"order_id": "A1", "amount": 1000.0},
        {"order_id": "A2", "amount": 2000.0}
    ]
    r_score = compute_risk_score(clean_data)
    assert r_score <= 0.20
    
    priority = compute_priority(q_score, r_score)
    assert priority in ["LOW", "MEDIUM"]

def test_scoring_dirty_dataset():
    df_raw = pd.DataFrame([
        {"order_id": "A1", "amount": "1000"},
        {"order_id": None, "amount": "abc"},
        {"order_id": "A3", "amount": None},
        {"order_id": "", "amount": ""}
    ])
    mapping = {"order_id": "order_id", "amount": "amount"}
    
    q_score = compute_quality_score(df_raw, mapping)
    assert q_score < 0.7  # Low valid records percentage
    
    clean_data = [
        {"order_id": "A1", "amount": 1000.0}
    ]
    r_score = compute_risk_score(clean_data)
    
    priority = compute_priority(q_score, r_score)
    assert priority == "HIGH"   # Quality low -> HIGH priority

def test_scoring_high_risk():
    df_raw = pd.DataFrame([
        {"order_id": "A1", "amount": "50"},
        {"order_id": "A2", "amount": "-1500"}  # negative
    ])
    mapping = {"order_id": "order_id", "amount": "amount"}
    
    q_score = compute_quality_score(df_raw, mapping)
    
    clean_data = [
        {"order_id": "A1", "amount": 50.0},
        {"order_id": "A2", "amount": -1500.0}
    ]
    # One negative out of 2 => 50% * 0.4 = 0.20 risk. Also consider outliers, but at least 0.2
    r_score = compute_risk_score(clean_data)
    assert r_score >= 0.15
    
    priority = compute_priority(q_score, r_score)
    assert priority in ["HIGH", "MEDIUM"]
