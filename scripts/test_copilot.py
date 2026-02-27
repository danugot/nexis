import requests
import time
import json

# Create a session
res_session = requests.post("http://localhost:8002/sessions", json={"domainId": "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e"})
session_id = res_session.json()['id']
print(f"Created session: {session_id}")

query = "我想在银票业务里加上第三方资方垫付环节，帮我分析一下可行性并生成PRD"

print(f"Sending Query: {query}")
res = requests.post("http://localhost:8002/chat", json={
    "query": query,
    "sessionId": session_id,
    "domainId": "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e"
}, stream=True)

for line in res.iter_lines():
    if line:
        decoded_line = line.decode('utf-8')
        if "data:" in decoded_line:
            data_str = decoded_line.replace("data:", "").strip()
            if data_str == "[DONE]":
                break
            try:
                data = json.loads(data_str)
                if data.get('type') == 'tool':
                    print(f"🛠️ Tool Call: {data.get('name')} | Args: {data.get('args')}")
                elif data.get('type') == 'text':
                    print(data.get('text'), end="", flush=True)
            except:
                pass
print("\n[DONE]")
