import copy
import pickle
import numpy as np
from typing import List, Optional, Set

from search.utils import (Condition, DataColumn, DataOperation, ViewNode,
                   axes_convert_map, plot_compostition_graph)
from search.fact_scoring import compute_fact_scores
from search.extract_embedding import get_embedding, cosine_similarity_batch
from search.logger_config import logger

view_node_set = set()

def create_reversed_view_node(uncondition_node):
    """
    Create a reversed view node by exchanging x and operation columns.
    
    Args:
        uncondition_node: DataNode with operation to reverse
        
    Returns:
        tuple: (reversed_view_node, reversed_data_nodes, reversed_uncondition_node)
    """
    reversed_view_node = copy.deepcopy(uncondition_node.view_node)
    reversed_view_node.X = [uncondition_node.view_node.groups]
    reversed_view_node.Y = np.array(uncondition_node.view_node.Y).T.tolist()
    reversed_view_node.group_by = [uncondition_node.view_node.x_name]
    reversed_view_node.groups = uncondition_node.view_node.X[0]
    reversed_view_node.x_name = uncondition_node.view_node.group_by[0]
    reversed_view_node.describe = 'group by ' + uncondition_node.view_node.x_name
    
    reversed_data_nodes = load_data_nodes_from_views([reversed_view_node])
    reversed_uncondition_node = create_all_union_nodes(reversed_data_nodes)[0]
    
    return reversed_view_node, reversed_data_nodes, reversed_uncondition_node

class DataNode:
    """
    Node for **data** composition graph.
    """

    def __init__(
        self,
        columns: Set[DataColumn],
        conditions: Optional[Set[Condition]] = None,
        operation: Optional[DataOperation] = None,
        view_node: Optional[ViewNode] = None,
        importance: Optional[int] = None
    ):
        self.columns = columns
        self.operation = operation
        self.conditions = conditions if conditions is not None else set()

        self.children: List[DataNode] = []
        self.parents: List[DataNode] = []

        self.node_type = "data"
        # variables for visualization
        self.view_node = view_node
        self.axes_num = None
        self.chart_type = None
        if view_node is not None:
            if view_node.chart in axes_convert_map:
                self.axes_num = axes_convert_map[view_node.chart]
            self.chart_type = [view_node.chart]
            
        # importance of the node, used in layout
        self.importance = importance
        
        # composition patterns available for this node type
        self.composition_patterns = self._get_composition_patterns()
        self.spatial_arrangements  = None

    def __str__(self):
        if self.node_type == "data":
            return f"{self.view_node.chart}: [{', '.join(str(col) for col in self.columns)}, {', '.join(str(cond) for cond in self.conditions)}]"
        elif self.node_type == "all_union":
            return f"{self.operation.type}({self.operation.column}), {self.view_node.chart}: [{', '.join(str(col) for col in self.columns if str(col) != self.operation.column)}]"
        elif self.node_type == "column_join":
            return f"{self.operation.type}({self.operation.column})"
        elif self.node_type == "condition_join":
            return f"{self.operation.type}({self.operation.column})"
        elif self.node_type == "two_union":
            chart_info = f", {self.view_node.chart}" if self.view_node else ""
            return f"{self.operation.type}({self.operation.column}){chart_info}: [{', '.join(str(col) for col in self.columns if str(col) != self.operation.column)}]"
        
    def is_leaf(self):
        return len(self.children) == 0

    def _get_composition_patterns(self) -> List[str]:
        """
        Get available composition patterns based on data node type.
        Based on main.py comments:
        - All union nodes: repetition or mirror
        - Two union nodes: mirror  
        - Column join nodes: stack, coaxis (2 children)
        - Condition join nodes: linkage, coordinate, annotation
        """
        available_composite_patterns = []
        if self.node_type == "data":
            # Data nodes can use all patterns
            return available_composite_patterns
        elif self.node_type == "all_union":
            # All union nodes: repetition
            available_composite_patterns = ["repetition"]
            if len(self.children) == 2:
                # If union has exactly 2 children, can also use "mirror"
                available_composite_patterns.append("mirror")
        elif self.node_type == "two_union":
            # Two union nodes: mirror
            available_composite_patterns = ["mirror"]
        elif self.node_type == "column_join":
            # Column join nodes: stack, coaxis (2 children)
            available_composite_patterns = ["stack"]
        elif self.node_type == "condition_join":
            available_composite_patterns = ["linkage", "annotation"]

        return available_composite_patterns

