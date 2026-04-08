#!/usr/bin/env python3
# -*- coding:utf-8 -*-

import os
import argparse
import json
import sys
import subprocess
from pathlib import Path
import numpy as np
import random

# Ensure `from search...` imports work when running `python main.py` inside `search/`.
SEARCH_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SEARCH_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# 在导入其他模块之前先配置logger
from search.logger_config import logger

np.random.seed(15)
random.seed(15)

from search.mcgs import run_mcgs
from search.data_composition import load_data_nodes_from_views, load_data_nodes_from_views_file, construct_data_composition_graph
from search.vis_composition import CompositeState, VisNode
from search.task_analyzer import TaskAnalyzer, TaskParser
from search.title_generator import generate_titles_for_top_visualizations
from search.utils import get_visualization_aesthetic_scores, render_visualizations, deduplication_history_score

available_views = None
OUTPUT_BASE_DIR = "."


def ensure_subtable_file(dataset_name: str, theme_index: int) -> tuple[str, str]:
    """Ensure required subtables pkl exists; auto-generate it if missing."""
    base_dir = Path(__file__).resolve().parent
    subtables_dir = base_dir / "LLMChart" / "subtables"
    filename = subtables_dir / f"{dataset_name}_{theme_index}.pkl"
    csv_file = base_dir / "LLMChart" / "HAIChart" / "datasets" / f"{dataset_name}.csv"

    if filename.exists():
        return str(filename), str(csv_file)

    if not csv_file.exists():
        raise FileNotFoundError(
            f"Missing dataset CSV: {csv_file}. Cannot auto-generate subtables."
        )

    extractor_script = base_dir / "LLMChart" / "extract_subtables.py"
    logger.warning(
        f"Missing subtable file: {filename}. Running extractor to generate subtables..."
    )

    cmd = [sys.executable, "-m", "search.LLMChart.extract_subtables", "--filename", str(csv_file)]
    try:
        subprocess.run(cmd, cwd=str(base_dir.parent), check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"Auto-generation failed with command: {' '.join(cmd)}"
        ) from exc

    if not filename.exists():
        available = sorted(subtables_dir.glob(f"{dataset_name}_*.pkl"))
        available_str = ", ".join([p.name for p in available[:10]]) if available else "none"
        raise FileNotFoundError(
            f"Expected subtable file not found after extraction: {filename}. "
            f"Available files: {available_str}"
        )

    logger.info(f"Auto-generated subtable file: {filename}")
    return str(filename), str(csv_file)

def init_composite_state(filename, mode, analysis_tasks, csv_file, task_weights=None):
    global available_views
    # Initialize CompositeState
    CompositeState.mode = mode
    CompositeState.data_node_to_vis_node = {}
    CompositeState.data_nodes = []
    CompositeState.uncondition_nodes = []
    CompositeState.join_nodes = []
    CompositeState.auxiliary_nodes = []
    CompositeState.edge_path = []
    # CompositeState.tasks_info = []

    if analysis_tasks and len(analysis_tasks) > 0 and not CompositeState.tasks_info:
        parser = TaskParser()
        sub_tasks, sub_task_embeddings = parser.parse(analysis_tasks, task_weights)
        CompositeState.tasks_info = {
            "sub_tasks": sub_tasks,
            "sub_task_embeddings": sub_task_embeddings,
        }

    if available_views is None:
        data_nodes, available_views = load_data_nodes_from_views_file(filename, CompositeState.tasks_info, filter=True)
    else:
        data_nodes = load_data_nodes_from_views(available_views, filter=True)
    data_nodes, uncondition_nodes, join_nodes, auxiliary_nodes = construct_data_composition_graph(data_nodes)
    
    # Deal with unconditional nodes, including all_union and two_union nodes (two_union: mirror; all_union: repetition)
    for uncondition_datanode in uncondition_nodes:
        # Move this view to the end of available views list with probability
        if uncondition_datanode.view_node in available_views and random.random() < 0.75:
            available_views.remove(uncondition_datanode.view_node)
            available_views.append(uncondition_datanode.view_node)
        vis_node = VisNode(uncondition_datanode)
        CompositeState.data_node_to_vis_node[uncondition_datanode] = vis_node
        CompositeState.uncondition_nodes.append(vis_node)
        if uncondition_datanode in data_nodes:
            CompositeState.data_nodes.append(vis_node)
            
    # Deal with data nodes (non-operation nodes)
    for data_node in data_nodes:
        if data_node not in uncondition_nodes:
            vis_node = VisNode(data_node)
            CompositeState.data_node_to_vis_node[data_node] = vis_node
            CompositeState.data_nodes.append(vis_node)
    
    # Deal with join nodes (column join: stack, coaxis(2 children); condition join: linkage, coordinate, annotation or nesting)
    for join_node in join_nodes:
        vis_node = VisNode(join_node)
        CompositeState.data_node_to_vis_node[join_node] = vis_node
        CompositeState.join_nodes.append(vis_node)
        
    for auxiliary_node in auxiliary_nodes:
        vis_node = VisNode(auxiliary_node)
        CompositeState.data_node_to_vis_node[auxiliary_node] = vis_node
        CompositeState.auxiliary_nodes.append(vis_node)

    CompositeState.uncondition_nodes_select_times = {node: node.axes_num for node in uncondition_nodes}
    CompositeState.uncondition_node_pairs_select_times = {(node1, node2): 1 for node1 in uncondition_nodes for node2 in uncondition_nodes if node1 != node2}
    return data_nodes, uncondition_nodes, join_nodes, auxiliary_nodes

