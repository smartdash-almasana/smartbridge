import asyncio
from app.services.reconciliation.engine import reconcile_orders

events = [{'order_id': '1.23E+02', 'total_amount': '150.50', 'status': 'PAGADO'}]
docs = [{'order_id': 123, 'total_amount': 150.5, 'status': 'paid'}]

print(reconcile_orders(events, docs))

