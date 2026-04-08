// This file defines the core functions to process data and create charts.

import * as d3 from "d3";
import {
  createVerticalBarChart,
  createHorizontalBarChart,
  createVerticalStackBarChart,
  createHorizontalStackBarChart,
  createVerticalGroupBarChart,
  createHorizontalGroupBarChart,
  createRadialBarChart,
  createCircularBarChart,
  createRadialStackBarChart,
  createCircularStackBarChart,
  createRadialGroupBarChart,
  createCircularGroupBarChart,
  createVerticalProportionalAreaChart,
  createHorizontalProportionalAreaChart,
  createRadialProportionalAreaChart,
  createCoordinateBarChart,
  createRadialWaffleChart,
} from "../components/bar.js";
import {
  createVerticalLineChart,
  createHorizontalLineChart,
  createRadialLineChart,
} from "../components/line.js";
import {
  createVerticalScatterPlot,
  createHorizontalScatterPlot,
  createRadialScatterPlot,
  createCircularScatterPlot,
} from "../components/scatter.js";
import { createDonutChart } from "../components/pie.js";
import { createMap } from "../components/map.js";
import { createCartesianBorder } from "../components/helper.js";
import {
  addAxisNameCartesian,
  addAxisNameCartesianLink,
  addAxisNamePolar,
  createMirrorAxis,
} from "../components/axis.js";
import {
  createVerticalLinkChart,
  createHorizontalLinkChart,
} from "../components/link.js";
import { extractChartType, getInputData } from "../utils/node.js";
import { createText } from "../components/text.js";
import { createCirclePacking } from "../components/circlePacking.js";
import { createGraph } from "../components/graph.js";
import { createIcon, createChartLegend } from "../components/icon.js";
import { jsonizeData } from "../utils/dataJsonizer.js";
import { createLinkPath } from "../components/elements.js";
import { globalSettings } from "./global.js";
import { iconMaps } from "../utils/iconMap.js";

const iconMargin = 100;
const iconSize = 50;

/**
 * Core function to process data and create chart
 *
 * @param {Object} g - The `<g>` element to render the chart in.
 * @param {*} data - The data to be processed.
 * @param {boolean} polar - Whether the chart is polar or not.
 */