def load_data_nodes_from_views(views: List[ViewNode], tasks_info=None, filter=False) -> List[DataNode]:
    from search.vis_composition import CompositeState
    available_views = []
    if tasks_info:
        def _get_requested_fact_types(view_node, sub_tasks):
            view_columns_text = str(getattr(view_node, 'data_columns', '')).lower()
            requested_fact_types = set()
            for sub_task in sub_tasks:
                fact = sub_task[0]
                columns = sub_task[1]
                normalized_columns = [
                    column.lower() for column in columns
                    if isinstance(column, str) and column != ""
                ]
                if not normalized_columns:
                    continue
                if any(column in view_columns_text for column in normalized_columns):
                    requested_fact_types.add(fact)
            return list(requested_fact_types)

        order_columns = set()
        sub_tasks = tasks_info['sub_tasks']
        sub_task_embeddings = tasks_info['sub_task_embeddings']
        task_view_scores = []
        # Dictionary to store fact scores for different facts
        fact_scores = {}
        for i, view_node in enumerate(views):
            if view_node.chart in ["map", "graph"]:
                available_views.append(view_node)
                task_view_scores.append(np.zeros(len(sub_tasks)))
                continue
            if not hasattr(view_node, 'fact_results'):
                requested_fact_types = _get_requested_fact_types(view_node, sub_tasks)
                if len(requested_fact_types) == 0:
                    fact_results = {'datafacts': []}
                else:
                    fact_results = compute_fact_scores(view_node, fact_types=requested_fact_types)
                view_node.fact_results = fact_results
            else:
                fact_results = view_node.fact_results
            annotations = [f['annotation'] for f in fact_results['datafacts']]
            fact_scores = [f['score'] for f in fact_results['datafacts']]
            # hard constraint
            task_fact_mask = np.zeros((len(sub_tasks), len(fact_results['datafacts'])))
            for j, sub_task in enumerate(sub_tasks):
                fact = sub_task[0]
                columns = sub_task[1]
                values = sub_task[2]
                if not np.all([column == "" or column.lower() in str(view_node.data_columns) for column in columns]):
                    continue
                
                if len(columns) == 3:
                    if "cnt(" in str(columns):
                        if len(view_node.group_by) == 0: #or columns[1].lower() != view_node.group_by[0].lower():
                            continue
                    else:
                        if len(view_node.group_by) == 0 or columns[2].lower() != view_node.group_by[0].lower():
                            continue
                
                if fact == "rank":
                    for column in columns:
                        if column.lower() in ['time', 'year']:
                            continue
                        if (column.lower() == view_node.x_name and view_node.x_type == 1) or (column.lower() == view_node.y_name and view_node.y_type == 1) or (len(view_node.group_by) > 0 and column.lower() == view_node.group_by[0]):
                            order_columns.add(column.lower())
                for column in columns:
                    if column.lower() in order_columns and ((column.lower() == view_node.x_name and view_node.x_type != 1) or (column.lower() == view_node.y_name and view_node.y_type != 1)):
                        order_columns.remove(column.lower())
                        
                for k, datafact in enumerate(fact_results['datafacts']):
                    df_type = datafact['type']
                    if df_type == fact: # or (fact in ['proportion', 'categorization'] and df_type in ['proportion', 'categorization']): this is for multiple pie charts, but need to refine
                        if np.all([value == "" or value.lower() in str(datafact['data_points']) for value in values]):
                            task_fact_mask[j, k] = 1
            if (task_fact_mask != 0).any():
                if not hasattr(view_node, 'annotation_embeddings'):
                    annotation_embeddings = get_embedding(annotations, model="text-embedding-3-small", use_cache=True)
                    view_node.annotation_embeddings = annotation_embeddings
                task_fact_similarity = cosine_similarity_batch(sub_task_embeddings, view_node.annotation_embeddings)
                task_fact_similarity = task_fact_similarity * fact_scores
            else:
                task_fact_similarity = np.zeros((len(sub_tasks), len(fact_results['datafacts'])))
            task_fact_score = task_fact_similarity * task_fact_mask
            if task_fact_score.size == 0:
                task_view_scores.append(np.zeros(len(sub_tasks)))
                continue
            task_score = task_fact_score.max(axis=1)
            task_view_scores.append(task_score)
        
        # Select top-n views with highest scores for each sub-task
        top_n = 10
        chart_count = {}
        task_view_scores = np.array(task_view_scores).T
        CompositeState.task_max_scores = { sub_task: score.max() for sub_task, score in zip(sub_tasks, task_view_scores) }
        # Normalize task scores
        for i, sub_task in enumerate(sub_tasks):
            max_score = CompositeState.task_max_scores[sub_task]
            if max_score > 0:
                task_view_scores[i] = task_view_scores[i] / max_score
        CompositeState.tasks_info['order_columns'] = list(order_columns)
        for i, sub_task in enumerate(sub_tasks):
            if task_view_scores[i].max() == 0:
                continue
            count = 0
            task_views = task_view_scores[i].argsort()[::-1]
            task_views = [idx for idx in task_views if task_view_scores[i][idx] > 0]
            grouped_by_score = {}
            for idx in task_views:
                score = task_view_scores[i][idx]
                for existing_score in grouped_by_score.keys():
                    if abs(existing_score - score) < 1e-3:
                        score = existing_score
                        break
                if score not in grouped_by_score:
                    grouped_by_score[score] = []
                grouped_by_score[score].append(views[idx])
            for score in sorted(grouped_by_score.keys(), reverse=True):
                _views = grouped_by_score[score]
                _views.sort(key=lambda v: chart_count.get(v.chart, 0))
                for view_node in _views:
                    if not hasattr(view_node, 'task_relevance'):
                        view_node.task_relevance = {}
                    view_node.task_relevance[sub_task] = score
                    if view_node in available_views:
                        continue
                    available_views.append(view_node)
                    chart_count[view_node.chart] = chart_count.get(view_node.chart, 0) + 1
                    count += 1
                    if count >= top_n:
                        break
        
        for i, view_node in enumerate(available_views):
            if view_node.chart in ["map", "graph"]:
                # add task_relevance for map and graph nodes
                chart_to_fact_types = {
                    "map": ["distribution", "difference", "value"],
                    "graph": ["value", "difference", "correlation"]
                }
                view_node.task_relevance = { }
                for sub_task in sub_tasks:
                    fact = sub_task[0]
                    columns = sub_task[1]
                    if fact in chart_to_fact_types[view_node.chart] and (all(view_node.x_name in column for column in columns) or len(columns) == 0):
                        if CompositeState.task_max_scores[sub_task] > 0.0:
                            view_node.task_relevance[sub_task] = CompositeState.task_max_scores[sub_task] * 0.5
                        view_node.task_relevance[sub_task] = max(view_node.task_relevance.get(sub_task, 0), 0.1)
                        CompositeState.task_max_scores[sub_task] = max(CompositeState.task_max_scores[sub_task], view_node.task_relevance[sub_task])
        def _get_normalized_relevance_sum(v):
            if hasattr(v, 'task_relevance'):
                return sum(score / CompositeState.task_max_scores.get(task, 1.0) 
                            for task, score in v.task_relevance.items())
            else:
                return 0
        available_views.sort(key=lambda v: _get_normalized_relevance_sum(v), reverse=True)
                             
    else:
        available_views = views.copy()
    
    if filter:
        def _add_view_column_name(view_node, view_column_names):
            if view_node.chart in ["map", "graph"]:
                return True
            view_column_name = [(view_node.x_name, view_node.y_name)]
            if view_node.chart == "pie":
                view_column_name = [(view_node.x_name, )]
            if view_node.group_by and view_node.chart not in ["scatter"]:
                view_column_name.append((view_node.x_name, view_node.group_by[0]))
                view_column_name.append((view_node.group_by[0], view_node.x_name))
            if all(col not in view_column_names for col in view_column_name):
                view_column_names.update(view_column_name)
                return True
            return False
        def _check_tasks(current_views, view_nodes, current_task_to_views_map, view_column_names, task_satisfied):
            for i, (task, sub_tasks) in enumerate(current_task_to_views_map.items()):
                if not task_satisfied[task] and len(sub_tasks) == 1:
                    view_node = list(sub_tasks)[0]
                    current_views.remove(view_node)
                    view_nodes.append(view_node)
                    _add_view_column_name(view_node, view_column_names)
                    for task in view_node.task_relevance.keys():
                        task_satisfied[task] = True
                    # else:
                    #     return False
                if not task_satisfied[task] and len(sub_tasks) == 0:
                    return False
            return True
        max_selected_nodes = 10
        current_views = available_views.copy()
        current_task_to_views_map = {}
        for view_node in current_views:
            for task in view_node.task_relevance.keys():
                if task not in current_task_to_views_map:
                    current_task_to_views_map[task] = set()
                current_task_to_views_map[task].add(view_node)
        task_satisfied = {k: False for k in current_task_to_views_map.keys()}
        view_nodes = []
        view_column_names = set()
        while True:
            check_tasks_result = _check_tasks(current_views, view_nodes, current_task_to_views_map, view_column_names, task_satisfied)
            if not check_tasks_result:
                if tasks_info:
                    return [], []
                else:
                    return []
            has_view = False
            for view_node in current_views[:]:
                current_views.remove(view_node)
                if _add_view_column_name(view_node, view_column_names):
                    view_nodes.append(view_node)
                    for task in view_node.task_relevance.keys():
                        task_satisfied[task] = True
                    has_view = True
                    break
                else:
                    for task in view_node.task_relevance.keys():
                        if view_node in current_task_to_views_map[task]:
                            current_task_to_views_map[task].remove(view_node)
            if not has_view or len(view_nodes) >= max_selected_nodes:
                break
        
    else:
        view_nodes = available_views
    if frozenset(view_nodes) in view_node_set:
        views.reverse()
        return []
    view_node_set.add(frozenset(view_nodes))
    data_nodes = []
    for view_node in view_nodes:
        importance = view_node.importance if hasattr(view_node, 'importance') else view_node.score
        columns = set()
        if view_node.x_name:
            column_x = DataColumn(view_node.x_name)
            columns.add(column_x)
        if view_node.y_name:
            column_y = DataColumn(view_node.y_name)
            columns.add(column_y)
        if view_node.chart == "pie":
            columns = set([column_x])
        groupby_condition = set(view_node.group_by) - {
            view_node.x_name,
            view_node.y_name,
        }
        if view_node.chart == "link":
            columns = set([column_x, DataColumn(list(groupby_condition)[0])])
        if len(groupby_condition) == 0 or view_node.chart == "link":
            data_nodes.append(DataNode(columns, view_node=view_node, importance=importance))
        elif len(groupby_condition) == 1:
            group_name = view_node.groups
            group_num = len(group_name)
            for i in range(group_num):
                group_condition = Condition(
                    list(groupby_condition)[0], ("eq", group_name[i])
                )
                data_nodes.append(
                    DataNode(columns, set([group_condition]), view_node=view_node, importance=importance)
                )
        else:
            raise ValueError("More than one groupby condition.")
    if tasks_info:
        return data_nodes, available_views
    return data_nodes

