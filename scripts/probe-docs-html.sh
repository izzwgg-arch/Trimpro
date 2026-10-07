#!/bin/bash
echo "=== unusual documents responses ==="
grep "/documents HTTP" /var/log/nginx/access.log | awk '$9 != 200 || $10+0 > 5000 { print }' | tail -40

echo "=== around 11:41 docs/refresh ==="
grep -E "11:4[0-5]:" /var/log/nginx/access.log | grep -E "documents|auth/refresh" | grep -E "94\.26\.67|199\.16\.53" | tail -50

echo "=== local documents without auth ==="
curl -sI "http://127.0.0.1:3000/api/clients/cmnfjysn904vcmc0ed03foq2z/documents" | head -20
echo "body:"
curl -s "http://127.0.0.1:3000/api/clients/cmnfjysn904vcmc0ed03foq2z/documents" | head -c 200
echo

echo "=== local refresh without body ==="
curl -sI -X POST "http://127.0.0.1:3000/api/auth/refresh" -H "Content-Type: application/json" | head -15
curl -s -X POST "http://127.0.0.1:3000/api/auth/refresh" -H "Content-Type: application/json" -d '{}' | head -c 200
echo
