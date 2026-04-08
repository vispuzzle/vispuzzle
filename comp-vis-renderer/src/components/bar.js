import * as d3 from "d3";
import {
  createCartesianBar,
  createPolarBar,
  createCircle,
} from "./elements.js";
import { adjustScaleFactor, getTextColor } from "../utils/vis.js";
import { checkAllInteger, enhanceTickValues } from "../utils/maths.js";
import {
  axisPolar,
  axisCartesian,
  axisRadialInner,
  axisRadialOuter,
  addCartesianBaseline,
  addPolarBaseline,
} from "./axis.js";
import { createAngularRefLine, createRadialRefLine } from "./refline.js";
import { globalSettings } from "../core/global.js";

const approxCharWidth = globalSettings.valueCharWidth;

function getXLabelPositions(data, x, height, pos) {
  if (pos !== "top") pos = "bottom"; // If it's not top, default to bottom

  const offset = 30;

  let returnValues = {};
  data.forEach((d) => {
    returnValues[d.x] = {
      x: x(d.x) + x.bandwidth() / 2,
      y: pos === "top" ? 0 - offset : height + offset,
    };
  });
  return returnValues;
}

function getYLabelPositions(data, y, width, pos, yAxisPos = null) {
  if (pos !== "right") pos = "left"; // If it's not right, default to left

  const maxCharLen = Math.max(...data.map((d) => d.x.length));
  const axisHidden = yAxisPos === "none";
  const edgeOffset = axisHidden
    ? 10
    : maxCharLen * globalSettings.valueCharWidth * 0.9;

  let returnValues = {};
  data.forEach((d) => {
    returnValues[d.x] = {
      x: pos === "left" ? 0 - edgeOffset : width + edgeOffset,
      y: y(d.x) + y.bandwidth() / 2,
    };
  });
  return returnValues;
}

