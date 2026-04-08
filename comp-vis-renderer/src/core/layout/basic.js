import {
  findNodefromColumn,
  extractOperation,
  extractChartType,
  extractCondition,
  isCartesian,
  getUnionValues,
  chartTypeDerivation,
  validateCompositeChart,
  validateBasicChart,
  traverseAllNodes,
  traverseLeafNodes,
  traverseUnionNodes,
  traverseNonLeafNodes,
  setChildrenOption,
} from "../../utils/node.js";
import {
  approxAxisMargin,
  moveNormalxAxis,
  moveNormalyAxis,
  adjustCircularAxisForCircularUnionNode,
  moveNodes,
} from "../../utils/adjust.js";
import { mySum, columnAggregate } from "../../utils/maths.js";
import {
  updateCentroid,
  updatePolarConfig,
  copyConfig,
  setBoundingBox,
  setBoundingBoxForTree,
  validateBoundingBox,
  adjustUnionNodeBBox,
  boundingBoxCheck,
  resetBoundingBox,
  getArea,
} from "../../utils/geometry.js";
import { globalSettings } from "./../global.js";
import {
  optimizeHStack,
  optimizeVStack,
  optimizeCStack,
  optimizeRStack,
} from "./../optimize.js";
import { recommendAspectRatio } from "./../aspect.js";

const minBandWidth = globalSettings.minBandWidth;
const minValueWidth = 12; // minimum x-value length for line chart
const paddingRatio = 1.3; // need to reserve the space for padding for some charts
const minWidth = 80;
const minHeight = 50;
const minRadius = 100;
const minArclen = 100;
const maxArea = 500 * 400;

export function handleBasicMode(root) {
  chartTypeDerivation(root);
  initBasicCharts(root);
  generateLayout(root);
  updateChartStyle();
}

export function postprocessBasicMode(root) {
  setColorsForBasicCharts(root);
  processAxisMargin(root);
  adjustRadius(root);
  adjustChartConfigForPolar(root);

  adjustCircularAxis(root);
  traverseUnionNodes(root, (unionNode) => {
    adjustUnionNodeBBox(unionNode);
  });

  syncAliasedAxisSettings(root);

  getBaseColorProportion(root);
}

function syncAliasedAxisSettings(root) {
  const aliasMap = globalSettings.axisSettingsAlias || {};
  if (Object.keys(aliasMap).length === 0) return;

  const updateAxisRange = (chart, axisType, columnName) => {
    if (!columnName || !aliasMap[columnName]) return;

    const axisKey = globalSettings.resolveAxisSettingsKey(columnName);
    const axisSetting = globalSettings.axesSettings[axisKey];
    if (!axisSetting || !axisSetting.range) return;

    const [min, max] = axisSetting.range;
    if (axisType === "x") {
      chart.config.xMin = min;
      chart.config.xMax = max;
      if (chart.config.xAxis) {
        chart.config.xAxis.direction = axisSetting.direction || "default";
      }
    } else if (axisType === "y") {
      chart.config.yMin = min;
      chart.config.yMax = max;
      if (chart.config.yAxis) {
        chart.config.yAxis.direction = axisSetting.direction || "default";
      }
    }
  };

  traverseLeafNodes(root, (node) => {
    const chart = node.chart;
    if (!chart || !chart.config) return;

    updateAxisRange(chart, "x", chart.X?.name);
    updateAxisRange(chart, "y", chart.Y?.name);
  });
}

function handleConditionForUnion(node) {
  if (node.children.length === 0) {
    throw new Error("Union node should have at least one child");
  }

  // now we only consider the case when all children are basic charts
  node.children.forEach((child) => {
    if (!validateBasicChart(child)) {
      throw new Error("Union node should have basic charts as children");
    }
    if (!child.conditions) {
      throw new Error("Union node should have conditions for each child");
    }
  });

  // extract condition for children nodes
  const columnName = Object.keys(
    extractCondition(node.children[0].conditions),
  )[0];
  const values = [];
  const weights = [];
  for (const child of node.children) {
    const conditions = extractCondition(child.conditions);
    if (conditions[columnName] === undefined) {
      throw new Error("Condition should be consistent for all children");
    }
    values.push(conditions[columnName]);
    weights.push(mySum(child.Y.data[0]));
  }

  // register order map
  if (!globalSettings.orderMaps[columnName]) {
    globalSettings.registerOrderMap(columnName, values, weights);
  }

  // set order according to order map
  const orderMap = globalSettings.orderMaps[columnName];
  node.children.sort(
    (a, b) =>
      orderMap[extractCondition(a.conditions)[columnName]] -
      orderMap[extractCondition(b.conditions)[columnName]],
  );

  // set constraint
  if (node.spatial_arrangement === "vertical") {
    node.chart.config.constraints = {
      minWidth: Math.max(
        ...node.children.map((x) => x.chart.config.constraints.minWidth),
      ),
      minHeight: mySum(
        node.children.map((x) => x.chart.config.constraints.minHeight + 15),
      ),
      minAspectRatio:
        1 /
        mySum(
          node.children.map(
            (x) => 1 / x.chart.config.constraints.minAspectRatio,
          ),
        ),
      maxAspectRatio:
        1 /
        mySum(
          node.children.map(
            (x) => 1 / x.chart.config.constraints.maxAspectRatio,
          ),
        ),
    };
  } else if (node.spatial_arrangement === "horizontal") {
    node.chart.config.constraints = {
      minWidth: mySum(
        node.children.map((x) => x.chart.config.constraints.minWidth),
      ),
      minHeight: Math.max(
        ...node.children.map((x) => x.chart.config.constraints.minHeight),
      ),
      minAspectRatio: mySum(
        node.children.map((x) => x.chart.config.constraints.minAspectRatio),
      ),
      maxAspectRatio: mySum(
        node.children.map((x) => x.chart.config.constraints.maxAspectRatio),
      ),
    };
  } else if (node.spatial_arrangement === "radial") {
    node.chart.config.constraints = {
      minRadius: mySum(
        node.children.map((x) => x.chart.config.constraints.minRadius),
      ),
      minArclen: Math.max(
        ...node.children.map((x) => x.chart.config.constraints.minArclen),
      ),
    };
  } else if (node.spatial_arrangement === "circular") {
    node.chart.config.constraints = {
      minRadius: Math.max(
        ...node.children.map((x) => x.chart.config.constraints.minRadius),
      ),
      minArclen: mySum(
        node.children.map((x) => x.chart.config.constraints.minArclen),
      ),
    };
  }
}

function setRangeandDirectionConfig(
  charts,
  columnName,
  columnOrientation,
  direction,
  using_record = true,
) {
  const normalizeRecordedRangeForTrendCharts = (min, max, minAndMaxes) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < 0) {
      return [min, max];
    }

    const relevantCharts = minAndMaxes
      .map((item) => item?.chart)
      .filter((chart) => chart !== undefined);
    if (relevantCharts.length === 0) {
      return [min, max];
    }

    const areAllTrendCharts = relevantCharts.every((chart) => {
      const chartType = extractChartType(chart.chartType)[2];
      return chartType === "line" || chartType === "scatter";
    });
    if (!areAllTrendCharts || min < 0 || min > max * 0.6) {
      return [min, max];
    }

    return [0, max];
  };

  const axisKey = globalSettings.resolveAxisSettingsKey(columnName);
  const shouldUseRecord =
    using_record ||
    axisKey === columnName ||
    globalSettings.axisSettingsAlias?.[columnName] !== undefined;

  // set range
  if (!globalSettings.orderMaps[axisKey]) {
    if (globalSettings.axesSettings[axisKey] && shouldUseRecord) {
      const minAndMaxes = charts
        .map((chart) => {
          if (chart.X.name === columnName) {
            return {
              min: chart.config.xMin,
              max: chart.config.xMax,
              axis: "x",
              chart,
            };
          } else if (chart.Y.name === columnName) {
            return {
              min: chart.config.yMin,
              max: chart.config.yMax,
              axis: "y",
              chart,
            };
          }
          return undefined;
        })
        .filter((x) => x !== undefined);

      const newMin =
        minAndMaxes.length === 0
          ? undefined
          : Math.min(...minAndMaxes.map((x) => x.min));
      const newMax =
        minAndMaxes.length === 0
          ? undefined
          : Math.max(...minAndMaxes.map((x) => x.max));

      let min = globalSettings.axesSettings[axisKey].range[0];
      let max = globalSettings.axesSettings[axisKey].range[1];
      const axisDirection =
        globalSettings.axesSettings[axisKey].direction || direction;

      // Merge ranges: expand record when current charts exceed recorded bounds.
      if (newMin !== undefined && (min === undefined || newMin < min)) {
        min = newMin;
      }
      if (newMax !== undefined && (max === undefined || newMax > max)) {
        max = newMax;
      }

      [min, max] = normalizeRecordedRangeForTrendCharts(min, max, minAndMaxes);

      globalSettings.axesSettings[axisKey] = {
        range: [min, max],
        direction: axisDirection,
      };

      for (const chart of charts) {
        if (chart.X.name === columnName) {
          chart.config.xMin = min;
          chart.config.xMax = max;
        } else if (chart.Y.name === columnName) {
          chart.config.yMin = min;
          chart.config.yMax = max;
        }

        if (
          columnOrientation === "horizontal" ||
          columnOrientation === "circular"
        ) {
          chart.config.xAxis.direction = axisDirection;
        } else if (
          columnOrientation === "vertical" ||
          columnOrientation === "radial"
        ) {
          chart.config.yAxis.direction = axisDirection;
        }
      }
    } else {
      const minAndMaxes = charts.map((chart) => {
        if (chart.X.name === columnName) {
          return {
            min: chart.config.xMin,
            max: chart.config.xMax,
            axis: "x",
            chart,
          };
        } else if (chart.Y.name === columnName) {
          return {
            min: chart.config.yMin,
            max: chart.config.yMax,
            axis: "y",
            chart,
          };
        }
      });
      const min =
        minAndMaxes[0] === undefined
          ? undefined
          : Math.min(...minAndMaxes.map((x) => x.min));
      const max =
        minAndMaxes[0] === undefined
          ? undefined
          : Math.max(...minAndMaxes.map((x) => x.max));
      let normalizedMin = min;
      let normalizedMax = max;
      [normalizedMin, normalizedMax] = normalizeRecordedRangeForTrendCharts(
        normalizedMin,
        normalizedMax,
        minAndMaxes,
      );
      for (let i = 0; i < charts.length; i++) {
        if (minAndMaxes[i].axis === "x") {
          charts[i].config.xMin = normalizedMin;
          charts[i].config.xMax = normalizedMax;
        } else if (minAndMaxes[i].axis === "y") {
          charts[i].config.yMin = normalizedMin;
          charts[i].config.yMax = normalizedMax;
        }

        if (
          columnOrientation === "horizontal" ||
          columnOrientation === "circular"
        ) {
          charts[i].config.xAxis.direction = direction;
        } else if (
          columnOrientation === "vertical" ||
          columnOrientation === "radial"
        ) {
          charts[i].config.yAxis.direction = direction;
        }
      }
      if (shouldUseRecord) {
        globalSettings.axesSettings[axisKey] = {
          range: [normalizedMin, normalizedMax],
          direction: direction,
        };
      }
    }
  }
}