export async function processBasicChart(g, data, polar) {
  const config = data.config;
  if (data.Y && data.Y.name) {
    config.options = config.options || {};
    config.options.yName = data.Y.name;
  }

  const chartTitle =
    data.config.title ||
    `${data.X?.name || "Data"} vs ${data.Y?.name || "Value"} Chart`;
  const options = {
    title: chartTitle,
    description: `Visualization of ${data.X?.name || "categories"} and their corresponding ${data.Y?.name || "values"}.`,
    mainInsight: `Key insights from the comparison of ${data.X?.name || "data"}.`,
  };
  data.jsonizedData = jsonizeData(data, options);

  // TODO: remove this line. For test only.
  // config.options.style = config.options.style || "sketch";

  const [dx, dy] =
    !polar && !data.chartType.endsWith("pie")
      ? [config.left, config.top]
      : [config.cx, config.cy];
  g.attr("transform", `translate(${dx}, ${dy})`);
  // g.style("pointer-events", "none");

  let inputData = getInputData(data);

  const dataFreeChartTypes = [
    "text",
    "circle-packing",
    "map",
    "graph",
    "visual-link",
    "mirror-axis",
  ]; // Chart types without X and Y

  if (config.xAxis?.icon) {
    const options = {
      lineStyle: config.lineStyle,
    };
    if (config.xAxis.display === "top") {
      createIcon(
        g,
        -iconMargin - iconSize,
        config.width / 2 - iconSize / 2,
        iconSize,
        iconSize,
        config.xAxis.icon,
        options,
      );
    } else if (config.xAxis.display === "bottom") {
      createIcon(
        g,
        config.height + iconMargin,
        config.width / 2 - iconSize / 2,
        iconSize,
        iconSize,
        config.xAxis.icon,
        options,
      );
    } else {
      console.warn("xAxis has icon, but is invisible.");
    }
  }

  if (config.yAxis?.icon) {
    const options = {
      lineStyle: config.lineStyle,
    };
    if (config.yAxis.display === "left") {
      createIcon(
        g,
        config.height / 2 - iconSize / 2,
        -iconMargin - iconSize,
        iconSize,
        iconSize,
        config.yAxis.icon,
        options,
      );
    } else if (config.yAxis.display === "right") {
      createIcon(
        g,
        config.height / 2 - iconSize / 2,
        config.width + iconMargin,
        iconSize,
        iconSize,
        config.yAxis.icon,
        options,
      );
    } else {
      console.warn("yAxis has icon, but is invisible.");
    }
  }

  let labelPosition = null; // label position within the D3 selection (g), format: {v0: {x: x0, y: y0}, ...]
  let field = null; // field used as the label
  let pos = null; // label position option, ["left", "right", "top", "bottom"]
  if (globalSettings.linkInfo.ids?.includes(data.id)) {
    field = globalSettings.linkInfo.field;
    globalSettings.linkInfo.nodes.forEach((n) => {
      if (n.id === data.id) pos = n.pos;
    });
  }

  config.options = config.options || {};
  config.options["returns"] = {
    pos: pos,
    field: field,
  };

  if (config.options.border && !polar) createCartesianBorder(g, config);

  switch (data.chartType) {
    case "vbar": {
      config.options.xName = data.X?.name;
      if (!config.options.icons) config.options.icons = {};
      if (iconMaps[config.options.xName]) {
        config.options.icons[config.options.xName] =
          iconMaps[config.options.xName];
      }
      labelPosition = createVerticalBarChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "hbar": {
      config.options.xName = data.X?.name;
      if (!config.options.icons) config.options.icons = {};
      if (iconMaps[config.options.xName]) {
        config.options.icons[config.options.xName] =
          iconMaps[config.options.xName];
      }
      labelPosition = createHorizontalBarChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "vsbar": {
      labelPosition = createVerticalStackBarChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "hsbar": {
      labelPosition = createHorizontalStackBarChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "vgbar": {
      labelPosition = createVerticalGroupBarChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "hgbar": {
      labelPosition = createHorizontalGroupBarChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "rbar": {
      labelPosition = createRadialBarChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "rsbar": {
      labelPosition = createRadialStackBarChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "rgbar": {
      labelPosition = createRadialGroupBarChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "cbar": {
      labelPosition = createCircularBarChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "csbar": {
      labelPosition = createCircularStackBarChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "cgbar": {
      labelPosition = createCircularGroupBarChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "vparea": {
      labelPosition = createVerticalProportionalAreaChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.xAxis.direction,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "hparea": {
      labelPosition = createHorizontalProportionalAreaChart(
        inputData,
        g,
        config.height,
        config.width,
        config.yAxis.display,
        config.yAxis.direction,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "rparea": {
      labelPosition = createRadialProportionalAreaChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.xAxis.direction,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "cobar": {
      createCoordinateBarChart(
        inputData,
        g,
        config.color,
        config.labelPosition,
        config.options,
      );
      break;
    }
    case "vline":
    case "vsline": {
      if (data.neighbors.outer?.composite_pattern === "repetition") {
        const gridMargin = config.options.gridMargin || {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        };
        if (data.neighbors.top) {
          const neighbor = data.neighbors.top;
          const gap =
            data.config.top -
            (neighbor.chart.config.top + neighbor.chart.config.height);
          if (gap > 0) gridMargin.top = gap / 2;
        }
        if (data.neighbors.bottom) {
          const neighbor = data.neighbors.bottom;
          const gap =
            neighbor.chart.config.top - (data.config.top + data.config.height);
          if (gap > 0) gridMargin.bottom = gap / 2;
        }
        config.options.gridMargin = gridMargin;

        if (
          config.xAxis.display !== "none" ||
          config.yAxis.display !== "none"
        ) {
          config.options.axisColor = globalSettings.helperColor;
        }
      }
      createVerticalLineChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.padding,
        config.options,
      );
      break;
    }
    case "hline":
    case "hsline": {
      if (data.neighbors.outer?.composite_pattern === "repetition") {
        const gridMargin = config.options.gridMargin || {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        };
        if (data.neighbors.left) {
          const neighbor = data.neighbors.left;
          const gap =
            data.config.left -
            (neighbor.chart.config.left + neighbor.chart.config.width);
          if (gap > 0) gridMargin.left = gap / 2;
        }
        if (data.neighbors.right) {
          const neighbor = data.neighbors.right;
          const gap =
            neighbor.chart.config.left - (data.config.left + data.config.width);
          if (gap > 0) gridMargin.right = gap / 2;
        }
        config.options.gridMargin = gridMargin;

        if (
          config.xAxis.display !== "none" ||
          config.yAxis.display !== "none"
        ) {
          config.options.axisColor = globalSettings.helperColor;
        }
      }
      createHorizontalLineChart(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.padding,
        config.options,
      );
      break;
    }
    case "rline":
    case "rsline": {
      createRadialLineChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
      );
      break;
    }
    case "cline":
    case "csline": {
      throw new Error("Circular line chart is BAD !!!");
    }
    case "vscatter":
    case "vsscatter": {
      createVerticalScatterPlot(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "hscatter":
    case "hsscatter": {
      createHorizontalScatterPlot(
        inputData,
        g,
        config.height,
        config.width,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "rscatter":
    case "rsscatter": {
      createRadialScatterPlot(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "cscatter":
    case "csscatter": {
      createCircularScatterPlot(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.xAxis.display,
        config.yAxis.display,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "vpie":
    case "hpie":
    case "cpie":
    case "rpie": {
      if (
        data.X.name === globalSettings.palette.getMajorColorName().toLowerCase()
      ) {
        config.options.showNames = false;
      }
      if (
        config.options?.enableCoordinateRotation &&
        typeof config.cx === "number" &&
        typeof config.cy === "number"
      ) {
        config.options.rotationAnchor = {
          x: config.cx,
          y: config.cy,
        };
      }
      labelPosition = createDonutChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.order,
        config.color,
        config.options,
      );
      break;
    }
    case "vlink": {
      config.width2 = config.width;
      const vlabel = config.xAxis.size && config.xAxis.size > 45 ? true : false;
      const vlabel2 =
        config.xAxis2.size && config.xAxis2.size > 45 ? true : false;

      config.options.xName = data.X?.name;
      config.options.labelName = data.label_name;

      if (!config.options.icons) config.options.icons = {};
      if (iconMaps[config.options.xName]) {
        config.options.icons[config.options.xName] =
          iconMaps[config.options.xName];
      }
      if (iconMaps[config.options.labelName]) {
        config.options.icons[config.options.labelName] =
          iconMaps[config.options.labelName];
      }

      createVerticalLinkChart(
        inputData,
        g,
        config.height,
        config.width,
        config.width2,
        config.operationPos,
        config.xAxis.display,
        config.xAxis.direction,
        config.xAxis2.display,
        config.xAxis2.direction,
        config.order,
        config.order2,
        config.color,
        config.colorMapping,
        vlabel,
        vlabel2,
        config.options,
      );
      break;
    }
    case "hlink": {
      config.height2 = config.height;

      config.options.xName = data.X?.name;
      config.options.labelName = data.label_name;

      if (!config.options.icons) config.options.icons = {};
      if (iconMaps[config.options.xName]) {
        config.options.icons[config.options.xName] =
          iconMaps[config.options.xName];
      }
      if (iconMaps[config.options.labelName]) {
        config.options.icons[config.options.labelName] =
          iconMaps[config.options.labelName];
      }

      createHorizontalLinkChart(
        inputData,
        g,
        config.width,
        config.height,
        config.height2,
        config.operationPos,
        config.yAxis.display,
        config.yAxis.direction,
        config.yAxis2.display,
        config.yAxis2.direction,
        config.order,
        config.order2,
        config.color,
        config.colorMapping,
        config.options,
      );
      break;
    }
    case "map": {
      const mapOptions = {
        ...(config.options || {}),
        mapType: config.mapType || config.options?.mapType,
        center: config.center || config.options?.center,
        rotate: config.rotate || config.options?.rotate,
        scale: config.scale || config.options?.scale,
        colorScale: config.color,
        valueField: config.valueField,
        showBoundaries: config.options?.showBoundaries ?? true,
        boundaryColor: config.options?.boundaryColor || "#ccc",
        boundaryWidth: config.options?.boundaryWidth ?? 0.7,
        returns: {
          ...(config.options?.returns || {}),
          field: field,
        },
      };
      labelPosition = createMap(
        inputData,
        g,
        config.width,
        config.height,
        mapOptions,
      );
      break;
    }
    case "text": {
      createText(
        inputData,
        g,
        config.height,
        config.width,
        config.color,
        config.size,
        config.fontType,
        config.opacity,
        config.position,
        config.options,
      );
      break;
    }
    case "circle-packing": {
      createCirclePacking(
        inputData,
        g,
        config.strokeColor,
        config.fillColor,
        config.rootFillColor,
      );
      break;
    }
    case "rwaffle": {
      createRadialWaffleChart(
        inputData,
        g,
        config.startAngle,
        config.endAngle,
        config.innerRadius,
        config.outerRadius,
        config.yMax,
        config.color,
        config.options,
      );
      break;
    }
    case "graph": {
      createGraph(
        data.data,
        data.X.data[0],
        data.Y.data[0],
        g,
        config.strokeColor,
        config.fillColor,
        data.extraData,
        {
          style: config.options?.style || "default",
          showLinkLabel: config.options?.showLinkLabel !== false,
          maxLinkCount: config.options?.maxLinkCount,
          onNodeDrag: (nodeId, x, y, dragDx, dragDy) => {
            // Find the sub-chart layer that corresponds to this node within the same svg
            const svgNode = g.node().ownerSVGElement;
            const chartGroups = d3
              .select(svgNode)
              .selectAll(
                `.chart-layer > g[data-label="${nodeId}"], .chart-layer > *[data-label="${nodeId}"][data-moved="true"]`,
              );
            if (!chartGroups.empty()) {
              chartGroups.each(function () {
                const group = d3.select(this);
                // Get the current transform translation
                const transform = group.attr("transform");
                let currentTotalDx = 0;
                let currentTotalDy = 0;
                if (transform) {
                  // e.g. transform="translate(100, 200)" or "translate(100 200)"
                  const match =
                    /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/.exec(
                      transform,
                    );
                  if (match) {
                    currentTotalDx = parseFloat(match[1]);
                    currentTotalDy = parseFloat(match[2]);
                  }
                }

                // Add the delta from the mouse movement to the existing translation
                const newTotalDx = currentTotalDx + dragDx;
                const newTotalDy = currentTotalDy + dragDy;

                group.attr(
                  "transform",
                  `translate(${newTotalDx}, ${newTotalDy})`,
                );
              });
            }
          },
        },
      );
      break;
    }
    case "mirror-axis": {
      createMirrorAxis(g, data.data, config);
      break;
    }
    default: {
      throw new Error("Invalid chart type: " + data.chartType);
    }
  }

  if (dataFreeChartTypes.includes(data.chartType))
    return [labelPosition, dx, dy];

  if (
    !polar &&
    !data.chartType.endsWith("pie") &&
    !data.chartType.endsWith("link")
  ) {
    addAxisNameCartesian(g, config);
  }
  if (!polar && data.chartType.endsWith("link")) {
    addAxisNameCartesianLink(g, config);
  }
  if (polar && !data.chartType.endsWith("pie")) {
    addAxisNamePolar(g, config);
  }

  return [labelPosition, dx, dy];
}

export async function processLinkage(g) {
  const palette = globalSettings.palette;
  let { field, nodes, labelColor, avoidRects, counts, style } =
    globalSettings.linkInfo;
  counts = avoidRects.map(() => 0); // counts: an all-zero array with the same length as avoidRects

  const colorFunction = palette.getColorMap(field)[0];

  const keys0 = Object.keys(nodes[0].labelPosition);
  const keys1 = Object.keys(nodes[1].labelPosition);
  const sharedKeys = keys0.filter((key) => keys1.includes(key));
  const dx0 = nodes[0].transform.dx;
  const dy0 = nodes[0].transform.dy;
  const dx1 = nodes[1].transform.dx;
  const dy1 = nodes[1].transform.dy;
  sharedKeys.forEach((key) => {
    const x0 = nodes[0].labelPosition[key].x + dx0;
    const y0 = nodes[0].labelPosition[key].y + dy0;
    const x1 = nodes[1].labelPosition[key].x + dx1;
    const y1 = nodes[1].labelPosition[key].y + dy1;
    const color =
      labelColor && labelColor[key] ? labelColor[key] : colorFunction(key);
    createLinkPath(
      g,
      x0,
      y0,
      x1,
      y1,
      3,
      color,
      style || "twist",
      0.8,
      "vertical",
      true,
      avoidRects,
      counts,
    );
  });
}

function compressLayout(nodes, options = {}) {
  if (nodes.length < 2) return nodes;

  const config = {
    minHorizontalGap: 50,
    minVerticalGap: 50,
    targetHorizontalStripHeight: 55,
    targetVerticalStripWidth: 55,
    iterations: 10, // May need more iterations to stabilize
    ...options,
  };

  for (let iter = 0; iter < config.iterations; iter++) {
    let hasChanged = false;

    // --- Stage 1: resolve overlaps and too-close nodes (push apart) ---
    nodes.forEach((nodeA, i) => {
      const nodeAinnerX =
        nodeA.x - nodeA.width / 2 + nodeA.padding.left + nodeA.innerWidth / 2;
      const nodeAinnerY =
        nodeA.y - nodeA.height / 2 + nodeA.padding.top + nodeA.innerHeight / 2;
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeB = nodes[j];
        const nodeBinnerX =
          nodeB.x - nodeB.width / 2 + nodeB.padding.left + nodeB.innerWidth / 2;
        const nodeBinnerY =
          nodeB.y -
          nodeB.height / 2 +
          nodeB.padding.top +
          nodeB.innerHeight / 2;
        const innerOverlapX =
          (nodeA.innerWidth + nodeB.innerWidth) / 2 -
          Math.abs(nodeAinnerX - nodeBinnerX);
        const innerOverlapY =
          (nodeA.innerHeight + nodeB.innerHeight) / 2 -
          Math.abs(nodeAinnerY - nodeBinnerY);
        // Compute overlap in the horizontal and vertical directions
        const overlapX =
          (nodeA.width + nodeB.width) / 2 - Math.abs(nodeA.x - nodeB.x);
        const overlapY =
          (nodeA.height + nodeB.height) / 2 - Math.abs(nodeA.y - nodeB.y);
        const horizontalConflict =
          innerOverlapY > 0 && overlapX > -config.minHorizontalGap;
        const verticalConflict =
          innerOverlapX > 0 && overlapY > -config.minVerticalGap;
        let shiftX = 0,
          shiftY = 0;
        if (horizontalConflict && verticalConflict) {
          if (innerOverlapX > innerOverlapY) {
            shiftY = config.minVerticalGap + overlapY + 1;
          } else {
            shiftX = config.minHorizontalGap + overlapX + 1;
          }
          hasChanged = true;
        } else if (horizontalConflict) {
          shiftX = config.minHorizontalGap + overlapX + 1;
          hasChanged = true;
        } else if (verticalConflict) {
          // Case 3: vertical conflict only
          shiftY = config.minVerticalGap + overlapY + 1;
          hasChanged = true;
        }
        const maxX = Math.max(nodeA.x, nodeB.x);
        const maxY = Math.max(nodeA.y, nodeB.y);
        nodes.forEach((node) => {
          if (node.x >= maxX) {
            node.x += shiftX;
          }
          if (node.y >= maxY) {
            node.y += shiftY;
          }
        });
      }
    });

    // --- Stage 2: compress empty strips (pull closer) ---
    // (This part is mostly identical to the version you provided, but uses the updated node positions.)

    // Horizontal compression
    const xEvents = new Set();
    nodes.forEach((node) => {
      xEvents.add(node.x - node.width / 2);
      xEvents.add(node.x + node.width / 2);
    });
    const sortedX = Array.from(xEvents).sort((a, b) => a - b);

    for (let i = sortedX.length - 2; i >= 0; i--) {
      const rightBoundary = sortedX[i + 1];
      const leftBoundary = sortedX[i];
      const gapWidth = rightBoundary - leftBoundary;

      if (gapWidth > config.targetVerticalStripWidth) {
        const midPoint = leftBoundary + gapWidth / 2;
        const isGapEmpty = !nodes.some(
          (node) =>
            node.x - node.width / 2 < midPoint &&
            node.x + node.width / 2 > midPoint,
        );
        if (isGapEmpty) {
          const shiftAmount = gapWidth - config.targetVerticalStripWidth;
          nodes.forEach((node) => {
            if (node.x - node.width / 2 >= rightBoundary) {
              node.x -= shiftAmount;
            }
          });
          hasChanged = true;
          break; // After one compression, restart the outer loop to re-evaluate overlaps
        }
      }
    }
    if (hasChanged) continue; // If anything changed, start the next iteration

    // Vertical compression
    const yEvents = new Set();
    nodes.forEach((node) => {
      yEvents.add(node.y - node.height / 2);
      yEvents.add(node.y + node.height / 2);
    });
    const sortedY = Array.from(yEvents).sort((a, b) => a - b);

    for (let i = sortedY.length - 2; i >= 0; i--) {
      const bottomBoundary = sortedY[i + 1];
      const topBoundary = sortedY[i];
      const gapHeight = bottomBoundary - topBoundary;

      if (gapHeight > config.targetHorizontalStripHeight) {
        const midPoint = topBoundary + gapHeight / 2;
        const isGapEmpty = !nodes.some(
          (node) =>
            node.y - node.height / 2 < midPoint &&
            node.y + node.height / 2 > midPoint,
        );
        if (isGapEmpty) {
          const shiftAmount = gapHeight - config.targetHorizontalStripHeight;
          nodes.forEach((node) => {
            if (node.y - node.height / 2 >= bottomBoundary) {
              node.y -= shiftAmount;
            }
          });
          hasChanged = true;
          break;
        }
      }
    }

    // If a full push-apart + pull-closer pass makes no changes, the layout is stable
    if (!hasChanged) break;
  }

  return nodes;
}

function getPaddingForChart(chart) {
  // --- Example Logic: Customize this! ---
  // For instance, give all bar charts extra padding at the bottom.
  const chartType = extractChartType(chart.chartType);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  if (chartType[2] === "bar" || chartType[2] === "parea") {
    if (chartType[0] === "v" || chartType[0] === "r") {
      left = chart.Y.name.length * globalSettings.valueCharWidth; // 8px per character
    } else if (chartType[0] === "h" || chartType[0] === "c") {
      top = 10;
    }
  }
  if (chartType[2] === "line" || chartType[2] === "scatter") {
    if (chartType[0] === "v" || chartType[0] === "r") {
      left = chart.Y.name.length * globalSettings.valueCharWidth; // 8px per character
      bottom = 10;
    } else if (chartType[0] === "h" || chartType[0] === "c") {
      left = chart.X.name.length * globalSettings.valueCharWidth; // 8px per character
      bottom = 10;
    }
  }

  // Reserve space on the right for series legends in labeled line charts
  if (chartType[2] === "line" && chart?.Y?.label && chart.Y.label.length > 0) {
    const labels = chart.Y.label;
    const maxLabelLen = Math.max(...labels.map((l) => String(l).length));
    const textW = maxLabelLen * globalSettings.valueCharWidth;
    const legendColWidth = textW;

    right += legendColWidth;
  }

  return { top: top, right: right, bottom: bottom, left: left };
}

export async function generateLegend(
  g,
  palette,
  rightMost,
  topMost,
  results,
  showPalette = true,
  mode = "basic",
) {
  // Adjust the legend's position
  rightMost += 50;
  topMost += 0;

  // Color Legend
  // Iterate over each color map to create a rectangle for each domain value
  let currentYPosition = topMost; // Start positioning the legend below the topmost element

  let colorLegendHeight = 0;

  // get the column that need a legend
  const allColumns = new Set();
  const displayedColumns = new Set();
  const columnToChartMap = new Map(); // Mapping from column names to charts

  const [charts, _] = results[0];
  const [basicCharts, unionCharts] = charts;
  const polar = results[0][1];
  let innerRadius = 1000;
  let outerRadius = 0;
  // Process basic charts (skip first chart if mode is annotation)
  // const chartsToProcess = mode === "annotation" ? basicCharts.slice(1) : basicCharts;
  if (mode === "mirror" && polar) {
    return 0;
  }
  for (const chart of basicCharts) {
    if (
      chart.chartType === "map" ||
      chart.chartType === "graph" ||
      chart.chartType === "cobar"
    ) {
      continue;
    }
    // Process both xAxis and yAxis with the same logic
    ["xAxis", "yAxis", "xAxis2", "yAxis2"].forEach((axisType) => {
      if (chart.config[axisType]?.name) {
        const colName = chart.config[axisType].name;
        allColumns.add(colName);

        // Add to column-to-chart mapping
        if (!columnToChartMap.has(colName)) {
          columnToChartMap.set(colName, []);
        }
        columnToChartMap.get(colName).push(chart);
        if (
          chart.config[axisType]?.none_type === "repeatedAxis" &&
          colName !== palette.getMajorColorName().toLowerCase()
        ) {
          allColumns.add(chart.X.name + "_" + chart.Y.name);
          if (!columnToChartMap.has(chart.X.name + "_" + chart.Y.name)) {
            columnToChartMap.set(chart.X.name + "_" + chart.Y.name, []);
          }
          columnToChartMap.get(chart.X.name + "_" + chart.Y.name).push(chart);
        }
        if (chart.config[axisType]?.display !== "none") {
          displayedColumns.add(colName);
        }
      }
    });
    if (polar) {
      innerRadius = Math.min(innerRadius, chart.config.innerRadius);
      outerRadius = Math.max(outerRadius, chart.config.outerRadius);
    }
  }
  const refRadius = Math.min((innerRadius + outerRadius) / 2, 250);
  // Process union charts
  for (const chart of unionCharts) {
    if (chart.config.unionAxis?.name) {
      const colName = chart.config.unionAxis.name;
      allColumns.add(colName);

      // Add to column-to-chart mapping
      if (!columnToChartMap.has(colName)) {
        columnToChartMap.set(colName, []);
      }
      columnToChartMap.get(colName).push(chart);

      if (chart.config.unionAxis?.display !== "none") {
        displayedColumns.add(colName);
      }
    }
  }
  const legendColumns = [...allColumns].filter(
    (column) => !displayedColumns.has(column),
  );
  if (legendColumns.includes(palette.getMajorColorName())) {
    legendColumns.splice(legendColumns.indexOf(palette.getMajorColorName()), 1);
  }
  // then find the most top basic chart for each legend column
  const legendColumnToChartMap = new Map();
  for (const column of legendColumns) {
    const charts = columnToChartMap.get(column) || [];
    // Find the most top chart (the one with the smallest y position)
    // If top is the same, prefer the leftmost chart (smallest x position)
    const mostTopChart = charts.reduce((prev, curr) => {
      if (prev.config.top < curr.config.top) {
        return prev;
      } else if (prev.config.top > curr.config.top) {
        return curr;
      } else {
        // top is the same, compare left position
        return prev.config.left < curr.config.left ? prev : curr;
      }
    }, charts[0]);
    legendColumnToChartMap.set(column, mostTopChart);
  }

  let hasMap = false;
  for (const chart of basicCharts) {
    if (chart.chartType === "map") {
      hasMap = true;
      break;
    }
  }

  let nodes = [];
  if (legendColumnToChartMap.size > 0 || hasMap) {
    // Chart Legend - placed below the color legend
    let chartlegendgroup = g
      .append("g")
      .attr("class", "chart-legend")
      .attr("transform", `translate(0, 0)`); // temporarily placed at (0, 0)

    // legend title
    // const legendText = chartlegendgroup.append("text");
    // legendText
    //   .attr("x", 0)
    //   .attr("y", 0)
    //   .attr("text-anchor", "start")
    //   .attr("dominant-baseline", "hanging")
    //   .attr("font-weight", "bold")
    //   .text("Chart Legend")
    //   .attr("fill", globalSettings.textColorDark);
    // globalSettings.setFont(legendText, "label");

    const yOffset = 0; // Reserve space for the title
    const forceLayoutGroup = chartlegendgroup.append("g");

    const realChartTypes = [
      "bar",
      "line",
      "area",
      "pie",
      "scatter",
      "parea",
      "link",
    ];
    let minX = Infinity,
      minY = Infinity;
    const chartsForLegend = [
      ...new Set(
        legendColumns
          .map((col) => legendColumnToChartMap.get(col))
          .filter(Boolean)
          .filter((chart) => {
            const chartType = extractChartType(chart.chartType);
            return realChartTypes.includes(chartType[2]);
          }),
      ),
    ];

    // Add all pie charts unless a pie chart with the same x/y axis names already exists
    const pieChartsToAdd = [];
    const existingPieSignatures = new Set();

    // First collect signatures of existing pie charts (combination of x/y axis names)
    chartsForLegend.forEach((chart) => {
      const chartType = extractChartType(chart.chartType);
      if (chartType[2] === "pie") {
        const signature = `${chart.config.xAxis?.name || ""}-${chart.config.yAxis?.name || ""}`;
        existingPieSignatures.add(signature);
      }
    });

    // Iterate over all basic charts to find pie charts
    basicCharts.forEach((chart) => {
      const chartType = extractChartType(chart.chartType);
      if (chartType[2] === "pie") {
        const signature = `${chart.config.xAxis?.name || ""}-${chart.config.yAxis?.name || ""}`;
        // If this signature has not appeared yet, add this pie chart
        if (!existingPieSignatures.has(signature)) {
          pieChartsToAdd.push(chart);
          existingPieSignatures.add(signature);
        }
      }
    });

    // Append newly found pie charts to chartsForLegend
    chartsForLegend.push(...pieChartsToAdd);

    for (const chart of chartsForLegend) {
      const config = chart.config;
      if (!polar) {
        minX = Math.min(minX, config.left);
        minY = Math.min(minY, config.top);
      } else {
        // const outerRadius = config.outerRadius || 0;
        // minX = Math.min(minX, config.cx - outerRadius);
        // minY = Math.min(minY, config.cy - outerRadius);
        minX = Math.min(minX, config.startAngle * refRadius);
        minY = Math.min(minY, outerRadius - config.outerRadius);
      }
    }

    let scaleFactor = 0.75; // Scale factor for the charts
    if (mode === "mirror") {
      scaleFactor = 0.35;
    } else if (mode === "repetition") {
      scaleFactor = 0.5;
    }
    for (const chart of chartsForLegend) {
      if (chart.chartType.endsWith("pie")) {
        continue;
      }
      if (!polar) {
        scaleFactor = Math.min(
          (800 / (chart.config.width + chart.config.height)) * 0.5,
          scaleFactor,
        );
      } else {
        const width =
          refRadius * (chart.config.endAngle - chart.config.startAngle);
        const height = chart.config.outerRadius - chart.config.innerRadius;
        scaleFactor = Math.min((800 / (width + height)) * 0.5, scaleFactor);
      }
    }
    scaleFactor = scaleFactor * globalSettings.fontRatio;
    for (const chart of chartsForLegend) {
      // --- Core Change: Introduce padding and distinguish between inner and outer size ---
      const chartType = extractChartType(chart.chartType);
      if (chartType[2] === "pie") {
        continue;
      }
      const padding = getPaddingForChart(chart);

      let innerWidth, innerHeight;
      let extraWidth = 0;
      let extraHeight = 0;

      if (!polar) {
        innerWidth = Math.max(chart.config.width * scaleFactor, 40);
        innerHeight = Math.max(chart.config.height * scaleFactor, 30);
      } else {
        innerWidth = Math.max(
          refRadius *
            (chart.config.endAngle - chart.config.startAngle) *
            scaleFactor,
          40,
        );
        innerHeight = Math.max(
          (chart.config.outerRadius - chart.config.innerRadius) * scaleFactor,
          30,
        );
      }
      if (chartType[2] === "bar" || chartType[2] === "parea") {
        const maxXLength = Math.max(
          ...chart.X.data[0].map((item) => String(item).length),
        );
        if (chartType[0] === "v" || chartType[0] === "r") {
          if (innerHeight < maxXLength * globalSettings.valueCharWidth) {
            extraHeight =
              maxXLength * globalSettings.valueCharWidth - innerHeight; // Ensure height is sufficient for labels
            innerHeight = maxXLength * globalSettings.valueCharWidth; // Ensure height is sufficient for labels
          }
          if (
            innerWidth <
            chart.X.data[0].length * (globalSettings.getFontSize("value") + 1)
          ) {
            extraWidth =
              chart.X.data[0].length *
                (globalSettings.getFontSize("value") + 1) -
              innerWidth;
            innerWidth =
              chart.X.data[0].length *
              (globalSettings.getFontSize("value") + 1);
          }
        } else if (chartType[0] === "h" || chartType[0] === "c") {
          if (innerWidth < maxXLength * globalSettings.valueCharWidth) {
            extraWidth =
              maxXLength * globalSettings.valueCharWidth - innerWidth; // Ensure width is sufficient for labels
            innerWidth = maxXLength * globalSettings.valueCharWidth; // Ensure width is sufficient for labels
          }
          if (
            innerHeight <
            chart.X.data[0].length * (globalSettings.getFontSize("value") + 1)
          ) {
            extraHeight =
              chart.X.data[0].length *
                (globalSettings.getFontSize("value") + 1) -
              innerHeight;
            innerHeight =
              chart.X.data[0].length *
              (globalSettings.getFontSize("value") + 1);
          }
        }
      }

      // The total width/height for the layout algorithm includes padding.
      const totalWidth = innerWidth + padding.left + padding.right;
      const totalHeight = innerHeight + padding.top + padding.bottom;

      let initialX, initialY, scaledLeft, scaledTop;
      if (!polar) {
        scaledLeft = (chart.config.left - minX) * scaleFactor - extraWidth / 2;
        scaledTop = (chart.config.top - minY) * scaleFactor - extraHeight / 2;
      } else {
        scaledLeft =
          (chart.config.startAngle * refRadius - minX) * scaleFactor -
          extraWidth / 2;
        scaledTop =
          (outerRadius - chart.config.outerRadius - minY) * scaleFactor -
          extraHeight / 2;
      }
      initialX = scaledLeft - padding.left + totalWidth / 2;
      initialY = scaledTop - padding.top + totalHeight / 2;
      nodes.push({
        id: chart.id,
        chart: chart,
        // Outer container info
        width: totalWidth, // Outer total width
        height: totalHeight, // Outer total height
        x: initialX, // Initial outer center X
        y: initialY, // Initial outer center Y
        // Inner content info
        innerWidth: innerWidth,
        innerHeight: innerHeight,
        // Helper info
        padding: padding,
        scaleFactor: scaleFactor,
      });
    }
    let layoutMinX = Infinity,
      layoutMinY = Infinity;
    let layoutMaxX = -Infinity,
      layoutMaxY = -Infinity;
    if (nodes.length > 0) {
      nodes = compressLayout(nodes);

      nodes.forEach((node) => {
        // Top-left corner of the outer container
        const outerX = node.x - node.width / 2;
        const outerY = node.y - node.height / 2;

        // Top-left corner of the inner content
        const innerTopLeftX = outerX + node.padding.left;
        const innerTopLeftY = outerY + node.padding.top;

        // Compute and store the inner-content center
        node.innerX = innerTopLeftX + node.innerWidth / 2;
        node.innerY = innerTopLeftY + node.innerHeight / 2;
      });

      nodes.forEach((node) => {
        // --- Core Change: Adjust rendering to account for padding ---

        // Calculate the top-left corner of the entire padded box.
        // node.x/y is the center of the padded box, so this is correct.
        const nodeX = node.x - node.width / 2;
        const nodeY = node.y - node.height / 2;

        // Create an outer group for the entire padded area and apply its final position.
        const outerGroup = forceLayoutGroup
          .append("g")
          .attr("transform", `translate(${nodeX}, ${nodeY})`);

        // Create an inner group for the chart itself, translated by the top/left padding.
        // The chart will be drawn inside this group.
        const chartGroup = outerGroup
          .append("g")
          .attr(
            "transform",
            `translate(${node.padding.left}, ${node.padding.top})`,
          );

        let legendPosition = {};
        legendPosition = {
          type: "cartesian", // all cartesian
          rectX: 0,
          rectY: 0, // Starts at (0,0) within the inner `chartGroup`
          rectWidth: node.innerWidth, // Use inner dimensions for drawing
          rectHeight: node.innerHeight, // Use inner dimensions for drawing
        };

        // Pass the inner `chartGroup` and the inner dimensions to the rendering function.
        createChartLegend(chartGroup, node.chart, false, legendPosition);

        // The overall layout boundaries are calculated from the outer (padded) box.
        layoutMinX = Math.min(layoutMinX, nodeX);
        layoutMaxX = Math.max(layoutMaxX, nodeX + node.width);
        layoutMinY = Math.min(layoutMinY, nodeY);
        layoutMaxY = Math.max(layoutMaxY, nodeY + node.height);
      });
    }
    const pieCharts = chartsForLegend.filter((chart) => {
      const chartType = extractChartType(chart.chartType);
      return chartType[2] === "pie";
    });

    if (pieCharts.length > 0) {
      // Create a legend for each pie chart inside the chart-legend group
      const pieLegendGroup = chartlegendgroup
        .append("g")
        .attr("class", "pie-chart-legend")
        .attr("transform", `translate(0, 0)`); // Place above other legends

      // Add a legend for each pie chart
      pieCharts.forEach((chart, index) => {
        const legendContainer = pieLegendGroup
          .append("g")
          .attr("transform", `translate(10, ${index * 50})`);

        // Position info for the pie-chart legend
        const legendPosition = {
          type: "cartesian",
          rectX: 0,
          rectY: 0,
          rectWidth: 200, // Fixed width for the pie-chart legend
          rectHeight: 40, // Fixed height for the pie-chart legend
        };

        // Create the legend directly for the pie chart
        createChartLegend(legendContainer, chart, false, legendPosition);
      });
    }

    const mapCharts = basicCharts.filter((chart) => {
      const chartType = extractChartType(chart.chartType);
      return chartType[2] === "map";
    });

    if (mapCharts.length > 0) {
      // Place the map chart legends below the pie chart legends
      const mapLegendGroup = chartlegendgroup
        .append("g")
        .attr("class", "map-chart-legend")
        .attr("transform", `translate(0, ${pieCharts.length * 50})`);

      mapCharts.forEach((chart, index) => {
        const legendContainer = mapLegendGroup
          .append("g")
          .attr("transform", `translate(10, ${index * 50})`);

        // Position info for the map-chart legend
        const legendPosition = {
          type: "cartesian",
          rectX: 0,
          rectY: 0,
          rectWidth: 150, // Fixed width for the map-chart legend
          rectHeight: 40, // Fixed height for the map-chart legend
        };

        // Create the legend directly for the map chart
        createChartLegend(legendContainer, chart, false, legendPosition);
      });
    }

    // --- Step 6: Draw the final background box (core change) ---
    if (nodes.length > 0) {
      const padding = 15;
      const pieAndBarLegendHeight = (pieCharts.length + mapCharts.length) * 50;
      forceLayoutGroup.attr(
        "transform",
        `translate(${-layoutMinX + padding}, ${-layoutMinY + padding + yOffset + pieAndBarLegendHeight})`,
      );
    }

    // --- Generate Color Legend lazily ---
    const colorMap = palette.getMajorColors();
    if (colorMap && showPalette) {
      // Get the Chart Legend height
      let chartLegendHeight = 0;
      // Try to get the BBox; fall back to an estimate if it fails
      try {
        const bbox = chartlegendgroup.node().getBBox();
        chartLegendHeight = bbox.height;
      } catch (e) {
        // If BBox can't be obtained (e.g. non-browser environment), use the computed layout height
        const layoutHeight =
          layoutMaxY !== -Infinity && layoutMinY !== Infinity
            ? layoutMaxY - layoutMinY
            : 0;
        chartLegendHeight =
          layoutHeight + (pieCharts.length + mapCharts.length) * 50 + 50;
      }

      // Attempt to get the key name associated with the major color map
      const keyName = palette.getMajorColorName();

      let domain = colorMap.domain(); // Get the domain (values)

      if (globalSettings.orderMaps[keyName.toLowerCase()]) {
        const order = globalSettings.orderMaps[keyName.toLowerCase()];
        if (domain.every((v) => Object.keys(order).includes(v))) {
          // Avoid conflicts between values like "year: 1901, 1902, ..." and "1901~1925, ..."
          domain = Object.keys(order).sort((a, b) => order[a] - order[b]);
        }
      }

      const range = domain.map((d) => colorMap(d)); // Get the corresponding colors

      // Calculate the height of each rectangle based on the domain size
      let rectHeight = 20 * globalSettings.fontRatio; // Height of each color rectangle (fixed size, can be customized)
      let spaceBetweenRects = 5 * globalSettings.fontRatio; // Space between color rectangles
      let titleHeight = keyName ? 15 * globalSettings.fontRatio : 0; // Space for the title if keyName exists

      // Compute the max number of rows to fit the Chart Legend height
      // Keep at least 5 rows to avoid too many columns
      const maxRows = Math.min(
        3,
        Math.floor(
          (chartLegendHeight - titleHeight) / (rectHeight + spaceBetweenRects),
        ),
      );

      const maxLabelWidth =
        Math.max(...domain.map((d) => String(d).length)) *
        globalSettings.valueCharWidth; // Rough estimate of text width
      const columnWidth =
        rectHeight +
        spaceBetweenRects +
        maxLabelWidth +
        20 * globalSettings.fontRatio;

      // Calculate total color legend height
      colorLegendHeight =
        titleHeight +
        Math.min(domain.length, maxRows) * (rectHeight + spaceBetweenRects);

      // Create a group for the legend of this color map
      let colorLegendGroup = g.append("g").attr("class", `color-legend`);

      // Add the title (key name) if it exists
      if (keyName) {
        colorLegendGroup
          .append("text")
          .attr("x", 10) // Position roughly centered above the rects (width 20)
          .attr("y", 0) // Position at the top of the legend group
          .attr("text-anchor", "middle") // Center the text
          .attr("dominant-baseline", "middle") // Center the text vertically
          .attr("fill", globalSettings.textColorDark)
          .attr("font-weight", "bold")
          .text(keyName);
      }

      // Create rectangles for each domain value (vertical)
      domain.forEach((value, index) => {
        const col = Math.floor(index / maxRows);
        const row = index % maxRows;
        const xOffset = col * columnWidth;
        const yOffset = titleHeight + row * (rectHeight + spaceBetweenRects);

        // Create a vertical rectangle for each domain value
        colorLegendGroup
          .append("rect")
          .attr("x", xOffset) // All rectangles will be aligned at the same horizontal position
          .attr("y", yOffset) // Position below title
          .attr("height", rectHeight)
          .attr("width", rectHeight) // Fixed width for each vertical block (can be customized)
          .attr("fill", range[index]); // Use the color from the range for the fill

        // Optionally, add labels for each domain value
        colorLegendGroup
          .append("text")
          .attr("x", xOffset + 25 * globalSettings.fontRatio) // Position the label to the right of the rectangle
          .attr("y", yOffset + rectHeight / 2)
          .attr("dominant-baseline", "middle") // Center the text vertically
          .attr("font-weight", "bold")
          .attr("fill", globalSettings.textColorDark)
          .text(value);
      });
      colorLegendGroup.selectAll("text").each(function () {
        globalSettings.setFont(d3.select(this), "legend");
      });

      // Adjust Chart Legend position (for vertical layout)
      // Note: pipeline.js handles horizontal layout, so we only need to ensure the default vertical layout is correct here
      // Since we previously placed Chart Legend at (0,0), we now move it below the Color Legend
      chartlegendgroup.attr(
        "transform",
        `translate(0, ${colorLegendHeight + 50})`,
      );
    }
  }
  return nodes.length;
}

// move level of elements in the SVG to ensure readability.
export async function moveElementLevel(root) {
  // get the accumulate translate of each element from its ancestors
  const dx = (element) => {
    let x = 0;
    let parent = element;
    while (parent !== root.node()) {
      let transform = parent.getAttribute("transform");
      if (transform && transform.startsWith("translate(")) {
        x += parseFloat(transform.slice(10, transform.indexOf(",")));
      }
      parent = parent.parentNode;
    }
    return x;
  };
  const dy = (element) => {
    let y = 0;
    let parent = element;
    while (parent !== root.node()) {
      let transform = parent.getAttribute("transform");
      if (transform && transform.startsWith("translate(")) {
        y += parseFloat(
          transform.slice(transform.indexOf(",") + 2, transform.indexOf(")")),
        );
      }
      parent = parent.parentNode;
    }
    return y;
  };

  function _moveByClass(className) {
    const elements = root.selectAll(`.${className}`);
    elements.nodes().forEach((element) => {
      let transform = element.getAttribute("transform") || "";
      let rotatePart = "";
      // Preserve the original rotate transform
      if (transform.includes("rotate(")) {
        const rotateMatch = transform.match(/rotate\([^)]+\)/);
        if (rotateMatch) {
          rotatePart = " " + rotateMatch[0];
        }
      }
      element.setAttribute("data-moved", "true");
      // Add data-label if ancestor has it to support sync dragging
      let ancestorLabel = null;
      let parentForLabel = element.parentNode;
      while (parentForLabel && parentForLabel !== root.node()) {
        if (
          parentForLabel.getAttribute &&
          parentForLabel.getAttribute("data-label")
        ) {
          ancestorLabel = parentForLabel.getAttribute("data-label");
          break;
        }
        parentForLabel = parentForLabel.parentNode;
      }
      if (ancestorLabel) {
        element.setAttribute("data-label", ancestorLabel);
      }

      element.setAttribute(
        "transform",
        `translate(${dx(element)}, ${dy(element)})${rotatePart}`,
      );
      root.node().appendChild(element);
    });
  }

  // _moveByClass("grid");
  _moveByClass("text-label");
  _moveByClass("bar-value");
  _moveByClass("line-value");
  _moveByClass("axis");
  _moveByClass("bar-labels");
}
