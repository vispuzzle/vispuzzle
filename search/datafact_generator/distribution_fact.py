from .util import DataFact, DataFactGenerator
from scipy import stats
from scipy.special import expit
import numpy as np

class DistributionFact(DataFact):
    """ 单个 distribution fact """
    def __init__(self):
        super().__init__()
        self.type: str = "distribution"
        self.types = ["uniform", "normal", "exponential", "power_law"]  # 支持的分布类型

class DistributionFactGenerator(DataFactGenerator):
    def __init__(self, data: dict, p_value_threshold: float = 0.05):
        super().__init__(data)
        self.p_value_threshold = p_value_threshold  # 显著性水平
        
    def extract_distribution_facts(self) -> list[DistributionFact]:
        distribution_facts: list[DistributionFact] = []
        
        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]
            
            if len(y_list) < 8:
                continue
            
            uniform_fact = self._test_uniform_distribution(group_value, indices, y_list)
            normal_fact = self._test_normal_distribution(group_value, indices, y_list)
            exponential_fact = self._test_exponential_distribution(group_value, indices, y_list)
            power_law_fact = self._test_power_law_distribution(group_value, indices, y_list)
            
            facts = [uniform_fact, normal_fact, exponential_fact, power_law_fact]
            facts = [f for f in facts if f is not None and f.score > 0.5]
            
            # 只保留得分最高的分布
            if facts:
                best_fact = max(facts, key=lambda f: f.score)
                distribution_facts.append(best_fact)
        
        return distribution_facts
    
    def _test_uniform_distribution(self, group_value: str, indices: list[int], y_list: list) -> DistributionFact:
        """ 检验是否符合均匀分布 """
        distribution_fact = DistributionFact()
        subtype = "uniform"
        
        y_array = np.array(y_list)
        
        # Kolmogorov-Smirnov 检验
        y_min, y_max = np.min(y_array), np.max(y_array)
        if y_max == y_min:
            return None
            
        y_normalized = (y_array - y_min) / (y_max - y_min)
        
        ks_stat, p_value = stats.kstest(y_normalized, 'uniform')
        
        if p_value < self.p_value_threshold:
            return None
        
        def generate_score():
            # p 值越大，说明越符合分布
            # KS 统计量越小，说明拟合越好
            ks_score = 1 - ks_stat
            score = 0.7 * p_value + 0.3 * ks_score
            return score
        
        def generate_annotation_and_reason():
            annotation, reason = "", ""
            
            if self.group_column and group_value:
                annotation = f"The {self.y_column} of {group_value} follows a uniform distribution"
                reason = (
                    f"The values are evenly distributed between {y_min:.2f} and {y_max:.2f}, "
                    f"with KS test p-value of {p_value:.3f}, indicating a good fit to uniform distribution."
                )
            else:
                annotation = f"The {self.y_column} follows a uniform distribution"
                reason = (
                    f"The values are evenly distributed between {y_min:.2f} and {y_max:.2f}, "
                    f"with KS test p-value of {p_value:.3f}, indicating a good fit to uniform distribution."
                )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = [self.tabular_data[idx] for idx in indices]
        
        distribution_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return distribution_fact
    
    def _test_normal_distribution(self, group_value: str, indices: list[int], y_list: list) -> DistributionFact:
        """ 检验是否符合正态分布 """
        distribution_fact = DistributionFact()
        subtype = "normal"
        
        y_array = np.array(y_list)
        
        # Shapiro-Wilk 检验
        stat, p_value = stats.shapiro(y_array)
        
        if p_value < self.p_value_threshold:
            return None
        
        def generate_score():
            skewness = stats.skew(y_array)
            kurtosis = stats.kurtosis(y_array)
            
            skew_score = expit(-2 * abs(skewness))  # 偏度越接近 0 分数越高
            kurt_score = expit(-1 * abs(kurtosis))  # 峰度越接近 0 分数越高
            
            score = 0.5 * p_value + 0.25 * skew_score + 0.25 * kurt_score
            
            return score
        
        def generate_annotation_and_reason():
            y_mean, y_std = np.mean(y_array), np.std(y_array)
            annotation, reason = "", ""
            
            if self.group_column and group_value:
                annotation = f"The {self.y_column} of {group_value} follows a normal distribution"
                reason = (
                    f"The values have mean {y_mean:.2f} and standard deviation {y_std:.2f}, "
                    f"with normality test p-value of {p_value:.3f}, confirming a bell-shaped distribution."
                )
            else:
                annotation = f"The {self.y_column} follows a normal distribution"
                reason = (
                    f"The values have mean {y_mean:.2f} and standard deviation {y_std:.2f}, "
                    f"with normality test p-value of {p_value:.3f}, confirming a bell-shaped distribution."
                )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = [self.tabular_data[idx] for idx in indices]
        
        distribution_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return distribution_fact
    
    def _test_exponential_distribution(self, group_value: str, indices: list[int], y_list: list) -> DistributionFact:
        """ 检验是否符合指数分布 """
        distribution_fact = DistributionFact()
        subtype = "exponential"
        
        y_array = np.array(y_list)
        
        if np.any(y_array <= 0):
            return None
        
        lambda_est = 1.0 / np.mean(y_array)
        
        # KS 检验
        stat, p_value = stats.kstest(y_array, lambda x: stats.expon.cdf(x, scale=1/lambda_est))
        
        if p_value < self.p_value_threshold:
            return None
        
        def generate_score():
            # 检查数据的单调递减特性
            y_sorted = np.sort(y_array)[::-1]
            
            # 计算相邻差值的一致性
            if len(y_sorted) > 1:
                diffs = np.diff(y_sorted)
                diff_cv = np.std(diffs) / (np.mean(np.abs(diffs)) + 1e-8)  # 变异系数
                consistency_score = expit(-2 * diff_cv)
            else:
                consistency_score = 0.5
            
            score = 0.7 * p_value + 0.3 * consistency_score
            
            return score
        
        def generate_annotation_and_reason():
            mean_val = np.mean(y_array)
            annotation, reason = "", ""
            
            if self.group_column and group_value:
                annotation = f"The {self.y_column} of {group_value} follows an exponential distribution"
                reason = (
                    f"The values show exponential decay with rate parameter λ={lambda_est:.3f} "
                    f"(mean={mean_val:.2f}), with KS test p-value of {p_value:.3f}."
                )
            else:
                annotation = f"The {self.y_column} follows an exponential distribution"
                reason = (
                    f"The values show exponential decay with rate parameter λ={lambda_est:.3f} "
                    f"(mean={mean_val:.2f}), with KS test p-value of {p_value:.3f}."
                )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = [self.tabular_data[idx] for idx in indices]
        
        distribution_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return distribution_fact
    
    def _test_power_law_distribution(self, group_value: str, indices: list[int], y_list: list) -> DistributionFact:
        """ 检验是否符合幂律分布 """
        distribution_fact = DistributionFact()
        subtype = "power_law"
        
        y_array = np.array(y_list)
        
        if np.any(y_array <= 0):
            return None
        
        log_y = np.log(y_array)
        
        # 如果对数变换后近似线性，则可能是幂律分布
        x = np.arange(len(log_y))
        
        from sklearn.linear_model import LinearRegression
        model = LinearRegression()
        model.fit(x.reshape(-1, 1), log_y)
        
        r_squared = model.score(x.reshape(-1, 1), log_y)
        
        if r_squared < 0.8:
            return None
        
        def generate_score():
            residuals = log_y - model.predict(x.reshape(-1, 1))
            _, residual_p_value = stats.normaltest(residuals)
            
            residual_score = min(residual_p_value, 1.0)
            
            score = 0.7 * r_squared + 0.3 * residual_score
            
            return score
        
        def generate_annotation_and_reason():
            alpha = -model.coef_[0]
            annotation, reason = "", ""
            
            if self.group_column and group_value:
                annotation = f"The {self.y_column} of {group_value} follows a power law distribution"
                reason = (
                    f"The values exhibit power law behavior with exponent α≈{alpha:.2f}, "
                    f"with log-linear fit R^2={r_squared:.3f}, indicating scale-free properties."
                )
            else:
                annotation = f"The {self.y_column} follows a power law distribution"
                reason = (
                    f"The values exhibit power law behavior with exponent α≈{alpha:.2f}, "
                    f"with log-linear fit R^2={r_squared:.3f}, indicating scale-free properties."
                )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        data_points = [self.tabular_data[idx] for idx in indices]
        
        distribution_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return distribution_fact
