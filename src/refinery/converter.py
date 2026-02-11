import sys
import os
from markitdown import MarkItDown

def convert_file(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File {file_path} not found.", file=sys.stderr)
        sys.exit(1)

    try:
        md = MarkItDown()
        result = md.convert(file_path)
        print(result.text_content)
    except Exception as e:
        print(f"Error converting file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python converter.py <file_path>", file=sys.stderr)
        sys.exit(1)
    
    file_path = sys.argv[1]
    convert_file(file_path)
