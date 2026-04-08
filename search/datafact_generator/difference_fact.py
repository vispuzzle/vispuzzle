from .util import DataFact, DataFactGenerator, ordinal
from .value_fact import ValueFact
from statistics import mean, stdev
from scipy.special import expit

class DifferenceFact(DataFact):
    """ 单个 difference fact """
    def __init__(self):
        super().__init__()
        self.type = "difference"
        self.types = [
            # 不同 group 之间 value 比较
            "maximum_large",
            "maximum_small",
            "minimum_large",
            "minimum_small",
            "average_large",
            "average_small",

            # temporal
            "sudden_increase", # 相邻时间相差很多
            "sudden_decrease",

            # categorical
            "sudden_change" # 按照值排序后，相邻的相差很多
        ]

class DifferenceFactGenerator(DataFactGenerator):
    def __init__(self, data: dict, value_facts: list[ValueFact]):
        super().__init__(data)

        self.value_facts = value_facts

        self.max_facts: list[ValueFact] = []
        self.min_facts: list[ValueFact] = []
        self.avg_facts: list[ValueFact] = []

        for fact in self.value_facts:
            if fact.subtype == "max":
                self.max_facts.append(fact)
            if fact.subtype == "min":
                self.min_facts.append(fact)
            if fact.subtype == "avg":
                self.avg_facts.append(fact)

    def extract_difference_facts(self) -> list[DifferenceFact]:
        difference_facts: list[DifferenceFact] = []

        # 不同 group 之间 value 比较
        if len(self.grouped_data.keys()) > 1:
            max_large_fact, max_small_fact = self._extract_max_based_facts(self.max_facts)
            min_large_fact, min_small_fact = self._extract_min_based_facts(self.min_facts)
            avg_large_fact, avg_small_fact = self._extract_avg_based_facts(self.avg_facts)

            difference_facts.extend([max_large_fact, max_small_fact, min_large_fact, min_small_fact, avg_large_fact, avg_small_fact])

        # sudden
        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]
            if self.is_temporal:
                increase_difference_fact, decrease_difference_fact = self._extract_temporal_sudden(group_value, indices, y_list)
                difference_facts.append(increase_difference_fact)
                difference_facts.append(decrease_difference_fact)
            else:
                difference_fact = self._extract_categorical_sudden(group_value, indices, y_list)
                difference_facts.append(difference_fact)

        return difference_facts

    def _extract_facts_base(self, fact_type: str, facts: list[ValueFact]):
        """ 模版函数 """
        max_differencen_fact, min_difference_fact = DifferenceFact(), DifferenceFact()
        max_subtype, min_subtype = f"{fact_type}_large", f"{fact_type}_small"

        # value fact 的处理中, max, min, avg 统一地会把那个值放在 data_points[*][y_column] 中
        max_val = max(facts, key=lambda x: x.data_points[0][self.y_column]).data_points[0][self.y_column] 
        min_val = min(facts, key=lambda x: x.data_points[0][self.y_column]).data_points[0][self.y_column] 

        all_val = [fact.data_points[0][self.y_column] for fact in facts]

        max_facts: list[ValueFact] = []
        min_facts: list[ValueFact] = []

        max_data_points, min_data_points = [], []

        for fact in facts:
            if fact.data_points[0][self.y_column] == max_val:
                max_facts.append(fact)
                max_data_points.extend(fact.data_points)
            if fact.data_points[0][self.y_column] == min_val:
                min_facts.append(fact)
                min_data_points.extend(fact.data_points)

        def generate_score():
            """ 统一使用单边 z 检验 """
            mu = mean(all_val)
            sigma = stdev(all_val)
            if sigma == 0:
                max_score = 1.0 if max_val > mu else 0.0
                min_score = 1.0 if min_val < mu else 0.0
                return max_score, min_score
            k = 1.2
            z0 = 1.5
            
            z = (max_val - mu) / sigma
            max_score = expit(k * (z - z0))

            z = (mu - min_val) / sigma  
            min_score = expit(k * (z - z0))

            return max_score, min_score
        
        def generate_annotation_and_reason():
            max_annotation, max_reason = "", ""
            min_annotation, min_reason = "", ""

            max_group_value_str = ", ".join([str(max_data_point[self.group_column]) for max_data_point in max_data_points])
            min_group_value_str = ", ".join([str(min_data_point[self.group_column]) for min_data_point in min_data_points])
            
            if len(max_data_points) == 1:
                max_annotation = f"The {fact_type} value of {max_group_value_str} is the largest in all groups."
                max_reason = (
                    f"The {fact_type} value of {self.y_column} of {max_group_value_str} has a value of {max_val}, "
                    f"which is larger than all other {self.group_column}."
                )
            else:
                max_annotation = f"The {fact_type} value of {max_group_value_str} are all the largest in all groups."
                max_reason = (
                    f"The {fact_type} value of {self.y_column} of {max_group_value_str} all have a value of {max_val}, "
                    f"which is larger than all other {self.group_column}."
                )

            if len(min_data_points) == 1:
                min_annotation = f"The {fact_type} value of {min_group_value_str} is the smallest in all groups."
                min_reason = (
                    f"The {fact_type} value of {self.y_column} of {min_group_value_str} has a value of {min_val}, "
                    f"which is smaller than all other {self.group_column}."
                )
            else:
                min_annotation = f"The {fact_type} value of {min_group_value_str} are all the smallest in all groups."
                min_reason = (
                    f"The {fact_type} value of {self.y_column} of {min_group_value_str} all have a value of {min_val}, "
                    f"which is smaller than all other {self.group_column}."
                )

            return max_annotation, max_reason, min_annotation, min_reason

        max_score, min_score = generate_score()
        max_annotation, max_reason, min_annotation, min_reason = generate_annotation_and_reason()

        max_differencen_fact.set_value(
            max_subtype, max_data_points, max_score, max_annotation, max_reason
        )

        min_difference_fact.set_value(
            min_subtype, min_data_points, min_score, min_annotation, min_reason
        )

        return max_differencen_fact, min_difference_fact

    def _extract_max_based_facts(self, max_facts: list[ValueFact]):
        return self._extract_facts_base("maximum", max_facts)

    def _extract_min_based_facts(self, min_facts: list[ValueFact]):
        return self._extract_facts_base("minimum", min_facts)

    def _extract_avg_based_facts(self, avg_facts: list[ValueFact]):
        return self._extract_facts_base("average", avg_facts)

    def _extract_temporal_sudden(self, group_value: str, indices: list[int], y_list: list):
        """ 选择一个 group 中最显著的上升 / 下降 """

        # 找到相邻值中绝对值相差最大的

        max_diff_idx_increase = []
        max_diff_increase = 0
        
        max_diff_idx_decrease = []
        max_diff_decrease = 0
        
        for idx in range(len(y_list)-1):
            diff = abs(y_list[idx] - y_list[idx+1])

            if y_list[idx] < y_list[idx+1]: # sudden increase
                if diff > max_diff_increase:
                    max_diff_increase = diff
                    max_diff_idx_increase = [idx]
                elif diff == max_diff_increase:
                    max_diff_idx_increase.append(idx)
            
            else: # sudden decrease
                if diff > max_diff_decrease:
                    max_diff_decrease = diff
                    max_diff_idx_decrease = [idx]
                elif diff == max_diff_decrease:
                    max_diff_idx_decrease.append(idx)
        
        increase_difference_fact, decrease_difference_fact = DifferenceFact(), DifferenceFact()
        increase_subtype, decrease_subtype = "sudden_increase", "sudden_decrease"

        before_increase_data_points = [self.tabular_data[indices[i]] for i in max_diff_idx_increase]
        before_decrease_data_points = [self.tabular_data[indices[i]] for i in max_diff_idx_decrease]

        after_increase_data_points = [self.tabular_data[indices[i+1]] for i in max_diff_idx_increase]
        after_decrease_data_points = [self.tabular_data[indices[i+1]] for i in max_diff_idx_decrease]

        def generate_score():
            max_val = max(y_list)
            min_val = min(y_list)

            k = 2.5
            z0 = 0.25

            if max_val != min_val:
                increase_ratio = max_diff_increase / (max_val - min_val)
                decrease_ratio = max_diff_decrease / (max_val - min_val)
            else:
                increase_ratio = 0.0
                decrease_ratio = 0.0

            increase_score = expit(k * (increase_ratio - z0)) if max_diff_increase else 0.0
            decrease_score = expit(k * (decrease_ratio - z0)) if max_diff_decrease else 0.0

            return increase_score, decrease_score

        def generate_annotation_and_reason():
            increase_annotation, increase_reason = "", ""
            decrease_annotation, decrease_reason = "", ""

            increase_positions = [data_point.get(self.x_column) for data_point in after_increase_data_points]
            increase_positions_str = ", ".join(str(pos) for pos in increase_positions)
            after_increase_values = [str(data_point.get(self.y_column)) for data_point in after_increase_data_points]
            after_increase_values_str = ", ".join(str(pos) for pos in after_increase_values)
            before_increase_values = [str(data_point.get(self.y_column)) for data_point in before_increase_data_points]
            before_increase_values_str = ", ".join(str(pos) for pos in before_increase_values)

            decrease_positions = [data_point.get(self.x_column) for data_point in after_decrease_data_points]
            decrease_positions_str = ", ".join(str(pos) for pos in decrease_positions)
            after_decrease_values = [str(data_point.get(self.y_column)) for data_point in after_decrease_data_points]
            after_decrease_values_str = ", ".join(str(pos) for pos in after_decrease_values)
            before_decrease_values = [str(data_point.get(self.y_column)) for data_point in before_decrease_data_points]
            before_decrease_values_str = ", ".join(str(pos) for pos in before_decrease_values)
            
            if self.group_column and group_value:
                if len(max_diff_idx_increase) == 1:
                    increase_annotation = f"The {group_value} shows a sudden increase at {increase_positions_str}."
                    increase_reason = (
                        f"The {self.y_column} for {group_value} at {increase_positions_str} is {after_increase_values_str}, "
                        f"which is significantly higher than the previous value of {before_increase_values_str}."
                    )
                else:
                    increase_annotation = f"The {group_value} exhibits sudden increases at multiple points: {increase_positions_str}."
                    increase_reason = (
                        f"At these positions, the {self.y_column} values for {group_value} are {after_increase_values_str}, "
                        f"which are significantly higher than the preceding values of {before_increase_values_str}."
                    )
            else:
                if len(max_diff_idx_increase) == 1:
                    increase_annotation = f"A sudden increase appears at {increase_positions_str}."
                    increase_reason = (
                        f"The {self.y_column} at {increase_positions_str} is {after_increase_values_str}, "
                        f"which is significantly higher than the previous value of {before_increase_values_str}."
                    )
                else:
                    increase_annotation = f"Sudden increases appear at multiple points: {increase_positions_str}."
                    increase_reason = (
                        f"At these positions, the {self.y_column} values are {after_increase_values_str}, "
                        f"which are significantly higher than the preceding values of {before_increase_values_str}."
                    )

            if self.group_column and group_value:
                if len(max_diff_idx_decrease) == 1:
                    decrease_annotation = f"The {group_value} shows a sudden decrease at {decrease_positions_str}."
                    decrease_reason = (
                        f"The {self.y_column} for {group_value} at {decrease_positions_str} is {after_decrease_values_str}, "
                        f"which is significantly lower than the previous value of {before_decrease_values_str}."
                    )
                else:
                    decrease_annotation = f"The {group_value} exhibits sudden decreases at multiple points: {decrease_positions_str}."
                    decrease_reason = (
                        f"At these positions, the {self.y_column} values for {group_value} are {after_decrease_values_str}, "
                        f"which are significantly lower than the preceding values of {before_decrease_values_str}."
                    )
            else:
                if len(max_diff_idx_decrease) == 1:
                    decrease_annotation = f"A sudden decrease appears at {decrease_positions_str}."
                    decrease_reason = (
                        f"The {self.y_column} at {decrease_positions_str} is {after_decrease_values_str}, "
                        f"which is significantly lower than the previous value of {before_decrease_values_str}."
                    )
                else:
                    decrease_annotation = f"Sudden decreases appear at multiple points: {decrease_positions_str}."
                    decrease_reason = (
                        f"At these positions, the {self.y_column} values are {after_decrease_values_str}, "
                        f"which are significantly lower than the preceding values of {before_decrease_values_str}."
                    )

            return increase_annotation, increase_reason, decrease_annotation, decrease_reason
        
        increase_score, decrease_score = generate_score()
        increase_annotation, increase_reason, decrease_annotation, decrease_reason = generate_annotation_and_reason()

        increase_difference_fact.set_value(
            increase_subtype, after_increase_data_points, increase_score, increase_annotation, increase_reason
        )

        decrease_difference_fact.set_value(
            decrease_subtype, after_decrease_data_points, decrease_score, decrease_annotation, decrease_reason
        )

        return increase_difference_fact, decrease_difference_fact

    def _extract_categorical_sudden(self, group_value: str, indices: list[int], y_list: list):
        difference_fact = DifferenceFact()
        subtype = "sudden_change"

        sorted_pairs = sorted(zip(y_list, indices), key=lambda x: x[0]) 
        sorted_y_list, sorted_indices = zip(*sorted_pairs)

        y_list = list(sorted_y_list)
        indices = list(sorted_indices)

        max_diff_idx = []
        max_diff = 0
        
        for idx in range(len(y_list)-1):
            diff = y_list[idx+1] - y_list[idx]

            if diff > max_diff:
                max_diff = diff
                max_diff_idx = [idx]
            elif diff == max_diff:
                max_diff_idx.append(idx)

        before_change_data_points = [self.tabular_data[indices[i]] for i in max_diff_idx]
        after_change_data_points = [self.tabular_data[indices[i+1]] for i in max_diff_idx]

        def generate_score():
            max_val = max(y_list)
            min_val = min(y_list)

            k = 2.5
            z0 = 0.25

            ratio = max_diff / (max_val - min_val) if max_val - min_val != 0 else 0
            score = expit(k * (ratio - z0)) if max_diff else 0

            return score
        
        def generate_annotation_and_reason():
            annotation, reason = "", ""

            before_change_positions = [data_point.get(self.x_column) for data_point in before_change_data_points]
            after_change_positions = [data_point.get(self.x_column) for data_point in after_change_data_points]
            before_change_positions_str = ", ".join(str(pos) for pos in before_change_positions)
            after_change_positions_str = ", ".join(str(pos) for pos in after_change_positions)

            after_change_values = [str(data_point.get(self.y_column)) for data_point in after_change_data_points]
            after_change_values_str = ", ".join(after_change_values)
            before_change_values = [str(data_point.get(self.y_column)) for data_point in before_change_data_points]
            before_change_values_str = ", ".join(before_change_values)
            
            total_count = len(y_list)
            before_ranks_from_largest = [str(total_count - idx) for idx in max_diff_idx]  
            after_ranks_from_largest = [str(total_count - idx - 1) for idx in max_diff_idx]
            before_ranks_str = ", ".join(before_ranks_from_largest)
            after_ranks_str = ", ".join(after_ranks_from_largest)
            
            if self.group_column and group_value:
                if len(max_diff_idx) == 1:
                    before_ordinal = ordinal(before_ranks_from_largest[0])
                    after_ordinal = ordinal(after_ranks_from_largest[0])
                    annotation = (
                        f"The {group_value} shows a sudden jump in {self.y_column} from {before_change_positions_str} "
                        f"({before_ordinal} largest) to {after_change_positions_str} ({after_ordinal} largest)."
                    )
                    reason = (
                        f"The {self.y_column} for {group_value} jumps from {before_change_values_str} "
                        f"(the {before_ordinal} largest value) at {before_change_positions_str} to {after_change_values_str} "
                        f"(the {after_ordinal} largest value) at {after_change_positions_str}."
                    )
                else:
                    annotation = (
                        f"The {group_value} exhibits multiple sudden jumps in {self.y_column}, transitioning from "
                        f"{before_change_positions_str} ({before_ranks_str} largest) to {after_change_positions_str} ({after_ranks_str} largest)."
                    )
                    reason = (
                        f"The {self.y_column} for {group_value} shows significant jumps from {before_change_values_str} "
                        f"(ranked {before_ranks_str} largest) at {before_change_positions_str} to "
                        f"{after_change_values_str} (ranked {after_ranks_str} largest) at {after_change_positions_str}."
                    )
            else:
                if len(max_diff_idx) == 1:
                    before_ordinal = ordinal(before_ranks_from_largest[0])
                    after_ordinal = ordinal(after_ranks_from_largest[0])
                    annotation = (
                        f"A sudden jump in {self.y_column} appears from {before_change_positions_str} "
                        f"({before_ordinal} largest) to {after_change_positions_str} ({after_ordinal} largest)."
                    )
                    reason = (
                        f"The {self.y_column} jumps from {before_change_values_str} "
                        f"(the {before_ordinal} largest value) at {before_change_positions_str} to {after_change_values_str} "
                        f"(the {after_ordinal} largest value) at {after_change_positions_str}."
                    )
                else:
                    annotation = (
                        f"Multiple sudden jumps in {self.y_column} appear, transitioning from "
                        f"{before_change_positions_str} ({before_ranks_str} largest) to {after_change_positions_str} ({after_ranks_str} largest)."
                    )
                    reason = (
                        f"The {self.y_column} shows significant jumps from {before_change_values_str} "
                        f"(ranked {before_ranks_str} largest) at {before_change_positions_str} to "
                        f"{after_change_values_str} (ranked {after_ranks_str} largest) at {after_change_positions_str}."
                    )

            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()

        difference_fact.set_value(
            subtype, after_change_data_points, score, annotation, reason
        )

        return difference_fact
