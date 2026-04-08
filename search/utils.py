from typing import Optional, Set, Tuple, Union
import networkx as nx
import matplotlib.pyplot as plt
from datetime import date, datetime
import numpy as np
import os
import json
import requests
import re
import cairosvg
from urllib.parse import urlparse
from search.scoring_model.scoring_model import get_aesthetic_score
from concurrent.futures import ThreadPoolExecutor, as_completed
from search.logger_config import logger

INF = 1e9
operators = ["le", "ge", "lt", "gt", "eq", "ne"]
op_convert_map = {"le": "<=", "ge": ">=", "lt": "<", "gt": ">", "eq": "==", "ne": "!="}
axes_convert_map = {"bar": 2, "line": 2, "scatter": 2, "pie": 1, "link": 1, "map": 1, "graph": 1}


def get_render_url():
    return os.getenv("VISPUZZLE_RENDER_URL") or os.getenv("RENDER_URL") or "http://localhost:9840/render"


def post_render_request(payload, *, accept_json=False, timeout=60):
    url = get_render_url()
    headers = {"Accept": "application/json"} if accept_json else None
    session = requests.Session()
    if urlparse(url).hostname in {"localhost", "127.0.0.1"}:
        # Avoid system proxy settings for local renderer calls.
        session.trust_env = False
    return session.post(url, json=payload, headers=headers, timeout=timeout)

def sigmoid(z):
    z = np.clip(z, -100, 100)
    return 1 / (1 + np.exp(-z))

class ViewNode:
    def __init__(self):
        self.chart = ""
        self.x_name = ""
        self.y_name = ""
        self.group_by = []
        self.groups = []
        self.bin = None
        self.bin_by = None
        self.agg = None
        self.score = None
        self.describe = ""
        self.data_columns = set()
        self.X = None
        self.Y = None
        self.x_type = None
        self.y_type = None
        
    def __str__(self):
        split_describe = self.describe.split(", ")
        return (
            f"{self.score:.2f}, {self.chart}\nx:{self.x_name}, y:{self.y_name}\n"
            + "\n".join(split_describe)
        )

    def __str__(self):
        return f"chart: {self.chart}, x_name: {self.x_name}, y_name: {self.y_name}, describe: [{self.describe}], group_by: {self.group_by}, bin: {self.bin}, bin_by: {self.bin_by}, agg: {self.agg}, data columns: {self.data_columns}, score: {self.score}"

    def get_relation_score(self, other):
        """
        Get the relationship score for two view nodes.
        Naive score: [number of common data columns] / [number of all data columns]
        """
        if len(self.data_columns) == 0 or len(other.data_columns) == 0:
            raise ValueError("Data columns are not initialized.")
        common_columns = self.data_columns.intersection(other.data_columns)
        all_columns = self.data_columns.union(other.data_columns)
        if len(common_columns) == len(all_columns):
            return 0
        return len(common_columns) / len(all_columns)

    def parse(self, key, value):
        self.score = sigmoid(value.score)
        p1 = key.find("chart: ")
        p2 = key.find(" x_name: ")
        p3 = key.find(" y_name: ")
        p4 = key.find(" describe: ")
        self.chart = key[p1 + 7 : p2]
        self.describe = key[p4 + 11 :]
        self.x_name = key[p2 + 9 : p3]

        # deal with case like "y_name: avg(A)"
        y_name_tmp = key[p3 + 9 : p4]
        if (
            y_name_tmp.startswith("avg(")
            or y_name_tmp.startswith("sum(")
            or y_name_tmp.startswith("cnt(")
        ):
            self.agg = y_name_tmp[:3]
        #     self.y_name = y_name_tmp[4:-1]
        # else:
        self.y_name = y_name_tmp

        # 从describe中提取group by A 和 bin A by B，可能有多个group by
        each = self.describe.split(", ")
        for e in each:
            if e.startswith("group by"):
                p = e.find("group by ")
                group_by = e[p + 9 :]
                if group_by == self.x_name:
                    continue
                self.group_by.append(group_by)
            elif e.startswith("bin") or e.startswith("5 bin") or e.startswith("10 bin"):
                p1 = e.find("bin ")
                p2 = e.find(" by ")
                bin = e[p1 + 4 : p2]
                bin_by = e[p2 + 4 :]
                self.bin = bin
                self.bin_by = bin_by

                # deal with case when x_name is (bin)/(bin_by) like "born/(year)"
                if self.x_name == f"{self.bin}/({self.bin_by})":
                    self.x_name = self.bin

        # get all the possible data columns for further analysis
        self.data_columns.add(self.x_name)
        self.data_columns.add(self.y_name)
        for g in self.group_by:
            self.data_columns.add(g)
        if self.bin:
            self.data_columns.add(self.bin)
        self.groups = [name for name, count in value.table.classes]
        handle_interval = False
        if self.chart == "line":
            handle_interval = True
        self.X = self.convert_to_isofmt(value.X, handle_interval)
        self.Y = self.convert_to_isofmt(value.Y)
        self.x_type = value.fx.type
        self.y_type = value.fy.type
        
    def convert_to_isofmt(self, data, handle_interval=False):
        if isinstance(data, list):
            res = [self.convert_to_isofmt(item, handle_interval) for item in data]
            if len(res) > 0 and isinstance(res[0], str):
                if all([x.endswith("-01-01") for x in res]):
                    return [x[:-6] for x in res]
            if handle_interval:
                for i in range(len(res)):
                    if isinstance(res[i], str) and "~" in res[i]:
                        res[i] = res[i].split("~")[0]
            return res
        elif isinstance(data, (datetime, date)):
            return data.isoformat()
        elif isinstance(data, (int, float)):
            return data
        else:
            return str(data)

