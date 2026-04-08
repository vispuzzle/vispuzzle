#!/usr/bin/env python3
# -*- coding:utf-8 -*-

import json
import os
import sys
import time
from typing import Dict, List, Any
import logging
import pandas as pd
# Add LLMChart directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'LLMChart'))
from search.LLMChart.utils_llm import ask_question_without_image, get_client
from search.extract_embedding import get_embedding
from search.logger_config import logger

class TaskParser:
    """
    Parse tasks from a text input
    """
    def __init__(self):
        self.insights = [
            "value",
            "difference",
            "proportion",
            "trend",
            "categorization",
            "distribution",
            "rank",
            "correlation",
            "association",
            "extreme",
            "outlier"
        ]
        
    def parse(self, tasks: List, task_weights):
        """
        Format: [['trend', ['country', 'year']], ['proportion', ['country']], ...]
        """
        insight_list = []
        description_list = []
        if task_weights and len(task_weights) == len(tasks):
            total_weight = sum(task_weights)
            if total_weight > 0:
                task_weights = [w / total_weight for w in task_weights]
            else:
                task_weights = [1 / len(task_weights) for _ in task_weights]
        else:
            task_weights = [1 / len(tasks) for _ in tasks]
        for task in tasks:
            insight_name = task[0].lower()
            columns = [col.lower() for col in task[1]]
            description = self.get_description(insight_name, columns)
            description_list.append(description)
            insight_list.append((insight_name, tuple(columns), (), description, task_weights[tasks.index(task)]))
        embeddings = get_embedding(description_list)
        return insight_list, embeddings
    
    def _should_drop_group_column(self, columns: List[str]) -> bool:
        if len(columns) < 3:
            return False
        group = columns[2].strip().lower()
        if not group:
            return True
        return any(group in (col or "").strip().lower() for col in columns[:2])

    def concat(self, columns: list[str]) -> str:
        if len(columns) == 0:
            return ""
        elif len(columns) == 1:
            return columns[0]
        elif len(columns) == 2:
            return f"{columns[0]} and {columns[1]}"
        elif len(columns) == 3:
            if self._should_drop_group_column(columns):
                return f"{columns[0]} and {columns[1]}"
            return f"{columns[0]} and {columns[1]} grouped by {columns[2]}"
        
    def value_nl(self, columns):
        return "Show data values for " + self.concat(columns)
    
    def difference_nl(self, columns):
        return "Compare differences for " + self.concat(columns)
    
    def proportion_nl(self, columns):
        return "Show proportions for " + self.concat(columns)
    
    def trend_nl(self, columns):
        if len(columns) == 1:
            return f"Show trends of {columns[0]}"
        elif len(columns) == 2:
            return f"Show trends of {columns[0]} over {columns[1]}"
        elif len(columns) == 3:
            base = f"Show trends of {columns[0]} over {columns[1]}"
            if self._should_drop_group_column(columns):
                return base
            return f"{base} grouped by {columns[2]}"
        else:
            logger.error("Trend requires 1, 2 or 3 columns")
            return ""
    
    def categorization_nl(self, columns):
        if len(columns) == 1:
            return f"Categorize data by {columns[0]}"
        elif len(columns) == 2:
            return f"Categorize {columns[0]} by {columns[1]}"
        elif len(columns) == 3:
            base = f"Categorize {columns[0]} by {columns[1]}"
            if self._should_drop_group_column(columns):
                return base
            return f"{base}, grouped by {columns[2]}"
        else:
            logger.error("Categorization requires 1, 2 or 3 columns")
            return ""
    
    def distribution_nl(self, columns):
        if len(columns) == 1:
            return f"Show distribution of {columns[0]}"
        elif len(columns) == 2:
            return f"Show distribution of {columns[0]} over {columns[1]}"
        elif len(columns) == 3:
            base = f"Show distribution of {columns[0]} over {columns[1]}"
            if self._should_drop_group_column(columns):
                return base
            return f"{base} grouped by {columns[2]}"
        else:
            logger.error("Distribution requires 1, 2 or 3 columns")
            return ""
    
    def rank_nl(self, columns):
        if len(columns) == 1:
            return f"Rank data by {columns[0]}"
        elif len(columns) == 2:
            return f"Rank data by {columns[0]} and {columns[1]}"
        elif len(columns) == 3:
            base = f"Rank data by {columns[0]} and {columns[1]}"
            if self._should_drop_group_column(columns):
                return base
            return f"{base}, grouped by {columns[2]}"
    
    def correlation_nl(self, columns):
        if len(columns) == 2 or len(columns) == 3:
            return f"Examine the relationship between {self.concat(columns)}"
        elif len(columns) == 1:
            return f"Examine the relationship between {columns[0]}(s)"

    def association_nl(self, columns):
        return self.correlation_nl(columns)
    
    def extreme_nl(self, columns):
        return f"Find extreme values in {self.concat(columns)}"
    
    def outlier_nl(self, columns):
        return f"Detect outliers in {self.concat(columns)}"
        
    def get_description(self, name: str, columns: List[str]) -> str:
        if name not in self.insights:
            logger.error(f"Unknown insight type: {name}")
            return ""
        func = getattr(self, f"{name}_nl", None)
        if func:
            return func(columns)
        return ""
    

