from google import genai
import os
from dotenv import load_dotenv

dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
load_dotenv(dotenv_path)

api_key = os.getenv('GEMINI_API_KEY')
if not api_key or api_key == 'YOUR_API_KEY':
    print("Error: Invalid API Key in .env")
    exit(1)

client = genai.Client(api_key=api_key)
print("Listing models...")
try:
    for m in client.models.list():
        if 'generateContent' in m.supported_actions:
            print(f"- {m.name}")
except Exception as e:
    print(f"Error listing models: {e}")