class Condition:
    def __init__(self, column: str, cond: Tuple[str, Union[int, float, str]]):
        """
        Example:
        >>> cond = Condition('age', ('ge', 18))
        >>> # age >= 18
        """
        self.column = column
        if cond[0] not in operators:
            raise ValueError(f"Operator must be one of {operators}")
        self.cond = cond

    def __str__(self):
        return f"{self.column} {op_convert_map[self.cond[0]]} {self.cond[1]}"

    def __eq__(self, other):
        if isinstance(other, Condition):
            return self.column == other.column and self.cond == other.cond
        return False

    def __hash__(self):
        return hash((self.column, self.cond))


class DataColumn:
    def __init__(self, column: str, condition: Optional[Condition] = None):
        self.column = column
        self.condition = condition

    def __str__(self):
        return f"{self.column}{self.condition if self.condition is not None else ''}"

    def __eq__(self, other):
        if isinstance(other, DataColumn):
            return self.column == other.column and self.condition == other.condition
        return False

    def __hash__(self):
        return hash((self.column, self.condition))


class DataOperation:
    """
    Defines the operation to merge nodes in the data composition tree.
    DataOperation types:
    - `UNION`: merge condition into column.
    - `JOIN`: join based on shared data column.
    """

    def __init__(self, type, column: str):
        if type not in ["ALL_UNION", "TWO_UNION", "COLUMN_JOIN", "CONDITION_JOIN"]:
            raise ValueError(
                "DataOperation type must be one of ['ALL_UNION', 'TWO_UNION', 'COLUMN_JOIN', 'CONDITION_JOIN']"
            )
        self.type = type
        self.column = column

    def __str__(self):
        return f"{self.type} {self.column}"



