#!/usr/bin/env python3
# -*- coding:utf-8 -*-
# author : Administrator
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
import json
from search.vis_composition import CompositeState, VisNode, clean_states, get_vis_tree_score_new
from search.utils import plot_line, plot_compostition_graph, plot_layout_diagram
from search.vis_layout import layoutscorer
from search.logger_config import logger

class MCGS:
    def __init__(self, history_score:dict, num_thread:int=8):
        self.empty_vis_node = VisNode(None)
        self.current_state = None
        self.num_thread = num_thread
        self.history_score = history_score
        self.total_vis_tree_nodes = 0
        self.completed_simulations = 0
        self.best_score = -float('inf')
        self.best_score_iteration = 0
        self.best_score_time = 0
        self.layout_qualities = []  # 记录每次模拟的布局质量
        self.compactness_values = []  # 记录紧凑性指标
        self.spatial_utilization_values = []  # 记录空间利用率指标
        self.data_redundancy_values = []  # 记录数据冗余度指标
        
        # 确保图表输出目录存在
        # import os
        # if not os.path.exists("visualization_diagrams"):
        #     os.makedirs("visualization_diagrams", exist_ok=True)

    def __str__(self):
        return "monte carlo graph search"

    @staticmethod
    def _count_real_vis_tree_nodes(state):
        return sum(1 for node in state.vis_tree_nodes if node.data_node is not None)

    def simulation(self, count):
        no_new_result_count = 0
        last_history_len = len(self.history_score)
        
        for iter_count in tqdm(range(count)):
            # Start from empty state
            self.current_state = CompositeState(self.empty_vis_node)
            if self.simulation_policy():  # Select an unexplored node for simulation prediction
                self.current_state.rollout()
                # if self.current_state.valid_vis_tree and self.current_state.vis_tree_nodes:
                #     # 绘制组合图
                #     print(len(self.history_score))
                #     plot_compostition_graph(set(self.current_state.vis_tree_nodes), f"visualization_diagrams/composition_graph_{iter_count}.png")
                #     # 绘制布局示意图
                #     plot_layout_diagram(self.current_state.root, f"visualization_diagrams/layout_diagram_{iter_count}.png")
            # if self.current_state.valid_vis_tree:
            #     layoutscorer.update(self.current_state.vis_tree_nodes)
            #     layout_result = layoutscorer.calculate_layout_quality()
                
            #     # 解包返回的详细结果
            #     layout_quality, compactness, spatial_utilization, data_redundancy = layout_result
                
            #     # 记录各项指标
            #     self.layout_qualities.append(layout_quality)
            #     self.compactness_values.append(compactness)
            #     self.spatial_utilization_values.append(spatial_utilization)
            #     self.data_redundancy_values.append(data_redundancy)
            
            self.current_state.update()  # Update the result and backpropagate
            self.total_vis_tree_nodes += self._count_real_vis_tree_nodes(self.current_state)
            self.completed_simulations += 1
            
            # Check if history_score has new items
            if last_history_len == len(self.history_score):
                no_new_result_count += 1
            else:
                no_new_result_count = 0
                last_history_len = len(self.history_score)
            
            clean_states()

    def simulation_batch(self, count):
        import time
        start_time = time.time()

        no_new_result_count = 0
        last_history_len = len(CompositeState.history_score)
        avg_score_list = []
        for iter in tqdm(range(count)):
            avg_score = 0
            info_list = [] # contains all the information that is needed for further update
            for _ in range(self.num_thread):
                self.current_state = CompositeState(self.empty_vis_node)
                if self.simulation_policy():
                    self.current_state.rollout()
                info = self.current_state.get_info()
                info_list.append(info)
                clean_states()

            # (1) get score for each current_state (parallel form)
            def compute_score(args):
                i, info = args
                vis_tree_dict = info['vis_tree_dict']
                score = get_vis_tree_score_new(vis_tree_dict, CompositeState.history_score, f'{iter}_{i}')
                info
                return i, score

            with ThreadPoolExecutor(max_workers=self.num_thread) as executor:
                future_to_index = {executor.submit(compute_score, (i, info)): i 
                                for i, info in enumerate(info_list)}
                
                # keep the original order
                for future in future_to_index:
                    i, score = future.result()
                    info_list[i]['score'] = score

            # (2) update CompositeState (backpropagate) and history_score (sequential form)
            best_score = -float('inf')
            best_info = None
            
            for i, info in enumerate(info_list):
                vis_tree_dict = info['vis_tree_dict']
                vis_tree_nodes = info['vis_tree_nodes']
                edge_info = info['edge_info']
                chosen_operation_nodes = info['chosen_operation_nodes']
                # if score is a int
                if isinstance(info['score'], int):
                    score = info['score']
                else:
                    score = info['score']['score']
                avg_score += score
                
                # 记录最高分的方案
                if score > best_score:
                    best_score = score
                    best_info = info
                    best_info['index'] = i

                for path in edge_info:
                    parent, child, design_space = path
                    parent.edges[child]['value'] += score
                    parent.edges[child]['visits'] += 1
                    parent.N += 1
                    parent.visited = True
                    if design_space:
                        child.update_operation_Q(score, design_space)

                key = json.dumps(vis_tree_dict, default=str, ensure_ascii=False)
                CompositeState.history_score[key] = score

                # Track best score
                if score > self.best_score:
                    self.best_score = score
                    self.best_score_iteration = iter * self.num_thread + i + 1
                    self.best_score_time = time.time() - start_time
                
            # # 为当前迭代中得分最高的方案绘制布局示意图
            # if best_info and 'vis_tree_nodes' in best_info and len(best_info['vis_tree_nodes']) > 0:
            #     # 找到根节点
            #     root = None
            #     for node in best_info['vis_tree_nodes']:
            #         if node.parent is None:
            #             root = node
            #             break
                
            #     if root:
            #         # 绘制布局示意图
            #         plot_layout_diagram(root, f"visualization_diagrams/batch_layout_diagram_{iter}_{best_info['index']}.png")

            avg_score_list.append(avg_score / self.num_thread)

            # (3) check improvement
            if last_history_len == len(CompositeState.history_score):
                no_new_result_count += 1
            else:
                no_new_result_count = 0
                last_history_len = len(CompositeState.history_score)
            
            if no_new_result_count >= 1000 / self.num_thread:
                break

        return avg_score_list
        
    def simulation_policy(self):
        while True:
            if not self.current_state.valid_vis_tree:
                break
            if self.current_state.is_full_expand():  # Attack unexplored items
                current_node = self.current_state.select(1.5)  # Root node selection is complete, continue from child node downwards
                if current_node == CompositeState.finish_node:
                    return False
            else:
                expand_node = self.current_state.expand()  # If the current node has unexplored options, select and return it, waiting for simulation
                if expand_node == CompositeState.finish_node:
                    return False
                return expand_node
        return True

    def exploring(self, simulation_count):
        self.current_node = None
        if self.num_thread == 1:
            self.simulation(simulation_count)
            
        # elif self.num_thread > 1:
            # avg_score_list = self.simulation_batch(count=simulation_count // self.num_thread)
            # plot_line(avg_score_list, 'visualization_diagrams/avg_score.png')
        else:
            raise ValueError(f"Invalid number of threads: {self.num_thread}")

def run_mcgs(num_thread=1, simulation_count=10000):
    """
    运行 Monte Carlo Graph Search 来生成可视化组合
    
    参数:
        num_thread: 用于并行评分的线程数
        
    返回:
        history_score: 评分历史字典
    """
    # 运行 Monte Carlo 图搜索
    mcgs = MCGS(CompositeState.history_score, num_thread)
    mcgs.exploring(simulation_count=simulation_count)

    logger.info(f"history_score length: {len(CompositeState.history_score)}")
    return CompositeState.history_score
