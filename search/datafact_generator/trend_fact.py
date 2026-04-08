from .util import DataFact, DataFactGenerator
import numpy as np
from sklearn.linear_model import LinearRegression
from scipy.special import expit

class TrendFact(DataFact):
    def __init__(self):
        super().__init__()
        self.type = "trend"
        self.types = [
            "increase", "decrease", "stable", "increase_then_decrease", "decrease_then_increase"
        ]

class TrendFactGenerator(DataFactGenerator):
    def __init__(self, data):
        super().__init__(data)

    def extract_trend_facts(self) -> list[TrendFact]:
        trend_facts: list[TrendFact] = []

        if not self.is_temporal:
            return []
        
        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]

            if len(y_list) <= 1:
                continue

            trend_fact = self._extract_single_trend(group_value, indices, y_list)
            trend_facts.append(trend_fact)

        return trend_facts

    def _extract_single_trend(self, group_value: str, indices: list[int], y_list: list) -> TrendFact:
        """ 处理单个 group """

        # 分别计算单调上升，单调下降的分数，然后分别以每个点为转折点，计算先升后降，先降后升分数，取最高
        # 分数计算方式使用线性回归后的斜率

        trend_fact = TrendFact()

        def generate_score(y, slope_threshold=0.05, slope_scale=1.5):
            """
            生成某一段的 trend 分数
            划分为 decrease, stable, increase 三类
            """
            y = np.array(y)
            x = np.arange(len(y)).reshape(-1, 1)

            model = LinearRegression().fit(x, y)
            slope = model.coef_[0]
            abs_slope = abs(slope)

            y_mean = np.mean(y)
            
            y_range = np.max(y) - np.min(y)
            if y_range > 0:
                abs_slope = abs_slope / y_range * (len(y)-1)
            elif y_mean != 0:
                abs_slope = abs_slope / abs(y_mean) * (len(y)-1)
            else:
                abs_slope = 0

            if abs_slope < slope_threshold:
                subtype = "stable"
                score = 1 - expit(slope_scale * (abs_slope / slope_threshold))  # 越靠近 0 越高
            else:
                subtype = "increase" if slope > 0 else "decrease"
                score = expit(slope_scale * (abs_slope - slope_threshold))  # 越远离阈值越高

            return score, subtype
            
        # 计算单调上升，单调下降的分数
        mono_score, mono_subtype = generate_score(y_list)

        # 分别遍历每个点作为临界点，分别计算两部分分数，汇总为先升后降和先降后升的分数
        # 我们希望如果两段比较均分，那么分数应该相对较高；如果两段很不均匀，分数应该很低
        # 熵很好
        max_poly_score = 0
        max_poly_subtype = ""
        best_split_idx = -1
        for idx in range(2, len(y_list)-2):
            first_y_list, second_y_list = [y_list[i] for i in range(0, idx)], [y_list[i] for i in range(idx, len(y_list))]

            first_score, first_subtype = generate_score(first_y_list)
            second_score, second_subtype = generate_score(second_y_list)

            # 趋势一样不考虑
            if first_subtype == second_subtype:
                continue

            # 有 stable 不考虑
            if first_subtype == "stable" or second_subtype == "stable":
                continue

            if first_subtype == "increase":
                poly_subtype = "increase_then_decrease"
            else:
                poly_subtype = "decrease_then_increase"

            first_ratio = len(first_y_list) / len(y_list)
            second_ratio = len(second_y_list) / len(y_list)

            # 熵
            poly_score = - first_ratio * np.log2(first_ratio) * first_score - second_ratio * np.log2(second_ratio) * second_score

            if poly_score > max_poly_score:
                max_poly_score = poly_score
                max_poly_subtype = poly_subtype
                best_split_idx = idx

        score = 0
        subtype = ""
        if mono_score >= max_poly_score:
            score = mono_score
            subtype = mono_subtype
        else:
            score = max_poly_score
            subtype = max_poly_subtype

        def generate_annotation_and_reason():
            annotation, reason = "", ""

            if self.group_column and group_value:
                if subtype == "increase":
                    annotation = f"The {self.y_column} of {group_value} shows an increasing trend."
                    reason = "The overall data exhibits a consistent upward movement."

                elif subtype == "decrease":
                    annotation = f"The {self.y_column} of {group_value} shows a decreasing trend."
                    reason = "The overall data exhibits a consistent downward movement."

                elif subtype == "stable":
                    annotation = f"The {self.y_column} of {group_value} remains stable over time."
                    reason = "The slope of the data is close to zero, indicating minimal variation."

                elif subtype == "increase_then_decrease" and best_split_idx != -1:
                    split_x = self.tabular_data[indices[best_split_idx]][self.x_column]
                    annotation = f"The {self.y_column} of {group_value} increases first and then decreases."
                    reason = (
                        f"The data shows an upward trend until {split_x}, "
                        f"then reverses to a downward trend."
                    )

                elif subtype == "decrease_then_increase" and best_split_idx != -1:
                    split_x = self.tabular_data[indices[best_split_idx]][self.x_column]
                    annotation = f"The {self.y_column} of {group_value} decreases first and then increases."
                    reason = (
                        f"The data shows a downward trend until {split_x}, "
                        f"then reverses to an upward trend."
                    )
            else:
                if subtype == "increase":
                    annotation = f"The {self.y_column} shows an increasing trend."
                    reason = "The overall data exhibits a consistent upward movement."

                elif subtype == "decrease":
                    annotation = f"The {self.y_column} shows a decreasing trend."
                    reason = "The overall data exhibits a consistent downward movement."

                elif subtype == "stable":
                    annotation = f"The {self.y_column} remains stable over time."
                    reason = "The slope of the data is close to zero, indicating minimal variation."

                elif subtype == "increase_then_decrease" and best_split_idx != -1:
                    split_x = str(self.tabular_data[indices[best_split_idx]][self.x_column])
                    annotation = f"The {self.y_column} increases first and then decreases."
                    reason = (
                        f"The data shows an upward trend until {split_x}, "
                        f"then reverses to a downward trend."
                    )

                elif subtype == "decrease_then_increase" and best_split_idx != -1:
                    split_x = str(self.tabular_data[indices[best_split_idx]][self.x_column])
                    annotation = f"The {self.y_column} decreases first and then increases."
                    reason = (
                        f"The data shows a downward trend until {split_x}, "
                        f"then reverses to an upward trend."
                    )
            
            return annotation, reason
        
        annotation, reason = generate_annotation_and_reason()

        data_points = [self.tabular_data[indices[-1]]] # 把最后一个元素作为 data point

        trend_fact.set_value(
            subtype, data_points, score, annotation, reason
        )

        return trend_fact
