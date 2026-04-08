import numpy as np
from typing import Optional
from scipy.stats import pearsonr
from scipy.special import kl_div

class LayoutElement:
    """
    布局元素类，包含边界框和邻居元素信息
    """
    
    def __init__(self, x: float, y: float, w: float, h: float):
        """
        初始化布局元素
        
        Args:
            x: 边界框的x坐标
            y: 边界框的y坐标  
            w: 边界框的宽度
            h: 边界框的高度
        """
        # 边界框坐标和尺寸
        self.x = x
        self.y = y
        self.width = w
        self.height = h
        
        # 邻居元素
        self.neighbor = {
            'left': None,      # 左邻居
            'right': None,     # 右邻居
            'top': None,       # 上邻居
            'bottom': None,    # 下邻居
            'inner': [],       # 内部元素
            'outer': []      # 外部元素
        }
        
        self.initialized = False
        
    def set_neighbor(self, direction: str, element: Optional['LayoutElement']) -> None:
        """
        设置邻居元素
        
        Args:
            direction: 方向 ('left', 'right', 'top', 'bottom', 'inner', 'outer')
            element: 邻居元素，可以为None
        """
        if direction in self.neighbor:
            if direction in ['inner', 'outer']:
                if element is not None:
                    self.neighbor[direction].append(element)
            else:
                self.neighbor[direction] = element
        else:
            raise ValueError(f"Invalid direction: {direction}")
    
    def get_neighbor(self, direction: str) -> Optional['LayoutElement']:
        """
        获取指定方向的邻居元素
        
        Args:
            direction: 方向 ('left', 'right', 'top', 'bottom', 'inner', 'outer')
            
        Returns:
            邻居元素，可能为None
        """
        if direction in self.neighbor:
            return self.neighbor[direction]
        else:
            raise ValueError(f"Invalid direction: {direction}")
    
    def get_neighbors(self) -> list:
        res = []
        for direction, element in self.neighbor.items():
            # if direction == 'outer':
            #     continue
            if element is not None:
                if direction in ['inner', 'outer']:
                    res.extend(element)
                else:
                    res.append(element)
        return res
    
    def get_bbox(self) -> dict:
        """
        获取边界框
        
        Returns:
            包含x, y, w, h的字典
        """
        return {
            'x': self.x,
            'y': self.y,
            'width': self.width,
            'height': self.height
        }
    
    def set_bbox(self, x: float, y: float, w: float, h: float) -> None:
        """
        设置边界框
        
        Args:
            x: 边界框的x坐标
            y: 边界框的y坐标
            w: 边界框的宽度
            h: 边界框的高度
        """
        self.x = x
        self.y = y
        self.width = w
        self.height = h
        self.initialized = True

    def get_center(self) -> tuple:
        """
        获取边界框的中心点坐标
        
        Returns:
            (center_x, center_y)
        """
        center_x = self.x + self.width / 2
        center_y = self.y + self.height / 2
        return (center_x, center_y)

    def update_bbox(self, config=None):
        if len(self.neighbor['inner']) > 0:
            min_x = min(inner_node.layout.x for inner_node in self.neighbor['inner'])
            min_y = min(inner_node.layout.y for inner_node in self.neighbor['inner'])
            max_x = max(inner_node.layout.x + inner_node.layout.width for inner_node in self.neighbor['inner'])
            max_y = max(inner_node.layout.y + inner_node.layout.height for inner_node in self.neighbor['inner'])
            if config and config.get('unionAxis'):
                display = config['unionAxis'].get('display', {})
                size = config['unionAxis'].get('size', 0)
                if 'left' in display:
                    min_x -= size
                if 'right' in display:
                    max_x += size
                if 'top' in display:
                    min_y -= size
                if 'bottom' in display:
                    max_y += size
            self.set_bbox(min_x, min_y, max_x - min_x, max_y - min_y)
        
    def __str__(self) -> str:
        """
        字符串表示
        """
        return f"LayoutElement(x={self.x}, y={self.y}, width={self.width}, height={self.height})"
    
    def __repr__(self) -> str:
        """
        对象表示
        """
        return self.__str__()
    

