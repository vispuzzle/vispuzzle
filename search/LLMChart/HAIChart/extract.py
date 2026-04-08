from datetime import datetime
import os
import random
import time
import json
import pandas as pd
import search.LLMChart.HAIChart.tools as tools
from search.mcgs import MCGS, Node
import networkx as nx
import matplotlib.pyplot as plt 


UPLOAD_FOLDER = 'datasets'
HTML_FOLDER = 'html'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(HTML_FOLDER, exist_ok=True)
constraints = {
    '[T]': [],
    '[X]': [],
    '[Y]': [],
    '[AggFunction]': [],
    '[G]': [],
    '[TransForm]': [],
    '[B]': []
}

haichart = tools.haichart("mcgs")
mcgs = MCGS()
history_score = {}  
dict_sorted = []
current_view = []
good_view = {}
curr_filename = ""
curr_hints = []

def upload_dataset(filename):
    global curr_filename,constraints,history_score,mcgs,dict_sorted,current_view,good_view,haichart,user_log_name  # 声明 curr_filename 为全局变量

    mcgs = MCGS()
    Node.global_node_storage = {}
    good_view = {}
    history_score = {}
    curr_filename = ""

    constraints = {
        '[T]': [],
        '[X]': [],
        '[Y]': [],
        '[AggFunction]': [],
        '[G]': [],
        '[TransForm]': [],
        '[B]': []
    }


    file_path = os.path.join(UPLOAD_FOLDER, filename)
    df = pd.read_csv(file_path)
    df = df.dropna()
    df.to_csv(file_path, index=False)

   
    start_time = time.time()  
    start_time_formatted = datetime.fromtimestamp(start_time).strftime('%Y-%m-%d %H:%M:%S')  

    # user_log_name = f"multi_turn_log/user_log_{start_time}_{filename.split('.')[0]}.csv"  
    
    # record_event(user_log_name,'DATASET_REQUEST', json.dumps({"name": filename.split('.')[0]}))

    # with open(logname, 'a') as file:
    #     file.write(f"-----------time{start_time_formatted}---dataset{file_path}---------------------\n")


    df = pd.read_csv(file_path)
    sample_data = df.head(10).values.tolist() 


    haichart.from_csv(file_path)
    print(file_path)
    haichart.learning_to_rank()
    haichart.eh_view = haichart.output_list("list")


    # querys = [item[0] for item in dict_sorted]  
    # record_event(user_log_name,'RESULT_RECEIVE', json.dumps(querys))
    # record_event(user_log_name,'RESULT_HINTS', json.dumps(suggestions))
    # print(columns_info)
    dict_sorted = haichart.eh_view.items()
    t_name = filename.split('.')[0]
    haichart.to_single_html(dict_sorted, t_name)
    return {
        'fileName': filename,
        'constraints': constraints,
        'sampleData': sample_data,
        'eh_view': haichart.eh_view,
    }

    
if __name__ == '__main__':
    filename = "fg.csv"
    upload_result = upload_dataset(filename)
    eh_view = upload_result['eh_view']
    print(eh_view)
    print(len(eh_view))
    keys = list(eh_view.keys())
    # chart: bar x_name: organizationcountry y_name: sum(age) describe: group by gender, group by organizationcountry
    # 将每个key的chart, x_name, y_name, describe提取出来
    vega_zeros = []
    for key in keys:
        # find place of chart: 
        p1 = key.find("chart: ")
        p2 = key.find(" x_name: ")
        p3 = key.find(" y_name: ")
        p4 = key.find(" describe: ")
        chart = key[p1+7:p2]
        x_name = key[p2+9:p3]
        y_name = key[p3+9:p4]
        describe = key[p4+11:]
        res = {"chart": chart, "x_name": x_name, "y_name": y_name, "describe": describe, "group_by": [], "bin": []}
        
        # 从describe中提取group by A和bin A by B，可能有多个group by
        each = describe.split(", ")
        for e in each:
            if e.startswith("group by"):
                p = e.find("group by ")
                group_by = e[p+9:]
                res["group_by"].append(group_by)
            elif e.startswith("bin"):
                p = e.find("bin ")
                p2 = e.find(" by ")
                bin_name = e[p+4:p2]
                bin_by = e[p2+4:]
                res["bin"].append(bin_name)
        vega_zeros.append(res)
    print(vega_zeros)
    # indexes = random.sample(range(len(vega_zeros)), 10)
    # print(indexes)
    # vega_zeros = [vega_zeros[i] for i in indexes]
    # # 以vega_zeros的元素为节点，构建图
    # G = nx.MultiGraph()
    # for i, v in enumerate(vega_zeros):
    #     G.add_node(i, chart=v["chart"], x_name=v["x_name"], y_name=v["y_name"], describe=v["describe"])
        
    # pos = nx.spring_layout(G)
    # plt.figure(figsize=(8, 8))
    # nx.draw(G, pos, with_labels=False, node_size=5000, node_color="lightblue", edge_color="gray")
    # node_labels = {node: f"{G.nodes[node]['chart']}\nx: {G.nodes[node]['x_name']}\ny: {G.nodes[node]['y_name']}\n{G.nodes[node]['describe']}" for node in G.nodes()}
    # nx.draw_networkx_labels(G, pos, labels=node_labels)
    # # 根据相同的chart, x_name, y_name, group_by, bin进行连线
    # colors = ["red", "green", "blue", "yellow", "purple", "orange", "pink", "brown", "black", "gray"]
    # # chart, 
    # for i in range(len(vega_zeros)):
    #     for j in range(i+1, len(vega_zeros)):
    #         if vega_zeros[i]["chart"] == vega_zeros[j]["chart"]:
    #             G.add_edge(i, j, color=colors[0])
    
    # # x_name, y_name
    # for i in range(len(vega_zeros)):
    #     for j in range(i+1, len(vega_zeros)):
    #         if vega_zeros[i]["x_name"] == vega_zeros[j]["x_name"] or vega_zeros[i]["y_name"] == vega_zeros[j]["y_name"]:
    #             G.add_edge(i, j, color=colors[1])
                
    # # group_by
    # for i in range(len(vega_zeros)):
    #     for j in range(i+1, len(vega_zeros)):
    #         # 遍历group_by
    #         for group_by in vega_zeros[i]["group_by"]:
    #             if group_by in vega_zeros[j]["group_by"]:
    #                 G.add_edge(i, j, color=colors[2])
    #                 break
    # # bin
    # for i in range(len(vega_zeros)):
    #     for j in range(i+1, len(vega_zeros)):
    #         # 遍历bin
    #         for bin_by in vega_zeros[i]["bin"]:
    #             if bin_by in vega_zeros[j]["bin"]:
    #                 G.add_edge(i, j, color=colors[3])
    #                 break
    # edge_colors = nx.get_edge_attributes(G, 'color').values()
    
    # nx.draw_networkx_edges(G, pos, edge_color=edge_colors)
    
    # plt.savefig("graph.png")
    # plt.show()
    