def save_results(dataset_name, theme_index, history_score, top_n=50, generate_titles=False, output_dir="."):
    """保存可视化组合结果"""
    count = 0
    # 统一输出：vis_tree与图像都放在同一数据集目录下
    unified_output_dir = os.path.join(output_dir, dataset_name)
    os.makedirs(unified_output_dir, exist_ok=True)
    result_file = os.path.join(unified_output_dir, f'{dataset_name}_{theme_index}.json')
    
    logger.info(f"Saving results to {result_file}")
    
    # 清空文件内容后重新写入
    with open(result_file, "w", encoding='utf-8') as f:
        f.write("")
    
    # If history_score is already a list, no need to do anything, otherwise use current approach
    if isinstance(history_score, dict):
        sorted_history = sorted(history_score.items(), key=lambda item: item[1]["score"], reverse=True)
        sorted_history_top_n = sorted_history[:top_n]
    else:
        sorted_history_top_n = history_score[:top_n]
    if generate_titles:
        titles = generate_titles_for_top_visualizations(dataset_name, sorted_history_top_n)
    sorted_history_top_n_with_title = []
    for i, (k, v) in enumerate(sorted_history_top_n):
        score = v["score"]
        detailed_score = v["detailed_score"]
        
        if score >= 0:
            count += 1
            vis_tree_dict = json.loads(k)
            root_key = list(vis_tree_dict.keys())[0]
            if generate_titles:
                title_info = titles[i]
                vis_tree_dict[root_key]["title"] = title_info["title"]
                vis_tree_dict[root_key]["subtitle"] = title_info["subtitle"]
                vis_tree_dict[root_key]["topic"] = title_info["topic"]
            vis_tree_dict_str = json.dumps(vis_tree_dict, default=str, ensure_ascii=False)
            sorted_history_top_n_with_title.append((str(vis_tree_dict_str), v))
            vis_tree_dict[root_key]["reward"] = score
            vis_tree_dict[root_key]["detailed_score"] = detailed_score
            vis_tree_dict_str = json.dumps(vis_tree_dict, default=str, ensure_ascii=False)
            with open(result_file, "a", encoding='utf-8') as f:
                f.write(str(vis_tree_dict_str) + "\n")
    return sorted_history_top_n_with_title

