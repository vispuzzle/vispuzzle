// This file manages global variables used in the entire rendering process.
import Palette from "./palette.js";
import { format } from "d3-format";

class GlobalSettings {
  constructor() {
    this.clear();
  }

  // This function is called on every render request.
  // It clears all global variables.
  clear() {
    this.palette = new Palette();
    this.orderMaps = {};
    this.axesSettings = {};
    this.visNodesStr = "";
    this.visNodes = {};
    this.updateFlag = true;
    this.maxRepeats = 5; // Maximum number of pipeline iterations
    this.labelCharWidth = 12; // Average character width for label font (pixels)
    this.valueCharWidth = 8; // Average character width for value font (pixels)
    this.minBandWidth = 15; // Minimum band width for bar charts
    this.padding = 0.3; // innerPadding ratio (corresponds to bar chart paddingInner)
    this.format = function (value) {
      if (typeof value === "number") return format(".2~f")(value);
      else return value;
    };
    this.linkInfo = {}; // Stores link information
    this.fontSizeTable = {
      h1: 40,
      h2: 24,
      h3: 18,
      h4: 12,
    };
    this.minFontSize = 8;
    this.fontRatio = 1.0;
    this.orderColumns = [];
    this.axisSettingsAlias = {};
    this.cancelledLegendColumns = new Set();
    this.drawnImageIconGroups = new Set();
    this.drawnIconGroups = this.drawnImageIconGroups;
  }

  setConfig(config) {
    let {
      main_color,
      bcg,
      context_color,
      text_color,
      base_color,
      font,
      mapColorDefault,
      mapColorLow,
      mapColorHigh,
    } = config;
    this.helperColor = context_color;
    this.bcg = bcg;
    this.textColorLight = this.bcg;
    this.textColorDark = text_color;
    this.palette.setBaseColor(base_color);
    this.palette.setMainColor(main_color);
    this.mapColor = {
      default: mapColorDefault || "#D1E3E9",
      low: mapColorLow || "#B1D4E5",
      high: mapColorHigh || "#5A9BC6",
    };
    this.font = font;
  }

  setFont(g, type, fontSize = null) {
    if (!["title", "description", "label", "value", "legend"].includes(type)) {
      throw new Error(`Invalid font type: ${type}`);
    }
    fontSize = fontSize || this.fontSizeTable[this.font[type]["font-size"]];
    const fontFamily = this.font[type]["font-family"];
    const fontWeight = this.font[type]["font-weight"];
    const fontStyle = this.font[type]["font-style"];

    // set fontSize and fontFamily
    g.style("font-size", fontSize + "px");
    g.style("font-family", fontFamily);

    if (fontWeight === "bold") g.style("font-weight", fontWeight);
    if (fontStyle === "italic") g.style("font-style", fontStyle);

    return g;
  }

  getFontSize(type) {
    if (!["title", "description", "label", "value", "legend"].includes(type)) {
      throw new Error(`Invalid font type: ${type}`);
    }
    return this.fontSizeTable[this.font[type]["font-size"]];
  }

  // Check whether the pipeline needs another update
  checkUpdate() {
    this.maxRepeats--;
    if (this.maxRepeats < 0) {
      this.updateFlag = false;
    }
    return this.updateFlag;
  }

  // Store the original input visNodes
  storeNodes(nodes) {
    this.visNodesStr = JSON.stringify(nodes);
  }

  // Restore visNodes from visNodesStr
  // This function is called at the beginning of each pipeline iteration
  resetNodes() {
    this.visNodes = JSON.parse(this.visNodesStr);
  }

  // Modify the chart type of a visNode by id
  modifyChartType(id, chartType) {
    const nodes = JSON.parse(this.visNodesStr);
    const node = nodes[id];
    if (node && node.view.vis_type === "basic") {
      node.view.chart_type = chartType;
    }
    this.visNodesStr = JSON.stringify(nodes);
  }

  createOrderMap(values, weights = null) {
    // hack: for common pre-registered value lists, use the human-preferred order
    const preRegisteredValues = [
      ["Gold", "Silver", "Bronze"],
      ["USA", "Russia", "Germany", "UK", "China", "France"],
    ];
    for (const vlist of preRegisteredValues) {
      if (values.every((v) => vlist.includes(v))) {
        values = vlist.filter((v) => values.includes(v));
        weights = null;
        break;
      }
    }

    // hack: common ordering rules for specific value types
    const lastKeyWordsList = ["Unknown", "Other", "Others", "N/A", "NA"];
    for (const keyWord of lastKeyWordsList) {
      if (values.includes(keyWord)) {
        values = values.filter((v) => v !== keyWord);
        values.push(keyWord);
        weights = null;
      }
    }

    let sortedValues;
    if (weights !== null) {
      // Pair each value with its weight, sort by weight descending
      sortedValues = values
        .map((v, i) => ({ v, w: weights[i] }))
        .sort((a, b) => b.w - a.w)
        .map((obj) => obj.v);
    } else {
      // by original order
      sortedValues = values;
    }
    const orderMap = {};
    for (let i = 0; i < sortedValues.length; i++) {
      orderMap[sortedValues[i]] = i;
    }
    return orderMap;
  }

  registerOrderMap(columnName, values, weights = null) {
    if (!this.orderColumns.includes(columnName)) weights = null;

    const orderMap = this.createOrderMap(values, weights);
    this.orderMaps[columnName] = orderMap;
  }

  setAxisSettingsAlias(aliasMap = {}) {
    this.axisSettingsAlias =
      aliasMap && typeof aliasMap === "object" ? aliasMap : {};
  }

  resolveAxisSettingsKey(columnName) {
    return this.axisSettingsAlias?.[columnName] || columnName;
  }

  registerLink(field, nodeId1, nodeId2, pos1 = "inplace", pos2 = "inplace") {
    this.linkInfo = {
      field: field,
      ids: [nodeId1, nodeId2],
      nodes: [
        { id: nodeId1, pos: pos1 },
        { id: nodeId2, pos: pos2 },
      ],
      avoidRects: [],
      counts: [],
    };
  }

  registerColorMap(name, values, force = false, count = 1) {
    let _values = values;
    if (this.orderMaps[name]) {
      _values = [...values].sort(
        (a, b) => this.orderMaps[name][a] - this.orderMaps[name][b],
      );
    }
    this.palette.registerColorMap(name, _values, force, count);
  }

  registerImageIconGroup(groupKey) {
    if (groupKey === null || groupKey === undefined) return;
    this.drawnImageIconGroups.add(String(groupKey));
  }

  hasImageIconGroup(groupKey) {
    if (groupKey === null || groupKey === undefined) return false;
    return this.drawnImageIconGroups.has(String(groupKey));
  }

  clearImageIconGroups() {
    this.drawnImageIconGroups.clear();
  }
}

export const globalSettings = new GlobalSettings();