def load_data_nodes_from_views_file(filepath: str, task_info, filter=False) -> List[DataNode]:
    # load pickle file
    with open(filepath, "rb") as f:
        view_nodes_ = pickle.load(f)
    view_nodes_ = view_nodes_[:100]
    return load_data_nodes_from_views(view_nodes_, task_info, filter=filter)

def filter_data_nodes(nodes: List[DataNode]) -> List[DataNode]:
    filtered_indices = []
    # Part 1
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            diff_i = nodes[i].columns - nodes[j].columns
            diff_j = nodes[j].columns - nodes[i].columns
            if len(diff_i) == 1 and len(diff_j) == 1:
                col_i = list(diff_i)[0]
                col_j = list(diff_j)[0]
                if "avg(" in col_i.column and "sum(" in col_j.column:
                    avg_content = col_i.column[4:-1]  # 去掉"avg("和")"
                    sum_content = col_j.column[4:-1]  # 去掉"sum("和")"
                    if avg_content == sum_content:
                        filtered_indices.append(j)  # 过滤掉sum节点
                elif "avg(" in col_j.column and "sum(" in col_i.column:
                    avg_content = col_j.column[4:-1]
                    sum_content = col_i.column[4:-1]
                    if avg_content == sum_content:
                        filtered_indices.append(i)  # 过滤掉sum节点
                        break  # 当前节点i已被过滤，不再比较
    
    # # Part 2
    # xy_groups = {}
    # for i, node in enumerate(nodes):
    #     if i in filtered_indices:
    #         continue
    #     if node.view_node.chart in ["map", "graph"]:
    #         continue
    #     # 使用(x_name, y_name)作为键
    #     key = (node.view_node.x_name, node.view_node.y_name, node.view_node.X[0][0])
    #     if key not in xy_groups:
    #         xy_groups[key] = []
    #     xy_groups[key].append((i, node))
    # for key, _nodes in xy_groups.items():
    #     best_idx = _nodes[np.argmax([n.view_node.score for _, n in _nodes])][0]
    #     for i, _ in _nodes:
    #         if i != best_idx and i not in filtered_indices:
    #             filtered_indices.append(i)
    
    nodes1 = [node for i, node in enumerate(nodes) if i not in filtered_indices]
    nodes2 = [nodes[i] for i in filtered_indices]
    return nodes1, nodes2

