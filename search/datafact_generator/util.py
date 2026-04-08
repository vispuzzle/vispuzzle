from typing import Any, Optional, Union

class DataFact:
    def __init__(self):
        # 用 dict 描述我们的 fact, 包含的 keys
        self.type: str = ""
        self.subtype: str = ""
        self.data_points: dict = {}
        self.score: float = 0.0
        self.annotation: str = ""
        self.reason: str = ""
        self.types = []

    def set_value(self,
                  subtype: Optional[str] = None,
                  data_points: Optional[dict] = None,
                  score: Optional[float] = None,
                  annotation: Optional[str] = None,
                  reason: Optional[str] = None
                  ):
        """ 设置各变量值 """
        if subtype is not None:
            if subtype in self.types:
                self.subtype = subtype
            else:
                print(f"Invalid type: {subtype}.")

        if data_points is not None:
            self.data_points = data_points

        if score is not None:
            self.score = score

        if annotation is not None:
            self.annotation = annotation

        if reason is not None:
            self.reason = reason

    def get_json(self):
        """ 返回 json 格式 """
        formated_json = {
            "type": self.type,
            "subtype": self.subtype,
            "data_points": self.data_points,
            "score": round(self.score, 4),
            "annotation": self.annotation,
            "reason": self.reason
        }
        return formated_json


class DataFactGenerator:
    def __init__(self, data: dict):
        self.data = data

        self.data_columns: dict[str, Any] = self.data["data"]["columns"]
        self.tabular_data: list[dict[str, Any]] = self.data["data"]["data"] # 原始数据

        self.grouped_data = divide_data_by_group(self.data_columns, self.tabular_data)

        # metadata
        self.x_column = self.data_columns[0]["name"]
        self.y_column = self.data_columns[1]["name"]
        self.group_column = self.data_columns[2]["name"] if len(self.data_columns) > 2 and self.data_columns[2]["data_type"] in ["categorical", "temporal"] else None

        is_temporal = False
        col = self.data_columns[0]
        if col["data_type"] == "temporal":
            is_temporal = True
        else:
            is_temporal = False
        self.is_temporal = is_temporal

def divide_data_by_group(data_columns: list[dict[str, Any]], data: list[dict[str, Any]]) -> dict[str, dict[str, list[Any]]]:
    x_column = data_columns[0]["name"]
    y_column = data_columns[1]["name"]
    group_column = data_columns[2]["name"] if len(data_columns) > 2 and data_columns[2]["data_type"] in ["categorical", "temporal"] else None
    grouped_data = {}

    for idx, row in enumerate(data):
        group_value = row.get(group_column, "")

        if group_value not in grouped_data.keys():
            grouped_data[group_value] = {
                "indices": [],
                "x_list": [],
                "y_list": []
            }
        grouped_data[group_value]["indices"].append(idx)
        grouped_data[group_value]["x_list"].append(row[x_column])
        grouped_data[group_value]["y_list"].append(row[y_column])

    return grouped_data

def ordinal(n: int): # 序数词
    n = int(n)
    if 10 <= n % 100 <= 20:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f"{n}{suffix}"