import * as d3 from "d3";
import {
  axisPolar,
  axisCartesian,
  axisRadialInner,
  axisRadialOuter,
} from "./axis.js";
import {
  filterMissingValue,
  checkAllInteger,
  getXyMinMax,
  enhanceTickValues,
} from "../utils/maths.js";
import {
  createVerticalRefLine,
  createHorizontalRefLine,
  createAngularRefLine,
  createRadialRefLine,
} from "./refline.js";
import { createLinePath, createRadialLinePath } from "./elements.js";
import { sampleLineData } from "../utils/vis.js";
import { globalSettings } from "../core/global.js";
// TODO: lineStyle is not currently passed to createLinePath(); needs to be fixed

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

// If the domain is year-like data, fill missing years using the smallest valid step
function handleDomain(domain) {
  // Step 1: preprocess and handle edge cases
  // If domain is missing or its length is <= 1, no completion is needed; return as-is
  if (!domain || domain.length <= 1) {
    return domain;
  }

  // Step 2: determine whether it is year-like data
  // Year rule: each element must be a 4-digit numeric string
  const isYearData = domain.every(
    (item) => typeof item === "string" && /^\d{4}$/.test(item),
  );

  // If validation fails, return the original domain
  if (!isYearData) return domain;

  // Step 3: convert string array to number array and sort ascending
  const numericDomain = domain.map(Number).sort((a, b) => a - b);

  // Step 4: compute differences between adjacent years
  const differences = [];
  for (let i = 1; i < numericDomain.length; i++) {
    const diff = numericDomain[i] - numericDomain[i - 1];
    if (diff > 0) {
      differences.push(diff);
    }
  }

  // If there are no differences (e.g., all years are the same), return the de-duplicated original array
  if (differences.length === 0) {
    return [...new Set(domain)].sort();
  }

  // Step 5: use the greatest common divisor (GCD) of all differences as the step
  let step = differences[0];
  for (let i = 1; i < differences.length; i++) {
    step = gcd(step, differences[i]);
  }

  // If the computed step is 0 or invalid, return the original domain to avoid infinite loops
  if (!step || step <= 0) return domain;

  // Step 6: generate the full sequence using the step
  const completedNumericDomain = [];
  const startYear = numericDomain[0];
  const endYear = numericDomain[numericDomain.length - 1];

  for (let year = startYear; year <= endYear; year += step) {
    completedNumericDomain.push(year);
  }

  // Step 7: convert the number array back to strings and return
  return completedNumericDomain.map(String);
}

