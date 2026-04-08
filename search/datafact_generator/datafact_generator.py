import argparse
import os
import json
from logging import getLogger
logger = getLogger(__name__)
from typing import Optional, List
from .util import DataFact
from .value_fact import ValueFact, ValueFactGenerator
from .trend_fact import TrendFact, TrendFactGenerator
from .proportion_fact import ProportionFact, ProportionFactGenerator
from .difference_fact import DifferenceFact, DifferenceFactGenerator
from .correlation_fact import CorrelationFact, CorrelationFactGenerator
from .extreme_fact import ExtremeValueFact, ExtremeValueFactGenerator
from .outlier_fact import OutlierFact, OutlierFactGenerator
from .distribution_fact import DistributionFact, DistributionFactGenerator
from .rank_fact import RankFact, RankFactGenerator
from .categorization_fact import CategorizationFact, CategorizationFactGenerator

class DatafactGenerator:
    def __init__(self, data: dict):
        self.data = data
        
        self.fact_generators = {
            'value': (ValueFactGenerator, 'value_facts'),
            'trend': (TrendFactGenerator, 'trend_facts'),
            'proportion': (ProportionFactGenerator, 'proportion_facts'),
            'difference': (DifferenceFactGenerator, 'difference_facts'),
            'correlation': (CorrelationFactGenerator, 'correlation_facts'),
            'extreme': (ExtremeValueFactGenerator, 'extreme_facts'),
            'outlier': (OutlierFactGenerator, 'outlier_facts'),
            'distribution': (DistributionFactGenerator, 'distribution_facts'),
            'rank': (RankFactGenerator, 'rank_facts'),
            'categorization': (CategorizationFactGenerator, 'categorization_facts')
        }
        
        self.value_facts: list[ValueFact] = []
        self.trend_facts: list[TrendFact] = []
        self.proportion_facts: list[ProportionFact] = []
        self.difference_facts: list[DifferenceFact] = []
        self.correlation_facts: list[CorrelationFact] = []
        self.extreme_facts: list[ExtremeValueFact] = []
        self.outlier_facts: list[OutlierFact] = []
        self.distribution_facts: list[DistributionFact] = []
        self.rank_facts: list[RankFact] = []
        self.categorization_facts: list[CategorizationFact] = []
        
        self.datafacts: list[DataFact] = []
    
    def _generate_single_fact_type(self, fact_type: str) -> list:
        generator_class, attr_name = self.fact_generators[fact_type]
        
        try:
            if fact_type in ['proportion', 'difference']:
                generator = generator_class(self.data, self.value_facts)
            else:
                generator = generator_class(self.data)
            
            method_name = f'extract_{fact_type}_facts'
            facts = getattr(generator, method_name)()
            setattr(self, attr_name, facts)
            return facts
            
        except Exception as e:
            logger.error(f"生成 {fact_type} facts 失败: {str(e)}")
            setattr(self, attr_name, [])
            return []
    
    def generate_datafacts(self, topk=500, fact_types: Optional[List[str]] = None):
        """生成 datafacts"""
        all_facts = []
        
        fact_order = ['value', 'trend', 'proportion', 'difference', 'correlation',
                      'extreme',
                      'outlier', 'distribution', 'rank', 'categorization']

        if fact_types is None:
            selected_fact_order = fact_order
        else:
            selected_set = set(fact_types)
            selected_fact_order = [fact_type for fact_type in fact_order if fact_type in selected_set]
            if (
                'value' not in selected_fact_order
                and any(fact_type in selected_set for fact_type in ['proportion', 'difference'])
            ):
                selected_fact_order = ['value'] + selected_fact_order
        
        for fact_type in selected_fact_order:
            facts = self._generate_single_fact_type(fact_type)
            all_facts.extend(facts)
        
        self.datafacts = sorted(all_facts, key=lambda x: x.score, reverse=True)
        self.datafacts = self.datafacts[:min(topk, len(self.datafacts))]
        
        return self.datafacts

def process(input: str, output: str, topk: int = 500, fact_types: Optional[List[str]] = None) -> bool:
    """
    Pipeline入口函数，处理单个文件的数据洞察生成
    
    Args:
        input (str): 输入JSON文件路径
        output (str): 输出JSON文件路径
        topk (int): 最多返回的facts数量
        
    Returns:
        bool: 处理是否成功
    """
    try:
        # 读取输入文件
        with open(input, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        # 预处理数据，确保类型正确
        processed_data = preprocess_data(data)
        
        # 调用原有的处理逻辑
        result = generate_datafacts(input_data=processed_data, input_path=None, topk=topk, fact_types=fact_types)
        
        if result:  # 确保有结果才写入
            # 保存结果
            with open(output, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            return True
        else:
            logger.warning(f"跳过文件 {input}: 无有效结果")
            return False
            
    except Exception as e:
        logger.error(f"数据洞察生成失败: {str(e)}")
        return False

def preprocess_data(data):
    """
    预处理数据，处理类型转换问题
    """
    try:
        # 深拷贝避免修改原始数据
        processed = data.copy()
        
        # 确保data字段存在且格式正确
        if "data" in processed and isinstance(processed["data"], dict):
            # 处理数据部分
            if "data" in processed["data"]:
                rows = processed["data"]["data"]
                if isinstance(rows, list):
                    # 处理每一行数据
                    for row in rows:
                        if isinstance(row, dict):
                            # 尝试将数值字符串转换为数值类型
                            for key, value in row.items():
                                if isinstance(value, str):
                                    try:
                                        # 尝试转换为数值
                                        if '.' in value:
                                            row[key] = float(value)
                                        else:
                                            row[key] = int(value)
                                    except (ValueError, TypeError):
                                        # 如果转换失败，保持原始值
                                        pass
                                elif value is None:
                                    # 将None替换为0或其他适当的默认值
                                    row[key] = 0
        
        return processed
        
    except Exception as e:
        logger.error(f"数据预处理失败: {str(e)}")
        raise

def generate_datafacts(input_data=None, input_path=None, topk: int = 500, fact_types: Optional[List[str]] = None):
    """
    原有的数据洞察生成逻辑
    
    Args:
        input_data: 直接传入的数据对象
        input_path: 输入文件路径
        topk: 最多返回的facts数量
        fact_types: 仅生成指定类型的facts；为None时生成全部类型
    """
    try:
        if input_data is not None:
            data = input_data
            assert input_path is None
        else:
            assert input_path and os.path.exists(input_path)
            try:
                with open(input_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                logger.error(f"Failed to read input file: {e}")
                return None
        
        datafact_generator = DatafactGenerator(data)
        datafacts = datafact_generator.generate_datafacts(topk=topk, fact_types=fact_types)

        data["datafacts"] = [datafact.get_json() for datafact in datafacts if datafact.score > 0]

        return data
        
    except Exception as e:
        logger.error(f"生成数据洞察失败: {str(e)}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Datafact Generator")
    parser.add_argument("--input", type=str, default="data.json", help="Input JSON file path")
    parser.add_argument("--output", type=str, default="data1.json", help="Output JSON file path")
    parser.add_argument("--topk", type=int, default=500, help="Max number of facts to include")
    args = parser.parse_args()

    success = process(input=args.input, output=args.output, topk=args.topk)

    if success:
        print("Processing json succeeded.")
    else:
        print("Processing json failed.")

if __name__ == "__main__":
    main()
