from .util import DataFact, DataFactGenerator
import numpy as np
from scipy.stats import pearsonr
from itertools import combinations

class CorrelationFact(DataFact):
    def __init__(self):
        super().__init__()
        self.type = "correlation"
        self.types = ["positive", "negative"]

class CorrelationFactGenerator(DataFactGenerator):
    def __init__(self, data):
        super().__init__(data)

    def extract_correlation_facts(self, min_correlation: float=0.5, min_p_value: float=0.05) -> list[CorrelationFact]:
        correlation_facts: list[CorrelationFact] = []

        if len(self.grouped_data.keys()) < 2:
            return correlation_facts
        
        group_keys = list(self.grouped_data.keys())
        for group_value1, group_value2 in combinations(group_keys, 2):
            group1 = self.grouped_data[group_value1]
            group2 = self.grouped_data[group_value2]

            y_list1_aligned, y_list2_aligned = self._align_group_data(group1, group2)

            if y_list1_aligned is None or len(y_list1_aligned) < 3:
                continue

            correlation_fact = self._extract_single_correlation(
                group_value1, group1["indices"], y_list1_aligned,
                group_value2, group2["indices"], y_list2_aligned,
                min_p_value
            )

            if correlation_fact and correlation_fact.score >= min_correlation:
                correlation_facts.append(correlation_fact)

        return correlation_facts

    def _extract_single_correlation(
            self,
            group_value1: str, indices1: list[int], y_list1: list,
            group_value2: str, indices2: list[int], y_list2: list,
            min_p_value: float
            ) -> CorrelationFact:
        correlation_fact = CorrelationFact()

        assert(len(y_list1) == len(y_list2))

        y_array1 = np.array(y_list1)
        y_array2 = np.array(y_list2)

        r, p_value = pearsonr(y_array1, y_array2)

        if p_value > min_p_value:
            return None
        
        score = abs(r)
        subtype = "positive" if r >= 0 else "negative"

        data_points = []
        for i1, i2 in zip(indices1[:len(y_list1)], indices2[:len(y_list2)]):
            data_points.append(self.tabular_data[i1])
            data_points.append(self.tabular_data[i2])

        def get_correlation_strength(r: float) -> str:
            abs_r = abs(r)
            if abs_r >= 0.8:
                return "very strong"
            elif abs_r >= 0.6:
                return "strong"
            elif abs_r >= 0.4:
                return "moderate"
            elif abs_r >= 0.2:
                return "weak"
            else:
                return "very weak"

        def generate_annotation_and_reason():
            strength = get_correlation_strength(r)
            
            if subtype == "positive":
                annotation = (
                    f"The {self.y_column} values of {group_value1} and {group_value2} are positively correlated."
                )
                reason = (
                    f"The Pearson correlation coefficient between {group_value1} and {group_value2} "
                    f"is {r:.2f} (p-value: {p_value:.3f}), indicating a {strength} positive relationship. "
                )
            else:
                annotation = (
                    f"The {self.y_column} values of {group_value1} and {group_value2} are negatively correlated."
                )
                reason = (
                    f"The Pearson correlation coefficient between {group_value1} and {group_value2} "
                    f"is {r:.2f} (p-value: {p_value:.3f}), indicating a {strength} negative relationship. "
                )
            
            return annotation, reason
        
        annotation, reason = generate_annotation_and_reason()

        correlation_fact.set_value(
            subtype, data_points, score, annotation, reason
        )

        return correlation_fact

    def _align_group_data(self, group1_data, group2_data):
        """ 用 x 值对齐两个group的数据 """
        x_column = self.x_column
        
        x_to_y1 = {self.tabular_data[idx][x_column]: y for idx, y in zip(group1_data["indices"], group1_data["y_list"])}
        x_to_y2 = {self.tabular_data[idx][x_column]: y for idx, y in zip(group2_data["indices"], group2_data["y_list"])}
        
        common_x_values = sorted(set(x_to_y1.keys()) & set(x_to_y2.keys()))
        
        if len(common_x_values) < 3:
            return None, None
        
        y1_aligned = [x_to_y1[x] for x in common_x_values]
        y2_aligned = [x_to_y2[x] for x in common_x_values]
        
        return y1_aligned, y2_aligned