/**
 * Creates a (vertical) line chart using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x` and `y` properties.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - The direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - The direction of the y-axis ("default" or "inverse").
 * @param {number} xMin - The minimum x value for x-field.
 * @param {number} xMax - The maximum x value for x-field.
 * @param {number} yMin - The minimum y value for y-field.
 * @param {number} yMax - The maximum y value for y-field.
 * @param {Object} order - The order of the x-field when it is a string.
 * @param {function|string} color - The color of the line. Either a color scale function or a color string.
 * @param {number} [padding=0] - The padding of the line points (to align with the bar chart).
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createVerticalLineChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color,
  padding = 0,
  options = {},
) {
  // parse additional options
  const style = options?.style ?? options?.variation ?? "default";
  const { showGrid = true, lineWidthMax = 3 } = options || {};
  // other options are directly passed into `createLinePath()`.

  // calculate lineWidth
  options.lineWidth = options.lineWidth || Math.sqrt(width * height) / 30;
  options.lineWidth =
    Math.min(Math.max(options.lineWidth, 2), lineWidthMax) / Math.sqrt(2);

  g = g.attr("width", width).attr("height", height).append("g");

  let x = null;
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);
  if (typeof data[0].x === "string") {
    let xDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      xDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    xDomain = handleDomain(xDomain);

    // Auto-fill missing year data (for cancelled events like Olympics)
    const existingX = new Set(data.map((d) => d.x));
    const missingX = xDomain.filter((x) => !existingX.has(x));

    if (options.yName && options.yName.includes("cnt")) {
      if (missingX.length > 0) {
        if (data[0].hasOwnProperty("label")) {
          const labels = Array.from(new Set(data.map((d) => d.label)));
          labels.forEach((label) => {
            missingX.forEach((x) => {
              data.push({
                x: x,
                y: 0,
                label: label,
                cancelled: true,
              });
            });
          });
        } else {
          missingX.forEach((x) => {
            data.push({
              x: x,
              y: 0,
              cancelled: true,
            });
          });
        }
      }
      // Sort data to ensure correct line drawing
      data.sort((a, b) => xDomain.indexOf(a.x) - xDomain.indexOf(b.x));
      if (yMin > 0) yMin = 0;

      // Mark zero points after the first non-zero point as cancelled
      if (data[0].hasOwnProperty("label")) {
        const labels = Array.from(new Set(data.map((d) => d.label)));
        labels.forEach((label) => {
          const labelData = data.filter((d) => d.label === label);
          const firstNonZeroIndex = labelData.findIndex((d) => d.y !== 0);
          if (firstNonZeroIndex !== -1) {
            labelData.forEach((d, i) => {
              if (i > firstNonZeroIndex && d.y === 0) {
                d.cancelled = true;
                globalSettings.cancelledLegendColumns.add(options.yName);
              }
            });
          }
        });
      } else {
        const firstNonZeroIndex = data.findIndex((d) => d.y !== 0);
        if (firstNonZeroIndex !== -1) {
          data.forEach((d, i) => {
            if (i > firstNonZeroIndex && d.y === 0) {
              d.cancelled = true;
              globalSettings.cancelledLegendColumns.add(options.yName);
            }
          });
        }
      }
    }

    x = d3
      .scalePoint()
      .domain(xDomain)
      .range(xAxisDir === "default" ? [0, width] : [width, 0])
      .padding(padding);
  } else {
    x = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range(xAxisDir === "default" ? [0, width] : [width, 0]);
  }

  const y = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(yAxisDir === "default" ? [height, 0] : [0, height]);

  // data = filterMissingValue(data);
  // If data contains multiple series with a label
  if (data[0].hasOwnProperty("label")) {
    // To prevent overlap, disable showMinMax, showPoints, showAvgLine
    options["showMinMax"] = false;
    // options["showPoints"] = false;
    options["showAvgLine"] = false;
    // Group data by label
    const labels = Array.from(new Set(data.map((d) => d.label))); // Get unique labels
    labels.forEach((label, idx) => {
      let labelData = data.filter((d) => d.label === label);
      const l0 = labelData.length;
      labelData = sampleLineData(labelData, width);
      if (labelData.length < l0) {
        options["sampleLineData"] = true;
      }
      // Assign different point shapes for different series
      const shapes = ["circle", "square", "triangle", "diamond"];
      const pointShape = options.pointShape
        ? typeof options.pointShape === "function"
          ? (d, i) => options.pointShape(d, i, label)
          : options.pointShape
        : shapes[idx % shapes.length];
      const lineColor = typeof color === "function" ? color(label) : color;
      createLinePath(g, labelData, x, y, lineColor, 0.8, "vertical", yAxisDir, {
        ...options,
        pointShape,
      });
    });
  } else {
    // Create a single line if no label exists
    const l0 = data.length;
    data = sampleLineData(data, width);
    if (data.length < l0) {
      options["sampleLineData"] = true;
    }
    createLinePath(g, data, x, y, color, 1, "vertical", yAxisDir, options);
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Add x-axis if needed
  let fakeAxis = xAxisPos === "none" ? "horizontal" : "none";
  let ticks = axisCartesian(g, xAxisPos, x, width, height, "x", {
    chartType: "line",
    allInteger: xAllInteger,
    fontStyle: fontStyle,
    fakeAxis: fakeAxis,
    border: options.border,
    axisColor: options.axisColor,
  });
  let verticalValues = ticks.map((val) => x(val));

  // Add y-axis if needed
  fakeAxis = yAxisPos === "none" ? "vertical" : "none";
  ticks = axisCartesian(g, yAxisPos, y, width, height, "y", {
    chartType: "line",
    allInteger: yAllInteger,
    fontStyle: fontStyle,
    fakeAxis: fakeAxis,
    border: options.border,
    axisColor: options.axisColor,
  });
  let horizontalValues = ticks.map((val) => y(val));

  if (showGrid) {
    verticalValues = enhanceTickValues(verticalValues, 0, width);
    horizontalValues = enhanceTickValues(horizontalValues, 0, height);

    const reflineGroup = g.append("g").attr("class", "refline-group");
    const gridMargin = options.gridMargin || {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    };
    const gridOptions = {
      edgeWidthMultiplier: options.gridEdgeWidthMultiplier || 1,
    };
    createVerticalRefLine(
      reflineGroup,
      verticalValues,
      (d, i) => (i === 0 ? 0 : -gridMargin.top),
      (d, i) => (i === 0 ? height : height + gridMargin.bottom),
      gridOptions,
    );
    createHorizontalRefLine(
      reflineGroup,
      horizontalValues,
      (d, i) => (i === 0 ? 0 : -gridMargin.left),
      (d, i) => (i === 0 ? width : width + gridMargin.right),
      gridOptions,
    );
    // createNormalBorder(reflineGroup, width, height);
    g.node().insertBefore(reflineGroup.node(), g.node().firstChild);
  }
}

/**
 * Creates a rotated (horizontal) line chart using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x` and `y` properties.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - The direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - The direction of the y-axis ("default" or "inverse").
 * @param {number} xMin - The minimum x value for x-field.
 * @param {number} xMax - The maximum x value for x-field.
 * @param {number} yMin - The minimum y value for y-field.
 * @param {number} yMax - The maximum y value for y-field.
 * @param {Object} order - The order of the x-field when it is a string.
 * @param {function|string} color - The color of the line. Either a color scale function or a color string.
 * @param {number} [padding=0] - The padding of the line points (to align with the bar chart).
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createHorizontalLineChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color,
  padding = 0,
  options = {},
) {
  // parse additional options
  const style = options?.style ?? options?.variation ?? "default";
  const { showGrid = true, lineWidthMax = 3 } = options || {};
  // other options are directly passed into `createLinePath()`.

  // calculate lineWidth
  options.lineWidth = options.lineWidth || Math.sqrt(width * height) / 50;
  options.lineWidth =
    Math.min(Math.max(options.lineWidth, 2), lineWidthMax) / Math.sqrt(2);

  g = g.attr("width", width).attr("height", height).append("g");

  let y = null;
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);
  if (typeof data[0].x === "string") {
    let yDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      yDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    yDomain = handleDomain(yDomain);

    // Auto-fill missing year data (for cancelled events like Olympics)
    const existingX = new Set(data.map((d) => d.x));
    const missingX = yDomain.filter((x) => !existingX.has(x));

    if (options.yName && options.yName.includes("cnt")) {
      if (missingX.length > 0) {
        if (data[0].hasOwnProperty("label")) {
          const labels = Array.from(new Set(data.map((d) => d.label)));
          labels.forEach((label) => {
            missingX.forEach((x) => {
              data.push({
                x: x,
                y: 0,
                label: label,
                cancelled: true,
              });
            });
          });
        } else {
          missingX.forEach((x) => {
            data.push({
              x: x,
              y: 0,
              cancelled: true,
            });
          });
        }
      }
      // Sort data to ensure correct line drawing
      data.sort((a, b) => yDomain.indexOf(a.x) - yDomain.indexOf(b.x));
      if (yMin > 0) yMin = 0;

      // Mark zero points after the first non-zero point as cancelled
      if (data[0].hasOwnProperty("label")) {
        const labels = Array.from(new Set(data.map((d) => d.label)));
        labels.forEach((label) => {
          const labelData = data.filter((d) => d.label === label);
          const firstNonZeroIndex = labelData.findIndex((d) => d.y !== 0);
          if (firstNonZeroIndex !== -1) {
            labelData.forEach((d, i) => {
              if (i > firstNonZeroIndex && d.y === 0) {
                d.cancelled = true;
                globalSettings.cancelledLegendColumns.add(options.yName);
              }
            });
          }
        });
      } else {
        const firstNonZeroIndex = data.findIndex((d) => d.y !== 0);
        if (firstNonZeroIndex !== -1) {
          data.forEach((d, i) => {
            if (i > firstNonZeroIndex && d.y === 0) {
              d.cancelled = true;
              globalSettings.cancelledLegendColumns.add(options.yName);
            }
          });
        }
      }
    }

    y = d3
      .scalePoint()
      .domain(yDomain)
      .range(yAxisDir === "default" ? [0, height] : [height, 0])
      .padding(padding);
  } else {
    y = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range(yAxisDir === "default" ? [0, height] : [height, 0]);
  }

  const x = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(xAxisDir === "default" ? [0, width] : [width, 0]);

  // data = filterMissingValue(data);
  // If data contains multiple series with a label
  if (data[0].hasOwnProperty("label")) {
    // To prevent overlap, disable showMinMax, showPoints, showAvgLine
    options["showMinMax"] = false;
    // options["showPoints"] = false;
    options["showAvgLine"] = false;
    options.lineWidth = options.lineWidth / Math.sqrt(2);
    // Group data by label
    let labels = Array.from(new Set(data.map((d) => d.label))); // Get unique labels
    labels.forEach((label, idx) => {
      let labelData = data
        .filter((d) => d.label === label)
        .map((d) => ({ x: d.y, y: d.x }));
      const l0 = labelData.length;
      labelData = sampleLineData(labelData, height);
      if (labelData.length < l0) {
        options["sampleLineData"] = true;
      }
      const shapes = ["circle", "square", "triangle", "diamond"];
      const pointShape = options.pointShape
        ? typeof options.pointShape === "function"
          ? (d, i) => options.pointShape(d, i, label)
          : options.pointShape
        : shapes[idx % shapes.length];
      const lineColor = typeof color === "function" ? color(label) : color;
      createLinePath(
        g,
        labelData,
        x,
        y,
        lineColor,
        0.8,
        "horizontal",
        xAxisDir,
        { ...options, pointShape },
      );
    });
  } else {
    // Create a single line if no label exists
    let horizontalData = data.map((d) => ({ x: d.y, y: d.x }));
    const l0 = horizontalData.length;
    horizontalData = sampleLineData(horizontalData, height);
    if (horizontalData.length < l0) {
      options["sampleLineData"] = true;
    }
    createLinePath(
      g,
      horizontalData,
      x,
      y,
      color,
      1,
      "horizontal",
      xAxisDir,
      options,
    );
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Add x-axis if needed
  let fakeAxis = xAxisPos === "none" ? "horizontal" : "none";
  let ticks = axisCartesian(g, xAxisPos, x, width, height, "x", {
    chartType: "line",
    allInteger: yAllInteger,
    fontStyle: fontStyle,
    fakeAxis: fakeAxis,
    border: options.border,
    axisColor: options.axisColor,
  });
  let verticalValues = ticks.map((val) => x(val));

  fakeAxis = yAxisPos === "none" ? "vertical" : "none";
  ticks = axisCartesian(g, yAxisPos, y, width, height, "y", {
    chartType: "line",
    allInteger: xAllInteger,
    fontStyle: fontStyle,
    fakeAxis: fakeAxis,
    border: options.border,
    axisColor: options.axisColor,
  });
  let horizontalValues = ticks.map((val) => y(val));

  if (showGrid) {
    verticalValues = enhanceTickValues(verticalValues, 0, width);
    horizontalValues = enhanceTickValues(horizontalValues, 0, height);

    const reflineGroup = g.append("g").attr("class", "refline-group");
    const gridMargin = options.gridMargin || {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    };
    const gridOptions = {
      edgeWidthMultiplier: options.gridEdgeWidthMultiplier || 1,
    };
    createVerticalRefLine(
      reflineGroup,
      verticalValues,
      (d, i) => (i === 0 ? 0 : -gridMargin.top),
      (d, i) => (i === 0 ? height : height + gridMargin.bottom),
      gridOptions,
    );
    createHorizontalRefLine(
      reflineGroup,
      horizontalValues,
      (d, i) => (i === 0 ? 0 : -gridMargin.left),
      (d, i) => (i === 0 ? width : width + gridMargin.right),
      gridOptions,
    );
    // createNormalBorder(reflineGroup, width, height);
    g.node().insertBefore(reflineGroup.node(), g.node().firstChild);
  }
}

/**
 * Creates an area chart using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x` and `y` properties.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} [height=400] - The height of the chart.
 * @param {number} [width=600] - The width of the chart.
 * @param {string} [xAxisPos="bottom"] - The position of the x-axis ("bottom", "top", "none").
 * @param {string} [yAxisPos="left"] - The position of the y-axis ("left", "right", "none").
 * @param {function|string} [color="steelblue"] - The color of the area. Either a color scale function or a color string.
 * @param {number} [xMin] - The minimum x value for the chart range.
 * @param {number} [xMax] - The maximum x value for the chart range.
 * @param {number} [yMin] - The minimum y value for the chart range.
 * @param {number} [yMax] - The maximum y value for the chart range.
 */
