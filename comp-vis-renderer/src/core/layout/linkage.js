import * as d3 from "d3";
import {
  traverseLeafNodes,
  traverseAllNodes,
  extractChartType,
  extractCondition,
  extractOperation,
  getUnionValues,
  getChildIndex,
} from "../../utils/node.js";
import {
  updatePolarConfig,
  updateCentroid,
  validateBoundingBox,
  setBoundingBox,
  alignCenterHorizontal,
  alignCenterVertical,
  adjustUnionNodeBBox,
  setBoundingBoxForTree,
} from "../../utils/geometry.js";
import { approxAxisMargin, moveNodes } from "../../utils/adjust.js";
import { iconMaps } from "../../utils/iconMap.js";
import { getValueField, columnAggregate } from "../../utils/maths.js";
import { resolveMapProjection } from "../../utils/vis.js";
import { globalSettings } from "../global.js";
import { recommendAspectRatio } from "./../aspect.js";

const minBandWidth = globalSettings.minBandWidth;
const interoperableValueGroups = [["UK", "England"]];

function getInteroperableValues(value) {
  for (const group of interoperableValueGroups) {
    if (group.includes(value)) {
      return group;
    }
  }
  return [value];
}

export async function handleLinkageMode(root) {
  chartTypeDerivation(root);
  initBasicCharts(root);
  handleAxis(root.children[0]);
  handleAxis(root.children[1]);
  if (root.spatial_arrangement === "horizontal") {
    root.children[0].neighbors["right"] = root.children[1];
    root.children[1].neighbors["left"] = root.children[0];
  } else if (root.spatial_arrangement === "vertical") {
    root.children[0].neighbors["bottom"] = root.children[1];
    root.children[1].neighbors["top"] = root.children[0];
  }
  generateLayout(root);
}

export async function postprocessLinkageMode(root) {
  processAxisMargin(root);
  setColorsForBasicCharts(root);
}

function chartTypeDerivation(root) {
  const dir = root.spatial_arrangement === "vertical" ? "v" : "h";
  for (const child of root.children) {
    if (child.vis_type !== "basic") {
      for (const grandChild of child.children) {
        grandChild.chart_type = "v" + grandChild.chart_type;
        // removing aspect ratio override to allow vbar for diverging bar chart
        grandChild.coordinate_system = "cartesian";
      }
    } else {
      if (child.chart_type !== "map") {
        child.chart_type = dir + child.chart_type;
      }
    }
    child.coordinate_system = "cartesian";
  }
  root.coordinate_system = "cartesian";
}

