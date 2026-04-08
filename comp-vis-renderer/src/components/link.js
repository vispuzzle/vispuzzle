import * as d3 from "d3";
import { axisCartesianLink } from "./axis.js";
import { createLinkPath } from "./elements.js";
import { globalSettings } from "../core/global.js";

/**
 * Compute axis segment info for a link chart
 * @param {function} scale - D3 scale function
 * @param {Object} options - Options
 * @returns {Array} Array of segment info
 */
function calculateLinkAxisSegments(scale, options = {}) {
  // Get or set the color function
  const colorMap = options.color || (() => globalSettings.textColorDark);

  // Get the scale domain
  const domain = scale.domain();

  // Create segments array
  const segments = [];

  // Use precise position info (groupInfo) to compute each segment's start and end
  if (options.groupInfo && options.groupInfo.length === domain.length) {
    // Precise position info is provided
    for (let i = 0; i < domain.length; i++) {
      const value = domain[i];
      const [start, end] = options.groupInfo[i]; // Get start/end from groupInfo

      segments.push({
        start: start,
        end: end,
        value: value,
        color: colorMap(value) ? colorMap(value) : globalSettings.textColorDark,
      });
    }
  } else {
    // No precise position info; fall back to even allocation
    const range = scale.range();
    const rangeSize = Math.abs(range[1] - range[0]);
    const segmentSize = rangeSize / domain.length;

    for (let i = 0; i < domain.length; i++) {
      segments.push({
        start: range[0] + i * segmentSize,
        end: range[0] + (i + 1) * segmentSize,
        value: domain[i],
        color: colorMap(domain[i])
          ? colorMap(domain[i])
          : globalSettings.textColorDark,
      });
    }
  }

  return segments;
}

/**
 * Draw axis segments for a link chart
 * @param {Object} g - D3 selection
 * @param {string} pos - Axis position ("left", "right", "top", "bottom")
 * @param {Array} segments - Axis segment data
 * @param {number} width - Available width
 * @param {number} height - Available height
 */
export function drawLinkAxisSegments(g, pos, segments, width, height) {
  if (pos.includes("_noname")) {
    pos = pos.replace("_noname", "");
  }

  const isHorizontal = pos === "top" || pos === "bottom";

  // Axis line style
  const axisLineWidth = 1.0;
  const axisLineOpacity = 0.9; // Opacity

  // Create axis segment group
  let axisGroup = g.append("g").attr("class", "link-axis-segments");

  // Apply transform based on position
  if (pos === "bottom") {
    axisGroup.attr("transform", `translate(0, ${height})`);
  } else if (pos === "right") {
    axisGroup.attr("transform", `translate(${width}, 0)`);
  }
  const padding = pos === "bottom" || pos === "right" ? 3 : -3;
  // Draw each axis segment
  segments.forEach((segment) => {
    if (isHorizontal) {
      // Horizontal axis segment
      const x1 = segment.start;
      const x2 = segment.end;
      const y = 0; // Axis line position

      // Create axis segment
      axisGroup
        .append("line")
        .attr("class", "domain-segment")
        .attr("x1", x1)
        .attr("y1", y + padding)
        .attr("x2", x2)
        .attr("y2", y + padding)
        .attr("stroke", segment.color)
        .attr("stroke-width", axisLineWidth)
        .attr("stroke-linecap", "round")
        .attr("opacity", axisLineOpacity);
    } else {
      // Vertical axis segment
      const y1 = segment.start;
      const y2 = segment.end;
      const x = 0; // Axis line position

      // Create axis segment
      axisGroup
        .append("line")
        .attr("class", "domain-segment")
        .attr("x1", x + padding)
        .attr("y1", y1)
        .attr("x2", x + padding)
        .attr("y2", y2)
        .attr("stroke", segment.color)
        .attr("stroke-width", axisLineWidth)
        .attr("stroke-linecap", "round")
        .attr("opacity", axisLineOpacity);
    }
  });

  return axisGroup;
}

