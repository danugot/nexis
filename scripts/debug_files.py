
import os
import time

path = 'raw_docs'
for filename in os.listdir(path):
    filepath = os.path.join(path, filename)
    print(f"{filename} - {time.ctime(os.path.getmtime(filepath))}")
