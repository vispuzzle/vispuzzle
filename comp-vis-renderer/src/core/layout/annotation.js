import * as d3 from "d3";
import { globalSettings } from "../global.js";
import {
  extractChartType,
  extractCondition,
  extractOperation,
  setChildrenOption,
} from "../../utils/node.js";
import { approxAxisMargin } from "../../utils/adjust.js";
import { getValueField, columnAggregate } from "../../utils/maths.js";
import {
  setBoundingBox,
  setPolarBoundingBox,
  calculateRectangleToPointDistance,
  calculateRectangleDistance,
  updatePolarConfig,
} from "../../utils/geometry.js";
import { getLabelPos, resolveMapProjection } from "../../utils/vis.js";
import { recommendAspectRatio } from "../aspect.js";

const labelHeight = 50;
const charWidth = 25;
const interoperableValueGroups = [["UK", "England"]];

// let COLOR_MODE = "CLIENT_FIRST"; // set color based on client node's X field values
let COLOR_MODE = "HOST_FIRST"; // set color based on host node's X field values

function createAnnotationLineOptions() {
  return {
    gridMargin: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    },
    gridEdgeWidthMultiplier: 2.5,
  };
}

function getInteroperableValues(value) {
  const candidates = [value];
  for (const group of interoperableValueGroups) {
    if (group.includes(value)) {
      candidates.push(...group);
      break;
    }
  }
  return [...new Set(candidates)];
}

function resolveLabelPosition(labelPosition, value) {
  const candidates = getInteroperableValues(value);
  for (const candidate of candidates) {
    if (labelPosition[candidate]) {
      return {
        position: labelPosition[candidate],
        matchedValue: candidate,
      };
    }
  }
  return {
    position: null,
    matchedValue: value,
  };
}

export async function handleAnnotationMode(root) {
  COLOR_MODE = "HOST_FIRST";
  chartTypeDerivation(root);
  initBasicCharts(root);
  generateLayout(root);
}

export async function postprocessAnnotationMode(root) {
  processAxisMargin(root);
  setColorsForBasicCharts(root);
  addTextAndLinkNode(root);
  for (const child of root.children[1].children) {
    if (child.chart_type.endsWith("pie")) {
      const config = child.chart.config;
      setPolarBoundingBox(config);
      child.coordinate_system = "polar";
    }
  }
  setBoundingBox(root);
  computeProximityForAnnotation(root);
}

