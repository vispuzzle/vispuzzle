import json
import os
import cairosvg
import shutil
import sys
import argparse
import pathlib
import re
from search.utils import post_render_request

# Parse command line arguments
parser = argparse.ArgumentParser(description='Process JSON data and generate visualization charts')
parser.add_argument('--dataset', '-d', type=str, help='Dataset filename', default='tmp')
parser.add_argument('--format', '-f', type=str, choices=['svg', 'png', 'pdf'], help='Output format', default='svg')
args = parser.parse_args()

dataset_name = os.path.splitext(os.path.basename(args.dataset))[0]

# 查找所有以dataset_name为前缀的结果文件
result_files = []
if os.path.exists('./results'):
    for filename in os.listdir('./results'):
        if filename.startswith(f'{dataset_name}_') and filename.endswith('.json'):
            # 从文件名中提取theme_index
            try:
                theme_index = int(re.search(f'{dataset_name}_(\d+)\.json', filename).group(1))
                result_files.append((filename, theme_index))
            except (AttributeError, ValueError):
                continue

# 按theme_index排序处理文件
for filename, theme_index in sorted(result_files, key=lambda x: x[1]):
    file_path = os.path.join('./results', filename)
    with open(file_path, 'r', encoding='utf-8') as file:
        lines = file.readlines()
        
    count = 0
    file_format = args.format
    for i, line in enumerate(lines):
        # if i != 4:
        #     continue
        # Parse JSON data from each line
        data = json.loads(line)

        # Send POST request to visualization server
        try:
            response = post_render_request(data)
            # Create dataset-specific directory under data
            output_dir = f'./data/{dataset_name}'
            os.makedirs(output_dir, exist_ok=True)
            
            # Use dataset name as part of the output filename in the dataset-specific directory
            file_path = f'{output_dir}/{dataset_name}_{theme_index}_{i}.{file_format}'
            
            # Check if the request was successful
            if response.status_code == 200:
                # Save the returned SVG content to the specified path
                svg_content = response.content
                if file_format == 'svg':
                    with open(file_path, 'wb') as file:
                        file.write(svg_content)
                        
                elif file_format == 'png':
                    # Extract viewBox dimensions from SVG
                    svg_text = svg_content.decode('utf-8')
                    viewbox_match = re.search(r'viewBox=["\']([^"\']+)["\']', svg_text)
                    if viewbox_match:
                        viewbox = viewbox_match.group(1).split()
                        if len(viewbox) == 4:
                            _, _, width, height = map(float, viewbox)
                            # Apply 2.5x scale to improve output resolution, if exceeds 7500, then set to 7500, same ratio
                            if width * 2.5 > 7500 or height * 2.5 > 7500:
                                width, height = width * 7500 / max(width, height), height * 7500 / max(width, height)
                            else:
                                width, height = width * 2.5, height * 2.5
                            # Update the SVG content with new dimensions
                            svg_content = svg_text.encode('utf-8').replace(
                                b'viewBox=',
                                f'width="{width}" height="{height}" viewBox='.encode('utf-8')
                            )
                    cairosvg.svg2png(bytestring=svg_content, write_to=file_path)
                    
                elif file_format == 'pdf':
                    # Extract viewBox dimensions from SVG for better PDF quality
                    svg_text = svg_content.decode('utf-8')
                    viewbox_match = re.search(r'viewBox=["\']([^"\']+)["\']', svg_text)
                    if viewbox_match:
                        viewbox = viewbox_match.group(1).split()
                        if len(viewbox) == 4:
                            _, _, width, height = map(float, viewbox)
                            # Apply 2x scale for PDF to improve quality
                            if width * 2 > 7500 or height * 2 > 7500:
                                width, height = width * 7500 / max(width, height), height * 7500 / max(width, height)
                            else:
                                width, height = width * 2, height * 2
                            # Update the SVG content with new dimensions
                            svg_content = svg_text.encode('utf-8').replace(
                                b'viewBox=',
                                f'width="{width}" height="{height}" viewBox='.encode('utf-8')
                            )
                    cairosvg.svg2pdf(bytestring=svg_content, write_to=file_path)
                    
                print(f"Chart generated: {file_path}")
            else:
                print(f"Request {i} failed, status code: {response.status_code}, {response.text}")

        except Exception as e:
            print(f"Request exception: {e}")
        count += 1
