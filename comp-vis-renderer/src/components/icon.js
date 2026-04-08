// This file renders icons for the charts.

import * as d3 from "d3";
import { getStrokeDasharray, sampleLineData } from "../utils/vis.js";
import { globalSettings } from "../core/global.js";
import { extractChartType, getInputData } from "../utils/node.js";
import { filterMissingValue, getXyMinMax } from "../utils/maths.js";
import { createLinePath } from "./elements.js";
import {
  drawShape,
  calculateLinearRegression,
  calculateConfidenceInterval,
} from "./scatter.js";

export function createIcon(
  g,
  top,
  left,
  height,
  width,
  chartType,
  options = {},
  border = true,
) {
  const color =
    typeof options.color === "string"
      ? options.color
      : globalSettings.palette.getColorMap("")[0]("");
  g = g.append("g").attr("class", "icon");
  g.attr("transform", `translate(${left}, ${top})`);

  if (border) {
    g.append("rect")
      .attr("width", width + 10)
      .attr("height", height + 10)
      .attr("x", -5)
      .attr("y", -5)
      .attr("rx", 5)
      .attr("ry", 5)
      .attr("fill", "none")
      .attr("stroke", globalSettings.textColorDark)
      .attr("stroke-width", 1);
  }

  switch (chartType) {
    case "bar": {
      createBarIcon(g, height, width, color);
      break;
    }
    case "line": {
      createLineIcon(g, height, width, color, options.lineStyle);
      break;
    }
    case "area": {
      createAreaIcon(g, height, width, color);
      break;
    }
    case "pie": {
      createPieIcon(g, height, width, color);
      break;
    }
    case "scatter": {
      createScatterIcon(g, height, width, color);
      break;
    }
    case "link": {
      createLinkIcon(g, height, width, color);
      break;
    }
    case "parea": {
      createPacIcon(g, height, width, color);
      break;
    }
    default: {
      throw new Error(`Unknown chart type: ${chartType}`);
    }
  }
}

function createBarIcon(g, height, width, color) {
  const data = [0.5, 0.7, 0.4, 0.9, 0.6];
  const x = d3
    .scaleBand()
    .domain(d3.range(data.length))
    .range([0, width])
    .padding(0.3);
  const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

  g.selectAll(".bar-icon")
    .data(data)
    .enter()
    .append("rect")
    .attr("class", "bar-icon")
    .attr("x", (_, i) => x(i))
    .attr("width", x.bandwidth())
    .attr("y", (d) => y(d))
    .attr("height", (d) => y(0) - y(d))
    .attr("fill", color);
}

function createPacIcon(g, height, width, color) {
  const data = [0.2, 0.2, 0.3, 0.4];
  const x = d3
    .scaleBand()
    .domain(d3.range(data.length))
    .range([0, width])
    .padding(0.3);
  const r = d3.scaleLinear().domain([0, 1]).range([0, height]);

  g.selectAll(".pac-icon")
    .data(data)
    .enter()
    .append("circle")
    .attr("class", "pac-icon")
    .attr("cx", (_, i) => x(i) + x.bandwidth() / 2)
    .attr("cy", (d) => height / 2)
    .attr("r", (_, i) => r(data[i]) / 2)
    .attr("fill", color)
    .attr("opacity", 0.7);
}

function createLineIcon(g, height, width, color, lineStyle = "solid") {
  const data = [0.2, 0.4, 0.3, 0.6, 0.5, 0.8];
  const x = d3
    .scaleLinear()
    .domain([0, data.length - 1])
    .range([0, width]);
  const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

  const line = d3
    .line()
    .x((d, i) => x(i))
    .y((d) => y(d))
    .curve(d3.curveMonotoneX);

  g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", getStrokeDasharray(lineStyle))
    .attr("d", line);
}

function createAreaIcon(g, height, width, color) {
  const data = [0.2, 0.4, 0.3, 0.6, 0.5, 0.8];
  const x = d3
    .scaleLinear()
    .domain([0, data.length - 1])
    .range([0, width]);
  const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

  const area = d3
    .area()
    .x((d, i) => x(i))
    .y0(height)
    .y1((d) => y(d))
    .curve(d3.curveMonotoneX);

  g.append("path").datum(data).attr("fill", color).attr("d", area);
}

function createPieIcon(g, height, width, color) {
  const data = [3, 2, 3];
  const radius = Math.min(height, width) / 2;

  const pie = d3.pie();
  const arc = d3
    .arc()
    .innerRadius(0)
    .outerRadius(radius - 2);

  const container = g
    .append("g")
    .attr("transform", `translate(${width / 2},${height / 2})`);

  container
    .selectAll("path")
    .data(pie(data))
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", color)
    .attr("stroke", globalSettings.textColorLight)
    .attr("stroke-width", 1);
}

function createScatterIcon(g, height, width, color) {
  const points = [
    { x: 0.2, y: 0.3 },
    { x: 0.4, y: 0.7 },
    { x: 0.5, y: 0.2 },
    { x: 0.6, y: 0.5 },
    { x: 0.7, y: 0.8 },
    { x: 0.8, y: 0.4 },
  ];

  const x = d3
    .scaleLinear()
    .domain([0, 1])
    .range([4, width - 4]);
  const y = d3
    .scaleLinear()
    .domain([0, 1])
    .range([height - 4, 4]);

  g.selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.x))
    .attr("cy", (d) => y(d.y))
    .attr("r", 2.5)
    .attr("fill", color);
}

function createLinkIcon(g, height, width, color) {
  // TODO
}

