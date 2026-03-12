import os
import requests
import json
import time

AGENT_URL = "http://localhost:8002/chat"
DOMAIN_ID = "eb0e86ee-7c30-4d2f-ad69-96367b20f7b0"
SESSION_ID = "cmdline-test-session"

def chat(query):
    print(f"\n==========================================")
    print(f"USER: {query}")
    print(f"==========================================")
    
    # ensure session exists in DB (simulate, though we might bypass session creation for quick test)
    # Actually, the agent requires proper sessionId that exists in postgres, so let's hit rag_api directly for retrieval testing?
    # No, to test SmartChat, we should test the whole pipeline. Let's create a session first via Agent URL.
    try:
        session_res = requests.post("http://localhost:8002/sessions", json={"domainId": DOMAIN_ID})
        session_id = session_res.json().get("id")
    except Exception as e:
        print(f"Failed to create session: {e}")
        return

    try:
        response = requests.post(
            AGENT_URL, 
            json={
                "query": query,
                "sessionId": session_id,
                "domainId": DOMAIN_ID
            },
            stream=True
        )
        
        full_text = ""
        for line in response.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                if decoded_line.startswith("data: "):
                    data_str = decoded_line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        if data.get("type") == "text":
                            full_text += data.get("text", "")
                            print(data.get("text", ""), end="", flush=True)
                        elif data.get("type") == "tool":
                            print(f"\n\n[Tool Call] {data.get('name')}({data.get('args')})\n")
                    except Exception as e:
                        pass
        print("\n")
    except Exception as e:
        print(f"\nError hitting chat API: {e}")

queries = [
    # 1. Cross-Project
    "云贷一期和云贷二期在产品模式上最大的区别是什么？",
    # 2. Technical Interface
    "光大银行云贷对接里的授信结果通知接口，包含哪些关键的出参字段？",
    # 3. Business Logic
    "预授信失效的条件是什么？"
]

for q in queries:
    chat(q)
    time.sleep(2)
