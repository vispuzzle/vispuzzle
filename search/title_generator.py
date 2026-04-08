#!/usr/bin/env python3
# -*- coding:utf-8 -*-

import os
import sys

# 添加LLMChart目录到路径
sys.path.append(os.path.join(os.path.dirname(__file__), 'LLMChart'))
import json
import time
from typing import List, Dict, Tuple
from search.LLMChart.utils_llm import ask_question_without_image, get_client
from search.logger_config import logger

def generate_batch_title_prompt(dataset_name: str, vis_tree_list: List[str]) -> str:
    """
    生成用于批量请求多个可视化组合标题和副标题的 prompt
    
    Args:
        vis_tree_list: 多个可视化树的JSON字符串列表
        
    Returns:
        str: 格式化的prompt
    """
    # 将所有可视化树格式化为带编号的字符串
    vis_trees_formatted = ""
    for i, vis_tree_str in enumerate(vis_tree_list):
        vis_tree_json = json.loads(vis_tree_str[0])
        for key, value in vis_tree_json.items():
            if value.get('view'):
                X = value['view'].get('X', [])
                Y = value['view'].get('Y', [])
                if value['view'].get('chart_type') == "map":
                    X = {k:v for k, v in X.items() if k != 'data'}
                    value['view']['X'] = X
                else:
                    x_data = X['data']
                    y_data = Y['data']
                    for j in range(len(x_data)):
                        if len(x_data[j]) > 100:
                            x_data[j] = x_data[j][:50] + ['...'] + x_data[j][-50:]
                    for j in range(len(y_data)):
                        if len(y_data[j]) > 100:
                            y_data[j] = y_data[j][:50] + ['...'] + y_data[j][-50:]
                    value['view']['X']['data'] = x_data
                    value['view']['Y']['data'] = y_data
        _vis_tree_str = str(vis_tree_json).replace("'", '"')
        vis_trees_formatted += f"\n## Visualization {i+1}:\n```\n{_vis_tree_str}\n```\n"

    prompt = f"""The following are visualizations related to "{dataset_name}." Please generate concise and informative titles, subtitles and topics for each of the following visualization compositions.

{vis_trees_formatted}

Each title should clearly express the main data insights and key findings from the visualization, and the subtitle should provide additional context or details.
Each topic shoule be one of the following: ['conflict, war and peace', 'sport', 'economy, business and finance', 'lifestyle and leisure', 'labour', 'society', 'arts, culture, entertainment and media', 'science and technology', 'politics and government', 'crime, law and justice', 'environment', 'human interest', 'health'].
Please follow these rules:
1. Titles should be concise, typically no more than 6 words
2. Subtitles can provide more details, but should also remain concise, and no more than 15 words
3. Focus exclusively on the data facts and insights, NOT on visualization layout aspects (e.g., avoid mentioning "mirror", "vertical", "horizontal", "layout" or similar terms)
4. Highlight significant patterns, trends, correlations, or comparisons revealed in the data
5. Use domain-specific terminology relevant to the data content, not visualization structure
6. Emphasize what the data is showing rather than how it is displayed

Please return all visualization titles, subtitles & topics in the following JSON format:
```json
[
  {{
    "id": 1,
    "title": "Title for the 1st visualization",
    "subtitle": "Subtitle for the 1st visualization",
    "topic": "Topic for the 1st visualization"
  }},
  {{
    "id": 2,
    "title": "Title for the 2nd visualization",
    "subtitle": "Subtitle for the 2nd visualization",
    "topic": "Topic for the 2nd visualization"
  }},
  ...
]
```

Return only the JSON formatted result, without any other explanations. Please ensure that the returned JSON result includes titles, subtitles & topics for all visualizations.
"""
    return prompt

def process_batch_with_retry(client, prompt: str, model_type: str, max_retries: int = 3) -> List[Dict]:
    """
    使用重试机制处理单个批次的标题生成请求
    
    Args:
        client: LLM客户端
        prompt: 提示词
        model_type: 模型类型
        max_retries: 最大重试次数
        
    Returns:
        List[Dict]: 解析后的标题信息列表
    """
    retry = 0
    while retry < max_retries:
        try:
            logger.info(f"Sending title generation request...")
            response = ask_question_without_image(client, prompt, model_type)
            
            # 解析JSON响应
            json_start = response.find('[')
            json_end = response.rfind(']') + 1
            if json_start != -1 and json_end != -1:
                json_str = response[json_start:json_end]
                try:
                    title_info_list = json.loads(json_str)
                    
                    # 验证返回的结果
                    if isinstance(title_info_list, list) and len(title_info_list) > 0:
                        logger.info(f"Successfully parsed {len(title_info_list)} titles")
                        return title_info_list
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse JSON response: {e}")
                    logger.error(f"Response content: {json_str[:500]}...")

            # 如果未成功解析，重试
            retry += 1
            logger.warning(f"Processing response failed, retry {retry}...")
            time.sleep(2)  # 避免请求过于频繁
        except Exception as e:
            logger.error(f"Request error: {e}")
            retry += 1
            time.sleep(2)
    
    return []  # 如果多次重试后仍然失败，返回空列表

