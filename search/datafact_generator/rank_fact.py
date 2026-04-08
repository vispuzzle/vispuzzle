from .util import DataFact, DataFactGenerator
import numpy as np

class RankFact(DataFact):
    """ 单个 rank fact """
    def __init__(self):
        super().__init__()
        self.type: str = "rank"
        self.types = ["linearity"]

class RankFactGenerator(DataFactGenerator):
    def __init__(self, data: dict, min_points: int = 3, score_weights: tuple[float, float] = (0.6, 0.4), emit_threshold: float = 0.5):
        super().__init__(data)
        self.min_points = min_points
        self.w_gini, self.w_r2 = score_weights
        self.emit_threshold = emit_threshold 

    def extract_rank_facts(self) -> list[RankFact]:
        rank_facts: list[RankFact] = []

        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]

            if len(y_list) < self.min_points:
                continue

            fact = self._extract_linearity_fact(group_value, indices, y_list)
            if fact is not None and fact.score >= self.emit_threshold:
                rank_facts.append(fact)

        return rank_facts

    @staticmethod
    def _normalized_gini(values: np.ndarray) -> float:
        """
        计算归一化 Gini 系数
        若总和为 0, 返回 0
            G = (1 / (n * mu)) * sum_{i=1..n} (2i - n - 1) * y_(i)
            G_norm = (n / (n - 1)) * G
        并裁剪到 [0, 1]。
        """
        y = values.astype(float)
        if np.any(y < 0):
            raise ValueError("Gini requires non-negative input after shifting.")

        total = y.sum()
        n = y.size
        if n == 0:
            return 0.0
        if total <= 0:
            return 0.0

        y_sorted = np.sort(y)
        i = np.arange(1, n + 1)
        g = (1.0 / (n * (total / n))) * np.sum((2 * i - n - 1) * y_sorted) / n

        if n > 1:
            g_norm = (n / (n - 1)) * g
        else:
            g_norm = 0.0

        # 数值稳定性裁剪
        return float(np.clip(g_norm, 0.0, 1.0))

    @staticmethod
    def _r2_against_rank(y_sorted: np.ndarray) -> float:
        """
        用 rank (1..n) 对 y_sorted 做一元线性回归，返回 R^2。
        若方差为 0, 则认为完全线性, R^2=1。
        """
        n = y_sorted.size
        x = np.arange(1, n + 1, dtype=float)

        y = y_sorted.astype(float)
        y_mean = y.mean()
        ss_tot = np.sum((y - y_mean) ** 2)
        if ss_tot == 0:
            return 1.0

        # 最小二乘：拟合 y = a + b x
        x_mean = x.mean()
        b = np.sum((x - x_mean) * (y - y_mean)) / np.sum((x - x_mean) ** 2)
        a = y_mean - b * x_mean
        y_pred = a + b * x
        ss_res = np.sum((y - y_pred) ** 2)

        r2 = 1.0 - ss_res / ss_tot
        return float(np.clip(r2, 0.0, 1.0))

    def _extract_linearity_fact(self, group_value: str, indices: list[int], y_list: list) -> RankFact:
        rank_fact = RankFact()
        subtype = "linearity"

        y = np.array(y_list, dtype=float)

        # 允许负值：整体平移到非负域
        y_shift = y - y.min() if np.min(y) < 0 else y.copy()
        total = float(y_shift.sum())

        if total <= 1e-12:
            score = 1.0  # 完全均匀
            gini_norm = 0.0
            r2 = 1.0
            y_sorted = y_shift  # 全 0
        else:
            # 升序排序用于 Gini 与线性拟合
            y_sorted = np.sort(y_shift)
            # Gini（越大越不均匀）-> 线性性 = 1 - Gini
            try:
                gini_norm = self._normalized_gini(y_sorted)
            except ValueError:
                return None
            linearity_gini = 1.0 - gini_norm

            # R^2 评估 y_sorted 与 rank 的线性程度
            r2 = self._r2_against_rank(y_sorted)

            score = float(np.clip(self.w_gini * linearity_gini + self.w_r2 * r2, 0.0, 1.0))

        def generate_annotation_and_reason():
            annotation, reason = "", ""
            n = len(y_list)

            if self.group_column and group_value:
                annotation = f"The {self.y_column} of {group_value} shows near-linear distribution across ranked items"
                reason = (
                    f"After sorting by {self.y_column}, the distribution is close to the line of equality "
                    f"(normalized Gini={gini_norm:.3f}), and fits a straight line against rank with R^2={r2:.3f}."
                )
            else:
                annotation = f"The {self.y_column} shows near-linear distribution across ranked items"
                reason = (
                    f"After sorting by {self.y_column}, the distribution is close to the line of equality "
                    f"(normalized Gini={gini_norm:.3f}), and fits a straight line against rank with R^2={r2:.3f}."
                )

            return annotation, reason

        annotation, reason = generate_annotation_and_reason()

        data_points = [self.tabular_data[idx] for idx in indices]

        rank_fact.set_value(subtype, data_points, score, annotation, reason)
        return rank_fact