function computeProximityForAnnotation(root) {
  const hostNode = root.children?.[0];
  const clientNode = root.children?.[1];
  const hostConfig = hostNode?.chart?.config;
  if (!hostConfig || !clientNode?.children) return;

  const hostWidth = Math.abs(hostConfig.width || 0);
  const hostHeight = Math.abs(hostConfig.height || 0);
  const shortEdge = Math.min(hostWidth, hostHeight);
  const distanceThreshold = 0.5 * shortEdge;

  const distances = [];
  let maxDistance = -Number.MAX_VALUE;

  for (const child of clientNode.children) {
    const config = child?.chart?.config;
    if (
      !config ||
      typeof config.targetX !== "number" ||
      typeof config.targetY !== "number"
    ) {
      continue;
    }

    const distance = calculateRectangleToPointDistance(config, {
      x: config.targetX,
      y: config.targetY,
    });
    maxDistance = Math.max(maxDistance, distance);
    distances.push({
      id: child.id,
      distance,
      withinThreshold: distance <= distanceThreshold,
    });
  }

  if (maxDistance === -Number.MAX_VALUE) {
    maxDistance = null;
  }

  const proximity = {
    hostWidth,
    hostHeight,
    shortEdge,
    distanceThreshold,
    maxDistance,
    withinThreshold:
      maxDistance === null ? true : maxDistance <= distanceThreshold,
    distances,
  };

  root.chart.config.proximity = proximity;
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
  const cx = 1000;
  const cy = 1000;
  const hostNode = root.children[0];
  const clientNode = root.children[1];
  const worldMap =
    hostNode.X.name.toLowerCase() === "country" ||
    hostNode.X.name.toLowerCase() === "region";
  const [width, height] = hostNode.chart_type.endsWith("map")
    ? worldMap
      ? [1200, 600]
      : [1200, 800]
    : [200, 200];

  // initialize host node
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
      cx: cx,
      cy: cy,
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
      options: hostNode.chart_type.endsWith("line")
        ? createAnnotationLineOptions()
        : {},
    },
    chartType: hostNode.chart_type,
  };
  if (hostNode.chart_type === "map") {
    chart.config.mapType = resolveMapProjection(hostNode, worldMap);
  }
  hostNode.chart = chart;

  if (hostNode.chart_type.endsWith("pie")) {
    updatePolarConfig(hostNode.chart.config);
  }

  // register color & order mapping for host node
  if (
    hostNode.chart_type.endsWith("pie") ||
    hostNode.chart_type.endsWith("bar") ||
    hostNode.chart_type.endsWith("parea")
  ) {
    const [name, values] = [hostNode.X.name, hostNode.X.data[0]];
    if (!globalSettings.orderMaps[name]) {
      globalSettings.registerOrderMap(
        name,
        values,
        columnAggregate(hostNode.Y.data),
      );
    }
    globalSettings.registerColorMap(name, values, true);
    hostNode.chart.config.order = globalSettings.orderMaps[name];
  }

  // register color if color mode is HOST_FIRST and host itself doesn't have color encoding
  // CAUTION: for pie chart, only allow CLIENT_FIRST mode,
  // since pie chart must have its own color encoding to distinguish different slices.
  if (clientNode.children[0].chart_type?.endsWith("pie")) {
    COLOR_MODE = "CLIENT_FIRST";
  }
  if (COLOR_MODE === "HOST_FIRST") {
    const name = extractOperation(clientNode.operation)[1];
    const values = clientNode.children.map(
      (child) => extractCondition(child.conditions)[name],
    );
    globalSettings.registerColorMap(name, values, true);
  }

  // register color mapping if child chart type is line/scatter
  if (
    clientNode.children[0].chart_type.endsWith("line") ||
    clientNode.children[0].chart_type.endsWith("scatter")
  ) {
    const name = extractOperation(clientNode.operation)[1];
    const values = clientNode.children.map(
      (child) => extractCondition(child.conditions)[name],
    );
    globalSettings.registerColorMap(name, values, false);
  }

  // initialize client nodes
  if (clientNode.vis_type === "composite") {
    const [type, columnName] = extractOperation(clientNode.operation);
    const unionData = {
      data: clientNode.children.map(
        (child) => extractCondition(child.conditions)[columnName],
      ),
      name: columnName,
    };
    clientNode.chart.unionData = unionData;

    // Use a shared y-scale for repeated line charts to make cross-panel comparison fair.
    let sharedLineYMin = null;
    let sharedLineYMax = null;
    if (clientNode.children[0]?.chart_type.endsWith("line")) {
      const lineYValues = clientNode.children
        .flatMap((child) => child.Y?.data?.flat?.() || [])
        .filter((v) => typeof v === "number" && !Number.isNaN(v));
      if (lineYValues.length > 0) {
        sharedLineYMin = Math.min(0, Math.min(...lineYValues));
        sharedLineYMax = Math.max(...lineYValues);
      }
    }

    for (const child of clientNode.children) {
      let width = 200;
      let height = 200;
      let order = null;

      // In annotation mode, line charts need a larger canvas to keep trends legible.
      if (child.chart_type.endsWith("line")) {
        width = 200;
        height = 200;
      }

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
        child.chart_type.endsWith("pie") ||
        child.chart_type.endsWith("bar") ||
        child.chart_type.endsWith("parea")
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
            display: "top",
            value: extractCondition(child.conditions)[columnName],
          },
          yMin: sharedLineYMin ?? Math.min(0, Math.min(...child.Y.data.flat())),
          yMax: sharedLineYMax ?? Math.max(...child.Y.data.flat()),
          valueField: getValueField(child),
          options: child.chart_type.endsWith("line")
            ? createAnnotationLineOptions()
            : {},
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
  const hostNode = root.children[0];
  const clientNode = root.children[1];
  if (clientNode.vis_type !== "composite") return;

  if (
    hostNode.chart_type.endsWith("pie") ||
    hostNode.chart_type.endsWith("bar") ||
    hostNode.chart_type.endsWith("parea")
  ) {
    // If the host node is a pie chart, it already provides color encoding.
    // In this case, set the color mapping for the client's sub-charts based on the union condition.
    const [colorMap, type] = globalSettings.palette.getColorMap(
      hostNode.X.name,
    );
    hostNode.chart.config.color = colorMap;
    if (type !== "base") {
      for (const child of clientNode.children) {
        const value = extractCondition(child.conditions)[hostNode.X.name];
        child.chart.config.color = colorMap(value);
      }
    }
  } else if (hostNode.chart_type.endsWith("map")) {
    // The map itself does not provide color encoding; check whether the client sub-charts have color registration.
    for (const child of clientNode.children) {
      const chartType = extractChartType(child.chart_type);
      if (
        chartType[2] === "line" ||
        chartType[2] === "scatter" ||
        COLOR_MODE === "HOST_FIRST"
      ) {
        const name = extractOperation(clientNode.operation)[1];
        const value = extractCondition(child.conditions)[name];
        const [colorMap, _] = globalSettings.palette.getColorMap(name);
        child.chart.config.color = colorMap(value);
      } else if (
        chartType[2] === "bar" ||
        chartType[2] === "pie" ||
        chartType[2] === "parea"
      ) {
        // bar/pie/parea: may require a color mapping
        const [colorMap, _] = globalSettings.palette.getColorMap(child.X.name);
        child.chart.config.color = colorMap;
      }
    }
  }
}

