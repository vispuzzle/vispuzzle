import os
from typing import List
import json
import pickle
import matplotlib.pyplot as plt
import networkx as nx
import numpy as np
import pandas as pd
# from simanneal import Annealer

from .tools import deepeye
from .utils import ViewNode


class CompositeView:
    def __init__(self, view_nodes: List[ViewNode], **kargs):
        self.view_nodes = view_nodes
        self.chart_types = self.__get_chart_types()
        self.data_columns = self.__get_data_columns()
        self.relation_matrix = self.__get_relation_matrix()
        self.set_config(**kargs)

    def set_config(
        self,
        n_best=3,
        n_max=5,
        marktype_div_scalar=0.1,
        n_col_best_prop=0.9,
        div_weight=0.9,
        comp_weight=0.9,
        w1=3.0,
        w2=0.1,
        w3=10.0,
    ):
        r"""
        Configurations for composite view optimization.

        Args:
            n_best:
                Best number of views in composite visualization.
            n_max:
                Maximum number of views in composite visualization.
                If the number of views exceeds n_max, the score will be -INF.
            marktype_div_scalar:
                Parameter for mark type diversity score.
            n_col_best_prop:
                Parameter for data column diversity score.
                The best number of data columns is n_col_best_prop * len(data_columns).
            div_weight:
                Weight to control mark type diversity and data column diversity.
                A higher weight means more emphasis on diversity.
            comp_weight:
                Weight to control diversity and parsimony (`TODO`: add insight score).
                A higher weight means more emphasis on diversity score.
            w1:
                Weight for single chart score used in total score calculation.
            w2:
                Weight for relation score used in total score calculation.
            w3:
                Weight for composite score used in total score calculation.
        """
        self.n_best = n_best
        self.n_max = n_max
        self.marktype_div_scalar = marktype_div_scalar
        self.n_col_best_prop = n_col_best_prop if 0 < n_col_best_prop < 1 else 1.0
        self.div_weight = div_weight
        self.comp_weight = comp_weight
        self.w1 = w1
        self.w2 = w2
        self.w3 = w3

    def print_score(self, ids):
        print()
        print(f"-Total score: {self.get_total_score(ids)}")
        print(f"  --Single chart score: {self.get_single_chart_score(ids)}")
        print(f"  --Relation score: {self.get_relation_score(ids)}")
        print(f"  --Composite score: {self.get_composite_score(ids)}")
        print(f"    ---Diversity score: {self.__diversity_score(ids)}")
        print(f"    ---Parsimony score: {self.__parsimony_score(ids)}")

    def get_total_score(self, ids):
        score1 = self.get_single_chart_score(ids)
        score2 = self.get_relation_score(ids)
        score3 = self.get_composite_score(ids)
        # return self.w1 * score1 + self.w2 * score2 + self.w3 * score3
        return score1 * score2 * score3

    def get_single_chart_score(self, ids):
        return np.sum([self.view_nodes[id].score for id in ids])

    def get_relation_score(self, ids):
        score = 0
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                score += self.relation_matrix[ids[i]][ids[j]]
        return score / (len(ids) ** 2)

    def get_composite_score(self, ids):
        return self.comp_weight * self.__diversity_score(ids) + (
            1 - self.comp_weight
        ) * self.__parsimony_score(ids)

    def head(self, n=5):
        for i in range(min(n, len(self.view_nodes))):
            print(f"id: {i}")
            print(repr(self.view_nodes[i]))
            print()

    def plot_relation_graph(self, ids, save_path="model1.png"):
        r"""
        Plot the relation graph where nodes are views and edges are the relation score between views.

        Args:
            ids: the ids of selected views.
            save_path: the path to save the plot. Default is "model1.png".
        """
        G = nx.Graph()
        for i in ids:
            G.add_node(i)

        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                w = self.relation_matrix[ids[i]][ids[j]]
                if w > 0.001:
                    G.add_edge(ids[i], ids[j], weight=w)

        pos = nx.kamada_kawai_layout(G)
        pos = nx.circular_layout(G)
        plt.figure(figsize=(12, 12))
        plt.margins(0.2)
        nx.draw(
            G,
            pos,
            with_labels=False,
            node_size=5000,
            node_color="lightblue",
            edge_color="gray",
        )
        node_labels = {node: f"{self.view_nodes[node]}" for node in G.nodes()}
        nx.draw_networkx_labels(G, pos, labels=node_labels)

        edge_colors = nx.get_edge_attributes(G, "weight").values()
        edge_labels = nx.get_edge_attributes(G, "weight")
        nx.draw_networkx_edges(G, pos, edge_color=edge_colors)
        edge_labels = {k: f"{v:.2f}" for k, v in edge_labels.items()}
        nx.draw_networkx_edge_labels(G, pos, edge_labels=edge_labels)

        plt.savefig(save_path)

    def summary(self, ids):
        """
        Summarize some statistical information of the selected composite view.
        """

        # Step0: total score.
        self.print_score(ids)

        # Step1: number of views
        print(f"\nNumber of views: {len(ids)} / {len(self.view_nodes)}\n")

        # Step2: proportion of chart types used in the composite view.
        used_types = set()
        for id in ids:
            used_types.add(self.view_nodes[id].chart)
        print(f"Chart types used: {len(used_types)} / {len(self.chart_types)}.")

        unused_types = self.chart_types - used_types
        if len(unused_types) > 0:
            print(
                f"Used types: {used_types}. Unused types: {self.chart_types - used_types}\n"
            )
        else:
            print("\n")

        # Step3: proportion of data columns used in the composite view.
        used_columns = set()
        for id in ids:
            used_columns = used_columns.union(self.view_nodes[id].data_columns)
        print(f"Data columns used: {len(used_columns)} / {len(self.data_columns)}")

        unused_columns = self.data_columns - used_columns
        print(f"Unused columns: {unused_columns}\n")

    def __diversity_score(self, ids):
        """
        A combination between mark type diversity and data column diversity.
        """
        marktype_div_score = self.__marktype_diversity_score(ids)
        datacol_div_score = self.__data_col_diversity_score(ids)
        return (
            self.div_weight * marktype_div_score
            + (1 - self.div_weight) * datacol_div_score
        )

    def __marktype_diversity_score(self, ids):
        """
        More types of charts, higher score.
        """
        used_types = set()
        for id in ids:
            used_types.add(self.view_nodes[id].chart)
        return np.exp(len(used_types) - len(self.chart_types))

    def __data_col_diversity_score(self, ids):
        """
        Criteria for number of columns: not too many, not too few.
        TODO: this score design needs further consideration.
        """
        used_columns = set()
        for id in ids:
            used_columns = used_columns.union(self.view_nodes[id].data_columns)
        n = len(used_columns)
        n_max = len(self.data_columns)
        n_best = int(self.n_col_best_prop * n_max)
        if n_best <= 0 or n_best > n_max:
            n_best = n_max

        if n <= 0 or n > n_max:
            return -INF
        elif n <= n_best:
            return np.sin(np.pi / 2 * n / n_best)
        else:
            return np.sin(np.pi / 2 * (1 + (n - n_best) / (n_max - n_best)))

    def __parsimony_score(self, ids):
        """
        Criteria for the number of views: not too many, not too few.
        """
        n = len(ids)
        if n <= 0 or n > self.n_max:
            return -INF
        elif n <= self.n_best:  # 1 <= n <= n_best
            return np.sin(np.pi / 2 * n / self.n_best)
        else:  # n_best < n <= n_max
            return np.sin(
                np.pi / 2 * (1 + (n - self.n_best) / (self.n_max - self.n_best))
            )

    def __get_chart_types(self):
        chart_types = set()
        for view_node in self.view_nodes:
            chart_types.add(view_node.chart)
        return chart_types

    def __get_data_columns(self):
        data_columns = set()
        for view_node in self.view_nodes:
            data_columns = data_columns.union(view_node.data_columns)
        return data_columns

    def __get_relation_matrix(self):
        n = len(self.view_nodes)
        relation_matrix = np.zeros((n, n))
        for i in range(n):
            for j in range(i + 1, n):
                relation_matrix[i][j] = self.view_nodes[i].get_relation_score(
                    self.view_nodes[j]
                )
                relation_matrix[j][i] = relation_matrix[i][j]
        return relation_matrix


