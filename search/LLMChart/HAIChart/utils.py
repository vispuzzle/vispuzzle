from datetime import date, datetime
import numpy as np

INF = 1e9

def sigmoid(z):
    z = np.clip(z, -100, 100)
    return 1 / (1 + np.exp(-z))

class ViewNode:
    def __init__(self):
        self.chart = ""
        self.x_name = ""
        self.y_name = ""
        self.group_by = []
        self.groups = []
        self.bin = None
        self.bin_by = None
        self.agg = None
        self.score = None
        self.describe = ""
        self.data_columns = set()
        self.X = None
        self.Y = None
        self.x_type = None
        self.y_type = None
        
    def __str__(self):
        split_describe = self.describe.split(", ")
        return (
            f"{self.score:.2f}, {self.chart}\nx:{self.x_name}, y:{self.y_name}\n"
            + "\n".join(split_describe)
        )

    def __str__(self):
        return f"chart: {self.chart}, x_name: {self.x_name}, y_name: {self.y_name}, describe: [{self.describe}], group_by: {self.group_by}, bin: {self.bin}, bin_by: {self.bin_by}, agg: {self.agg}, data columns: {self.data_columns}, score: {self.score}"

    def get_relation_score(self, other):
        """
        Get the relationship score for two view nodes.
        Naive score: [number of common data columns] / [number of all data columns]
        """
        if len(self.data_columns) == 0 or len(other.data_columns) == 0:
            raise ValueError("Data columns are not initialized.")
        common_columns = self.data_columns.intersection(other.data_columns)
        all_columns = self.data_columns.union(other.data_columns)
        if len(common_columns) == len(all_columns):
            return 0
        return len(common_columns) / len(all_columns)

    def parse(self, key, value):
        self.score = sigmoid(value.score)
        p1 = key.find("chart: ")
        p2 = key.find(" x_name: ")
        p3 = key.find(" y_name: ")
        p4 = key.find(" describe: ")
        self.chart = key[p1 + 7 : p2]
        self.describe = key[p4 + 11 :]
        self.x_name = key[p2 + 9 : p3]

        # deal with case like "y_name: avg(A)"
        y_name_tmp = key[p3 + 9 : p4]
        if (
            y_name_tmp.startswith("avg(")
            or y_name_tmp.startswith("sum(")
            or y_name_tmp.startswith("cnt(")
        ):
            self.agg = y_name_tmp[:3]
        #     self.y_name = y_name_tmp[4:-1]
        # else:
        self.y_name = y_name_tmp

        # 从describe中提取group by A 和 bin A by B，可能有多个group by
        each = self.describe.split(", ")
        for e in each:
            if e.startswith("group by"):
                p = e.find("group by ")
                group_by = e[p + 9 :]
                if group_by == self.x_name:
                    continue
                self.group_by.append(group_by)
            elif e.startswith("bin") or e.startswith("5 bin") or e.startswith("10 bin"):
                p1 = e.find("bin ")
                p2 = e.find(" by ")
                bin = e[p1 + 4 : p2]
                bin_by = e[p2 + 4 :]
                self.bin = bin
                self.bin_by = bin_by

                # deal with case when x_name is (bin)/(bin_by) like "born/(year)"
                if self.x_name == f"{self.bin}/({self.bin_by})":
                    self.x_name = self.bin

        # get all the possible data columns for further analysis
        self.data_columns.add(self.x_name)
        self.data_columns.add(self.y_name)
        for g in self.group_by:
            self.data_columns.add(g)
        if self.bin:
            self.data_columns.add(self.bin)
        self.groups = [name for name, count in value.table.classes]
        handle_interval = False
        if self.chart == "line":
            handle_interval = True
        self.X = self.convert_to_isofmt(value.X, handle_interval)
        self.Y = self.convert_to_isofmt(value.Y)
        self.x_type = value.fx.type
        self.y_type = value.fy.type
        
    def convert_to_isofmt(self, data, handle_interval=False):
        if isinstance(data, list):
            res = [self.convert_to_isofmt(item, handle_interval) for item in data]
            if len(res) > 0 and isinstance(res[0], str):
                if all([x.endswith("-01-01") for x in res]):
                    return [x[:-6] for x in res]
            if handle_interval:
                for i in range(len(res)):
                    if isinstance(res[i], str) and "~" in res[i]:
                        res[i] = res[i].split("~")[0]
            return res
        elif isinstance(data, (datetime, date)):
            return data.isoformat()
        elif isinstance(data, (int, float)):
            return data
        else:
            return str(data)