// set constraints for specific chart types
// allowed constraint arguments:
// - minWidth (Cartesian)
// - minHeight (Cartesian)
// - minRadius (polar)
// - minAspectRatio (Cartesian)
// - maxAspectRatio (Cartesian)
function setSizeConstraints(constraints, node) {
  // init all constraints
  constraints.minWidth = minWidth;
  constraints.minHeight = minHeight;
  constraints.minRadius = minRadius;
  constraints.minArclen = minArclen;
  constraints.maxArea = maxArea;

  const chartType = extractChartType(node.chart_type);

  // for bar chart: ensure that each bar's bandwidth >= 20 pixels.
  // currently we don't consider the case for radial bar charts,
  // because angular axis is different from x/y/polar axis.
  if (chartType[2] === "bar") {
    let minLen = node.X.data[0].length * minBandWidth * paddingRatio;
    if (chartType[1] !== "g") {
      if (chartType[0] === "v") {
        constraints.minWidth = Math.max(minLen, constraints.minWidth);
      } else if (chartType[0] === "h") {
        constraints.minHeight = Math.max(minLen, constraints.minHeight);
      } else if (chartType[0] === "c") {
        constraints.minRadius = Math.max(minLen, constraints.minRadius);
      } else if (chartType[0] === "r") {
        constraints.minArclen = Math.max(minLen, constraints.minArclen);
      }
    } else {
      // grouped bar chart: needs to consider the number of groups
      // also needs to adjust [min/max]-AspectRatio
      const n = node.label.length;
      if (chartType[0] === "v") {
        constraints.minWidth *= n;
        constraints.minAspectRatio *= n;
        constraints.maxAspectRatio *= n;
        constraints.maxArea *= n;
      } else if (chartType[0] === "h") {
        constraints.minHeight *= n;
        constraints.minAspectRatio /= n;
        constraints.maxAspectRatio /= n;
        constraints.maxArea *= n;
      } else if (chartType[0] === "c") {
        constraints.minRadius *= n;
        constraints.maxArea *= n;
      } else if (chartType[0] === "r") {
        constraints.minArclen *= n;
        constraints.maxArea *= n;
      }
    }
  }

  // for line chart: ensure that each x-value >= ${minValueWidth} pixels.
  if (chartType[2] == "line") {
    const r = Math.min(1 + 0.25 * node.Y.data.length, 2);
    let minLen = Math.min(node.X.data[0].length * minValueWidth, 1000); // restrict minLen <= 1000 pixel (in case too many x-values)
    if (chartType[0] === "v") {
      constraints.minWidth = Math.max(minLen, constraints.minWidth);
    } else if (chartType[0] === "h") {
      constraints.minHeight = Math.max(minLen, constraints.minHeight);
    } else if (chartType[0] === "r") {
      // for r line chart, as there are no points, we reduce the requirement on minArclen
      constraints.minArclen = Math.max(minLen / 2.5, constraints.minArclen);
    }
    constraints.minWidth *= r;
    constraints.minHeight *= r;
  }

  // for scatter plot: make sure at least 100x100
  if (chartType[2] === "scatter") {
    constraints.minWidth = Math.max(100, constraints.minWidth);
    constraints.minHeight = Math.max(100, constraints.minHeight);
    constraints.minRadius = Math.max(100, constraints.minRadius);
    constraints.minArclen = Math.max(100, constraints.minArclen);
  }

  // for link chart: ensure that the distance between two categories >= 200 pixels.
  if (chartType[2] === "link") {
    const minDistance = 100;
    if (chartType[0] === "v") {
      constraints.minHeight = Math.max(minDistance, constraints.minHeight);
    } else if (chartType[0] === "h") {
      constraints.minWidth = Math.max(minDistance, constraints.minWidth);
    }
    // constraints.maxArea = 1000 * 500;
    constraints.maxArea = Number.MAX_VALUE;
  }

  if (chartType[2] === "parea") {
    constraints.maxArea = Number.MAX_VALUE;
  }
}

function initBasicCharts(root) {
  // for Cartesian coordinate system
  let currentTop = 100;
  let currentLeft = 100;
  // for Polar coordinate system
  let currentInnerRadius = 0;
  let cx = 1000;
  let cy = 1000;

  traverseLeafNodes(root, (leafNode) => {
    let order = null;
    let order2 = null;
    // register order map
    if (leafNode.X.data[0].every((x) => typeof x === "string")) {
      if (!globalSettings.orderMaps[leafNode.X.name]) {
        globalSettings.registerOrderMap(
          leafNode.X.name,
          leafNode.X.data[0],
          columnAggregate(leafNode.Y.data),
        );
      }
      order = globalSettings.orderMaps[leafNode.X.name];
      order = Object.keys(order).sort((a, b) => order[a] - order[b]);
    }
    if (leafNode.chart_type.includes("link")) {
      if (!globalSettings.orderMaps[leafNode.label_name]) {
        globalSettings.registerOrderMap(
          leafNode.label_name,
          leafNode.label,
          leafNode.Y.data.map((y) => mySum(y)),
        );
      }
      order2 = globalSettings.orderMaps[leafNode.label_name];
      order2 = Object.keys(order2).sort((a, b) => order2[a] - order2[b]);
    }

    const chartType = extractChartType(leafNode.chart_type);

    // recommended size
    let radius = 100;
    let angle = Math.PI * 2;
    let width = 200;
    let height = 200;

    // recommended aspect ratio range
    const [aspectRatio, minAspectRatio, maxAspectRatio] =
      recommendAspectRatio(leafNode);
    if (chartType[0] === "v") {
      height = width / aspectRatio;
    } else if (chartType[0] === "h") {
      width = height * aspectRatio;
    }

    // for grouped bar chart: adjust width & height or radius
    if (chartType[1] === "g") {
      const numLabel = leafNode.label.length;
      const numX = leafNode.X.data[0].length;
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

    if (leafNode.conditions && leafNode.conditions.length > 0) {
      // union node, and its parent has a union axis
      const unionName = Object.keys(extractCondition(leafNode.conditions))[0];
      const unionDir = leafNode.parent.spatial_arrangement;
      const n = leafNode.parent.children.length;
      const ratio = n > 1 ? 2.7 / n : 1;
      if (unionDir === "horizontal") {
        width = Math.max(width * ratio, minWidth);
      } else if (unionDir === "vertical") {
        height = Math.max(height * ratio, minHeight);
      } else if (unionDir === "radial") {
        radius *= ratio;
      } else if (unionDir === "circular") {
        // angle /= leafNode.parent.children.length; // Handle the angular case separately
      }
      const unionValues = getUnionValues(leafNode.parent, unionName);
      globalSettings.registerColorMap(unionName, unionValues, false, 1.0 / n);
    } else if (leafNode.label && leafNode.label.length > 0) {
      // union node, but its parent has no union axis.
      // E.g. stacked / grouped bar chart, or stacked line chart / scatter plot, or link
      const unionName = leafNode.label_name;
      const unionValues = leafNode.label;

      // if not link, then we must force to register a color map to distinguish different labels
      if (!leafNode.chart_type.includes("link")) {
        globalSettings.registerColorMap(unionName, unionValues, true);
      } else {
        // if link, then choose the operation column to assign colors with higher priority (and no force)
        if (leafNode.label_alignment) {
          globalSettings.registerColorMap(unionName, unionValues, false);
        } else {
          globalSettings.registerColorMap(
            leafNode.X.name,
            leafNode.X.data[0],
            false,
          );
        }
      }
    } else {
      // "true" basic chart
      if (
        leafNode.chart_type.endsWith("pie") ||
        leafNode.chart_type.endsWith("bar") ||
        leafNode.chart_type.endsWith("parea")
      ) {
        const xName = leafNode.X.name;
        const xValues = leafNode.X.data[0];
        globalSettings.registerColorMap(xName, xValues, false, 1.0);
      }
    }

    // determine yMax and yMin
    let yMax = Math.max(...leafNode.Y.data.flat());
    let yMin = Math.min(...leafNode.Y.data.flat());
    if (yMin > 0 && leafNode.chart_type.endsWith("bar")) yMin = 0;

    let xaxisName = leafNode.X.name;
    let yaxisName = leafNode.Y.name;
    if (leafNode.chart_type) {
      const [orientation, aggregation, basicType] = extractChartType(
        leafNode.chart_type,
      );
      if (aggregation === "s" && basicType === "bar") {
        const columnCount = leafNode.Y.data[0].length;
        const columnSum = new Array(columnCount).fill(0);
        for (let i = 0; i < leafNode.Y.data.length; i++) {
          for (let j = 0; j < columnCount; j++) {
            columnSum[j] += leafNode.Y.data[i][j];
          }
        }
        yMax = Math.max(...columnSum);
      }
      if (orientation === "h" || orientation === "c") {
        xaxisName = leafNode.Y.name;
        yaxisName = leafNode.X.name;
      }
    }

    // init chart config
    const chart = {
      X: leafNode.X,
      Y: leafNode.Y,
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
          display: "bottom", // position of x axis
          direction: "default", // direction of x axis
          name: xaxisName,
        },
        yAxis: {
          display: "left", // position of y axis
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
          bestAspectRatio: aspectRatio,
        },
        options: {},
      },
    };
    if (order2) {
      chart.config.order2 = order2;
    }
    if (leafNode.chart_type.endsWith("link")) {
      const [orientation, aggregation, basicType] = extractChartType(
        leafNode.chart_type,
      );
      if (orientation === "h") {
        delete chart.config.xAxis;
        if (leafNode.exchange) {
          chart.config.operationPos = "left";
          chart.config.yAxis2 = {
            display: "right_noname",
            direction: "default",
            name: leafNode.label_name,
          };
        } else {
          chart.config.operationPos = "right";
          chart.config.yAxis2 = {
            display: "left_noname",
            direction: "default",
            name: leafNode.label_name,
          };
          chart.config.yAxis.display = "right";
        }
        chart.config.yAxis.display += "_noname";
      } else if (orientation === "v") {
        delete chart.config.yAxis;
        if (leafNode.exchange) {
          chart.config.operationPos = "top";
          chart.config.xAxis2 = {
            display: "bottom_noname",
            direction: "default",
            name: leafNode.label_name,
          };
          chart.config.xAxis.display = "top";
        } else {
          chart.config.operationPos = "bottom";
          chart.config.xAxis2 = {
            display: "top_noname",
            direction: "default",
            name: leafNode.label_name,
          };
          chart.config.xAxis.display = "bottom";
        }
        chart.config.xAxis.display += "_noname";
      }
    }
    if (leafNode.chart_type.endsWith("pie")) {
      chart.config.yAxis.display = "none";
    }
    if (leafNode.chart_type.endsWith("scatter")) {
      let xMax = Math.max(...leafNode.X.data.flat());
      let xMin = Math.min(...leafNode.X.data.flat());
      chart.config.xMin = xMin;
      chart.config.xMax = xMax;
    }
    if (
      leafNode.coordinate_system === "polar" ||
      leafNode.chart_type.endsWith("pie")
    ) {
      chart.config.cx = cx;
      chart.config.cy = cy;
      updatePolarConfig(chart.config);
    } else {
      updateCentroid(chart.config);
    }

    setSizeConstraints(chart.config.constraints, leafNode);

    if (leafNode.label) {
      chart.Y.label = leafNode.label;
      chart.Y.label_name = leafNode.label_name;
    }
    chart.chartType = leafNode.chart_type;
    leafNode.chart = chart;

    currentTop += Math.max(width, height);
    currentLeft += Math.max(width, height);
    currentInnerRadius += radius;
  });
}

