import json
import os
import math
import copy
from typing import Dict, List, Optional, Set, Tuple
import itertools
import cairosvg
import numpy as np
import pandas as pd
from search.data_composition import DataNode
from search.scoring_model.scoring_model import get_score, get_aesthetic_score
from search.utils import post_render_request
from search.vis_constraints import constraint_manager, ConstraintType
from search.vis_layout import LayoutElement, layoutscorer
from search.logger_config import logger

class VisNode:
    """
    Node for **vis** composition tree.
    """

    def __init__(self, data_node: Optional[DataNode] = None):
        self.children: List[VisNode] = []
        self.parent: Optional[VisNode] = None
        self.data_node = data_node
        self.chart_type = None if data_node is None else data_node.chart_type
        # New parameter structure based on the table
        # composite_pattern: repetition, stack, mirror, 
        #                   linkage, coaxis, coordinate, 
        #                   annotation, nesting
        self.composite_pattern = None
        # spatial_arrangement: directional (horizontal, vertical, circular, radial, irregular) or 
        #                     structural/positional (regular_tessellation, irregular_tessellation, in_place, nearby)
        self.spatial_arrangement = None
        # spatial_distribution: equal, proportional
        self.spatial_distribution = None
        self.children_order = None  # For column join nodes, the order of children is important
        self.constraints = {
            ConstraintType.COLUMNS.value: {},
            ConstraintType.ARRANGEMENTS.value: {}
        }
        self.layout = LayoutElement(0, 0, -1, -1)
        if self.data_node and self.data_node.node_type == "data" and self.chart_type:
            if self.chart_type[0] == "pie":
                # Pie charts have a polar coordinate system
                columns_key = ConstraintType.COLUMNS.value
                arrangements_key = ConstraintType.ARRANGEMENTS.value
                self.constraints[columns_key][self.data_node.view_node.x_name] = "circular"
                self.constraints[arrangements_key]["circular"] = self.data_node.view_node.x_name
            elif self.chart_type[0] == "link":
                self.constraints[ConstraintType.SPATIAL_ARRANGEMENT.value] = ["horizontal", "vertical"]
                
        if self.data_node and self.data_node.node_type != "data":
            # Define available composite patterns based on data node type and constraints
            self.composite_patterns = self.data_node.composition_patterns
            
            # Define spatial arrangements based on composite pattern
            self.spatial_arrangements = ["horizontal", "vertical", "circular", "radial", "irregular", 
                                       "regular_tessellation", "irregular_tessellation", "in_place", "nearby"]
            if self.data_node.spatial_arrangements:
                self.spatial_arrangements = self.data_node.spatial_arrangements
                
            # Spatial distribution options
            self.spatial_distributions = ["equal", "proportional"]
            
            # For MCGS
            self.composite_pattern_Q = {k: 0 for k in self.composite_patterns}
            self.spatial_arrangement_Q = {k: 0 for k in self.spatial_arrangements}
            self.spatial_distribution_Q = {k: 0 for k in self.spatial_distributions}
            self.composite_pattern_N = {k: 0 for k in self.composite_patterns}
            self.spatial_arrangement_N = {k: 0 for k in self.spatial_arrangements}
            self.spatial_distribution_N = {k: 0 for k in self.spatial_distributions}
            
            self.selected_children_order_Q = {}
            self.selected_children_order_N = {}
            self._init_selected_children_order()
            
        # For MCGS
        self.visited = False  # Not visited when initialized
        
        self.Q = 0  # The ultimate reward value of the node
        self.N = 0  # The number of times the node has been visited
        self.edges = {}

    def __str__(self):
        if self.data_node is None:
            return "VisNode(None)"
        if self.data_node.node_type == "data":
            str_repr = f"VisNode({self.data_node})"
        else:
            str_repr = f"VisNode({self.data_node}"
            if self.composite_pattern:
                str_repr += f", {self.composite_pattern}"
            if self.spatial_arrangement:
                str_repr += f", {self.spatial_arrangement}"
            if self.spatial_distribution:
                str_repr += f", {self.spatial_distribution}"
            str_repr += ")"
        return str_repr
    
    def _init_selected_children_order(self):
        data_nodes_children = self.data_node.children
        n = len(data_nodes_children)
        
        if self.data_node.node_type == "column_join":
            for i in range(2, min(5, n + 1)):
                for combination in itertools.permutations(data_nodes_children, i):
                    # 检查是否有link节点在排列的中间位置
                    valid_order = True
                    has_link = False
                    has_pie = False
                    
                    for j in range(len(combination)):
                        node = combination[j]
                        # 检查link节点在中间位置
                        if j > 0 and j < len(combination) - 1:
                            if node.node_type == "link" or (node.view_node and node.chart_type and node.chart_type[0] == "link"):
                                valid_order = False
                                break
                
                        # 记录是否包含link和pie类型
                        if node.node_type == "link" or (node.view_node and node.chart_type and node.chart_type[0] == "link"):
                            has_link = True
                        elif node.view_node and node.chart_type and node.chart_type[0] == "pie":
                            has_pie = True
            
                    # 如果同时包含link和pie，设置为无效
                    if has_link and has_pie:
                        valid_order = False
            
                    if valid_order:
                        # 使用数据节点在data_node.children中的索引作为键
                        children_indices = tuple(data_nodes_children.index(child) for child in combination)
                        if children_indices not in self.selected_children_order_Q:
                            self.selected_children_order_Q[children_indices] = 0
                            self.selected_children_order_N[children_indices] = 0
    def is_leaf(self):
        return len(self.children) == 0

    def add_child(self, child: "VisNode"):
        self.children.append(child)
        child.parent = self

    def set_composite_pattern(self, pattern: str):
        assert pattern in self.composite_patterns
        self.composite_pattern = pattern

    def set_spatial_arrangement(self, arrangement: str):
        assert arrangement in self.spatial_arrangements
        self.spatial_arrangement = arrangement

    def set_spatial_distribution(self, distribution: str):
        assert distribution in self.spatial_distributions
        self.spatial_distribution = distribution
        
    def expand_operation_layer(self, has_operation=False, layer_result=None, valid_children=None, strategy="UCB"):
        def expand_layer(operations, Q_list, N_list, exploration_rate, c_param=1.5):
            if len(operations) == 0:
                raise ValueError("No valid operations available for expansion.")
            if len(operations) == 1:
                return operations[0]
            weights = []
            parent_visits = np.sum(list(N_list.values()))
            # TODO: may delete this exploration rate, because UCB is already a kind of exploration strategy
            if np.random.rand() < exploration_rate:
                chosen_operation_idx = np.random.choice(len(operations))
                chosen_operation = operations[chosen_operation_idx]
            else:
                # Calculate the weight for each edge
                for operation in operations:
                    visits = N_list[operation]
                    value = Q_list[operation]
                    if visits != 0:
                        w = value / visits + c_param * np.sqrt(
                            2 * np.log(parent_visits) / (visits)
                        )
                    else:
                        w = float("inf")
                    weights.append(w)

                # Choose the action with the highest weight
                chosen_operation = pd.Series(data=weights, index=operations).idxmax()

            return chosen_operation
        if layer_result is not None:
            # If layer_result is provided, it means this node has already been expanded
            composite_pattern, spatial_arrangement, spatial_distribution = layer_result
            self.set_composite_pattern(composite_pattern)
            self.set_spatial_arrangement(spatial_arrangement)
            self.set_spatial_distribution(spatial_distribution)
            return composite_pattern, spatial_arrangement, spatial_distribution
        
        alpha = 0.3
        parent_visits = self.N
        exploration_rate = max(0.2, math.exp(-alpha * parent_visits))
        if strategy == "random":
            exploration_rate = 1.0
        if valid_children is not None and self.data_node.node_type == "column_join":
            # 获取valid_children中的数据节点对应在data_node.children中的索引
            valid_children_indices = []
            must_children_indices = []
            for child in valid_children:
                if child.data_node in self.data_node.children:
                    child_index = self.data_node.children.index(child.data_node)
                    valid_children_indices.append(child_index)
                    if child.composite_pattern == "repetition" and child.data_node.operation.column == self.data_node.operation.column:
                        must_children_indices.append(child_index)
            # 获取有效的子节点排序
            valid_children_orders = constraint_manager.get_valid_children_order(
                self, valid_children_indices, must_children_indices)
            
            # 如果没有有效的子节点排序，返回None
            if not valid_children_orders:
                return None
                
            children_order = expand_layer(
                valid_children_orders,
                self.selected_children_order_Q,
                self.selected_children_order_N,
                exploration_rate,
            )
            
            # 转换为在valid_children中的索引
            children_order_indices = []
            for idx in children_order:
                # 获取data_node.children中索引为idx的节点在valid_children中的位置
                data_node_child = self.data_node.children[idx]
                for i, vc in enumerate(valid_children):
                    if vc.data_node == data_node_child:
                        children_order_indices.append(i)
                        break
            
            self.children_order = children_order_indices
            valid_children = [valid_children[i] for i in children_order_indices]

        # Compute constraints for this node
        constraints = constraint_manager.get_children_constraints(self, CompositeState.data_node_to_vis_node, valid_children)

        # Get valid composite patterns based on constraints
        valid_composite_patterns = constraint_manager.get_valid_composite_patterns(self, constraints, has_operation=has_operation)
        if len(valid_composite_patterns) == 0:
            return None

        # Select composite pattern
        composite_pattern = expand_layer(
            valid_composite_patterns,
            self.composite_pattern_Q,
            self.composite_pattern_N,
            exploration_rate,
        )

        # Get valid spatial arrangements based on composite pattern and constraints
        valid_spatial_arrangements = constraint_manager.get_valid_spatial_arrangements(
            self, composite_pattern, constraints, has_operation=has_operation)
        if len(valid_spatial_arrangements) == 0:
            return None  # No valid arrangements available

        # Select spatial arrangement
        spatial_arrangement = expand_layer(
            valid_spatial_arrangements,
            self.spatial_arrangement_Q,
            self.spatial_arrangement_N,
            exploration_rate,
        )

        # Select spatial distribution based on the composite pattern
        valid_spatial_distributions = constraint_manager.get_valid_spatial_distributions(composite_pattern, spatial_arrangement)
        spatial_distribution = expand_layer(
            valid_spatial_distributions,
            self.spatial_distribution_Q,
            self.spatial_distribution_N,
            exploration_rate,
        )
        
        
        self.set_composite_pattern(composite_pattern)
        self.set_spatial_arrangement(spatial_arrangement)
        self.set_spatial_distribution(spatial_distribution)

        return composite_pattern, spatial_arrangement, spatial_distribution

    def update_operation_Q(self, score, design_space=None):
        if design_space is None:
            design_space = [self.composite_pattern, self.spatial_arrangement, self.spatial_distribution]

        self.composite_pattern_Q[design_space[0]] += score
        self.composite_pattern_N[design_space[0]] += 1

        self.spatial_arrangement_Q[design_space[1]] += score
        self.spatial_arrangement_N[design_space[1]] += 1

        self.spatial_distribution_Q[design_space[2]] += score
        self.spatial_distribution_N[design_space[2]] += 1
        
        if len(self.children) > 0 and self.data_node.node_type == "column_join":
            # 使用每个child.data_node在self.data_node.children中的索引作为键
            children_indices = []
            for child in self.children:
                if child.data_node in self.data_node.children:
                    children_indices.append(self.data_node.children.index(child.data_node))
            
            children_indices_key = tuple(children_indices)
            
            if children_indices_key in self.selected_children_order_Q:
                self.selected_children_order_Q[children_indices_key] += score
                self.selected_children_order_N[children_indices_key] += 1

        self.Q += score