function initBasicCharts(root) {
  let currentTop = 100;
  let currentLeft = 100;
  let currentInnerRadius = 0;
  let cx = 1000;
  let cy = 1000;
  const hasComposite = root.children.some(
    (child) => child.vis_type === "composite",
  );
  traverseLeafNodes(root, (node) => {
    if (node.chart_type === "map") {
      const worldMap =
        node.X.name.toLowerCase() === "country" ||
        node.X.name.toLowerCase() === "region";
      let [mapWidth, mapHeight] = worldMap ? [800, 400] : [800, 600];
      if (!hasComposite) {
        mapWidth = (mapWidth * 2) / 3;
        mapHeight = (mapHeight * 2) / 3;
      }
      const chart = {
        X: node.X,
        Y: node.Y,
        config: {
          top: currentTop,
          left: currentLeft,
          height: mapHeight,
          width: mapWidth,
          innerRadius: 0,
          outerRadius: 150,
          startAngle: 0,
          endAngle: 2 * Math.PI,
          order: null,
          color: null,
          xAxis: {
            display: "none",
            direction: "default",
            name: node.X.name,
          },
          yAxis: {
            display: "none",
            direction: "default",
            name: node.Y.name,
          },
          options: {},
        },
        chartType: node.chart_type,
      };
      node.chart = chart;
      chart.config.mapType = resolveMapProjection(node, worldMap);
    } else {
      let order = null;
      // register order map
      if (node.X.data[0].every((x) => typeof x === "string")) {
        if (!globalSettings.orderMaps[node.X.name]) {
          globalSettings.registerOrderMap(
            node.X.name,
            node.X.data[0],
            columnAggregate(node.Y.data),
          );
        }
        order = globalSettings.orderMaps[node.X.name];
        order = Object.keys(order).sort((a, b) => order[a] - order[b]);
      }

      const chartType = extractChartType(node.chart_type);

      // recommended size
      let radius = 100;
      let angle = Math.PI * 2;
      let width = 200;
      let height = 200;

      // recommended aspect ratio range
      const [aspectRatio, minAspectRatio, maxAspectRatio] =
        recommendAspectRatio(node);
      if (chartType[0] === "v") {
        height = width / aspectRatio;
      } else if (chartType[0] === "h") {
        width = height * aspectRatio;
      }

      // for grouped bar chart: adjust width & height or radius
      if (chartType[1] === "g") {
        const numLabel = node.label.length;
        const numX = node.X.data[0].length;
        let minXLen = numLabel * numX * minBandWidth * paddingRatio;
        if (chartType[0] === "v") {
          width = minXLen;
          height = width / (numX * aspectRatio);
        } else if (chartType[0] === "h") {
          height = minXLen;
          width = (height * aspectRatio) / numX;
        } else if (chartType[0] === "c") {
          radius = minXLen;
        } else if (chartType[0] === "r") {
          radius = minXLen / angle;
        }
      }

      if (node.conditions && node.conditions.length > 0) {
        // union node, and its parent has a union axis
        const unionName = Object.keys(extractCondition(node.conditions))[0];
        const unionValues = getUnionValues(node.parent, unionName);
        globalSettings.registerColorMap(unionName, unionValues, false);
      } else if (node.label && node.label.length > 0) {
        // union node, but its parent has no union axis.
        // E.g. stacked / grouped bar chart, or stacked line chart / scatter plot, or link
        const unionName = node.label_name;
        const unionValues = node.label;
        globalSettings.registerColorMap(unionName, unionValues, true);
      } else {
        // "true" basic chart
        if (
          node.chart_type.endsWith("pie") ||
          node.chart_type.endsWith("bar") ||
          node.chart_type.endsWith("parea")
        ) {
          const xName = node.X.name;
          const xValues = node.X.data[0];
          globalSettings.registerColorMap(xName, xValues, false);
        }
      }

      // determine yMax and yMin
      let yMax = Math.max(...node.Y.data.flat());
      let yMin = Math.min(...node.Y.data.flat());
      if (yMin > 0 && node.chart_type.endsWith("bar")) yMin = 0;

      let xaxisName = node.X.name;
      let yaxisName = node.Y.name;
      if (node.chart_type) {
        const [orientation, aggregation, basicType] = extractChartType(
          node.chart_type,
        );
        if (aggregation === "s" && basicType === "bar") {
          const columnCount = node.Y.data[0].length;
          const columnSum = new Array(columnCount).fill(0);
          for (let i = 0; i < node.Y.data.length; i++) {
            for (let j = 0; j < columnCount; j++) {
              columnSum[j] += node.Y.data[i][j];
            }
          }
          yMax = Math.max(...columnSum);
        }
        if (orientation === "h" || orientation === "c") {
          xaxisName = node.Y.name;
          yaxisName = node.X.name;
        }
      }
      // init chart config
      const chart = {
        X: node.X,
        Y: node.Y,
        config: {
          // common configurations

          ///// position settings ////////
          // Cartesian coordinate system /
          top: currentTop,
          left: currentLeft,
          height: height,
          width: width, // 16:9
          // Polar coordinate system /////
          innerRadius: currentInnerRadius,
          outerRadius: currentInnerRadius + radius,
          startAngle: 0,
          endAngle: angle,
          /////////////////////////////////

          order: order,
          color: null, // color will be assigned later
          xAxis: {
            display: "none", // position of x axis
            direction: "default", // direction of x axis
            name: xaxisName,
          },
          yAxis: {
            display: "none", // position of y axis
            direction: "default", // direction of y axis
            name: yaxisName,
          },
          yMin: yMin,
          yMax: yMax,
          constraints: {
            minWidth: -1,
            minHeight: -1,
            minRadius: -1,
            minArclen: -1,
            minAspectRatio: minAspectRatio,
            maxAspectRatio: maxAspectRatio,
          },
          options: {},
        },
      };
      if (node.chart_type.endsWith("pie")) {
        chart.config.yAxis.display = "none";
      }
      if (node.chart_type.endsWith("scatter")) {
        let xMax = Math.max(...node.X.data.flat());
        let xMin = Math.min(...node.X.data.flat());
        chart.config.xMin = xMin;
        chart.config.xMax = xMax;
      }
      if (
        node.coordinate_system === "polar" ||
        node.chart_type.endsWith("pie")
      ) {
        chart.config.cx = cx;
        chart.config.cy = cy;
        updatePolarConfig(chart.config);
      } else {
        updateCentroid(chart.config);
      }

      // some additional configurations
      if (node.label) {
        chart.Y.label = node.label;
        chart.Y.label_name = node.label_name;
      }
      chart.chartType = node.chart_type;
      node.chart = chart;

      currentTop += Math.max(width, height);
      currentLeft += Math.max(width, height);
      currentInnerRadius += radius;
    }
  });

  // set range config
  root.children.forEach((node) => {
    if (node.vis_type === "composite") {
      // For a union node, set the range for its children
      const yMin = Math.min(
        ...node.children.map((child) => child.chart.config.yMin),
      );
      const yMax = Math.max(
        ...node.children.map((child) => child.chart.config.yMax),
      );
      node.children.forEach((child) => {
        child.chart.config.yMin = yMin;
        child.chart.config.yMax = yMax;
      });
    }
  });
}

