import json
import requests
import cairosvg

with open('../src/examples/basic/vis_tree2.json', 'r', encoding='utf-8') as file:
    data = json.load(file)

url = 'http://localhost:9840/render'
response = requests.post(url, json=data)

file_path = '../data/output.png'
if response.status_code == 200:
    svg_content = response.content
    cairosvg.svg2png(bytestring=svg_content, write_to=file_path)
else:
    print(f"Failed, RC: {response.status_code}")
    