function adjustCircularAxis(root) {
  function circularUnionAxisCheck(node) {
    if (node && node.chart.config.unionAxis) {
      if (
        node.chart.config.unionAxis.display === "left" ||
        node.chart.config.unionAxis.display === "right"
      ) {
        return true;
      }
    }
    return false;
  }
  function radialStackCheck(node) {
    if (
      node &&
      node.composite_pattern === "stack" &&
      node.spatial_arrangement === "radial"
    ) {
      return true;
    }
    return false;
  }
  traverseAllNodes(
    root,
    (node) => {
      if (node.coordinate_system !== "polar") return;
      if (node.spatial_arrangement === "circular") {
        let endAngle = node.chart.config.endAngle;
        let startAngle = node.chart.config.startAngle;
        const nodestoAdjust = [];
        const [operationType, column] = extractOperation(node.operation);
        if (operationType === "COLUMN_JOIN") {
          for (const child of node.children) {
            const nodetoAdjust = findNodefromColumn(child, column);
            if (nodetoAdjust) {
              nodestoAdjust.push(nodetoAdjust);
            }
          }
        } else {
          for (const child of node.children) {
            nodestoAdjust.push(child);
          }
        }
        const nodeAngles = [];
        const marginAngles = [];
        const yAxisAngles = [];
        const unionAxisAngles = [];
        for (let i = 0; i < nodestoAdjust.length; i++) {
          const nodetoAdjust = nodestoAdjust[i];
          const startAngle = nodetoAdjust.chart.config.startAngle;
          const endAngle = nodetoAdjust.chart.config.endAngle;
          const chartAngle = Math.abs(endAngle - startAngle);
          let innerRadius = nodetoAdjust.chart.config.innerRadius;
          let yAxisAngle = 0;
          let unionAxisAngle = 0;
          if (
            nodetoAdjust.chart.config.yAxis &&
            nodetoAdjust.chart.config.yAxis.display !== "none"
          ) {
            const axisSize = nodetoAdjust.chart.config.yAxis.size;
            yAxisAngle = Math.atan(axisSize / innerRadius);
          }
          if (
            nodetoAdjust.vis_type === "composite" &&
            extractOperation(nodetoAdjust.operation)[0] === "ALL_UNION" &&
            nodetoAdjust.children[0].chart.config.yAxis &&
            nodetoAdjust.children[0].chart.config.yAxis.display !== "none"
          ) {
            const axisSize = nodetoAdjust.children[0].chart.config.yAxis.size;
            yAxisAngle = Math.atan(axisSize / innerRadius);
          }
          if (circularUnionAxisCheck(nodetoAdjust)) {
            unionAxisAngle = Math.atan(
              nodetoAdjust.chart.config.unionAxis.size / innerRadius,
            );
          }
          let marginAngle = 0;
          const epsilon = 1e-10;
          if (
            Math.abs(yAxisAngle) < epsilon &&
            Math.abs(unionAxisAngle) < epsilon &&
            i > 0
          ) {
            marginAngle =
              nodestoAdjust[i].chart.config.startAngle -
              nodestoAdjust[i - 1].chart.config.endAngle;
          } else {
            marginAngle = 0.05;
          }
          nodeAngles.push(chartAngle);
          yAxisAngles.push(yAxisAngle);
          unionAxisAngles.push(unionAxisAngle);
          marginAngles.push(marginAngle);
        }
        const epsilon = 1e-10;
        if (Math.abs(startAngle) < epsilon) {
          if (
            endAngle >
            startAngle +
              Math.PI * 2 -
              yAxisAngles[0] -
              unionAxisAngles[0] -
              marginAngles[0]
          ) {
            endAngle =
              startAngle +
              Math.PI * 2 -
              yAxisAngles[0] -
              unionAxisAngles[0] -
              marginAngles[0];
          }
        }
        node.chart.config.endAngle = endAngle;
        let sumOfNodeAngles = nodeAngles.reduce((a, b) => a + b, 0);
        let sumOfYAxisAngles = yAxisAngles.reduce((a, b) => a + b, 0);
        let sumOfUnionAxisAngles = unionAxisAngles.reduce((a, b) => a + b, 0);
        let sumOfMarginAngles = marginAngles.reduce((a, b) => a + b, 0);
        if (Math.abs(startAngle) < epsilon) {
          sumOfYAxisAngles -= yAxisAngles[0];
          sumOfUnionAxisAngles -= unionAxisAngles[0];
          sumOfMarginAngles -= marginAngles[0];
        }
        let scaleFactor =
          (endAngle -
            startAngle -
            sumOfYAxisAngles -
            sumOfUnionAxisAngles -
            sumOfMarginAngles) /
          sumOfNodeAngles;
        if (scaleFactor > 1) {
          scaleFactor = 1;
        }
        let currentAngle = startAngle;
        if (Math.abs(startAngle) > epsilon) {
          currentAngle =
            startAngle + unionAxisAngles[0] + yAxisAngles[0] + marginAngles[0];
        }
        for (let i = 0; i < nodestoAdjust.length; i++) {
          nodestoAdjust[i].chart.config.startAngle = currentAngle;
          nodestoAdjust[i].chart.config.endAngle =
            currentAngle + nodeAngles[i] * scaleFactor;
          currentAngle =
            nodestoAdjust[i].chart.config.endAngle +
            yAxisAngles[i + 1] +
            unionAxisAngles[i + 1] +
            marginAngles[i + 1];
          if (
            nodestoAdjust[i].vis_type === "composite" &&
            extractOperation(nodestoAdjust[i].operation)[0] === "ALL_UNION" &&
            nodestoAdjust[i].spatial_arrangement === "radial"
          ) {
            for (const child of nodestoAdjust[i].children) {
              if (
                !(
                  child.vis_type === "basic" && child.chart_type.endsWith("pie")
                )
              ) {
                child.chart.config.startAngle = Math.max(
                  child.chart.config.startAngle,
                  nodestoAdjust[i].chart.config.startAngle,
                );
                child.chart.config.endAngle = Math.min(
                  child.chart.config.endAngle,
                  nodestoAdjust[i].chart.config.endAngle,
                );
              }
            }
          }
          let _node = nodestoAdjust[i].parent;

          while (_node) {
            if (radialStackCheck(_node)) {
              const stackChildren = [];
              let flag = false;
              for (const child of _node.children) {
                const stackChild = findNodefromColumn(
                  child,
                  extractOperation(_node.operation)[1],
                );
                if (stackChild) {
                  stackChildren.push(stackChild);
                }
                if (stackChild === nodestoAdjust[i]) {
                  flag = true;
                }
              }
              if (flag) {
                for (const child of stackChildren) {
                  if (
                    !(
                      child.vis_type === "basic" &&
                      child.chart_type.endsWith("pie")
                    )
                  ) {
                    child.chart.config.startAngle =
                      nodestoAdjust[i].chart.config.startAngle;
                    child.chart.config.endAngle =
                      nodestoAdjust[i].chart.config.endAngle;
                    adjustCircularAxisForCircularUnionNode(child);
                  }
                }
              }
            }
            _node = _node.parent;
          }
          if (
            nodestoAdjust[i].vis_type === "composite" &&
            extractOperation(nodestoAdjust[i].operation)[0] === "ALL_UNION" &&
            nodestoAdjust[i].spatial_arrangement === "radial"
          ) {
            for (const child of nodestoAdjust[i].children) {
              if (
                !(
                  child.vis_type === "basic" && child.chart_type.endsWith("pie")
                )
              ) {
                child.chart.config.startAngle = Math.max(
                  child.chart.config.startAngle,
                  nodestoAdjust[i].chart.config.startAngle,
                );
                child.chart.config.endAngle = Math.min(
                  child.chart.config.endAngle,
                  nodestoAdjust[i].chart.config.endAngle,
                );
              }
            }
          }
        }
      } else if (node.vis_type === "basic") {
        // Here 6.1 represents 2PI
        let totalAngle =
          node.chart.config.endAngle - node.chart.config.startAngle;
        if (node.chart_type.endsWith("pie") && totalAngle > 6.1) {
          node.chart.config.endAngle = Math.PI * 2;
          node.chart.config.startAngle = 0;
          return;
        }
        let yAxisAngle = 0;
        let unionAxisAngle = 0;
        let innerRadius = node.chart.config.innerRadius;

        if (node.chart.config.yAxis.display !== "none") {
          const axisSize = node.chart.config.yAxis.size;
          yAxisAngle = Math.atan(axisSize / innerRadius);
        }
        if (circularUnionAxisCheck(node.parent)) {
          unionAxisAngle = Math.atan(
            node.parent.chart.config.unionAxis.size / innerRadius,
          );
        }
        if (totalAngle + yAxisAngle + unionAxisAngle >= 2 * Math.PI) {
          node.chart.config.endAngle =
            node.chart.config.startAngle +
            2 * Math.PI -
            yAxisAngle -
            unionAxisAngle;
        }
        if (circularUnionAxisCheck(node.parent)) {
          node.parent.chart.config.startAngle = Math.max(
            node.parent.chart.config.startAngle,
            node.chart.config.startAngle,
          );
          node.parent.chart.config.endAngle = Math.min(
            node.parent.chart.config.endAngle,
            node.chart.config.endAngle,
          );
          for (const child of node.parent.children) {
            if (
              !(child.vis_type === "basic" && child.chart_type.endsWith("pie"))
            ) {
              child.chart.config.startAngle = Math.max(
                child.chart.config.startAngle,
                node.chart.config.startAngle,
              );
              child.chart.config.endAngle = Math.min(
                child.chart.config.endAngle,
                node.chart.config.endAngle,
              );
            }
          }
        }
        if (radialStackCheck(node.parent)) {
          const stackChildren = [];
          for (const child of node.parent.children) {
            const stackChild = findNodefromColumn(
              child,
              extractOperation(node.parent.operation)[1],
            );
            if (stackChild) {
              stackChildren.push(stackChild);
            }
          }
          for (const child of stackChildren) {
            if (
              !(child.vis_type === "basic" && child.chart_type.endsWith("pie"))
            ) {
              child.chart.config.startAngle = Math.max(
                child.chart.config.startAngle,
                node.chart.config.startAngle,
                node.parent.chart.config.startAngle,
              );
              child.chart.config.endAngle = Math.min(
                child.chart.config.endAngle,
                node.chart.config.endAngle,
                node.parent.chart.config.endAngle,
              );
              if (
                child.vis_type === "composite" &&
                extractOperation(child.operation)[0] === "ALL_UNION" &&
                child.spatial_arrangement === "radial"
              ) {
                for (const grandChild of child.children) {
                  if (
                    !(
                      child.vis_type === "basic" &&
                      child.chart_type.endsWith("pie")
                    )
                  ) {
                    grandChild.chart.config.startAngle = Math.max(
                      grandChild.chart.config.startAngle,
                      node.chart.config.startAngle,
                    );
                    grandChild.chart.config.endAngle = Math.min(
                      grandChild.chart.config.endAngle,
                      node.chart.config.endAngle,
                    );
                  }
                }
              }
            }
          }
        }
        if (
          extractOperation(node.parent.operation)[0] === "ALL_UNION" &&
          node.parent.spatial_arrangement === "radial" &&
          radialStackCheck(node.parent.parent)
        ) {
          const stackChildren = [];
          for (const child of node.parent.parent.children) {
            const stackChild = findNodefromColumn(
              child,
              extractOperation(node.parent.parent.operation)[1],
            );
            if (stackChild) {
              stackChildren.push(stackChild);
            }
          }
          for (const child of stackChildren) {
            if (
              !(child.vis_type === "basic" && child.chart_type.endsWith("pie"))
            ) {
              child.chart.config.startAngle = Math.max(
                child.chart.config.startAngle,
                node.chart.config.startAngle,
              );
              child.chart.config.endAngle = Math.min(
                child.chart.config.endAngle,
                node.chart.config.endAngle,
              );
            }
            for (const grandChild of child.children) {
              if (
                !(
                  grandChild.vis_type === "basic" &&
                  grandChild.chart_type.endsWith("pie")
                )
              ) {
                grandChild.chart.config.startAngle = Math.max(
                  grandChild.chart.config.startAngle,
                  node.chart.config.startAngle,
                );
                grandChild.chart.config.endAngle = Math.min(
                  grandChild.chart.config.endAngle,
                  node.chart.config.endAngle,
                );
              }
            }
          }
        }
      }
      if (radialStackCheck(node.parent)) {
        const stackChildren = [];
        for (const child of node.parent.children) {
          const stackChild = findNodefromColumn(
            child,
            extractOperation(node.parent.operation)[1],
          );
          if (stackChild) {
            stackChildren.push(stackChild);
          }
        }
        for (const child of stackChildren) {
          if (
            !(child.vis_type === "basic" && child.chart_type.endsWith("pie"))
          ) {
            child.chart.config.startAngle = Math.max(
              child.chart.config.startAngle,
              node.chart.config.startAngle,
              node.parent.chart.config.startAngle,
            );
            child.chart.config.endAngle = Math.min(
              child.chart.config.endAngle,
              node.chart.config.endAngle,
              node.parent.chart.config.endAngle,
            );
            adjustCircularAxisForCircularUnionNode(child);
            if (
              child.vis_type === "composite" &&
              extractOperation(child.operation)[0] === "ALL_UNION" &&
              child.spatial_arrangement === "radial"
            ) {
              for (const grandChild of child.children) {
                if (
                  !(
                    child.vis_type === "basic" &&
                    child.chart_type.endsWith("pie")
                  )
                ) {
                  grandChild.chart.config.startAngle = Math.max(
                    grandChild.chart.config.startAngle,
                    node.chart.config.startAngle,
                  );
                  grandChild.chart.config.endAngle = Math.min(
                    grandChild.chart.config.endAngle,
                    node.chart.config.endAngle,
                  );
                }
              }
            }
          }
        }
      }
    },
    "pre",
  );
}