# class CompositeViewAnnealer(Annealer):
#     def __init__(self, state, composite_view: CompositeView):
#         self.composite_view = composite_view
#         super().__init__(state)

#     def move(self):
#         if np.random.rand() > 0.5 and len(self.state) < self.composite_view.n_max:
#             new_id = np.random.randint(0, len(self.composite_view.view_nodes))
#             if new_id not in self.state:
#                 self.state.append(new_id)
#         elif len(self.state) > 1:
#             self.state.pop(np.random.randint(0, len(self.state)))

#     def energy(self):
#         return -self.composite_view.get_total_score(self.state)


INF = 1e9

deepeye = deepeye()

def upload_dataset(file_path, filters=None):
    """
    上传数据集并进行可选的条件筛选
    
    Args:
        file_path: CSV文件路径
        filters: 筛选条件，支持两种格式：
                1. 单列筛选：[column_name, [value1, value2, ...]]
                   例如 ["Country", ["USA", "Russia"]]
                2. 多列筛选：[[column_name1, [value1, value2, ...]], [column_name2, [value3, value4, ...]]]
                   例如 [["Country", ["USA", "Russia"]], ["Medal", ["Gold", "Silver"]]]
    
    Returns:
        处理后的视图列表
    """
    import tempfile
    global deepeye
    # haichart = tools.haichart()

    # filename = "user_behavior_dataset.csv"
    # file_path = os.path.join(UPLOAD_FOLDER, filename)
    print(file_path)
    df = pd.read_csv(file_path)
    df = df.dropna()
    df.to_csv(file_path, index=False)
    # 创建临时文件路径
    temp_file = None
    temp_file_path = None
    
    try:
        # 应用条件筛选
        if filters is not None:
            # 检查是否为多列筛选格式
            if isinstance(filters, list) and len(filters) > 0:
                # 判断是单列还是多列筛选
                if isinstance(filters[0], str):
                    # 单列筛选格式：[column_name, [value1, value2, ...]]
                    if len(filters) == 2:
                        column_name, filter_values = filters
                        if column_name in df.columns:
                            df = df[df[column_name].isin(filter_values)]
                            print(f"应用筛选条件: {column_name} in {filter_values}")
                        else:
                            print(f"警告: 列 '{column_name}' 不存在于数据集中")
                    else:
                        print("警告: 单列筛选条件格式不正确，应为 [column_name, [value1, value2, ...]]")
                else:
                    # 多列筛选格式：[[column_name1, [value1, value2, ...]], [column_name2, [value3, value4, ...]]]
                    for filter_condition in filters:
                        if isinstance(filter_condition, list) and len(filter_condition) == 2:
                            column_name, filter_values = filter_condition
                            if column_name in df.columns:
                                df = df[df[column_name].isin(filter_values)]
                                print(f"应用筛选条件: {column_name} in {filter_values}")
                            else:
                                print(f"警告: 列 '{column_name}' 不存在于数据集中")
                        else:
                            print(f"警告: 筛选条件格式不正确: {filter_condition}")
                
                print(f"筛选后剩余 {len(df)} 行数据")
            else:
                print("警告: 筛选条件格式不正确")
        
        # 如果应用了筛选，创建临时文件
        if filters is not None:
            temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False)
            temp_file_path = temp_file.name
            temp_file.close()
            df.to_csv(temp_file_path, index=False)
            processing_file_path = temp_file_path
        else:
            # 如果没有筛选，直接使用原文件
            processing_file_path = file_path

        df = pd.read_csv(processing_file_path)

        deepeye.from_csv(processing_file_path)
        deepeye.partial_order()
        result = deepeye.output("list")
        
        return result
        
    finally:
        # 清理临时文件
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                print(f"临时文件已删除: {temp_file_path}")
            except OSError as e:
                print(f"删除临时文件失败: {e}")