def batch_generate_titles(dataset_name: str, vis_tree_list: List[str], max_retries: int = 3) -> List[Dict[str, str]]:
    """
    为多个可视化组合批量生成标题和副标题
    
    Args:
        vis_tree_list: 可视化树JSON字符串列表
        max_retries: 请求失败时最大重试次数
        
    Returns:
        List[Dict[str, str]]: 标题和副标题列表
    """
    client = get_client()
    model_type = 'gemini-2.5-flash'  # 或其他合适的模型类型
    results = []
    
    # 设置单个prompt的最大长度（字符数）
    MAX_PROMPT_LENGTH = 500000
    
    # 根据总数据量决定如何批量处理
    logger.info(f"Generating titles for {len(vis_tree_list)} visualization compositions...")
    
    if len(vis_tree_list) == 0:
        return []
    
    # 先尝试一次性处理所有可视化
    prompt = generate_batch_title_prompt(dataset_name, vis_tree_list)
    
    # 检查prompt长度
    if len(str(prompt)) <= MAX_PROMPT_LENGTH:
        # prompt长度在可接受范围内，一次性处理
        logger.info(f"Processing all {len(vis_tree_list)} visualizations in one batch")
        title_info_list = process_batch_with_retry(client, prompt, model_type, max_retries)
        
        # 处理结果
        if title_info_list:
            # 确保按照原始顺序排序（根据id字段）
            title_info_list.sort(key=lambda x: x.get('id', 0))
            
            # 提取标题和副标题
            for info in title_info_list:
                if 'title' in info and 'subtitle' in info and 'topic' in info:
                    results.append({
                        'title': info['title'],
                        'subtitle': info['subtitle'],
                        'topic': info['topic']
                    })
    else:
        logger.info(f"Prompt too large ({len(str(prompt))} chars), splitting into multiple batches")

        batch_size = int(len(vis_tree_list) / (len(str(prompt)) / MAX_PROMPT_LENGTH) + 1)

        # 分批处理
        for i in range(0, len(vis_tree_list), batch_size):
            batch = vis_tree_list[i:i+batch_size]
            logger.info(f"Processing batch {i//batch_size + 1}/{(len(vis_tree_list)+batch_size-1)//batch_size}: {len(batch)} visualizations")
            
            # 生成该批次的prompt
            batch_prompt = generate_batch_title_prompt(dataset_name, batch)
            
            # 处理该批次
            batch_results = process_batch_with_retry(client, batch_prompt, model_type, max_retries)
            
            # 如果成功获取结果
            if batch_results:
                # 确保按照原始顺序排序（根据id字段）
                batch_results.sort(key=lambda x: x.get('id', 0))
                
                # 提取标题和副标题，调整id以匹配全局索引
                for j, info in enumerate(batch_results):
                    if 'title' in info and 'subtitle' in info and 'topic' in info:
                        results.append({
                            'title': info['title'],
                            'subtitle': info['subtitle'],
                            'topic': info['topic']
                        })
            
            # 批次之间暂停一下，避免请求过于频繁
            if i + batch_size < len(vis_tree_list):
                time.sleep(1)
    
    # 如果结果数量不足，补充默认值
    if len(results) < len(vis_tree_list):
        logger.info(f"Insufficient results, adding {len(vis_tree_list) - len(results)} default titles")
        for i in range(len(results), len(vis_tree_list)):
            results.append({
                "title": f"Visualization Composition #{i+1}",
                "subtitle": "Automatically generated visualization",
                "topic": "unknown"
            })
    
    return results

def save_titles_with_vis_trees(dataset_name: str, theme_index: int, vis_trees_with_titles: List[Tuple[str, Dict[str, str]]]) -> str:
    """
    将可视化树和对应的标题一起保存到文件
    
    Args:
        dataset_name: 数据集名称
        theme_index: 主题索引
        vis_trees_with_titles: (可视化树字符串, 标题信息) 元组列表
        
    Returns:
        str: 保存的文件路径
    """
    os.makedirs('./results_with_titles', exist_ok=True)
    result_file = os.path.join('./results_with_titles', f'{dataset_name}_{theme_index}_with_titles.json')
    
    logger.info(f"Saving results with titles to {result_file}")
    
    # 清空文件内容后重新写入
    with open(result_file, "w", encoding='utf-8') as f:
        f.write("")
    
    for vis_tree_str, title_info in vis_trees_with_titles:
        # 解析可视化树字符串为对象
        vis_tree_obj = json.loads(vis_tree_str)
        
        # 将标题信息添加到可视化树的根节点
        root_key = list(vis_tree_obj.keys())[0]  # 获取根节点键
        vis_tree_obj[root_key]["title"] = title_info["title"]
        vis_tree_obj[root_key]["subtitle"] = title_info["subtitle"]
        vis_tree_obj[root_key]["topic"] = title_info["topic"]
        
        # 将带标题的可视化树保存到文件
        with open(result_file, "a", encoding='utf-8') as f:
            f.write(json.dumps(vis_tree_obj, ensure_ascii=False) + "\n")
    
    return result_file

def generate_titles_for_top_visualizations(dataset_name: str, vis_trees) -> List[Dict[str, str]]:
    """
    为数据集中排名靠前的可视化组合生成标题
    
    Args:
        dataset_name: 数据集名称
        vis_trees: 多个可视化树的JSON字符串列表
        
    Returns:
        List[Dict[str, str]]: 生成的标题和副标题列表
    """
    # 生成标题
    titles = batch_generate_titles(dataset_name, vis_trees)
    return titles

if __name__ == "__main__":
    # 测试代码
    dataset_name = "world"
    theme_index = 0
    titles = generate_titles_for_top_visualizations(dataset_name, theme_index)
    logger.info(f"Generated {len(titles)} titles")
    for i, title_info in enumerate(titles):
        logger.info(f"{i+1}. {title_info['title']} - {title_info['subtitle'] - {title_info['topic']}}")