def all_union(nodes: List[DataNode], column: str) -> DataNode:
    """
    Merge nodes using ALL_UNION operation.

    Returns a new node with the merge operation.
    """
    logger.info(f"Union {len(nodes)} nodes on column {column}.")
    if len(nodes) == 0:
        raise ValueError("Nodes must not be empty.")

    # Check if the children nodes have the same columns.
    columns = set(nodes[0].columns)
    for node in nodes:
        if node.columns != columns:
            raise ValueError("Columns in nodes must be the same.")

    # Check if the children nodes have same conditions w.r.t. the column.
    # For other conditions, they have to be the same.
    # E.g. if we have nodes with conditions:
    # - node1: [column1 == 'Green', column2 == 'USA']
    # - node2: [column1 == 'Blue',  column2 == 'USA']
    # and union them on column1, the resulting node will have conditions:
    # - parent: [column2 == 'USA']. parent.columns = node1.columns.append(column1)
    other_conds = set()
    for cond in nodes[0].conditions:
        if cond.column != column:
            other_conds.add(cond)

    for node in nodes:
        conds = node.conditions
        for cond in conds:
            if cond.column != column and cond not in other_conds:
                raise ValueError("Ununioned conditions in nodes must be the same.")

    columns.add(DataColumn(column))
    parent = DataNode(columns, view_node=nodes[0].view_node)
    parent.conditions = other_conds
    parent.children = nodes
    for child in parent.children:
        child.parents.append(parent)
    parent.operation = DataOperation("ALL_UNION", column)
    parent.node_type = "all_union"
    parent.composition_patterns = parent._get_composition_patterns()  # Update after node_type change
    parent.chart_type = nodes[0].chart_type
    parent.importance = nodes[0].importance
    return parent