/**
 * Creates a vertical bar chart with configurable axis directions.
 *
 * @param {Object[]} data - The data to render in the chart.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - The direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - The direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The minimum value of the y-field range.
 * @param {number} yMax - The maximum value of the y-field range.
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createVerticalBarChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  // parse additional options
  let {
    style = "default",
    showBaseline = true,
    showValues = true,
    autoAdjust = true,
    padding = 0.3,
    showBcgBar = false,
    returns = null,
  } = options || {};
  const { pos = null } = returns || {};

  if (showBcgBar && width * height <= 40000) showBcgBar = false;

  // Change triangle style based on yAxisDir
  if (style === "triangle") {
    style = yAxisDir === "default" ? "triangle-up" : "triangle-down";
  } else if (style === "round") {
    style = yAxisDir === "default" ? "round-up" : "round-down";
  }

  if (!yMin) yMin = 0;
  if (!yMax) yMax = d3.max(data, (d) => d.y);
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  g = g.attr("width", width).attr("height", height).append("g");

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const colorScale = typeof color === "function" ? color : () => color;

  // Define the x-scale (categorical)
  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.x)) // Use x values from data
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  // Define the y-scale (linear)
  const y = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(yAxisDir === "default" ? [height, 0] : [0, height]); // Flip the range based on direction

  const yBaselineValue = Math.max(0, yMin);
  const y0 = y(yBaselineValue); // Get the y-position of the baseline

  // Add baseline if 0 is within the y-axis domain
  if (!(yMin === 0 && xAxisPos !== "none")) {
    addCartesianBaseline(g, y, width, height, "vertical");
  }

  // Append the bars
  const barsGroup = g.append("g").attr("class", "bars-group");
  data.forEach((d) => {
    const barGroup = barsGroup.append("g").attr("class", "single-bar");
    // Calculate position and size
    const left = x(d.x);
    const barWidth = x.bandwidth();
    let top, barHeight;

    // Adjust position based on y-axis direction and data value
    if (yAxisDir === "default") {
      top = d.y >= yBaselineValue ? y(d.y) : y0;
    } else {
      top = d.y >= yBaselineValue ? y0 : y(d.y);
    }

    // Calculate height
    barHeight = Math.abs(y(d.y) - y0);

    if (showBcgBar) {
      createCartesianBar(
        barGroup,
        left,
        0,
        barWidth,
        height,
        colorScale(d.x),
        "background",
      );
    }

    createCartesianBar(
      barGroup,
      left,
      top,
      barWidth,
      barHeight,
      colorScale(d.x),
      style,
    );

    // Check whether the value text can fit
    const testValue = d3.max(y.domain());
    const textText = globalSettings.format(testValue);
    if (
      textText.length * globalSettings.getFontSize("value") * 0.6 + 4 >
      barWidth
    ) {
      showValues = false;
    }

    // avoid showing both values and baseline
    if (showValues && showBaseline) {
      showBaseline = false;
    }

    if (showBaseline && yMin >= 0) {
      const midX = left + barWidth / 2;
      const yPos = yAxisDir === "default" ? 0 : height;
      barGroup
        .append("line")
        .attr("x1", midX)
        .attr("x2", midX)
        .attr("y1", 0)
        .attr("y2", height);
      barGroup
        .append("line")
        .attr("x1", midX - barWidth / 4)
        .attr("x2", midX + barWidth / 4)
        .attr("y1", yPos)
        .attr("y2", yPos);
      barGroup
        .selectAll("line")
        .attr("stroke", globalSettings.helperColor)
        .attr("stroke-width", Math.max(barWidth / 10, 1))
        .attr("opacity", 0.8);
    }

    if (showValues) {
      let yPos = yAxisDir === "default" ? top - 12 : top + barHeight + 12;
      let color = globalSettings.textColorDark;

      const text = globalSettings.format(d.y);
      if (
        approxCharWidth + barHeight + 10 > height &&
        approxCharWidth + 10 < barHeight &&
        autoAdjust
      ) {
        // If the text doesn't fit beside the bar, place it inside the bar
        yPos = yAxisDir === "default" ? top + 10 : top + barHeight - 10;
        color = getTextColor(colorScale(d.x));
      } else if (!autoAdjust && style.startsWith("round")) {
        yPos += yAxisDir === "default" ? -barWidth / 2 : barWidth / 2;
      }

      const textElement = barsGroup.append("text");
      textElement
        .attr("class", "bar-value")
        .attr("x", left + barWidth / 2)
        .attr("y", yPos)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("font-weight", "bold") // Force bold
        .style("fill", color)
        .text(text);
      globalSettings.setFont(textElement, "value");
    }
  });

  const verticalIcons = options?.icons?.[options?.xName];
  let drawVerticalImageIcons = false;
  if (style?.startsWith("round-solid") && verticalIcons) {
    const hasAnyIcon = Object.values(verticalIcons).some(
      (iconUrl) => !!iconUrl,
    );
    if (hasAnyIcon) {
      const groupKey = `image-icons::${String(options?.xName || "default")}`;
      if (!globalSettings.hasImageIconGroup(groupKey)) {
        globalSettings.registerImageIconGroup(groupKey);
        drawVerticalImageIcons = true;
      }
    }
  }

  if (drawVerticalImageIcons) {
    const iconSize = Math.max(
      globalSettings.getFontSize("value"),
      Math.min(x.bandwidth(), globalSettings.getFontSize("value") * 1.8),
    );
    data.forEach((d) => {
      const iconUrl = verticalIcons[d.x];
      if (!iconUrl) return;

      const left = x(d.x);
      const barWidth = x.bandwidth();
      const top = yAxisDir === "default" ? y(d.y) : y0;
      const barHeight = Math.abs(y(d.y) - y0);

      barsGroup
        .append("image")
        .attr("x", left + barWidth / 2 - iconSize / 2)
        .attr("y", top + barHeight - iconSize)
        .attr("width", iconSize)
        .attr("height", iconSize)
        .attr("xlink:href", iconUrl)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("opacity", 0.9)
        .style("pointer-events", "none");
    });
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  const axisIcons = options?.icons?.[options?.xName] || null;

  // Add the x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "x", {
      chartType: "bar",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
      icons: axisIcons,
    });
  }

  // Add the y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "y", {
      chartType: "bar",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  if (style === "shadow") {
    // Translate all elements
    const offsetY = height / 2;
    const prevTransform = g.attr("transform") || "";
    let newTransform = prevTransform.trim();
    const translateRegex = /translate\(([^)]+)\)/;
    if (translateRegex.test(newTransform)) {
      newTransform = newTransform.replace(translateRegex, (match, p1) => {
        const [x = 0, y = 0] = p1.split(",").map(Number);
        return `translate(${x}, ${y - offsetY})`;
      });
    } else {
      newTransform = `${newTransform} translate(0, ${-offsetY})`.trim();
    }
    g.attr("transform", newTransform);
  }

  if (returns) {
    return getXLabelPositions(data, x, height, pos);
  }
}

/**
 * Creates a rotated bar chart (horizontal bars).
 *
 * @param {Object[]} data - The data to render in the chart.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - The direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - The direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The minimum value of the y-field range.
 * @param {number} yMax - The maximum value of the y-field range.
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createHorizontalBarChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  // parse additional options
  let {
    style = "default",
    showBaseline = true,
    showValues = true,
    autoAdjust = true,
    padding = 0.3,
    showBcgBar = false,
    returns = null,
  } = options || {};
  const { pos = null } = returns || {};

  if (showBcgBar && width * height <= 40000) showBcgBar = false;

  // Change triangle style based on xAxisDir
  if (style === "triangle") {
    style = xAxisDir === "default" ? "triangle-right" : "triangle-left";
  } else if (style === "round") {
    style = xAxisDir === "default" ? "round-right" : "round-left";
  } else if (style === "round-solid") {
    style += xAxisDir === "default" ? "-right" : "-left";
  } else if (style === "round-with-sketch") {
    style += xAxisDir === "default" ? "-right" : "-left";
    showValues = false;
    showBaseline = false;
  } else if (style === "isotype") {
    style = "isotype-horizontal";
    // showValues = false;
    showBaseline = false;
  }

  if (!yMin) yMin = 0;
  if (!yMax) yMax = d3.max(data, (d) => d.y);
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  g = g.attr("width", width).attr("height", height).append("g");

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const colorScale = typeof color === "function" ? color : () => color;

  // Define the y scale (categorical, vertical direction)
  const y = d3
    .scaleBand()
    .domain(data.map((d) => d.x)) // Each x value becomes a band
    .range(yAxisDir === "default" ? [0, height] : [height, 0]) // Flip the range based on direction
    .paddingInner(padding)
    .paddingOuter(0);

  // Define the x scale (linear, horizontal direction)
  const x = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(xAxisDir === "default" ? [0, width] : [width, 0]); // Flip the range based on direction

  const xBaselineValue = Math.max(0, yMin);
  const x0 = x(xBaselineValue); // Get the x-position of the baseline

  // Add baseline if 0 is within the x-axis domain
  if (!(yMin === 0 && yAxisPos !== "none") && !style.startsWith("isotype")) {
    addCartesianBaseline(g, x, width, height, "horizontal");
  }

  // Append the bars
  const barsGroup = g.append("g").attr("class", "bars-group");
  data.forEach((d) => {
    const barGroup = barsGroup.append("g").attr("class", "single-bar");
    // Calculate position and size
    const top = y(d.x);
    const barHeight = y.bandwidth();
    let left, barWidth;

    // Adjust position based on x-axis direction and data value
    if (xAxisDir === "default") {
      left = d.y >= xBaselineValue ? x0 : x(d.y);
    } else {
      left = d.y >= xBaselineValue ? x(d.y) : x0;
    }

    // Calculate width
    barWidth = Math.abs(x(d.y) - x0);

    if (showBcgBar) {
      createCartesianBar(
        barGroup,
        0,
        top,
        width,
        barHeight,
        colorScale(d.x),
        "background",
      );
    }

    // for isotype, first decide which icon to choose (currently support man/woman)
    let _style = style;
    if (style === "isotype-horizontal") {
      const isotype = d.x === "F" ? "woman" : "man";
      _style = `isotype-horizontal-${isotype}`;
    }
    createCartesianBar(
      barGroup,
      left,
      top,
      barWidth,
      barHeight,
      colorScale(d.x),
      _style,
      { maxWidth: width },
    );

    // Check whether the value text can fit
    const testValue = d3.max(x.domain());
    const textText = globalSettings.format(testValue);
    if (
      textText.length >= 6 ||
      barHeight < globalSettings.getFontSize("value")
    ) {
      showValues = false;
    }

    // avoid showing both values and baseline
    if (showValues && showBaseline) {
      showBaseline = false;
    }

    if (showBaseline && yMin >= 0) {
      const midY = top + barHeight / 2;
      const xPos = xAxisDir === "default" ? width : 0;
      barGroup
        .append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", midY)
        .attr("y2", midY);
      barGroup
        .append("line")
        .attr("x1", xPos)
        .attr("x2", xPos)
        .attr("y1", midY - barHeight / 4)
        .attr("y2", midY + barHeight / 4);
      barGroup
        .selectAll("line")
        .attr("stroke", globalSettings.helperColor)
        .attr("stroke-width", Math.max(barHeight / 10, 1))
        .attr("opacity", 0.8);
    }

    if (showValues) {
      let xPos = xAxisDir === "default" ? left + barWidth + 2 : left - 2;
      let textAlign = xAxisDir === "default" ? "start" : "end";
      let color = globalSettings.textColorDark;

      const text = globalSettings.format(d.y);
      const textWidth = text.length * approxCharWidth;
      if (style.startsWith("isotype")) {
        xPos = width;
        textAlign = "end";

        if (left + barWidth + textWidth + 10 > width) {
          const bgHeight = globalSettings.getFontSize("value") + 4;
          const bgWidth = textWidth;

          const originalColor = colorScale(d.x);
          const lightColor = d3.interpolateRgb(originalColor, "white")(0.85);

          barGroup
            .append("rect")
            .attr("x", xPos - bgWidth + 2)
            .attr("y", top + barHeight / 2 - bgHeight / 2)
            .attr("width", bgWidth)
            .attr("height", bgHeight)
            .attr("rx", 3)
            .attr("fill", lightColor)
            .attr("opacity", 0.9);
        }
      } else if (
        textWidth + barWidth > width &&
        textWidth < barWidth &&
        autoAdjust
      ) {
        // If the text doesn't fit beside the bar, place it inside the bar
        xPos = xAxisDir === "default" ? left + barWidth - 4 : left + 2;
        textAlign = xAxisDir === "default" ? "end" : "start";
        color = getTextColor(colorScale(d.x));
      } else if (!autoAdjust && style.startsWith("round")) {
        // If not auto-adjusting and using rounded style, leave space for the rounded cap
        xPos += xAxisDir === "default" ? barHeight / 2 : -barHeight / 2;
      }

      const textElement = barGroup.append("text");
      textElement
        .attr("class", "bar-value")
        .attr("x", xPos)
        .attr("y", top + barHeight / 2)
        .attr("text-anchor", textAlign)
        .attr("dominant-baseline", "middle")
        .style("font-weight", "bold") // Force bold
        .style("fill", color)
        .text(text);
      globalSettings.setFont(textElement, "value");
    }
  });

  const horizontalIcons = options?.icons?.[options?.xName];
  let drawHorizontalImageIcons = false;
  if (style?.startsWith("round-solid") && horizontalIcons) {
    const hasAnyIcon = Object.values(horizontalIcons).some(
      (iconUrl) => !!iconUrl,
    );
    if (hasAnyIcon) {
      const groupKey = `image-icons::${String(options?.xName || "default")}`;
      if (!globalSettings.hasImageIconGroup(groupKey)) {
        globalSettings.registerImageIconGroup(groupKey);
        drawHorizontalImageIcons = true;
      }
    }
  }

  if (drawHorizontalImageIcons) {
    const iconSize = Math.max(
      globalSettings.getFontSize("value"),
      Math.min(y.bandwidth(), globalSettings.getFontSize("value") * 1.8),
    );
    data.forEach((d) => {
      const iconUrl = horizontalIcons[d.x];
      if (!iconUrl) return;

      const top = y(d.x);
      const barHeight = y.bandwidth();
      const left = xAxisDir === "default" ? x0 : x(d.y);
      const barWidth = Math.abs(x(d.y) - x0);

      barsGroup
        .append("image")
        .attr("x", left)
        .attr("y", top + barHeight - iconSize)
        .attr("width", iconSize)
        .attr("height", iconSize)
        .attr("xlink:href", iconUrl)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("opacity", 0.9)
        .style("pointer-events", "none");
    });
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  // Add y-axis (vertical, at the left or right)
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "y", {
      chartType: "bar",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "x", {
      chartType: "bar",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  if (returns) {
    return getYLabelPositions(data, y, width, pos, yAxisPos);
  }
}

/**
 * Creates a (vertical) stacked bar chart using D3.js.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y`, and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - Position of the x-axis ("bottom", "top", or other to skip drawing).
 * @param {string} yAxisPos - Position of the y-axis ("left", "right", or other to skip drawing).
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {Object} color - Color of the bars. It should be a color scale function or an array.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createVerticalStackBarChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { style = "default", padding = 0.3, returns = null } = options || {};
  const { pos = null } = returns || {};

  g = g.attr("width", width).attr("height", height).append("g");

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  // Group data by `x` and calculate the total `y` for each `x` (used for default yMax)
  const groupedData = d3.group(data, (d) => d.x);

  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.sum(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin > yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const xScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys())) // Unique x values
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const yScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(yAxisDir === "default" ? [height, 0] : [0, height]); // y-axis goes from bottom to top

  // Add baseline
  if (!(yMin === 0 && xAxisPos !== "none")) {
    addCartesianBaseline(g, yScale, width, height, "vertical");
  }

  const approxBarLen = width / xScale.domain().length;
  const shape = approxBarLen < 1000 ? "rect" : "triangle"; // TODO: modify this value to switch shape variation

  // Draw bars
  if (shape === "rect") {
    g.selectAll(".stacked-bar")
      .data(data)
      .enter()
      .each(function (d) {
        const group = groupedData.get(d.x);
        const index = group.indexOf(d);
        const previousSum = group
          .slice(0, index)
          .reduce((sum, item) => sum + item.y, 0);

        const left = xScale(d.x);

        const top =
          yAxisDir === "default"
            ? yScale(previousSum + d.y)
            : yScale(previousSum);

        const height =
          yAxisDir === "default"
            ? yScale(previousSum) - yScale(previousSum + d.y)
            : yScale(previousSum + d.y) - yScale(previousSum);

        const width = xScale.bandwidth();
        const barColor = color(d.label);

        createCartesianBar(g, left, top, width, height, barColor, style);
      });
  } else if (shape === "triangle") {
    // TODO: does not handle yAxisDir === "inverse"
    const totalHeightPerGroup = new Map();
    groupedData.forEach((group, key) => {
      const totalHeight =
        yScale(yMin) - yScale(group.reduce((sum, item) => sum + item.y, 0));
      totalHeightPerGroup.set(key, totalHeight);
    });

    g.selectAll(".stacked-bar")
      .data(data)
      .enter()
      .append("path")
      .attr("class", "stacked-bar")
      .attr("d", (d) => {
        const group = groupedData.get(d.x);
        const index = group.indexOf(d);
        const previousSum = group
          .slice(0, index)
          .reduce((sum, item) => sum + item.y, 0);
        const hp = yScale(yMin) - yScale(previousSum);
        const h0 = yScale(previousSum) - yScale(previousSum + d.y);
        const H = totalHeightPerGroup.get(d.x);
        const W = xScale.bandwidth();
        const x0 = xScale(d.x);
        const y0 = yScale(yMin);
        const points = [
          { x: x0 + (W * hp) / (2 * H), y: y0 - hp },
          { x: x0 + (W * (hp + h0)) / (2 * H), y: y0 - hp - h0 },
          {
            x: x0 + W - (W * (hp + h0)) / (2 * H),
            y: y0 - hp - h0,
          },
          { x: x0 + W - (W * hp) / (2 * H), y: y0 - hp },
        ];
        const path = d3.path();
        path.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          path.lineTo(points[i].x, points[i].y);
        }
        path.closePath();
        return path.toString();
      })
      .attr("fill", (d) => color(d.label));
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  const axisIcons = options?.icons?.[options?.xName] || null;

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, xScale, width, height, "x", {
      chartType: "stacked-bar",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
      icons: axisIcons,
    });
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, yScale, width, height, "y", {
      chartType: "stacked-bar",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  if (returns) {
    return getXLabelPositions(data, xScale, height, pos);
  }
}

/**
 * Creates a (horizontal) stacked bar chart using D3.js.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y`, and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - Position of the x-axis ("bottom", "top", or other to skip drawing).
 * @param {string} yAxisPos - Position of the y-axis ("left", "right", or other to skip drawing).
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {Object} color - An array of color or a color scale function to use for the stack.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createHorizontalStackBarChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { style = "default", padding = 0.3, returns = null } = options || {};
  const { pos = null } = returns || {};

  g = g.attr("width", width).attr("height", height).append("g");

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  // Group data by x and calculate the total y for each x (used for default yMax)
  const groupedData = d3.group(data, (d) => d.x);

  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.sum(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin > yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const yScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys())) // Unique x values
    .range(yAxisDir === "default" ? [0, height] : [height, 0]) // xScale controls the vertical placement (height)
    .paddingInner(padding)
    .paddingOuter(0);

  const xScale = d3
    .scaleLinear()
    .domain([yMin, yMax]) // yScale controls the horizontal placement (width)
    .range(xAxisDir === "default" ? [0, width] : [width, 0]); // Flip the range based on direction

  // Add baseline
  if (!(yMin === 0 && yAxisPos !== "none")) {
    addCartesianBaseline(g, xScale, width, height, "horizontal");
  }

  const approxBarLen = height / yScale.domain().length; // Approximate bar length
  const shape = approxBarLen < 1000 ? "rect" : "triangle"; // TODO: modify this value to switch shape variation

  // Draw bars
  if (shape === "rect") {
    g.selectAll(".stacked-bar")
      .data(data)
      .enter()
      .each(function (d) {
        const group = groupedData.get(d.x);
        const index = group.indexOf(d);
        const previousSum = group
          .slice(0, index)
          .reduce((sum, item) => sum + item.y, 0);

        const top = yScale(d.x);

        const left =
          xAxisDir === "default"
            ? xScale(previousSum)
            : xScale(previousSum + d.y);

        const width =
          xAxisDir === "default"
            ? xScale(previousSum + d.y) - xScale(previousSum)
            : xScale(previousSum) - xScale(previousSum + d.y);

        const height = yScale.bandwidth();
        const barColor = color(d.label);

        createCartesianBar(g, left, top, width, height, barColor, style);
      });
  } else if (shape === "triangle") {
    // TODO: does not handle xAxisDir === "inverse"
    const totalWidthPerGroup = new Map();
    groupedData.forEach((group, key) => {
      const totalWidth =
        xScale(group.reduce((sum, item) => sum + item.y, 0)) - xScale(yMin);
      totalWidthPerGroup.set(key, totalWidth);
    });

    g.selectAll(".stacked-bar")
      .data(data)
      .enter()
      .append("path")
      .attr("class", "stacked-bar")
      .attr("d", (d) => {
        const group = groupedData.get(d.x);
        const index = group.indexOf(d);
        const previousSum = group
          .slice(0, index)
          .reduce((sum, item) => sum + item.y, 0);
        const wp = xScale(previousSum) - xScale(yMin);
        const w0 = xScale(previousSum + d.y) - xScale(previousSum);
        const W = totalWidthPerGroup.get(d.x);
        const H = yScale.bandwidth();
        const y0 = yScale(d.x);
        const points = [
          { x: wp, y: y0 + (H * wp) / (2 * W) },
          { x: wp + w0, y: y0 + (H * (wp + w0)) / (2 * W) },
          { x: wp + w0, y: y0 + H - (H * (wp + w0)) / (2 * W) },
          { x: wp, y: y0 + H - (H * wp) / (2 * W) },
        ];
        const path = d3.path();
        path.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          path.lineTo(points[i].x, points[i].y);
        }
        path.closePath();
        return path.toString();
      })
      .attr("fill", (d) => color(d.label));
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, xScale, width, height, "x", {
      chartType: "stacked-bar",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, yScale, width, height, "y", {
      chartType: "stacked-bar",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  if (returns) {
    return getYLabelPositions(data, yScale, width, pos);
  }
}

/**
 * Creates a (vertical) grouped bar chart using D3.js.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y`, and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - Position of the x-axis ("bottom", "top", or other to skip drawing).
 * @param {string} yAxisPos - Position of the y-axis ("left", "right", or other to skip drawing).
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {Object} color - Color of the bars. It should be a color scale function or an array.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createVerticalGroupBarChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    paddingInGroup = 0.2,
    returns = null,
    showBaseline = true,
  } = options || {};
  const { pos = null } = returns || {};

  // Append the group element and set width and height
  g = g.attr("width", width).attr("height", height).append("g");

  // Sort data if an order is provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  // Group data by `x` to get all bars for each `x` value
  const groupedData = d3.group(data, (d) => d.x);

  // Calculate default yMax if not provided
  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.max(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin > yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const xScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys())) // Unique x values
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const yScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(yAxisDir === "default" ? [height, 0] : [0, height]);

  // Create color scale if color is an array
  const labelSet = Array.from(new Set(data.map((d) => d.label))); // Unique labels
  const colorScale =
    typeof color === "function"
      ? color
      : d3.scaleOrdinal().domain(labelSet).range(color);

  const groupSpace = xScale.bandwidth();
  const barSpace =
    groupSpace / (labelSet.length + paddingInGroup * (labelSet.length - 1));
  const totalBarSpace = barSpace * labelSet.length;
  const totalInnerPadding = groupSpace - totalBarSpace;
  const innerPaddingValue = totalInnerPadding / (labelSet.length - 1);

  const yBaselineValue = Math.max(0, yMin);
  const y0 = yScale(yBaselineValue); // Get the y-position of the baseline

  // Add baseline if 0 is within the y-axis domain
  if (!(yMin === 0 && xAxisPos !== "none")) {
    addCartesianBaseline(g, yScale, width, height, "vertical");
  }

  // Draw bars for each group
  g.selectAll(".grouped-bar")
    .data(data)
    .enter()
    .each(function (d) {
      const groupStart = xScale(d.x);
      const labelIndex = labelSet.indexOf(d.label);

      const left = groupStart + labelIndex * (barSpace + innerPaddingValue);

      let top;
      if (yAxisDir === "default") {
        top = d.y >= yBaselineValue ? yScale(d.y) : y0;
      } else {
        top = d.y >= yBaselineValue ? y0 : yScale(d.y);
      }

      const width = barSpace;
      const barHeight = Math.abs(yScale(d.y) - y0);
      const barColor = colorScale(d.label);

      createCartesianBar(g, left, top, width, barHeight, barColor, style);

      if (showBaseline && yMin >= 0) {
        const midX = left + width / 2;
        const yPos = yAxisDir === "default" ? 0 : height;
        const baselineGroup = g.append("g").attr("class", "baseline");
        baselineGroup
          .append("line")
          .attr("x1", midX)
          .attr("x2", midX)
          .attr("y1", 0)
          .attr("y2", height);
        baselineGroup
          .append("line")
          .attr("x1", midX - width / 4)
          .attr("x2", midX + width / 4)
          .attr("y1", yPos)
          .attr("y2", yPos);
        baselineGroup
          .selectAll("line")
          .attr("stroke", globalSettings.helperColor)
          .attr("stroke-width", Math.max(width / 10, 1))
          .attr("opacity", 0.8);
      }
    });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, xScale, width, height, "x", {
      chartType: "grouped-bar",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, yScale, width, height, "y", {
      chartType: "grouped-bar",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  if (returns) {
    return getXLabelPositions(data, xScale, height, pos);
  }
}

/**
 * Creates a (horizontal) grouped bar chart using D3.js.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y`, and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - Position of the x-axis ("bottom", "top", or other to skip drawing).
 * @param {string} yAxisPos - Position of the y-axis ("left", "right", or other to skip drawing).
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {Object} color - Color of the bars. It should be a color scale function or an array.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createHorizontalGroupBarChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  yAxisPos,
  xAxisDir,
  yAxisDir,
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    paddingInGroup = 0.2,
    returns = null,
    showBaseline = true,
  } = options || {};
  const { pos = null } = returns || {};

  // Append the group element and set width and height
  g = g.attr("width", width).attr("height", height).append("g");

  // Sort data if an order is provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  // Group data by `x` to get all bars for each `x` value
  const groupedData = d3.group(data, (d) => d.x);

  // Calculate default yMax if not provided
  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.max(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin > yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const yScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys())) // Unique x values
    .range(yAxisDir === "default" ? [0, height] : [height, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const xScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(xAxisDir === "default" ? [0, width] : [width, 0]);

  // Create color scale if color is an array
  const labelSet = Array.from(new Set(data.map((d) => d.label))); // Unique labels
  const colorScale =
    typeof color === "function"
      ? color
      : d3.scaleOrdinal().domain(labelSet).range(color);

  const groupSpace = yScale.bandwidth();
  const barSpace =
    groupSpace / (labelSet.length + paddingInGroup * (labelSet.length - 1));
  const totalBarSpace = barSpace * labelSet.length;
  const totalInnerPadding = groupSpace - totalBarSpace;
  const innerPaddingValue = totalInnerPadding / (labelSet.length - 1);

  const xBaselineValue = Math.max(0, yMin);
  const x0 = xScale(xBaselineValue); // Get the x-position of the baseline

  // Add baseline if 0 is within the x-axis domain
  if (!(yMin === 0 && yAxisPos !== "none")) {
    addCartesianBaseline(g, xScale, width, height, "horizontal");
  }

  // Draw bars for each group
  g.selectAll(".grouped-bar")
    .data(data)
    .enter()
    .each(function (d) {
      const groupStart = yScale(d.x);
      const labelIndex = labelSet.indexOf(d.label);

      const top = groupStart + labelIndex * (barSpace + innerPaddingValue);

      let left;
      if (xAxisDir === "default") {
        left = d.y >= xBaselineValue ? x0 : xScale(d.y);
      } else {
        left = d.y >= xBaselineValue ? xScale(d.y) : x0;
      }

      const height = barSpace;
      const barWidth = Math.abs(xScale(d.y) - x0);
      const barColor = colorScale(d.label);

      createCartesianBar(g, left, top, barWidth, height, barColor, style);

      if (showBaseline && yMin >= 0) {
        const midY = top + height / 2;
        const xPos = xAxisDir === "default" ? width : 0;
        const baselineGroup = g.append("g").attr("class", "baseline");
        baselineGroup
          .append("line")
          .attr("x1", 0)
          .attr("x2", width)
          .attr("y1", midY)
          .attr("y2", midY);
        baselineGroup
          .append("line")
          .attr("x1", xPos)
          .attr("x2", xPos)
          .attr("y1", midY - height / 4)
          .attr("y2", midY + height / 4);
        baselineGroup
          .selectAll("line")
          .attr("stroke", globalSettings.helperColor)
          .attr("stroke-width", Math.max(height / 10, 1))
          .attr("opacity", 0.8);
      }
    });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, xScale, width, height, "x", {
      chartType: "grouped-bar",
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, yScale, width, height, "y", {
      chartType: "grouped-bar",
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  if (returns) {
    return getYLabelPositions(data, yScale, width, pos);
  }
}

/**
 * Creates a radial bar chart on a radial segment.
 *
 * @param {Object[]} data - Array of data objects, each containing `x` and `y` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createRadialBarChart(
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
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    showBcgBar = true,
    showLabels = false,
  } = options || {};

  if (!yMin) yMin = 0;
  if (!yMax) yMax = d3.max(data, (d) => d.y);
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const colorScale = typeof color === "function" ? color : () => color;

  // Create a scale for the angular positions of the bars (x-axis mapped to angles)
  const angleScale = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    )
    .paddingInner(padding)
    .paddingOuter(0);

  // Create a scale for the radial height of the bars (y-axis mapped to radius)
  const radiusScale = d3
    .scaleLinear()
    .domain([yMin, yMax]) // Input domain (data range)
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    ); // bar heights

  const rBaselineValue = Math.max(0, yMin);
  const r0 = radiusScale(rBaselineValue); // Get the radius for the baseline

  // Add baseline arc if 0 is within the radius scale domain
  if (!(yMin === 0 && xAxisPos !== "none")) {
    addPolarBaseline(
      g,
      radiusScale,
      startAngle,
      endAngle,
      innerRadius,
      outerRadius,
      "radial",
    );
  }

  // Draw the bars
  const barsGroup = g.append("g");

  data.forEach((d) => {
    const sAngle = angleScale(d.x);
    const eAngle = sAngle + angleScale.bandwidth();
    let iRadius, oRadius;

    if (yAxisDir === "default") {
      iRadius = d.y >= rBaselineValue ? r0 : radiusScale(d.y);
      oRadius = d.y >= rBaselineValue ? radiusScale(d.y) : r0;
    } else {
      iRadius = d.y >= rBaselineValue ? radiusScale(d.y) : r0;
      oRadius = d.y >= rBaselineValue ? r0 : radiusScale(d.y);
    }

    if (iRadius > oRadius) [iRadius, oRadius] = [oRadius, iRadius];

    const barColor = colorScale(d.x);

    if (showBcgBar) {
      createPolarBar(
        barsGroup,
        sAngle,
        eAngle,
        innerRadius,
        outerRadius,
        barColor,
        "background",
      );
    }

    createPolarBar(
      barsGroup,
      sAngle,
      eAngle,
      iRadius,
      oRadius,
      barColor,
      style,
    );

    if (showLabels) {
      if (showLabels) {
        const angle = (sAngle + eAngle) / 2; // Calculate the middle angle of the bar
        const labelRadius = (innerRadius + outerRadius) / 2; // Position the label in the middle of the bar's radius

        const x = labelRadius * Math.cos(angle - Math.PI / 2);
        const y = labelRadius * Math.sin(angle - Math.PI / 2);
        const deg = (angle * 180) / Math.PI - 90;

        let textColor = globalSettings.textColorDark;
        if ((oRadius - iRadius) * 2 > outerRadius - innerRadius) {
          textColor = getTextColor(barColor);
        }

        const textGroup = barsGroup
          .append("g")
          .attr("class", "bar-text")
          .attr("transform", `translate(${x}, ${y})`)
          .append("text");
        textGroup
          .attr("class", "bar-labels")
          .attr("x", 0)
          .attr("y", 0)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("transform", `rotate(${deg})`)
          .style("fill", textColor)
          .text(d.x);
        globalSettings.setFont(textGroup, "value");
      }
    }
  });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  let radialValues = null;

  // Draw y-axis
  const axisLayer = g.append("g").attr("class", "axis");
  if (yAxisPos.includes("left")) {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else if (yAxisPos.includes("right")) {
    const ticks = axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  }

  // draw the x-axis
  if (xAxisPos.includes("bottom")) {
    const [xAxis, _] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  } else if (xAxisPos.includes("top")) {
    const [xAxis, _] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  }

  radialValues = enhanceTickValues(radialValues, innerRadius, outerRadius);
  createRadialRefLine(g, radialValues, startAngle, endAngle);
}

/**
 * Creates a circular bar chart.
 *
 * @param {Object[]} data - Array of data objects, each containing `x` and `y` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createCircularBarChart(
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
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  let {
    style = "default",
    padding = 0.3,
    showBcgBar = true,
    showBorder = false,
  } = options || {};

  if (style === "round") {
    style =
      xAxisDir === "default" ? "round-clockwise" : "round-counterclockwise";
  }

  if (!yMin) yMin = 0;
  if (!yMax) yMax = d3.max(data, (d) => d.y);
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const colorScale = typeof color === "function" ? color : () => color;

  // Create scales
  const radialTickValues = data.map((d) => d.x);
  const radiusScale = d3
    .scaleBand()
    .domain(radialTickValues)
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    )
    .paddingInner(padding)
    .paddingOuter(0);

  const angleScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    ); // Map `y` values to angular positions

  const aBaselineValue = Math.max(0, yMin);
  const a0 = angleScale(aBaselineValue); // Get the angle for the baseline

  // Add baseline radial line if 0 is within the angle scale domain
  if (!(yMin === 0 && yAxisPos !== "none")) {
    addPolarBaseline(
      g,
      angleScale,
      startAngle,
      endAngle,
      innerRadius,
      outerRadius,
      "circular",
    );
  }

  if (showBorder) {
    const axisCircle = d3
      .arc()
      .innerRadius(innerRadius)
      .outerRadius(innerRadius)
      .startAngle(startAngle)
      .endAngle(endAngle);

    g.append("path")
      .attr("d", axisCircle())
      .attr("stroke", globalSettings.helperColor)
      .attr("stroke-width", 1)
      .attr("fill", "none");
  }

  // Draw the bars
  const barsGroup = g.append("g");

  data.forEach((d) => {
    let sAngle, eAngle;

    // Adjust start/end angle based on xAxisDir and data sign relative to baseline
    if (xAxisDir === "default") {
      sAngle = d.y >= aBaselineValue ? a0 : angleScale(d.y);
      eAngle = d.y >= aBaselineValue ? angleScale(d.y) : a0;
    } else {
      // inverse
      sAngle = d.y >= aBaselineValue ? angleScale(d.y) : a0;
      eAngle = d.y >= aBaselineValue ? a0 : angleScale(d.y);
    }
    // Ensure startAngle < endAngle for d3.arc
    if (sAngle > eAngle) [sAngle, eAngle] = [eAngle, sAngle];

    const iRadius = radiusScale(d.x);
    const oRadius = iRadius + radiusScale.bandwidth();

    const barColor = colorScale(d.x);

    if (showBcgBar) {
      createPolarBar(
        barsGroup,
        startAngle,
        endAngle,
        iRadius,
        oRadius,
        barColor,
        "background",
      );
    }

    createPolarBar(
      barsGroup,
      sAngle,
      eAngle,
      iRadius,
      oRadius,
      barColor,
      style,
    );
  });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Draw x-axis
  let angularValues = null;
  if (xAxisPos.includes("bottom")) {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else if (xAxisPos.includes("top")) {
    const [xAxis, ticks] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    angularValues = ticks.map((val) => angleScale(val));
  }

  // Draw y-axis
  if (yAxisPos.includes("left")) {
    const axisLayer = g.append("g").attr("class", "axis");
    axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
  } else if (yAxisPos.includes("right")) {
    const axisLayer = g.append("g").attr("class", "axis");
    axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
  }

  const minStep = (Math.PI * 10) / 180;
  const minDist = (Math.PI * 1) / 180;
  angularValues = enhanceTickValues(
    angularValues,
    startAngle,
    endAngle,
    minStep,
    minDist,
  );
  createAngularRefLine(g, angularValues, innerRadius, outerRadius);
}

/**
 * Creates a radial stack bar chart on a radial segment.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y` and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {string} color - The color of the bars.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createRadialStackBarChart(
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
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { style = "default", padding = 0.3 } = options || {};

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const groupedData = d3.group(data, (d) => d.x);

  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.sum(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  // Create a scale for the angular positions of the bars (x-axis mapped to angles)
  const angleScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys()))
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    )
    .paddingInner(padding)
    .paddingOuter(padding / 2);

  // Create a scale for the radial height of the bars (y-axis mapped to radius)
  const radiusScale = d3
    .scaleLinear()
    .domain([yMin, yMax]) // Input domain (data range)
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    ); // bar heights

  // Add baseline arc if 0 is within the radius scale domain
  if (!(yMin === 0 && xAxisPos !== "none")) {
    addPolarBaseline(
      g,
      radiusScale,
      startAngle,
      endAngle,
      innerRadius,
      outerRadius,
      "radial",
    );
  }

  const barsGroup = g.append("g");

  data.forEach((d) => {
    const group = groupedData.get(d.x);
    const index = group.indexOf(d);
    const previousSum = group
      .slice(0, index)
      .reduce((sum, item) => sum + item.y, 0);

    const startAngle = angleScale(d.x);
    const endAngle = startAngle + angleScale.bandwidth();

    const innerR = radiusScale(previousSum);
    const outerR = radiusScale(previousSum + d.y);

    const barColor = color(d.label);

    createPolarBar(
      barsGroup,
      startAngle,
      endAngle,
      innerR,
      outerR,
      barColor,
      style,
    );
  });

  // draw y-axis
  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  let radialValues = null;

  const axisLayer = g.append("g").attr("class", "axis");
  if (yAxisPos.includes("left")) {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else if (yAxisPos.includes("right")) {
    const ticks = axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  }

  // draw the x-axis
  if (xAxisPos.includes("bottom")) {
    const [xAxis, _] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  } else if (xAxisPos.includes("top")) {
    const [xAxis, _] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  }

  radialValues = enhanceTickValues(radialValues, innerRadius, outerRadius);
  createRadialRefLine(g, radialValues, startAngle, endAngle);
}

/**
 * Creates a stacked circular bar chart on a circular segment.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y`, and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {string} color - The color of the bars.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createCircularStackBarChart(
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
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const { style = "default", padding = 0.3 } = options || {};

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const groupedData = d3.group(data, (d) => d.x);

  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.sum(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin >= yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const angleScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    );

  // add baseline
  if (!(yMin === 0 && yAxisPos !== "none")) {
    addPolarBaseline(
      g,
      angleScale,
      startAngle,
      endAngle,
      innerRadius,
      outerRadius,
      "circular",
    );
  }

  const radialTickValues = Array.from(groupedData.keys());
  const radiusScale = d3
    .scaleBand()
    .domain(radialTickValues)
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    )
    .paddingInner(padding)
    .paddingOuter(0);

  // Draw the bars
  const barsGroup = g.append("g");

  data.forEach((d) => {
    const group = groupedData.get(d.x);
    const index = group.indexOf(d);
    const previousSum = group
      .slice(0, index)
      .reduce((sum, item) => sum + item.y, 0); // Sum of previous stacks

    const innerR = radiusScale(d.x);
    const outerR = innerR + radiusScale.bandwidth();

    let startAngle = angleScale(previousSum);
    let endAngle = angleScale(previousSum + d.y);

    const barColor = color(d.label);

    createPolarBar(
      barsGroup,
      startAngle,
      endAngle,
      innerR,
      outerR,
      barColor,
      style,
    );
  });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Draw x-axis
  let angularValues = null;
  if (xAxisPos.includes("bottom")) {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else if (xAxisPos.includes("top")) {
    const [xAxis, ticks] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    angularValues = ticks.map((val) => angleScale(val));
  }

  // Draw y-axis
  if (yAxisPos.includes("left")) {
    const axisLayer = g.append("g").attr("class", "axis");
    axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
  } else if (yAxisPos.includes("right")) {
    const axisLayer = g.append("g").attr("class", "axis");
    axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
  }

  const minStep = (Math.PI * 10) / 180;
  const minDist = (Math.PI * 1) / 180;
  angularValues = enhanceTickValues(
    angularValues,
    startAngle,
    endAngle,
    minStep,
    minDist,
  );
  createAngularRefLine(g, angularValues, innerRadius, outerRadius);
}

/**
 * Creates a radial grouped bar chart using D3.js.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y` and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {string} color - The color of the bars.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createRadialGroupBarChart(
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
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    paddingInGroup = 0.2,
    showBcg = true,
  } = options || {};

  // Sort data if an order is provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const groupedData = d3.group(data, (d) => d.x);

  // Calculate default yMax if not provided
  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.max(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin > yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const angleScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys())) // Unique x values
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    )
    .paddingInner(padding)
    .paddingOuter(padding / 2);

  const radiusScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    );

  const labelSet = Array.from(new Set(data.map((d) => d.label))); // Unique labels

  const groupSpace = angleScale.bandwidth();
  const barSpace =
    groupSpace / (labelSet.length + paddingInGroup * (labelSet.length - 1));
  const totalBarSpace = barSpace * labelSet.length;
  const totalInnerPadding = groupSpace - totalBarSpace;
  const innerPaddingValue = totalInnerPadding / (labelSet.length - 1);

  const rBaselineValue = Math.max(0, yMin);
  const r0 = radiusScale(rBaselineValue); // Get the radius for the baseline

  // Add baseline arc if 0 is within the radius scale domain
  if (!(yMin === 0 && xAxisPos !== "none")) {
    addPolarBaseline(
      g,
      radiusScale,
      startAngle,
      endAngle,
      innerRadius,
      outerRadius,
      "radial",
    );
  }

  // Draw bars for each group
  const barsGroup = g.append("g");

  data.forEach((d) => {
    const groupStart = angleScale(d.x);
    const labelIndex = labelSet.indexOf(d.label);
    const sAngle = groupStart + labelIndex * (barSpace + innerPaddingValue);
    const eAngle = sAngle + barSpace;
    let iRadius, oRadius;

    // Adjust inner/outer radius based on yAxisDir and data sign relative to baseline
    if (yAxisDir === "default") {
      iRadius = d.y >= rBaselineValue ? r0 : radiusScale(d.y); // Compare with rBaselineValue, use r0
      oRadius = d.y >= rBaselineValue ? radiusScale(d.y) : r0; // Compare with rBaselineValue, use r0
    } else {
      // inverse
      iRadius = d.y >= rBaselineValue ? radiusScale(d.y) : r0; // Compare with rBaselineValue, use r0
      oRadius = d.y >= rBaselineValue ? r0 : radiusScale(d.y); // Compare with rBaselineValue, use r0
    }
    // Ensure innerRadius is smaller than outerRadius for d3.arc
    if (iRadius > oRadius) [iRadius, oRadius] = [oRadius, iRadius];

    const barColor = color(d.label);

    if (showBcg) {
      createPolarBar(
        barsGroup,
        sAngle,
        eAngle,
        innerRadius,
        outerRadius,
        barColor,
        "background",
      );
    }

    createPolarBar(
      barsGroup,
      sAngle,
      eAngle,
      iRadius,
      oRadius,
      barColor,
      style,
    );
  });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";
  let radialValues = null;

  // draw y-axis
  const axisLayer = g.append("g").attr("class", "axis");
  if (yAxisPos.includes("left")) {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else if (yAxisPos.includes("right")) {
    const ticks = axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  }

  // draw x-axis
  if (xAxisPos.includes("bottom")) {
    const [xAxis, _] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  } else if (xAxisPos.includes("top")) {
    const [xAxis, _] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  }

  radialValues = enhanceTickValues(radialValues, innerRadius, outerRadius);
  createRadialRefLine(g, radialValues, startAngle, endAngle);
}

/**
 * Creates a circular grouped bar chart using D3.js.
 *
 * @param {Object[]} data - Array of data objects, each containing `x`, `y` and `label` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} xAxisDir - Direction of the x-axis ("default" or "inverse").
 * @param {string} yAxisDir - Direction of the y-axis ("default" or "inverse").
 * @param {number} yMin - The lower bound of the `y` field (minimum value).
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {Object} order - The order of the bars, as a list.
 * @param {string} color - The color of the bars.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createCircularGroupBarChart(
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
  yMin,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    paddingInGroup = 0.2,
    showBcgBar = true,
  } = options || {};

  // Sort data if an order is provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  // Group data by `x` to get all bars for each `x` value
  const groupedData = d3.group(data, (d) => d.x);

  // Calculate default yMax if not provided
  if (!yMax)
    yMax = d3.max(Array.from(groupedData.values()), (group) =>
      d3.max(group, (d) => d.y),
    );
  if (!yMin) yMin = 0;
  if (yMin > yMax) throw new Error("yMin should be less than yMax");

  // Create scales
  const angleScale = d3
    .scaleLinear()
    .domain([yMin, yMax])
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    );

  const radiusScale = d3
    .scaleBand()
    .domain(Array.from(groupedData.keys()))
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    )
    .paddingInner(padding)
    .paddingOuter(0);

  // Create color scale if color is an array
  const labelSet = Array.from(new Set(data.map((d) => d.label))); // Unique labels

  // Bar width: Dividing the band width by the number of labels in each group
  const groupSpace = radiusScale.bandwidth();
  const barSpace =
    groupSpace / (labelSet.length + paddingInGroup * (labelSet.length - 1));
  const totalBarSpace = barSpace * labelSet.length;
  const totalInnerPadding = groupSpace - totalBarSpace;
  const innerPaddingValue = totalInnerPadding / (labelSet.length - 1);

  // Calculate baseline angle
  const angleBaselineValue = Math.max(0, yMin);
  const angle0 = angleScale(angleBaselineValue); // Get the angle for the baseline

  // Draw bars for each group
  const barsGroup = g.append("g");

  data.forEach((d) => {
    const groupStart = radiusScale(d.x); // This maps category to radius start
    const labelIndex = labelSet.indexOf(d.label);
    const iRadius = groupStart + labelIndex * (barSpace + innerPaddingValue);
    const oRadius = iRadius + barSpace;

    let sAngle, eAngle;

    // Adjust start/end angle based on xAxisDir and data sign relative to baseline
    if (xAxisDir === "default") {
      sAngle = d.y >= angleBaselineValue ? angle0 : angleScale(d.y); // Compare with angleBaselineValue, use angle0
      eAngle = d.y >= angleBaselineValue ? angleScale(d.y) : angle0; // Compare with angleBaselineValue, use angle0
    } else {
      // inverse
      sAngle = d.y >= angleBaselineValue ? angleScale(d.y) : angle0; // Compare with angleBaselineValue, use angle0
      eAngle = d.y >= angleBaselineValue ? angle0 : angleScale(d.y); // Compare with angleBaselineValue, use angle0
    }

    if (sAngle > eAngle) {
      [sAngle, eAngle] = [eAngle, sAngle];
    }

    const barColor = color(d.label);

    if (showBcgBar) {
      createPolarBar(
        barsGroup,
        startAngle,
        endAngle,
        iRadius,
        oRadius,
        barColor,
        "background",
      );
    }

    createPolarBar(
      barsGroup,
      sAngle,
      eAngle,
      iRadius,
      oRadius,
      barColor,
      style,
    );
  });

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Draw x-axis
  let angularValues = null;
  if (xAxisPos.includes("bottom")) {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else if (xAxisPos.includes("top")) {
    const [xAxis, ticks] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    angularValues = ticks.map((val) => angleScale(val));
  }

  // Draw y-axis
  if (yAxisPos.includes("left")) {
    const axisLayer = g.append("g").attr("class", "axis");
    axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
  } else if (yAxisPos.includes("right")) {
    const axisLayer = g.append("g").attr("class", "axis");
    axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
  }

  const minStep = (Math.PI * 10) / 180;
  const minDist = (Math.PI * 1) / 180;
  angularValues = enhanceTickValues(
    angularValues,
    startAngle,
    endAngle,
    minStep,
    minDist,
  );
  createAngularRefLine(g, angularValues, innerRadius, outerRadius);
}

/**
 * Creates a vertical proportional area chart, as a variant of bar chart.
 *
 * @param {Object[]} data - The data to render in the chart.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} xAxisDir - The direction of the x-axis ("default" or "inverse").
 * @param {number} yMax - The maximum value for the y-axis.
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createVerticalProportionalAreaChart(
  data,
  g,
  height,
  width,
  xAxisPos,
  xAxisDir,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    shape = "circle",
    maxProportion = 1,
    showValues = true,
    opacity = 0.9,
    returns = {},
  } = options || {};
  const { pos = null } = returns || {};

  g = g.attr("width", width).attr("height", height).append("g");

  // check if all the data points are positive
  const allPositive = data.every((d) => d.y >= 0);
  if (!allPositive) {
    throw new Error("All data points should be positive");
  }

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const scale = adjustScaleFactor(
    data,
    x,
    Math.min(height * maxProportion, x.bandwidth() * maxProportion),
    yMax,
  );

  const colorScale = typeof color === "function" ? color : () => color;

  const childrenGroup = g.append("g");

  if (shape === "circle") {
    data.forEach((d) => {
      const cx = x(d.x) + x.bandwidth() / 2;
      const cy = height / 2;
      const r = (Math.sqrt(d.y) * scale) / 2;
      createCircle(childrenGroup, cx, cy, r, colorScale(d.x), style);
    });
    if (style === "default") {
      childrenGroup.selectAll(".circle").attr("opacity", opacity);
    }
  } else if (shape === "square") {
    data.forEach((d) => {
      const x0 = x(d.x);
      const y0 = height / 2;
      const size = Math.sqrt(d.y) * scale;
      createCartesianBar(
        childrenGroup,
        x0 + x.bandwidth() / 2 - size / 2,
        y0 - size / 2,
        size,
        size,
        colorScale(d.x),
        style,
      );
    });
    if (style === "default") {
      childrenGroup.selectAll(".rect").attr("opacity", opacity);
    }
  }

  if (showValues) {
    data.forEach((d) => {
      let color = globalSettings.textColorDark;
      let yPos = height / 2;
      let dominantBaseline = "middle";
      const text = globalSettings.format(d.y);
      const textWidth = text.length * approxCharWidth;
      const containerWidth = Math.sqrt(d.y) * scale;
      if (
        containerWidth < textWidth + 1 &&
        containerWidth > textWidth * Math.SQRT1_2
      ) {
        // If the text overflows the circle, place it above the circle; default color is black
        yPos = 5;
        dominantBaseline = "hanging";
      } else if (containerWidth >= textWidth + 1) {
        // Otherwise, auto-adjust the color
        color = getTextColor(colorScale(d.x));
      }

      const textElement = g.append("text");
      textElement
        .attr("class", "bar-value")
        .attr("x", x(d.x) + x.bandwidth() / 2)
        .attr("y", yPos)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", dominantBaseline)
        .style("font-weight", "bold")
        .style("fill", color)
        .text(text);
      globalSettings.setFont(textElement, "value");
    });
  }

  const fontStyle = style === "sketch" ? "sketch" : "default";
  // Add the x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "x", {
      fontStyle: fontStyle,
    });
  }

  if (returns) {
    return getXLabelPositions(data, x, height, pos);
  }
}

/**
 * Creates a horizontal proportional area chart, as a variant of bar chart.
 *
 * @param {Object[]} data - The data to render in the chart.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} height - The height of the chart.
 * @param {number} width - The width of the chart.
 * @param {string} yAxisPos - The position of the y-axis ("left", "right", "none").
 * @param {string} yAxisDir - The direction of the y-axis ("default" or "inverse").
 * @param {number} yMax - The maximum value for the y-axis.
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createHorizontalProportionalAreaChart(
  data,
  g,
  height,
  width,
  yAxisPos,
  yAxisDir,
  yMax,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    shape = "circle",
    maxProportion = 1,
    showValues = true,
    opacity = 0.9,
    returns = {},
  } = options || {};
  const { pos = null } = returns || {};

  g = g.attr("width", width).attr("height", height).append("g");

  // check if all the data points are positive
  const allPositive = data.every((d) => d.y >= 0);
  if (!allPositive) {
    throw new Error("All data points should be positive");
  }

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const y = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(yAxisDir === "default" ? [0, height] : [height, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const scale = adjustScaleFactor(
    data,
    y,
    Math.min(width * maxProportion, y.bandwidth() * maxProportion),
    yMax,
  );

  const colorScale = typeof color === "function" ? color : () => color;

  const childrenGroup = g.append("g");

  if (shape === "circle") {
    data.forEach((d) => {
      const cx = width / 2;
      const cy = y(d.x) + y.bandwidth() / 2;
      const r = (Math.sqrt(d.y) * scale) / 2;
      createCircle(childrenGroup, cx, cy, r, colorScale(d.x), style);
    });
    if (style === "default") {
      childrenGroup.selectAll(".circle").attr("opacity", opacity);
    }
  } else if (shape === "square") {
    data.forEach((d) => {
      const x0 = width / 2;
      const y0 = y(d.x);
      const size = Math.sqrt(d.y) * scale;
      createCartesianBar(
        childrenGroup,
        x0 - size / 2,
        y0 + y.bandwidth() / 2 - size / 2,
        size,
        size,
        colorScale(d.x),
        style,
      );
    });
    if (style === "default") {
      childrenGroup.selectAll(".rect").attr("opacity", opacity);
    }
  }

  if (showValues) {
    data.forEach((d) => {
      let color = globalSettings.textColorDark;
      let yPos = y(d.x) + y.bandwidth() / 2;
      let dominantBaseline = "middle";
      const text = globalSettings.format(d.y);
      const textWidth = text.length * approxCharWidth;
      const containerWidth = Math.sqrt(d.y) * scale;
      if (containerWidth < textWidth + 1) {
        // If the text overflows the circle, place it above the circle; default color is black
        yPos = y(d.x) + 5;
        dominantBaseline = "hanging";
      } else if (containerWidth >= textWidth + 1) {
        // Otherwise, auto-adjust the color
        color = getTextColor(colorScale(d.x));
      }

      const textElement = g.append("text");
      textElement
        .attr("class", "bar-value")
        .attr("x", width / 2)
        .attr("y", yPos)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", dominantBaseline)
        .style("font-weight", "bold")
        .style("fill", color)
        .text(text);
      globalSettings.setFont(textElement, "value");
    });
  }

  const fontStyle = style === "sketch" ? "sketch" : "default";
  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "y", {
      fontStyle: fontStyle,
    });
  }

  if (returns) {
    return getYLabelPositions(data, y, width, pos);
  }
}

/**
 * Creates a radial proportional area chart, as a variant of bar chart.
 *
 * @param {Object[]} data - The data to render in the chart.
 * @param {Object} g - The g element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {string} xAxisPos - The position of the x-axis ("bottom", "top", "none").
 * @param {string} xAxisDir - The direction of the x-axis ("default" or "inverse").
 * @param {Object} order - The order of the bars, as a list.
 * @param {function|string} color - The color of the bars. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createRadialProportionalAreaChart(
  data,
  g,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  xAxisPos,
  xAxisDir,
  order,
  color,
  options = {},
) {
  const {
    style = "default",
    padding = 0.3,
    shape = "circle",
    maxProportion = 1,
    showValues = true,
    opacity = 0.9,
  } = options || {};

  g = g.append("g");

  // check if all the data points are positive
  const allPositive = data.every((d) => d.y >= 0);
  if (!allPositive) {
    throw new Error("All data points should be positive");
  }

  // Sort data based on the order if provided
  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const angleScale = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    )
    .paddingInner(padding)
    .paddingOuter(0);

  const height = outerRadius - innerRadius;

  // get the maximum height of the shapes: sqrt(yMax) <--> maxProportion * height
  const yMax = d3.max(data, (d) => d.y);
  const scale = (height * maxProportion) / Math.sqrt(yMax);

  const colorScale = typeof color === "function" ? color : () => color;
  const radius = (innerRadius + outerRadius) / 2;
  const childrenGroup = g.append("g");

  if (shape === "circle") {
    data.forEach((d) => {
      const cx =
        radius *
        Math.cos(angleScale(d.x) + angleScale.bandwidth() / 2 - Math.PI / 2);
      const cy =
        radius *
        Math.sin(angleScale(d.x) + angleScale.bandwidth() / 2 - Math.PI / 2);
      const r = (Math.sqrt(d.y) * scale) / 2;
      createCircle(childrenGroup, cx, cy, r, colorScale(d.x), style);
    });
    if (style === "default") {
      childrenGroup.selectAll(".circle").attr("opacity", opacity);
    }
  }

  if (showValues) {
    data.forEach((d) => {
      const angle = angleScale(d.x) + angleScale.bandwidth() / 2;
      const radius = (innerRadius + outerRadius) / 2;

      const textElement = g.append("text");
      textElement
        .attr("class", "bar-value")
        .attr("x", radius * Math.cos(angle - Math.PI / 2))
        .attr("y", radius * Math.sin(angle - Math.PI / 2))
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .text(d.y);
      globalSettings.setFont(textElement, "value");
    });
  }

  const fontStyle = style === "sketch" ? "sketch" : "default";
  // Add x-axis if needed
  if (xAxisPos.includes("bottom")) {
    const [xAxis, _] = axisRadialInner(angleScale, innerRadius, {
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  } else if (xAxisPos.includes("top")) {
    const [xAxis, _] = axisRadialOuter(angleScale, outerRadius, {
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
  }
}

/**
 * Creates a bar chart given coordinate (position) information.
 *
 * @param {Object[]} data - The data to render in the chart, each should have `x` and `y`.
 * @param {Object} g - The D3 selection of the group.
 * @param {function|string} color - The color of the bars.
 * @param {Object} labelPosition - The position of the x-axis labels to coordinate the bars.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createCoordinateBarChart(
  data,
  g,
  color,
  labelPosition,
  options = {},
) {
  const { style = "shadow" } = options || {};
  const bandWidth = 30;
  const maxHeight = 300;
  const yMin = 0;
  const yMax = d3.max(data, (d) => d.y);
  const y = d3.scaleLinear().domain([yMin, yMax]).range([0, maxHeight]);

  const barsGroup = g.append("g");
  data.forEach((d) => {
    const height = y(d.y);
    const bottom = labelPosition[d.x].cy;
    const top = bottom - height;
    const width = bandWidth;
    const left = labelPosition[d.x].cx - bandWidth / 2;

    // Create the bar
    createCartesianBar(barsGroup, left, top, width, height, color, style);

    // Add x and y labels above the bar
    const description = g.append("text");
    description
      .attr("x", labelPosition[d.x].cx)
      .attr("y", top - 50)
      .text(d.x);
    globalSettings.setFont(description, "description");

    const label = g.append("text");
    label
      .attr("x", labelPosition[d.x].cx)
      .attr("y", top - 20)
      .text(Math.floor(d.y));
    globalSettings.setFont(label, "label");

    g.selectAll("text")
      .attr("class", "bar-value")
      .attr("text-anchor", "middle")
      .attr("font-weight", "bold")
      .attr("fill", globalSettings.textColorDark);
  });
}

/**
 * Creates a radial waffle chart with bubbles.
 *
 * @param {Object[]} data - Array of data objects, each containing `x` and `y` attributes.
 * @param {Object} g - The D3 selection of the group (`g`) element to render the chart in.
 * @param {number} startAngle - The starting angle of the arc (in radians).
 * @param {number} endAngle - The ending angle of the arc (in radians).
 * @param {number} innerRadius - The inner radius of the arc.
 * @param {number} outerRadius - The outer radius of the arc.
 * @param {number} yMax - The upper bound of the `y` field (maximum value).
 * @param {string} color - The color of the chart.
 * @param {Object} [options={}] - Additional options for the chart.
 */