export function createVerticalAreaChart(
  data,
  g,
  height = 400,
  width = 600,
  xAxisPos = "bottom",
  yAxisPos = "left",
  color = "steelblue",
  xMin = undefined,
  xMax = undefined,
  yMin = undefined,
  yMax = undefined,
) {
  g = g.attr("width", width).attr("height", height).append("g");

  // Define scales for x and y axes
  const x = d3
    .scaleLinear()
    .domain([
      xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x), // Use xMin if provided, else use data's x min
      xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x), // Use xMax if provided, else use data's x max
    ])
    .range([0, width]);

  const y = d3
    .scaleLinear()
    .domain([
      yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y), // Use yMin if provided, else use data's y min
      yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y), // Use yMax if provided, else use data's y max
    ])
    .range([height, 0]);

  // Create the area generator
  const area = d3
    .area()
    .x((d) => x(d.x))
    .y0(height) // Start from the bottom of the chart
    .yMin((d) => y(d.y))
    .curve(d3.curveMonotoneX); // Smooth curve

  // Append the area path
  g.append("path")
    .datum(data) // Bind data
    .attr("fill", color)
    .attr("d", area);

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "x");
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "y");
  }
}

/**
 * Creates an area chart using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x` and `y` properties.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} [height=400] - The height of the chart.
 * @param {number} [width=600] - The width of the chart.
 * @param {string} [xAxisPos="bottom"] - The position of the x-axis ("bottom", "top", "none").
 * @param {string} [yAxisPos="left"] - The position of the y-axis ("left", "right", "none").
 * @param {function|string} [color="steelblue"] - The color of the area. Either a color scale function or a color string.
 * @param {number} [xMin] - The minimum x value for the chart range.
 * @param {number} [xMax] - The maximum x value for the chart range.
 * @param {number} [yMin] - The minimum y value for the chart range.
 * @param {number} [yMax] - The maximum y value for the chart range.
 */