export function createVerticalLinkChart(
  data,
  g,
  height,
  width,
  width2 = width,
  operationPos,
  xAxisPos,
  xAxisDir,
  xAxisPos2,
  xAxisDir2,
  order,
  order2,
  color = "steelblue",
  colorMapping = "x",
  vlabel = false,
  vlabel2 = false,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    icons,
    xName,
    labelName,
  } = options || {};

  let icons1 = null;
  let icons2 = null;

  if (icons) {
    if (xName && icons[xName]) icons1 = icons[xName];
    if (labelName && icons[labelName]) icons2 = icons[labelName];
  }

  if (d3.min(data, (d) => d.y) < 0) {
    throw new Error("y value must be non-negative");
  }

  g = g.attr("width", width).attr("height", height).append("g");

  const xDomain = Array.from(new Set(data.map((d) => d.x)));
  const labelDomain = Array.from(new Set(data.map((d) => d.label)));

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    xDomain.sort((a, b) => orderMap.get(a) - orderMap.get(b));
  }

  if (Array.isArray(order2)) {
    const orderMap = new Map(order2.map((item, index) => [item, index]));
    labelDomain.sort((a, b) => orderMap.get(a) - orderMap.get(b));
  }

  const x1 = d3
    .scaleBand()
    .domain(xDomain)
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const l = (width - width2) / 2;
  const r = (width + width2) / 2;

  const x2 = d3
    .scaleBand()
    .domain(labelDomain)
    .range(xAxisDir2 === "default" ? [l, r] : [r, l])
    .paddingInner(padding)
    .paddingOuter(0);

  const [y1, y2] = operationPos === "bottom" ? [height, 0] : [0, height];
  const segmentMargin = 10;
  let maxStrokeWidth =
    Math.min(width, width2) / Math.max(x1.domain().length, x2.domain().length) -
    segmentMargin;
  maxStrokeWidth = Math.min(50, maxStrokeWidth) * 0.5; // Cap the max width
  const yMax = d3.max(data, (d) => d.y);
  const strokeScale = maxStrokeWidth / yMax;

  data.forEach((d) => {
    d.strokeWidth = d.y * strokeScale;
  });

  const colorScale = typeof color === "function" ? color : () => color;

  // Pre-calculate Start (x1) Positions
  const xStartPositions = new Map(); // Map<xValue, { totalWidth: number, items: d[] }>
  data.forEach((d) => {
    if (!xStartPositions.has(d.x)) {
      xStartPositions.set(d.x, { totalWidth: 0, items: [] });
    }
    const entry = xStartPositions.get(d.x);
    entry.items.push(d);
  });

  // Sort items within each x group (e.g., by label order) for consistent placement
  xStartPositions.forEach((entry) => {
    entry.items.sort(
      (a, b) => labelDomain.indexOf(a.label) - labelDomain.indexOf(b.label),
    ); // Sort by the order of the *other* axis
    let currentX = 0;
    entry.items.forEach((d, index) => {
      d.xStartOffset = currentX + d.strokeWidth / 2; // Store the offset within the group's total width
      currentX += d.strokeWidth;
      // Add spacing except for the last element
      if (index < entry.items.length - 1) {
        currentX += 1; // Add 1px gap
      }
    });
    // Update total width to include gaps
    entry.totalWidth = currentX;
  });

  // Pre-calculate End (x2) Positions
  const xEndPositions = new Map(); // Map<labelValue, { totalWidth: number, items: d[] }>
  data.forEach((d) => {
    if (!xEndPositions.has(d.label)) {
      xEndPositions.set(d.label, { totalWidth: 0, items: [] });
    }
    const entry = xEndPositions.get(d.label);
    entry.items.push(d);
  });

  // Sort items within each label group (e.g., by x order)
  xEndPositions.forEach((entry) => {
    entry.items.sort((a, b) => xDomain.indexOf(a.x) - xDomain.indexOf(b.x)); // Sort by the order of the *other* axis
    let currentX = 0;
    entry.items.forEach((d, index) => {
      d.xEndOffset = currentX + d.strokeWidth / 2; // Store the offset within the group's total width
      currentX += d.strokeWidth;
      // Add spacing except for the last element
      if (index < entry.items.length - 1) {
        currentX += 1; // Add 1px gap
      }
    });
    // Update total width to include gaps
    entry.totalWidth = currentX;
  });

  const groupX1Info = x1.domain().map((d) => {
    return [
      x1(d) + x1.bandwidth() / 2 - xStartPositions.get(d).totalWidth / 2,
      x1(d) + x1.bandwidth() / 2 + xStartPositions.get(d).totalWidth / 2,
    ];
  });
  const groupX2Info = x2.domain().map((d) => {
    return [
      x2(d) + x2.bandwidth() / 2 - xEndPositions.get(d).totalWidth / 2,
      x2(d) + x2.bandwidth() / 2 + xEndPositions.get(d).totalWidth / 2,
    ];
  });

  data.forEach((d) => {
    // Compute start position in stacked mode
    const groupStartXInfo = xStartPositions.get(d.x);
    const bandStartX = x1(d.x);
    const bandWidthX = x1.bandwidth();
    // Store start coordinates
    d.startX =
      bandStartX +
      bandWidthX / 2 -
      groupStartXInfo.totalWidth / 2 +
      d.xStartOffset;
    d.startY = y1;

    // Compute end position in stacked mode
    const groupEndXInfo = xEndPositions.get(d.label);
    const bandEndX = x2(d.label);
    const bandWidthLabel = x2.bandwidth();
    // Store end coordinates
    d.endX =
      bandEndX +
      bandWidthLabel / 2 -
      groupEndXInfo.totalWidth / 2 +
      d.xEndOffset;
    d.endY = y2;
  });

  const linkGroup = g.append("g").attr("class", "links");

  // Sort in drawing order: first by x-domain order, then by label-domain order
  const sortedData = data
    .filter((d) => d.y > 0)
    .sort((a, b) => {
      // Sort by x-domain order first
      const xIndexA = xDomain.indexOf(a.x);
      const xIndexB = xDomain.indexOf(b.x);
      if (xIndexA !== xIndexB) {
        return xIndexA - xIndexB;
      }
      // If x is the same, sort by label-domain order
      const labelIndexA = labelDomain.indexOf(a.label);
      const labelIndexB = labelDomain.indexOf(b.label);
      return labelIndexA - labelIndexB;
    });

  sortedData.forEach((d) => {
    createLinkPath(
      linkGroup,
      d.startX,
      d.startY,
      d.endX,
      d.endY,
      d.strokeWidth,
      colorScale(colorMapping === "label" ? d.label : d.x),
      style,
      0.65,
      "vertical",
      false,
    );
  });

  const segments1 = calculateLinkAxisSegments(x1, {
    color: colorScale,
    groupInfo: groupX1Info,
  });

  const segments2 = calculateLinkAxisSegments(x2, {
    color: colorScale,
    groupInfo: groupX2Info,
  });

  const oppositePos = operationPos === "top" ? "bottom" : "top";
  drawLinkAxisSegments(g, operationPos, segments1, width, height);
  drawLinkAxisSegments(g, oppositePos, segments2, width, height);

  // Then draw axis ticks and labels
  if (xAxisPos !== "none") {
    axisCartesianLink(g, xAxisPos, width, height, segments1, {
      vlabel: vlabel,
      icons: icons1,
      border: options.border,
    });
  }
  if (xAxisPos2 !== "none") {
    axisCartesianLink(g, xAxisPos2, width2, height, segments2, {
      vlabel: vlabel2,
      icons: icons2,
      border: options.border,
    });
  }
}

