import numpy as np
import pandas as pd
from search.utils import jsonize_data
from types import SimpleNamespace
import json
import os
import subprocess
import sys
import copy
from search.logger_config import logger

try:
    from search.datafact_generator.datafact_generator import preprocess_data, generate_datafacts
except ImportError as exc:
    raise ImportError(
        "Failed to import the in-repo datafact_generator package. "
        "Expected module: datafact_generator/datafact_generator.py"
    ) from exc

def sigmoid(x):
    """Sigmoid函数，用于将值映射到(0, 1)区间"""
    # 对x进行类型检查和处理，避免溢出
    if not isinstance(x, (int, float, np.number)) or np.isnan(x):
        return np.nan
    # 对过大的x值进行裁剪，防止np.exp溢出
    x = np.clip(x, -500, 500)
    return 1 / (1 + np.exp(-x))

def gini_coefficient(x):
    """计算一维数组的基尼系数"""
    x = np.asarray(x, dtype=np.float64)
    if np.amin(x) < 0:
        # Gini系数不适用于负值, 进行平移
        x -= np.amin(x)
    # 所有值都为0
    if np.sum(x) == 0:
        return 0
    # 排序
    x = np.sort(x)
    n = len(x)
    cumx = np.cumsum(x, dtype=np.float64)
    # 计算面积
    sum_of_xi = cumx[-1]
    lorentz_area = np.sum(cumx) / sum_of_xi
    # Gini = (Line of Equality Area - Lorentz Curve Area) / Line of Equality Area
    return (n + 1 - 2 * lorentz_area) / n

def _to_numeric_array(data):
    """一个健壮的函数，将输入转换为一维数值型numpy数组"""
    try:
        # 使用pandas来更好地处理混合类型和非数值数据
        return pd.to_numeric(pd.Series(data).values, errors='coerce')
    except:
        return np.array([], dtype=float)

def compute_fact_scores(node, fact_types=None):
    """
    计算数据节点的各项事实分数
    node 可以是 DataNode 或直接是 ViewNode
    返回: {fact_name: float, ...}
    """
    if hasattr(node, 'view_node'):
        view_node = node.view_node
        is_data_node = True
    else:
        view_node = node
        is_data_node = False
    
    if hasattr(view_node, 'chart') and view_node.chart in ['map', 'graph'] or not hasattr(view_node, 'Y') or not hasattr(view_node, 'X'):
        return {}
    
    x_data = view_node.X
    y_data = view_node.Y
    x_is_numeric = False
    if x_data is not None and len(x_data) > 0:
        first_val = x_data[0][0]
        if first_val is not None:
            if isinstance(first_val, (int, float)):
                x_is_numeric = True
            elif isinstance(first_val, str):
                try:
                    float(first_val)
                    x_is_numeric = True
                except ValueError:
                    x_is_numeric = False
    
    if is_data_node and hasattr(node, 'conditions') and len(node.conditions) > 0 and hasattr(view_node, 'groups') and len(view_node.groups) > 0 and (not hasattr(view_node, 'chart') or view_node.chart != 'link'):
        try:
            condition = list(node.conditions)[0].cond
            classes = view_node.groups
            index = classes.index(condition[1])
            
            if condition[0] == 'eq':
                # 等于条件：选择特定索引的数据
                y_data = [y_data[index]]
            elif condition[0] == 'ne':
                # 不等于条件：选择除特定索引外的所有数据
                if hasattr(view_node, 'agg'):
                    if view_node.agg == 'cnt' or view_node.agg == 'sum':
                        y_data = [np.sum(np.delete(y_data, index, axis=0), axis=0).tolist()]
                    elif view_node.agg == 'avg':
                        y_data = [np.mean(np.delete(y_data, index, axis=0), axis=0).tolist()]
                else:
                    # 没有聚合方式时，默认取所有其他行
                    y_data = np.delete(y_data, index, axis=0).tolist()
            
            # 对于散点图，调整X数据
            if hasattr(view_node, 'chart') and view_node.chart == 'scatter':
                x_data = [x_data[index]]
        except (ValueError, IndexError, AttributeError) as e:
            # 如果条件处理出错，打印警告但继续使用原始数据
            logger.warning(f"Warning: Error processing condition: {e}")
    
    data = SimpleNamespace(
        X=x_data, 
        Y=y_data, 
        chart=getattr(view_node, 'chart', 'unknown'),
        x_name=getattr(view_node, 'x_name', 'X'),
        y_name=getattr(view_node, 'y_name', 'Y'),
        groups=getattr(view_node, 'groups', []),
        group_by=getattr(view_node, 'group_by', []),
        x_type=getattr(view_node, 'x_type', 'unknown'),
        y_type=getattr(view_node, 'y_type', 'unknown')
    )
    jsonized_data = jsonize_data(data)
    processed_data = preprocess_data(jsonized_data)

    chart_type_to_not_facts = {
        'bar': ['proportion', 'correlation', 'trend'],
        'line': ['proportion', 'categorization', 'correlation', 'rank', 'distribution'],
        'scatter': ['proportion', 'categorization', 'rank', 'trend'],
        'pie': ['trend', 'distribution', 'extreme', 'correlation', 'value'],
        'link': ['value', 'difference', 'rank', 'outlier', 'trend', 'proportion', 'categorization']
    }

    # if data.chart == 'bar' and str(getattr(view_node, 'x_name', '')).lower() != 'year':
    #     chart_type_to_not_facts['bar'].append('trend')

    if "cnt(" not in view_node.y_name:
        chart_type_to_not_facts['bar'].append('categorization')

    supported_fact_types = ['value', 'trend', 'proportion', 'difference', 'correlation',
                            'extreme', 'outlier', 'distribution', 'rank', 'categorization']
    excluded_fact_types = set(chart_type_to_not_facts.get(data.chart, []))
    available_fact_types = [fact_type for fact_type in supported_fact_types if fact_type not in excluded_fact_types]

    if fact_types is not None:
        requested_fact_types = set()
        for fact_type in fact_types:
            requested_fact_types.add(fact_type)
        available_fact_types = [fact_type for fact_type in available_fact_types if fact_type in requested_fact_types]

    if len(available_fact_types) == 0:
        return {'datafacts': []}

    result = generate_datafacts(
        input_data=processed_data,
        input_path=None,
        fact_types=available_fact_types
    )
    if not result or 'datafacts' not in result:
        return {'datafacts': []}

    if data.chart == "pie":
        for datafact in result['datafacts']:
            if datafact['type'] == 'categorization':
                # copy a fact and change its type to proportion
                proportion_fact = copy.deepcopy(datafact)
                proportion_fact['type'] = 'proportion'
                result['datafacts'].append(proportion_fact)

    datafacts = []
    task_count = {}
    for fact in result['datafacts']:
        type = fact['type']
        if type not in task_count:
            task_count[type] = 0
        task_count[type] += 1
        if task_count[type] < 5:
            datafacts.append(fact)
    result['datafacts'] = datafacts
    return result