def plot_compostition_graph(nodes: Set, save_path: str = "composition_graph.png"):
    def topo_pos(G):
        """Display in topological order, with simple offsetting for legibility"""
        pos_dict = {}
        for i, node_list in enumerate(nx.topological_generations(G)):
            x_offset = len(node_list) / 2
            y_offset = 0.00
            for j, name in enumerate(node_list):
                pos_dict[name] = (-i + j * y_offset, j - x_offset)

        return pos_dict
    
    if len(nodes) == 0:
        logger.warning("WARNING: No nodes to plot.")
        return
        
    G = nx.DiGraph()
    for node in nodes:
        G.add_node(node)
        for child in node.children:
            G.add_edge(node, child)
    
    if len(G.nodes()) == 0:
        logger.warning("WARNING: Graph has no nodes.")
        return
        
    pos = topo_pos(G)
    # Set aspect ratio for the figure
    plt.figure(figsize=(15, 10))
    
    # Use matplotlib backend that doesn't require display
    plt.switch_backend('Agg')
    
    # Draw the graph
    nx.draw(G, pos, node_color='lightblue', node_size=1000, 
            with_labels=False, arrows=True, edge_color='gray')
    
    # Draw labels with better positioning
    labels = {node: str(node) for node in G.nodes()}
    nx.draw_networkx_labels(G, pos, labels, font_size=8, 
                           horizontalalignment="right", verticalalignment="bottom")
    
    plt.title("Data Composition Graph", fontsize=16)
    # Add padding on the right side to make room for labels
    plt.subplots_adjust(right=0.75)  # Adjust the right margin to leave space
    # Save the plot
    plt.savefig(save_path, dpi=300)
    logger.info(f"Graph saved to {save_path}")
    plt.close()  # Close the figure to free memory


def plot_line(data: list, file_path: str, xlabel="Index", ylabel="Value", title="Line Plot of Data"):
    x = range(len(data))
    y = data

    plt.figure(figsize=(8, 5))  # Set figure size
    plt.plot(x, y, marker='o', linestyle='-', color='b', label='Data Line')

    plt.title(title, fontsize=14)
    plt.xlabel(xlabel, fontsize=12)
    plt.ylabel(ylabel, fontsize=12)

    plt.grid(True, linestyle='--', alpha=0.6)

    plt.savefig(file_path, dpi=300, bbox_inches='tight')
    plt.close()