function handleAxis(parent, nodes) {
  // handle axis display, direction, and range, as well as node neighbors
  const joinAxisOrientation = {
    horizontal: "vertical",
    vertical: "horizontal",
    radial: "circular",
    circular: "radial",
    irregular: "irregular",
  };
  const orientationMap = {
    v: "vertical",
    h: "horizontal",
    r: "radial",
    c: "circular",
    i: "irregular",
  };

  function _coord(dir) {
    return ["vertical", "horizontal"].includes(dir) ? "cartesian" : "polar";
  }

  function _xy(dir) {
    return ["vertical", "radial"].includes(dir) ? "x" : "y";
  }

  const spatialArrangement = parent.spatial_arrangement;
  const [operationType, operationColumnName] = extractOperation(
    parent.operation,
  );

  const operationDir =
    operationType === "COLUMN_JOIN"
      ? joinAxisOrientation[spatialArrangement]
      : spatialArrangement;
  const direction = "default";
  let display = _xy(operationDir) === "x" ? "left" : "bottom";

  // handle uniform range and direction for children of union nodes
  if (operationType === "ALL_UNION") {
    const unionData = {
      data: nodes.map(
        (node) => extractCondition(node.conditions)[operationColumnName],
      ),
      name: operationColumnName,
    };
    parent.chart.unionData = unionData;
    parent.chart.config.unionAxis = {
      display: display,
      direction: direction,
      name: operationColumnName,
    };

    if (!globalSettings.orderMaps[operationColumnName]) {
      globalSettings.registerOrderMap(
        operationColumnName,
        unionData.data,
        nodes.map((node) => getValueField(node)),
      );
    }
    const order = globalSettings.orderMaps[operationColumnName];
    parent.chart.config.order = Object.keys(order).sort(
      (a, b) => order[a] - order[b],
    );
    setRangeandDirectionConfig(
      nodes.map((x) => x.chart),
      nodes[0].Y.name,
      orientationMap[extractChartType(nodes[0].chart_type)[0]],
      "default",
      false,
    );
    if (nodes[0].chart_type.endsWith("scatter")) {
      setRangeandDirectionConfig(
        nodes.map((x) => x.chart),
        nodes[0].X.name,
        orientationMap[extractChartType(nodes[0].chart_type)[0]],
        "default",
        false,
      );
    }
    // setting neighbors
    for (let i = 0; i < nodes.length; i++) {
      parent.neighbors["inner"].push(nodes[i]);
      nodes[i].neighbors["outer"] = parent;
    }
  }

  // setting neighbors
  const neighborOrientationMap = {
    vertical: ["top", "bottom"],
    radial: ["bottom", "top"],
    horizontal: ["left", "right"],
    circular: ["left", "right"],
  };
  if (!neighborOrientationMap.hasOwnProperty(spatialArrangement)) {
    throw new Error(`Unsupported spatial arrangement: ${spatialArrangement}`);
  }
  const [prev, next] = neighborOrientationMap[spatialArrangement];
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i + 1].neighbors[prev] = nodes[i];
    nodes[i].neighbors[next] = nodes[i + 1];
  }

  // setting display
  const nodeToHandle = [];
  for (const node of nodes) {
    const allItems = [...(node.children ?? []), node];
    for (const node of allItems) {
      if (
        node.X?.name === operationColumnName ||
        node.Y?.name === operationColumnName ||
        node.label_name === operationColumnName
      ) {
        if (_xy(operationDir) === "y") {
          nodeToHandle.push([node, "x"]);
        } else if (_xy(operationDir) === "x") {
          nodeToHandle.push([node, "y"]);
        }
      }
      if (node.chart.unionData?.name === operationColumnName) {
        nodeToHandle.push([node, "union"]);
      }
    }
  }

  if (operationType === "ALL_UNION" && nodeToHandle.length === 0) {
    const axis = _xy(operationDir);
    for (const node of nodes) {
      nodeToHandle.push([node, axis]);
    }
    display = axis === "x" ? "bottom" : "left";
  }

  // for repetition, stack
  for (let i = 0; i < nodeToHandle.length; i++) {
    if (_coord(spatialArrangement) === "cartesian") {
      // Cartesian system
      if (display === "top" || display === "left") {
        if (i === 0) {
          continue;
        }
      } else if (display === "bottom" || display === "right") {
        if (i === nodeToHandle.length - 1) {
          continue;
        }
      }
    } else {
      // polar system
      if (["left", "bottom"].includes(display) && i === 0) {
        continue;
      } else if (
        ["top", "right"].includes(display) &&
        i === nodeToHandle.length - 1
      ) {
        continue;
      }
    }

    const [node, axis] = nodeToHandle[i];
    switch (axis) {
      case "union":
        node.chart.config.unionAxis.display = "none";
        break;
      case "x":
        (node.label_alignment
          ? node.chart.config.xAxis2
          : node.chart.config.xAxis
        ).display = "none";
        break;
      case "y":
        (node.label_alignment
          ? node.chart.config.yAxis2
          : node.chart.config.yAxis
        ).display = "none";
        break;
    }
  }

  // setting direction and range
  setRangeandDirectionConfig(
    nodeToHandle.map((x) => x[0].chart),
    operationColumnName,
    operationDir,
    direction,
  );
}

