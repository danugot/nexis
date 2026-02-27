import requests
import time

# Create a session
res_session = requests.post("http://localhost:8002/sessions", json={"domainId": "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e"})
session_id = res_session.json()['id']
print(f"Created session: {session_id}")

query = "这个项目新增了哪些功能？请特别帮我总结一下其中关于【导流路径】和【回帖路径】的核心逻辑。"
project = "融合一期"

res = requests.post("http://localhost:8002/chat", json={
    "query": query,
    "projectName": project,
    "sessionId": session_id,
    "domainId": "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e"
}, stream=True)

for line in res.iter_lines():
    if line:
        decoded_line = line.decode('utf-8')
        if "data:" in decoded_line:
            print(decoded_line)