class LayoutScorer:
    """
    布局优化类，包含布局元素和优化方法
    """
    def __init__(self, vis_nodes):
        """
        初始化布局优化
        
        Args:
            vis_nodes: 可视化节点列表，默认为空
        """
        self.update(vis_nodes)
        self.polar = False
        self.mode = None
        self.proximity = None
        
    def set_mode(self, mode):
        self.mode = mode
        
    def set_color_proportion(self, proportion):
        self.color_proportion = proportion
    
    def update_config(self, vis_nodes):
        padding = 2
        for vis_node in vis_nodes:
            if hasattr(vis_node, 'config') and vis_node.config is not None:
                if 'rit_r' in vis_node.config and 'rit_cx' in vis_node.config and 'rit_cy' in vis_node.config:
                    r = vis_node.config['rit_r'] / np.sqrt(2)
                    cx = vis_node.config['rit_cx']
                    cy = vis_node.config['rit_cy']
                    vis_node.config['left'] = cx - r
                    vis_node.config['top'] = cy - r
                    vis_node.config['width'] = 2 * r
                    vis_node.config['height'] = 2 * r
                left_axis_size = 0
                right_axis_size = 0
                top_axis_size = 0
                bottom_axis_size = 0
                possible_axis = ['xAxis', 'yAxis', 'xAxis2', 'yAxis2']
                for axis in possible_axis:
                    if axis in vis_node.config:
                        if 'size' in vis_node.config[axis]:
                            display = vis_node.config[axis]['display']
                            if 'left' in display:
                                left_axis_size = vis_node.config[axis]['size']
                            if 'right' in display:
                                right_axis_size = vis_node.config[axis]['size']
                            if 'top' in display:
                                top_axis_size = vis_node.config[axis]['size']
                            if 'bottom' in display:
                                bottom_axis_size = vis_node.config[axis]['size']
                vis_node.layout.set_bbox(
                    vis_node.config['left'] - padding - left_axis_size,
                    vis_node.config['top'] - padding - top_axis_size,
                    vis_node.config['width'] + 2 * padding + left_axis_size + right_axis_size,
                    vis_node.config['height'] + 2 * padding + top_axis_size + bottom_axis_size
                )
                
    def update_config_polar(self, vis_nodes):
        self.polar = True
        innerRadius = float('inf')
        outerRadius = -float('inf')
        for vis_node in vis_nodes:
            if hasattr(vis_node, 'config') and vis_node.config is not None:
                innerRadius = min(innerRadius, vis_node.config['innerRadius'])
                outerRadius = max(outerRadius, vis_node.config['outerRadius'])
        radius = min((innerRadius + outerRadius) / 2, 250)
        
        for vis_node in vis_nodes:
            if hasattr(vis_node, 'config') and vis_node.config is not None:
                left = radius * vis_node.config['startAngle']
                width = radius * (vis_node.config['endAngle'] - vis_node.config['startAngle'])
                top = vis_node.config['outerRadius']
                height = vis_node.config['outerRadius'] - vis_node.config['innerRadius']
                vis_node.layout.set_bbox(left, top, width, height)
                vis_node.config["width"] = width
                vis_node.config["height"] = height
    
    def update(self, vis_nodes):
        """
        更新布局元素
        
        Args:
            vis_nodes: 可视化节点列表
        """
        self.vis_nodes = vis_nodes
        self.coordinate_system = 'cartesian'
        self.leaf_nodes = []
        self.uncondition_nodes = []
        self.join_nodes = []
        
        # 更新边界框
        self.bounding_box = {
            'x': float('inf'),
            'y': float('inf'),
            'width': 0,
            'height': 0
        }
        
        polar = any(x.parent is None and x.composite_pattern == "stack" and x.spatial_arrangement in ['radial', 'circular'] for x in vis_nodes)
        
        for vis_node in self.vis_nodes:
            if vis_node.spatial_arrangement:
                if vis_node.spatial_arrangement in ['circular', 'radial']:
                    self.coordinate_system = 'polar'
            if vis_node.is_leaf():
                self.leaf_nodes.append(vis_node)
            if len(vis_node.data_node.conditions) == 0 and not 'join' in vis_node.data_node.node_type:
                self.uncondition_nodes.append(vis_node)
            if 'join' in vis_node.data_node.node_type:
                self.join_nodes.append(vis_node)
        
            # 如果是 polar 的话，只对 leafNode 更新 root 的 bounding box
            if (not vis_node.is_leaf()) and polar:
                continue
            
            layout_element = vis_node.layout
            bbox = layout_element.get_bbox()
            self.bounding_box['x'] = min(self.bounding_box['x'], bbox['x'])
            self.bounding_box['y'] = min(self.bounding_box['y'], bbox['y'])
            self.bounding_box['width'] = max(self.bounding_box['width'], bbox['x'] + bbox['width'] - self.bounding_box['x'])
            self.bounding_box['height'] = max(self.bounding_box['height'], bbox['y'] + bbox['height'] - self.bounding_box['y'])
        
        # 计算重心 (center of gravity)
        self.center_of_gravity = self.calculate_center_of_gravity()
        
        # 计算几何中心 (geometric center)
        self.geometric_center = self.calculate_geometric_center()

    def calculate_center_of_gravity(self) -> tuple:
        """
        计算布局的重心 (center of gravity)
        
        重心计算公式：
        center_x = Σ(area_i * center_x_i) / Σ(area_i)
        center_y = Σ(area_i * center_y_i) / Σ(area_i)
        
        Returns:
            (center_x, center_y): 重心坐标
        """
        if len(self.leaf_nodes) == 0:
            # 如果没有叶节点，返回边界框的几何中心
            return (
                self.bounding_box['x'] + self.bounding_box['width'] / 2,
                self.bounding_box['y'] + self.bounding_box['height'] / 2
            )
        
        total_weighted_x = 0
        total_weighted_y = 0
        total_area = 0
        
        for vis_node in self.leaf_nodes:
            if vis_node.chart_type in ['map']:
                continue
            bbox = vis_node.layout.get_bbox()
            
            # 计算节点的面积
            area = bbox['width'] * bbox['height']
            
            # 计算节点的中心点
            node_center_x = bbox['x'] + bbox['width'] / 2
            node_center_y = bbox['y'] + bbox['height'] / 2
            
            # 累加加权坐标和面积
            total_weighted_x += area * node_center_x
            total_weighted_y += area * node_center_y
            total_area += area
        
        if total_area == 0:
            # 如果总面积为0，返回边界框的几何中心
            return (
                self.bounding_box['x'] + self.bounding_box['width'] / 2,
                self.bounding_box['y'] + self.bounding_box['height'] / 2
            )
        
        # 计算重心
        center_of_gravity_x = total_weighted_x / total_area
        center_of_gravity_y = total_weighted_y / total_area
        
        return (center_of_gravity_x, center_of_gravity_y)
    
    def calculate_geometric_center(self) -> tuple:
        """
        计算布局的几何中心 (geometric center)
        
        几何中心就是边界框的中心点
        
        Returns:
            (center_x, center_y): 几何中心坐标
        """
        return (
            self.bounding_box['x'] + self.bounding_box['width'] / 2,
            self.bounding_box['y'] + self.bounding_box['height'] / 2
        )
    
    def calculate_data_redundancy(self):
        """
        计算数据列的重复性
        """
        column_to_vis_nodes = {}
        redundancy_count = 0
        redundancy_count2 = 0
        data_redundancy = 0
        for vis_node in self.uncondition_nodes:
            for data_column in vis_node.data_node.columns:
                column = data_column.column
                if column not in column_to_vis_nodes:
                    column_to_vis_nodes[column] = set()
                column_to_vis_nodes[column].add(vis_node)
        for column, vis_nodes in column_to_vis_nodes.items():
            if len(vis_nodes) > 1:
                redundancy_count += len(vis_nodes) * (len(vis_nodes) - 1)
        for vis_node in self.join_nodes:
            redundancy_count2 += len(vis_node.children) * (len(vis_node.children) - 1)
        column_redundancy = redundancy_count2 / redundancy_count if redundancy_count > 0 else 1.0
        for vis_node in self.uncondition_nodes:
            if vis_node.data_node.node_type in ['all_union', 'two_union'] and len(vis_node.children) > 0:
                all_Y = vis_node.data_node.view_node.Y
                for i in range(len(all_Y)):
                    for j in range(i + 1, len(all_Y)):
                        r = pearsonr(all_Y[i], all_Y[j])[0] ** 2
                        data_redundancy = max(data_redundancy, r)
        return column_redundancy, data_redundancy
        
    def calculate_information_balance(self):
        """
        计算信息平衡度，使用KL散度衡量信息量分布与面积分布之间的差异
        
        信息量：使用data_node.view_node.Y中所有项的个数作为衡量标准
        面积分布：每个叶节点占据的面积比例
        
        返回：
            information_imbalance: KL散度，值越小表示信息分布与面积分布越接近
        """
        if len(self.leaf_nodes) <= 1:
            return 0.0  # 只有一个或没有元素时，认为完全平衡
        
        # 计算每个叶节点的信息量
        information_counts = []
        areas = []
        valid_nodes = []
        
        for node in self.leaf_nodes:
            # 计算Y中所有项的个数作为信息量
            y_data = node.data_node.view_node.Y
            if len(node.data_node.conditions) > 0:
                cond_value = list(node.data_node.conditions)[0].cond[1]
                groups = node.data_node.view_node.groups
                index = groups.index(cond_value) if cond_value in groups else -1
                if index != -1:
                    if isinstance(y_data, list) and len(y_data) > 0:
                        y_data = y_data[index]
                    else:
                        continue
            if 'link' in node.chart_type:
                item_count = len(y_data) + len(y_data[0])
            else:
                if isinstance(y_data, list) and len(y_data) > 0:
                    item_count = 0
                    y_data_flat = []
                    if isinstance(y_data[0], list):
                        for sublist in y_data:
                            y_data_flat.extend(sublist)
                    else:
                        y_data_flat = y_data
                    if y_data_flat.count(0) > len(y_data_flat) / 4:
                        y_data_flat = [item for item in y_data_flat if item != 0]
                        
                    item_count = len(y_data_flat)
                else:
                    continue
            
            area = node.config['width'] * node.config['height']
            task_importance = 0.0
            if node.data_node.view_node.task_relevance:
                task_importance = sum(task[4] for task in node.data_node.view_node.task_relevance.keys())
            if item_count > 0 and area > 0:
                information_counts.append(item_count * task_importance)
                areas.append(area)
                valid_nodes.append(node)
        
        if len(valid_nodes) <= 1:
            return 0.0  # 如果有效节点不足，认为完全平衡
            
        # 归一化信息量和面积，使其分别成为概率分布
        total_information = sum(information_counts)
        total_area = sum(areas)
        
        if total_information == 0 or total_area == 0:
            return 0.0
            
        information_distribution = [count / total_information for count in information_counts]
        area_distribution = [area / total_area for area in areas]
        
        # 计算KL散度 (信息分布相对于面积分布)
        epsilon = 1e-10
        p = np.array(information_distribution) + epsilon
        q = np.array(area_distribution) + epsilon
        
        # 重新归一化
        p = p / np.sum(p)
        q = q / np.sum(q)
        
        kl_divergence = np.sum(kl_div(p, q))
        
        # 返回KL散度 (值越小表示分布越接近)
        return kl_divergence
        
    def calculate_compactness(self):
        """
        计算布局的紧凑性，同时考虑长宽比。
        该方法计算节点到重心的归一化欧几里得距离的平方的平均值。
        归一化因子是边界框的对角线长度。
        """
        width = self.bounding_box['width']
        height = self.bounding_box['height']
        if width == 0 or height == 0:
            return 1.0

        # 1. 计算归一化的“特征长度”的平方。
        # 这是一个代表布局整体尺度的统一值。
        diagonal_squared = min(width ** 2, height ** 2)

        total_normalized_distance = 0
        cg_x, cg_y = self.center_of_gravity

        for vis_node in self.leaf_nodes:
            if vis_node.chart_type in ['map']:
                continue
            layout_element = vis_node.layout
            center_x, center_y = layout_element.get_center()
            # 2. 计算节点中心到重心在x和y方向上的实际像素距离
            dx = center_x - cg_x
            if self.polar:
                dx = min(abs(center_x - cg_x), abs(center_x - (width - cg_x)))
            dy = center_y - cg_y
            # 3. 计算实际像素距离的平方 (欧几里得距离的平方)
            squared_distance_pixels = dx ** 2 + dy ** 2
            # 4. 用对角线长度的平方来归一化这个距离
            normalized_distance = squared_distance_pixels / diagonal_squared
            total_normalized_distance += normalized_distance
        avg_normalized_distance = total_normalized_distance / len(self.leaf_nodes)
        if self.mode == 'mirror':
            avg_normalized_distance *= 0.5 # 加上中间的文字节点后的结果
        compactness = np.exp(-np.sqrt(avg_normalized_distance))
        
        # 考虑长宽比的惩罚，使得过于狭长的布局得分降低
        # 只影响 cartesian 的情况，因为 polar 的本身就是圆周布局，紧凑性较好
        # if not self.polar:
        #     aspect_ratio = width / height if width <= height else height / width # (aspect_ratio < 1)
        #     compactness *= aspect_ratio**2
            
        #     if compactness < 0.5:
        #         compactness = 0.1
        return compactness

    def calculate_spatial_utilization(self) -> float:
        """
        计算空间利用率
        """
        total_area = self.bounding_box['width'] * self.bounding_box['height']
        occupied_area = 0
        
        for vis_node in self.uncondition_nodes:
            layout_element = vis_node.layout
            bbox = layout_element.get_bbox()
            occupied_area += bbox['width'] * bbox['height']
        
        if total_area > 0:
            return occupied_area / total_area
        else:
            return 0
        
    def calculate_symmetry(self) -> float:
        """
        计算布局的对称性，基于叶节点在以几何中心为原点的四象限中的面积分布
        
        计算方法：
        1. 计算每个象限中叶节点占用的总面积
        2. 比较对角象限面积比例，计算水平和垂直对称度
        3. 返回较大的对称度值
        """
        if len(self.leaf_nodes) <= 1:
            return 1.0  # 只有一个或没有元素时，认为是完全对称的
            
        # 获取几何中心坐标
        center_x, center_y = self.geometric_center
        
        # 四个象限的面积
        quadrant_areas = [0.0, 0.0, 0.0, 0.0]  # 第一、二、三、四象限
        
        # 计算每个叶节点在各个象限的面积贡献
        for node in self.leaf_nodes:
            bbox = node.layout.get_bbox()
            node_x1 = bbox['x']
            node_y1 = bbox['y']
            node_x2 = node_x1 + bbox['width']
            node_y2 = node_y1 + bbox['height']
            
            # 计算节点在每个象限的重叠面积
            
            # 第一象限 (右上): x > center_x, y < center_y
            if node_x2 > center_x and node_y1 < center_y:
                x_overlap = min(node_x2, self.bounding_box['x'] + self.bounding_box['width']) - max(center_x, node_x1)
                y_overlap = min(center_y, node_y2) - max(node_y1, self.bounding_box['y'])
                if x_overlap > 0 and y_overlap > 0:
                    quadrant_areas[0] += x_overlap * y_overlap
            
            # 第二象限 (左上): x < center_x, y < center_y
            if node_x1 < center_x and node_y1 < center_y:
                x_overlap = min(center_x, node_x2) - max(node_x1, self.bounding_box['x'])
                y_overlap = min(center_y, node_y2) - max(node_y1, self.bounding_box['y'])
                if x_overlap > 0 and y_overlap > 0:
                    quadrant_areas[1] += x_overlap * y_overlap
            
            # 第三象限 (左下): x < center_x, y > center_y
            if node_x1 < center_x and node_y2 > center_y:
                x_overlap = min(center_x, node_x2) - max(node_x1, self.bounding_box['x'])
                y_overlap = min(node_y2, self.bounding_box['y'] + self.bounding_box['height']) - max(center_y, node_y1)
                if x_overlap > 0 and y_overlap > 0:
                    quadrant_areas[2] += x_overlap * y_overlap
            
            # 第四象限 (右下): x > center_x, y > center_y
            if node_x2 > center_x and node_y2 > center_y:
                x_overlap = min(node_x2, self.bounding_box['x'] + self.bounding_box['width']) - max(center_x, node_x1)
                y_overlap = min(node_y2, self.bounding_box['y'] + self.bounding_box['height']) - max(center_y, node_y1)
                if x_overlap > 0 and y_overlap > 0:
                    quadrant_areas[3] += x_overlap * y_overlap
        
        # 计算总面积
        total_area = sum(quadrant_areas)
        
        if total_area == 0:
            return 1.0  # 避免除以零
        
        # 计算水平对称性 (第一+第四象限 vs 第二+第三象限)
        horizontal_ratio = min(
            (quadrant_areas[0] + quadrant_areas[3]) / total_area,
            (quadrant_areas[1] + quadrant_areas[2]) / total_area
        ) * 2  # *2 使其标准化到 [0,1] 范围
        
        # 计算垂直对称性 (第一+第二象限 vs 第三+第四象限)
        vertical_ratio = min(
            (quadrant_areas[0] + quadrant_areas[1]) / total_area,
            (quadrant_areas[2] + quadrant_areas[3]) / total_area
        ) * 2  # *2 使其标准化到 [0,1] 范围
        
        # 计算对角对称性 (第一+第三象限 vs 第二+第四象限)
        diagonal_ratio = min(
            (quadrant_areas[0] + quadrant_areas[2]) / total_area,
            (quadrant_areas[1] + quadrant_areas[3]) / total_area
        ) * 2  # *2 使其标准化到 [0,1] 范围
        
        # 返回三种对称性中的最大值
        return max(horizontal_ratio, vertical_ratio, diagonal_ratio)
    
    def calculate_proximity(self) -> float:
        """
        计算 proximity 约束分数（R_prox）。

        指标定义：
        R_prox = 1/|P| * Σ I[d(P) <= τ(P)]
        τ(P) = 0.5 * l(P)

        其中：
        - 对于显式层级模式（coordinate / annotation / nesting）：
          d(P) 为子组件到锚组件的最大空间距离，l(P) 为父组件包围盒短边。
        - 对于其他模式：
          d(P) 为组件间相邻间距（最近邻距离）的最大值，l(P) 为所有组件包围盒短边最小值。

        Returns:
            proximity 分数，范围为 [0, 1]。
        """
        if len(self.leaf_nodes) <= 1:
            return 1.0
        if self.mode in ['coordinate', 'nesting', 'coaxis', 'annotation']:
            return 1.0
        if self.mode in ['mirror']:
            return 1.0
        pattern_nodes = [
            node for node in self.vis_nodes
            if getattr(node, 'composite_pattern', None) and len(getattr(node, 'children', [])) > 0
        ]

        if not pattern_nodes:
            return self._calculate_non_hierarchical_proximity(self.uncondition_nodes)

        hierarchical_patterns = {'coordinate', 'annotation', 'nesting'}
        pattern_scores = []

        for pattern_node in pattern_nodes:
            pattern_name = getattr(pattern_node, 'composite_pattern', None)
            if pattern_name in hierarchical_patterns:
                score = self._calculate_hierarchical_proximity(pattern_node)
            else:
                score = self._calculate_non_hierarchical_proximity(pattern_node.children)
            pattern_scores.append(score)

        if not pattern_scores:
            return 1.0

        return sum(pattern_scores) / len(pattern_scores)

    def _is_spatial_component_valid(self, node) -> bool:
        chart_type = getattr(node, 'chart_type', None) or []
        if 'map' in chart_type or 'graph' in chart_type:
            return False
        if not hasattr(node, 'layout'):
            return False
        bbox = node.layout.get_bbox()
        return bbox['width'] > 0 and bbox['height'] > 0

    def _short_edge(self, node) -> float:
        bbox = node.layout.get_bbox()
        return min(bbox['width'], bbox['height'])

    def _collect_leaf_descendants(self, node):
        if node is None:
            return []
        if len(getattr(node, 'children', [])) == 0:
            return [node]

        descendants = []
        for child in node.children:
            descendants.extend(self._collect_leaf_descendants(child))
        return descendants

    def _calculate_hierarchical_proximity(self, pattern_node) -> float:
        children = getattr(pattern_node, 'children', [])
        if len(children) <= 1:
            return 1.0

        anchor_component = children[0]
        if not self._is_spatial_component_valid(anchor_component):
            return 1.0

        target_components = []
        for child in children[1:]:
            descendants = self._collect_leaf_descendants(child)
            if descendants:
                target_components.extend(descendants)
            else:
                target_components.append(child)

        target_components = [node for node in target_components if self._is_spatial_component_valid(node)]
        if not target_components:
            return 1.0

        d_p = max(self._calculate_distance_between_nodes(node, anchor_component) for node in target_components)
        l_p = self._short_edge(pattern_node)
        if l_p <= 0:
            return 1.0

        tau_p = 0.5 * l_p
        return 1.0 if d_p <= tau_p else 0.0

    def _calculate_non_hierarchical_proximity(self, components) -> float:
        valid_components = [node for node in components if self._is_spatial_component_valid(node)]
        if len(valid_components) <= 1:
            return 1.0

        l_p = min(self._short_edge(node) for node in valid_components)
        if l_p <= 0:
            return 1.0

        nearest_distances = []
        for i, node_i in enumerate(valid_components):
            nearest_distance = float('inf')
            for j, node_j in enumerate(valid_components):
                if i == j:
                    continue
                distance = self._calculate_distance_between_nodes(node_i, node_j)
                nearest_distance = min(nearest_distance, distance)
            if nearest_distance != float('inf'):
                nearest_distances.append(nearest_distance)

        if not nearest_distances:
            return 1.0

        d_p = max(nearest_distances)
        tau_p = 0.5 * l_p
        return 1.0 if d_p <= tau_p else 0.0

    def _calculate_distance_between_nodes(self, node1, node2) -> float:
        """
        计算两个节点之间的欧几里得距离
        
        Args:
            node1, node2: 要计算距离的两个节点
            
        Returns:
            欧几里得距离
        """
        bbox1 = node1.layout.get_bbox()
        bbox2 = node2.layout.get_bbox()
        
        # 计算两个边界框之间的最小距离
        # 水平距离
        if bbox1['x'] + bbox1['width'] < bbox2['x']:
            horizontal_distance = bbox2['x'] - (bbox1['x'] + bbox1['width'])
        elif bbox2['x'] + bbox2['width'] < bbox1['x']:
            horizontal_distance = bbox1['x'] - (bbox2['x'] + bbox2['width'])
        else:
            horizontal_distance = 0  # 有水平重叠
        if self.polar:
            horizontal_distance = horizontal_distance / 2
        # 垂直距离
        if bbox1['y'] + bbox1['height'] < bbox2['y']:
            vertical_distance = bbox2['y'] - (bbox1['y'] + bbox1['height'])
        elif bbox2['y'] + bbox2['height'] < bbox1['y']:
            vertical_distance = bbox1['y'] - (bbox2['y'] + bbox2['height'])
        else:
            vertical_distance = 0  # 有垂直重叠
        
        # 计算欧几里得距离
        distance = (horizontal_distance**2 + vertical_distance**2)**0.5
        return distance
    
    def _are_nodes_adjacent(self, node1, node2, threshold: float = 50.0) -> bool:
        """
        判断两个节点是否相邻
        
        Args:
            node1, node2: 要比较的两个节点
            threshold: 判断相邻的距离阈值
            
        Returns:
            bool: 如果两个节点相邻则返回True
        """
        if self.polar:
            threshold = threshold * 1.5

        distance = self._calculate_distance_between_nodes(node1, node2)

        return distance <= threshold
    
    def _calculate_intersection_over_union(self, node1, node2) -> float:
        """
        计算两个节点的交并比（IoU）
        
        Args:
            node1, node2: 要计算IoU的两个节点
            
        Returns:
            交并比值，范围为[0,1]
        """
        columns1 = node1.data_node.columns
        columns2 = node2.data_node.columns
        # 计算columns1和columns2的交集
        intersection = set(columns1) & set(columns2)
        # 计算并集
        union = set(columns1) | set(columns2)
        return len(intersection) / len(union) if union else 0

    def calculate_convexity(self) -> float:
        """
        计算布局的凸性（triple ratio convexity）
        
        计算方法：
        1. 将所有叶节点的中心两两连接
        2. 计算所有连接线段与图表区域相交的总长度
        3. 用总相交长度除以所有线段的总长度
        4. 返回整体的相交比例
        """
        if len(self.join_nodes) <= 1 and self.mode in ["coordinate", "nesting", "coaxis", "mirror"]:
            return 1.0
        
        # if len(self.uncondition_nodes) <= 2 and self.mode in ["stack"]:
            # return 1.0
        total_intersection_length = 0.0
        total_line_length = 0.0
        
        # 遍历所有叶节点对
        for i in range(len(self.leaf_nodes)):
            for j in range(i + 1, len(self.leaf_nodes)):
                node1 = self.leaf_nodes[i]
                node2 = self.leaf_nodes[j]
                
                # 获取两个节点的中心点
                center1_x, center1_y = node1.layout.get_center()
                center2_x, center2_y = node2.layout.get_center()
                
                # 计算连接线段与所有图表区域的相交长度
                intersection_length = self._calculate_line_intersection_with_charts(
                    center1_x, center1_y, center2_x, center2_y
                )
                
                # 计算线段长度
                line_length = ((center2_x - center1_x) ** 2 + (center2_y - center1_y) ** 2) ** 0.5
                
                # 累加总相交长度和总线段长度
                total_intersection_length += intersection_length
                total_line_length += line_length
        
        if total_line_length == 0:
            return 1.0
        
        # 返回总相交长度与总线段长度的比例
        return total_intersection_length / total_line_length
    
    def _calculate_line_intersection_with_charts(self, x1: float, y1: float, x2: float, y2: float) -> float:
        """
        计算线段与所有图表区域的相交长度（避免重复计算）
        
        Args:
            x1, y1: 线段起点坐标
            x2, y2: 线段终点坐标
            
        Returns:
            相交的总长度（去除重叠部分）
        """
        # 收集所有相交区间
        intersection_intervals = []
        
        # 遍历所有叶节点（图表）
        for node in self.leaf_nodes:
            bbox = node.layout.get_bbox()
            
            # 计算线段与矩形的相交区间
            intervals = self._line_rectangle_intersection_intervals(
                x1, y1, x2, y2, 
                bbox['x'], bbox['y'], 
                bbox['x'] + bbox['width'], bbox['y'] + bbox['height']
            )
            
            intersection_intervals.extend(intervals)
        
        # 合并重叠区间
        merged_intervals = self._merge_intervals(intersection_intervals)
        
        # 计算合并后区间的总长度
        total_length = 0.0
        line_length = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        
        for start, end in merged_intervals:
            total_length += (end - start) * line_length
        
        return total_length
    
    def _line_rectangle_intersection_intervals(self, x1: float, y1: float, x2: float, y2: float,
                                              rect_x1: float, rect_y1: float, rect_x2: float, rect_y2: float) -> list:
        """
        计算线段与矩形的相交区间（以参数t表示）
        
        Args:
            x1, y1: 线段起点
            x2, y2: 线段终点
            rect_x1, rect_y1: 矩形左上角
            rect_x2, rect_y2: 矩形右下角
            
        Returns:
            相交区间列表，每个区间为(t_start, t_end)
        """
        # 使用参数方程表示线段: P(t) = (x1, y1) + t * (x2-x1, y2-y1), t ∈ [0, 1]
        dx = x2 - x1
        dy = y2 - y1
        
        if abs(dx) < 1e-10 and abs(dy) < 1e-10:
            # 线段长度为0
            return []
        
        # 计算线段与矩形四条边的交点参数t
        t_values = []
        
        # 与左边界的交点 (x = rect_x1)
        if abs(dx) > 1e-10:
            t = (rect_x1 - x1) / dx
            if 0 <= t <= 1:
                y_at_t = y1 + t * dy
                if rect_y1 <= y_at_t <= rect_y2:
                    t_values.append(t)
        
        # 与右边界的交点 (x = rect_x2)
        if abs(dx) > 1e-10:
            t = (rect_x2 - x1) / dx
            if 0 <= t <= 1:
                y_at_t = y1 + t * dy
                if rect_y1 <= y_at_t <= rect_y2:
                    t_values.append(t)
        
        # 与上边界的交点 (y = rect_y1)
        if abs(dy) > 1e-10:
            t = (rect_y1 - y1) / dy
            if 0 <= t <= 1:
                x_at_t = x1 + t * dx
                if rect_x1 <= x_at_t <= rect_x2:
                    t_values.append(t)
        
        # 与下边界的交点 (y = rect_y2)
        if abs(dy) > 1e-10:
            t = (rect_y2 - y1) / dy
            if 0 <= t <= 1:
                x_at_t = x1 + t * dx
                if rect_x1 <= x_at_t <= rect_x2:
                    t_values.append(t)
        
        # 检查线段端点是否在矩形内
        if rect_x1 <= x1 <= rect_x2 and rect_y1 <= y1 <= rect_y2:
            t_values.append(0.0)
        if rect_x1 <= x2 <= rect_x2 and rect_y1 <= y2 <= rect_y2:
            t_values.append(1.0)
        
        if len(t_values) < 2:
            return []
        
        # 去重并排序
        t_values = sorted(list(set(t_values)))
        
        # 构建相交区间
        intervals = []
        for i in range(0, len(t_values) - 1, 2):
            if i + 1 < len(t_values):
                intervals.append((t_values[i], t_values[i + 1]))
        
        return intervals
    
    def _merge_intervals(self, intervals: list) -> list:
        """
        合并重叠的区间
        
        Args:
            intervals: 区间列表，每个区间为(start, end)
            
        Returns:
            合并后的区间列表
        """
        if not intervals:
            return []
        
        # 按起始点排序
        intervals.sort(key=lambda x: x[0])
        
        merged = [intervals[0]]
        
        for current in intervals[1:]:
            last = merged[-1]
            
            # 如果当前区间与上一个区间重叠或相邻，合并它们
            if current[0] <= last[1]:
                merged[-1] = (last[0], max(last[1], current[1]))
            else:
                merged.append(current)
        
        return merged
    
    def calculate_overlap(self) -> float:
        """
        计算布局元素之间的重叠度
        
        重叠度计算方法：
        1. 遍历所有叶节点，计算每对节点的重叠面积
        2. 累加所有重叠面积
        3. 用总重叠面积除以所有叶节点的总面积，得到重叠度
        """
        if len(self.leaf_nodes) <= 1:
            return 0.0
        if not ((len(self.join_nodes) == 1 and self.join_nodes[0].composite_pattern in ['coordinate', 'annotation']) or len(self.join_nodes) > 1):
            return 0.0
        
        total_overlap = 0.0
        max_allowed_area = 200.0
        nodes = []
        if (len(self.join_nodes) == 1 and self.join_nodes[0].composite_pattern in ['coordinate', 'annotation']):
            nodes = self.leaf_nodes
        else:
            nodes = self.uncondition_nodes
        for i in range(len(nodes)):
            if 'map' in nodes[i].chart_type or 'graph' in nodes[i].chart_type:
                continue
            for j in range(i + 1, len(nodes)):
                if 'map' in nodes[j].chart_type or 'graph' in nodes[j].chart_type:
                    continue
                overlap = self._calculate_area_overlap(nodes[i], nodes[j])
                total_overlap += overlap

        # 计算所有叶节点的总面积
        # for node in self.leaf_nodes:
        #     if 'map' in node.chart_type or 'graph' in node.chart_type:
        #         continue
        #     max_area = max(max_area, node.layout.width * node.layout.height)

        return total_overlap / max_allowed_area

    def _calculate_area_overlap(self, node1, node2):
        bbox1 = node1.layout.get_bbox()
        bbox2 = node2.layout.get_bbox()
        
        # 计算两个矩形的边界
        # 相交区域的左边界是两个矩形左边界的较大值
        intersect_left = max(bbox1['x'], bbox2['x'])
        # 相交区域的上边界是两个矩形上边界的较大值
        intersect_top = max(bbox1['y'], bbox2['y'])
        # 相交区域的右边界是两个矩形右边界的较小值
        intersect_right = min(bbox1['x'] + bbox1['width'], bbox2['x'] + bbox2['width'])
        # 相交区域的下边界是两个矩形下边界的较小值
        intersect_bottom = min(bbox1['y'] + bbox1['height'], bbox2['y'] + bbox2['height'])

        # 计算相交面积
        intersect_width = max(0, intersect_right - intersect_left)
        intersect_height = max(0, intersect_bottom - intersect_top)
        overlap_area = intersect_width * intersect_height

        return overlap_area

    def check_polar_angle_penalty(self) -> bool:
        """
        检查极坐标系统中是否存在角度范围过大的叶节点
        
        对于极坐标系统，如果存在 endAngle - startAngle > 2π/3 + ε 的叶节点，
        则应该进行惩罚。饼图（pie chart）不受此限制影响。
        
        Returns:
            bool: 如果需要惩罚则返回True，否则返回False
        """
        if self.coordinate_system != 'polar' or self.mode in ['mirror', 'coordinate', 'annotation', 'nesting']:
            return False
            
        import math

        # 限制为 3π/5 + ε，实际上防止出现stack只有两半圆的情况（可读性差）
        epsilon = 0.001
        angle_limit = 3 * math.pi / 5 + epsilon
        
        for vis_node in self.leaf_nodes:
            # 排除饼图（pie chart）
            if hasattr(vis_node, 'chart_type') and vis_node.chart_type and 'pie' in vis_node.chart_type:
                continue
                
            if hasattr(vis_node, 'config') and vis_node.config is not None:
                if 'startAngle' in vis_node.config and 'endAngle' in vis_node.config:
                    start_angle = vis_node.config['startAngle']
                    end_angle = vis_node.config['endAngle']
                    
                    # 计算角度差，考虑角度可能跨越0度的情况
                    angle_diff = end_angle - start_angle
                    
                    # 标准化角度差到 [0, 2π] 范围
                    while angle_diff < 0:
                        angle_diff += 2 * math.pi
                    while angle_diff > 2 * math.pi:
                        angle_diff -= 2 * math.pi
                    
                    # 如果角度范围超过 2π/3 + ε，需要惩罚
                    if angle_diff > angle_limit:
                        return True
        
        return False

    def calculate_layout_quality(self):
        """
        计算布局质量，综合考虑紧凑性、凸性和信息平衡度
        
        返回：
            proximity: 相邻节点的接近度，值越大表示越接近
            compactness: 紧凑性指标，值越小表示越紧凑
            convexity: 凸性指标，值越大表示越凸
            information_imbalance: 信息不平衡度，值越小表示分布越平衡
        """
        overlap = self.calculate_overlap()
        polar_angle_penalty = self.check_polar_angle_penalty()
        if self.proximity == True:
            proximity = 1.0
        else:
            proximity = self.calculate_proximity()
        compactness = self.calculate_compactness()
        convexity = self.calculate_convexity()
        information_imbalance = self.calculate_information_balance()
        
        # 检查常规惩罚条件
        if self.bounding_box['width'] > 3000 or self.bounding_box['height'] > 3000 or overlap > 1.0 or polar_angle_penalty:
            return 0.0, 0.0, 0.0, 10.0
        
        if self.check_polar_angle_penalty():
            return 0.0, 0.0, 0.0, 10.0
        
        if self.color_proportion > 0.5:
            return 0.0, 0.0, 0.0, 10.0

        return proximity, compactness, convexity, information_imbalance

layoutscorer = LayoutScorer([])