class CompositeState:
    data_nodes: List[VisNode] = []
    uncondition_nodes: List[VisNode] = []
    join_nodes: List[VisNode] = []
    auxiliary_nodes: List[VisNode] = []
    finish_node = VisNode()
    uncondition_nodes_select_times: Dict[DataNode, int] = {}
    uncondition_node_pairs_select_times: Dict[Tuple[DataNode, DataNode], int] = {}
    data_node_to_vis_node: Dict[DataNode, VisNode] = {}
    edge_path = []
    mode = ""
    history_score = {}
    tasks_info = []
    chosen_strategy = "random"
    task_max_scores = {}
    
    def __init__(self, vis_tree: Optional[VisNode] = None):
        self.root = vis_tree
        self.last_node = vis_tree
        self.chosen_operation_nodes = []
        self.vis_tree_nodes = []
        self.vis_tree_operation_nodes = []
        
        self.valid_vis_tree = True
        self.update_states(vis_tree, [])

    def get_root(self, node: VisNode):
        while node.parent:
            node = node.parent
        return node
    
    def get_vis_tree_nodes(self):
        vis_tree_nodes = []
        def dfs(node: VisNode):
            vis_tree_nodes.append(node)
            for child in node.children:
                dfs(child)

        if self.root is not None:
            dfs(self.root)
        return vis_tree_nodes
    
    def get_vis_tree_operation_nodes(self):
        vis_tree_nodes = self.get_vis_tree_nodes()
        return [node for node in vis_tree_nodes if node not in CompositeState.data_nodes + CompositeState.auxiliary_nodes]
    
    def update_states(self, next_node, valid_children):
        if next_node.data_node is None:
            return
        vis_tree_nodes = self.get_vis_tree_nodes()
        vis_tree_operation_nodes = [node for node in vis_tree_nodes if node not in CompositeState.data_nodes + CompositeState.auxiliary_nodes]
        self.chosen_operation_nodes.append(next_node)
        self.vis_tree_nodes = vis_tree_nodes
        self.vis_tree_operation_nodes = vis_tree_operation_nodes
        self.update_layout(next_node, valid_children)
        constraint_manager.compute_constraints(next_node, CompositeState.data_node_to_vis_node, valid_children)

    def update_layout(self, next_node: VisNode, valid_children: List[VisNode]):
        """
        增量更新布局元素列表和邻居关系
        """
        if next_node == self.finish_node:
            return
        
        self._update_neighbors(next_node, valid_children)
        self._update_bbox(next_node, valid_children)
        pass
    
    def _update_neighbors(self, vis_node: VisNode, valid_children: List[VisNode]):
        spatial_arrangement = vis_node.spatial_arrangement
        n = len(valid_children)
        for i in range(n):
            child_vis_node = valid_children[i]
            if spatial_arrangement == "horizontal" or spatial_arrangement == "circular":
                if i > 0:
                    child_vis_node.layout.set_neighbor('left', valid_children[i - 1])
                if i < n - 1:
                    child_vis_node.layout.set_neighbor('right', valid_children[i + 1])
            elif spatial_arrangement == "vertical" or spatial_arrangement == "radial":
                if i > 0:
                    child_vis_node.layout.set_neighbor('top', valid_children[i - 1])
                if i < n - 1:
                    child_vis_node.layout.set_neighbor('bottom', valid_children[i + 1])
            
            # set inner and outer
            child_vis_node.layout.set_neighbor('outer', vis_node)
            vis_node.layout.set_neighbor('inner', child_vis_node)
    
    def _update_bbox(self, vis_node: VisNode, valid_children: List[VisNode]):
        """
        更新节点的边界框，并递归更新其子节点的位置
        
        1. 确定vis_node.data_node的每一个孩子对应的vis_node的位置
        2. 找到孩子对应的vis_node的祖先，调整祖先的位置让孩子对应到确定的位置上，同时递归平移和缩放祖先下的其他vis_node
        """
        if len(valid_children) == 0:
            return
        
        # 获取空间排列方式
        spatial_arrangement = vis_node.spatial_arrangement
        spatial_distribution = vis_node.spatial_distribution
        if not spatial_arrangement:
            return
        
        # 获取所有子节点对应的vis_node
        child_vis_nodes = valid_children
        importances = [node.data_node.importance for node in child_vis_nodes]
        total_importance = sum(importances) if importances and all(i is not None for i in importances) else 0
        default_width = 100
        default_height = 100
        spacing = 0
        if vis_node.layout.initialized:
            if spatial_arrangement in ["horizontal", "circular"]:
                default_height = max(default_height, vis_node.layout.height)
            elif spatial_arrangement in ["vertical", "radial"]:
                default_width = max(default_width, vis_node.layout.width)
        for i, child_vis_node in enumerate(child_vis_nodes):
            if child_vis_node.layout.width <= 0:
                if spatial_distribution == "proportional" and total_importance > 0 and spatial_arrangement in ["horizontal", "circular"]:
                    # 按importance比例设置宽度
                    importance_ratio = importances[i] / total_importance
                    child_vis_node.layout.width = default_width * importance_ratio * len(child_vis_nodes)
                else:
                    child_vis_node.layout.width = default_width
                    
            if child_vis_node.layout.height <= 0:
                if spatial_distribution == "proportional" and total_importance > 0 and spatial_arrangement in ["vertical", "radial"]:
                    # 按importance比例设置高度
                    importance_ratio = importances[i] / total_importance
                    child_vis_node.layout.height = default_height * importance_ratio * len(child_vis_nodes)
                else:
                    child_vis_node.layout.height = default_height

        if spatial_arrangement in ["horizontal", "circular"]:
            max_height = max(child.layout.height for child in child_vis_nodes)
            x_pos = 0
            for child_vis_node in child_vis_nodes:
                ancestor = child_vis_node
                while ancestor.parent and ancestor.parent != vis_node:
                    ancestor = ancestor.parent
                old_bbox = child_vis_node.layout.get_bbox()
                # new_bbox = {"x": x_pos, "y": 0, "width": child_vis_node.layout.width, "height": max_height}
                new_bbox = {"x": x_pos, "y": 0, "width": child_vis_node.layout.width * max_height / child_vis_node.layout.height, "height": max_height}
                self._adjust_subtree(ancestor, old_bbox, new_bbox)
                x_pos += child_vis_node.layout.width + spacing
            
        elif spatial_arrangement in ["vertical", "radial"]:
            max_width = max(child.layout.width for child in child_vis_nodes)
            y_pos = 0
            for child_vis_node in child_vis_nodes:
                ancestor = child_vis_node
                while ancestor.parent and ancestor.parent != vis_node:
                    ancestor = ancestor.parent
                old_bbox = child_vis_node.layout.get_bbox()
                # new_bbox = {"x": 0, "y": y_pos, "width": max_width, "height": child_vis_node.layout.height * max_width / child_vis_node.layout.width}
                new_bbox = {"x": 0, "y": y_pos, "width": max_width, "height": child_vis_node.layout.height * max_width / child_vis_node.layout.width}
                self._adjust_subtree(ancestor, old_bbox, new_bbox)
                y_pos += child_vis_node.layout.height + spacing
                
        # Calculate bounding box that encompasses all children
        min_x = min(child.layout.x for child in child_vis_nodes)
        min_y = min(child.layout.y for child in child_vis_nodes)
        max_x = max(child.layout.x + child.layout.width for child in child_vis_nodes)
        max_y = max(child.layout.y + child.layout.height for child in child_vis_nodes)
        new_width = max_x - min_x
        new_height = max_y - min_y
        if vis_node.layout.initialized:
            old_bbox = vis_node.layout.get_bbox()
            old_x = old_bbox['x']
            old_y = old_bbox['y']
            old_width = old_bbox['width']
            old_height = old_bbox['height']
            vis_node.layout.set_bbox(
                old_x,
                old_y,
                new_width,
                new_height
            )
            for child_vis_node in child_vis_nodes:
                self._move_node(child_vis_node, old_x - min_x, old_y - min_y)
            moved_nodes = set()
            if new_width != old_width:
                moved_nodes.update(self._move_nodes_from(vis_node, 'right', new_width - old_width, 0))
            if new_height != old_height:
                moved_nodes.update(self._move_nodes_from(vis_node, 'bottom', 0, new_height - old_height))
            ancestor = vis_node.parent
            # moved_nodes.remove(vis_node)  # Remove the current node from moved nodes
            while ancestor:
                ancestor.layout.update_bbox()
                ancestor = ancestor.parent
        else:
            vis_node.layout.set_bbox(
                min_x, 
                min_y, 
                new_width, 
                new_height
            )
                
    def _adjust_subtree(self, vis_node: VisNode, old_bbox, new_bbox):
        """
        递归地调整节点及其子树的位置，使适应新的边界框
        
        Args:
            node: 要调整的节点
            old_bbox: 原来的边界框，包含x, y, width, height信息
        """
        # 计算缩放和平移变换
        old_x = old_bbox['x']
        old_y = old_bbox['y']
        old_width = old_bbox['width']
        old_height = old_bbox['height']
            
        new_x = new_bbox['x']
        new_y = new_bbox['y']
        new_width = new_bbox['width']
        new_height = new_bbox['height']
        
        # 计算缩放因子
        scale_x = new_width / old_width if old_width > 0 else 1
        scale_y = new_height / old_height if old_height > 0 else 1
        self._transform_subtree(vis_node, old_x, old_y, new_x, new_y, scale_x, scale_y)
    
    def _transform_subtree(self, node: VisNode, old_x: float, old_y: float, new_x: float, new_y: float, scale_x: float = 1, scale_y: float = 1):
        """
        对节点及其子树应用平移和缩放变换
        
        Args:
            node: 要变换的节点
            dx: x方向的平移量
            dy: y方向的平移量
            scale_x: x方向的缩放因子
            scale_y: y方向的缩放因子
            except_node: 需要排除的节点（不应用变换），通常是引发变换的节点
        """
        node.layout.set_bbox(
            new_x + (node.layout.x - old_x) * scale_x,
            new_y + (node.layout.y - old_y) * scale_y,
            node.layout.width * scale_x,
            node.layout.height * scale_y
        )
        for child in node.children:
            self._transform_subtree(child, old_x, old_y, new_x, new_y, scale_x, scale_y)
    
    def _move_node(self, node: VisNode, dx: float, dy: float):
            """
            Move the node by dx and dy, updating its position and layout.
            
            Args:
                node: The VisNode to move.
                dx: The amount to move in the x direction.
                dy: The amount to move in the y direction.
            """
            node.layout.x += dx
            node.layout.y += dy
    
    def _move_nodes_from(self, node: VisNode, direction: str, dx: float, dy: float):
        moved_nodes = set()
        moved_nodes.add(node)
        node_to_move = set()
        if node.layout.get_neighbor(direction):
            node_to_move.add(node.layout.get_neighbor(direction))
        while len(node_to_move) > 0:
            current_node = node_to_move.pop()
            if current_node in moved_nodes:
                continue
            self._move_node(current_node, dx, dy)
            moved_nodes.add(current_node)
            # Add neighbors to the list to move
            for neighbor in current_node.layout.get_neighbors():
                if neighbor not in moved_nodes and neighbor not in node_to_move:
                    node_to_move.add(neighbor)
        return moved_nodes
            
    def get_available_nodes(self) -> Tuple[List[VisNode], Dict[VisNode, Tuple[List[VisNode], List[VisNode]]]]:
        """
        Returns the list of available nodes to choose from, only including nodes with more than one valid child.
        """
        def find_ancestor(vis_node):
            while vis_node.parent:
                vis_node = vis_node.parent
            return vis_node
        possible_available_nodes = (
            CompositeState.uncondition_nodes + CompositeState.join_nodes
        )
        available_nodes = []
        available_nodes_to_valid_children = {}
        center_dimension = None
        for node in self.vis_tree_nodes:
            if node.data_node.node_type in ["all_union", "two_union"] and len(node.data_node.children) == 0:
                if center_dimension is None:
                    center_dimension = node.data_node.operation.column
                elif node.data_node.operation.column != center_dimension:
                    raise ValueError(
                        "Union nodes with different operation columns cannot be selected together."
                    )
                center_dimension = node.data_node.operation.column
                
        for node in possible_available_nodes:
            if node in self.chosen_operation_nodes or node.data_node.node_type == "data":
                continue
            if node.data_node in CompositeState.uncondition_nodes_select_times:
                if CompositeState.uncondition_nodes_select_times[node.data_node] <= 0:
                    continue
            # Count valid children ancestors
            valid_children = []
            valid_children_ancestor = []
            next_node_data_node = node.data_node
            
            # Check the eligibility of each child node
            for child in next_node_data_node.children:
                is_valid = True
                child_vis_node = CompositeState.data_node_to_vis_node[child]
                # Special condition checking for join nodes
                if next_node_data_node.node_type == "column_join":
                    # Check the selection count of child nodes
                    if CompositeState.uncondition_nodes_select_times[child] <= 0:
                        is_valid = False
                    
                    # If child is a union node with same operation column as current node, check if it's in chosen operations
                    if child.node_type in ["all_union", "two_union"]:
                        if child.operation.column == next_node_data_node.operation.column:
                            if child_vis_node not in self.chosen_operation_nodes:
                                is_valid = False
                        if len(child_vis_node.children) == 0:
                            if center_dimension is None:
                                center_dimension = child.operation.column
                            elif child.operation.column != center_dimension:
                                is_valid = False
                            
                if is_valid:
                    valid_children.append(child_vis_node)
            
            valid_children.sort(key=lambda node: 0 if node.data_node and node.data_node.node_type == "data" else 1)
            removed_indices = []
            for i, child in enumerate(valid_children):
                ancestor = find_ancestor(child)
                if ancestor not in valid_children_ancestor:
                    valid_children_ancestor.append(ancestor)
                else:
                    removed_indices.append(i)
            # Only add nodes with multiple valid children ancestors
            if len(valid_children_ancestor) > 1:
                available_nodes.append(node)
                valid_children = [child for i, child in enumerate(valid_children) if i not in removed_indices]
                available_nodes_to_valid_children[node] = (valid_children, valid_children_ancestor)
        available_nodes.append(self.finish_node)
        available_nodes_to_valid_children[self.finish_node] = ([], [])
        return available_nodes, available_nodes_to_valid_children

    def get_available_nodes_with_constraints(self) -> Tuple[List[VisNode], Dict[VisNode, Tuple[List[VisNode], List[VisNode]]]]:
        """
        Returns the list of available nodes that satisfy constraints.
        This method filters nodes before they are selected to avoid invalid states.
        """
        base_available_nodes, base_available_nodes_to_valid_children = self.get_available_nodes()
        valid_nodes = []
        
        if constraint_manager._has_non_composable_pattern(self.chosen_operation_nodes):
            return [self.finish_node], {self.finish_node: ([], [])}
        
        for node in base_available_nodes:
            if node == self.finish_node:
                valid_nodes.append(node)
                continue
                
            # Check if the node can be safely added without violating constraints
            if constraint_manager._has_composable_pattern(node, self.chosen_operation_nodes):
                valid_nodes.append(node)
        
        for node in valid_nodes:
            if node == self.finish_node:
                continue
            valid_children = base_available_nodes_to_valid_children[node][0]
            constraints = constraint_manager.get_children_constraints(node, CompositeState.data_node_to_vis_node, valid_children)
            if len(constraints["coordinate_system"]) == 0:
                if all([pattern not in ["coordinate", "annotation", "nesting"] for pattern in node.composite_patterns]):
                    valid_nodes.remove(node)
        valid_nodes_to_valid_children = {}
        for node in valid_nodes:
            valid_nodes_to_valid_children[node] = base_available_nodes_to_valid_children[node]
        return valid_nodes, valid_nodes_to_valid_children

    def select(self, c_param=1.5):
        """
        Selects the optimal action based on the current child nodes and returns the child node
        :param c_param: Exploration parameter used for the proportion of exploration
        :return: Optimal action, child node under the optimal action
        """
        # Here we need to decide, if it is a leaf node and has been visited, then another one needs to be chosen
        # Here, based on the current state, random noise can be added
        alpha = 0.3
        parent_visits = self.last_node.N
        exploration_rate = max(0.2, math.exp(-alpha * parent_visits))
        
        # Filter out the nodes that can be selected based on constraints
        legal_nodes, legal_nodes_to_valid_children = self.get_available_nodes_with_constraints()
        legal_edges = {k: v for k, v in self.last_node.edges.items() if k in legal_nodes}

        result = None
        layer_result = None
        retry = 0
        while result is None:
            if retry > 10:
                self.valid_vis_tree = False
                chosen_edge = self.finish_node
                break
            weights = []
            # Decide whether to explore based on the exploration rate randomly
            if np.random.rand() < exploration_rate:
                chosen_edge, layer_result = self._select_node_with_strategy(list(legal_edges.keys()), legal_nodes_to_valid_children, CompositeState.chosen_strategy)
            else:
                # Calculate the weight for each edge
                for target_node, edge_info in legal_edges.items():
                    visits = edge_info["visits"]
                    value = edge_info["value"]
                    parent_visits = self.last_node.N

                    if visits != 0:
                        w = value / visits + c_param * np.sqrt(
                            2 * np.log(parent_visits) / (visits)
                        )
                    else:
                        w = float(
                            "inf"
                        )  # N==0 means it hasn't been explored, so it should be prioritized
                    weights.append(w)

                # Choose the action with the highest weight
                chosen_edge = pd.Series(data=weights, index=legal_edges.keys()).idxmax()
            if chosen_edge == self.finish_node:
                break
            has_operation = len(self.chosen_operation_nodes) > 0
            valid_children = legal_nodes_to_valid_children.get(chosen_edge, ([], []))[0]
            result = chosen_edge.expand_operation_layer(has_operation, layer_result, valid_children)
            if result is None:
                legal_edges.pop(chosen_edge, None)
                legal_nodes.remove(chosen_edge)
                continue
            retry += 1
        
        next_node = chosen_edge
        self.edge_path.append((self.last_node, next_node))
        self.last_node = next_node
        if next_node == self.finish_node:
            return next_node
        
        next_node = self.get_next_state(next_node, valid_children_tuple=legal_nodes_to_valid_children.get(next_node, []))
        # if result is None:
        #     # No valid configuration found, skip this node
        #     return self.finish_node
        return next_node

    def expand(self):
        """
        Expands a child node and returns the newly expanded child node.
        :return: The newly expanded child node.
        """
        untried_nodes, untried_nodes_to_valid_children = self.get_untried_nodes_with_constraints()
        result = None
        retry = 0
        while result is None and len(untried_nodes) > 0:
            if retry > 10:
                self.valid_vis_tree = False
                q = self.finish_node
                break
            # 使用统一的节点选择函数
            node, layer_result = self._select_node_with_strategy(untried_nodes, untried_nodes_to_valid_children, CompositeState.chosen_strategy)
            # Add action to the query statement
            q = node
            if q == self.finish_node:
                break
            has_operation = len(self.chosen_operation_nodes) > 0
            valid_children = untried_nodes_to_valid_children.get(q, ([], []))[0]
            result = q.expand_operation_layer(has_operation, layer_result, valid_children, CompositeState.chosen_strategy)
            if result is None:
                untried_nodes.remove(node)
                continue
            retry += 1
        
        if q not in self.last_node.edges:
            self.last_node.edges[q] = {"visits": 0, "value": 0}
        self.edge_path.append((self.last_node, q))
        self.last_node = q
        if q == self.finish_node:
            return q
        q = self.get_next_state(q, valid_children_tuple=untried_nodes_to_valid_children.get(q, []))
        # if result is None:
        #     # No valid configuration found, skip this node
        #     return self.finish_node
        return q

    def get_untried_nodes_with_constraints(self):
        """Get untried nodes that satisfy constraints."""
        available_nodes, available_nodes_to_valid_children = self.get_available_nodes_with_constraints()
        tried_nodes = self.last_node.edges.keys()
        untried_nodes = [node for node in available_nodes if node not in tried_nodes]
        untried_nodes_to_valid_children = {node: available_nodes_to_valid_children[node] for node in untried_nodes}
        return untried_nodes, untried_nodes_to_valid_children

    def update(self):
        if not self.valid_vis_tree:
            return
        
        if len(self.vis_tree_operation_nodes) < len(self.chosen_operation_nodes):
            self.valid_vis_tree = False
            return
        
        vis_tree_score = get_vis_tree_score(set(self.vis_tree_nodes), self.root, CompositeState.history_score, CompositeState.tasks_info, CompositeState.mode)

        for edge in self.edge_path:
            parent = edge[0]
            child = edge[1]
            edge_info = parent.edges[child]
            edge_info["visits"] += 1
            edge_info["value"] += vis_tree_score
            parent.N += 1
            parent.visited = True
            if child.composite_pattern:
                child.update_operation_Q(vis_tree_score)
                
    def get_info(self):
        """
        Get all the necessary information for further update.
        Used in parallel simulation.
        """
        def get_edge_info(edge_path):
            edge_info = []
            for edge in edge_path:
                parent = edge[0]
                child = edge[1]
                design_space = None
                if child.composite_pattern:
                    design_space = [child.composite_pattern, child.spatial_arrangement, child.spatial_distribution]
                edge_info.append((parent, child, design_space))
            return edge_info
        
        info = {}
        info['vis_tree_nodes'] = copy.copy(self.vis_tree_nodes) # only copy the ptr of each vis_node
        info['vis_tree_dict'], _ = vis_tree_to_json(self.root)
        info['edge_info'] = get_edge_info(self.edge_path)
        info['chosen_operation_nodes'] = copy.copy(self.chosen_operation_nodes)
        return info

    def rollout(self):
        """
        Perform a Monte Carlo simulation from the current node and return the simulation result
        :return: Simulation result
        """
        while True:
            if not self.valid_vis_tree:
                break
            available_nodes, available_nodes_to_valid_children = self.get_available_nodes_with_constraints()
            if len(available_nodes) == 0:
                break
            result = None
            retry = 0
            while result is None:
                if retry > 10:
                    self.valid_vis_tree = False
                    return self.root
                node, layer_result = self._select_node_with_strategy(available_nodes, available_nodes_to_valid_children, CompositeState.chosen_strategy)
                if node == self.finish_node:
                    return self.root
                has_operation = len(self.chosen_operation_nodes) > 0
                valid_children = available_nodes_to_valid_children.get(node, ([], []))[0]
                result = node.expand_operation_layer(has_operation, layer_result, valid_children, CompositeState.chosen_strategy)
                if result is None:
                    available_nodes.remove(node)
                    continue
                retry += 1
            node = self.get_next_state(node, valid_children_tuple=available_nodes_to_valid_children.get(node, []))
            if node.composite_pattern == "linkage":
                break
            # plot_compostition_graph(set(self.vis_tree_nodes))
        return self.root

    def is_full_expand(self):
        available_nodes, _ = self.get_available_nodes_with_constraints()
        tried_nodes = self.last_node.edges.keys()

        return all([node in tried_nodes for node in available_nodes])

    def get_next_state(self, next_node: VisNode, valid_children_tuple: Tuple[List[VisNode], List[VisNode]] = ([], [])) -> VisNode:
        """
        Updates the state by adding the selected node to the visualization tree.
        :param next_node: The node to add to the tree
        :return: The updated node or root if the update failed
        """
        if next_node == self.finish_node:
            return next_node
        next_node_data_node = next_node.data_node
        valid_children, valid_children_ancestor = valid_children_tuple
        # Use ancestor nodes to build the visualization tree
        if next_node.children_order:
            valid_children = [valid_children[i] for i in next_node.children_order]
            valid_children_ancestor = [valid_children_ancestor[i] for i in next_node.children_order]
        next_node.children = valid_children_ancestor
        # next_node.children.sort(key=lambda node: 0 if node.data_node and node.data_node.node_type == "data" else 1)
        for child in next_node.children:
            child.parent = next_node
        self.root = self.get_root(next_node)
        if next_node_data_node.node_type == "column_join":
            for child in next_node_data_node.children:
                # Only decrease selection count for children actually added
                if CompositeState.data_node_to_vis_node[child] in valid_children:  # Use original child nodes
                    CompositeState.uncondition_nodes_select_times[child] -= 1
            
            # Decrease selection count for valid child node pairs - using original child nodes
            valid_data_nodes = [node.data_node for node in valid_children]  # Use original child nodes
            for child1 in valid_data_nodes:
                for child2 in valid_data_nodes:
                    if child1 != child2:
                        CompositeState.uncondition_node_pairs_select_times[(child1, child2)] -= 1
                        
        self.update_states(next_node, valid_children)
        return next_node
    
    def _select_node_with_strategy(self, nodes, nodes_to_valid_children, strategy="random"):
        """
        统一节点选择策略函数
        
        Args:
            nodes: 可选择的节点列表
            strategy: 选择策略，目前支持"random"随机选择
            
        Returns:
            选择的节点
        """
        if len(nodes) == 0:
            return None
            
        if strategy == "random":
            return np.random.choice(nodes), None
        
        if strategy == "knowledge_guided":
            raise NotImplementedError("knowledge_guided strategy is not implemented yet.")

        return np.random.choice(nodes), None