function handleRepetition(node, polar) {
  if (node.children.length <= 1) {
    throw new Error("Repetition pattern requires at least two children");
  }

  // now we only consider the case when all children are basic charts
  let allBasicCharts = true;
  for (const child of node.children) {
    if (!validateBasicChart(child)) {
      allBasicCharts = false;
      break;
    }
  }
  if (!allBasicCharts) {
    throw new Error("Repetition pattern requires basic charts as children");
  }

  const marginAngle = (10 / 180) * Math.PI; // TODO: change this to be proportional?
  const margin = 20;
  let tightLayout = false;
  if (
    !node.parent ||
    node.spatial_arrangement === node.parent.spatial_arrangement
  ) {
    tightLayout = true; // In this case, use a fixed 20 margin instead of 0.3 innerPadding
  } else {
    let allUnion = true;
    for (const child of node.parent.children) {
      if (
        child.vis_type !== "composite" ||
        extractOperation(child.operation)[0] !== "ALL_UNION"
      ) {
        allUnion = false;
      }
    }
    if (allUnion) tightLayout = true;
  }

  if (
    node.spatial_arrangement === "vertical" ||
    node.spatial_arrangement === "horizontal"
  ) {
    // Cartesian coordinate system
    if (polar) {
      throw new Error(
        "Mismatch between coordinate system and spatial arrangement",
      );
    }

    // validate that all charts are orthogonal
    node.children.forEach((child) => {
      if (!isCartesian(child.chart)) {
        throw new Error(
          "Repetition pattern for Cartesian coordinate system requires orthogonal charts",
        );
      }
    });

    handleConditionForUnion(node);

    if (node.spatial_arrangement === "vertical") {
      const config = node.children[0].chart.config;
      let currentTop = config.top;
      const commonLeft = config.left;
      const commonWidth = config.width;
      for (let i = 0; i < node.children.length; i++) {
        const chart = node.children[i].chart;
        // make sure the two charts are aligned for the same x axis
        const aspectRatio = chart.config.width / chart.config.height;
        chart.config.width = commonWidth;
        chart.config.height = chart.config.width / aspectRatio;

        // change position of chart
        chart.config.top = currentTop;
        currentTop += tightLayout
          ? margin + chart.config.height
          : chart.config.height / (1 - globalSettings.padding);
        chart.config.left = commonLeft;
        updateCentroid(chart.config);
      }
    } else if (node.spatial_arrangement === "horizontal") {
      const config = node.children[0].chart.config;
      const commonTop = config.top;
      let currentLeft = config.left;
      const commonHeight = config.height;
      for (let i = 0; i < node.children.length; i++) {
        const chart = node.children[i].chart;
        // make sure the two charts are aligned for the same y axis
        const aspectRatio = chart.config.width / chart.config.height;
        chart.config.height = commonHeight;
        chart.config.width = chart.config.height * aspectRatio;

        // change position of chart
        chart.config.top = commonTop;
        chart.config.left = currentLeft;
        currentLeft += tightLayout
          ? margin + chart.config.width
          : chart.config.width / (1 - globalSettings.padding);
        updateCentroid(chart.config);
      }
    }
  } else if (
    node.spatial_arrangement === "radial" ||
    node.spatial_arrangement === "circular"
  ) {
    // Polar coordinate system
    if (!polar) {
      throw new Error(
        "Mismatch between coordinate system and spatial arrangement",
      );
    }

    // validate that all charts are not orthogonal
    node.children.forEach((child) => {
      if (isCartesian(child.chart)) {
        throw new Error(
          "Repetition pattern for polar coordinate system requires unorthogonal charts",
        );
      }
    });

    handleConditionForUnion(node);

    if (node.spatial_arrangement === "radial") {
      const config = node.children[0].chart.config;
      let currentOuterRadius = config.outerRadius;
      const commonHeight = config.outerRadius - config.innerRadius;

      // alignment condition: `startAngle` and `endAngle` must be same for all charts
      const commonStartAngle = config.startAngle;
      const commonEndAngle = config.endAngle;

      for (let i = 1; i < node.children.length; i++) {
        const chart = node.children[i].chart;
        chart.config.startAngle = commonStartAngle;
        chart.config.endAngle = commonEndAngle;
        if (tightLayout) {
          chart.config.innerRadius = currentOuterRadius + margin;
        } else {
          chart.config.innerRadius =
            currentOuterRadius +
            (commonHeight * globalSettings.padding) /
              (1 - globalSettings.padding);
        }
        chart.config.outerRadius = chart.config.innerRadius + commonHeight;
        currentOuterRadius = chart.config.outerRadius;
        updatePolarConfig(chart.config);
      }
    } else if (node.spatial_arrangement === "circular") {
      // TODO: angle allocation should not be equal for all children!
      const config = node.children[0].chart.config;
      const commonInnerRadius = config.innerRadius;
      const commonOuterRadius = config.outerRadius;

      const startAngle = config.startAngle;
      const deltaAngle =
        (config.endAngle - config.startAngle) / node.children.length;

      for (let i = 0; i < node.children.length; i++) {
        const chart = node.children[i].chart;
        chart.config.startAngle = startAngle + i * deltaAngle;
        chart.config.endAngle = startAngle + (i + 1) * deltaAngle - marginAngle;
        // assume no arc margin between consecutive charts
        chart.config.innerRadius = commonInnerRadius;
        chart.config.outerRadius = commonOuterRadius;
        updatePolarConfig(chart.config);
      }
    }
  } else {
    throw new Error(
      `Unsupported spatial arrangement: ${node.spatial_arrangement}`,
    );
  }

  handleAxis(node, node.children);

  // remove repeated axis
  if (node.coordinate_system === "cartesian") {
    const repeatedAxis =
      node.spatial_arrangement === "vertical" ? "yAxis" : "xAxis";
    const otherAxis =
      node.spatial_arrangement === "vertical" ? "xAxis" : "yAxis";
    for (const child of node.children) {
      const config = child.chart.config;
      config[repeatedAxis].display = "none";
      config[repeatedAxis].none_type = "repeatedAxis";
      if (config[otherAxis].display !== "none") {
        const childChartType = extractChartType(child.chart_type);
        let otherAxisData;
        if (node.spatial_arrangement.startsWith(childChartType[0])) {
          otherAxisData = child.X.data;
        } else {
          otherAxisData = child.Y.data;
        }
        if (typeof otherAxisData[0][0] === "string") {
          config[otherAxis].display += "_noname";
        }
      }
    }
  } else {
    const repeatedAxis =
      node.spatial_arrangement === "radial" ? "yAxis" : "xAxis";
    const otherAxis = node.spatial_arrangement === "radial" ? "xAxis" : "yAxis";
    for (const child of node.children) {
      const config = child.chart.config;
      config[repeatedAxis].display = "none";
      config[repeatedAxis].none_type = "repeatedAxis";
      if (config[otherAxis].display !== "none") {
        const childChartType = extractChartType(child.chart_type);
        let otherAxisData;
        if (node.spatial_arrangement.startsWith(childChartType[0])) {
          otherAxisData = child.X.data;
        } else {
          otherAxisData = child.Y.data;
        }
        if (typeof otherAxisData[0][0] === "string") {
          config[otherAxis].display += "_noname";
        }
      }
    }
  }

  // handle chart options
  // TODO: currently only handles the cartesian case
  if (node.parent) {
    const isFirst = node.id === node.parent.children[0].id;
    const isLast =
      node.id === node.parent.children[node.parent.children.length - 1].id;
    const isMiddle = !isFirst && !isLast;

    if (
      isMiddle &&
      node.spatial_arrangement !== node.parent.spatial_arrangement &&
      node.children[0].chart_type.endsWith("bar")
    ) {
      // If a union node is sandwiched in the middle, add a border for each child (aligned with node.parent)
      setChildrenOption(node, "border", node.parent.spatial_arrangement);
    }

    // Handle bar chart related options
    if (node.children[0].chart_type.endsWith("bar")) {
      setChildrenOption(node, "showBcgBar", true);
      if (isMiddle) {
        // setChildrenOption(node, "showValues", false); // If it's in the middle, don't show values
      } else {
        setChildrenOption(node, "showBaseline", false); // Otherwise, show values and hide the baseline
      }
      if (
        node.spatial_arrangement.startsWith(
          extractChartType(node.children[0].chart_type)[0],
        )
      ) {
        // e.g. horizontally repetition for horizontal bar chart
        setChildrenOption(node, "autoAdjust", true);
      }
    }
  }

  if (node.spatial_arrangement === "circular") {
    if (node.children[0].chart_type === "rbar") {
      node.children[0].chart.config.options["showLabels"] = true;
    }
  }
}