def parse_arguments():
    parser = argparse.ArgumentParser(description='Composite Visualization Generator')
    parser.add_argument('--mode', '-m', default="fast", help='Choose the mode of scoring algorithm (scoring_model, fast)')
    parser.add_argument('--num_thread', '-t', default=1, type=int, help='Number of threads for parallel scoring')
    parser.add_argument('--dataset', '-d', default="olympics_2024", help='Name of the dataset being processed')
    parser.add_argument('--theme_index', '-i', default=0, type=int, help='Index of the theme to be processed')
    parser.add_argument('--tasks', '-a', default=[["trend", ["Region", "year"]], ["difference", ["Medal", "region"]],["distribution", ["sport", "region"]]], help='Analysis tasks to perform')
    parser.add_argument('--task-weights', '-w', default=None, help='Task weights as dict mapping task index to weight (e.g., [0.5, 0.5])')
    parser.add_argument('--task-relation', '-r', default="and", choices=["and", "or"], help='Relationship between tasks: "and" (all tasks together) or "or" (each task separately)')
    parser.add_argument('--generate-titles', '-g', action='store_true', default=False, help='Generate titles for visualizations')
    parser.add_argument('--top_n', '-n', default=15, type=int, help='Number of top visualizations to save')
    parser.add_argument('--output-dir', '-o', default='output_dir', help='Unified output root directory')
    parser.add_argument('--num_simulations', '-s', default=500, type=int, help='Number of simulations for MCGS')
    parser.add_argument('--num_mcgs', '-k', default=5, type=int, help='Number of MCGS rounds')
    parser.add_argument('--dedup', '-e', default='middle', choices=['hard', 'middle', 'easy'], help='Deduplication mode for history scores')
    return parser.parse_args()

def run_single_task(task, args, dataset_name, theme_index, filename, csv_file, task_index=None):
    """
    为单个任务运行完整的可视化生成流程

    Args:
        task: 单个分析任务
        args: 命令行参数
        dataset_name: 数据集名称
        theme_index: 主题索引
        filename: 数据文件路径
        csv_file: CSV文件路径
        task_index: 任务索引（用于区分不同任务的结果）

    Returns:
        生成的历史分数列表
    """
    global available_views

    # 重置状态
    available_views = None

    # 清空CompositeState
    CompositeState.history_score = {}
    CompositeState.tasks_info = []

    logger.info(f"Running task {task_index + 1 if task_index is not None else ''}: {task}")

    for mcgs_round in range(args.num_mcgs):
        data_nodes, union_nodes, join_nodes, auxiliary_nodes = init_composite_state(
            filename, args.mode, [task], csv_file=csv_file, task_weights=args.task_weights)

        run_mcgs(args.num_thread, simulation_count=int(args.num_simulations))
        if len(available_views) <= 1:
            logger.warning(f"No valid views found for task {task}. Skipping.")
            break
        logger.info(f"Task {task_index + 1 if task_index is not None else ''}, Round {mcgs_round + 1} finished.")

    # 处理结果
    scoring_model_top_n = args.top_n * 3 if args.mode == "scoring_model" else args.top_n
    sorted_history_score = sorted(CompositeState.history_score.items(), key=lambda item: item[1]["score"], reverse=True)
    sorted_history_score = [(k, v) for k, v in sorted_history_score if v.get("detailed_score", {}).get("task_relevance", 0) > 0 and v.get("detailed_score", {}).get("cognitive", 0) > 0]
    sorted_history_score = deduplication_history_score(sorted_history_score, args.dedup)

    return sorted_history_score[:scoring_model_top_n]

def merge_task_results(all_task_results, args):
    """
    合并多个任务的结果
    
    Args:
        all_task_results: 所有任务的结果列表
        args: 命令行参数
    
    Returns:
        合并后的结果列表
    """
    merged_results = []
    
    # 将所有任务的结果合并到一个列表中
    for task_results in all_task_results:
        merged_results.extend(task_results)
    # 按分数重新排序
    merged_results = sorted(merged_results, key=lambda item: item[1]["score"], reverse=True)
    merged_results = deduplication_history_score(merged_results, args.dedup)
    logger.info(f"Merged {len(merged_results)} unique results from all tasks")
    return merged_results

