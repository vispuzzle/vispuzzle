from .util import DataFact, DataFactGenerator
from statistics import mean, stdev
from scipy.special import expit

class OutlierFact(DataFact):
    """ Single outlier fact """
    def __init__(self):
        super().__init__()
        self.type: str = "outlier"
        self.types = ["extreme_high", "extreme_low"]

class OutlierFactGenerator(DataFactGenerator):
    def __init__(self, data: dict, z_threshold: float = 2.0):
        super().__init__(data)
        self.z_threshold = z_threshold

    def extract_outlier_facts(self) -> list[OutlierFact]:
        outlier_facts: list[OutlierFact] = []
        
        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]
            
            if len(y_list) >= 3:
                high_outlier_fact = self._extract_extreme_high(group_value, indices, y_list)
                low_outlier_fact = self._extract_extreme_low(group_value, indices, y_list)
                
                if high_outlier_fact:
                    outlier_facts.append(high_outlier_fact)
                if low_outlier_fact:
                    outlier_facts.append(low_outlier_fact)
        
        return outlier_facts
    
    def _extract_extreme_high(self, group_value: str, indices: list[int], y_list: list):
        """ Extract all extremely high values in a single group and merge them into one fact """
        mu = mean(y_list)
        sigma = stdev(y_list)
        
        if sigma == 0:  # std=0, cannot be used as denominator, return directly
            return None
        
        high_outlier_indices = []
        high_outlier_z_scores = []
        
        for i, val in enumerate(y_list):
            z = (val - mu) / sigma
            if z > self.z_threshold:
                high_outlier_indices.append(i)
                high_outlier_z_scores.append(z)
        
        if not high_outlier_indices:
            return None
        
        outlier_fact = OutlierFact()
        subtype = "extreme_high"
        
        data_points = [self.tabular_data[indices[i]] for i in high_outlier_indices]
        
        def generate_score():
            max_z = max(high_outlier_z_scores)
            k = 2.0
            z0 = 1.5
            raw_score = expit(k * (max_z - z0))
            
            score = 0.7 + raw_score * 0.3
            
            return score
        
        def generate_annotation_and_reason():
            positions = [str(data_points[i].get(self.x_column)) for i in range(len(data_points))]
            positions_str = ", ".join(positions)
            values = [y_list[i] for i in high_outlier_indices]
            values_str = ", ".join([str(v) for v in values])
            z_scores_str = ", ".join([f"{z:.1f}" for z in high_outlier_z_scores])
            
            annotation, reason = "", ""
            
            if len(data_points) > 1:
                if self.group_column:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} of {group_value} at {positions_str} are {values_str}, "
                        f"which are {z_scores_str} standard deviations above the mean ({mu:.2f}) respectively, "
                        f"indicating extreme outliers."
                    )
                else:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} at {positions_str} are {values_str}, "
                        f"which are {z_scores_str} standard deviations above the mean ({mu:.2f}) respectively, "
                        f"indicating extreme outliers."
                    )
            else:
                if self.group_column:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} of {group_value} at {positions_str} is {values_str}, "
                        f"which is {z_scores_str} standard deviations above the mean ({mu:.2f}), "
                        f"indicating an extreme outlier."
                    )
                else:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} at {positions_str} is {values_str}, "
                        f"which is {z_scores_str} standard deviations above the mean ({mu:.2f}), "
                        f"indicating an extreme outlier."
                    )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        outlier_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return outlier_fact
    
    def _extract_extreme_low(self, group_value: str, indices: list[int], y_list: list):
        """ Extract all extremely low values in a single group and merge them into one fact """
        mu = mean(y_list)
        sigma = stdev(y_list)
        
        if sigma == 0:  # std=0, cannot be used as denominator, return directly
            return None
        
        low_outlier_indices = []
        low_outlier_z_scores = []
        
        for i, val in enumerate(y_list):
            z = (val - mu) / sigma
            if z < -self.z_threshold:
                low_outlier_indices.append(i)
                low_outlier_z_scores.append(abs(z))  # Store absolute value
        
        if not low_outlier_indices:
            return None
        
        outlier_fact = OutlierFact()
        subtype = "extreme_low"
        
        data_points = [self.tabular_data[indices[i]] for i in low_outlier_indices]
        
        def generate_score():
            max_z = max(low_outlier_z_scores)
            k = 1.5
            z0 = 2.0
            score = expit(k * (max_z - z0))
            return score
        
        def generate_annotation_and_reason():
            positions = [str(data_points[i].get(self.x_column)) for i in range(len(data_points))]
            positions_str = ", ".join(positions)
            values = [y_list[i] for i in low_outlier_indices]
            values_str = ", ".join([str(v) for v in values])
            z_scores_str = ", ".join([f"{z:.1f}" for z in low_outlier_z_scores])
            
            annotation, reason = "", ""
            
            if len(data_points) > 1:
                if self.group_column:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} of {group_value} at {positions_str} are {values_str}, "
                        f"which are {z_scores_str} standard deviations below the mean ({mu:.2f}) respectively, "
                        f"indicating extreme outliers."
                    )
                else:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} at {positions_str} are {values_str}, "
                        f"which are {z_scores_str} standard deviations below the mean ({mu:.2f}) respectively, "
                        f"indicating extreme outliers."
                    )
            else:
                if self.group_column:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} of {group_value} at {positions_str} is {values_str}, "
                        f"which is {z_scores_str} standard deviations below the mean ({mu:.2f}), "
                        f"indicating an extreme outlier."
                    )
                else:
                    annotation = f"An anomalous observation appears at {positions_str}."
                    reason = (
                        f"The {self.y_column} at {positions_str} is {values_str}, "
                        f"which is {z_scores_str} standard deviations below the mean ({mu:.2f}), "
                        f"indicating an extreme outlier."
                    )
            
            return annotation, reason
        
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        outlier_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return outlier_fact
