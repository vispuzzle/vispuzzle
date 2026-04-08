from .util import DataFact, DataFactGenerator
import numpy as np
from scipy.stats import genpareto
from scipy.special import expit

class ExtremeValueFact(DataFact):
    """ Single extreme value fact based on Extreme Value Theory (EVT). """
    def __init__(self):
        super().__init__()
        self.type: str = "extreme"
        self.types = ["extreme_high", "extreme_low"]

class ExtremeValueFactGenerator(DataFactGenerator):
    def __init__(self, data: dict, tail_percentile: float = 95.0, min_samples: int = 20):
        super().__init__(data)
        # EVT requires a sufficient sample size to estimate the tail distribution
        self.tail_percentile = tail_percentile
        self.min_samples = min_samples

    def extract_extreme_facts(self) -> list[ExtremeValueFact]:
        extreme_facts: list[ExtremeValueFact] = []
        
        for group_value in self.grouped_data.keys():
            indices = self.grouped_data[group_value]["indices"]
            y_list = self.grouped_data[group_value]["y_list"]
            
            # Ensure sufficient data points exist to define a meaningful statistical tail
            if len(y_list) >= self.min_samples:
                high_extreme_fact = self._extract_tail_extremes(group_value, indices, y_list, direction="high")
                low_extreme_fact = self._extract_tail_extremes(group_value, indices, y_list, direction="low")
                
                if high_extreme_fact:
                    extreme_facts.append(high_extreme_fact)
                if low_extreme_fact:
                    extreme_facts.append(low_extreme_fact)
        
        return extreme_facts
    
    def _extract_tail_extremes(self, group_value: str, indices: list[int], y_list: list, direction: str):
        """ Extract extreme values using the Peaks Over Threshold (POT) method and GPD fitting. """
        y_array = np.array(y_list, dtype=float)
        
        if direction == "high":
            threshold = np.percentile(y_array, self.tail_percentile)
            exceedance_mask = y_array > threshold
            exceedances = y_array[exceedance_mask] - threshold
        else:
            # For extreme lows, invert the data and evaluate against the lower percentile threshold
            lower_percentile = 100.0 - self.tail_percentile
            threshold = np.percentile(y_array, lower_percentile)
            exceedance_mask = y_array < threshold
            exceedances = threshold - y_array[exceedance_mask]
            
        exceedance_indices = np.where(exceedance_mask)[0]
        
        # Require a minimum number of exceedances to perform a stable GPD fit
        if len(exceedances) < 3:
            return None
            
        try:
            # Fit Generalized Pareto Distribution (GPD)
            # 'c' represents the shape parameter (xi), 'scale' is sigma.
            # Location is fixed to 0 because the threshold has already been subtracted.
            c, loc, scale = genpareto.fit(exceedances, floc=0)
        except Exception:
            return None
            
        # Discard cases where the scale is degenerate
        if scale <= 1e-8:
            return None
            
        # Isolate the most severe extreme value within the exceedance subset
        max_exceedance_idx = np.argmax(exceedances)
        global_idx = exceedance_indices[max_exceedance_idx]
        extreme_val = y_array[global_idx]
        
        extreme_fact = ExtremeValueFact()
        subtype = "extreme_high" if direction == "high" else "extreme_low"
        
        data_points = [self.tabular_data[indices[global_idx]]]
        
        def generate_score():
            """
            Score is computed by standardizing the maximum exceedance against 
            the fitted GPD scale parameter, mapped through a sigmoid function.
            """
            max_exceedance = exceedances[max_exceedance_idx]
            z_evt = max_exceedance / scale
            
            k = 1.5
            z0 = 1.0
            score = expit(k * (z_evt - z0))
            
            return float(score)
            
        def generate_annotation_and_reason():
            """ Global, group-agnostic annotation focusing on tail behavior. """
            position = str(data_points[0].get(self.x_column))
            
            annotation, reason = "", ""
            
            if direction == "high":
                annotation = f"An extreme high tail value appears at {position}."
                reason = (
                    f"The {self.y_column} at {position} reaches {extreme_val:.2f}, "
                    f"exceeding the {self.tail_percentile}th percentile threshold ({threshold:.2f}). "
                    r"Fitted Generalized Pareto Distribution yields a shape parameter $\xi$ of " f"{c:.2f}, "
                    f"confirming heavy-tailed extreme behavior."
                )
            else:
                annotation = f"An extreme low tail value appears at {position}."
                reason = (
                    f"The {self.y_column} at {position} drops to {extreme_val:.2f}, "
                    f"falling below the {100.0 - self.tail_percentile}th percentile threshold ({threshold:.2f}). "
                    r"Fitted Generalized Pareto Distribution yields a shape parameter $\xi$ of " f"{c:.2f}, "
                    f"confirming heavy-tailed extreme behavior."
                )
                
            return annotation, reason
            
        score = generate_score()
        annotation, reason = generate_annotation_and_reason()
        
        extreme_fact.set_value(subtype, data_points, score, annotation, reason)
        
        return extreme_fact