class TaskAnalyzer:
    """
    Using large language models to analyze task requirements and get relevant data facts, weights, and combinations
    """
    
    def __init__(self, csv_file: str = None, model_type: str = "gemini-2.5-pro", max_retries: int = 3, use_cache: bool = True):
        """
        Initialize the task analyzer
        
        Args:
            csv_file: Path to CSV file containing data for analysis
            model_type: The model type to use
            max_retries: Maximum number of retry attempts
            use_cache: Whether to use cache for task analysis
        """
        self.model_type = model_type
        self.max_retries = max_retries
        self.client = get_client()
        self.use_cache = use_cache
        self.cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
        # read csv
        self.csv_data = None
        if csv_file:
            try:
                self.csv_data = pd.read_csv(csv_file)
                logger.info(f"Loaded CSV data from {csv_file}")
            except Exception as e:
                logger.error(f"Failed to load CSV file {csv_file}: {e}")
                self.csv_data = None
        
    def _get_cache_filename(self, task_name: str, task_description: str = "", prompt: str = "") -> str:
        """
        Get the cache filename for a task
        
        Args:
            task_name: Task name
            task_description: Task description (optional)
            prompt: The prompt used for analysis (optional)
            
        Returns:
            Cache filename
        """
        import hashlib
        # Create a hash of the task name, description, and prompt to use as the filename
        cache_key = task_name + (task_description or "") + (prompt or "")
        task_hash = hashlib.md5(cache_key.encode()).hexdigest()
        return os.path.join(self.cache_dir, f"task_{task_hash}.json")
    
    def _load_from_cache(self, cache_file: str) -> Dict[str, Any]:
        """
        Load task analysis result from cache
        
        Args:
            cache_file: Path to cache file
            
        Returns:
            Cached result or None if cache miss
        """
        if not self.use_cache or not os.path.exists(cache_file):
            return None
            
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cached_result = json.load(f)
                logger.info(f"Cache hit: loaded result from {cache_file}")
                return cached_result
        except Exception as e:
            logger.warning(f"Failed to load cache file {cache_file}: {e}")
            return None
    
    def _save_to_cache(self, cache_file: str, result: Dict[str, Any]) -> None:
        """
        Save task analysis result to cache
        
        Args:
            cache_file: Path to cache file
            result: Analysis result
        """
        if not self.use_cache:
            return
            
        try:
            # Ensure cache directory exists
            os.makedirs(os.path.dirname(cache_file), exist_ok=True)
            
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
                logger.info(f"Saved result to cache: {cache_file}")
        except Exception as e:
            logger.warning(f"Failed to save cache file {cache_file}: {e}")
    
    def analyze_task(self, task_name: str, task_description: str = "") -> Dict[str, Any]:
        """
        Analyze a single task to get relevant data facts and weights
        
        Args:
            task_name: Task name
            task_description: Task description (optional)
            
        Returns:
            Dictionary containing data facts, weights, and combinations
        """
        # Generate the prompt first
        prompt = self._create_analysis_prompt(task_name, task_description)
        
        # Check cache using task name, description, and prompt
        cache_file = self._get_cache_filename(task_name, task_description, prompt)
        cached_result = self._load_from_cache(cache_file)
        if cached_result is not None:
            return cached_result
            
        # Cache miss, use the already generated prompt
        
        retry = 0
        while retry < self.max_retries:
            try:
                logger.info(f"Sending analysis request for task: {task_name}")
                response = self._call_llm(prompt)
                result = self._parse_response(response)
                if result:
                    # Save result to cache
                    self._save_to_cache(cache_file, result)
                    return result
            except Exception as e:
                logger.error(f"Error analyzing task {task_name} (attempt {retry+1}): {e}")
                retry += 1
                time.sleep(2)  # Avoid frequent requests
        
        # If all retries fail, return fallback result
        logger.warning(f"All attempts failed for task {task_name}, using fallback result")
        fallback_result = self._get_fallback_result(task_name)
        # Save fallback result to cache too
        self._save_to_cache(cache_file, fallback_result)
        return fallback_result
    
    def analyze_tasks_batch(self, tasks: List[Dict[str, str]]) -> Dict[str, Dict[str, Any]]:
        """
        Batch analyze multiple tasks
        
        Args:
            tasks: List of tasks, each containing 'name' and 'description'
            
        Returns:
            Mapping from task name to analysis results
        """
        results = {}
        total_tasks = len(tasks)
        
        logger.info(f"Starting batch analysis of {total_tasks} tasks")
        
        for index, task in enumerate(tasks):
            task_name = task['name']
            task_description = task.get('description', '')
            
            logger.info(f"Processing task {index+1}/{total_tasks}: {task_name}")
            
            try:
                result = self.analyze_task(task_name, task_description)
                sub_tasks = []
                descriptions = []
                for sub_task in result['sub_tasks']:
                    # [df1, [c1], [], description, weight] -> (df1, (c1), (), description, weight)
                    sub_task = (sub_task[0], tuple(column.lower() for column in sub_task[1]), tuple(sub_task[2]), sub_task[3], sub_task[4] / total_tasks)
                    sub_tasks.append(sub_task)
                    descriptions.append(sub_task[3])
                embeddings = get_embedding(descriptions)
                result['sub_task_embeddings'] = embeddings
                result['sub_tasks'] = sub_tasks
                results[task_name] = result
                
                # Add a small delay between requests to avoid rate limiting
                if index < total_tasks - 1:
                    time.sleep(1)
                    
            except Exception as e:
                logger.error(f"Failed to analyze task {task_name}: {e}")
                # Use fallback result for this task
                results[task_name] = self._get_fallback_result(task_name)
        
        logger.info(f"Completed batch analysis of {total_tasks} tasks")
        return results
    
    def _create_analysis_prompt(self, task_name: str, task_description: str = "") -> str:
        """
        创建分析任务的提示词
        """
        task_description_text = f"Task description: {task_description}" if task_description else ""
        
        # 添加CSV数据的表头和前5行
        csv_data_text = ""
        if self.csv_data is not None:
            try:
                # 获取列名
                columns = list(self.csv_data.columns)
                # 获取前5行数据
                first_5_rows = self.csv_data.head(5).values.tolist()

                csv_data_text = "CSV Data Structure:\n"
                csv_data_text += f"Columns: {', '.join(columns)}\n"
                csv_data_text += "First 5 rows of data:\n"
                for i, row in enumerate(first_5_rows):
                    row_str = [str(val) for val in row]
                    csv_data_text += f"Row {i+1}: {', '.join(row_str)}\n"
            except Exception as e:
                logger.error(f"Error preparing CSV data for prompt: {e}")
                csv_data_text = "CSV data could not be processed.\n"
        
        prompt = f"""
As a data visualization expert, please analyze the following data analysis task and provide relevant data facts information.

Task name: {task_name}
{task_description_text}
{csv_data_text}

Available data fact types include:
- value: Magnitude or size of data values
- proportion: Part-to-whole relationships
- difference: Comparisons and contrasts between values
- distribution: Patterns of data spread or dispersion
- trend: Changes or patterns over time
- rank: Ordering or position relationships
- correlation: Relationships between variables
- extreme: Maximum or minimum values
- outlier: Unusual or anomalous values

Your task is to determine a list of high-confidence sub-tasks for analysis, ordered by importance (most important first). Each sub-task should be represented as a list with 5 elements:
[data_fact_type, column_names, column_values, description, weight]

Where:
1. data_fact_type is one of the available fact types listed above
2. column_names is a list of columns (no more than 2) being analyzed (or [] if the column is not restricted)
3. column_values is a list of specific values for each column (or [] if the values are not restricted)
4. description is a concise natural language description of the sub-task (e.g., "The count of medals by year shows an increasing trend")
5. weight is a float value between 0.0 and 1.0 indicating the importance/priority of this sub-task. The weights of all sub-tasks are required to sum to 1.0.

Examples:
- Task: "Analyze trends by region"
  Good: ["trend", ["Region"], [], "Analyze how values change across different regions", 1.0] - Region is the main subject
  Bad: ["trend", ["Year"], [], "Analyze how values change over time", 1.0] - Year is not the main subject being analyzed
  
- Task: "Check distribution"
  Good: ["distribution", [], [], "Examine the overall distribution pattern in the dataset", 1.0] - No specific column, applies to entire dataset
  Bad: ["distribution", ["Year"], [], "Check the distribution of years", 1.0] - The task does not refer to a specific column
  
- Task: "Analyze the sales and profit performance of each product line"
  Good: ["difference", ["Product Line", "Sales"], [], "Compare sales figures across different product lines", 0.5] - Primary comparison
  Good: ["correlation", ["Sales", "Profit"], [], "Examine the relationship between sales and profit values", 0.3] - Secondary analysis
  Good: ["value", ["Product Line", "Profit"], [], "Show profit magnitudes by product line", 0.2] - Supporting details

Please return the analysis results in the following JSON format:
```json
{{
    "sub_tasks": [
        ["fact_type1", [], [], "Description of sub_task1", 0.4],
        ["fact_type2", ["column_name2"], [], "Description of sub_task2", 0.3],
        ["fact_type3", ["column_name3"], ["value3"], "Description of sub_task3", 0.2],
        ["fact_type4", ["column_name4a", "column_name4b"], [], "Description of sub_task4", 0.1]
    ],
    "reasoning": "Explanation of why these sub-tasks were selected"
}}
```
Please return only the JSON format result without any additional text.
"""
        return prompt
    
    def _call_llm(self, prompt: str) -> str:
        """
        Call the large language model API
        """
        try:
            # Using LLMChart's utility function to call the model
            response = ask_question_without_image(self.client, prompt, self.model_type)
            return response
        except Exception as e:
            logger.error(f"Error calling LLM: {e}")
            raise
    
    def _parse_response(self, response: str) -> Dict[str, Any]:
        """
        解析大模型返回的结果
        """
        try:
            # 尝试从响应中提取JSON部分
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            if json_start != -1 and json_end != -1:
                response = response[json_start:json_end]
            result = json.loads(response)
            
            # 验证必要字段
            if "sub_tasks" not in result:
                raise ValueError("Missing required field: sub_tasks")
            
            sub_tasks = result["sub_tasks"]
            reasoning = result.get("reasoning", "")
            
            # 验证子任务格式
            validated_sub_tasks = []
            
            # 获取可用的列名，用于验证
            available_columns = []
            if self.csv_data is not None:
                try:
                    available_columns = list(self.csv_data.columns)
                    # 同时创建一个不区分大小写的映射，用于修正大小写问题
                    column_case_map = {col.lower(): col for col in available_columns}
                except:
                    pass
            
            for task in sub_tasks:
                fact_type = task[0]
                column_names = task[1]
                column_values = task[2]
                description = task[3]
                weight = task[4]
                valid_fact_types = ["value", "proportion", "difference", "distribution", "trend", 
                                   "rank", "correlation", "extreme", "categorization", "outlier"]
                if fact_type.lower() not in [f.lower() for f in valid_fact_types]:
                    logger.warning(f"Invalid fact type: {fact_type}")
                    continue
                
                fact_type = fact_type.lower()
                
                # 验证并修正列名大小写
                corrected_column_names = []
                for col_name in column_names:
                    if col_name and available_columns:
                        # 如果提供的列名不在可用列中，尝试修正大小写
                        if col_name not in available_columns and col_name.lower() in column_case_map:
                            corrected_column = column_case_map[col_name.lower()]
                            logger.info(f"Corrected column name from '{col_name}' to '{corrected_column}'")
                            corrected_column_names.append(corrected_column)
                        elif col_name not in available_columns:
                            logger.warning(f"Column '{col_name}' not found in dataset. Available columns: {available_columns}")
                            corrected_column_names.append(col_name)
                        else:
                            corrected_column_names.append(col_name)
                
                validated_sub_tasks.append([fact_type, corrected_column_names, column_values, description, weight])
            
            # 归一化权重，确保总和为1
            if validated_sub_tasks:
                total_weight = sum(task[4] for task in validated_sub_tasks)
                if total_weight > 0:
                    for task in validated_sub_tasks:
                        task[4] = task[4] / total_weight
                    logger.info(f"Normalized weights from total {total_weight:.3f} to 1.0")
                else:
                    weight_per_task = 1.0 / len(validated_sub_tasks)
                    for task in validated_sub_tasks:
                        task[4] = weight_per_task
                    logger.warning("All weights were 0, assigned equal weights")
            
            return {
                "sub_tasks": validated_sub_tasks,
                "reasoning": reasoning,
            }
            
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Failed to parse LLM response: {e}")
            # 尝试从响应中提取JSON部分
            return self._extract_json_from_text(response)
    
    def _extract_json_from_text(self, text: str) -> Dict[str, Any]:
        """
        从文本中提取JSON内容
        """
        import re
        
        # 尝试从响应中提取JSON部分
        json_pattern = r'\{[\s\S]*?\}'  # 非贪婪模式，匹配最小的完整JSON
        matches = re.findall(json_pattern, text)
        
        valid_tasks = []
        reasoning = ""
        
        # 首先尝试从完整JSON中提取
        for match in matches:
            try:
                result = json.loads(match)
                if "sub_tasks" in result and isinstance(result["sub_tasks"], list):
                    valid_tasks.extend(result["sub_tasks"])
                    if not reasoning and "reasoning" in result:
                        reasoning = result["reasoning"]
            except json.JSONDecodeError:
                continue
        
        # 如果找到了有效的子任务，返回结果
        if valid_tasks:
            return {
                "sub_tasks": valid_tasks,
                "reasoning": reasoning or "Extracted from JSON in response"
            }
        
        # 如果没有找到完整JSON，尝试直接提取子任务格式
        try:
            # 尝试寻找新格式的子任务列表模式 ["fact_type", ["column_name1", "column_name2"], []]
            # 这是一个复杂的正则表达式，可能需要根据实际响应调整
            tasks_pattern_new = r'\["([^"]+)",\s*\[(.*?)\],\s*\[(.*?)\]\]'
            task_matches_new = re.findall(tasks_pattern_new, text)
            
            if task_matches_new:
                sub_tasks = []
                for fact, cols_str, vals_str in task_matches_new:
                    # 提取列名列表
                    cols = []
                    if cols_str.strip():
                        # 匹配引号包围的字符串
                        cols_matches = re.findall(r'"([^"]*)"', cols_str)
                        cols = cols_matches if cols_matches else []
                    
                    # 提取值列表
                    vals = []
                    if vals_str.strip():
                        # 匹配引号包围的字符串
                        vals_matches = re.findall(r'"([^"]*)"', vals_str)
                        vals = vals_matches if vals_matches else []
                    
                    sub_tasks.append([fact, cols, vals, f"Analyze {fact} patterns", 0.5])  # 添加默认描述和权重
                
                # 归一化权重
                if sub_tasks:
                    weight_per_task = 1.0 / len(sub_tasks)
                    for task in sub_tasks:
                        if len(task) < 5:
                            task.append(weight_per_task)
                        else:
                            task[4] = weight_per_task
                
                return {
                    "sub_tasks": sub_tasks,
                    "reasoning": "Extracted from new format text patterns in response"
                }
        except Exception as e:
            logger.warning(f"Failed to extract new format tasks using regex: {e}")
            
        # 如果以上方法都失败，尝试提取fact_type，至少构建基础子任务
        try:
            # 尝试识别文本中提到的事实类型
            fact_types = ["value", "proportion", "difference", "distribution", "trend", 
                         "rank", "correlation", "extreme", "categorization", "outlier"]
            
            mentioned_facts = []
            for fact in fact_types:
                if re.search(r'\b' + fact + r'\b', text.lower()):
                    mentioned_facts.append(fact)
            
            if mentioned_facts:
                weight_per_task = 1.0 / len(mentioned_facts[:3])  # 限制最多3个
                sub_tasks = [[fact, [], [], f"Analyze {fact} patterns", weight_per_task] for fact in mentioned_facts[:3]]
                return {
                    "sub_tasks": sub_tasks,
                    "reasoning": "Extracted facts mentioned in response"
                }
        except Exception:
            pass
        
        # 如果都失败了，返回默认结果
        logger.warning("Could not extract valid sub-tasks from response, using fallback result")
        return {
            "sub_tasks": [["value", [], [], "Show data values", 0.6], ["difference", [], [], "Compare categories", 0.4]],
            "reasoning": "Default fallback result due to parsing failure"
        }
    
    def _get_fallback_result(self, task_name: str) -> Dict[str, Any]:
        """
        获取任务的后备结果（当大模型调用失败时使用）
        """
        fallback_mapping = {
            "compare_values_rank": {
                "sub_tasks": [
                    ["difference", [], [], "Compare values across categories", 0.5],
                    ["value", [], [], "Show value magnitudes", 0.3],
                    ["rank", [], [], "Display ranking information", 0.2]
                ],
                "reasoning": "Fallback result for comparison tasks"
            },
            "identify_outliers": {
                "sub_tasks": [
                    ["outlier", [], [], "Identify anomalous values", 0.5],
                    ["extreme", [], [], "Find maximum and minimum values", 0.3],
                    ["difference", [], [], "Compare outliers with normal values", 0.2]
                ],
                "reasoning": "Fallback result for outlier detection"
            },
            "characterize_distribution": {
                "sub_tasks": [
                    ["distribution", [], [], "Analyze data distribution patterns", 0.6],
                    ["rank", [], [], "Show value rankings", 0.25],
                    ["proportion", [], [], "Display proportional relationships", 0.15]
                ],
                "reasoning": "Fallback result for distribution analysis"
            },
            "part_to_whole": {
                "sub_tasks": [
                    ["proportion", [], [], "Show part-to-whole relationships", 1.0]
                ],
                "reasoning": "Fallback result for part-to-whole analysis"
            },
            "analyze_trends": {
                "sub_tasks": [
                    ["trend", [], [], "Analyze temporal or sequential trends", 1.0]
                ],
                "reasoning": "Fallback result for trend analysis"
            },
            "find_correlation": {
                "sub_tasks": [
                    ["correlation", [], [], "Examine relationships between variables", 1.0]
                ],
                "reasoning": "Fallback result for correlation analysis"
            }
        }
        
        
        default_result = {
            "sub_tasks": [
                ["value", [], [], "Show data values", 0.6],
                ["difference", [], [], "Compare different categories", 0.4]
            ],
            "reasoning": "Default fallback result"
        }
        
        return fallback_mapping.get(task_name, default_result)