function generateLayout(root) {
  const hostNode = root.children[0];
  const clientNode = root.children[1];
  const [_, field] = extractOperation(root.operation);
  globalSettings.registerLink(field, hostNode.id, clientNode.id);

  // Set chart style
  // host
  let type = hostNode.chart_type;
  if (type.endsWith("bar")) {
    hostNode.chart.config.options.showBaseline = false;
  }

  // client
  type = clientNode.children[0].chart_type;
  if (type.endsWith("bar")) {
    setChildrenOption(clientNode, "showBaseline", false);
    setChildrenOption(clientNode, "border", "horizontal");

    // Set individual heights for each bar chart
    const yMax = Math.max(
      ...clientNode.children.map((child) => child.chart.config.yMax),
    );
    const yMin = Math.min(
      ...clientNode.children.map((child) => child.chart.config.yMin),
    );
    if (yMin === 0) {
      clientNode.children.forEach((child) => {
        const scale = child.chart.config.yMax / yMax;
        child.chart.config.height =
          (child.chart.config.height - labelHeight) * scale + labelHeight;
      });
    }
  } else if (type.endsWith("line")) {
    // Add a subtle area shadow under line charts for better visual contrast.
    setChildrenOption(clientNode, "showShadow", true);
  }

  // Set labelPosition and the map's color mapping
  let minEncodingValue = Number.MAX_VALUE;
  let maxEncodingValue = -Number.MAX_VALUE;
  const labelPosition = getLabelPos(hostNode);

  for (const child of clientNode.children) {
    const conditionValue = extractCondition(child.conditions)[hostNode.X.name];
    const { position: matchedLabelPosition } = resolveLabelPosition(
      labelPosition,
      conditionValue,
    );
    const candidateValues = getInteroperableValues(conditionValue);
    const { cx = NaN, cy = NaN } = matchedLabelPosition ?? {};

    if (!isNaN(cx) && !isNaN(cy)) {
      // Set initial position first (will be adjusted by force-directed layout later)
      child.chart.config.left = cx + 200;
      child.chart.config.top = cy + 200;

      // Set target position
      const cfg = hostNode.chart.config;
      const [dx, dy] = hostNode.chart_type.endsWith("pie")
        ? [cfg.cx, cfg.cy]
        : [cfg.left, cfg.top];
      child.chart.config.targetX = cx + dx;
      child.chart.config.targetY = cy + dy;
    } else {
      throw new Error(`Cannot calculate position for ${conditionValue}`);
    }

    // Add a numeric value to the data feature property corresponding to hostNode, for color mapping.
    // The value is the sum of child.Y.data[0].
    if (hostNode.chart_type === "map") {
      hostNode.X.data.features.forEach((feature) => {
        if (candidateValues.includes(feature.properties[hostNode.X.name])) {
          const sumValue = getValueField(child);
          feature.properties["valueField"] = sumValue;
          minEncodingValue = Math.min(minEncodingValue, sumValue);
          maxEncodingValue = Math.max(maxEncodingValue, sumValue);
        }
      });
    }

    // Also include the host in avoidRects
    if (hostNode.chart_type !== "map") {
      const cfg = hostNode.chart.config;
      globalSettings.linkInfo.avoidRects.push([
        cfg.left,
        cfg.top,
        cfg.left + cfg.width,
        cfg.top + cfg.height,
      ]);
    }
  }

  let obstacles = [];
  if (hostNode.chart_type !== "map") obstacles.push(hostNode);
  else {
    const childrenLabelPostions = clientNode.chart.unionData.data.map(
      (val) => resolveLabelPosition(labelPosition, val).position,
    );
    for (const pos of childrenLabelPostions.filter(Boolean)) {
      obstacles.push({
        chart: {
          config: {
            left: pos.cx - 20,
            top: pos.cy - 20,
            width: 40,
            height: 40,
          },
        },
      });
    }
  }
  // Use force-directed layout to adjust chart positions
  applyForceDirectedLayout(clientNode, obstacles);

  if (hostNode.chart_type === "map" && minEncodingValue < maxEncodingValue) {
    hostNode.chart.config.colorName = "SUM OF " + clientNode.children[0].Y.name;
    hostNode.chart.config.valueField = "valueField"; // Add the field name used for color mapping on the map
    hostNode.chart.config.color = d3
      .scaleLinear()
      .domain([minEncodingValue, maxEncodingValue])
      .range([globalSettings.mapColor.low, globalSettings.mapColor.high]);
  }
}