export function createRadialWaffleChart(
  data,
  g,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  yMax,
  color,
  options = {},
) {
  // 1. Parameter Extraction and Initialization
  const {
    bubbleOffsetRadius = innerRadius * 0.6,
    maxBubbleRadius = innerRadius * 0.28,
    showLabels = true,
    valueFormat = (v) => v.toFixed(0),
    name = "name",
  } = options;
  const maxDotsPerCol = 5;

  if (!data || data.length === 0) return;

  // 2. Data Sorting
  data.sort((a, b) => b.y - a.y || String(a.x).localeCompare(String(b.x)));

  const colorScale = typeof color === "function" ? color : () => color;
  const categoryColor = colorScale(data[0].x);

  // 3. Data Flattening for Continuous Matrix Arrangement
  const allDots = [];
  data.forEach((d) => {
    for (let i = 0; i < d.y; i++) {
      allDots.push({ x: d.x, color: colorScale(d.x) });
    }
  });

  const totalCols = Math.ceil(allDots.length / maxDotsPerCol);
  const colIndices = Array.from({ length: totalCols }, (_, i) => i);

  // 4. Angular Scale Construction
  const angleScale = d3
    .scaleBand()
    .domain(colIndices)
    .range([startAngle, endAngle])
    .paddingInner(0)
    .paddingOuter(0);

  // 5. Central Bubble Metric Calculations
  const currentSum = d3.sum(data, (d) => d.y);
  const normalizedRatio = yMax > 0 ? currentSum / yMax : 0;
  const bubbleRadius = maxBubbleRadius * Math.sqrt(normalizedRatio);

  const midAngle = (startAngle + endAngle) / 2;
  const bubbleX = bubbleOffsetRadius * Math.sin(midAngle);
  const bubbleY = -bubbleOffsetRadius * Math.cos(midAngle);

  const dotRadius = 8;

  // 6. DOM Rendering - Structural Group Definitions
  const linesGroup = g.append("g").attr("class", "converging-lines");
  const bubbleGroup = g.append("g").attr("class", "central-bubble");
  const dotsGroup = g.append("g").attr("class", "waffle-dots");
  const arcGroup = g.append("g").attr("class", "outer-arc");

  // 7. Outer Arc and Text Rendering
  const maxWaffleRadius = innerRadius + maxDotsPerCol * dotRadius * 2;
  const arcInnerR = maxWaffleRadius + 20;
  const arcOuterR = arcInnerR + 30;

  const angles = endAngle - startAngle;
  const arcGenerator = d3
    .arc()
    .innerRadius(arcInnerR)
    .outerRadius(arcOuterR)
    .startAngle(startAngle - angles * 0.05)
    .endAngle(endAngle + angles * 0.05)
    .cornerRadius(35);

  const arcColor = categoryColor;
  arcGroup.append("path").attr("d", arcGenerator).attr("fill", arcColor);

  const titleText = String(name ?? "");
  if (titleText.trim().length > 0) {
    const fontSizePx = 20;
    const fontWeight = "bold";
    const fontFamily = "Roboto";

    const baseTextRadius = (arcInnerR + arcOuterR) / 2;
    const arcAngleSpan = Math.abs(endAngle - startAngle);
    const availableArcLength = baseTextRadius * arcAngleSpan;

    let valueFontSize = 20;
    const charWidthAtFontSize =
      approxCharWidth * (valueFontSize ? fontSizePx / valueFontSize : 1);
    const estimatedTextWidth = titleText.length * charWidthAtFontSize;

    // Keep some padding so text doesn't touch the arc ends.
    const paddingPx = fontSizePx * 0.6;
    const fitsOnArc = estimatedTextWidth + paddingPx * 2 <= availableArcLength;

    // If it doesn't fit, push it outside the arc and use the arc's color.
    const targetRadius = fitsOnArc ? baseTextRadius : arcOuterR + fontSizePx;
    const titleFill = fitsOnArc ? "#333333" : arcColor;

    // Flip on the lower semicircle for readability (same logic as axis text paths).
    const twoPi = Math.PI * 2;
    const normalizeAngle = (a) => {
      let t = a % twoPi;
      if (t < 0) t += twoPi;
      return t;
    };
    const midAngleNorm = normalizeAngle((startAngle + endAngle) / 2);
    const shouldFlip =
      midAngleNorm >= Math.PI / 2 && midAngleNorm < (Math.PI * 3) / 2;

    // If the text doesn't fit, reserve extra path length so characters aren't clipped.
    // We extend the arc by a small angle buffer computed from the estimated text width.
    const desiredTextPathLength = estimatedTextWidth + paddingPx * 2;
    const desiredAngleSpan = desiredTextPathLength / Math.max(1, targetRadius);
    const overflowExtraAngleRaw = Math.max(
      0,
      (desiredAngleSpan - arcAngleSpan) / 2,
    );
    const overflowExtraAngle = fitsOnArc
      ? 0
      : Math.min(Math.PI / 2, overflowExtraAngleRaw * 1.15 + 0.02);

    let pathStartAngle = startAngle - overflowExtraAngle;
    let pathEndAngle = endAngle + overflowExtraAngle;
    let sweepFlag = 1;
    if (shouldFlip) {
      const tmp = pathStartAngle;
      pathStartAngle = pathEndAngle;
      pathEndAngle = tmp;
      sweepFlag = 0;
    }

    const adjustedRadius = targetRadius;
    const startX_arc = adjustedRadius * Math.sin(pathStartAngle);
    const startY_arc = -adjustedRadius * Math.cos(pathStartAngle);
    const endX_arc = adjustedRadius * Math.sin(pathEndAngle);
    const endY_arc = -adjustedRadius * Math.cos(pathEndAngle);
    const largeArcFlag =
      Math.abs(pathEndAngle - pathStartAngle) <= Math.PI ? 0 : 1;

    const textPathId = `arc-title-path-${Math.random().toString(36).substring(2, 11)}`;

    arcGroup
      .append("path")
      .attr("id", textPathId)
      .attr(
        "d",
        `M ${startX_arc} ${startY_arc} A ${adjustedRadius} ${adjustedRadius} 0 ${largeArcFlag} ${sweepFlag} ${endX_arc} ${endY_arc}`,
      )
      .style("fill", "none")
      .style("stroke", "none");

    arcGroup
      .append("text")
      .append("textPath")
      .attr("href", `#${textPathId}`)
      .attr("startOffset", "50%")
      .style("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", titleFill)
      .attr("font-size", `${fontSizePx}px`)
      .attr("font-weight", fontWeight)
      .attr("font-family", fontFamily)
      .text(titleText);
  }

  // 8. Cubic Bezier Curve Connections (Corrected Topology)
  colIndices.forEach((colIndex) => {
    const colAngle = angleScale(colIndex) + angleScale.bandwidth() / 2;
    const startX = innerRadius * Math.sin(colAngle);
    const startY = -innerRadius * Math.cos(colAngle);

    // Compute the Euclidean distance and direction vector from start to end
    const dx = bubbleX - startX;
    const dy = bubbleY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Compute the orthogonal unit normal for a smooth (non-self-intersecting) bend
    const nx = -dy / dist;
    const ny = dx / dist;

    // Set the normal curvature factor (tweak this scalar to control bulge)
    const curvature = 0.15;
    const offset = dist * curvature;

    // Compute control points using 40%/60% interpolation plus normal offset
    const cp1X = startX + dx * 0.4 + nx * offset;
    const cp1Y = startY + dy * 0.4 + ny * offset;
    const cp2X = startX + dx * 0.6 + nx * offset;
    const cp2Y = startY + dy * 0.6 + ny * offset;

    linesGroup
      .append("path")
      .attr(
        "d",
        `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${bubbleX} ${bubbleY}`,
      )
      .attr("fill", "none")
      .attr("stroke", categoryColor)
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.5);
  });

  // 9. Waffle Matrix Rendering
  const dotPadding = 2;
  allDots.forEach((dot, index) => {
    const colIndex = Math.floor(index / maxDotsPerCol);
    const rowIndex = index % maxDotsPerCol;

    const colAngle = angleScale(colIndex) + angleScale.bandwidth() / 2;
    const cosAngle = Math.cos(colAngle);
    const sinAngle = Math.sin(colAngle);

    const r = innerRadius + rowIndex * (dotRadius * 2 + dotPadding) + dotRadius;

    dotsGroup
      .append("circle")
      .attr("cx", r * sinAngle)
      .attr("cy", -r * cosAngle)
      .attr("r", dotRadius)
      .attr("fill", dot.color);
  });

  // 10. Central Bubble Rendering
  bubbleGroup
    .append("circle")
    .attr("cx", bubbleX)
    .attr("cy", bubbleY)
    .attr("r", bubbleRadius)
    .attr("fill", categoryColor)
    .attr("opacity", 0.9);

  if (showLabels && bubbleRadius > 10) {
    bubbleGroup
      .append("text")
      .attr("x", bubbleX)
      .attr("y", bubbleY)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "#333333")
      .attr("font-size", `${Math.max(10, bubbleRadius * 0.4)}px`)
      .attr("font-family", "sans-serif")
      .attr("font-weight", "bold")
      .text(valueFormat(currentSum));
  }
}