export function createHorizontalAreaChart(
  data,
  g,
  height = 400,
  width = 600,
  xAxisPos = "bottom",
  yAxisPos = "left",
  color = "steelblue",
  xMin = undefined,
  xMax = undefined,
  yMin = undefined,
  yMax = undefined,
) {
  g = g.attr("width", width).attr("height", height).append("g");

  // Define scales for x and y axes
  const y = d3
    .scaleLinear()
    .domain([
      xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x), // Use xMin if provided, else use data's x min
      xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x), // Use xMax if provided, else use data's x max
    ])
    .range([0, width]);

  const x = d3
    .scaleLinear()
    .domain([
      yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y), // Use yMin if provided, else use data's y min
      yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y), // Use yMax if provided, else use data's y max
    ])
    .range([height, 0]);

  // Create the area generator
  const area = d3
    .area()
    .x((d) => x(d.y))
    .y0(height) // Start from the bottom of the chart
    .yMin((d) => y(d.x))
    .curve(d3.curveMonotoneX); // Smooth curve

  // Append the area path
  g.append("path")
    .datum(data) // Bind data
    .attr("fill", color)
    .attr("d", area);

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "y");
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "x");
  }
}

/**
 * Creates a radial line chart using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x`, `y`, (`label`) properties.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} startAngle - The starting angle of the chart in radians.
 * @param {number} endAngle - The ending angle of the chart in radians.
 * @param {number} innerRadius - The inner radius of the radial chart.
 * @param {number} outerRadius - The outer radius of the radial chart.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} xMin - The minimum x value for x-field.
 * @param {number} xMax - The maximum x value for x-field.
 * @param {number} yMin - The minimum y value for y-field.
 * @param {number} yMax - The maximum y value for y-field.
 * @param {Object} order - The order of the x-field when it's a string, as a list.
 * @param {function|string} [color="steelblue"] - The color of the line. Either a color scale function or a color string.
 * @param {string} [style="default"] - The visual style of the line. Choices: ["default", "sketch", "dotted", "dashed"].
 * @param {number} [padding=0] - The padding of the line points (to align with the bar chart).
 * @param {number} [lineWidth=3] - The width of the line.
 * @param {boolean} [showGrid=true] - Whether to show the grid lines.
 * @param {string} [lineType="linear"] - The type of line to draw ("linear" or "step" or "cardinal").
 * @param {Object} [options={}] - Additional options for the chart (showPoints, showMinMax, showAvgLine).
 */