function setBoundingBoxForSibling(node, margin) {
  // TODO: currently only handles the cartesian case
  // Consider the following case:
  // Tree structure: (A, B, ((C, D, E), F))
  // visualization structure:
  //     C
  // A B D
  //     E F
  // Here we want to set bbox for the sibling of D, when handling stack for root.
  // Then we have to set bbox for ((C, D, E), F).
  const parent = node.parent;
  if (!parent) return;
  const children = parent.children;
  const index = children.indexOf(node);
  const nodeBoundingBox = node.chart.config;
  const column = extractOperation(parent.operation)[1];

  function _getBBox(config) {
    return [config.left, config.top, config.width, config.height];
  }

  function _transform(box0, box1, box11) {
    // each box: [x, y, w, h] structure
    // box1 --> box11
    // box0 --> box00 (return)
    const [x1, y1, w1, h1] = box1;
    const [x11, y11, w11, h11] = box11;
    const [x0, y0, w0, h0] = box0;
    const x00 = x11 + ((x0 - x1) * w11) / w1;
    const y00 = y11 + ((y0 - y1) * h11) / h1;
    const w00 = (w0 * w11) / w1;
    const h00 = (h0 * h11) / h1;
    return [x00, y00, w00, h00];
  }

  function _alignNeighborChain(start, baseCfg, position) {
    let curr = start;
    let prevCfg = baseCfg;

    while (curr) {
      const currCfg = curr.chart.config;
      const ar = currCfg.width / currCfg.height;

      if (["top", "bottom"].includes(position)) {
        currCfg.width = prevCfg.width;
        currCfg.height = currCfg.width / ar;
        currCfg.left = prevCfg.left;
        currCfg.top =
          position === "top"
            ? prevCfg.top - currCfg.height - margin
            : prevCfg.top + prevCfg.height + margin;
      } else if (["left", "right"].includes(position)) {
        currCfg.height = prevCfg.height;
        currCfg.width = currCfg.height * ar;
        currCfg.top = prevCfg.top;
        currCfg.left =
          position === "left"
            ? prevCfg.left - currCfg.width - margin
            : prevCfg.left + prevCfg.width + margin;
      }

      resetBoundingBox(curr);

      prevCfg = currCfg;
      curr = curr.neighbors[position];
    }
  }

  function _align(node, direction) {
    const baseCfg = node.chart.config;
    if (direction === "vertical") {
      _alignNeighborChain(node.neighbors.top, baseCfg, "top");
      _alignNeighborChain(node.neighbors.bottom, baseCfg, "bottom");
    } else if (direction === "horizontal") {
      _alignNeighborChain(node.neighbors.left, baseCfg, "left");
      _alignNeighborChain(node.neighbors.right, baseCfg, "right");
    }
  }

  switch (parent.spatial_arrangement) {
    case "vertical": {
      const width = nodeBoundingBox.width;
      let top = nodeBoundingBox.top + nodeBoundingBox.height + margin;

      // keep the aspect ratio for all siblings
      for (let i = index + 1; i < children.length; i++) {
        const sibling = findNodefromColumn(children[i], column);
        const box1 = _getBBox(sibling.chart.config);
        const aspectRatio = box1[2] / box1[3];
        const box11 = [nodeBoundingBox.left, top, width, width / aspectRatio];
        const box0 = _getBBox(children[i].chart.config);
        const [x00, y00, w00, h00] = _transform(box0, box1, box11);

        setBoundingBoxForTree(children[i], y00, x00, w00, h00);
        _align(children[i], "horizontal");
        top += h00 + margin;
      }

      top = nodeBoundingBox.top - margin;
      for (let i = index - 1; i >= 0; i--) {
        const sibling = findNodefromColumn(children[i], column);
        const box1 = _getBBox(sibling.chart.config);
        const aspectRatio = box1[2] / box1[3];
        const box11 = [
          nodeBoundingBox.left,
          top - width / aspectRatio,
          width,
          width / aspectRatio,
        ];
        const box0 = _getBBox(children[i].chart.config);
        const [x00, y00, w00, h00] = _transform(box0, box1, box11);

        setBoundingBoxForTree(children[i], y00, x00, w00, h00);
        _align(children[i], "horizontal");
        top -= h00 + margin;
      }
      break;
    }
    case "horizontal": {
      const height = nodeBoundingBox.height;
      let left = nodeBoundingBox.left + nodeBoundingBox.width + margin;

      // keep the aspect ratio for all siblings
      for (let i = index + 1; i < children.length; i++) {
        const sibling = findNodefromColumn(children[i], column);
        const box1 = _getBBox(sibling.chart.config);
        const aspectRatio = box1[2] / box1[3];
        const box11 = [left, nodeBoundingBox.top, aspectRatio * height, height];
        const box0 = _getBBox(children[i].chart.config);
        const [x00, y00, w00, h00] = _transform(box0, box1, box11);

        setBoundingBoxForTree(children[i], y00, x00, w00, h00);
        _align(children[i], "vertical");
        left += w00 + margin;
      }

      left = nodeBoundingBox.left - margin;
      for (let i = index - 1; i >= 0; i--) {
        const sibling = findNodefromColumn(children[i], column);
        const box1 = _getBBox(sibling.chart.config);
        const aspectRatio = box1[2] / box1[3];
        const box11 = [
          left - aspectRatio * height,
          nodeBoundingBox.top,
          aspectRatio * height,
          height,
        ];
        const box0 = _getBBox(children[i].chart.config);
        const [x00, y00, w00, h00] = _transform(box0, box1, box11);

        setBoundingBoxForTree(children[i], y00, x00, w00, h00);
        _align(children[i], "vertical");
        left -= w00 + margin;
      }
      break;
    }
    case "radial": {
      // TODO: this code path hasn't been synchronized with the Cartesian-case changes above
      // But ideally polar composites should avoid this situation
      const sAngle = nodeBoundingBox.startAngle;
      const eAngle = nodeBoundingBox.endAngle;
      let radius = nodeBoundingBox.outerRadius + margin;
      for (let i = index + 1; i < children.length; i++) {
        const config = children[i].chart.config;
        const deltaRadius = config.outerRadius - config.innerRadius;
        setBoundingBoxForTree(
          children[i],
          radius,
          radius + deltaRadius,
          sAngle,
          eAngle,
        );
        radius = config.outerRadius + margin;
      }

      // caution: we don't want innerRadius < 0.
      // so it's different from the Cartesian case where top/left can be less than zero.
      // first, compute the "ideal" total height for these nodes.
      let totalHeight = index * margin;
      for (let i = 0; i < index; i++) {
        totalHeight +=
          children[i].chart.config.outerRadius -
          children[i].chart.config.innerRadius;
      }
      const scale = nodeBoundingBox.innerRadius / totalHeight;
      const actualMargin = margin * scale;
      radius = nodeBoundingBox.innerRadius - actualMargin;
      for (let i = index - 1; i >= 0; i--) {
        const config = children[i].chart.config;
        const deltaRadius = (config.outerRadius - config.innerRadius) * scale;
        setBoundingBoxForTree(
          children[i],
          Math.max(0, radius - deltaRadius),
          radius,
          sAngle,
          eAngle,
        );
        radius = config.innerRadius - actualMargin;
      }
      break;
    }
    case "circular": {
      const iRadius = nodeBoundingBox.innerRadius;
      const oRadius = nodeBoundingBox.outerRadius;
      let sAngle = nodeBoundingBox.startAngle;
      let eAngle = nodeBoundingBox.endAngle;

      // in circular case, both the children with id < index and id > index should be stricted in the correct range.
      // that is, either [0, sAngle] or [eAngle, 2 * Math.PI - marginAngle]
      let sAngleList = new Array(children.length).fill(0);
      let eAngleList = new Array(children.length).fill(0);

      let startAngle = eAngle + margin;
      for (let i = index + 1; i < children.length; i++) {
        const config = children[i].chart.config;
        const deltaAngle = config.endAngle - config.startAngle;
        sAngleList[i] = startAngle;
        eAngleList[i] = startAngle + deltaAngle;
        startAngle = config.endAngle + margin;
      }

      let endAngle = sAngle - margin;
      for (let i = index - 1; i >= 0; i--) {
        const config = children[i].chart.config;
        const deltaAngle = config.endAngle - config.startAngle;
        sAngleList[i] = endAngle - deltaAngle;
        eAngleList[i] = endAngle;
        endAngle = config.startAngle - margin;
      }

      // rescale such that config[0].startAngle == 0
      let baseAngle = sAngleList[0];
      let scale = sAngle / (sAngle - baseAngle);
      for (let i = index - 1; i >= 0; i--) {
        sAngleList[i] = scale * (sAngleList[i] - baseAngle);
        eAngleList[i] = scale * (eAngleList[i] - baseAngle);
      }

      // rescale such that config[-1].endAngle == 2PI - margin
      baseAngle = eAngleList[children.length - 1];
      scale = (2 * Math.PI - margin - endAngle) / (baseAngle - endAngle);
      for (let i = index + 1; i < children.length; i++) {
        sAngleList[i] = scale * (sAngleList[i] - endAngle) + endAngle;
        eAngleList[i] = scale * (eAngleList[i] - endAngle) + endAngle;
      }

      for (let i = 0; i < children.length; i++) {
        if (i === index) continue;
        setBoundingBoxForTree(
          children[i],
          iRadius,
          oRadius,
          sAngleList[i],
          eAngleList[i],
        );
      }

      break;
    }
    default: {
      throw new Error(
        `Unsupported spatial arrangement: ${parent.spatial_arrangement}`,
      );
    }
  }
}

function calculateProportions(nodes) {
  const importances = nodes.map((node) => node.importance);
  const proportions = importances;
  const totalProportions = proportions.reduce((a, b) => a + b, 0);
  proportions.forEach((proportion, i) => {
    proportions[i] = proportion / totalProportions;
  });
  return proportions;
}

