import * as d3 from "d3";
import { globalSettings } from "../global.js";
import {
  extractChartType,
  extractCondition,
  extractOperation,
  setChildrenOption,
} from "../../utils/node.js";
import { approxAxisMargin } from "../../utils/adjust.js";
import {
  scaleChartSize,
  setBoundingBox,
  setPolarBoundingBox,
  translate,
} from "../../utils/geometry.js";
import {
  getValueField,
  getXMinMaxValues,
  getYMinMaxValues,
  columnAggregate,
} from "../../utils/maths.js";
import { getLabelPos, resolveMapProjection } from "../../utils/vis.js";
import { recommendAspectRatio } from "../aspect.js";

const labelHeight = 50;
const interoperableValueGroups = [["UK", "England"]];

function getInteroperableValues(value) {
  for (const group of interoperableValueGroups) {
    if (group.includes(value)) {
      return group;
    }
  }
  return [value];
}

export async function handleCoordinateMode(root) {
  chartTypeDerivation(root);
  initBasicCharts(root);
  generateLayout(root);
}

export async function postprocessCoordinateMode(root) {
  processAxisMargin(root);
  setColorsForBasicCharts(root);
  addTextNode(root);
  for (const child of root.children[1].children) {
    if (child.chart_type.endsWith("pie")) {
      const config = child.chart.config;
      setPolarBoundingBox(config);
      child.coordinate_system = "polar";
    }
  }
  setBoundingBox(root);
}

function chartTypeDerivation(root) {
  for (const child of root.children) {
    if (child.vis_type !== "basic") {
      for (const grandChild of child.children) {
        grandChild.chart_type = "v" + grandChild.chart_type;
        grandChild.coordinate_system = "cartesian";
      }
    } else {
      if (child.chart_type !== "map") {
        child.chart_type = "v" + child.chart_type;
      }
    }
    child.coordinate_system = "cartesian";
  }
  root.coordinate_system = "cartesian";
}

function initBasicCharts(root) {
  let currentTop = 100;
  let currentLeft = 100;
  const hostNode = root.children[0];
  const worldMap =
    hostNode.X.name.toLowerCase() === "country" ||
    hostNode.X.name.toLowerCase() === "region";
  let [width, height] = worldMap ? [1500, 750] : [1500, 1200];
  const chart = {
    X: hostNode.X,
    Y: hostNode.Y,
    config: {
      top: currentTop,
      left: currentLeft,
      height: height,
      width: width,
      innerRadius: 0,
      outerRadius: 150,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      order: null,
      color: null,
      xAxis: {
        display: "none",
        direction: "default",
        name: hostNode.X.name,
      },
      yAxis: {
        display: "none",
        direction: "default",
        name: hostNode.Y.name,
      },
      options: {},
    },
    chartType: hostNode.chart_type,
  };
  if (hostNode.chart_type === "map") {
    chart.config.mapType = resolveMapProjection(hostNode, worldMap);
  }
  hostNode.chart = chart;
  const clientNode = root.children[1];
  if (clientNode.vis_type === "composite") {
    const [type, columnName] = extractOperation(clientNode.operation);
    const unionData = {
      data: clientNode.children.map(
        (child) => extractCondition(child.conditions)[columnName],
      ),
      name: columnName,
    };
    clientNode.chart.unionData = unionData;
    const [yMin, yMax] = getYMinMaxValues(clientNode);
    const [xMin, xMax] = getXMinMaxValues(clientNode);
    for (const child of clientNode.children) {
      let width = 150;
      let height = 150;
      let order = null;
      // Register order mapping
      if (child.X.data[0].every((x) => typeof x === "string")) {
        if (!globalSettings.orderMaps[child.X.name]) {
          globalSettings.registerOrderMap(
            child.X.name,
            child.X.data[0],
            columnAggregate(child.Y.data),
          );
        }
        order = globalSettings.orderMaps[child.X.name];
        order = Object.keys(order).sort((a, b) => order[a] - order[b]);
      }

      const aspectRatio = recommendAspectRatio(child)[0];
      if (aspectRatio >= 1) height = width / aspectRatio;
      else width = height * aspectRatio;

      // Register color mapping
      if (
        (child.chart_type.endsWith("pie") ||
          child.chart_type.endsWith("bar") ||
          child.chart_type.endsWith("parea")) &&
        child.X.data[0].length > 1
      ) {
        const xName = child.X.name;
        const xValues = child.X.data[0];
        globalSettings.registerColorMap(xName, xValues, false);
      }

      const chart = {
        X: child.X,
        Y: child.Y,
        config: {
          top: currentTop,
          left: currentLeft,
          height: height,
          width: width,
          innerRadius: 0,
          outerRadius: 150,
          startAngle: 0,
          endAngle: 2 * Math.PI,
          order: order,
          color: null,
          xAxis: {
            display: "none",
            direction: "default",
            name: child.X.name,
          },
          yAxis: {
            display: "none",
            direction: "default",
            name: child.Y.name,
          },
          label: {
            display: "bottom",
            value: extractCondition(child.conditions)[columnName],
          },
          yMin: yMin,
          yMax: yMax,
          xMin: xMin,
          xMax: xMax,
          valueField: getValueField(child),
          options: {},
        },
        chartType: child.chart_type,
      };

      if (child.chart_type.endsWith("pie")) {
        chart.config.yAxis.display = "none";
      }

      if (chart.config.label.display === "top") {
        // Reserve more space for the label
        chart.config.height += labelHeight;
      }

      child.chart = chart;
      currentTop += Math.max(width, height);
      currentLeft += Math.max(width, height);
    }

    if (root.spatial_distribution === "proportional") {
      if (clientNode.children[0]?.chart_type.endsWith("pie")) {
        scaleChartSize(clientNode.children, 60, 120);
      } else {
        scaleChartSize(clientNode.children, 150, 280);
      }
    }
  } else if (clientNode.vis_type === "basic") {
    if (!clientNode.chart_type.endsWith("bar")) {
      // Currently only coordinated bar chart is supported
      throw new Error("Coordinated chart only supports bar chart");
    }
    clientNode.chart_type = "cobar"; // alias from: COordinated BAR chart
    const hostCfg = hostNode.chart.config;
    const chart = {
      X: clientNode.X,
      Y: clientNode.Y,
      config: {
        top: hostCfg.top,
        left: hostCfg.left,
        height: hostCfg.height,
        width: hostCfg.width,
        order: null,
        color: null,
        xAxis: {
          display: "none",
          direction: "default",
          name: clientNode.X.name,
        },
        yAxis: {
          display: "none",
          direction: "default",
          name: clientNode.Y.name,
        },
        options: {},
      },
      chartType: clientNode.chart_type,
    };
    clientNode.chart = chart;
  }
}

