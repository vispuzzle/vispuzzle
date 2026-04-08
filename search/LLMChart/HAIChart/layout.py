import pickle
from typing import List
import networkx as nx
import matplotlib.pyplot as plt
from search.utils import ViewNode, LayoutNode
from matplotlib.pyplot import plot, gcf

class CompositeLayout:
    def __init__(self, view_nodes: List[ViewNode]):
        self.view_nodes = view_nodes
        self.layout_nodes = [LayoutNode(view_node) for view_node in view_nodes]
        self.node_num = len(self.layout_nodes)
        for layout_node in self.layout_nodes:
            print(layout_node)
        self.graphs = self.construct_graphs()
        
    def construct_graph_X_X(self):
        G = nx.Graph()
        G.add_nodes_from(range(len(self.layout_nodes)))
        for i in range(len(self.layout_nodes)):
            for j in range(i+1, len(self.layout_nodes)):
                for X1 in self.layout_nodes[i].X:
                    for X2 in self.layout_nodes[j].X:
                        if X1 == X2:
                            G.add_edge(i, j, label=X1)
        return G
    
    def construct_graph_Y_Y(self):
        G = nx.Graph()
        G.add_nodes_from(range(len(self.layout_nodes)))
        for i in range(len(self.layout_nodes)):
            for j in range(i+1, len(self.layout_nodes)):
                for Y1 in self.layout_nodes[i].Y:
                    for Y2 in self.layout_nodes[j].Y:
                        if Y1 == Y2:
                            G.add_edge(i, j, label=Y1)
        return G
    
    def construct_graph_Z_Z(self):
        G = nx.Graph()
        G.add_nodes_from(range(len(self.layout_nodes)))
        for i in range(len(self.layout_nodes)):
            for j in range(i+1, len(self.layout_nodes)):
                for Z1 in self.layout_nodes[i].Z:
                    for Z2 in self.layout_nodes[j].Z:
                        if Z1 == Z2:
                            G.add_edge(i, j, label=Z1)
        return G
    
    def construct_graph_X_Z(self):
        G = nx.Graph()
        G.add_nodes_from(range(len(self.layout_nodes)))
        for i in range(len(self.layout_nodes)):
            for j in range(i+1, len(self.layout_nodes)):
                for X1 in self.layout_nodes[i].X:
                    for Z2 in self.layout_nodes[j].Z:
                        if X1 == Z2:
                            G.add_edge(i, j, label=X1)
                for X2 in self.layout_nodes[j].X:
                    for Z1 in self.layout_nodes[i].Z:
                        if X2 == Z1:
                            G.add_edge(i, j, label=X2)
        return G
    
    def construct_graphs(self, to_plot=True):
        G_X_X = self.construct_graph_X_X()
        G_Y_Y = self.construct_graph_Y_Y()
        G_Z_Z = self.construct_graph_Z_Z()
        G_X_Z = self.construct_graph_X_Z()
        if to_plot:
            # plot
            plt.figure(figsize=(12, 8))
            plt.subplot(221)
            nx.draw(G_X_X, with_labels=True)
            plt.title("X-X")
            plt.subplot(222)
            nx.draw(G_Y_Y, with_labels=True)
            plt.title("Y-Y")
            plt.subplot(223)
            nx.draw(G_Z_Z, with_labels=True)
            plt.title("Z-Z")
            plt.subplot(224)
            nx.draw(G_X_Z, with_labels=True)
            plt.title("X-Z")
            plot([0.5, 0.5], [0, 1], color='lightgreen', lw=5,transform=gcf().transFigure, clip_on=False)
            plot([0, 1], [0.5, 0.5], color='lightgreen', lw=5,transform=gcf().transFigure, clip_on=False)
            plt.savefig("html/graphs.png")
        return G_X_X, G_Y_Y, G_Z_Z, G_X_Z

    # def merge(self):
    #     pass
        
    # def layout(self):
    #     layout_nodes = self.layout_nodes.copy()
        
    
# read from best_views.pkl
with open('best_views.pkl', 'rb') as f:
    best_views = pickle.load(f)
    
composite_layout = CompositeLayout(best_views)
pass