export function createChartLegend(
  chartlegendgroup,
  chart,
  polar,
  legendPosition,
) {
  let inputData = getInputData(chart, true);
  const config = chart.config;
  const chartType = extractChartType(chart.chartType);
  if (chartType[2] === "parea") {
    chartType[2] = "bar";
  }
  const simpleChartType = chartType[0]
    ? chartType[0] + chartType[2]
    : chartType[2];
  let dx,
    dy,
    rectX,
    rectY,
    rectWidth,
    rectHeight,
    startAngle,
    endAngle,
    innerRadius,
    outerRadius,
    cx,
    cy;
  if (!polar) {
    rectX = legendPosition.rectX;
    rectY = legendPosition.rectY;
    rectWidth = legendPosition.rectWidth;
    rectHeight = legendPosition.rectHeight;
  } else {
    startAngle = legendPosition.startAngle;
    endAngle = legendPosition.endAngle;
    innerRadius = legendPosition.innerRadius;
    outerRadius = legendPosition.outerRadius;
    cx = legendPosition.cx;
    cy = legendPosition.cy;
  }
  [dx, dy] =
    !polar && !simpleChartType.endsWith("pie")
      ? [rectX || 0, rectY || 0]
      : [cx || 0, cy || 0];
  const chartLegendLayer = chartlegendgroup
    .append("g")
    .attr("class", "chart-legend")
    .attr("transform", `translate(${dx}, ${dy})`)
    .style("pointer-events", "none");
  const options = {
    direction: chartType[0],
    padding: globalSettings.padding,
    ...config.options,
  };

  // Check whether we need to add the 'cancelled' marker
  if (
    config.options.yName &&
    globalSettings.cancelledLegendColumns.has(config.options.yName) &&
    config.options.useGapIndicators !== false
  ) {
    options.showCancelled = true;
  }

  // Pass through the original Y.label as series labels for legends,
  // to avoid losing multi-series label info due to getInputData(chart, true) simplification.
  if (chart?.Y?.label && Array.isArray(chart.Y.label)) {
    options.seriesLabels = chart.Y.label;
  }
  if (config.options.border) {
    options.border = config.options.border;
  }
  switch (simpleChartType) {
    case "vbar":
    case "rbar": {
      createVerticalBarChartLegend(
        inputData,
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.xAxis.name,
        config.yAxis.name,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        options,
      );
      break;
    }
    case "hbar":
    case "cbar": {
      createHorizontalBarChartLegend(
        inputData,
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.xAxis.name,
        config.yAxis.name,
        config.xAxis.direction,
        config.yAxis.direction,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        options,
      );
      break;
    }
    case "rline":
      // options.showMinMax = false;
      // options.showPoints = false;
      options.showAvgLine = false;
      options.radial = true;
    case "vline": {
      createVerticalLineChartLegend(
        inputData,
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.xAxis.name,
        config.yAxis.name,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        options,
      );
      break;
    }
    case "hline": {
      createHorizontalLineChartLegend(
        inputData,
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.xAxis.name,
        config.yAxis.name,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        options,
      );
      break;
    }
    case "rscatter":
      options.showRegression = false;
    case "vscatter": {
      createVerticalScatterPlotLegend(
        inputData,
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.xAxis.name,
        config.yAxis.name,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        options,
      );
      break;
    }
    case "cscatter":
      options.showRegression = false;
    case "hscatter": {
      createHorizontalScatterPlotLegend(
        inputData,
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.xAxis.name,
        config.yAxis.name,
        config.xAxis.direction,
        config.yAxis.direction,
        config.xMin,
        config.xMax,
        config.yMin,
        config.yMax,
        config.order,
        config.color,
        options,
      );
      break;
    }
    case "vpie":
    case "hpie":
    case "rpie": {
      // Add inner radius info to options
      const pieOptions = {
        ...options,
        innerRadius: config.innerRadius || 0,
        outerRadius: config.outerRadius,
      };
      createPieChartLegend(
        inputData,
        chartLegendLayer,
        config.xAxis.name,
        config.yAxis.name,
        config.order,
        config.color,
        pieOptions,
      );
      break;
    }
    case "map": {
      createMapLegend(
        chartLegendLayer,
        rectHeight,
        rectWidth,
        config.color,
        config.colorName,
      );
      break;
    }
  }
}

function addVerticalText(g, x, y, text, textColor, options = {}) {
  const formattedText = String(globalSettings.format(text));
  const {
    withBackgroundShadow = false,
    shadowOpacity = 0.18,
    shadowPaddingX = 2,
    shadowPaddingY = 1,
    shadowRx = 2,
    shadowLength = null,
  } = options;
  const textElement = g
    .append("text")
    .attr("transform", `rotate(-90, ${x}, ${y})`)
    .attr("x", x)
    .attr("y", y)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("fill", textColor) // <-- Use the passed-in textColor
    .text(formattedText);
  globalSettings.setFont(textElement, "legend");

  if (withBackgroundShadow) {
    const estimatedTextWidth =
      formattedText.length *
      (globalSettings.valueCharWidth ||
        globalSettings.getFontSize("legend") * 0.6);
    const estimatedTextHeight =
      (globalSettings.getFontSize("legend") || 12) * 1.2;
    const bboxWidth = estimatedTextHeight;
    const bboxHeight = estimatedTextWidth;
    const centerY = y;
    const rectHeight =
      typeof shadowLength === "number" && shadowLength > 0
        ? shadowLength
        : bboxHeight + 2 * shadowPaddingY;
    g.insert("rect", "text:last-of-type")
      .attr("x", x - bboxWidth / 2)
      .attr("y", centerY - rectHeight / 2)
      .attr("width", bboxWidth)
      .attr("height", rectHeight)
      .attr("rx", shadowRx)
      .attr("ry", shadowRx)
      .attr("fill", textColor)
      .attr("opacity", shadowOpacity);
  }

  return textElement;
}

function addHorizontalText(g, x, y, text, textColor, options = {}) {
  const formattedText = String(globalSettings.format(text));
  const {
    withBackgroundShadow = false,
    shadowOpacity = 0.18,
    shadowPaddingX = 2,
    shadowPaddingY = 1,
    shadowRx = 2,
    shadowLength = null,
  } = options;
  const textElement = g
    .append("text")
    .attr("x", x)
    .attr("y", y)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("fill", textColor) // <-- Use the passed-in textColor
    .text(formattedText);
  globalSettings.setFont(textElement, "legend");

  if (withBackgroundShadow) {
    const estimatedTextWidth =
      formattedText.length *
      (globalSettings.valueCharWidth ||
        globalSettings.getFontSize("legend") * 0.6);
    const estimatedTextHeight =
      (globalSettings.getFontSize("legend") || 12) * 1.2;
    const centerX = x;
    const rectWidth =
      typeof shadowLength === "number" && shadowLength > 0
        ? shadowLength
        : estimatedTextWidth + 2 * shadowPaddingX;
    g.insert("rect", "text:last-of-type")
      .attr("x", centerX - rectWidth / 2)
      .attr("y", y - estimatedTextHeight / 2)
      .attr("width", rectWidth)
      .attr("height", estimatedTextHeight)
      .attr("rx", shadowRx)
      .attr("ry", shadowRx)
      .attr("fill", textColor)
      .attr("opacity", shadowOpacity);
  }

  return textElement;
}