if __name__ == "__main__":
    # Test code
    print("Testing TaskAnalyzer with LLM integration...")
    
    # Configure logging
    logging.basicConfig(level=logging.INFO, 
                        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    # Create cache directory if it doesn't exist
    cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
    os.makedirs(cache_dir, exist_ok=True)
    
    # Sample CSV path - replace with an actual CSV file for testing
    test_csv_file = os.path.join(os.path.dirname(__file__), 'data/sample_data.csv')
    
    # If the test CSV doesn't exist, create a simple one for testing
    if not os.path.exists(test_csv_file):
        os.makedirs(os.path.dirname(test_csv_file), exist_ok=True)
        test_df = pd.DataFrame({
            'Year': [2016, 2017, 2018, 2019, 2020],
            'Country': ['USA', 'China', 'Russia', 'UK', 'Japan'],
            'Gold_Medals': [46, 38, 27, 22, 27],
            'Silver_Medals': [37, 32, 23, 21, 14],
            'Bronze_Medals': [38, 18, 19, 26, 17],
            'Total_Medals': [121, 88, 69, 69, 58]
        })
        test_df.to_csv(test_csv_file, index=False)
        print(f"Created test CSV file: {test_csv_file}")
    
    # Create analyzer with cache enabled and CSV file
    analyzer = TaskAnalyzer(csv_file=test_csv_file, use_cache=True)
    
    # 测试任务
    test_tasks = [
        {
            "name": "analyze_trends_by_country",
            "description": "Analyze how medal counts have changed over time for different countries"
        },
        {
            "name": "identify_outliers_in_performance",
            "description": "Find unusual medal performances that deviate significantly from the norm"
        },
        {
            "name": "compare_country_performances",
            "description": "Compare the medal counts and rankings of different countries"
        }
    ]
    
    print("Starting first batch analysis test (no cache yet)...")
    results = analyzer.analyze_tasks_batch(test_tasks)
    
    for task_name, result in results.items():
        print(f"\nTask: {task_name}")
        print("Analysis result:")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        # 打印子任务的详细信息
        print("\nSub-tasks:")
        for sub_task in result.get("sub_tasks", []):
            fact_type, column, value, description, weight = sub_task
            column_str = f" for column '{column}'" if column else ""
            value_str = f" with value '{value}'" if value else ""
            print(f"- Analyze {fact_type}{column_str}{value_str} (weight: {weight:.3f})")
            
    
    print("\n\nRunning second batch analysis (should use cache)...")
    results_cached = analyzer.analyze_tasks_batch(test_tasks)
    
    for task_name, result in results_cached.items():
        print(f"\nTask: {task_name}")
        print("Analysis result (from cache):")
        print(json.dumps(result, indent=2, ensure_ascii=False))