def column_join(nodes: List[DataNode], column: str, composition_patterns: Optional[List[str]]=None) -> DataNode:
    """
    Join nodes using COLUMN_JOIN operation.
    Example:
    >>> join([node1, node2], DataColumn('year'))
    >>> # DataNode(columns={DataColumn('year')} operation=DataOperation('COLUMN_JOIN', 'year')) with children having columns {DataColumn('year')}
    """
    logger.info(f"Column join {len(nodes)} nodes on column {column}.")
    if len(nodes) == 0:
        raise ValueError("Nodes must not be empty.")

    parent_cols = set([DataColumn(column)])
    parent_children = []
    for node in nodes:
        if DataColumn(column) in node.columns:
            parent_children.append(node)

    parent = DataNode(parent_cols)
    parent.children = parent_children
    for child in parent.children:
        child.parents.append(parent)
    parent.operation = DataOperation("COLUMN_JOIN", column)
    parent.node_type = "column_join"
    if composition_patterns is not None:
        parent.composition_patterns = composition_patterns
    else:
        parent.composition_patterns = parent._get_composition_patterns()  # Update after node_type change
    parent.chart_type = [child.chart_type[0] for child in parent.children]
    parent.importance = max([child.importance for child in parent.children])
    return parent

def condition_join(nodes: List[DataNode], column: str, composition_patterns: Optional[List[str]]=None) -> DataNode:
    logger.info(f"Condition join {len(nodes)} nodes on column {column}.")
    if len(nodes) == 0:
        raise ValueError("Nodes must not be empty.")

    parent_cols = set()
    parent = DataNode(parent_cols)
    parent.children = nodes
    for child in parent.children:
        child.parents.append(parent)
    parent.operation = DataOperation("CONDITION_JOIN", column)
    parent.node_type = "condition_join"
    if composition_patterns is not None:
        parent.composition_patterns = composition_patterns
    else:
        parent.composition_patterns = parent._get_composition_patterns()
    parent.chart_type = [child.chart_type[0] for child in parent.children]
    parent.importance = max([child.importance for child in parent.children])
    return parent

def two_union(nodes: List[DataNode], column: str) -> DataNode:
    """
    Create a two_union node using TWO_UNION operation.
    
    Args:
        nodes: List of nodes to create two_union from
        column: The column on which two_union operation is performed
    
    Returns:
        A new DataNode representing the two_union operation
    """
    logger.info(f"Creating two_union of {len(nodes)} nodes on column {column}.")

    if len(nodes) != 2:
        raise ValueError("Nodes length should be 2.")
    parent_cols = set([])
    # Create parent node with same columns as children
    # for cond in nodes[1].conditions:
        # if cond.cond[0] == "ne":
        # parent_cols = set([])
        # else:
            # parent_cols = set([DataColumn(column)])
    parent = DataNode(parent_cols, view_node=nodes[0].view_node)
    parent.children = nodes
    for child in parent.children:
        child.parents.append(parent)
    parent.operation = DataOperation("TWO_UNION", column)
    parent.node_type = "two_union"
    parent.composition_patterns = parent._get_composition_patterns()  # Update after node_type change
    parent.chart_type = nodes[0].chart_type
    parent.importance = nodes[0].importance
    return parent

def create_two_union_nodes(union_nodes: List[DataNode]) -> List[DataNode]:
    """
    Create two_union nodes based on union nodes.

    For union nodes with multiple children, create two_union nodes by taking each child
    and creating a two_union node that represents "all other values except this child's value".
    """
    two_union_nodes = []
    other_nodes = []
    for union_node in union_nodes:
        if union_node.node_type != "all_union":
            continue
        if union_node.view_node.agg is None:
            continue
        if union_node.chart_type[0] in ["line"]:
            continue
        children = union_node.children
        
        if len(children) >= 3:
            child_size = [np.sum(child.view_node.Y[i]) for i, child in enumerate(children)]
            # Case 1: (max, second_max), (min, second_min), (max, min)
            sorted_indices = np.argsort(child_size)
            
            # Get indices for max, second_max, min, second_min
            max_idx = sorted_indices[-1]
            second_max_idx = sorted_indices[-2]
            min_idx = sorted_indices[0]
            second_min_idx = sorted_indices[1]
            
            # Create three two_union pairs
            pairs = [
                (max_idx, second_max_idx),      # (max, second_max)
                (min_idx, second_min_idx),      # (min, second_min)
                (max_idx, min_idx)              # (max, min)
            ]
            
            for idx1, idx2 in pairs:
                child1 = children[idx1]
                child2 = children[idx2]
                
                # Create two_union node for this pair
                two_union_node = two_union([child1, child2], union_node.operation.column)
                two_union_nodes.append(two_union_node)
            
            # Case 2: for each child, create a "ne" condition node representing all others
            for target_child in [children[max_idx], children[min_idx]]:
                # Find the condition value for the target child
                target_condition_value = None
                for cond in target_child.conditions:
                    if cond.column == union_node.operation.column:
                        target_condition_value = cond.cond[1]  # Get the value from the condition
                        break
                
                if target_condition_value is not None:
                    # Create a new DataNode with "ne" condition representing all other children
                    ne_condition = Condition(union_node.operation.column, ("ne", target_condition_value))
                    
                    # Copy base conditions (excluding the union column conditions)
                    other_conditions = set()
                    for cond in union_node.conditions:
                        if cond.column != union_node.operation.column:
                            other_conditions.add(cond)
                    other_conditions.add(ne_condition)
                    
                    # Create the "ne" node with same columns as target child but "ne" condition
                    other_node = DataNode(
                        target_child.columns.copy(), 
                        other_conditions, 
                        view_node=target_child.view_node
                    )
                    other_node.chart_type = target_child.chart_type
                    other_node.importance = target_child.importance
                    other_nodes.append(other_node)
                    # Create two_union node: base_node - ne_node
                    two_union_node = two_union([target_child, other_node], union_node.operation.column)
                    two_union_nodes.append(two_union_node)

    return two_union_nodes, other_nodes