function drawTopAxis(g, width, yMin, yMax, xName) {
  const config = {
    spacing: 15,
    tickLength: 5 * globalSettings.fontRatio, // Arrow height
    arrowWidth: 4 * globalSettings.fontRatio, // Arrow width
    labelPadding: 6 * (2 * globalSettings.fontRatio - 1),
    fontSize: globalSettings.getFontSize("value"),
    color: globalSettings.textColorDark,
  };

  const topAxisGroup = g.append("g").attr("class", "custom-top-axis");

  // Compute Y coordinates (negative so it renders above (0,0))
  const axisY = -config.spacing;
  const labelY = axisY - config.labelPadding;

  // 1. Draw the horizontal axis line
  topAxisGroup
    .append("line")
    .attr("x1", 0)
    .attr("y1", axisY)
    .attr("x2", width)
    .attr("y2", axisY)
    .attr("stroke", config.color)
    .attr("stroke-width", 1);

  // 2. Draw yMin tick and label
  const leftArrow = d3.path();
  leftArrow.moveTo(config.arrowWidth, axisY - config.tickLength / 2); // Arrow top point
  // leftArrow.lineTo(0, axisY); // Connection point between arrow and axis
  // leftArrow.lineTo(config.arrowWidth, axisY + config.tickLength / 2); // Arrow bottom point
  topAxisGroup
    .append("path")
    .attr("d", leftArrow.toString())
    .attr("fill", "none")
    .attr("stroke", config.color);

  addHorizontalText(
    topAxisGroup,
    -config.labelPadding,
    labelY,
    yMin,
    config.color,
  )
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "hanging");

  // 3. Draw yMax tick and label
  const rightArrow = d3.path();
  rightArrow.moveTo(width - config.arrowWidth, axisY - config.tickLength / 2); // Arrow top point
  rightArrow.lineTo(width, axisY); // Connection point between arrow and axis
  rightArrow.lineTo(width - config.arrowWidth, axisY + config.tickLength / 2); // Arrow bottom point
  topAxisGroup
    .append("path")
    .attr("d", rightArrow.toString())
    .attr("fill", "none")
    .attr("stroke", config.color);
  addHorizontalText(
    topAxisGroup,
    width + config.labelPadding,
    labelY,
    yMax,
    config.color,
  )
    .attr("text-anchor", "start")
    .attr("dominant-baseline", "hanging");

  // 4. Draw xName label
  const capitalizedXName = xName.charAt(0).toUpperCase() + xName.slice(1);
  addHorizontalText(
    topAxisGroup,
    width / 2,
    labelY - 5,
    capitalizedXName,
    config.color,
  )
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "auto")
    .attr("font-weight", "bold");
}

function drawBottomAxis(g, width, height, xMin, xMax, xName, options = {}) {
  const config = {
    spacing: 10, // Spacing between axis and the content above
    tickLength: 5 * globalSettings.fontRatio, // Arrow height
    arrowWidth: 4 * globalSettings.fontRatio, // Arrow width
    labelPadding: 6 * (2 * globalSettings.fontRatio - 1),
    fontSize: globalSettings.getFontSize("value"),
    color: globalSettings.textColorDark,
    ...options,
  };

  const bottomAxisGroup = g.append("g").attr("class", "custom-bottom-axis");

  // Compute Y coordinates
  const axisY = height + config.spacing;
  const labelY = axisY + config.labelPadding;

  // 1. Draw the horizontal axis line
  bottomAxisGroup
    .append("line")
    .attr("x1", 0)
    .attr("y1", axisY)
    .attr("x2", width)
    .attr("y2", axisY)
    .attr("stroke", config.color);

  // 2. Draw the left (xMin) arrow and label
  const leftArrow = d3.path();
  leftArrow.moveTo(config.arrowWidth, axisY - config.tickLength / 2); // Arrow tip
  // leftArrow.lineTo(0, axisY); // Connection point between arrow and axis
  // leftArrow.lineTo(config.arrowWidth, axisY + config.tickLength / 2); // Bottom-right point of the arrow
  bottomAxisGroup
    .append("path")
    .attr("d", leftArrow.toString())
    .attr("fill", "none")
    .attr("stroke", config.color);

  addHorizontalText(
    bottomAxisGroup,
    -config.labelPadding,
    labelY,
    xMin,
    config.color,
  )
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "auto");

  // 3. Draw the right (xMax) arrow and label
  const rightArrow = d3.path();
  rightArrow.moveTo(width - config.arrowWidth, axisY - config.tickLength / 2); // Arrow tip
  rightArrow.lineTo(width, axisY); // Connection point between arrow and axis
  rightArrow.lineTo(width - config.arrowWidth, axisY + config.tickLength / 2); // Bottom-left point of the arrow
  bottomAxisGroup
    .append("path")
    .attr("d", rightArrow.toString())
    .attr("fill", "none")
    .attr("stroke", config.color);

  addHorizontalText(
    bottomAxisGroup,
    width + config.labelPadding,
    labelY,
    xMax,
    config.color,
  )
    .attr("text-anchor", "start")
    .attr("dominant-baseline", "auto");

  // 4. Draw xName label
  const capitalizedXName = xName.charAt(0).toUpperCase() + xName.slice(1);
  addHorizontalText(
    bottomAxisGroup,
    width / 2,
    labelY + 3,
    capitalizedXName,
    config.color,
  )
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "hanging")
    .attr("font-weight", "bold");
}

function drawLeftAxis(g, height, yMin, yMax, yName, reverse = false) {
  const config = {
    spacing: 20, // Spacing between axis and the content on the right
    tickLength: 5 * globalSettings.fontRatio, // Arrow height
    arrowWidth: 4 * globalSettings.fontRatio, // Arrow width
    labelPadding: 10,
    fontSize: globalSettings.getFontSize("value"),
    color: globalSettings.textColorDark,
  };

  const leftAxisGroup = g.append("g").attr("class", "custom-left-axis");

  // Compute X coordinates (negative so it renders to the left of (0,0))
  const axisX = -config.spacing;
  const labelX = axisX - config.labelPadding;

  // 1. Draw the vertical axis line
  leftAxisGroup
    .append("line")
    .attr("x1", axisX)
    .attr("y1", 0)
    .attr("x2", axisX)
    .attr("y2", height)
    .attr("stroke", config.color);

  const topValue = reverse ? yMin : yMax;
  const bottomValue = reverse ? yMax : yMin;

  // 2. Draw the top tick and label
  const topArrow = d3.path();
  if (!reverse) {
    topArrow.moveTo(axisX - config.arrowWidth / 2, config.tickLength); // Arrow left point
    topArrow.lineTo(axisX, 0); // Arrow tip
    topArrow.lineTo(axisX + config.arrowWidth / 2, config.tickLength); // Arrow right point
  }
  leftAxisGroup
    .append("path")
    .attr("d", topArrow.toString())
    .attr("fill", "none")
    .attr("stroke", config.color);
  addHorizontalText(
    leftAxisGroup,
    labelX,
    5 * (globalSettings.fontRatio - 1),
    topValue,
    config.color,
  ).attr("text-anchor", "end");

  // 3. Draw the bottom tick and label
  const bottomArrow = d3.path();
  if (reverse) {
    // When reversed, the arrow points up
    bottomArrow.moveTo(
      axisX - config.arrowWidth / 2,
      height - config.tickLength,
    ); // Arrow left point
    bottomArrow.lineTo(axisX, height); // Arrow tip
    bottomArrow.lineTo(
      axisX + config.arrowWidth / 2,
      height - config.tickLength,
    ); // Arrow right point
  }
  leftAxisGroup
    .append("path")
    .attr("d", bottomArrow.toString())
    .attr("fill", "none")
    .attr("stroke", config.color);
  addHorizontalText(
    leftAxisGroup,
    labelX,
    height - 5 * (globalSettings.fontRatio - 1),
    bottomValue,
    config.color,
  ).attr("text-anchor", "end");

  // 4. Draw yName label (center)
  const capitalizedYName = yName.charAt(0).toUpperCase() + yName.slice(1);
  addHorizontalText(
    leftAxisGroup,
    labelX,
    height / 2,
    capitalizedYName,
    config.color,
  )
    .attr("text-anchor", "end")
    .attr("font-weight", "bold");
}