def view_to_view_nodes(views):
    view_nodes = []
    view_node_to_view = {}
    for key, value in views.items():
        view_node = ViewNode()
        view_node.parse(key, value)
        view_nodes.append(view_node)
        view_node_to_view[view_node] = (key, value)
        # print(f"id: {len(view_nodes)}, {view_node}")
    return view_nodes
        
def add_map_view_node(geojson_path, dataset_base_name):
    geodata = json.load(open(geojson_path, "r", encoding="utf-8"))
    map_view_node = ViewNode()
    map_view_node.chart = "map"
    map_view_node.X = geodata
    # 从metadata中读取x_name，如果不存在则从GeoJSON的properties中读取name属性作为x_name, lower case
    if "metadata" in geodata and "x_name" in geodata["metadata"]:
        map_view_node.x_name = geodata["metadata"]["x_name"].lower()
    else:
        map_view_node.x_name = "name"  # 默认使用name作为x_name，对应properties中的name
    
    # 从metadata中读取y_name，如果不存在则不设置y_name
    if "metadata" in geodata and "y_name" in geodata["metadata"]:
        map_view_node.y_name = geodata["metadata"]["y_name"].lower()
        describe_y = f", y_name: {map_view_node.y_name}"
        map_view_node.y_type = "numerical"
    else:
        # 不设置y_name
        map_view_node.y_name = None
        describe_y = ""
    map_view_node.x_type = 1
    map_view_node.describe = f"Map visualization of {dataset_base_name}"
    map_view_node.data_columns = set()
    map_view_node.data_columns.add(map_view_node.x_name)
    if map_view_node.y_name is not None:
        map_view_node.data_columns.add(map_view_node.y_name)
    map_view_node.score = 1.0
    print(f"找到对应的GeoJSON文件，添加地图视图: {map_view_node.describe}")
    describe = f'chart: map, x_name: {map_view_node.x_name}{describe_y}, describe: {map_view_node.describe}'
    return describe, map_view_node