def create_reversed_all_union_nodes(all_union_nodes: List[DataNode]) -> List[DataNode]:
    reversed_all_union_nodes = []
    auxiliary_nodes = []
    for all_union_node in all_union_nodes:
        if all_union_node.node_type != "all_union":
            continue
        if all_union_node.view_node.chart == "bar" and len(all_union_node.view_node.X[0]) > len(all_union_node.view_node.groups):
            reversed_view_node, reversed_data_nodes, reversed_uncondition_node = create_reversed_view_node(all_union_node)
            reversed_uncondition_node.spatial_arrangements = ["regular_tessellation", "irregular_tessellation"]
            reversed_all_union_nodes.append(reversed_uncondition_node)
            auxiliary_nodes += reversed_data_nodes
    return reversed_all_union_nodes, auxiliary_nodes

def create_all_union_nodes(data_nodes: List[DataNode]) -> List[DataNode]:
    """
    Create possible all union nodes.
    """
    all_union_nodes = []
    columns_to_nodes = {}
    for node in data_nodes:
        if len(node.conditions) == 0:
            all_union_nodes.append(node)
            continue
        node_columns_id = ",".join([str(col) for col in node.columns]) + f',{node.view_node.X[0][0]}'
        if columns_to_nodes.get(node_columns_id) is None:
            columns_to_nodes[node_columns_id] = {}
        node_conditions_id = ",".join(
            set([str(cond.column) for cond in node.conditions])
        )
        if columns_to_nodes[node_columns_id].get(node_conditions_id) is None:
            columns_to_nodes[node_columns_id][node_conditions_id] = []
        columns_to_nodes[node_columns_id][node_conditions_id].append(node)
    # Create all union nodes for each column.
    for columns_id, conditions_to_nodes in columns_to_nodes.items():
        for conditions_id, nodes in conditions_to_nodes.items():
            if len(nodes) == 1:
                logger.warning(f"Node {nodes[0]} has only one condition.")
            all_union_node = all_union(nodes, conditions_id)
            all_union_nodes.append(all_union_node)

    return all_union_nodes

