from .util import DataFact, DataFactGenerator
from statistics import mean, stdev
from scipy.special import expit

class ValueFact(DataFact):
    """
    单个 value_fact.
    NOTE 这里 avg, total 均并无实际意义, score 统一设为 0, annotation, reason 统一设为 "",
        其目的是后续不同 group 的 total, avg 比较得到组合 facts
    """
    def __init__(self):
        super().__init__()
        self.type: str = "value"
        self.types = ["max", "min", "avg", "total"] # 所有可选的 value_fact

class ValueFactGenerator(DataFactGenerator):
    """ 处理从数据提取 value_facts 的问题 """
    def __init__(self, data: dict):
        super().__init__(data)

    def extract_value_facts(self) -> list[ValueFact]:
        """ 暴露的接口，提取数据中所有 value_facts """
        value_facts: list[ValueFact] = []
        
        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]

            max_fact = self._extract_max(group_value, indices, y_list)
            min_fact = self._extract_min(group_value, indices, y_list)
            avg_fact = self._extract_avg(group_value, indices, y_list)
            total_fact = self._extract_total(group_value, indices, y_list)

            value_facts.extend([max_fact, min_fact, avg_fact, total_fact])

        return value_facts

    def _extract_max(self, group_value: str, indices: list[int], y_list: list):
        """ 提取单个 group 中 subtype 为 max 的 facts """
        value_fact = ValueFact()
        subtype = "max"

        # 先找到所有最大值在这组内的序号，再用每个组内序号索引全局序号
        max_val = max(y_list)
        all_max_indices = [i for i, v in enumerate(y_list) if v == max_val]
        data_points = [self.tabular_data[indices[i]] for i in all_max_indices]

        def generate_score():
            """ 计算最大值评分 """    
            mu = mean(y_list)
            sigma = stdev(y_list)

            if sigma == 0:
                return 0.3

            z = (max_val - mu) / sigma

            # 套一个 sigmoid, 控制一下
            k = 2.0
            z0 = 0.8
            raw_score = expit(k * (z - z0))
            
            # 对普通 max/min 的分数进行缩放，最高不超过0.7
            score = raw_score * 0.7

            return score

        def generate_annotation_and_reason():
            """ 生成注释 """
            max_positions = [data_points[i].get(self.x_column) for i in range(len(data_points))]
            if len(max_positions) > 50:
                max_positions = max_positions[:50] + ["..."]
            max_positions_str = ", ".join(str(pos) for pos in max_positions)

            annotation, reason = "", ""

            # 判断是否有group
            if self.group_column and group_value:
                if len(data_points) > 1:
                    annotation = f"The {group_value} has maximum values at {max_positions_str}"
                else:
                    annotation = f"The {group_value} has a maximum value at {max_positions_str}"
            else:
                if len(data_points) > 1:
                    annotation = f"Maximum values appear at {max_positions_str}"
                else:
                    annotation = f"A maximum value appears at {max_positions_str}"

            # 如果是时序的，我们说它是范围内最大的；如果不是，我们说它是所有类别中最大的
            if self.is_temporal:
                temporal_begin = str(self.tabular_data[0][self.x_column])
                temporal_end = str(self.tabular_data[-1][self.x_column])

                if self.group_column and group_value:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} of {group_value} have maximum values of {max_val}, which is the largest from {temporal_begin} to {temporal_end}."
                    else:
                        reason = f"The {self.y_column} of {group_value} has a maximum value of {max_val}, which is the largest from {temporal_begin} to {temporal_end}."
                else:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} values are {max_val}, which is the largest from {temporal_begin} to {temporal_end}."
                    else:
                        reason = f"The {self.y_column} value is {max_val}, which is the largest from {temporal_begin} to {temporal_end}."
            else:
                if self.group_column and group_value:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} of {group_value} have maximum values of {max_val}, which is the largest in all categories."
                    else:
                        reason = f"The {self.y_column} of {group_value} has a maximum value of {max_val}, which is the largest in all categories."
                else:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} values are {max_val}, which is the largest in all categories."
                    else:
                        reason = f"The {self.y_column} value is {max_val}, which is the largest in all categories."

            return annotation, reason

        score = generate_score()
        annotation, reason = generate_annotation_and_reason()

        value_fact.set_value(subtype, data_points, score, annotation, reason)

        return value_fact

    def _extract_min(self, group_value: str, indices: list[int], y_list: list):
        """ 提取单个 group 中 subtype 为 min 的 facts """
        value_fact = ValueFact()
        subtype = "min"

        # 先找到所有最大值在这组内的序号，再用每个组内序号索引全局序号
        min_val = min(y_list)
        all_min_indices = [i for i, v in enumerate(y_list) if v == min_val]
        data_points = [self.tabular_data[indices[i]] for i in all_min_indices]

        def generate_score():
            """ 计算最小值评分（值越小、越异常，分数越高） """    
            min_val = min(y_list)
            mu = mean(y_list)
            sigma = stdev(y_list)

            if sigma == 0:
                return 0.3

            z = (mu - min_val) / sigma
            
            k = 2.0
            z0 = 0.8
            raw_score = expit(k * (z - z0))
            
            # 对普通max/min的分数进行缩放，最高不超过0.7
            score = raw_score * 0.7

            return score

        def generate_annotation_and_reason():
            """ 生成注释 """
            min_positions = [data_points[i].get(self.x_column) for i in range(len(data_points))]
            if len(min_positions) > 50:
                min_positions = min_positions[:50] + ["..."]
            min_positions_str = ", ".join(str(pos) for pos in min_positions)

            annotation, reason = "", ""

            if self.group_column and group_value:  # 有group的情况
                if len(data_points) > 1:
                    annotation = f"The {group_value} has minimum values at {min_positions_str}"
                else:
                    annotation = f"The {group_value} has a minimum value at {min_positions_str}"
            else:  # 没有group的情况
                if len(data_points) > 1:
                    annotation = f"Minimum values appear at {min_positions_str}"
                else:
                    annotation = f"A minimum value appears at {min_positions_str}"

            # 如果是时序的，我们说它是范围内最大的；如果不是，我们说它是所有类别中最大的
            if self.is_temporal:
                temporal_begin = str(self.tabular_data[0][self.x_column])
                temporal_end = str(self.tabular_data[-1][self.x_column])

                if self.group_column and group_value:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} of {group_value} have minimum values of {min_val}, which is the smallest from {temporal_begin} to {temporal_end}."
                    else:
                        reason = f"The {self.y_column} of {group_value} has a minimum value of {min_val}, which is the smallest from {temporal_begin} to {temporal_end}."
                else:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} values are {min_val}, which is the smallest from {temporal_begin} to {temporal_end}."
                    else:
                        reason = f"The {self.y_column} value is {min_val}, which is the smallest from {temporal_begin} to {temporal_end}."
            else:
                if self.group_column and group_value:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} of {group_value} have minimum values of {min_val}, which is the smallest in all categories."
                    else:
                        reason = f"The {self.y_column} of {group_value} has a minimum value of {min_val}, which is the smallest in all categories."
                else:
                    if len(data_points) > 1:
                        reason = f"The {self.y_column} values are {min_val}, which is the smallest in all categories."
                    else:
                        reason = f"The {self.y_column} value is {min_val}, which is the smallest in all categories."

            return annotation, reason

        score = generate_score()
        annotation, reason = generate_annotation_and_reason()

        value_fact.set_value(subtype, data_points, score, annotation, reason)

        return value_fact

    def _extract_avg(self, group_value: str, indices: list[int], y_list: list):
        """ 提取提取单个 group 中数据中 subtype 为 avg 的 facts """
        # 参见 ValueFact 说明，这里无实际意义

        # data_points 中的 x 值用 "avg" 替换
        value_fact = ValueFact()
        subtype = "avg"

        # 先找到所有最大值在这组内的序号，再用每个组内序号索引全局序号
        avg_val = sum(y_list) / len(y_list)
        
        data_points = {}
        if self.group_column:
            data_points = [{
                self.group_column: group_value,
                self.x_column: "avg",
                self.y_column: avg_val
            }]
        else:
            data_points = [{
                self.x_column: "avg",
                self.y_column: avg_val
            }]

        value_fact.set_value(subtype, data_points, 0, "", "")

        return value_fact

    def _extract_total(self, group_value: str, indices: list[int], y_list: list):
        """ 提取单个 group 中 subtype 为 total 的 facts """
        value_fact = ValueFact()
        subtype = "total"

        # 先找到所有最大值在这组内的序号，再用每个组内序号索引全局序号
        total_val = sum(y_list)
        
        data_points = {}
        if self.group_column:
            data_points = [{
                self.group_column: group_value,
                self.x_column: "total",
                self.y_column: total_val
            }]
        else:
            data_points = [{
                self.x_column: "total",
                self.y_column: total_val
            }]

        value_fact.set_value(subtype, data_points, 0, "", "")

        return value_fact