function addTextAndLinkNode(root) {
  const [node0, node1] = root.children;

  // register link info
  const [_, field] = extractOperation(root.operation);
  const linkNode = globalSettings.linkInfo.nodes.find((n) => n.id === node1.id);
  linkNode.transform = { dx: 0, dy: 0 };
  linkNode.labelPosition = {};

  for (const child of node1.children) {
    const config = child.chart.config;
    if (config.label) {
      if (config.label.display === "top") {
        // Add a text node
        node1.children.push({
          vis_type: "basic",
          chart_type: "text",
          parent: node1,
          coordinate_system: "cartesian",
          children: [],
          chart: {
            chartType: "text",
            config: {
              top: config.top,
              left: config.left,
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

        // Add a visual link node
        if (config.targetX && config.targetY) {
          // Compute the center coordinates of the text node
          const textCenterX = config.left + config.width / 2;
          const textCenterY = config.top + labelHeight / 2;

          // Compute the angle from the start point to the text center
          const dx = config.targetX - textCenterX;
          const dy = config.targetY - textCenterY;
          const angle = Math.atan2(dy, dx);

          // Normalize the angle into the range [0, 2 * Math.PI)
          const normalizedAngle = (angle + 2 * Math.PI) % (2 * Math.PI);

          // Determine the connection point based on the angle
          let endX, endY;

          if (
            normalizedAngle >= (7 * Math.PI) / 6 &&
            normalizedAngle <= (11 * Math.PI) / 6
          ) {
            // Top of text
            endX = textCenterX;
            endY = config.top;
          } else if (
            normalizedAngle >= Math.PI / 2 &&
            normalizedAngle <= (7 * Math.PI) / 6
          ) {
            // Left of text
            endX = textCenterX - config.label.value.length * charWidth * 0.5;
            endY = textCenterY;
          } else {
            // Right of text
            endX = textCenterX + config.label.value.length * charWidth * 0.5;
            endY = textCenterY;
          }

          const label = extractCondition(child.conditions)[field];
          linkNode.labelPosition[label] = {
            x: endX,
            y: endY,
          };
          globalSettings.linkInfo.avoidRects.push([
            config.left,
            config.top + labelHeight,
            config.left + config.width,
            config.top + config.height,
          ]); // Record obstacle-avoidance rectangle
          globalSettings.linkInfo.avoidRects.push([
            textCenterX - config.label.value.length * charWidth * 0.5 + 1,
            textCenterY - labelHeight / 2 + 1,
            textCenterX + config.label.value.length * charWidth * 0.5 - 1,
            textCenterY + labelHeight / 2 - 1,
          ]); // Record the text node's obstacle-avoidance rectangle
        }

        // Adjust the bounding box of the original chart
        config.top += labelHeight;
        config.height -= labelHeight;
      }
    }
  }
}

/**
 * Adjust chart positions with a force-directed layout to avoid overlaps.
 * @param {Object} clientNode - Client node containing all child charts
 */
function applyForceDirectedLayout(clientNode, obstacles) {
  const charts = clientNode.children.filter(
    (child) => child.chart && child.chart.config.targetX,
  );
  if (charts.length === 0) return;

  // allCharts: charts that need repositioning plus obstacles
  // Obstacles participate in repulsion calculation
  const allCharts = [...charts, ...obstacles];

  // Force-directed layout parameters
  const iterations = 200; // Increase iteration count
  const attractionStrength = 0.05; // Reduce attraction strength
  const repulsionStrength = 2000; // Tune repulsion strength
  const overlapRepulsionStrength = 50000; // Strong repulsion when overlapping
  const damping = 0.8; // Increase damping factor
  const minSeparation = 100; // Minimum separation between charts (hard constraint)
  const convergenceThreshold = 0.5; // Convergence threshold

  // Initialize velocity for each chart
  charts.forEach((chart) => {
    chart.chart.config.vx = 0;
    chart.chart.config.vy = 0;
  });

  // Iterate force-directed layout
  for (let iter = 0; iter < iterations; iter++) {
    // Compute forces for each chart
    charts.forEach((chart) => {
      const config = chart.chart.config;
      let fx = 0; // force in x direction
      let fy = 0; // force in y direction

      // 1. Attraction towards target position
      const currentX = config.left + config.width / 2;
      const currentY = config.top + config.height / 2;
      const targetX = config.targetX;
      const targetY = config.targetY;

      const dx_target = targetX - currentX;
      const dy_target = targetY - currentY;
      const distance_target = Math.sqrt(
        dx_target * dx_target + dy_target * dy_target,
      );

      // Only apply attraction when the distance to the target exceeds 300 pixels
      const minTargetDistance = 300;
      if (distance_target > minTargetDistance) {
        // Attraction: F = k * (d - minDistance) (proportional to the amount exceeding the minimum distance)
        const excessDistance = distance_target - minTargetDistance;
        fx +=
          attractionStrength * (dx_target / distance_target) * excessDistance;
        fy +=
          attractionStrength * (dy_target / distance_target) * excessDistance;
      }

      // 2. Repulsion from other charts (based on rectangular bounds)
      allCharts.forEach((otherChart) => {
        if (chart === otherChart) return;

        const otherConfig = otherChart.chart.config;

        // Compute the relationship between the two rectangles
        const rectInfo = calculateRectangleDistance(config, otherConfig);

        if (rectInfo.isOverlapping || rectInfo.distance < minSeparation) {
          // If overlapping or too close, apply strong repulsion
          let forceStrength;

          if (rectInfo.isOverlapping) {
            // Stronger repulsion when overlapping, based on overlap area
            const overlapArea = rectInfo.overlapX * rectInfo.overlapY;
            forceStrength = overlapRepulsionStrength * (1 + overlapArea / 1000);
          } else {
            // Very close but not overlapping
            forceStrength = repulsionStrength / Math.max(rectInfo.distance, 1);
          }

          // Repulsion direction (from the other chart's center to this chart's center)
          const dx = rectInfo.dx;
          const dy = rectInfo.dy;
          const centerDistance = rectInfo.centerDistance;

          if (centerDistance > 0) {
            fx -= forceStrength * (dx / centerDistance);
            fy -= forceStrength * (dy / centerDistance);
          } else {
            // If centers coincide, choose a random direction
            const angle = Math.random() * 2 * Math.PI;
            fx += forceStrength * Math.cos(angle);
            fy += forceStrength * Math.sin(angle);
          }
        }
      });

      // Update velocity (apply forces and damping)
      config.vx = (config.vx + fx) * damping;
      config.vy = (config.vy + fy) * damping;

      // Limit maximum velocity to prevent oscillation
      const maxVelocity = 50;
      const currentVelocity = Math.sqrt(
        config.vx * config.vx + config.vy * config.vy,
      );
      if (currentVelocity > maxVelocity) {
        const scale = maxVelocity / currentVelocity;
        config.vx *= scale;
        config.vy *= scale;
      }
    });

    // Update positions
    charts.forEach((chart) => {
      const config = chart.chart.config;

      // Update center position
      const centerX = config.left + config.width / 2 + config.vx;
      const centerY = config.top + config.height / 2 + config.vy;

      // Update left and top while keeping the chart centered
      config.left = centerX - config.width / 2;
      config.top = centerY - config.height / 2;
    });

    // Hard constraint: resolve overlaps and insufficient separation
    resolveCollisions(charts, minSeparation);

    // Early stop: if all chart velocities are small, stop early
    const maxVelocity = Math.max(
      ...charts.map((chart) => {
        const config = chart.chart.config;
        return Math.sqrt(config.vx * config.vx + config.vy * config.vy);
      }),
    );

    if (maxVelocity < convergenceThreshold) {
      break;
    }
  }

  // Clean up temporary properties
  charts.forEach((chart) => {
    delete chart.chart.config.vx;
    delete chart.chart.config.vy;
  });
}

/**
 * Hard constraint: resolve overlaps and insufficient separation between charts.
 * @param {Array} charts - Chart array
 * @param {number} minSeparation - Minimum separation distance
 */
function resolveCollisions(charts, minSeparation) {
  const maxIterations = 10; // Maximum collision-resolution iterations
  const minTargetDistance = 50; // Minimum distance between chart area and target point

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check collisions between all chart pairs
    for (let i = 0; i < charts.length; i++) {
      for (let j = i + 1; j < charts.length; j++) {
        const chart1 = charts[i].chart.config;
        const chart2 = charts[j].chart.config;
        const rectInfo = calculateRectangleDistance(chart1, chart2);

        // If too close, separate
        if (rectInfo.isOverlapping || rectInfo.distance < minSeparation) {
          // Compute required separation distance
          const requiredSeparation = minSeparation;
          const currentSeparation = rectInfo.isOverlapping
            ? 0
            : rectInfo.distance;
          const separationDeficit = requiredSeparation - currentSeparation;

          // Compute the direction vector between centers
          let dx = rectInfo.dx;
          let dy = rectInfo.dy;
          const centerDistance = rectInfo.centerDistance;

          // If centers coincide, choose a random direction
          if (centerDistance < 1) {
            const angle = Math.random() * 2 * Math.PI;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
          } else {
            dx = dx / centerDistance;
            dy = dy / centerDistance;
          }

          // Compute movement per chart (half of total movement)
          const moveDistance = (separationDeficit + 10) / 2; // Add 10px extra to ensure separation

          // Move both charts away from each other
          chart1.left -= dx * moveDistance;
          chart1.top -= dy * moveDistance;
          chart2.left += dx * moveDistance;
          chart2.top += dy * moveDistance;
        }
      }
    }

    // Check distance constraints between each chart and its target
    charts.forEach((chart) => {
      const config = chart.chart.config;
      if (!config.targetX || !config.targetY) return;

      // Compute the shortest distance from the chart rectangle to the target point
      const distanceToTarget = calculateRectangleToPointDistance(config, {
        x: config.targetX,
        y: config.targetY,
      });

      if (distanceToTarget < minTargetDistance) {
        // Compute required movement
        const moveDistance = minTargetDistance - distanceToTarget + 5; // Add 5px extra to satisfy constraint

        // Compute direction vector from the target point to the chart center
        const centerX = config.left + config.width / 2;
        const centerY = config.top + config.height / 2;
        const dx = centerX - config.targetX;
        const dy = centerY - config.targetY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0) {
          // Move the chart away from the target point
          const unitX = dx / distance;
          const unitY = dy / distance;
          config.left += unitX * moveDistance;
          config.top += unitY * moveDistance;
        } else {
          // If the chart center coincides with the target point, choose a random direction
          const angle = Math.random() * 2 * Math.PI;
          config.left += Math.cos(angle) * moveDistance;
          config.top += Math.sin(angle) * moveDistance;
        }
      }
    });
  }
}