export function createRadialLineChart(
  data,
  g,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color = "steelblue",
  style = "default",
  padding = 0,
  lineWidth = 3,
  showGrid = true,
  lineType = "cardinal",
  options = {},
) {
  // parse additional options
  const {
    showPoints = true,
    showMinMax = false, // For radial charts, disable min/max point markers
    showAvgLine = false, // For radial charts, disable average line
    showShadow = true,
    showAreaFill = innerRadius > 0,
    areaFillOpacity = 0.2,
  } = options || {};

  // Define scales for radial and angular (x) axes
  let angleScale = null;
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);

  if (typeof data[0].x === "string") {
    let xDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      xDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    xDomain = handleDomain(xDomain);
    angleScale = d3
      .scalePoint()
      .domain(xDomain)
      .range(
        xAxisDir === "default"
          ? [startAngle, endAngle]
          : [endAngle, startAngle],
      )
      .padding(padding);
  } else {
    angleScale = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range(
        xAxisDir === "default"
          ? [startAngle, endAngle]
          : [endAngle, startAngle],
      ); // Map x values to angles
  }

  const radiusScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    ); // Map y values to radial distances

  // data = filterMissingValue(data); // Uncommenting may cause issues because the curve will interpolate/smooth the line
  if (data[0].hasOwnProperty("label")) {
    // Group data by label
    const labels = Array.from(new Set(data.map((d) => d.label))); // Get unique labels
    labels.forEach((label, idx) => {
      let labelData = data.filter((d) => d.label === label);
      // labelData = sampleLineData(
      // labelData,
      // innerRadius * (endAngle - startAngle),
      // );
      const shapes = ["circle", "square", "triangle", "diamond"];
      const pointShape = options.pointShape
        ? typeof options.pointShape === "function"
          ? (d, i) => options.pointShape(d, i, label)
          : options.pointShape
        : shapes[idx % shapes.length];
      const lineColor = typeof color === "function" ? color(label) : color;
      createRadialLinePath(
        g,
        labelData,
        angleScale,
        radiusScale,
        lineColor,
        style,
        lineWidth,
        lineType,
        1,
        {
          showPoints,
          showMinMax,
          showAvgLine,
          pointShape,
          showShadow,
          showAreaFill,
          areaFillOpacity,
        },
      );
    });
  } else {
    // data = sampleLineData(data, innerRadius * (endAngle - startAngle));
    createRadialLinePath(
      g,
      data,
      angleScale,
      radiusScale,
      typeof color === "function" ? color : color,
      style,
      lineWidth,
      lineType,
      1,
      {
        showPoints,
        showMinMax,
        showAvgLine,
        pointShape: options.pointShape,
        showShadow,
        showAreaFill,
        areaFillOpacity,
      },
    );
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  let angularValues = null;
  let radialValues = null;

  // draw x-axis
  if (xAxisPos.includes("bottom")) {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      chartType: "line",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else if (xAxisPos.includes("top")) {
    const [xAxis, ticks] = axisRadialOuter(angleScale, outerRadius, undefined, {
      chartType: "line",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else {
    // If there is no axis, default to tickValues from the inner radial axis
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      chartType: "line",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    angularValues = ticks.map((val) => angleScale(val));
  }

  // draw y-axis
  const axisLayer = g.append("g").attr("class", "axis");
  if (yAxisPos.includes("left")) {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      chartType: "line",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else if (yAxisPos.includes("right")) {
    const ticks = axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      chartType: "line",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else {
    // If there is no axis, default to tickValues from the left polar axis
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      chartType: "line",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  }

  if (showGrid) {
    const minStep = (Math.PI * 10) / 180;
    const minDist = (Math.PI * 1) / 180;
    angularValues = enhanceTickValues(
      angularValues,
      startAngle,
      endAngle,
      minStep,
      minDist,
    );
    radialValues = enhanceTickValues(radialValues, innerRadius, outerRadius);

    const reflineGroup = g.append("g").attr("class", "refline-group");
    createAngularRefLine(reflineGroup, angularValues, innerRadius, outerRadius);
    createRadialRefLine(reflineGroup, radialValues, startAngle, endAngle);
    // createPolarBorder(reflineGroup, innerRadius, outerRadius, startAngle, endAngle);
    g.node().insertBefore(reflineGroup.node(), g.node().firstChild);
  }
}