function handleStack(node, polar) {
  if (node.children.length <= 1) {
    throw new Error("Stack pattern requires at least two children");
  }

  const margin = 20; // margin between charts, for [vertical/horizontal/radial] alignment
  const marginAngle = (10 / 180) * Math.PI;

  const [_, column] = extractOperation(node.operation);
  let stackNodes = [];
  for (const child of node.children) {
    const stackNode = findNodefromColumn(child, column);
    if (!stackNode) {
      throw new Error(`Cannot find column ${column} in node ${child.id}`);
    }
    stackNodes.push(stackNode);
  }
  const proportions = calculateProportions(stackNodes);

  switch (node.spatial_arrangement) {
    case "vertical": {
      if (polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }
      const chart0 = stackNodes[0].chart;
      let top = chart0.config.top;
      const left = chart0.config.left;

      // prepare for the optimization algorithm
      let w = [],
        h = [],
        constraints = [],
        hasSibling = [];

      for (let i = 0; i < stackNodes.length; i++) {
        const stackNode = stackNodes[i];
        if (!validateBoundingBox(stackNode)) {
          setBoundingBox(stackNode);
        }

        w.push(stackNode.chart.config.width);
        h.push(stackNode.chart.config.height);
        constraints.push(stackNode.chart.config.constraints);
        hasSibling.push(stackNode.parent.spatial_arrangement !== "vertical");
      }

      optimizeVStack(w, h, constraints, hasSibling);

      // adjust height for link
      for (let i = 0; i < stackNodes.length; i++) {
        const _width = w[i];
        if (_width > 1500 && stackNodes[i].chart_type?.endsWith("link")) {
          h[i] = _width / 5;
        }
      }

      // set new BBox
      for (let i = 0; i < stackNodes.length; i++) {
        setBoundingBoxForTree(stackNodes[i], top, left, w[i], h[i]);
        if (stackNodes[i].parent.spatial_arrangement !== "vertical") {
          setBoundingBoxForSibling(stackNodes[i], margin);
        }
        top += h[i] + margin;
      }
      break;
    }
    case "horizontal": {
      if (polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }
      const chart0 = stackNodes[0].chart;
      const top = chart0.config.top;
      let left = chart0.config.left;

      // prepare for the optimization algorithm
      let w = [],
        h = [],
        constraints = [],
        hasSibling = [];

      for (let i = 0; i < stackNodes.length; i++) {
        const stackNode = stackNodes[i];
        if (!validateBoundingBox(stackNode)) {
          setBoundingBox(stackNode);
        }

        w.push(stackNode.chart.config.width);
        h.push(stackNode.chart.config.height);
        constraints.push(stackNode.chart.config.constraints);
        hasSibling.push(stackNode.parent.spatial_arrangement !== "horizontal");
      }

      optimizeHStack(w, h, constraints, hasSibling);

      // adjust width for link
      for (let i = 0; i < stackNodes.length; i++) {
        const _height = h[i];
        if (_height > 1500 && stackNodes[i].chart_type?.endsWith("link")) {
          w[i] = _height / 5;
        }
      }

      // set new BBox
      for (let i = 0; i < stackNodes.length; i++) {
        setBoundingBoxForTree(stackNodes[i], top, left, w[i], h[i]);
        if (stackNodes[i].parent.spatial_arrangement !== "horizontal") {
          setBoundingBoxForSibling(stackNodes[i], margin);
        }
        left += w[i] + margin;
      }
      break;
    }
    case "radial": {
      if (!polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }

      let r1 = [],
        r2 = [],
        a1 = [],
        a2 = [],
        constraints = [];

      for (let i = 0; i < stackNodes.length; i++) {
        const stackNode = stackNodes[i];
        if (!validateBoundingBox(stackNode)) {
          setBoundingBox(stackNode);
        }

        const cfg = stackNode.chart.config;
        r1.push(cfg.innerRadius);
        r2.push(cfg.outerRadius);
        a1.push(cfg.startAngle);
        a2.push(cfg.endAngle);
        constraints.push(cfg.constraints);
      }

      optimizeRStack(r1, r2, a1, a2, constraints, margin);

      for (let i = 0; i < stackNodes.length; i++) {
        setBoundingBoxForTree(stackNodes[i], r1[i], r2[i], a1[i], a2[i]);
        if (stackNodes[i].parent.spatial_arrangement !== "radial") {
          setBoundingBoxForSibling(stackNodes[i], marginAngle);
        }
      }
      break;
    }
    case "circular": {
      if (!polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }

      let r1 = [],
        r2 = [],
        a1 = [],
        a2 = [],
        constraints = [],
        hasSibling = [];

      for (let i = 0; i < stackNodes.length; i++) {
        const stackNode = stackNodes[i];
        if (!validateBoundingBox(stackNode)) {
          setBoundingBox(stackNode);
        }

        const cfg = stackNode.chart.config;
        r1.push(cfg.innerRadius);
        r2.push(cfg.outerRadius);
        a1.push(cfg.startAngle);
        a2.push(cfg.endAngle);
        constraints.push(cfg.constraints);
        hasSibling.push(stackNode.parent.spatial_arrangement !== "circular");
      }

      optimizeCStack(r1, r2, a1, a2, constraints, hasSibling, marginAngle);

      for (let i = 0; i < stackNodes.length; i++) {
        setBoundingBoxForTree(stackNodes[i], r1[i], r2[i], a1[i], a2[i]);
        if (stackNodes[i].parent.spatial_arrangement !== "circular") {
          setBoundingBoxForSibling(stackNodes[i], margin);
        }
      }
      break;
    }
    default: {
      throw new Error(
        `Unsupported spatial arrangement: ${node.spatial_arrangement}`,
      );
    }
  }

  handleAxis(node, stackNodes);

  // if all children are unioned, and the union direction is the same as the stack direction
  // then we need to seperate each children with a brace "{" symbol
  const dir = node.spatial_arrangement;
  if (!node.parent && ["vertical", "horizontal"].includes(dir)) {
    let allUnion = true;
    for (const child of node.children) {
      if (
        child.composite_pattern !== "repetition" ||
        child.spatial_arrangement !== dir
      ) {
        allUnion = false;
        break;
      }
    }

    if (allUnion) {
      node.children.forEach((child) => {
        child.chart.config.brace = dir;
      });
    }
  }
}

function handleCoaxis(node, polar) {
  if (node.children.length !== 2) {
    throw new Error("Co-axis method requires two children");
  }

  if (
    !validateBasicChart(node.children[0]) ||
    !validateBasicChart(node.children[1])
  ) {
    throw new Error("Co-axis method requires two basic charts");
  }

  const chart0 = node.children[0].chart;
  const chart1 = node.children[1].chart;

  switch (node.spatial_arrangement) {
    case "horizontal": {
      chart0.config.width = 400;
      chart0.config.height = 800;
      break;
    }
    case "vertical": {
      chart0.config.width = 800;
      chart0.config.height = 400;
      break;
    }
    case "circular":
    case "radial": {
      // chart0.config.innerRadius = 100;
      // chart0.config.outerRadius = 400;
      throw new Error("Radial / circular co-axis not implemented yet.");
    }
    default: {
      throw new Error(
        `Unsupported spatial arrangement: ${node.spatial_arrangement}`,
      );
    }
  }

  copyConfig(chart0.config, chart1.config);

  const chartType0 = extractChartType(chart0.chartType)[2];
  const chartType1 = extractChartType(chart1.chartType)[2];

  const x0l = chart0.X.data[0].length;
  const x1l = chart1.X.data[0].length;
  let nonchart = chart0;
  if (x0l <= x1l) {
    nonchart = chart1;
  }

  // TODO: in the co-axis case, do they always need to show the misaligned axis?
  // For example, does vertical co-axis always need to show two y-axes?
  switch (node.spatial_arrangement) {
    case "horizontal": {
      if (polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }
      chart0.config.xAxis.display = "bottom";
      chart0.config.xAxis.icon = chartType0;
      chart1.config.xAxis.display = "top";
      chart1.config.xAxis.icon = chartType1;
      nonchart.config.yAxis.display = "none"; // hide y axis for non-chart
      break;
    }
    case "vertical": {
      if (polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }
      chart0.config.yAxis.display = "left";
      chart0.config.yAxis.icon = chartType0;
      chart1.config.yAxis.display = "right";
      chart1.config.yAxis.icon = chartType1;
      nonchart.config.xAxis.display = "none"; // hide x axis for non-chart
      break;
    }
    case "circular": {
      if (!polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }
      chart0.config.xAxis.display = "bottom";
      chart0.config.xAxis.icon = chartType0;
      chart1.config.xAxis.display = "top";
      chart1.config.xAxis.icon = chartType1;
      break;
    }
    case "radial": {
      if (!polar) {
        throw new Error(
          "Mismatch between coordinate system and spatial arrangement",
        );
      }
      chart0.config.yAxis.display = "left";
      chart0.config.yAxis.icon = chartType0;
      chart1.config.yAxis.display = "right";
      chart1.config.yAxis.icon = chartType1;
      break;
    }
    default: {
      throw new Error(
        `Unsupported spatial arrangement: ${node.spatial_arrangement}`,
      );
    }
  }

  setChildrenOption(node, "showBaseline", false);
  setChildrenOption(node, "showValues", false);

  if (chart0.chartType.endsWith("line") && chart1.chartType.endsWith("bar")) {
    // If it's a line + bar combination
    // Readability: ensure the line is above the bar
    node.children = [node.children[1], node.children[0]];
    if (!polar) {
      // In Cartesian coordinates, bar chart uses innerPadding = 0.2, outerPadding = 0
      chart0.config.padding = (1 - 0.2) / 2; // Keep line and bar ticks aligned
    }
  }

  if (chart0.chartType.endsWith("bar") && chart1.chartType.endsWith("line")) {
    if (!polar) {
      chart1.config.padding = (1 - globalSettings.padding) / 2; // Keep bar and line ticks aligned
    }
  }

  if (chart0.chartType.endsWith("line") && chart1.chartType.endsWith("line")) {
    // If it's a combination of two line charts
    // Use different line styles to distinguish
    chart0.config.lineStyle = "solid";
    chart1.config.lineStyle = "dotted";
  }

  if (
    chart0.chartType.endsWith("line") &&
    chart1.chartType.endsWith("scatter")
  ) {
    // If it's a line + scatter combination
    // Readability: ensure the line is above the scatter
    node.children = [node.children[1], node.children[0]];
  }

  if (
    chart0.chartType.endsWith("scatter") &&
    chart1.chartType.endsWith("scatter")
  ) {
    // If it's two scatter plots
    // Use different shapes to distinguish
    chart0.config.shape = "circle";
    chart1.config.shape = "diamond";
  }

  if (
    (chart0.chartType.endsWith("bar") &&
      chart1.chartType.endsWith("scatter")) ||
    (chart0.chartType.endsWith("scatter") && chart1.chartType.endsWith("bar"))
  ) {
    // If it's a bar + scatter combination
    throw new Error("Bar and scatter cannot be co-axised");
  }

  // set constraints for parent (Co-axis node)
  node.chart.config.constraints = chart0.config.constraints;
}

function generateLayout(root) {
  const polar = root.coordinate_system === "polar";
  traverseNonLeafNodes(root, (node) => {
    const [isValid, errorMsg] = validateCompositeChart(node);
    if (!isValid) {
      throw new Error(`Invalid composite chart ${node.id} (${errorMsg})`);
    }
    switch (node.composite_pattern) {
      case "repetition": {
        handleRepetition(node, polar);
        break;
      }
      case "stack": {
        handleStack(node, polar);
        break;
      }
      case "coaxis": {
        handleCoaxis(node, polar);
        break;
      }
      default: {
        throw new Error(`Unsupported pattern: ${node.composite_pattern}`);
      }
    }

    setBoundingBox(node);
  });
}

