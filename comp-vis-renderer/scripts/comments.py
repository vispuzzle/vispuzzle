import os
import re

chinese_re = re.compile(r'[\u4e00-\u9fff]')

def file_contains_chinese(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                if chinese_re.search(line):
                    return True
    except Exception:
        return False
    return False

def scan_project(root_dir):
    result = []
    for root, dirs, files in os.walk(root_dir):
        for name in files:
            path = os.path.join(root, name)
            if file_contains_chinese(path):
                result.append(path)
    return result

if __name__ == "__main__":
    import sys
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    matches = scan_project(root)
    for m in matches:
        print(m)