def main():
    global available_views
    args = parse_arguments()
    dataset_name = os.path.splitext(args.dataset)[0]
    theme_index = args.theme_index
    args.tasks = eval(str(args.tasks))
    if args.task_weights:
        args.task_weights = eval(str(args.task_weights))

    # 根据任务关系设置最终输出数量：and=5, or=5*任务数
    final_top_n = 5 if args.task_relation == "and" else 5 * len(args.tasks)
    
    # 设置全局输出目录
    global OUTPUT_BASE_DIR
    OUTPUT_BASE_DIR = args.output_dir
    os.makedirs(args.output_dir, exist_ok=True)
    
    # 清空 ./temp/result.out 文件
    if os.path.exists('./temp/result.out'):
        with open('./temp/result.out', 'w', encoding='utf-8') as f:
            f.write("")

    if args.mode == "scoring_model":
        os.makedirs('./scoring_model/output', exist_ok=True)
    sys.path.append(os.path.join(os.path.dirname(__file__), 'LLMChart'))
    filename, csv_file = ensure_subtable_file(dataset_name, theme_index)
    logger.info(f"Init composite state from {filename}")
    
    # 根据任务关系选择执行方式
    if args.task_relation == "or":
        # OR关系：每个任务单独运行
        logger.info(f"Running {len(args.tasks)} tasks separately with OR relationship")
        all_task_results = []
        
        for i, task in enumerate(args.tasks):
            task_results = run_single_task(task, args, dataset_name, theme_index, filename, csv_file, i)
            if task_results:
                all_task_results.append(task_results)
        
        # 合并所有任务的结果
        if all_task_results:
            merged_results = merge_task_results(all_task_results, args)
            scoring_model_top_n = final_top_n * 3 if args.mode == "scoring_model" else final_top_n
            history_score_top_n = merged_results[:scoring_model_top_n]
        else:
            logger.warning("No valid results from any task")
            history_score_top_n = []
            
    else:
        # AND关系：所有任务一起运行（原有逻辑）
        logger.info(f"Running {len(args.tasks)} tasks together with AND relationship")

        for _ in range(args.num_mcgs):
            data_nodes, union_nodes, join_nodes, auxiliary_nodes = init_composite_state(
                filename, args.mode, args.tasks, csv_file=csv_file, task_weights=args.task_weights)

            run_mcgs(args.num_thread, simulation_count=int(args.num_simulations))
            if len(available_views) <= 1:
                logger.warning("No valid views found for visualization composition. Exiting.")
                break
            logger.info(f"Round {_ + 1} finished.")

        scoring_model_top_n = final_top_n * 3 if args.mode == "scoring_model" else final_top_n
        sorted_history_score = sorted(CompositeState.history_score.items(), key=lambda item: item[1]["score"], reverse=True)
        sorted_history_score = [(k, v) for k, v in sorted_history_score if v.get("detailed_score", {}).get("task_relevance", 0) > 0 and v.get("detailed_score", {}).get("cognitive", 0) > 0]
        sorted_history_score = deduplication_history_score(sorted_history_score, args.dedup)
        history_score_top_n = sorted_history_score[:scoring_model_top_n]
    
    # 保存和渲染结果
    if history_score_top_n:
        history_score_top_n = save_results(dataset_name, theme_index, history_score_top_n, 
                                         len(history_score_top_n), args.generate_titles, args.output_dir)
        
        if args.mode == "scoring_model":
            logger.info("Getting aesthetic scores...")
            aesthetic_scores = get_visualization_aesthetic_scores(dataset_name, theme_index, len(history_score_top_n), args.output_dir)
            for i, (k, v) in enumerate(history_score_top_n):
                v['detailed_score']['aesthetic'] = aesthetic_scores.get(i, 0)
                v['score'] = np.sum([weight * v['detailed_score'][factor] for factor, weight in v['detailed_score']['weights'].items()])
            history_score_top_n = sorted(history_score_top_n, key=lambda item: item[1]["score"], reverse=True)
            save_results(dataset_name, theme_index, history_score_top_n, final_top_n, False, args.output_dir)
        
        render_visualizations(dataset_name, theme_index, final_top_n, args.output_dir)
        logger.info(f"Generated visualizations for dataset: {dataset_name}")
    else:
        logger.warning("No results to save or render")

if __name__ == '__main__':
    main()