function processAxisMargin(root) {
  if (
    root.coordinate_system !== "cartesian" &&
    root.coordinate_system !== "polar"
  )
    return;

  const isPolar = root.coordinate_system === "polar";

  // get all the nodes under root (including root)
  let visNodes = {};
  traverseAllNodes(root, (node) => {
    visNodes[node.id] = node;
  });

  // first get all sizes of axis
  for (const key in visNodes) {
    const node = visNodes[key];
    if (node.chart.config.xAxis && node.chart.config.xAxis.display !== "none") {
      node.chart.config.xAxis.size = node.chart.config.xAxis2
        ? approxAxisMargin(node, "x", true)
        : approxAxisMargin(node, "x", false);
    }
    if (node.chart.config.yAxis && node.chart.config.yAxis.display !== "none") {
      node.chart.config.yAxis.size = node.chart.config.yAxis2
        ? approxAxisMargin(node, "y", true)
        : approxAxisMargin(node, "y", false);
    }
    if (
      node.chart.config.xAxis2 &&
      node.chart.config.xAxis2.display !== "none"
    ) {
      node.chart.config.xAxis2.size = approxAxisMargin(node, "x", true, true);
    }
    if (
      node.chart.config.yAxis2 &&
      node.chart.config.yAxis2.display !== "none"
    ) {
      node.chart.config.yAxis2.size = approxAxisMargin(node, "y", true, true);
    }
    if (
      node.chart.config.unionAxis &&
      node.chart.config.unionAxis.display !== "none"
    ) {
      node.chart.config.unionAxis.size = approxAxisMargin(node, "union");
    }
  }

  // then adjust the layout
  // handle axis inside union nodes
  for (const key in visNodes) {
    const node = visNodes[key];
    const defaultAxisNameMargin = 15;
    // TODO: for pie charts, currently we don't want to add axis
    if (node.chart_type && node.chart_type.endsWith("pie")) {
      continue;
    }

    if (
      node.parent &&
      extractOperation(node.parent.operation)[0] === "ALL_UNION"
    ) {
      const cfg = node.chart.config;
      const pcfg = node.parent.chart.config;
      const first = node.parent.children[0];
      const last = node.parent.children[node.parent.children.length - 1];
      const dir = node.parent.spatial_arrangement;

      if (cfg.xAxis && cfg.xAxis.display !== "none") {
        const display = cfg.xAxis.display;
        if (isPolar) {
          if (display === "top" && dir === "radial") {
            // Leave space for drawing the axis
            if (node !== first) {
              pcfg.outerRadius += cfg.xAxis.size;
            }
            if (node !== last) {
              cfg.xAxis.display = "top_noname";
            }
          }
          if (
            display === "top" &&
            (dir === "radial" ||
              (node === first && pcfg.unionAxis.display === "top"))
          ) {
            // Move neighboring nodes
            moveNodes(
              node.parent.neighbors[display],
              display,
              pcfg.unionAxis.size + defaultAxisNameMargin,
              true,
            );
          }
          if (display === "top" && dir === "circular") {
            if (node === first) {
              moveNodes(
                node.parent.neighbors[display],
                display,
                cfg.xAxis.size,
                true,
              );
            }
            if (node !== first) {
              cfg.xAxis.display = "top_noname";
            }
          }
          if (display === "bottom" && dir === "radial") {
            if (node !== last) {
              pcfg.innerRadius -= cfg.xAxis.size;
            }
            if (node !== first) {
              cfg.xAxis.display = "bottom_noname";
            }
          }
          if (
            display === "bottom" &&
            (dir === "radial" ||
              (node === last && pcfg.unionAxis.display === "bottom"))
          ) {
            moveNodes(
              node.parent.neighbors[display],
              display,
              pcfg.unionAxis.size + defaultAxisNameMargin,
              true,
            );
          }
          if (display === "bottom" && dir === "circular") {
            if (node === last) {
              moveNodes(
                node.parent.neighbors[display],
                display,
                cfg.xAxis.size,
                true,
              );
            }
            if (node !== first) {
              cfg.xAxis.display = "bottom_noname";
            }
          }
        } else {
          // Handling for Cartesian coordinate systems
          if (display === "top" && dir === "vertical" && node !== first) {
            pcfg.top -= cfg.xAxis.size;
            pcfg.height += cfg.xAxis.size;
          }
          if (
            display === "top" &&
            (dir === "vertical" ||
              (node === first && pcfg.unionAxis.display === "top"))
          ) {
            moveNodes(
              node.parent.neighbors[display],
              display,
              pcfg.unionAxis.size + defaultAxisNameMargin,
            );
          }
          if (display === "top" && dir === "horizontal") {
            if (node === first) {
              moveNodes(
                node.parent.neighbors[display],
                display,
                cfg.xAxis.size,
              );
            }
            if (node !== first) {
              cfg.xAxis.display = "top_noname";
            }
          }
          if (display === "bottom" && dir === "vertical" && node !== last) {
            pcfg.height += cfg.xAxis.size;
          }
          if (
            display === "bottom" &&
            (dir === "vertical" ||
              (node === last && pcfg.unionAxis.display === "bottom"))
          ) {
            moveNodes(
              node.parent.neighbors[display],
              display,
              pcfg.unionAxis.size + defaultAxisNameMargin,
            );
          }
          if (display === "bottom" && dir === "horizontal") {
            if (node === last) {
              moveNodes(
                node.parent.neighbors[display],
                display,
                cfg.xAxis.size,
              );
            }
            if (node !== first) {
              cfg.xAxis.display = "bottom_noname";
            }
          }
        }
      }

      if (cfg.yAxis && cfg.yAxis.display !== "none") {
        const display = cfg.yAxis.display;
        if (isPolar) {
          if (display === "left" && dir === "radial" && node !== last) {
            cfg.yAxis.display = "left_noname";
          }
          if (display === "right" && dir === "radial" && node !== last) {
            cfg.yAxis.display = "right_noname";
          }
        } else {
          if (display === "left" && dir === "horizontal" && node !== first) {
            pcfg.left -= cfg.yAxis.size;
            pcfg.width += cfg.yAxis.size;
          }
          if (
            display === "left" &&
            (dir === "horizontal" ||
              (node === first && pcfg.unionAxis.display === "left"))
          ) {
            moveNodes(
              node.parent.neighbors[display],
              display,
              pcfg.unionAxis.size + defaultAxisNameMargin,
            );
          }
          if (display === "left" && dir === "vertical") {
            if (node === first) {
              moveNodes(
                node.parent.neighbors[display],
                display,
                cfg.yAxis.size,
              );
            }
            if (node !== first) {
              cfg.yAxis.display = "left_noname";
            }
          }
          if (display === "right" && dir === "horizontal" && node !== last) {
            pcfg.width += cfg.yAxis.size;
          }
          if (
            display === "right" &&
            (dir === "horizontal" ||
              (node === last && pcfg.unionAxis.display === "right"))
          ) {
            moveNodes(
              node.parent.neighbors[display],
              display,
              pcfg.unionAxis.size + defaultAxisNameMargin,
            );
          }
          if (display === "right" && dir === "vertical") {
            if (node === last) {
              moveNodes(
                node.parent.neighbors[display],
                display,
                cfg.yAxis.size,
              );
            }
            if (node !== first) {
              cfg.yAxis.display = "right_noname";
            }
          }
        }
      }
    }
  }

  // handle normal axis
  for (const key in visNodes) {
    const node = visNodes[key];
    const cfg = node.chart.config;

    // move x/y axis
    for (const axis of ["xAxis", "yAxis", "xAxis2", "yAxis2"]) {
      if (cfg[axis] && cfg[axis].display !== "none") {
        const moveFunc = axis.startsWith("x")
          ? moveNormalxAxis
          : moveNormalyAxis;
        moveFunc(node, cfg[axis].display, cfg[axis].size, isPolar);
      }
    }

    // move union axis
    if (cfg.unionAxis && cfg.unionAxis.display !== "none") {
      const display = cfg.unionAxis.display;
      // In polar coordinates, only handle top and bottom
      if (
        !isPolar ||
        (isPolar && (display === "top" || display === "bottom"))
      ) {
        moveNodes(
          node.neighbors[display],
          display,
          cfg.unionAxis.size,
          isPolar,
        );
      }
    }
  }

  boundingBoxCheck(root, isPolar);
}

function adjustRadius(root) {
  // adjust radius for polar charts
  if (root.coordinate_system !== "polar") return;
  let dmin = -Number.MAX_VALUE;
  traverseLeafNodes(root, (node) => {
    const config = node.chart.config;
    let d = 0;
    if (config.xAxis && config.xAxis.display.includes("bottom")) {
      d += config.xAxis.size;
    }
    if (config.unionAxis && config.unionAxis.display.includes("bottom")) {
      d += config.unionAxis.size;
    }
    // if (config.innerRadius - d < 200) {
    dmin = Math.max(dmin, 100 + d);
    // }
  });
  if (dmin < 200) {
    dmin = 200;
  }
  const rootConfig = root.chart.config;
  const deltaRadius = rootConfig.outerRadius - rootConfig.innerRadius;
  setBoundingBoxForTree(
    root,
    dmin,
    dmin + deltaRadius,
    rootConfig.startAngle,
    rootConfig.endAngle,
  );
}

function adjustChartConfigForPolar(node) {
  // make sure config is valid for polar charts
  if (node.coordinate_system === "polar") {
    traverseAllNodes(node, (child) => {
      updatePolarConfig(child.chart.config);
    });
  }
}

function setColorsForBasicCharts(node) {
  if (!node) return;

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
      // If the union axis does not have a color mapping
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

function getBaseColorProportion(node) {
  let baseColorArea = 0;
  let totalArea = 0;
  const baseColor = globalSettings.palette.baseColor;
  traverseLeafNodes(node, (child) => {
    const area = getArea(
      child.chart.config,
      node.coordinate_system === "polar",
    );
    totalArea += area;
    const color = child.chart.config.color;
    if (
      (typeof color === "string" && color === baseColor) ||
      (typeof color === "function" && color("") === baseColor)
    ) {
      baseColorArea += area;
    }
  });
  node.chart.config.baseColorProportion = baseColorArea / totalArea;
}

// Adjust chart style
function updateChartStyle() {
  let updateFlag = false;
  const nodes = globalSettings.visNodes;

  for (const key in nodes) {
    const node = nodes[key];
    if (node.composite_pattern && node.composite_pattern === "coaxis") {
      return; // Do not adjust styles for co-axis
    }
  }

  for (const key in nodes) {
    const node = nodes[key];
    if (node.vis_type === "basic") {
      const chartType = extractChartType(node.chart_type);
      // If a single bar chart is too wide, replace it with proportional area chart
      if (chartType[2] === "bar" && chartType[1] === "") {
        const n = node.X.data[0].length;
        const maxBarWidth = 75;
        let barWidth = 0;

        if (chartType[0] === "v") {
          barWidth = node.chart.config.width / n;
        } else if (chartType[0] === "h") {
          barWidth = node.chart.config.height / n;
        } else {
          // TODO: polar case
        }

        if (barWidth > maxBarWidth) {
          updateFlag = true;
          globalSettings.modifyChartType(node.id, "parea");
        }
      }
    }
  }

  // TODO: other style adjustments

  globalSettings.updateFlag = updateFlag;
}
