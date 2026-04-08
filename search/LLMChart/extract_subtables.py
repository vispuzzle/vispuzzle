
import random
import json
import os
import pickle

import numpy as np

np.random.seed(0)
random.seed(0)

import numpy as np
import pandas as pd
from search.LLMChart.HAIChart import model
from search.LLMChart.utils_llm import ask_question_without_image, get_client
from search.LLMChart.utils_parse import load_json
import argparse
import copy

class DataProcessor:
    def __init__(self, data_path, prompt_path, prompt_version, no_llm_filter=False, filters=None):
        self.data_path = data_path
        self.dataset_name = os.path.basename(data_path).split('.')[0]
        self.prompt_path = prompt_path
        self.prompt_version = prompt_version
        self.output_path = os.path.join(os.path.dirname(__file__), 'subtables')
        os.makedirs(self.output_path, exist_ok=True)
        self.no_llm_filter = no_llm_filter
        self.filters = filters  # 添加筛选条件参数
        np.random.seed(0)

    def get_view_nodes(self):
        """获取view nodes"""
        views = model.upload_dataset(self.data_path, self.filters)
        
        # 检查是否存在对应的GeoJSON文件
        dataset_base_name = os.path.basename(self.data_path).split('.')[0]
        geojson_path = os.path.join(os.path.dirname(__file__), 'HAIChart', 'datasets', f"{dataset_base_name}.geojson")
        graphjson_path = os.path.join(os.path.dirname(__file__), 'HAIChart', 'datasets', f"{dataset_base_name}.graph.json")
        keys_to_delete = []
        for k in views.keys():
            if 'chart: line' in k and 'bin ' in k and ' by time' in k:
                keys_to_delete.append(k)
        for k in keys_to_delete:
            del views[k]
            
        # # Limit to at most 100 views
        # if len(views) > 100:
        #     keys = list(views.keys())
        #     selected_keys = keys[:100]
        #     views = {k: views[k] for k in selected_keys}
        
        _views_description = [d for d in views]
        _view_nodes = model.view_to_view_nodes(views)
        views_description = []
        view_nodes = []
        
        if os.path.exists(geojson_path):
            describe, map_view_node = model.add_map_view_node(geojson_path, dataset_base_name)
            views_description.append(describe)
            view_nodes.append(map_view_node)
            
        if os.path.exists(graphjson_path):
            describe, graph_view_node = model.add_graph_view_node(graphjson_path, dataset_base_name)
            views_description.append(describe)
            view_nodes.append(graph_view_node)
        
        linked_views = set()        
        for i in range(len(_view_nodes)):
            view_node = _view_nodes[i]
            # Filter sum chart
            if view_node.y_name.startswith("sum("):
                continue
            if view_node.y_name.startswith("avg(world"):
                view_node.y_name = view_node.y_name.replace("avg(world", "world")
                view_node.y_name = view_node.y_name.replace(")", "")
            # 处理可转换为link图表的视图
            if view_node.y_name == f"cnt({view_node.x_name})":
                for group in view_node.group_by:
                    if group != view_node.x_name:
                        if (view_node.x_name, group) not in linked_views and len(view_node.X[0]) <= 15 and len(view_node.Y) <= 15 and len(view_node.X[0]) * len(view_node.Y) < 100:
                            new_view_node = copy.deepcopy(view_node)
                            if new_view_node.bin_by == 'zero':
                                new_view_node.X[0] = [new_view_node.bin + new_view_node.X[0][0], new_view_node.bin + new_view_node.X[0][1]]
                            new_view_node.chart = "link"
                            view_nodes.append(new_view_node)
                            new_view_description = copy.deepcopy(_views_description[i])
                            new_view_description = new_view_description.replace(view_node.chart, "link")
                            views_description.append(new_view_description)
                            linked_views.add((view_node.x_name, group))
                            linked_views.add((group, view_node.x_name))
                        break
            
            # 处理可以转换bin/group的time柱状图
            if view_node.bin_by and view_node.bin_by == 'time' and len(view_node.group_by) >= 1 and view_node.chart == "bar":
                # 创建一个交换bin和group的节点
                new_node = copy.deepcopy(view_node)
                new_node.X = [view_node.groups]
                new_node.Y = np.array(view_node.Y).T.tolist()
                new_node.bin = new_node.bin_by = None
                new_node.group_by = [view_node.bin]
                new_node.groups = view_node.X[0]
                new_node.x_name = view_node.group_by[0]
                new_node.x_type = 1 # 1 for categorical
                new_node.y_name = new_node.y_name.replace(view_node.x_name, new_node.x_name)
                new_node.describe = 'group by ' + new_node.group_by[0]
                if hasattr(new_node, 'data_columns') and new_node.data_columns:
                    new_node.data_columns = set([new_node.x_name, new_node.y_name, new_node.group_by[0]])
                
                # 添加交换后的节点到列表中
                view_nodes.append(new_node)
                # 创建对应的描述
                new_view_description = f"Bar chart with x-axis: {new_node.x_name}, y-axis: {new_node.y_name}, grouped by {new_node.group_by[0]}"
                views_description.append(new_view_description)
            
            # 添加原始节点
            views_description.append(_views_description[i])
            view_nodes.append(view_node)
            
        views_description = [{'id': i, 'description': views_description[i]} for i in range(len(views_description))]
        views_description = json.dumps(views_description, ensure_ascii=False)
        return view_nodes, views_description

    def prepare_question(self, table, views_description):
        """准备问题模板"""
        prompt_data = load_json(self.prompt_path)[self.prompt_version]
        return prompt_data.replace('{table}', table).replace('{basic visualization description}', views_description)

    def process_response(self, response):
        """处理模型响应"""
        start = response.find('```')
        end = response.find('```', start + 1)
        response = response[start+3:end]
        if response.startswith('json'):
            response = response[4:]
        return json.loads(response)

    def save_result(self, selected_view_nodes, result=None):
        """保存结果"""
        index = 0
        while os.path.exists(os.path.join(self.output_path, f'{self.dataset_name}_{index}.json')):
            index += 1
        file_path = os.path.join(self.output_path, f'{self.dataset_name}_{index}')
        if result is not None:
            with open(file_path + '.json', 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2)
        else:
            # 输出所有selected_view_nodes的str
            print(f"Saving {len(selected_view_nodes)} selected view nodes to {file_path}.pkl")
            with open(file_path + '.txt', 'w', encoding='utf-8') as f:
                f.write('\n'.join([str(node) for node in selected_view_nodes]) + '\n')
        with open(file_path + '.pkl', 'wb') as f:
            pickle.dump(selected_view_nodes, f)

    def filter_similar_nodes(self, selected_view_nodes):
        """过滤相似的视图节点
        
        规则:
        1. 对于data_columns几乎相同但一个包含avg(x)另一个包含sum(x)的节点，只保留avg的节点
        2. 对于x_name和y_name都相同的节点，保留score值最高的节点
        
        Args:
            selected_view_nodes: 选择的视图节点列表
            
        Returns:
            filtered_nodes: 过滤后保留的节点列表
            filtered_indices: 被过滤掉的节点索引列表
        """
        filtered_indices = []
        
        # 首先处理avg/sum情况 - 使用data_columns
        # 查找所有节点的data_columns
        node_data_columns = []
        for i, node in enumerate(selected_view_nodes):
            if hasattr(node, 'data_columns') and node.data_columns:
                node_data_columns.append((i, set(node.data_columns)))
            else:
                node_data_columns.append((i, set()))
        
        # 检查是否有avg/sum对
        for i, cols_i in node_data_columns:
            if i in filtered_indices:
                continue
                
            for j, cols_j in node_data_columns:
                if i == j or j in filtered_indices:
                    continue
                
                # tmp
                if selected_view_nodes[i].chart != selected_view_nodes[j].chart:
                    continue
                
                # 找出两个节点的不同元素
                diff_i = cols_i - cols_j
                diff_j = cols_j - cols_i
                
                # 如果差异只有一个元素，检查是否是avg/sum对
                if len(diff_i) == 1 and len(diff_j) == 1:
                    col_i = list(diff_i)[0]
                    col_j = list(diff_j)[0]
                    
                    # 检查是否为avg/sum对
                    if "avg(" in col_i and "sum(" in col_j:
                        avg_content = col_i[4:-1]  # 去掉"avg("和")"
                        sum_content = col_j[4:-1]  # 去掉"sum("和")"
                        if avg_content == sum_content:
                            filtered_indices.append(j)  # 过滤掉sum节点
                    elif "avg(" in col_j and "sum(" in col_i:
                        avg_content = col_j[4:-1]
                        sum_content = col_i[4:-1]
                        if avg_content == sum_content:
                            filtered_indices.append(i)  # 过滤掉sum节点
                            break  # 当前节点i已被过滤，不再比较
        
        # 第二部分：处理x_name和y_name相同的节点，但是map和graph不参与比较
        xy_groups = {}
        for i, node in enumerate(selected_view_nodes):
            if i in filtered_indices:
                continue
            if node.chart in ["map", "graph"]:
                continue
            # 使用(x_name, y_name)作为键
            key = (node.x_name, node.y_name)
            if key not in xy_groups:
                xy_groups[key] = []
            xy_groups[key].append((i, node))
        
        # 处理每组x_name和y_name都相同的节点，选择importance最高的
        for key, nodes in xy_groups.items():
            if len(nodes) > 1:
                # 找出最高score的节点
                best_score = -1
                best_idx = -1
                
                for i, node in nodes:
                    current_score = node.score if hasattr(node, 'score') else 0
                    if current_score > best_score:
                        best_score = current_score
                        best_idx = i
                
                # 过滤掉其他节点
                for i, _ in nodes:
                    if i != best_idx and i not in filtered_indices:
                        filtered_indices.append(i)
        
        # 筛选出最终保留的节点
        filtered_nodes = [node for i, node in enumerate(selected_view_nodes) if i not in filtered_indices]
        
        return filtered_nodes, filtered_indices
        
    def run(self):
        """主执行流程"""
        # 获取view nodes
        view_nodes, views_description = self.get_view_nodes()
        if not self.no_llm_filter:
            table = pd.read_csv(self.data_path).head(10).to_csv(index=False)
            question = self.prepare_question(table, views_description)
            print(f"Question:\n{question}")
            # 获取客户端并调用模型
            client = get_client()
            model_type = 'gemini-2.5-pro'
            retry = 0
            while retry < 3:
                try:
                    response = ask_question_without_image(client, question, model_type)
                    results = self.process_response(response)
                    break
                except Exception as e:
                    print(f"Error: {e}")
                    retry += 1
                    if retry == 3:
                        raise e
        
            for composite_vis in results:
                result = results[composite_vis]
                # 提取NODE_ID
                node_ids = [int(node["NODE_ID"]) for node in result.values()]
                selected_view_nodes = [view_nodes[node_id] for node_id in node_ids]
                
                # 提取importance
                importance = [int(node["IMPORTANCE"]) for node in result.values()]
                for i, node in enumerate(selected_view_nodes):
                    node.importance = importance[i]

                # 对于line chart，如果有bin by time的节点，替换为没有bin by time的节点
                for i in range(len(selected_view_nodes)):
                    _node = selected_view_nodes[i]
                    if _node.bin_by and _node.chart == "line":
                        replace = False
                        for node in view_nodes:
                            if node.x_name == _node.x_name and node.y_name == _node.y_name and node.group_by == _node.group_by + [node.x_name]:
                                node.importance = _node.importance
                                node.chart = "line"
                                selected_view_nodes[i] = node
                                replace = True
                                break
                                
                self.save_result(selected_view_nodes, result)
        else:
            selected_view_nodes = view_nodes
            for i, node in enumerate(selected_view_nodes):
                node.importance = node.score if hasattr(node, 'score') else 1.0
            n = 100
            if len(selected_view_nodes) > n:
                print(f"Randomly selecting {n} nodes from {len(selected_view_nodes)} based on importance.")
                map_graph_nodes = [node for node in selected_view_nodes if node.chart in ("map", "graph")]
                other_nodes = [node for node in selected_view_nodes if node.chart not in ("map", "graph")]
                num_to_sample = n - len(map_graph_nodes)
                if num_to_sample > 0:
                    sampled_nodes = np.random.choice(
                        other_nodes, size=num_to_sample, replace=False,
                        p=[node.importance / sum(node.importance for node in other_nodes) for node in other_nodes]
                    )
                    selected_view_nodes = list(map_graph_nodes) + list(sampled_nodes)
                else:
                    selected_view_nodes = list(map_graph_nodes)
            self.save_result(selected_view_nodes)
        return selected_view_nodes


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--filename", "-f", type=str, default="spotify.csv", help="The name of the dataset")
    parser.add_argument("--no-llm-filter", action="store_true", default=True, help="不使用大模型筛选，保留所有原始结果")
    parser.add_argument("--filters", type=str, help="筛选条件，支持两种格式：\n" +
                                                    "1. 单列筛选: 'column_name,value1,value2,...' 例如: 'Country,USA,Russia'\n" +
                                                    "2. 多列筛选: 'column1,value1,value2;column2,value3,value4' 例如: 'Country,USA,Russia;Medal,Gold,Silver'")
    return parser.parse_args()