function processAxisMargin(root) {
  for (const node of root.children) {
    if (node.chart_type !== "map") {
      for (const child of node.children) {
        if (child.chart.config.xAxis) {
          child.chart.config.xAxis.size = approxAxisMargin(child, "x", false);
        }
        if (child.chart.config.yAxis) {
          child.chart.config.yAxis.size = approxAxisMargin(child, "y", false);
        }
      }
    }
  }
}

function setColorsForBasicCharts(root) {
  const clientNode = root.children[1];
  if (clientNode.vis_type === "basic") {
    clientNode.chart.config.color = globalSettings.palette.getColorMap("")[0]();
  }
  for (const child of clientNode.children) {
    const chartType = extractChartType(child.chart_type);
    if (
      (chartType[2] === "bar" ||
        chartType[2] === "pie" ||
        chartType[2] === "parea") &&
      clientNode.children[0].X.data[0].length > 1
    ) {
      // bar/pie/parea: may need color encoding
      const [colorMap, _] = globalSettings.palette.getColorMap(child.X.name);
      child.chart.config.color = colorMap;
    } else if (
      chartType[2] === "line" ||
      chartType[2] === "scatter" ||
      clientNode.children[0].X.data[0].length === 1
    ) {
      // line/scatter: no color encoding needed
      const [colorMap, _] = globalSettings.palette.getColorMap("");
      child.chart.config.color = colorMap("");
    }
  }
}