def add_graph_view_node(graph_path, dataset_base_name):
    """
    为图数据创建视图节点
    
    参数:
        graph_path: 图数据JSON文件的路径
        dataset_base_name: 数据集的基础名称
        
    返回:
        describe: 视图的描述信息
        graph_view_node: 创建的ViewNode对象
    """
    # 加载图数据
    graph_data = json.load(open(graph_path, "r", encoding="utf-8"))
    
    # 创建视图节点
    graph_view_node = ViewNode()
    graph_view_node.chart = "graph"  # 设置图表类型为graph
    graph_view_node.X = graph_data   # 存储整个图数据
    graph_view_node.x_type = 1
    # 从metadata中读取x_name，通常是节点的标识字段
    if "metadata" in graph_data and "x_name" in graph_data["metadata"]:
        graph_view_node.x_name = graph_data["metadata"]["x_name"].lower()
    else:
        graph_view_node.x_name = "name"  # 默认使用name
    
    # 从metadata中读取y_name，可能代表要在节点上显示的主要属性
    if "metadata" in graph_data and "y_name" in graph_data["metadata"]:
        graph_view_node.y_name = graph_data["metadata"]["y_name"].lower()
        describe_y = f", y_name: {graph_view_node.y_name}"
        graph_view_node.y_type = "numerical"
    else:
        graph_view_node.y_name = None
        describe_y = ""
    
    # 设置视图描述
    graph_view_node.describe = f'describe: relationships of {dataset_base_name}'
    
    # 收集数据列（从图数据中收集所有可能的属性列）
    graph_view_node.data_columns = set()
    graph_view_node.data_columns.add(graph_view_node.x_name)
    if graph_view_node.y_name is not None:
        graph_view_node.data_columns.add(graph_view_node.y_name)
    extra_data = {"weight": [], "relationship": []}
    # 从edges中收集关系类型
    if "edges" in graph_data:
        for edge in graph_data["edges"]:
            if "relationship" in edge:
                extra_data["relationship"].append(edge["relationship"])
            if "weight" in edge:
                extra_data["weight"].append(edge["weight"])
    graph_view_node.extra_data = extra_data
    # 设置视图得分
    graph_view_node.score = 1.0
    
    # 输出日志信息
    print(f"找到对应的图数据文件，添加图视图: {graph_view_node.describe}")
    
    # 生成描述信息
    describe = f'chart: graph, x_name: {graph_view_node.x_name}{describe_y}, describe: {graph_view_node.describe}'
    
    return describe, graph_view_node
        
if __name__ == "__main__":
    filename = "fakeData.csv"
    views = upload_dataset(filename)
    deepeye.to_single_html()
    dict_sorted = views.items()
    view_node_to_view = {}
    view_nodes = []
    for key, value in views.items():
        view_node = ViewNode()
        view_node.parse(key, value)
        view_nodes.append(view_node)
        view_node_to_view[view_node] = (key, value)
        # print(f"id: {len(view_nodes)}, {view_node}")
    with open("view_nodes.pkl", "wb") as f:
        pickle.dump(view_nodes, f)
    # composite_view = CompositeView(view_nodes)
    # # composite_view.head(30)

    # initial_state = list(
    #     np.random.choice(len(view_nodes), composite_view.n_best, replace=False)
    # )
    # annealer = CompositeViewAnnealer(initial_state, composite_view)
    # annealer.steps = 100000
    # best_state, best_energy = annealer.anneal()

    # print(f"\nSelected ids: {best_state}, score: {-best_energy}")

    # for id in best_state:
    #     print()
    #     print(f"id: {id}")
    #     print(repr(view_nodes[id]))

    # composite_view.summary(best_state)
    # composite_view.plot_relation_graph(best_state)

    # best_views = []
    # for id in best_state:
    #     print(view_nodes[id])
    #     best_views.append(view_nodes[id])
    # dict_sorted = {view_node_to_view[view_node][0]: view_node_to_view[view_node][1] for view_node in best_views}
    # # deepeye.output('single_html', dict_sorted)
    
    # with open("best_views.pkl", "wb") as f:
    #     pickle.dump(best_views, f)