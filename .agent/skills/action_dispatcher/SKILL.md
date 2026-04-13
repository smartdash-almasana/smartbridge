name: action_dispatcher

description:
Mapea señales a acciones y ejecuta operaciones vía MCP determinístico.

input:
- signals (list)
- ingestion_id
- correlation_id

output:
- acciones ejecutadas

rules:

mapping:
- order_mismatch → create_review_task
- order_missing_in_documents → request_document
- duplicate_order → flag_duplicate

execution_rules:
- TODA ejecución debe incluir ingestion_id
- TODA ejecución debe incluir correlation_id en logs.write
- logs.write debe usar:
  {
    "actor": "action_dispatcher_agent",
    "action": "dispatch_action",
    "status": "success | failed",
    "correlation_id": "...",
    "ingestion_id": "...",
    "timestamp": "UTC ISO8601"
  }

deterministic_id:
action_id = hash(
  signal_code +
  entity_ref +
  ingestion_id
)
constraints:
- mismo input → mismo id
- prohibido generar ids aleatorios

mcp_payload_schema:
database.insert:
{
  "table": "actions",
  "id": "string",
  "payload": {
    "action_type": "string",
    "entity_ref": "string",
    "metadata": {}
  },
  "ingestion_id": "string"
}

constraints:
- determinista
- no branching ambiguo
- no heurísticas
- no retry automático

steps:
1. iterar signals
2. mapear signal_code → acción
3. generar action_id determinístico
4. construir payload según mcp_payload_schema
5. ejecutar MCP database.insert
6. ejecutar MCP logs.write (con correlation_id obligatorio)

fail_conditions:
- signal_code desconocido
- falla MCP
- falta ingestion_id
- payload no cumple schema MCP
- falta correlation_id
- id no determinístico