def plot_layout_diagram(root_node, save_path: str = "layout_diagram.png"):
    """
    根据可视化节点树的布局信息绘制一个示意图
    
    Args:
        root_node: 可视化节点树的根节点
        save_path: 保存图像的路径
    """
    import matplotlib.pyplot as plt
    import matplotlib.patches as patches
    from matplotlib.colors import to_rgba
    
    plt.figure(figsize=(12, 8))
    ax = plt.gca()
    
    # 定义一些颜色
    chart_type_colors = {
        'bar': '#3498db',
        'line': '#2ecc71',
        'pie': '#e74c3c',
        'scatter': '#9b59b6',
        'map': '#f39c12',
        'graph': '#1abc9c',
        'link': '#d35400',
        None: '#95a5a6'  # 默认颜色
    }
    
    pattern_colors = {
        'repetition': '#3498db',
        'stack': '#2ecc71',
        'mirror': '#e74c3c',
        'linkage': '#9b59b6',
        'coaxis': '#f39c12',
        'coordinate': '#1abc9c',
        'annotation': '#d35400',
        'nesting': '#34495e',
        None: '#95a5a6'  # 默认颜色
    }
    
    def add_transparency(color, alpha=0.7):
        """为颜色添加透明度"""
        if isinstance(color, str):
            rgba = to_rgba(color)
            return (rgba[0], rgba[1], rgba[2], alpha)
        return color
    
    # 递归绘制节点及其子节点
    def draw_node(node, depth=0):
        if not hasattr(node, 'layout') or not node.layout.initialized:
            return
        
        # 获取布局信息
        x = node.layout.x
        y = node.layout.y
        width = node.layout.width
        height = node.layout.height
        
        # 选择颜色
        if node.data_node and (node.data_node.node_type == 'data' or (node.data_node.node_type == 'all_union' and len(node.children) == 0)):
            color = chart_type_colors.get(node.chart_type[0] if node.chart_type else None, chart_type_colors[None])
            label = f"{node.chart_type[0] if node.chart_type else 'unknown'}"
        else:
            color = pattern_colors.get(node.composite_pattern, pattern_colors[None])
            label = f"{node.composite_pattern or 'unknown'} - {node.spatial_arrangement or 'unknown'}"
        
        # 添加半透明矩形
        rect = patches.Rectangle((x, y), width, height, 
                               linewidth=2, 
                               edgecolor=color,
                               facecolor=add_transparency(color),
                               alpha=0.5)
        ax.add_patch(rect)
        
        # 添加标签
        plt.text(x + width/2, y + height/2, label,
                horizontalalignment='center',
                verticalalignment='center',
                fontsize=8)
        
        # 递归处理子节点
        for child in node.children:
            draw_node(child, depth + 1)
    
    # 从根节点开始绘制
    draw_node(root_node)
    
    # 设置坐标轴
    ax.set_aspect('equal')
    
    # 找出最大范围来设置图的边界
    def find_bounds(node, bounds=None):
        if bounds is None:
            bounds = {'min_x': float('inf'), 'min_y': float('inf'), 
                     'max_x': float('-inf'), 'max_y': float('-inf')}
        
        if hasattr(node, 'layout') and node.layout.initialized:
            x = node.layout.x
            y = node.layout.y
            width = node.layout.width
            height = node.layout.height
            
            bounds['min_x'] = min(bounds['min_x'], x)
            bounds['min_y'] = min(bounds['min_y'], y)
            bounds['max_x'] = max(bounds['max_x'], x + width)
            bounds['max_y'] = max(bounds['max_y'], y + height)
        
        for child in node.children:
            bounds = find_bounds(child, bounds)
        
        return bounds
    
    bounds = find_bounds(root_node)
    
    # 确保边界有一定的边距
    padding = 20
    plt.xlim(bounds['min_x'] - padding, bounds['max_x'] + padding)
    # 反转y轴，使y坐标从上往下变大
    plt.ylim(bounds['max_y'] + padding, bounds['min_y'] - padding)
    
    # 设置标题和标签
    plt.title('Visualization Layout Diagram', fontsize=14)
    plt.xlabel('X Position', fontsize=12)
    plt.ylabel('Y Position', fontsize=12)
    
    # 为图例创建一些虚拟对象
    legend_patches = []
    # 图表类型图例
    for chart_type, color in chart_type_colors.items():
        if chart_type is not None:
            patch = patches.Patch(color=add_transparency(color), label=f'Chart: {chart_type}')
            legend_patches.append(patch)
    
    # 组合模式图例
    for pattern, color in pattern_colors.items():
        if pattern is not None:
            patch = patches.Patch(color=add_transparency(color), label=f'Pattern: {pattern}')
            legend_patches.append(patch)
    
    # 添加图例，放在图的右侧外部
    plt.legend(handles=legend_patches, loc='center left', bbox_to_anchor=(1, 0.5))
    
    # 保存图像
    plt.tight_layout()
    plt.savefig(save_path, bbox_inches='tight', dpi=300)
    plt.close()
    logger.info(f"Layout diagram saved to {save_path}")