function drawTopBottomBracket(
  g,
  x,
  y,
  width,
  tickHeight,
  type = "top",
  color = globalSettings.textColorDark,
  strokeWidth = 2,
) {
  let d;
  if (type === "top") {
    d = `M ${x},${y + tickHeight} L ${x},${y} L ${x + width},${y} L ${x + width},${y + tickHeight}`;
  } else {
    // bottom
    d = `M ${x},${y} L ${x},${y + tickHeight} L ${x + width},${y + tickHeight} L ${x + width},${y}`;
  }
  g.append("path")
    .attr("d", d)
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", strokeWidth)
    .attr("opacity", 0.7);
}

function drawLeftRightBracket(
  g,
  x,
  y,
  width,
  height,
  type = "left",
  color = globalSettings.textColorDark,
  strokeWidth = 2,
) {
  let d; // Path data string

  if (type === "left") {
    // Path for '[':  MoveRight -> LineLeft -> LineDown -> LineRight
    d = `M ${x + width},${y} L ${x},${y} L ${x},${y + height} L ${x + width},${y + height}`;
  } else {
    // 'right'
    // Path for ']':  MoveLeft -> LineRight -> LineDown -> LineLeft
    d = `M ${x},${y} L ${x + width},${y} L ${x + width},${y + height} L ${x},${y + height}`;
  }

  g.append("path")
    .attr("d", d)
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", strokeWidth)
    .attr("opacity", 0.7);
}

function createVerticalBarChartLegend(
  data,
  g,
  height,
  width,
  xName, // Added
  yName, // Added
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { direction, padding, border = null } = options;

  // Draw the Y axis on the left using the new helper.
  // For vertical charts, the Y axis is quantitative, so we pass yMin, yMax, yName.
  drawLeftAxis(g, height, yMin, yMax, yName);

  if (!yMin) yMin = 0;
  if (!yMax) yMax = d3.max(data, (d) => d.y);
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  const mainContentGroup = g.append("g").attr("class", "main-legend-content");

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const colorScale = typeof color === "function" ? color : () => color;

  // Define x scale (categorical)
  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  // Define y scale (linear)
  const y = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(yAxisDir === "default" ? [height, 0] : [0, height]);

  const measureGroup = mainContentGroup
    .append("g")
    .attr("class", "legend-text-measure")
    .attr("visibility", "hidden");
  const maxLabelTextWidth = d3.max(data, (d) => {
    const formattedText = String(globalSettings.format(d.x));
    return (
      formattedText.length *
      (globalSettings.valueCharWidth ||
        globalSettings.getFontSize("legend") * 0.6)
    );
  });
  measureGroup.remove();
  const sharedShadowLength = Math.max(maxLabelTextWidth || 0, height / 2);

  const textGroup = mainContentGroup.append("g").attr("class", "text-group");
  data.forEach((d) => {
    const singleTextGroup = textGroup
      .append("g")
      .attr("class", "single-legend-text");

    // Compute text position
    const left = x(d.x) + x.bandwidth() / 2; // Horizontally centered in its band
    const top = height / 2; // Vertically centered in the legend area
    const textColor = colorScale(d.x);

    // Use addVerticalText to draw rotated text
    addVerticalText(singleTextGroup, left, top, d.x, textColor, {
      withBackgroundShadow: true,
      shadowLength: sharedShadowLength,
    });
  });

  // Use helper functions to draw top/bottom brackets
  const bracketGroup = mainContentGroup
    .append("g")
    .attr("class", "brackets-group");
  if (border && border === "horizontal") {
    const bracketWidth = 5;
    drawLeftRightBracket(
      bracketGroup,
      -bracketWidth,
      -bracketWidth / 2,
      bracketWidth,
      height + bracketWidth,
      "left",
    );
    drawLeftRightBracket(
      bracketGroup,
      width - bracketWidth + bracketWidth,
      -bracketWidth / 2,
      bracketWidth,
      height + bracketWidth,
      "right",
    );
  } else {
    const bracketTickHeight = 5; // Tick height for top/bottom brackets
    drawTopBottomBracket(
      bracketGroup,
      -bracketTickHeight / 2,
      -bracketTickHeight,
      width + bracketTickHeight,
      bracketTickHeight,
      "top",
    );
    drawTopBottomBracket(
      bracketGroup,
      -bracketTickHeight / 2,
      height,
      width + bracketTickHeight,
      bracketTickHeight,
      "bottom",
    );
  }
}