if __name__ == "__main__":
    # 配置路径
    # 判断文件路径是否已包含目录部分
    args = parse_args()
    if os.path.dirname(args.filename):
        # 如果传入的是完整路径
        file_path = args.filename
    else:
        # 如果只传入文件名，则拼接默认目录
        file_path = os.path.join(os.path.dirname(__file__), 'HAIChart', 'datasets', args.filename)
    
    prompt_path = os.path.join(os.path.dirname(__file__), 'prompt.json')
    prompt_version = 'v1'
    
    # 解析筛选条件
    filters = None
    if args.filters:
        if ';' in args.filters:
            # 多列筛选格式：'column1,value1,value2;column2,value3,value4'
            filter_groups = args.filters.split(';')
            filters = []
            for group in filter_groups:
                parts = group.split(',')
                if len(parts) >= 2:
                    column_name = parts[0].strip()
                    filter_values = [part.strip() for part in parts[1:]]
                    filters.append([column_name, filter_values])
                    print(f"筛选条件: {column_name} in {filter_values}")
                else:
                    print(f"警告: 筛选条件格式不正确: {group}")
        else:
            # 单列筛选格式：'column_name,value1,value2,...'
            parts = args.filters.split(',')
            if len(parts) >= 2:
                column_name = parts[0].strip()
                filter_values = [part.strip() for part in parts[1:]]
                filters = [column_name, filter_values]
                print(f"筛选条件: {column_name} in {filter_values}")
            else:
                print("警告: 筛选条件格式不正确，应为 'column_name,value1,value2,...'")
    
    # 打印实际使用的文件路径，用于调试
    print(f"处理文件: {file_path}")
    
    # 执行处理
    processor = DataProcessor(file_path, prompt_path, prompt_version, args.no_llm_filter, filters)
    if args.no_llm_filter:
        print("模式：不使用大模型筛选，保留所有原始结果")
    else:
        print("模式：使用大模型筛选，过滤相似节点")
    processor.run()