def create_join_nodes(data_nodes: List[DataNode], others: List[DataNode]) -> List[DataNode]:
    """
    Create possible join nodes. Here data_nodes are unconditional, i.e. all_union_nodes from create_all_union_nodes.
    """
    join_nodes = []
    coaxis_auxiliary_nodes = []
    # Case 1: Column join
    columns_to_nodes = {}
    for node in data_nodes:
        for column in node.columns:
            columns_id = str(column)
            if columns_to_nodes.get(columns_id) is None:
                columns_to_nodes[columns_id] = []
            columns_to_nodes[columns_id].append(node)
    for column_id, nodes in columns_to_nodes.items():
        if len(nodes) == 1:
            # print(f"INFO: Column {column_id} has only one node. Skip.") # Reduced verbosity
            continue
            
        # --- Check for mixed data types --- START ---
        has_string = False
        has_number = False
        is_invalid_column = False

        for node in nodes:
            data_values = []
            # Access data from the node's view_node
            if node.view_node:
                col_name = str(column_id) # Ensure column_id is treated as string name
                # Check if the column name matches x_name or y_name (case-insensitive)
                if col_name.lower() == node.view_node.x_name.lower():
                    data_values = node.view_node.X
                elif col_name.lower() == node.view_node.y_name.lower():
                    data_values = node.view_node.Y
                # Add more checks here if join can happen on other types of columns

                # Flatten data_values if it's a list of lists (common with grouped data)
                flat_values = []
                if isinstance(data_values, list):
                    for item in data_values:
                        if isinstance(item, list):
                            # Extend if item is a list (multiple values for a group)
                            flat_values.extend(item)
                        else:
                            # Append directly if item is a single value
                            flat_values.append(item)
                # else: Handle cases where data_values might not be a list, if necessary

                # Check types within the flattened list for this node
                for value in flat_values:
                    if isinstance(value, str):
                        has_string = True
                    elif isinstance(value, (int, float)):
                        # Consider NaN as numeric, but maybe skip type check?
                        # For now, treat standard int/float as numeric
                        has_number = True
                    
                    # Early exit if both types are found for this column_id
                    if has_string and has_number:
                        is_invalid_column = True
                        break # Break from checking values within this node
            
            if is_invalid_column:
                break # Break from checking other nodes for this column_id
        # --- Check for mixed data types --- END ---

        # Skip creating join node if the column has mixed types
        if is_invalid_column:
            logger.info(f"Column \"{column_id}\" has mixed string and numeric types across nodes. Skipping joinion.")
            continue
        
        # Sort nodes to ensure link charts go to the end
        sorted_nodes = sorted(nodes, key=lambda n: 1 if n.view_node and n.view_node.chart == "link" else 0)
            
        # If the loop completes without finding mixed types, proceed
        join_node = column_join(nodes, column_id)
        join_nodes.append(join_node)

        # Check each pair of nodes
        not_coincide_chart_types = ["map", "link", "pie", "graph"]
        for i in range(len(sorted_nodes)):
            node1 = sorted_nodes[i]
            for j in range(i + 1, len(sorted_nodes)):
                node2 = sorted_nodes[j]
                if not (node1.chart_type[0] in not_coincide_chart_types or node2.chart_type[0] in not_coincide_chart_types):
                    if node1.view_node.x_name != node2.view_node.x_name:
                        continue
                    if node1.node_type == "all_union" and node2.node_type == "all_union":
                        if node1.operation.column != node2.operation.column:
                            continue
                    if node1.chart_type != node2.chart_type:
                        coincide_node = column_join([node1, node2], column_id, ["coaxis"])
                        join_nodes.append(coincide_node)
                    else:
                        if node1.view_node.chart == "bar" and node1.node_type != "all_union" and len(node1.view_node.X[0]) >= 3 and len(node1.view_node.X[0]) <= 10 and node1.view_node.x_type == 3:
                            node1_line_view_node = copy.deepcopy(node1.view_node)
                            node1_line_view_node.chart = 'line'
                            node1_line_data_node = DataNode(node1.columns.copy(), view_node=node1_line_view_node, importance=node1_line_view_node.importance)
                            coaxis_auxiliary_nodes.append(node1_line_data_node)
                            coincide_node = column_join([node1_line_data_node, node2], column_id, ["coaxis"])
                            join_nodes.append(coincide_node)
                        if node2.view_node.chart == "bar" and node2.node_type != "all_union" and len(node2.view_node.X[0]) >= 3 and len(node2.view_node.X[0]) <= 10 and node2.view_node.x_type == 3:
                            node2_line_view_node = copy.deepcopy(node2.view_node)
                            node2_line_view_node.chart = 'line'
                            node2_line_data_node = DataNode(node2.columns.copy(), view_node=node2_line_view_node, importance=node2_line_view_node.importance)
                            coaxis_auxiliary_nodes.append(node2_line_data_node)
                            coincide_node = column_join([node1, node2_line_data_node], column_id, ["coaxis"])
                            join_nodes.append(coincide_node)
    # Case 2: Condition join
    all_nodes = data_nodes + others
    for i in range(len(all_nodes)):
        node1 = all_nodes[i]
        for j in range(i + 1, len(all_nodes)):
            node2 = all_nodes[j]
            if "link" in [node1.view_node.chart, node2.view_node.chart]:
                continue
            if (
                (
                    len(node1.view_node.groups) == 0 and node1.view_node.X[0] == node2.view_node.groups
                ) or (
                    len(node2.view_node.groups) == 0 and node2.view_node.X[0] == node1.view_node.groups
                )
            ) and (
                node1.view_node.y_name == node2.view_node.y_name or (
                    node1.view_node.y_name.startswith("cnt(") and node2.view_node.y_name.startswith("cnt(")
                )
            ):
                if len(node2.view_node.groups) == 0:
                    _node1, _node2 = node2, node1
                else:
                    _node1, _node2 = node1, node2
                join_node = condition_join([_node1, _node2], _node1.view_node.x_name)
                join_nodes.append(join_node)
    return join_nodes, coaxis_auxiliary_nodes