def clean_states():
    constraint_manager.clear_global_constraints()
    
    for node in CompositeState.data_nodes + CompositeState.uncondition_nodes + CompositeState.join_nodes + CompositeState.auxiliary_nodes:
        node.parent = None
        node.children = []
        node.composite_pattern = None
        node.spatial_arrangement = None
        node.spatial_distribution = None
        node.children_order = None
        node.constraints = {
            ConstraintType.COLUMNS.value: {}, 
            ConstraintType.ARRANGEMENTS.value: {}
        }
        node.layout = LayoutElement(0, 0, -1, -1)
        if node.data_node and node.data_node.node_type == "data" and node.chart_type:
            if node.chart_type[0] == "pie":
                # Pie charts have a polar coordinate system
                columns_key = ConstraintType.COLUMNS.value
                arrangements_key = ConstraintType.ARRANGEMENTS.value
                node.constraints[columns_key][node.data_node.view_node.x_name] = "circular"
                node.constraints[arrangements_key]["circular"] = node.data_node.view_node.x_name
            elif node.chart_type[0] == "link":
                node.constraints[ConstraintType.SPATIAL_ARRANGEMENT.value] = ["horizontal", "vertical"]
                
    for node in CompositeState.uncondition_nodes:
        data_node = node.data_node
        CompositeState.uncondition_nodes_select_times[data_node] = data_node.axes_num
    
    for node1 in CompositeState.uncondition_nodes:
        for node2 in CompositeState.uncondition_nodes:
            if node1 != node2:
                CompositeState.uncondition_node_pairs_select_times[(node1.data_node, node2.data_node)] = 1
    
    CompositeState.edge_path = []