function generateLayout(root) {
  let defaultMargin = 100; // margin between two charts of linkage
  const linkageToMapScale = 0.8;
  root.children.forEach((child) => {
    if (!validateBoundingBox(child)) {
      setBoundingBox(child);
    }
  });

  const node0 = root.children[0];
  const node1 = root.children[1];

  const cfg0 = node0.chart.config;
  const cfg1 = node1.chart.config;
  let pos0 = null;
  let pos1 = null;
  const node0IsMap = node0.chart_type === "map";
  const node1IsMap = node1.chart_type === "map";
  const barScale = 0.6;

  switch (root.spatial_arrangement) {
    case "horizontal": {
      if (node0.vis_type === "basic" && node0.chart_type.endsWith("bar")) {
        setBoundingBoxForTree(
          node0,
          cfg0.top,
          cfg0.left,
          cfg0.width * barScale * barScale,
          cfg0.height * barScale,
        );
      }
      if (node1.vis_type === "composite") {
        const detailScale = 1.25;
        setBoundingBoxForTree(
          node1,
          cfg1.top,
          cfg1.left,
          cfg1.width * detailScale,
          cfg1.height * detailScale,
        );
      }

      // Also support the map being on either side.
      if (node0IsMap && !node1IsMap) {
        const aspectRatio = cfg1.width / cfg1.height;
        const newHeight = cfg0.height * linkageToMapScale;
        const newWidth = newHeight * aspectRatio;
        setBoundingBoxForTree(node1, cfg1.top, cfg1.left, newWidth, newHeight);
      } else if (!node0IsMap && node1IsMap) {
        const aspectRatio = cfg0.width / cfg0.height;
        const newHeight = cfg1.height * linkageToMapScale;
        const newWidth = newHeight * aspectRatio;
        setBoundingBoxForTree(node0, cfg0.top, cfg0.left, newWidth, newHeight);
      } else {
        // const aspectRatio = cfg0.width / cfg0.height;
        // const newHeight = cfg1.height;
        // const newWidth = newHeight * aspectRatio;
        // setBoundingBoxForTree(node0, cfg0.top, cfg0.left, newWidth, newHeight);
      }
      alignCenterHorizontal(node0, node1, defaultMargin);
      [pos0, pos1] = ["right", "left"];

      // In horizontal linkage, the left bar chart should grow toward the
      // linked view on the right, so reverse its value axis.
      if (node0.vis_type === "basic" && node0.chart_type.endsWith("bar")) {
        cfg0.xAxis.direction = "inverse";
      }
      break;
    }
    case "vertical": {
      if (node0.vis_type === "basic" && node0.chart_type.endsWith("bar")) {
        setBoundingBoxForTree(
          node0,
          cfg0.top,
          cfg0.left,
          cfg0.width,
          cfg0.height * barScale,
        );
      }
      // Also support the map being on either side.
      if (node0IsMap && !node1IsMap) {
        const aspectRatio = cfg1.height / cfg1.width;
        const newWidth = cfg0.width * linkageToMapScale;
        const newHeight = newWidth * aspectRatio;
        setBoundingBoxForTree(node1, cfg1.top, cfg1.left, newWidth, newHeight);
      } else if (!node0IsMap && node1IsMap) {
        const aspectRatio = cfg0.height / cfg0.width;
        const newWidth = cfg1.width * linkageToMapScale;
        const newHeight = newWidth * aspectRatio;
        setBoundingBoxForTree(node0, cfg0.top, cfg0.left, newWidth, newHeight);
      } else {
        // const aspectRatio = cfg0.height / cfg0.width;
        // const newWidth = cfg1.width;
        // const newHeight = newWidth * aspectRatio;
        // setBoundingBoxForTree(node0, cfg0.top, cfg0.left, newWidth, newHeight);
      }
      alignCenterVertical(node0, node1, defaultMargin);
      [pos0, pos1] = ["bottom", "top"];
      break;
    }
    default:
      throw new Error(
        `Unsupported spatial arrangement: ${root.spatial_arrangement}`,
      );
  }

  const [type, field] = extractOperation(root.operation);
  if (!type.endsWith("JOIN")) {
    console.warn("Linkage mode only supports JOIN operation, but got:", type);
    return;
  }

  // register link info
  globalSettings.registerLink(field, node0.id, node1.id, pos0, pos1);
  globalSettings.linkInfo.style =
    node0.chart_type === "map" || node1.chart_type === "map"
      ? "default"
      : "twist";

  // add value field and color encoding for map
  if (node0.chart_type === "map" || node1.chart_type === "map") {
    const mapNode = node0.chart_type === "map" ? node0 : node1;
    const otherNode = mapNode === node0 ? node1 : node0;
    let minEncodingValue = Number.MAX_VALUE;
    let maxEncodingValue = -Number.MAX_VALUE;
    let colorName = null;
    if (otherNode.vis_type === "basic" && mapNode.X.name === otherNode.X.name) {
      colorName = otherNode.Y.name;
      const name = otherNode.X.name;
      const data = d3
        .zip(otherNode.X.data[0], otherNode.Y.data[0])
        .map(([x, y]) => ({ x, y }));
      mapNode.X.data.features.forEach((feature) => {
        const candidates = getInteroperableValues(feature.properties[name]);
        const value = data.find((d) => candidates.includes(d.x));
        if (value) {
          feature.properties["valueField"] = value.y;
          minEncodingValue = Math.min(minEncodingValue, value.y);
          maxEncodingValue = Math.max(maxEncodingValue, value.y);
        }
      });
    } else if (otherNode.vis_type === "composite") {
      colorName = "SUM OF " + otherNode.children[0].Y.name;
      const name = extractOperation(otherNode.operation)[1];
      mapNode.X.data.features.forEach((feature) => {
        const candidates = getInteroperableValues(feature.properties[name]);
        const child = otherNode.children.find((child) => {
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
      mapNode.chart.config.colorName = colorName;
      mapNode.chart.config.valueField = "valueField";
      mapNode.chart.config.color = d3
        .scaleLinear()
        .domain([minEncodingValue, maxEncodingValue])
        .range([globalSettings.mapColor.low, globalSettings.mapColor.high]);
    }
  }

  // set chart styles
  traverseLeafNodes(root, (node) => {
    if (node.chart_type.endsWith("bar")) {
      node.chart.config.options.showBaseline = false;
    }
  });

  // If it is a single bar chart, show the axis
  [
    [node0, pos0],
    [node1, pos1],
  ].forEach(([node, pos]) => {
    if (node.vis_type === "basic" && node.chart_type.endsWith("bar")) {
      if (pos === "bottom" || pos === "top") {
        node.chart.config.xAxis.display = pos + "_noname";
      } else {
        node.chart.config.yAxis.display = pos + "_noname";
      }
    }
  });

  if (
    root.spatial_arrangement === "horizontal" &&
    node0.vis_type === "basic" &&
    node0.chart_type.endsWith("bar")
  ) {
    node0.chart.config.yAxis.display = "none";
  }
}

function setColorsForBasicCharts(node) {
  if (!node || node.chart_type === "map") return;

  if (
    node.operation &&
    extractOperation(node.operation)[0] === "ALL_UNION" &&
    node.vis_type === "composite"
  ) {
    // for union + composite charts
    const name = node.chart.unionData.name;
    let [colorMap, type] = globalSettings.palette.getColorMap(name);
    if (type !== "base") {
      // If the union axis has a color mapping
      for (const child of node.children) {
        const value = extractCondition(child.conditions)[name];
        child.chart.config.color = colorMap(value);
      }
    } else {
      // If the union axis has no color mapping
      const child = node.children[0];
      if (
        child.chart_type.endsWith("bar") ||
        child.chart_type.endsWith("pie") ||
        child.chart_type.endsWith("parea")
      ) {
        // If the x-axis can encode color
        [colorMap, type] = globalSettings.palette.getColorMap(child.X.name);
        for (const child of node.children) {
          child.chart.config.color = colorMap;
        }
      } else if (
        child.chart_type.endsWith("line") ||
        child.chart_type.endsWith("scatter")
      ) {
        // If the x-axis cannot encode color
        [colorMap, type] = globalSettings.palette.getColorMap("");
        for (const child of node.children) {
          child.chart.config.color = colorMap("");
        }
      }
    }
    return; // no need to process children
  } else if (
    (node.operation &&
      extractOperation(node.operation)[0] === "ALL_UNION" &&
      node.vis_type === "basic") ||
    (node.vis_type === "basic" && node.chart_type.includes("link"))
  ) {
    // for union + basic charts
    // e.g. vsbar, vsline, vsscatter, vlink
    let colorMap = null;
    let type = null;
    if (!node.chart_type.includes("link")) {
      [colorMap, type] = globalSettings.palette.getColorMap(node.label_name);
    } else {
      // link charts
      [colorMap, type] = globalSettings.palette.getColorMap(node.label_name);
      if (type === "base") {
        [colorMap, type] = globalSettings.palette.getColorMap(node.X.name);
        node.chart.config.colorMapping = "x";
      } else {
        node.chart.config.colorMapping = "label";
      }
    }
    node.chart.config.color = colorMap;
  } else if (node.vis_type === "basic") {
    // simple basic charts. E.g. bar, line, scatter, pie
    // Caution: `link` does not belong to this category because it has three dimensions
    if (
      node.chart_type.endsWith("bar") ||
      node.chart_type.endsWith("pie") ||
      node.chart_type.endsWith("parea")
    ) {
      // bar/pie/parea: may have color mapping
      const [colorMap, _] = globalSettings.palette.getColorMap(node.X.name);
      node.chart.config.color = colorMap;
    } else if (
      node.chart_type.endsWith("line") ||
      node.chart_type.endsWith("scatter")
    ) {
      // line/scatter: no need to use color encoding
      const [colorMap, _] = globalSettings.palette.getColorMap("");
      node.chart.config.color = colorMap("");
    } else {
      throw new Error("Unsupported chart type: " + node.chart_type);
    }
  }

  // recursively process children
  node.children.forEach((child) => {
    setColorsForBasicCharts(child);
  });
}

function processAxisMargin(root) {
  function getDirectionSize(node, direction) {
    let size = 0;
    switch (direction) {
      case "top": {
        size = node.chart.config.xAxis?.display.includes("top")
          ? node.chart.config.xAxis?.size
          : 0;
        break;
      }
      case "bottom": {
        size = node.chart.config.xAxis?.display.includes("bottom")
          ? node.chart.config.xAxis?.size
          : 0;
        break;
      }
      case "left": {
        size = node.chart.config.yAxis?.display.includes("left")
          ? node.chart.config.yAxis?.size
          : 0;
        break;
      }
      case "right": {
        size = node.chart.config.yAxis?.display.includes("right")
          ? node.chart.config.yAxis?.size
          : 0;
        break;
      }
      default:
        throw new Error("Unsupported direction: " + direction);
    }
    if (node.chart.config.unionAxis?.display.includes(direction)) {
      size += node.chart.config.unionAxis.size;
    }
    return size;
  }
  traverseAllNodes(root, (node) => {
    if (node.chart_type !== "map") {
      if (
        node.chart.config.xAxis &&
        node.chart.config.xAxis.display != "none"
      ) {
        node.chart.config.xAxis.size = approxAxisMargin(node, "x", false);
      }
      if (
        node.chart.config.yAxis &&
        node.chart.config.yAxis.display != "none"
      ) {
        node.chart.config.yAxis.size = approxAxisMargin(node, "y", false);
      }
      if (
        node.chart.config.unionAxis &&
        node.chart.config.unionAxis.display != "none"
      ) {
        node.chart.config.unionAxis.size = approxAxisMargin(node, "union");
        adjustUnionNodeBBox(node);
      }
    }
  });
  // then adjust
  const node0 = root.children[0];
  const node1 = root.children[1];
  switch (root.spatial_arrangement) {
    case "horizontal": {
      moveNodes(node1, "right", getDirectionSize(node0, "right"));
      moveNodes(node0, "left", getDirectionSize(node1, "left"));
      break;
    }
    case "vertical": {
      moveNodes(node1, "bottom", getDirectionSize(node0, "bottom"));
      moveNodes(node0, "top", getDirectionSize(node1, "top"));
      break;
    }
  }
  traverseAllNodes(root, (node) => {
    if (node.chart_type !== "map") {
      if (
        node.chart.config.unionAxis &&
        node.chart.config.unionAxis.display != "none"
      ) {
        const cfg = node.chart.config;
        const bbox = [
          cfg.left,
          cfg.top,
          cfg.left + cfg.width,
          cfg.top + cfg.height,
        ];
        switch (node.chart.config.unionAxis.display) {
          case "bottom":
            bbox[3] += node.chart.config.unionAxis.size;
            break;
          case "top":
            bbox[1] -= node.chart.config.unionAxis.size;
            break;
          case "left":
            bbox[0] -= node.chart.config.unionAxis.size;
            break;
          case "right":
            bbox[2] += node.chart.config.unionAxis.size;
            break;
          default:
            throw new Error(
              `Unsupported union axis display: ${node.chart.config.unionAxis.display}`,
            );
        }
        globalSettings.linkInfo.avoidRects.push(bbox);
      }
    }
  });

  // update config for pie chart
  traverseLeafNodes(root, (node) => {
    if (node.chart_type.endsWith("pie")) {
      const cfg = node.chart.config;
      cfg.cx = cfg.left + cfg.width / 2;
      cfg.cy = cfg.top + cfg.height / 2;
      cfg.left = cfg.cx - cfg.outerRadius;
      cfg.top = cfg.cy - cfg.outerRadius;
      cfg.width = cfg.outerRadius * 2;
      cfg.height = cfg.outerRadius * 2;
    }
  });

  // set avoidRects
  root.children.forEach((child) => {
    if (child.vis_type !== "basic" || child.chart_type !== "map") {
      const cfg = child.chart.config;
      const bbox = [
        cfg.left,
        cfg.top,
        cfg.left + cfg.width,
        cfg.top + cfg.height,
      ];
      const axisPadding = [
        getDirectionSize(child, "left"),
        getDirectionSize(child, "right"),
        getDirectionSize(child, "top"),
        getDirectionSize(child, "bottom"),
      ];
      if (axisPadding[0] > 0) {
        bbox[0] -= axisPadding[0];
      }
      if (axisPadding[1] > 0) {
        bbox[2] += axisPadding[1];
      }
      if (axisPadding[2] > 0) {
        bbox[1] -= axisPadding[2];
      }
      if (axisPadding[3] > 0) {
        bbox[3] += axisPadding[3];
      }
      globalSettings.linkInfo.avoidRects.push(bbox);
    }
  });
}

function handleAxis(node) {
  if (node.vis_type === "basic") return;
  const [type, field] = extractOperation(node.operation);
  if (type === "ALL_UNION") {
    const index = getChildIndex(node);
    const verticalDisplayArray = ["right", "left"];
    const horizontalDisplayArray = ["bottom", "top"];

    // handle union axis
    const unionData = {
      data: node.children.map(
        (child) => extractCondition(child.conditions)[field],
      ),
      name: field,
      configs: [],
    };
    node.children.forEach((child) => {
      unionData.configs.push(child.chart.config);
      node.neighbors["inner"].push(child);
      child.neighbors["outer"] = node;
    });
    node.chart.unionData = unionData;
    node.chart.config.unionAxis = {
      display: ["vertical", "radial"].includes(node.spatial_arrangement)
        ? verticalDisplayArray[index]
        : horizontalDisplayArray[index],
      direction: "default",
      name: field,
    };

    if (!globalSettings.orderMaps[field]) {
      globalSettings.registerOrderMap(
        field,
        unionData.data,
        node.children.map((child) => getValueField(child)),
      );
    }
    let order = globalSettings.orderMaps[field];
    node.chart.config.order = Object.keys(order).sort(
      (a, b) => order[a] - order[b],
    );

    // adjust the margin between unioned children
    switch (node.spatial_arrangement) {
      case "vertical": {
        const baseConfig = node.children[0].chart.config;
        const { top, left, width, height } = baseConfig;
        let currentTop = top;
        let padding = height * 0.2; // default gap
        const isTwoBarDiverging =
          node.children.length === 2 &&
          node.children.every((child) => child.chart_type.endsWith("bar"));
        const iconField = node.children[0]?.X?.name;
        const iconMap = iconField ? iconMaps[iconField] : null;
        const xValues = node.children[0]?.X?.data?.[0] || [];
        const hasIcons = !!iconMap && xValues.some((value) => !!iconMap[value]);

        if (isTwoBarDiverging && hasIcons) {
          // Diverging bar chart logic: icon-aware gap between two bars
          const n = Math.max(xValues.length, 1);
          const p = 0.3; // keep consistent with axis band/gap estimate
          const gapWidth = (p * width) / (n + (n - 1) * p);
          const barWidth = (width - (n - 1) * gapWidth) / n;
          const iconSize = Math.max(
            globalSettings.getFontSize("value"),
            Math.min(24, barWidth),
          );
          padding = iconSize + 10;

          // Shrink the host size
          if (node.parent && node.parent.children.length > 0) {
            const hostNode = node.parent.children[0];
            const hostCfg = hostNode.chart?.config;
            if (
              hostCfg &&
              hostNode.chart_type?.endsWith("pie") &&
              !hostNode._shrunkForIconButterfly
            ) {
              const scale = 0.55; // make host smaller
              if (hostCfg.outerRadius) hostCfg.outerRadius *= scale;
              if (hostCfg.innerRadius) hostCfg.innerRadius *= scale;
              if (hostCfg.cx !== undefined && hostCfg.cy !== undefined) {
                updatePolarConfig(hostCfg);
              }
              hostNode._shrunkForIconButterfly = true;
            }
          }
        }
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          const cfg = child.chart.config;
          cfg.top = currentTop;
          cfg.left = left;
          cfg.width = width;
          cfg.height = height;
          if (isTwoBarDiverging && hasIcons) {
            if (i === 1) cfg.yAxis.direction = "inverse";
            if (i === 0) cfg.xAxis.display = "bottom_noname";
            if (!cfg.options) cfg.options = {};
            cfg.options.style = "round";
          }
          currentTop += height + padding;
        }
        for (let i = 0; i < node.children.length - 1; i++) {
          node.children[i].neighbors["bottom"] = node.children[i + 1];
          node.children[i + 1].neighbors["top"] = node.children[i];
        }
        break;
      }
      case "horizontal": {
        const baseConfig = node.children[0].chart.config;
        const { top, left, width, height } = baseConfig;
        let currentLeft = left;
        for (const child of node.children) {
          const cfg = child.chart.config;
          cfg.top = top;
          cfg.left = currentLeft;
          cfg.width = width;
          cfg.height = height;
          currentLeft += width / (1 - globalSettings.padding);
        }
        for (let i = 0; i < node.children.length - 1; i++) {
          node.children[i].neighbors["right"] = node.children[i + 1];
          node.children[i + 1].neighbors["left"] = node.children[i];
        }
        break;
      }
      default:
        throw new Error(
          `Unsupported spatial arrangement for node ${node.id}: ${node.spatial_arrangement}`,
        );
    }
  }
}
