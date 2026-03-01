import requests

domain_id = "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e"
url = f"http://localhost:8001/domains/{domain_id}/suggestions"

res = requests.get(url)
suggestions = res.json()
pending_suggestions = [s for s in suggestions if s['status'] == 'PENDING']

if not pending_suggestions:
    print("No PENDING suggestions found.")
    exit(1)

sugg_id = pending_suggestions[0]['id']
old_path = pending_suggestions[0]['proposedPath']

url2 = f"http://localhost:8001/domains/{domain_id}/suggestions/{sugg_id}/fine-tune"

payload = {
    "proposedPath": f"{old_path} -> 经过微调"
}

print(f"Testing PUT {url2}")
res2 = requests.put(url2, json=payload)
print(res2.status_code)
print(res2.json())