def jsonize_data(data):
    """
    将数据转换为标准化的JSON格式
    
    Args:
        data: 包含X、Y等数据的对象
        
    Returns:
        dict: 格式化后的JSON数据，如果数据无效则返回None
    """
    options = {}
        
    # 默认值
    defaults = {
        "title": "Data Visualization Chart",
        "description": "Data Visualization Results",
        "mainInsight": "The data shows key insights",
    }
    
    # 合并选项
    metadata = {**defaults}
    metadata["chart_type"] = getattr(data, "chart", "unknown")
    
    # 检查数据是否有效
    if not data or not hasattr(data, 'X') or not hasattr(data, 'Y') or data.X is None or data.Y is None:
        logger.info(f"Chart type: {metadata['chart_type']}")
        logger.warning("No data conversion needed")
        return None
    
    x_data = data.X
    
    # 检查是否有多组Y数据（基于label）
    has_multiple_groups = len(data.groups) > 1 if hasattr(data, 'groups') else False
    
    # 准备columns
    columns = []
    
    # 推断X的数据类型
    data_type = {
        1: "categorical",
        2: "numerical",
        3: "temporal",
    }
    x_data_type = data_type[data.x_type]
    y_data_type = data_type[data.y_type]
    
    # 添加X列 - 始终是第一位
    columns.append({
        "name": data.x_name,
        "description": f"",
        "data_type": x_data_type,
        "unit": "",
        "role": "x"  # X轴数据
    })
    columns.append({
        "name": data.y_name,
        "description": f"",
        "data_type": y_data_type,
        "unit": "",
        "role": "y"  # Y轴数据
    })
    
    if has_multiple_groups:
        y_labels = data.groups
        group_name = data.group_by[0]
        columns.append({
            "name": group_name,
            "description": f"",
            "data_type": "categorical",
            "unit": "",
            "role": "group"  # 分组数据
        })
    
    data_types = [col["data_type"] for col in columns]
    type_combination = " + ".join(data_types)
    
    # 生成转换后的数据结构
    formatted_data = {
        "description": metadata["description"],
        "data": {
            "data": [],
            "columns": columns,
            "type_combination": type_combination,
        },
        "metadata": {
            "title": metadata["title"],
            "description": metadata["description"],
            "main_insight": metadata["mainInsight"],
            "chart_type": metadata["chart_type"],
        },
    }
    
    # 填充数据
    if has_multiple_groups:
        y_series_data = data.Y
        y_labels = data.groups
        group_name = data.group_by[0]
        value_name = data.y_name
        
        for i in range(len(y_series_data)):
            for j in range(len(y_series_data[i])):
                entry = {}
                if len(x_data) == 1:
                    entry[data.x_name] = x_data[0][j]
                else:
                    entry[data.x_name] = x_data[i][j]
                # 2. 添加Y数据
                entry[value_name] = y_series_data[i][j]
                # 4. 添加分组标签
                entry[group_name] = y_labels[i]
                formatted_data["data"]["data"].append(entry)
    else:
        # 处理标准格式
        max_length = len(x_data[0])
        x_data = data.X[0]
        y_data = data.Y[0]
        
        for i in range(max_length):
            entry = {}
            
            # 添加X数据
            if i < len(x_data):
                entry[data.x_name] = x_data[i]
            
            # 添加Y数据
            if i < len(y_data):
                entry[data.y_name] = y_data[i]

            formatted_data["data"]["data"].append(entry)
    
    return formatted_data

def render_visualizations(dataset_name, theme_index, top_n=50, output_dir="output_dir"):
    """渲染前n个可视化结果"""
    # 统一输出：结果JSON与图像都放在同一数据集目录下
    unified_output_dir = os.path.join(output_dir, dataset_name)
    result_file = os.path.join(unified_output_dir, f'{dataset_name}_{theme_index}.json')
    
    if not os.path.exists(result_file):
        logger.error(f"Result file {result_file} not found")
        return []
    
    logger.info(f"Rendering top {top_n} visualizations from {result_file}")
    
    # 读取结果文件
    with open(result_file, 'r', encoding='utf-8') as file:
        lines = file.readlines()
    
    count = 0
    result_file_paths = []
    file_format = 'svg'
    
    os.makedirs(unified_output_dir, exist_ok=True)
    
    # 只处理前n个结果
    for i, line in enumerate(lines[:top_n]):
        try:
            data = json.loads(line)
            response = post_render_request(data)
            file_path = os.path.join(unified_output_dir, f'{dataset_name}_{theme_index}_{i}.{file_format}')
            
            if response.status_code == 200:
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
                result_file_paths.append(file_path)
                count += 1
            else:
                logger.error(f"Request {i} failed, status code: {response.status_code}, {response.text}")
                
        except Exception as e:
            logger.error(f"Request exception for item {i}: {e}")

    logger.info(f"Successfully rendered {count}/{top_n} visualizations")
    return result_file_paths

def get_visualization_aesthetic_scores(dataset_name: str, theme_index: int, top_n: int = 50, output_dir: str = "output_dir") -> Optional[dict]:
    result_file_paths = render_visualizations(dataset_name, theme_index, top_n, output_dir)
    aesthetic_scores = {}
    
    if not result_file_paths:
        return aesthetic_scores
    
    # Use ThreadPoolExecutor for parallel processing
    with ThreadPoolExecutor(max_workers=10) as executor:
        # Submit all tasks at once
        future_to_path = {executor.submit(get_aesthetic_score, path): path for path in result_file_paths}
        
        # Process completed futures as they finish
        for future in as_completed(future_to_path):
            file_path = future_to_path[future]
            try:
                aesthetic_result = future.result()
                index = file_path[file_path[:-4].rfind('_') + 1:-4]
                aesthetic_scores[int(index)] = aesthetic_result['normalized_score']
            except Exception as e:
                logger.error(f"Error getting aesthetic score for {file_path}: {e}")
                aesthetic_scores[int(index)] = 0.0  # Default score for failed cases

    return aesthetic_scores