function generateLayout(root) {
  const hostNode = root.children[0];
  const clientNode = root.children[1];
  const labelPosition = getLabelPos(hostNode);

  const { top, left } = hostNode.chart.config;
  if (clientNode.vis_type === "composite") {
    // Normal coordinate pattern
    for (const child of clientNode.children) {
      const conditionValue = extractCondition(child.conditions)[
        hostNode.X.name
      ];
      const { cx = NaN, cy = NaN } = labelPosition[conditionValue];

      if (!isNaN(cx) && !isNaN(cy)) {
        const config = child.chart.config;
        const dx = left + cx - (config.left + config.width / 2);
        const dy = top + cy - (config.top + config.height / 2);
        translate(child, dx, dy);
      } else {
        throw new Error(`Cannot calculate position for ${conditionValue}`);
      }
      if (!child.chart.config.options) {
        child.chart.config.options = {};
      }
      child.chart.config.options.chartStyle = "pin";
      if (child.chart_type.endsWith("pie")) {
        child.chart.config.options.enableCoordinateRotation = true;
      }
    }
  } else if (clientNode.vis_type === "basic") {
    // coordinated bar chart
    clientNode.chart.config.labelPosition = labelPosition;
  }

  // add value field and color encoding for map
  if (hostNode.chart_type === "map") {
    let minEncodingValue = Number.MAX_VALUE;
    let maxEncodingValue = -Number.MAX_VALUE;
    let colorName = null;
    if (
      clientNode.vis_type === "basic" &&
      hostNode.X.name === clientNode.X.name
    ) {
      colorName = clientNode.Y.name;
      const name = clientNode.X.name;
      const data = d3
        .zip(clientNode.X.data[0], clientNode.Y.data[0])
        .map(([x, y]) => ({ x, y }));
      hostNode.X.data.features.forEach((feature) => {
        const candidates = getInteroperableValues(feature.properties[name]);
        const value = data.find((d) => candidates.includes(d.x));
        if (value) {
          feature.properties["valueField"] = value.y;
          minEncodingValue = Math.min(minEncodingValue, value.y);
          maxEncodingValue = Math.max(maxEncodingValue, value.y);
        }
      });
    } else if (clientNode.vis_type === "composite") {
      colorName = "SUM OF " + clientNode.children[0].Y.name;
      const name = extractOperation(clientNode.operation)[1];
      hostNode.X.data.features.forEach((feature) => {
        const candidates = getInteroperableValues(feature.properties[name]);
        const child = clientNode.children.find((child) => {
          const conditionValue = extractCondition(child.conditions)[name];
          return candidates.includes(conditionValue);
        });
        if (child) {
          const sumValue = getValueField(child);
          feature.properties["valueField"] = sumValue;
          minEncodingValue = Math.min(minEncodingValue, sumValue);
          maxEncodingValue = Math.max(maxEncodingValue, sumValue);
        }
      });
    }

    if (minEncodingValue < maxEncodingValue) {
      hostNode.chart.config.colorName = colorName;
      hostNode.chart.config.valueField = "valueField";
      hostNode.chart.config.color = d3
        .scaleLinear()
        .domain([minEncodingValue, maxEncodingValue])
        .range([globalSettings.mapColor.low, globalSettings.mapColor.high]);
    }
  }

  if (
    clientNode.vis_type === "composite" &&
    clientNode.children[0].chart_type.endsWith("bar")
  ) {
    setChildrenOption(clientNode, "showBaseline", false);
    setChildrenOption(clientNode, "showValues", false);
    setChildrenOption(clientNode, "style", "shadow");
  }
}

function addTextNode(root) {
  const clientNode = root.children[1];
  for (const child of clientNode.children) {
    const config = child.chart.config;
    if (config.label) {
      let [top, left] = [config.top, config.left];
      switch (config.label.display) {
        case "top":
          // No need to adjust top/left
          // Adjust the original chart bounding box
          config.top += labelHeight;
          config.height -= labelHeight;
          break;
        case "bottom":
          if (config.options?.chartStyle === "pin") {
            top = config.top + config.height / 2 + 10;
          } else {
            top = config.top + config.height + 30;
          }
          break;
        case "left":
          left = config.left - 100;
          top = config.top + config.height / 2 - labelHeight / 2;
          break;
        case "right":
          left = config.left + config.width;
          top = config.top + config.height / 2 - labelHeight / 2;
          break;
        default:
          throw new Error(
            "Unsupported label display type: " + config.label.display,
          );
      }

      clientNode.children.push({
        vis_type: "basic",
        chart_type: "text",
        parent: root,
        coordinate_system: "cartesian",
        children: [],
        chart: {
          chartType: "text",
          config: {
            top: top,
            left: left,
            width: config.width,
            height: labelHeight,
            color: globalSettings.textColorDark,
            size: globalSettings.getFontSize("label"),
            fontType: "label",
            opacity: 1,
          },
          data: config.label.value,
        },
      });
    }
  }
}