def get_vis_tree_score_new(vis_tree_dict: dict, history_score: dict, id: str) -> int:
    """
    Evaluates a visualization tree using the scoring model.
    
    This function only supports the "scoring_model" mode. It renders the visualization
    as a PNG image and passes it to the scoring model for evaluation.
    
    Args:
        vis_tree_dict: Dictionary representation of the visualization tree
        history_score: Cache of previously computed scores
        id: Unique identifier for the output image file
    
    Returns:
        int: The score of the visualization tree
    """
    key = json.dumps(vis_tree_dict, default=str, ensure_ascii=False)
    if key in history_score:
        score = history_score[key]
    else:
        try:
            response = post_render_request(vis_tree_dict)
            file_path = f'./scoring_model/output/{id}.png'
            if response.status_code == 200:
                svg_content = response.content
                cairosvg.svg2png(bytestring=svg_content, write_to=file_path)
                score = get_score(file_path)
            else:
                logger.error(f"Request failed, status code: {response.status_code}")
                score = 0
        except Exception as e:
            logger.error(f"Request failed, error: {e}")
            score = 0
    with open('./scoring_model/output/score.txt', 'a', encoding='utf-8') as f:
        f.write(f'{id}: {score}\n')
    return score

def get_vis_tree_score(all_vis_nodes: Set[VisNode], root: VisNode, history_score, task_info, mode="fast") -> int:
    """
    Calculate the score of the visualization tree using a three-part reward function:
    R(C) = w_cognitive ⋅ R_cognitive(C) + w_task ⋅ R_task(C) + w_aesthetic ⋅ R_aesthetic(C)

    Args:
        all_vis_nodes (Set[VisNode]): All nodes in the visualization composition tree
        root (VisNode): Root node of the visualization composition tree
        history_score: Cache of previously computed scores
        task_info: Task information used for relevance calculations
        mode: Scoring mode, either "fast" or "scoring_model"

    Returns:
        int: Score of the visualization tree
    """
    if len(all_vis_nodes) <= 1:
        return 0
    vis_tree_dict, addition_nodes = vis_tree_to_json(root)

    all_vis_nodes.update(addition_nodes)
    nodes_hash = {str(hash(node)): node for node in all_vis_nodes}
    key = json.dumps(vis_tree_dict, default=str, ensure_ascii=False)
    if key in history_score:
        return history_score[key]["score"]
    
    def _root(all_vis_nodes: Set[VisNode]) -> VisNode:
        for node in all_vis_nodes:
            if node.parent is None:
                return node
        return None
    
    root = _root(all_vis_nodes)
    # is_polar = root.composite_pattern == "stack" and (root.spatial_arrangement == "radial" or root.spatial_arrangement == "circular")
    is_polar = root.spatial_arrangement == "radial" or root.spatial_arrangement == "circular"
    
    # 权重配置
    w_task = 0.3       # 任务相关性权重
    w_cognitive = 0.5  # 认知负荷权重
    w_aesthetic = 0.2  # 美学权重
    
    # 默认分数
    r_cognitive = 0
    r_task = 0
    r_aesthetic = 0
    
    try:
        index = len(history_score)
        response = post_render_request(vis_tree_dict, accept_json=True)
        if response.status_code == 200:
            # Parse JSON response instead of treating it as raw SVG
            response_data = response.json()
            svg_content = response_data.get('svg', '')
            chart_config = response_data.get('chartConfigs', {})
            baseColorProportion = response_data.get('baseColorProportion', 0)
            annotation_proximity = response_data.get('proximity', None)
            if annotation_proximity is not None:
                layoutscorer.proximity = annotation_proximity.get('withinThreshold', False)
            for node_id in chart_config:
                if node_id in nodes_hash:
                    vis_node = nodes_hash[node_id]
                    vis_node.config = chart_config[node_id]
            # file_path = f'./scoring_model/output/output_{index}.png'
            # cairosvg.svg2png(bytestring=svg_content, write_to=file_path, background_color="white")
            if not is_polar:
                layoutscorer.update_config(all_vis_nodes)
                for vis_node in all_vis_nodes:
                    if vis_node.data_node.node_type == "all_union":
                        vis_node.layout.update_bbox(vis_node.config)
                    else:
                        vis_node.layout.update_bbox()
            else:
                layoutscorer.update_config_polar(all_vis_nodes)
            layoutscorer.set_color_proportion(baseColorProportion)

        else:
            return 0.0
    except Exception as e:
        logger.error(f"Request failed, error: {e}")
    layoutscorer.update(all_vis_nodes)
    layoutscorer.set_mode(root.composite_pattern)
        
    # 1. 认知负荷评分 (Cognitive Load)
    # 评估可视化的清晰度、布局组织性、信息编码的一致性
    proximity, compactness, convexity, information_imbalance = layoutscorer.calculate_layout_quality()
    
    # 1.1 空间组织 - 基于凸性和紧凑性
    convexity_score = convexity  
    compactness_score = compactness
    proximity_score = proximity
    # 1.2 Readability
    # 1.3 信息平衡度 - 基于信息分布与面积分布的KL散度
    # 将信息不平衡度转换为平衡度分数，值越高越好
    balance_score = math.exp(-information_imbalance) if information_imbalance < 10 else 0
    # Cognitive score
    r_cognitive = 0.2 * proximity_score + 0.3 * convexity_score + 0.3 * compactness_score + 0.2 * balance_score

    # 保存认知评分的各组成部分，以便后续在detailed_score中使用
    cognitive_components = {
        "convexity": convexity_score,
        "compactness": compactness_score,
        "proximity": proximity_score,
        "balance": balance_score
    }
        
    # 2. 任务相关性评分 (Task Relevance) - 使用子任务覆盖率
    # 评估可视化对给定任务的支持程度
    subtask_scores = { subtask: 0 for subtask in task_info['sub_tasks'] }
    for vis_node in all_vis_nodes:
        if len(vis_node.children) == 0 and vis_node.data_node and hasattr(vis_node.data_node.view_node, 'task_relevance'):
            node_subtask_scores = vis_node.data_node.view_node.task_relevance
            for subtask, score in node_subtask_scores.items():
                subtask_scores[subtask] = max(subtask_scores[subtask], score)
    # 计算子任务覆盖率
    if len(subtask_scores) > 0:
        r_task = sum(sub_task_score * sub_task[4] for sub_task, sub_task_score in subtask_scores.items())
        if any(score < 1e-3 for score in subtask_scores.values()):
            r_task = 0.0
    else:
        r_task = 0.0
        
    # 3. 美学评分 (Aesthetics)
    # 评估可视化的视觉吸引力和平衡性
    # 3.1 视觉一致性 - 基于使用的图表类型和复合模式
    chart_types = set()
    for vis_node in all_vis_nodes:
        if hasattr(vis_node, 'chart_type') and vis_node.chart_type:
            chart_types.add(vis_node.chart_type[0])
    
    # 视觉一致性 - 较多的图表类型变化更美观
    visual_consistency = 1.0 if len(chart_types) >= 3 else len(chart_types) / 3
    
    # 3.2 复杂度 - 适度的复杂性更美观
    node_count = len(all_vis_nodes)
    complexity_score = min(1.0, node_count / 5)
    r_aesthetic = (visual_consistency + complexity_score) / 2
    
    # In this version, we will use the scoring model after search to get the aesthetic score. 
    # If need to use the scoring model during the search, it is recommended to use the multi-threading or multi-processing to speed up the scoring process. 
    
    # 根据模式选择美学评分方法
    # if mode == "scoring_model" and 'file_path' in locals() and os.path.exists(file_path):
    #     # 使用大模型进行美学评分
    #     try:
    #         aesthetic_result = get_aesthetic_score(file_path)
    #         if isinstance(aesthetic_result, dict) and 'aesthetic_score' in aesthetic_result:
    #             r_aesthetic = aesthetic_result['aesthetic_score'] / 5.0
    #         else:
    #             r_aesthetic = (visual_consistency + complexity_score) / 2
    #     except Exception as e:
    #         print(f"Error getting model aesthetic score: {e}")
    #         r_aesthetic = (visual_consistency + complexity_score) / 2
    # else:
        # r_aesthetic = (visual_consistency + complexity_score) / 2
    # 计算综合评分
    score = round(w_cognitive * r_cognitive + w_task * r_task + w_aesthetic * r_aesthetic, 6)

    # 记录详细评分信息
    detailed_score = {
        "total": round(score, 6),
        "cognitive": round(r_cognitive, 6),
        "detailed_cognitive": {k: round(v, 6) for k, v in cognitive_components.items()},
        "task_relevance": round(r_task, 6),
        "aesthetic": round(r_aesthetic, 6),
        "weights": {
            "cognitive": w_cognitive,
            "task_relevance": w_task,
            "aesthetic": w_aesthetic
        }
    }
    
    # print(f"Visualization score details: {detailed_score}")
    
    # 在history_score中同时保存总分和详细评分
    history_score[key] = {
        "score": score,
        "detailed_score": detailed_score
    }
    return score