def construct_data_composition_graph(data_nodes: List[DataNode]) -> List[DataNode]:
    logger.info(f"Constructing data composition graph from {len(data_nodes)} data nodes.")
    logger.info("Data nodes:")
    for node in data_nodes:
        logger.info(node)
    
    # Separate map/graph nodes from regular data nodes
    regular_data_nodes = []
    map_graph_nodes = []
    
    for node in data_nodes:
        if node.view_node and node.view_node.chart in ["map", "graph"]:
            map_graph_nodes.append(node)
        else:
            regular_data_nodes.append(node)
    
    # Process regular data nodes as before
    uncondition_nodes = create_all_union_nodes(regular_data_nodes)
    uncondition_nodes, others = filter_data_nodes(uncondition_nodes)
    # others = []
    logger.info("All union nodes:")
    for node in uncondition_nodes:
        logger.info(node)
    join_nodes, coaxis_auxiliary_nodes = create_join_nodes(uncondition_nodes, others)
    logger.info("Join nodes:")
    for node in join_nodes:
        logger.info(node)

    two_union_nodes, auxiliary_nodes = create_two_union_nodes(uncondition_nodes)
    logger.info("Two union nodes:")
    for node in two_union_nodes:
        logger.info(node)
    
    map_graph_join_nodes, auxiliary_nodes2 = create_map_graph_join_nodes(map_graph_nodes, uncondition_nodes)
    logger.info("Map/Graph join nodes:")
    for node in map_graph_join_nodes:
        logger.info(node)
    reversed_all_union_nodes, auxiliary_nodes3 = create_reversed_all_union_nodes(uncondition_nodes)
    uncondition_nodes += coaxis_auxiliary_nodes
    uncondition_nodes += map_graph_nodes
    uncondition_nodes += two_union_nodes
    uncondition_nodes += reversed_all_union_nodes
    join_nodes += map_graph_join_nodes
    auxiliary_nodes += others
    auxiliary_nodes += auxiliary_nodes2
    auxiliary_nodes += auxiliary_nodes3
    return data_nodes, uncondition_nodes, join_nodes, auxiliary_nodes

def create_map_graph_join_nodes(map_graph_nodes: List[DataNode], uncondition_nodes: List[DataNode]) -> List[DataNode]:
    """
    Create condition_join nodes for map/graph nodes.
    
    Args:
        map_graph_nodes: List of map/graph nodes
        uncondition_nodes: List of uncondition nodes (including two_union nodes)

    Returns:
        List of condition_join nodes for map/graph combinations
    """
    map_graph_join_nodes = []
    auxiliary_nodes = []
    for map_graph_node in map_graph_nodes:
        composite_patterns = []
        if map_graph_node.view_node.chart == "graph":
            composite_patterns = ["nesting"]
        elif map_graph_node.view_node.chart == "map":
            composite_patterns = ["coordinate", "annotation", "linkage"]
        
        # Look for compatible nodes from uncondition_nodes (excluding other map/graph nodes)
        for uncondition_node in uncondition_nodes:
            if uncondition_node.operation and uncondition_node.operation.column == map_graph_node.view_node.x_name:
                join_node = condition_join([map_graph_node, uncondition_node], map_graph_node.view_node.x_name, composite_patterns)
                map_graph_join_nodes.append(join_node)
            elif uncondition_node.operation and uncondition_node.view_node.x_name == map_graph_node.view_node.x_name:
                # reversed_uncondition_node: exchange x and operation columns
                reversed_view_node, reversed_data_nodes, reversed_uncondition_node = create_reversed_view_node(uncondition_node)
                auxiliary_nodes += reversed_data_nodes
                auxiliary_nodes.append(reversed_uncondition_node)
                join_node = condition_join([map_graph_node, reversed_uncondition_node], map_graph_node.view_node.x_name, composite_patterns)
                map_graph_join_nodes.append(join_node)
            if map_graph_node.view_node.chart == "map" and uncondition_node.operation is None and uncondition_node.view_node.x_name == map_graph_node.view_node.x_name:
                join_node = condition_join([map_graph_node, uncondition_node], map_graph_node.view_node.x_name, ["linkage"]) # This should be "column_join", but we use condition_join for consistency
                map_graph_join_nodes.append(join_node)
            if map_graph_node.view_node.chart == "map" and uncondition_node.operation and uncondition_node.view_node.chart == "bar":
                fact_results = getattr(uncondition_node.view_node, 'fact_results', {})
                datafacts = fact_results.get('datafacts', []) if isinstance(fact_results, dict) else []
                has_supported_fact = any(
                    isinstance(datafact, dict) and datafact.get('type') not in ['value', 'extreme', 'distribution']
                    for datafact in datafacts
                )
                if not has_supported_fact:
                    continue
                pie_node = uncondition_node
                if uncondition_node.view_node.x_name == map_graph_node.view_node.x_name:
                    pie_node = reversed_uncondition_node
                if np.min(pie_node.view_node.Y) >= 0 and pie_node.view_node.x_type == 1:  # Check if x_type is categorical
                    pie_node_view_node = copy.deepcopy(pie_node.view_node)
                    pie_node_view_node.chart = "pie"
                    pie_data_nodes = load_data_nodes_from_views([pie_node_view_node])
                    pie_uncondition_node = create_all_union_nodes(pie_data_nodes)[0]
                    auxiliary_nodes += pie_data_nodes
                    auxiliary_nodes.append(pie_uncondition_node)
                    if map_graph_node.view_node.chart == "map":
                        join_node = condition_join([map_graph_node, pie_uncondition_node], map_graph_node.view_node.x_name, ["coordinate", "annotation"])
                    elif map_graph_node.view_node.chart == "graph":
                        join_node = condition_join([map_graph_node, pie_uncondition_node], map_graph_node.view_node.x_name, ["nesting"])
                    map_graph_join_nodes.append(join_node)
    return map_graph_join_nodes, auxiliary_nodes