def deduplication_history_score(history_scores, dedup_mode):
    """
    dedup_mode: 'hard', 'middle', 'easy'
    'easy': no deduplication
    ['middle', 'hard']: deduplicate based on both score similarity and structure similarity
      - 'hard': children order insensitive
      - 'middle': children order sensitive
    """
    assert dedup_mode in ['hard', 'middle', 'easy']
    if not history_scores or dedup_mode == 'easy':
        return history_scores
    
    deduplicated = [history_scores[0]]  # Always keep the first item
        
    def _duplicate(item1, item2):
        # Get detailed_score from both items
        current_detailed = item1[1].get('detailed_score', {})
        previous_detailed = item2[1].get('detailed_score', {})
        
        # Check if all detailed_score differences are less than 0.01
        score_duplicate = True
        # Check main score fields: total, aesthetic, cognitive, task_relevance
        main_fields = ['total', 'aesthetic', 'cognitive', 'task_relevance']
        for field in main_fields:
            current_value = current_detailed.get(field, 0)
            previous_value = previous_detailed.get(field, 0)
            
            if abs(current_value - previous_value) >= 0.01:
                score_duplicate = False
                break
        
        # If main fields are similar, check detailed_cognitive sub-fields
        if score_duplicate:
            current_cognitive = current_detailed.get('detailed_cognitive', {})
            previous_cognitive = previous_detailed.get('detailed_cognitive', {})
            
            # Get all unique keys from both detailed_cognitive dictionaries
            cognitive_keys = set(current_cognitive.keys()) | set(previous_cognitive.keys())
            
            for key in cognitive_keys:
                current_value = current_cognitive.get(key, 0)
                previous_value = previous_cognitive.get(key, 0)
                
                if abs(current_value - previous_value) >= 0.03:
                    score_duplicate = False
                    break
        
        # Check structural similarity
        structure_duplicate = False
        try:
            # Parse JSON strings to get visualization structure
            current_vis_tree = json.loads(item1[0])
            previous_vis_tree = json.loads(item2[0])
            
            # Get root node information
            current_root_id = list(current_vis_tree.keys())[0]
            previous_root_id = list(previous_vis_tree.keys())[0]
            
            current_root = current_vis_tree[current_root_id]
            previous_root = previous_vis_tree[previous_root_id]
            
            # Compare root node properties
            if (current_root_id == previous_root_id and
                current_root.get('composite_pattern') == previous_root.get('composite_pattern') and
                current_root.get('spatial_arrangement') == previous_root.get('spatial_arrangement') and
                current_root.get('spatial_distribution') == previous_root.get('spatial_distribution')):
                
                # Compare children sets (order-independent)
                if dedup_mode == 'hard':
                    current_children = set(current_root.get('children', []))
                    previous_children = set(previous_root.get('children', []))
                else:
                    current_children = current_root.get('children', [])
                    previous_children = previous_root.get('children', [])
                
                if current_children == previous_children:
                    structure_duplicate = True
                    
        except (json.JSONDecodeError, KeyError, IndexError):
            # If parsing fails, fall back to score-only comparison
            structure_duplicate = False
        
        # Consider it a duplicate if either scores are very similar OR structure is identical
        is_duplicate = score_duplicate or structure_duplicate
        return is_duplicate
    
    for i in range(1, len(history_scores)):
        current_item = history_scores[i]
        is_duplicate = False
        for j in range(len(deduplicated)-1, max(len(deduplicated)-5, -1), -1):
            previous_item = deduplicated[j]
            if _duplicate(current_item, previous_item):
                is_duplicate = True
                break
        # Only add if it's not a duplicate
        if not is_duplicate:
            deduplicated.append(current_item)
    return deduplicated