/**
 * Create a horizontal link chart.
 * @param {Array} data - Link data array.
 * @param {Object} g - D3 selection container.
 * @param {number} width - Chart width.
 * @param {number} height - Chart height.
 * @param {number} height2 - Height of the right/left side (defaults to height).
 * @param {string} yAxisPos - Y-axis position ("left" or "right").
 * @param {string} yAxisDir - Y-axis direction ("default" or "reverse").
 * @param {Array} order - Ordering for the left side.
 * @param {Array} order2 - Ordering for the right side.
 * @param {string|function} color - Color or color function.
 * @param {number} padding - Inner padding.
 */
export function createHorizontalLinkChart(
  data,
  g,
  width,
  height,
  height2 = height,
  operationPos,
  yAxisPos,
  yAxisDir,
  yAxisPos2,
  yAxisDir2,
  order,
  order2,
  color = "steelblue",
  colorMapping = "x",
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    icons,
    xName,
    labelName,
  } = options || {};

  let icons1 = null;
  let icons2 = null;

  if (icons) {
    if (xName && icons[xName]) icons1 = icons[xName];
    if (labelName && icons[labelName]) icons2 = icons[labelName];
  }

  if (d3.min(data, (d) => d.y) < 0) {
    throw new Error("y value must be non-negative");
  }

  g = g.attr("width", width).attr("height", height).append("g");

  const xDomain = Array.from(new Set(data.map((d) => d.x)));
  const labelDomain = Array.from(new Set(data.map((d) => d.label)));

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    xDomain.sort((a, b) => orderMap.get(a) - orderMap.get(b));
  }

  if (Array.isArray(order2)) {
    const orderMap = new Map(order2.map((item, index) => [item, index]));
    labelDomain.sort((a, b) => orderMap.get(a) - orderMap.get(b));
  }

  // Band scale on the vertical axis (analogous to the x-scale in the vertical chart)
  const y1 = d3
    .scaleBand()
    .domain(xDomain)
    .range(yAxisDir === "default" ? [0, height] : [height, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const t = (height - height2) / 2;
  const b = (height + height2) / 2;

  const y2 = d3
    .scaleBand()
    .domain(labelDomain)
    .range(yAxisDir2 === "default" ? [t, b] : [b, t])
    .paddingInner(padding)
    .paddingOuter(0);

  // Horizontal positions depend on axis position
  const x1 = operationPos === "left" ? 0 : width;
  const x2 = operationPos === "left" ? width : 0;
  const segmentMargin = 10;
  let maxStrokeWidth =
    Math.min(height, height2) /
      Math.max(y1.domain().length, y2.domain().length) -
    segmentMargin;
  maxStrokeWidth = Math.min(50, maxStrokeWidth) * 0.5; // Cap max width
  const yMax = d3.max(data, (d) => d.y);
  const strokeScale = maxStrokeWidth / yMax;

  data.forEach((d) => {
    d.strokeWidth = d.y * strokeScale;
  });

  const colorScale = typeof color === "function" ? color : () => color;

  // Compute start positions (vertical)
  const yStartPositions = new Map();
  data.forEach((d) => {
    if (!yStartPositions.has(d.x)) {
      yStartPositions.set(d.x, { totalWidth: 0, items: [] });
    }
    const entry = yStartPositions.get(d.x);
    entry.items.push(d);
  });

  // Sort items within each start group
  yStartPositions.forEach((entry) => {
    entry.items.sort(
      (a, b) => labelDomain.indexOf(a.label) - labelDomain.indexOf(b.label),
    );
    let currentY = 0;
    entry.items.forEach((d, index) => {
      d.yStartOffset = currentY + d.strokeWidth / 2;
      currentY += d.strokeWidth;
      // Add spacing except for the last item
      if (index < entry.items.length - 1) {
        currentY += 1; // Add a 1px gap
      }
    });
    // Update total width to include spacing
    entry.totalWidth = currentY;
  });

  // Compute end positions
  const yEndPositions = new Map();
  data.forEach((d) => {
    if (!yEndPositions.has(d.label)) {
      yEndPositions.set(d.label, { totalWidth: 0, items: [] });
    }
    const entry = yEndPositions.get(d.label);
    entry.items.push(d);
  });

  // Sort items within each end group
  yEndPositions.forEach((entry) => {
    entry.items.sort((a, b) => xDomain.indexOf(a.x) - xDomain.indexOf(b.x));
    let currentY = 0;
    entry.items.forEach((d, index) => {
      d.yEndOffset = currentY + d.strokeWidth / 2;
      currentY += d.strokeWidth;
      // Add spacing except for the last item
      if (index < entry.items.length - 1) {
        currentY += 1; // Add a 1px gap
      }
    });
    // Update total width to include spacing
    entry.totalWidth = currentY;
  });

  // Compute group ranges for axis rendering
  const groupY1Info = y1.domain().map((d) => {
    return [
      y1(d) + y1.bandwidth() / 2 - yStartPositions.get(d).totalWidth / 2,
      y1(d) + y1.bandwidth() / 2 + yStartPositions.get(d).totalWidth / 2,
    ];
  });

  const groupY2Info = y2.domain().map((d) => {
    return [
      y2(d) + y2.bandwidth() / 2 - yEndPositions.get(d).totalWidth / 2,
      y2(d) + y2.bandwidth() / 2 + yEndPositions.get(d).totalWidth / 2,
    ];
  });

  data.forEach((d) => {
    // Compute start/end positions in stacked mode
    const groupStartYInfo = yStartPositions.get(d.x);
    const bandStartY = y1(d.x);
    const bandHeightX = y1.bandwidth();

    d.startX = x1;
    d.startY =
      bandStartY +
      bandHeightX / 2 -
      groupStartYInfo.totalWidth / 2 +
      d.yStartOffset;

    const groupEndYInfo = yEndPositions.get(d.label);
    const bandEndY = y2(d.label);
    const bandHeightLabel = y2.bandwidth();

    d.endX = x2;
    d.endY =
      bandEndY +
      bandHeightLabel / 2 -
      groupEndYInfo.totalWidth / 2 +
      d.yEndOffset;
  });

  const linkGroup = g.append("g").attr("class", "links");

  // Sort in drawing order: first by x-domain order, then by label-domain order
  const sortedData = data
    .filter((d) => d.y > 0)
    .sort((a, b) => {
      // Sort by x-domain order first
      const xIndexA = xDomain.indexOf(a.x);
      const xIndexB = xDomain.indexOf(b.x);
      if (xIndexA !== xIndexB) {
        return xIndexA - xIndexB;
      }
      // If x is the same, sort by label-domain order
      const labelIndexA = labelDomain.indexOf(a.label);
      const labelIndexB = labelDomain.indexOf(b.label);
      return labelIndexA - labelIndexB;
    });

  sortedData.forEach((d) => {
    createLinkPath(
      linkGroup,
      d.startX,
      d.startY,
      d.endX,
      d.endY,
      d.strokeWidth,
      colorScale(colorMapping === "label" ? d.label : d.x),
      style,
      0.65,
      "horizontal",
      false,
    );
  });

  const segments = calculateLinkAxisSegments(y1, {
    color: colorScale,
    groupInfo: groupY1Info,
    tickValues: xDomain,
  });
  const segments2 = calculateLinkAxisSegments(y2, {
    color: colorScale,
    groupInfo: groupY2Info,
    tickValues: labelDomain,
  });
  const oppositePos = operationPos === "left" ? "right" : "left";
  drawLinkAxisSegments(g, operationPos, segments, width, height);
  drawLinkAxisSegments(g, oppositePos, segments2, width, height2);
  // Add axes
  if (yAxisPos !== "none") {
    axisCartesianLink(g, yAxisPos, width, height, segments, {
      icons: icons1,
      border: options.border,
    });
  }
  if (yAxisPos2 !== "none") {
    axisCartesianLink(g, yAxisPos2, width, height2, segments2, {
      icons: icons2,
      border: options.border,
    });
  }
}