def vis_tree_to_json(root: VisNode, reward=None):
    def _split_node(vis_node: VisNode):
        if vis_node.data_node.node_type != "all_union":
            return []
        vis_node.composite_pattern = "repetition"
        if vis_node.parent.spatial_arrangement == "horizontal":
            vis_node.spatial_arrangement = "vertical"
        elif vis_node.parent.spatial_arrangement == "vertical":
            vis_node.spatial_arrangement = "horizontal"
        else:
            vis_node.spatial_arrangement = "irregular_tessellation"
        vis_node.spatial_distribution = vis_node.parent.spatial_distribution
        for child in vis_node.data_node.children:
            child_vis_node = CompositeState.data_node_to_vis_node[child]
            vis_node.children.append(child_vis_node)
            child_vis_node.parent = vis_node
        return vis_node.children
    vis_nodes = []
    addition_nodes = []
    def dfs(node: VisNode):
        vis_nodes.append(node)
        for child in node.children:
            dfs(child)

    if root is not None:
        dfs(root)
    
    if root.composite_pattern in ["coordinate", "annotation", "nesting"] or (root.composite_pattern == "linkage" and root.data_node.children[0].view_node.x_name != root.data_node.children[1].view_node.x_name):
        client_node = CompositeState.data_node_to_vis_node[root.data_node.children[1]]
        if client_node.data_node.node_type != "all_union":
            raise ValueError("The client node must be a all union node for coordinate visualization.")
        split_nodes = _split_node(client_node)
        vis_nodes += split_nodes
        addition_nodes += split_nodes
    vis_nodes_dict = {}
    if len(vis_nodes) == 1 and vis_nodes[0].data_node is None:
        return vis_nodes_dict
    for vis_node in vis_nodes:
        if vis_node.data_node.node_type == "data":
            view_node = vis_node.data_node.view_node
            x_data = view_node.X
            y_data = view_node.Y
            classes = view_node.groups
            if len(classes) > 0 and vis_node.chart_type[0] != 'link':
                condition = list(vis_node.data_node.conditions)[0].cond
                index = classes.index(condition[1])
                if condition[0] == 'eq':
                    y_data = [y_data[index]]
                elif condition[0] == 'ne':
                    if view_node.agg == 'cnt' or view_node.agg == 'sum':
                        y_data = [np.sum(np.delete(y_data, index, axis=0), axis=0).tolist()]
                    elif view_node.agg == 'avg':
                        y_data = [np.mean(np.delete(y_data, index, axis=0), axis=0).tolist()]
                if vis_node.chart_type[0] == 'scatter':
                    x_data = [x_data[index]]
            vis_nodes_dict[hash(vis_node)] = {}
            vis_nodes_dict[hash(vis_node)]["view"] = {
                "vis_type": "basic",
                "chart_type": vis_node.chart_type[0],
                "X": {"data": x_data, "name": view_node.x_name.lower() if view_node.x_name else None},
                "Y": {"data": y_data, "name": view_node.y_name.lower() if view_node.y_name else None},
                "conditions": [],
                "importance": vis_node.data_node.importance
            }
            if vis_node.chart_type[0] == "graph":
                vis_nodes_dict[hash(vis_node)]["view"]["X"] = {"data": [[_["source"] for _ in x_data["edges"]]], "name": view_node.x_name.lower() if view_node.x_name else None, "description": x_data["metadata"]["description"] if "metadata" in x_data and "description" in x_data["metadata"] else None}
                vis_nodes_dict[hash(vis_node)]["view"]["Y"] = {"data": [[_["target"] for _ in x_data["edges"]]], "name": view_node.x_name.lower() if view_node.x_name else None}
                vis_nodes_dict[hash(vis_node)]["view"]["extra_data"] = view_node.extra_data
            if vis_node.chart_type[0] == "link":
                vis_nodes_dict[hash(vis_node)]["view"]["label"] = classes
                vis_nodes_dict[hash(vis_node)]["view"]["label_name"] = view_node.group_by[0]
            for condition in vis_node.data_node.conditions:
                vis_nodes_dict[hash(vis_node)]["view"]["conditions"].append(
                    str(condition)
                )
        else:
            if vis_node.data_node.node_type in ["all_union", "two_union"] and len(vis_node.children) == 0:
                view_node = vis_node.data_node.view_node
                x_data = view_node.X
                y_data = view_node.Y
                classes = view_node.groups
                sg = ''
                if vis_node.chart_type[0] == 'bar':
                    sg = 'g'
                vis_nodes_dict[hash(vis_node)] = {
                    "operation": str(vis_node.data_node.operation),
                }
                vis_nodes_dict[hash(vis_node)]["view"] = {
                    "vis_type": "basic",
                    "chart_type": sg + vis_node.chart_type[0],
                    "X": {
                        "data": x_data,
                        "name": view_node.x_name.lower()
                    },
                    "Y": {
                        "data": y_data,
                        "name": view_node.y_name.lower()
                    },
                    "label": classes,
                    "label_name": vis_node.data_node.operation.column,
                    "importance": vis_node.data_node.importance
                }
            else:
                vis_nodes_dict[hash(vis_node)] = {
                    "vis_type": "composite",
                    "composite_pattern": vis_node.composite_pattern,
                    "spatial_arrangement": vis_node.spatial_arrangement,
                    "spatial_distribution": vis_node.spatial_distribution,
                    "children": [hash(child) for child in vis_node.children],
                    "operation": str(vis_node.data_node.operation),
                    "importance": vis_node.data_node.importance
                }
            
    if root is not None and hash(root) in vis_nodes_dict:
        vis_nodes_dict[hash(root)]["order_columns"] = CompositeState.tasks_info["order_columns"]
    # 如果提供了reward，将其添加到根节点对应的部分
    if reward is not None and root is not None and hash(root) in vis_nodes_dict:
        vis_nodes_dict[hash(root)]["reward"] = reward

    return vis_nodes_dict, addition_nodes
