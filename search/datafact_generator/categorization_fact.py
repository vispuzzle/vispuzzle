from .util import DataFact, DataFactGenerator
from scipy.special import expit
from collections import Counter
import numpy as np

class CategorizationFact(DataFact):
    """ 单个 categorization fact """
    def __init__(self):
        super().__init__()
        self.type: str = "categorization"
        self.types = ["optimal_categories", "few_categories", "many_categories", "balanced_distribution", "imbalanced_distribution"]

class CategorizationFactGenerator(DataFactGenerator):
    def __init__(self, data: dict):
        super().__init__(data)
        # 定义理想的分类数量范围
        self.optimal_min = 2
        self.optimal_max = 7
        self.max_categories = 20
        
    def extract_categorization_facts(self) -> list[CategorizationFact]:
        categorization_facts: list[CategorizationFact] = []
        
        # 分析分类列（通常是 group_column 或者其他分类列）
        categorical_columns = self._get_categorical_columns()
        
        for col_name in categorical_columns:
            category_fact = self._analyze_categorical_column(col_name)
            if category_fact and category_fact.score > 0.3:
                categorization_facts.append(category_fact)
        
        return categorization_facts
    
    def _get_categorical_columns(self) -> list[str]:
        """获取所有分类类型的列"""
        categorical_columns = []
        
        for col in self.data_columns:
            if col["data_type"] == "categorical":
                categorical_columns.append(col["name"])
                
        return categorical_columns
    
    def _analyze_categorical_column(self, col_name: str) -> CategorizationFact:
        """分析单个分类列的特征"""
        # 提取该列的所有取值
        values = [row.get(col_name) for row in self.tabular_data if row.get(col_name) is not None]
        
        if not values:
            return None
            
        # 统计各类别的频次
        value_counts = Counter(values)
        unique_count = len(value_counts)
        total_count = len(values)
        
        # 根据分类数量和分布特征选择最合适的子类型
        category_fact = self._determine_categorization_subtype(col_name, value_counts, unique_count, total_count)
        
        return category_fact
    
    def _determine_categorization_subtype(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """根据分类特征确定最合适的子类型"""
        
        # 计算分布均匀性
        frequencies = list(value_counts.values())
        mean_freq = np.mean(frequencies)
        std_freq = np.std(frequencies)
        cv = std_freq / (mean_freq + 1e-8)  # 变异系数
        
        # 分析分类数量特征
        if self.optimal_min <= unique_count <= self.optimal_max:
            if cv < 0.3:  # 分布相对均匀
                return self._create_optimal_balanced_fact(col_name, value_counts, unique_count, total_count)
            else:
                return self._create_optimal_categories_fact(col_name, value_counts, unique_count, total_count)
        elif unique_count < self.optimal_min:
            return self._create_few_categories_fact(col_name, value_counts, unique_count, total_count)
        elif unique_count <= self.max_categories:
            if cv < 0.4:
                return self._create_balanced_distribution_fact(col_name, value_counts, unique_count, total_count)
            else:
                return self._create_many_categories_fact(col_name, value_counts, unique_count, total_count)
        else:
            return self._create_imbalanced_distribution_fact(col_name, value_counts, unique_count, total_count)
    
    def _create_optimal_categories_fact(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """创建理想分类数量的 fact"""
        categorization_fact = CategorizationFact()
        subtype = "optimal_categories"
        
        def generate_score():
            # 分类数量在理想范围内，给高分
            distance_from_optimal = min(abs(unique_count - self.optimal_min), abs(unique_count - self.optimal_max))
            optimal_range = self.optimal_max - self.optimal_min
            score = 0.9 - 0.2 * (distance_from_optimal / optimal_range)
            
            # 考虑样本数量的充足性
            min_samples_per_category = min(value_counts.values())
            if min_samples_per_category >= 3:
                score += 0.1
            
            return min(score, 1.0)
        
        def generate_annotation_and_reason():
            categories = list(value_counts.keys())
            categories_str = ", ".join([str(cat) for cat in categories[:5]])  # 只显示前5个
            if len(categories) > 5:
                categories_str += f", and {len(categories) - 5} more"
            
            annotation = f"The {col_name} has an optimal number of categories ({unique_count})"
            reason = (
                f"The {col_name} contains {unique_count} distinct categories ({categories_str}), "
                f"which is within the optimal range of {self.optimal_min}-{self.optimal_max} categories "
                f"for effective data analysis and visualization."
            )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        # 数据点包含所有相关行
        data_points = self.tabular_data
        
        categorization_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return categorization_fact
    
    def _create_optimal_balanced_fact(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """创建理想且均衡分布的 fact"""
        categorization_fact = CategorizationFact()
        subtype = "balanced_distribution"
        
        def generate_score():
            # 分类数量理想且分布均匀，给最高分
            frequencies = list(value_counts.values())
            mean_freq = np.mean(frequencies)
            std_freq = np.std(frequencies)
            cv = std_freq / (mean_freq + 1e-8)
            
            balance_score = expit(-5 * cv)  # cv越小，分布越均匀
            optimal_score = 0.95  # 数量在理想范围内
            
            score = 0.6 * optimal_score + 0.4 * balance_score
            
            return score
        
        def generate_annotation_and_reason():
            frequencies = list(value_counts.values())
            min_freq, max_freq = min(frequencies), max(frequencies)
            
            annotation = f"The {col_name} has well-balanced categories with optimal count"
            reason = (
                f"The {col_name} contains {unique_count} categories with balanced distribution "
                f"(frequency range: {min_freq}-{max_freq}), providing excellent granularity "
                f"for analysis without being overwhelming."
            )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = self.tabular_data
        categorization_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return categorization_fact
    
    def _create_few_categories_fact(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """创建分类过少的 fact"""
        categorization_fact = CategorizationFact()
        subtype = "few_categories"
        
        def generate_score():
            # 分类太少，分数中等
            score = 0.4 + 0.1 * unique_count / self.optimal_min
            
            # 如果每个分类都有足够样本，稍微加分
            min_samples = min(value_counts.values())
            if min_samples >= 5:
                score += 0.1
                
            return min(score, 0.7)
        
        def generate_annotation_and_reason():
            categories = list(value_counts.keys())
            categories_str = ", ".join([str(cat) for cat in categories])
            
            annotation = f"The {col_name} has relatively few categories ({unique_count})"
            reason = (
                f"The {col_name} only contains {unique_count} categories ({categories_str}), "
                f"which might limit the granularity of analysis. Consider if additional "
                f"subcategories could provide more insights."
            )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = self.tabular_data
        categorization_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return categorization_fact
    
    def _create_many_categories_fact(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """创建分类较多的 fact"""
        categorization_fact = CategorizationFact()
        subtype = "many_categories"
        
        def generate_score():
            # 分类较多，根据是否过多调整分数
            if unique_count <= 15:
                score = 0.7 - 0.05 * (unique_count - self.optimal_max)
            else:
                score = 0.5 - 0.02 * (unique_count - 15)
            
            # 考虑样本充足性
            min_samples = min(value_counts.values())
            if min_samples < 2:
                score -= 0.2
                
            return max(score, 0.2)
        
        def generate_annotation_and_reason():
            top_categories = value_counts.most_common(5)
            top_cats_str = ", ".join([f"{cat} ({count})" for cat, count in top_categories])
            
            annotation = f"The {col_name} has many categories ({unique_count})"
            reason = (
                f"The {col_name} contains {unique_count} categories, which provides detailed "
                f"granularity but might be complex to analyze. Top categories: {top_cats_str}. "
                f"Consider grouping similar categories if appropriate."
            )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = self.tabular_data
        categorization_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return categorization_fact
    
    def _create_balanced_distribution_fact(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """创建均衡分布的 fact"""
        categorization_fact = CategorizationFact()
        subtype = "balanced_distribution"
        
        def generate_score():
            frequencies = list(value_counts.values())
            mean_freq = np.mean(frequencies)
            std_freq = np.std(frequencies)
            cv = std_freq / (mean_freq + 1e-8)
            
            balance_score = expit(-3 * cv)
            
            # 分类数量适中时给更高分
            count_penalty = max(0, (unique_count - self.optimal_max) * 0.02)
            score = 0.8 * balance_score - count_penalty
            
            return max(score, 0.3)
        
        def generate_annotation_and_reason():
            frequencies = list(value_counts.values())
            min_freq, max_freq = min(frequencies), max(frequencies)
            mean_freq = np.mean(frequencies)
            
            annotation = f"The {col_name} shows balanced distribution across categories"
            reason = (
                f"The {unique_count} categories in {col_name} are relatively well-balanced "
                f"with frequencies ranging from {min_freq} to {max_freq} (mean: {mean_freq:.1f}), "
                f"ensuring no single category dominates the dataset."
            )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = self.tabular_data
        categorization_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return categorization_fact
    
    def _create_imbalanced_distribution_fact(self, col_name: str, value_counts: Counter, unique_count: int, total_count: int) -> CategorizationFact:
        """创建不均衡分布的 fact"""
        categorization_fact = CategorizationFact()
        subtype = "imbalanced_distribution"
        
        def generate_score():
            frequencies = list(value_counts.values())
            max_freq = max(frequencies)
            dominant_ratio = max_freq / total_count
            
            # 不均衡程度越高，分数越低
            if dominant_ratio > 0.7:
                score = 0.3
            elif dominant_ratio > 0.5:
                score = 0.4
            else:
                score = 0.5
                
            # 分类过多也降分
            if unique_count > self.max_categories:
                score -= 0.1
                
            return max(score, 0.2)
        
        def generate_annotation_and_reason():
            most_common = value_counts.most_common(1)[0]
            dominant_cat, dominant_count = most_common
            dominant_ratio = dominant_count / total_count
            
            annotation = f"The {col_name} has imbalanced distribution across categories"
            reason = (
                f"The {col_name} contains {unique_count} categories with significant imbalance. "
                f"The dominant category '{dominant_cat}' accounts for {dominant_ratio:.1%} "
                f"({dominant_count}/{total_count}) of all records, which may skew analysis results."
            )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = self.tabular_data
        categorization_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return categorization_fact