function createHorizontalBarChartLegend(
  data,
  g,
  height,
  width,
  xName,
  yName,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { direction, padding, border = null } = options;
  drawBottomAxis(g, width, height, yMin, yMax, xName);

  // **** Legend main content below stays unchanged ****

  if (!yMin) yMin = 0;
  if (!yMax) yMax = d3.max(data, (d) => d.y);
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  const mainContentGroup = g.append("g").attr("class", "main-legend-content");

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const colorScale = typeof color === "function" ? color : () => color;

  const y = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(yAxisDir === "default" ? [0, height] : [height, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const x = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(xAxisDir === "default" ? [0, width] : [width, 0]);

  const measureGroup = mainContentGroup
    .append("g")
    .attr("class", "legend-text-measure")
    .attr("visibility", "hidden");
  const maxLabelTextWidth = d3.max(data, (d) => {
    const formattedText = String(globalSettings.format(d.x));
    return (
      formattedText.length *
      (globalSettings.valueCharWidth ||
        globalSettings.getFontSize("legend") * 0.6)
    );
  });
  measureGroup.remove();
  const sharedShadowLength = Math.max(maxLabelTextWidth || 0, width / 2);

  const barsGroup = mainContentGroup.append("g").attr("class", "bars-group");
  data.forEach((d) => {
    const barGroup = barsGroup.append("g").attr("class", "single-legend");

    const top = y(d.x);
    let left = width / 2;
    const textColor = colorScale(d.x);
    addHorizontalText(barGroup, left, top + y.bandwidth() / 2, d.x, textColor, {
      withBackgroundShadow: true,
      shadowLength: sharedShadowLength,
    });
  });

  const bracketGroup = mainContentGroup
    .append("g")
    .attr("class", "brackets-group");

  if (border && border === "vertical") {
    const bracketTickHeight = 5; // Tick height for top/bottom brackets
    drawTopBottomBracket(
      bracketGroup,
      -bracketTickHeight / 2,
      -bracketTickHeight,
      width + bracketTickHeight,
      bracketTickHeight,
      "top",
    );
    drawTopBottomBracket(
      bracketGroup,
      -bracketTickHeight / 2,
      height,
      width + bracketTickHeight,
      bracketTickHeight,
      "bottom",
    );
  } else {
    const bracketWidth = 5;
    drawLeftRightBracket(
      bracketGroup,
      -bracketWidth,
      -bracketWidth / 2,
      bracketWidth,
      height + bracketWidth,
      "left",
    );
    drawLeftRightBracket(
      bracketGroup,
      width - bracketWidth + bracketWidth,
      -bracketWidth / 2,
      bracketWidth,
      height + bracketWidth,
      "right",
    );
  }
}

function createVerticalLineChartLegend(
  data,
  g,
  height,
  width,
  xName,
  yName,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  options.lineWidth = options.lineWidth || Math.sqrt(width * height) / 50;
  options.lineWidth = Math.min(Math.max(options.lineWidth, 1.75), 3.5);
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);
  drawLeftAxis(g, height, yMin, yMax, yName);
  drawBottomAxis(g, width, height, xMin, xMax, xName);
  const mainContentGroup = g
    .append("g")
    .attr("class", "main-linelegend-content");
  let x = null;
  if (typeof data[0].x === "string") {
    const xDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      xDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    x = d3
      .scalePoint()
      .domain(xDomain)
      .range(xAxisDir === "default" ? [0, width] : [width, 0]);
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

  // -- Draw the data line (within mainContentGroup) --
  const colorScale = typeof color === "function" ? color : () => color;
  if (!options.radial) {
    data = filterMissingValue(data);
  }
  const l0 = data.length;
  data = sampleLineData(data, width);
  if (data.length < l0) {
    options["sampleLineData"] = true;
  }

  if (options.showCancelled && data.length > 2) {
    const midIndex = Math.floor(data.length / 2);
    data[midIndex] = { ...data[midIndex], cancelled: true };
  }

  options["showLegend"] = true;
  createLinePath(
    mainContentGroup,
    data,
    x,
    y,
    colorScale,
    1,
    "vertical",
    yAxisDir,
    options,
  );

  // If options.seriesLabels exists, use it instead of inferring from data (data may be filtered)
  if (
    (options.seriesLabels && options.seriesLabels.length) ||
    (data &&
      data.length > 0 &&
      Object.prototype.hasOwnProperty.call(data[0], "label"))
  ) {
    const labels =
      options.seriesLabels && options.seriesLabels.length
        ? options.seriesLabels
        : Array.from(new Set(data.map((d) => d.label)));
    const shapesCycle = ["circle", "square", "triangle", "diamond"];
    const seriesLegend = g
      .append("g")
      .attr("class", "series-legend")
      .attr("transform", `translate(${width + 10}, 0)`);

    const fontSize = globalSettings.getFontSize("legend");
    const lineH = 14 * globalSettings.fontRatio;
    const markerR = Math.max(
      2.5,
      options.lineWidth ? options.lineWidth * 0.9 : 2.5,
    );
    const symbolSize = Math.PI * markerR * markerR;

    labels.forEach((label, idx) => {
      const yPos = idx * (lineH + 4);
      // Compute point shape for this label, following the same rules as line.js
      let pointShape;
      if (options.pointShape) {
        if (typeof options.pointShape === "function") {
          // Keep consistent with line.js: function signature (d, i, label)
          pointShape = options.pointShape({ label }, 0, label);
        } else {
          pointShape = options.pointShape;
        }
      } else {
        pointShape = shapesCycle[idx % shapesCycle.length];
      }

      const fillColor = typeof color === "function" ? color(label) : color;
      const markerGroup = seriesLegend
        .append("g")
        .attr("transform", `translate(0, ${yPos})`);

      // Draw shape
      switch (pointShape) {
        case "square": {
          markerGroup
            .append("rect")
            .attr("x", 0 - markerR)
            .attr("y", 0 - markerR)
            .attr("width", 2 * markerR)
            .attr("height", 2 * markerR)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          // Midline
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
          break;
        }
        case "triangle": {
          const symbol = d3.symbol().type(d3.symbolTriangle).size(symbolSize)();
          markerGroup
            .append("path")
            .attr("d", symbol)
            .attr("transform", `translate(0, 0)`)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
          break;
        }
        case "diamond": {
          const symbol = d3.symbol().type(d3.symbolDiamond).size(symbolSize)();
          markerGroup
            .append("path")
            .attr("d", symbol)
            .attr("transform", `translate(0, 0)`)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
          break;
        }
        case "circle":
        default: {
          markerGroup
            .append("circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", markerR)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
        }
      }

      // Text label
      const text = seriesLegend
        .append("text")
        .attr("x", markerR + 6)
        .attr("y", yPos)
        .attr("dominant-baseline", "middle")
        .attr("fill", globalSettings.textColorDark)
        .text(String(label));
      globalSettings.setFont(text, "legend");
    });
  }

  if (options.showCancelled && data.length > 2) {
    const midIndex = Math.floor(data.length / 2);
    const d = data[midIndex];
    const cx = x(d.x) + (x.bandwidth ? x.bandwidth() / 2 : 0);
    const cy = y(0);

    const text = mainContentGroup
      .append("text")
      .attr("x", cx)
      .attr("y", cy - 5)
      .attr("text-anchor", "middle")
      .attr("fill", typeof color === "function" ? color(d.label) : color)
      .text("No data");
    globalSettings.setFont(text, "legend");
  }
}

function createHorizontalLineChartLegend(
  data,
  g,
  height,
  width,
  xName,
  yName,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  options.lineWidth = options.lineWidth || Math.sqrt(width * height) / 50;
  options.lineWidth = Math.min(Math.max(options.lineWidth, 1.75), 3.5);
  // Step 1: Get data ranges (same as the vertical version)
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);

  // Step 2: Draw the axis framework (same call structure as the vertical version)
  // For horizontal charts: the Y axis (left) is the categorical axis (xName), and the X axis (bottom) is the quantitative axis (yName)
  drawLeftAxis(g, height, xMin, xMax, yName, true);
  drawBottomAxis(g, width, height, yMin, yMax, xName);

  // Step 3: Create the main content group (same as the vertical version)
  const mainContentGroup = g
    .append("g")
    .attr("class", "main-linelegend-content");

  // Step 4: Define scales (swap logic relative to the vertical version)
  // X scale is quantitative and based on data.y
  const x = d3
    .scaleLinear()
    .domain([yMin, yMax]) // Use the y-value range
    .range(xAxisDir === "default" ? [0, width] : [width, 0]);

  // Y scale is categorical and based on data.x
  let y = null;
  if (typeof data[0].x === "string") {
    const yDomain = Array.from(new Set(data.map((d) => d.x))); // Get domain from data.x
    if (Array.isArray(order)) {
      yDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    y = d3
      .scalePoint()
      .domain(yDomain)
      .range(yAxisDir === "default" ? [0, height] : [height, 0]); // Range is height
  } else {
    // If data.x is numeric, use a linear Y scale
    y = d3
      .scaleLinear()
      .domain([xMin, xMax]) // Use the x-value range
      .range(yAxisDir === "default" ? [0, height] : [height, 0]);
  }

  // Step 5: Draw the line (within mainContentGroup)
  const colorScale = typeof color === "function" ? color : () => color;
  data = filterMissingValue(data);
  const l0 = data.length;
  data = sampleLineData(data, height);
  if (data.length < l0) {
    options["sampleLineData"] = true;
  }
  const horizontalData = data.map((d) => ({ x: d.y, y: d.x, label: d.label }));

  if (options.showCancelled && horizontalData.length > 2) {
    const midIndex = Math.floor(horizontalData.length / 2);
    horizontalData[midIndex].cancelled = true;

    const d = horizontalData[midIndex];
    const cx = x(0);
    const cy = y(d.y) + (y.bandwidth ? y.bandwidth() / 2 : 0);

    const text = mainContentGroup
      .append("text")
      .attr("x", cx + 5)
      .attr("y", cy)
      .attr("dominant-baseline", "middle")
      .attr("fill", typeof color === "function" ? color(d.label) : color)
      .text("No data");
    globalSettings.setFont(text, "legend", 10);
  }

  options["showLegend"] = true;
  createLinePath(
    mainContentGroup,
    horizontalData,
    x,
    y,
    colorScale,
    1,
    "horizontal", // <-- Key change: direction becomes "horizontal"
    xAxisDir, // <-- Key change: main direction follows X axis
    options,
  );

  // Multi-series shape legend (prefer options.seriesLabels)
  if (
    (options.seriesLabels && options.seriesLabels.length) ||
    (data &&
      data.length > 0 &&
      Object.prototype.hasOwnProperty.call(data[0], "label"))
  ) {
    const labels =
      options.seriesLabels && options.seriesLabels.length
        ? options.seriesLabels
        : Array.from(new Set(data.map((d) => d.label)));
    const shapesCycle = ["circle", "square", "triangle", "diamond"];
    const seriesLegend = g
      .append("g")
      .attr("class", "series-legend")
      .attr("transform", `translate(${width + 10}, 0)`);

    const lineH = 14 * globalSettings.fontRatio;
    const markerR = Math.max(
      2.5,
      options.lineWidth ? options.lineWidth * 0.9 : 2.5,
    );
    const symbolSize = Math.PI * markerR * markerR;

    labels.forEach((label, idx) => {
      const yPos = idx * (lineH + 4);
      let pointShape;
      if (options.pointShape) {
        if (typeof options.pointShape === "function") {
          pointShape = options.pointShape({ label }, 0, label);
        } else {
          pointShape = options.pointShape;
        }
      } else {
        pointShape = shapesCycle[idx % shapesCycle.length];
      }

      const fillColor = typeof color === "function" ? color(label) : color;
      const markerGroup = seriesLegend
        .append("g")
        .attr("transform", `translate(0, ${yPos})`)
        .attr("class", "series-legend-item");

      switch (pointShape) {
        case "square": {
          markerGroup
            .append("rect")
            .attr("x", 0 - markerR)
            .attr("y", 0 - markerR)
            .attr("width", 2 * markerR)
            .attr("height", 2 * markerR)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
          break;
        }
        case "triangle": {
          const symbol = d3.symbol().type(d3.symbolTriangle).size(symbolSize)();
          markerGroup
            .append("path")
            .attr("d", symbol)
            .attr("transform", `translate(0, 0)`)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
          break;
        }
        case "diamond": {
          const symbol = d3.symbol().type(d3.symbolDiamond).size(symbolSize)();
          markerGroup
            .append("path")
            .attr("d", symbol)
            .attr("transform", `translate(0, 0)`)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
          break;
        }
        case "circle":
        default: {
          markerGroup
            .append("circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", markerR)
            .attr("fill", fillColor)
            .attr("stroke", "none");
          markerGroup
            .append("line")
            .attr("x1", -markerR - 2)
            .attr("y1", 0)
            .attr("x2", markerR + 2)
            .attr("y2", 0)
            .attr("stroke", fillColor)
            .attr("stroke-width", options.lineWidth * 0.8);
        }
      }

      const text = seriesLegend
        .append("text")
        .attr("x", markerR + 6)
        .attr("y", yPos)
        .attr("dominant-baseline", "middle")
        .attr("fill", globalSettings.textColorDark)
        .text(String(label));
      globalSettings.setFont(text, "legend");
    });
  }

  if (options.showCancelled) {
    const seriesLegend = g.select(".series-legend").empty()
      ? g
          .append("g")
          .attr("class", "series-legend")
          .attr("transform", `translate(${width + 10}, 0)`)
      : g.select(".series-legend");

    const lineH = 14 * globalSettings.fontRatio;
    const markerR = Math.max(
      2.5,
      options.lineWidth ? options.lineWidth * 0.9 : 2.5,
    );

    // Calculate yPos based on existing items
    const existingItems = seriesLegend.selectAll(".series-legend-item").size();
    const yPos = existingItems * (lineH + 4);

    const markerGroup = seriesLegend
      .append("g")
      .attr("transform", `translate(0, ${yPos})`)
      .attr("class", "series-legend-item");

    // Draw cross
    const crossSize = markerR * 1.2;
    markerGroup
      .append("line")
      .attr("x1", -crossSize)
      .attr("y1", -crossSize)
      .attr("x2", crossSize)
      .attr("y2", crossSize)
      .attr("stroke", globalSettings.textColorDark)
      .attr("stroke-width", 1.5);
    markerGroup
      .append("line")
      .attr("x1", crossSize)
      .attr("y1", -crossSize)
      .attr("x2", -crossSize)
      .attr("y2", crossSize)
      .attr("stroke", globalSettings.textColorDark)
      .attr("stroke-width", 1.5);

    const text = seriesLegend
      .append("text")
      .attr("x", markerR + 6)
      .attr("y", yPos)
      .attr("dominant-baseline", "middle")
      .attr("fill", globalSettings.textColorDark)
      .text("Cancelled");
    globalSettings.setFont(text, "legend");
  }
}

function createVerticalScatterPlotLegend(
  data,
  g,
  height,
  width,
  xName,
  yName,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { shape = "circle", showRegression = true, showCI = true } = options;
  const radius = 2.5;
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);
  drawLeftAxis(g, height, yMin, yMax, yName);
  drawBottomAxis(g, width, height, xMin, xMax, xName);
  const mainContentGroup = g
    .append("g")
    .attr("class", "main-scatterlegend-content");

  let x = null;
  const isString = typeof data[0].x === "string";
  if (isString) {
    const xDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      xDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    x = d3
      .scalePoint()
      .domain(xDomain)
      .range(xAxisDir === "default" ? [0, width] : [width, 0]);
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

  data = data.length > 10 ? data.filter((_, i) => i % 3 === 2) : data; // Uniformly sample when there are too many points
  const points = data.map((d) => ({ x: x(d.x), y: y(d.y) }));
  drawShape(
    mainContentGroup,
    points,
    radius,
    shape,
    color,
    width * height,
    false,
  );

  if (showRegression && !isString) {
    // Only run linear regression for scaleLinear
    if (showRegression && x.name !== "scalePoint") {
      const numericData = data.map((d) => ({
        x: parseFloat(d.x),
        y: parseFloat(d.y),
      }));
      const regression = calculateLinearRegression(numericData);

      if (regression) {
        // Draw confidence interval if needed
        if (showCI) {
          const ciData = calculateConfidenceInterval(
            numericData,
            regression,
            x,
          ).filter((d) => d.lower >= yMin && d.upper <= yMax);
          if (ciData.length > 0) {
            const area = d3
              .area()
              .x((d) => x(d.x))
              .y0((d) => y(d.lower))
              .y1((d) => y(d.upper));

            // Insert a path element to keep it below points and the regression line
            g.insert("path", ":first-child")
              .datum(ciData)
              .attr("fill", color)
              .attr("opacity", 0.2)
              .attr("d", area);
          }
        }

        // Draw regression line
        const xDomain = x.domain(); // [x0, x1]
        const yDomain = y.domain(); // [y0, y1]

        const x0 = xDomain[0];
        const x1 = xDomain[1];
        const y0 = yDomain[0];
        const y1 = yDomain[1];

        const m = regression.slope;
        const c = regression.intercept;

        // Store intersections between the regression line and plot bounds
        let intersectionPoints = [];

        // 1. Intersection with left boundary (x = x0)
        const yAtX0 = m * x0 + c;
        if (yAtX0 >= y0 && yAtX0 <= y1) {
          intersectionPoints.push({ x: x0, y: yAtX0 });
        }

        // 2. Intersection with right boundary (x = x1)
        const yAtX1 = m * x1 + c;
        if (yAtX1 >= y0 && yAtX1 <= y1) {
          intersectionPoints.push({ x: x1, y: yAtX1 });
        }

        // Only when slope is non-zero can it intersect horizontal boundaries
        if (m !== 0) {
          // 3. Intersection with bottom boundary (y = y0)
          const xAtY0 = (y0 - c) / m;
          if (xAtY0 >= x0 && xAtY0 <= x1) {
            intersectionPoints.push({ x: xAtY0, y: y0 });
          }

          // 4. Intersection with top boundary (y = y1)
          const xAtY1 = (y1 - c) / m;
          if (xAtY1 >= x0 && xAtY1 <= x1) {
            intersectionPoints.push({ x: xAtY1, y: y1 });
          }
        }

        // Filter out duplicates that can arise from floating-point math
        const uniquePoints = Array.from(
          new Set(intersectionPoints.map((p) => JSON.stringify(p))),
        ).map((s) => JSON.parse(s));

        // If there are two or more intersections, the regression line crosses the plot area
        if (uniquePoints.length >= 2) {
          // Use the first two points as segment endpoints
          const p1 = uniquePoints[0];
          const p2 = uniquePoints[1];

          g.append("line")
            .attr("x1", x(p1.x))
            .attr("y1", y(p1.y))
            .attr("x2", x(p2.x))
            .attr("y2", y(p2.y))
            .attr("stroke", color) // Regression line color
            .attr("stroke-width", 2)
            .style("stroke-dasharray", "3,2"); // Render as dashed line
        }

        // add legend
        const textLines = ["95%", "CI"];
        const textGroup = g
          .append("g")
          .attr("class", "legend-text-group")
          .attr("transform", `translate(${x(xDomain[1]) + 5}, ${y(y1) - 6})`);

        textLines.forEach((line, index) => {
          textGroup
            .append("text")
            .attr("x", 0)
            .attr("y", index * 12 * globalSettings.fontRatio) // Adjust line spacing as needed
            .attr("text-anchor", "start")
            .attr("dominant-baseline", "middle")
            .attr("fill", globalSettings.textColorDark)
            .text(line);
        });

        globalSettings.setFont(textGroup.selectAll("text"), "legend");
      }
    }
  }
}

function createHorizontalScatterPlotLegend(
  data,
  g,
  height,
  width,
  xName,
  yName,
  xAxisDir,
  yAxisDir,
  xMin,
  xMax,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { shape = "circle", showRegression = true, showCI = true } = options;
  const radius = 2.5;
  [xMin, xMax, yMin, yMax] = getXyMinMax(data, xMin, xMax, yMin, yMax);
  drawLeftAxis(g, height, xMin, xMax, yName);
  drawBottomAxis(g, width, height, yMin, yMax, xName);
  const mainContentGroup = g
    .append("g")
    .attr("class", "main-scatterlegend-content");

  let y = null;
  const isString = typeof data[0].x === "string";
  if (isString) {
    const yDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      yDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    y = d3
      .scalePoint()
      .domain(yDomain)
      .range(yAxisDir === "default" ? [height, 0] : [0, height]);
  } else {
    y = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range(yAxisDir === "default" ? [height, 0] : [0, height]);
  }

  const x = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(xAxisDir === "default" ? [0, width] : [width, 0]);

  data = data.length > 10 ? data.filter((_, i) => i % 3 === 2) : data; // Uniformly sample when there are too many points
  const points = data.map((d) => ({ x: x(d.y), y: y(d.x) }));
  drawShape(
    mainContentGroup,
    points,
    radius,
    shape,
    color,
    width * height,
    false,
  );

  if (showRegression && !isString) {
    // Only run linear regression for scaleLinear
    if (showRegression && x.name !== "scalePoint") {
      const numericData = data.map((d) => ({
        x: parseFloat(d.y),
        y: parseFloat(d.x),
      }));
      const regression = calculateLinearRegression(numericData);

      if (regression) {
        // Draw confidence interval if needed
        if (showCI) {
          const ciData = calculateConfidenceInterval(
            numericData,
            regression,
            x,
          ).filter((d) => d.lower >= xMin && d.upper <= xMax);
          if (ciData.length > 0) {
            const area = d3
              .area()
              .x((d) => x(d.x))
              .y0((d) => y(d.lower))
              .y1((d) => y(d.upper));

            // Insert a path element to keep it below points and the regression line
            g.insert("path", ":first-child")
              .datum(ciData)
              .attr("fill", color)
              .attr("opacity", 0.2)
              .attr("d", area);
          }
        }

        // Draw regression line
        const xDomain = x.domain(); // [x0, x1]
        const yDomain = y.domain(); // [y0, y1]

        const x0 = xDomain[0];
        const x1 = xDomain[1];
        const y0 = yDomain[0];
        const y1 = yDomain[1];

        const m = regression.slope;
        const c = regression.intercept;

        // Store intersections between the regression line and plot bounds
        let intersectionPoints = [];

        // 1. Intersection with left boundary (x = x0)
        const yAtX0 = m * x0 + c;
        if (yAtX0 >= y0 && yAtX0 <= y1) {
          intersectionPoints.push({ x: x0, y: yAtX0 });
        }

        // 2. Intersection with right boundary (x = x1)
        const yAtX1 = m * x1 + c;
        if (yAtX1 >= y0 && yAtX1 <= y1) {
          intersectionPoints.push({ x: x1, y: yAtX1 });
        }

        // Only when slope is non-zero can it intersect horizontal boundaries
        if (m !== 0) {
          // 3. Intersection with bottom boundary (y = y0)
          const xAtY0 = (y0 - c) / m;
          if (xAtY0 >= x0 && xAtY0 <= x1) {
            intersectionPoints.push({ x: xAtY0, y: y0 });
          }

          // 4. Intersection with top boundary (y = y1)
          const xAtY1 = (y1 - c) / m;
          if (xAtY1 >= x0 && xAtY1 <= x1) {
            intersectionPoints.push({ x: xAtY1, y: y1 });
          }
        }

        // Filter out duplicates that can arise from floating-point math
        const uniquePoints = Array.from(
          new Set(intersectionPoints.map((p) => JSON.stringify(p))),
        ).map((s) => JSON.parse(s));

        // If there are two or more intersections, the regression line crosses the plot area
        if (uniquePoints.length >= 2) {
          // Use the first two points as segment endpoints
          const p1 = uniquePoints[0];
          const p2 = uniquePoints[1];

          g.append("line")
            .attr("x1", x(p1.x))
            .attr("y1", y(p1.y))
            .attr("x2", x(p2.x))
            .attr("y2", y(p2.y))
            .attr("stroke", color) // Regression line color
            .attr("stroke-width", 2)
            .style("stroke-dasharray", "3,2"); // Render as dashed line
        }

        // add legend
        const textLines = ["95%", "CI"];
        const textGroup = g
          .append("g")
          .attr("class", "legend-text-group")
          .attr("transform", `translate(${x(xDomain[1]) + 5}, ${y(y1) - 6})`);

        textLines.forEach((line, index) => {
          textGroup
            .append("text")
            .attr("x", 0)
            .attr("y", index * 12 * globalSettings.fontRatio) // Adjust line spacing as needed
            .attr("text-anchor", "start")
            .attr("dominant-baseline", "middle")
            .attr("fill", globalSettings.textColorDark)
            .text(line);
        });

        globalSettings.setFont(textGroup.selectAll("text"), "legend");
      }
    }
  }
}

/**
 * Create a pie chart legend explaining x and y.
 * @param {Array} data - Data array.
 * @param {Object} g - SVG group element.
 * @param {string} xName - X-axis name (category).
 * @param {string} yName - Y-axis name (value).
 * @param {Array} order - Ordering.
 * @param {*} color - Color.
 * @param {Object} options - Options.
 */
function createPieChartLegend(
  data,
  g,
  xName,
  yName,
  order,
  color,
  options = {},
) {
  const legendGroup = g.append("g").attr("class", "pie-legend");

  // Styling
  const config = {
    fontSize: globalSettings.getFontSize("value") + 2,
    lineHeight: 20,
    color: globalSettings.textColorDark,
    spacing: 10,
    iconRadius: 12 * globalSettings.fontRatio,
  };

  // Title styling
  const xNameCapitalized = xName.charAt(0).toUpperCase() + xName.slice(1);
  const yNameCapitalized = yName.charAt(0).toUpperCase() + yName.slice(1);

  // Build small pie data using actual values
  const dataCount = Math.min(data.length, 5); // Cap at 5 slices to avoid over-complexity
  const pieData = [];
  for (let i = 0; i < dataCount; i++) {
    // Use the actual y value; fall back to a default if missing
    const value = data[i]?.y || 3 - i * 0.5;
    pieData.push(Math.max(value, 0.1)); // Ensure the value is not 0 or negative
  }
  // If there's no data, default to 3 slices
  if (pieData.length === 0) {
    pieData.push(3, 2, 1);
  }
  const pie = d3.pie();
  // Check inner radius info to decide whether to render a donut-style legend
  const innerRadiusRatio =
    options.innerRadius && options.outerRadius
      ? Math.min(options.innerRadius / options.outerRadius, 0.6)
      : 0;
  const legendInnerRadius = innerRadiusRatio * config.iconRadius;
  const arc = d3
    .arc()
    .innerRadius(legendInnerRadius)
    .outerRadius(config.iconRadius);

  const colorScale = typeof color === "function" ? color : () => color;
  const pieColors = [];
  for (let i = 0; i < pieData.length; i++) {
    if (data[i]?.x && typeof color === "function") {
      pieColors.push(colorScale(data[i].x) || `hsl(${i * 60}, 70%, 50%)`);
    } else {
      // Use the default color sequence
      const defaultColors = [
        "#1f77b4",
        "#ff7f0e",
        "#2ca02c",
        "#d62728",
        "#9467bd",
      ];
      pieColors.push(defaultColors[i % defaultColors.length]);
    }
  }

  // Pie icon group (on the left, starting from x=0)
  const iconGroup = legendGroup
    .append("g")
    .attr("class", "pie-icon")
    .attr("transform", `translate(0, ${config.iconRadius})`);

  iconGroup
    .selectAll("path")
    .data(pie(pieData))
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", (d, i) => pieColors[i] || "#999")
    .attr("stroke", config.color)
    .attr("stroke-width", 1);

  // Text group (to the right of the icon)
  const textGroup = legendGroup
    .append("g")
    .attr("class", "text-group")
    .attr("transform", `translate(${config.iconRadius * 2}, 0)`);

  // X-axis label (category)
  const xLegendText = textGroup
    .append("text")
    .attr("x", 0)
    .attr("y", config.iconRadius - 5 * globalSettings.fontRatio)
    .attr("fill", config.color)
    .attr("dominant-baseline", "middle")
    .text(`X: ${xNameCapitalized}`);

  globalSettings.setFont(xLegendText, "legend");

  // Y-axis label (value)
  const yLegendText = textGroup
    .append("text")
    .attr("x", 0)
    .attr("y", config.iconRadius + 10 * globalSettings.fontRatio)
    .attr("fill", config.color)
    .attr("dominant-baseline", "middle")
    .text(`Y: ${yNameCapitalized}`);

  globalSettings.setFont(yLegendText, "legend");
}

function createMapLegend(g, height, width, color, colorName) {
  const colorBarHeight = 15;
  if (color) {
    const domain = color.domain();

    const padding =
      globalSettings.format(domain[0]).length * globalSettings.valueCharWidth;

    const legendGroup = g
      .append("g")
      .attr("class", "map-legend")
      .attr("transform", `translate(${padding}, 0)`);

    drawBottomAxis(
      legendGroup,
      width,
      colorBarHeight,
      domain[0],
      domain[1],
      colorName,
    );

    // Draw color bar
    const colorBarWidth = width; // Leave some space for text
    const colorBarGroup = legendGroup.append("g").attr("class", "color-bar");

    // Create the color bar rectangle
    colorBarGroup
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", colorBarWidth)
      .attr("height", colorBarHeight)
      .attr("fill", "url(#gradient)");

    // Create gradient definition
    const gradient = legendGroup
      .append("defs")
      .append("linearGradient")
      .attr("id", "gradient")
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "100%")
      .attr("y2", "0%");

    // Add color stops
    domain.forEach((d, i) => {
      gradient
        .append("stop")
        .attr("offset", `${(i / (domain.length - 1)) * 100}%`)
        .attr("stop-color", color(d));
    });

    globalSettings.setFont(legendGroup.selectAll("text"), "legend");
    globalSettings.setFont(legendGroup.selectAll("rect"), "legend");
  }
}
