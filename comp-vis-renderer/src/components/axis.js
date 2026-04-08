import * as d3 from "d3";
import { lineRadial, curveNatural } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { globalSettings } from "../core/global.js";
import { mySum } from "../utils/maths.js";
import { createBrace } from "./helper.js";
import { iconMaps } from "../utils/iconMap.js";

const opacity = 0.5;
const approxCharWidth = globalSettings.valueCharWidth;

function generateTextPath(
  radius,
  startAngle,
  endAngle,
  type,
  text = null,
  fontSize = null,
) {
  let midAngle = (startAngle + endAngle) / 2;
  if (type === "x") {
    const threshold = 0.3;
    if (Math.abs(midAngle - Math.PI / 2) < threshold) midAngle = Math.PI / 2;
    else if (Math.abs(midAngle - Math.PI) < threshold) midAngle = Math.PI;
    else if (Math.abs(midAngle - (Math.PI * 3) / 2) < threshold)
      midAngle = (Math.PI * 3) / 2;
  }

  let pathStartAngle = midAngle - Math.PI / 2;
  let pathEndAngle = midAngle + Math.PI / 2;
  let offset = 0;

  if (type === "y") {
    offset = text && text.length <= 8 ? 40 : 60;
    pathStartAngle = startAngle - offset / radius;
    pathEndAngle = pathStartAngle + Math.PI;
  }

  let sweepFlag = 1;
  if (
    (type === "x" || type === "union") &&
    midAngle >= Math.PI / 2 &&
    midAngle < (Math.PI * 3) / 2
  ) {
    const tmpAngle = pathStartAngle;
    pathStartAngle = pathEndAngle;
    pathEndAngle = tmpAngle;
    sweepFlag = 0;
  }

  if (
    type === "y" &&
    pathStartAngle >= Math.PI / 2 &&
    pathStartAngle < (Math.PI * 3) / 2
  ) {
    sweepFlag = 0;
    pathStartAngle += (2 * offset) / radius;
    pathEndAngle = pathStartAngle + Math.PI;
  }
  fontSize = fontSize || 18;
  const adjustedRadius = sweepFlag === 1 ? radius : radius + fontSize / 2;

  const startX = adjustedRadius * Math.sin(pathStartAngle);
  const startY = -adjustedRadius * Math.cos(pathStartAngle);
  const endX = adjustedRadius * Math.sin(pathEndAngle);
  const endY = -adjustedRadius * Math.cos(pathEndAngle);

  const largeArcFlag =
    Math.abs(pathEndAngle - pathStartAngle) <= Math.PI ? 0 : 1;

  const textPathData = `M ${startX},${startY} A ${adjustedRadius},${adjustedRadius} 0 ${largeArcFlag} ${sweepFlag} ${endX},${endY}`;
  const pathId = `axis-name-path-${Math.random().toString(36).substring(2, 9)}`; // Unique ID
  return { textPathData, pathId };
}

// copied from d3-radial-axis
function identity(x) {
  return x;
}
function translate(x, y) {
  return "translate(" + x + "," + y + ")";
}
function center(scale) {
  let offset = scale.bandwidth() / 2;
  if (scale.round()) offset = Math.round(offset);
  return function (d) {
    return scale(d) + offset;
  };
}
function entering() {
  return !this.__axis;
}

function radialAxis(angleScale, startRadius, endRadius, outer) {
  let tickArguments = [],
    tickValues = null,
    tickFormat = null,
    tickSizeInner = 6,
    tickSizeOuter = 0,
    tickPadding = 5;
  function angleTransform(angle, radius) {
    return translate.apply(translate, polar2cart(angle, radius));
  }
  function polar2cart(angle, r) {
    return [Math.sin(angle) * r, -Math.cos(angle) * r];
  }
  function axis(context) {
    let isSpiral = endRadius !== undefined && startRadius !== endRadius;
    endRadius = !isSpiral ? startRadius : endRadius;
    let values =
        tickValues == null
          ? angleScale.ticks
            ? angleScale.ticks.apply(angleScale, tickArguments)
            : angleScale.domain()
          : tickValues,
      format =
        tickFormat == null
          ? angleScale.tickFormat
            ? angleScale.tickFormat.apply(angleScale, tickArguments)
            : identity
          : tickFormat,
      spacing = Math.max(tickSizeInner, 0) + tickPadding,
      radiusScale = angleScale.copy().range([startRadius, endRadius]),
      angleRange = angleScale.range(),
      anglePos = (angleScale.bandwidth ? center : identity)(angleScale.copy()),
      selection = context.selection ? context.selection() : context,
      path = selection.selectAll(".domain").data([null]),
      tick = selection.selectAll(".tick").data(values, angleScale).order(),
      tickExit = tick.exit(),
      tickEnter = tick.enter().append("g").attr("class", "tick"),
      line = tick.select("line"),
      text = tick.select("text");
    path = path.merge(
      path
        .enter()
        .insert("path", ".tick")
        .attr("class", "domain")
        .attr("stroke", globalSettings.textColorDark)
        .attr("opacity", opacity),
    );
    tick = tick.merge(tickEnter);
    line = line.merge(
      tickEnter.append("line").attr("stroke", globalSettings.textColorDark),
    );
    text = text.merge(
      tickEnter
        .append("text")
        .attr("fill", globalSettings.textColorDark)
        .attr("font-size", globalSettings.getFontSize("value"))
        .attr("dy", ".35em")
        .style("text-anchor", "middle"),
    );
    if (context !== selection) {
      path = path.transition(context);
      tick = tick.transition(context);
      line = line.transition(context);
      text = text.transition(context);
      tickExit = tickExit
        .transition(context)
        .attr("opacity", 0)
        .attr("transform", function (d) {
          return isFinite(anglePos(d))
            ? angleTransform(anglePos(d), radiusScale(d))
            : this.getAttribute("transform");
        });
      tickEnter.attr("opacity", 0).attr("transform", function (d) {
        let p = this.parentNode.__axis;
        return angleTransform(
          p && isFinite((p = p(d))) ? p : anglePos(d),
          radiusScale(d),
        );
      });
    }
    tickExit.remove();
    function getTickPath(angle, r) {
      return (
        "M" +
        polar2cart(angle, r + tickSizeOuter * (outer ? 1 : -1)).join(",") +
        "L" +
        polar2cart(angle, r).join(",")
      );
    }
    function getArcPath(startAngle, endAngle, r) {
      return (
        "M" +
        polar2cart(startAngle, r).join(",") +
        (Math.abs(endAngle - startAngle) >= 2 * Math.PI // Full-circle
          ? "A" +
            [r, r, 0, 1, 1]
              .concat(polar2cart(startAngle + Math.PI, r))
              .join(",") +
            "A" +
            [r, r, 0, 1, 1].concat(polar2cart(startAngle, r)).join(",")
          : "") +
        "A" +
        [
          r,
          r,
          0,
          Math.abs(endAngle - startAngle) % (2 * Math.PI) > Math.PI ? 1 : 0,
          // Large arc flag
          endAngle > startAngle ? 1 : 0, // Sweep (clock-wise) flag
        ]
          .concat(polar2cart(endAngle, r))
          .join(",")
      );
    }
    function getSpiralPath(startAngle, endAngle, startR, endR) {
      let numPoints = ((endAngle - startAngle) / (Math.PI * 2)) * 40; // 40 points per 360deg

      let lineGen = lineRadial()
        .angle(scaleLinear().range([startAngle, endAngle]))
        .radius(scaleLinear().range([startR, endR]))
        .curve(curveNatural);
      return (
        "M" +
        polar2cart(startAngle, startR).join(",") +
        lineGen(scaleLinear().ticks(numPoints))
      );
    }
    path.attr(
      "d",
      (isSpiral ? getSpiralPath : getArcPath)(
        angleRange[0],
        angleRange[1],
        startRadius,
        endRadius,
      ) +
        getTickPath(angleRange[0], startRadius) +
        getTickPath(angleRange[1], endRadius),
    );
    tick.attr("opacity", 1).attr("transform", function (d) {
      return angleTransform(anglePos(d), radiusScale(d));
    });
    line
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", function (d) {
        return polar2cart(anglePos(d), tickSizeInner)[0] * (outer ? 1 : -1);
      })
      .attr("y2", function (d) {
        return polar2cart(anglePos(d), tickSizeInner)[1] * (outer ? 1 : -1);
      })
      .attr("opacity", opacity);
    text
      .attr("x", function (d) {
        return polar2cart(anglePos(d), spacing)[0] * (outer ? 1 : -1);
      })
      .attr("y", function (d) {
        return polar2cart(anglePos(d), spacing)[1] * (outer ? 1 : -1);
      })
      .style("text-anchor", function (d) {
        const angle = anglePos(d);
        const normalizedAngle =
          ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        return (normalizedAngle > Math.PI) ^ outer ? "start" : "end";
      })
      .text(format)
      .attr("transform", function (d) {
        const angle = anglePos(d);
        const rotation =
          angle > Math.PI
            ? (angle * 180) / Math.PI + 90
            : (angle * 180) / Math.PI - 90;

        const coords = polar2cart(angle, spacing);
        const x = coords[0] * (outer ? 1 : -1);
        const y = coords[1] * (outer ? 1 : -1);
        return `rotate(${rotation}, ${x}, ${y})`;
      });

    globalSettings.setFont(text, "value");

    selection.filter(entering).attr("fill", "none");
    globalSettings.setFont(selection, "value");

    selection.each(function () {
      this.__axis = anglePos;
    });
  }
  axis.angleScale = function (_) {
    return arguments.length ? ((angleScale = _), axis) : angleScale;
  };
  axis.radius = function (_) {
    return arguments.length
      ? ((startRadius = endRadius = +_), axis)
      : startRadius;
  };
  axis.startRadius = function (_) {
    return arguments.length ? ((startRadius = +_), axis) : startRadius;
  };
  axis.endRadius = function (_) {
    return arguments.length ? ((endRadius = +_), axis) : endRadius;
  };
  axis.ticks = function () {
    return (tickArguments = Array.prototype.slice.call(arguments)), axis;
  };
  axis.tickArguments = function (_) {
    return arguments.length
      ? ((tickArguments = _ == null ? [] : Array.prototype.slice.call(_)), axis)
      : tickArguments.slice();
  };
  axis.tickValues = function (_) {
    return arguments.length
      ? ((tickValues = _ == null ? null : Array.prototype.slice.call(_)), axis)
      : tickValues && tickValues.slice();
  };
  axis.tickFormat = function (_) {
    return arguments.length ? ((tickFormat = _), axis) : tickFormat;
  };
  axis.tickSize = function (_) {
    return arguments.length
      ? ((tickSizeInner = tickSizeOuter = +_), axis)
      : tickSizeInner;
  };
  axis.tickSizeInner = function (_) {
    return arguments.length ? ((tickSizeInner = +_), axis) : tickSizeInner;
  };
  axis.tickSizeOuter = function (_) {
    return arguments.length ? ((tickSizeOuter = +_), axis) : tickSizeOuter;
  };
  axis.tickPadding = function (_) {
    return arguments.length ? ((tickPadding = +_), axis) : tickPadding;
  };
  return axis;
}

/**
 * Creates an internal radial axis with dynamically calculated tick values
 *
 * @param {function} angleScale - Angle scale function
 * @param {number} startRadius - Starting radius
 * @param {number} [endRadius] - Ending radius (for spiral)
 * @param {Object} [options] - Configuration options
 * @param {number} [options.arcLength] - Arc length (for calculating tick count)
 * @param {number} [options.minTicks=2] - Minimum number of ticks
 * @param {string} [options.fontStyle="default"] - The font style of the axis labels.
 * @returns {function} Configured radial axis function
 */
export function axisRadialInner(
  angleScale,
  startRadius,
  endRadius,
  options = {},
) {
  const {
    allInteger = false,
    fontStyle = "default",
    ...otherOptions
  } = options;
  const axis = radialAxis(angleScale, startRadius, endRadius, false);

  // Calculate arc length or use default value
  const arcLength =
    options.arcLength ||
    Math.abs(angleScale.range()[1] - angleScale.range()[0]) * 200;

  // Use calculateTickValues to compute appropriate tick values
  // For radial axes, use "circular" as the orientation parameter
  const tickValues = calculateTickValues(angleScale, arcLength, "circular", {
    allInteger,
    ...otherOptions,
  });

  // Set tick values
  axis.tickValues(tickValues);

  if (allInteger) {
    axis.tickFormat((d) => globalSettings.format(d));
  }

  axis.fontStyle = fontStyle;

  return [axis, tickValues];
}

/**
 * Creates an external radial axis with dynamically calculated tick values
 *
 * @param {function} angleScale - Angle scale function
 * @param {number} startRadius - Starting radius
 * @param {number} [endRadius] - Ending radius (for spiral)
 * @param {Object} [options] - Configuration options
 * @param {number} [options.arcLength] - Arc length (for calculating tick count)
 * @param {number} [options.minTicks=2] - Minimum number of ticks
 * @param {string} [options.fontStyle="default"] - The font style of the axis labels.
 * @returns {function} Configured radial axis function
 */
export function axisRadialOuter(
  angleScale,
  startRadius,
  endRadius,
  options = {},
) {
  const {
    allInteger = false,
    fontStyle = "default",
    ...otherOptions
  } = options;
  const axis = radialAxis(angleScale, startRadius, endRadius, true);

  // Calculate arc length or use default value
  const arcLength =
    options.arcLength ||
    Math.abs(angleScale.range()[1] - angleScale.range()[0]) * 200;

  // Use calculateTickValues to compute appropriate tick values
  // For radial axes, use "circular" as the orientation parameter
  const tickValues = calculateTickValues(angleScale, arcLength, "circular", {
    allInteger,
    ...otherOptions,
  });

  // Set tick values
  axis.tickValues(tickValues);

  if (allInteger) {
    axis.tickFormat((d) => globalSettings.format(d));
  }

  axis.fontStyle = fontStyle;

  return [axis, tickValues];
}

/**
 * Draws a polar axis.
 *
 * @param {Object} g - D3 selection of the group element to render the axis.
 * @param {number} angle - The angle of the axis.
 * @param {string} pos - Position of axis ("left", "right").
 * @param {function} scale - D3 scale function.
 * @param {Object} [options] - Configuration options
 * @param {number} [options.offset=10] - Offset between each tick and its corresponding text.
 * @param {number} [options.minTicks=2] - Minimum number of ticks
 * @param {string} [options.fontStyle="default"] - The font style of the axis labels.
 */
export function axisPolar(g, angle, pos, scale, options = {}) {
  if (pos.includes("_noname")) {
    pos = pos.replace("_noname", "");
  }
  const axisLength = Math.abs(scale.range()[1] - scale.range()[0]);
  const { offset = 10, allInteger = false, ...tickOptions } = options;
  let axisGroup = null;

  // Calculate appropriate tick values
  // For polar axes, use "radial" as the orientation
  const tickValues = calculateTickValues(scale, axisLength || 200, "radial", {
    allInteger,
    ...tickOptions,
  });

  if (pos === "left") {
    const tickFormat = allInteger
      ? (d) => (Number.isInteger(d) ? d.toString() : d.toFixed(0))
      : null;

    const axis = d3
      .axisRight(scale)
      .tickValues(tickValues)
      .tickFormat(tickFormat)
      .tickSizeOuter(0);

    const rotationAngle = angle * (180 / Math.PI) + 180;
    axisGroup = g
      .append("g")
      .attr("transform", `rotate(${rotationAngle})`)
      .call(axis);

    axisGroup
      .selectAll(".tick text")
      .attr("fill", globalSettings.textColorDark);
    if (angle <= Math.PI / 2 || angle > (Math.PI * 3) / 2) {
      axisGroup
        .selectAll(".tick text")
        .attr("transform", "rotate(180)")
        .attr("text-anchor", "end")
        .attr("dx", "-1.5em");
    }
  } else if (pos === "right") {
    const tickFormat = allInteger
      ? (d) => (Number.isInteger(d) ? d.toString() : d.toFixed(0))
      : null;

    const axis = d3
      .axisLeft(scale)
      .tickValues(tickValues)
      .tickFormat(tickFormat)
      .tickSizeOuter(0);

    const rotationAngle = angle * (180 / Math.PI) + 180;
    axisGroup = g
      .append("g")
      .attr("transform", `rotate(${rotationAngle})`)
      .call(axis);

    axisGroup
      .selectAll(".tick text")
      .attr("fill", globalSettings.textColorDark);
    if (angle <= Math.PI / 2 || angle > (Math.PI * 3) / 2) {
      axisGroup
        .selectAll(".tick text")
        .attr("transform", "rotate(180)")
        .attr("text-anchor", "start")
        .attr("dx", "1.5em");
    }
  }

  if (axisGroup) {
    axisGroup
      .selectAll(".tick line")
      .attr("opacity", opacity)
      .attr("stroke", globalSettings.textColorDark);
    axisGroup
      .selectAll(".domain")
      .attr("opacity", opacity)
      .attr("stroke", globalSettings.textColorDark);

    axisGroup.selectAll(".tick text").each(function () {
      globalSettings.setFont(d3.select(this), "value");
    });
  }

  return tickValues;
}

/**
 * Calculate appropriate tick values
 *
 * @param {function} scale - D3 scale function
 * @param {number} size - Available space size for the axis (width or height)
 * @param {string|boolean} orientation - Axis orientation: "horizontal", "vertical", "circular", "radial", or boolean (true for horizontal)
 * @param {Object} [options] - Configuration options
 * @param {number} [options.minTicks=2] - Minimum number of ticks
 * @param {number} [options.approxTickSize=30] - Approximate tick size (pixels)
 * @param {number} [options.approxCharHeight=13] - Approximate character height (pixels)
 * @param {string} [options.chartType] - Chart type (for line chart time data sampling)
 * @returns {Array} Calculated tick values array
 */
export function calculateTickValues(scale, size, orientation, options = {}) {
  const {
    minTicks = 2,
    approxTickSize = 30 * globalSettings.fontRatio,
    approxCharHeight = 13 * globalSettings.fontRatio,
    chartType = "",
    allInteger = false,
  } = options;

  if (size === 0) return [];

  // Determine if horizontal orientation
  let isHorizontalorCircular;
  if (typeof orientation === "boolean") {
    isHorizontalorCircular = orientation;
  } else {
    isHorizontalorCircular =
      orientation === "horizontal" || orientation === "circular";
  }

  let tickValues;
  const fieldValue = scale.domain()[0];

  function isTimeString(str) {
    if (typeof str !== "string") return false;

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const yearRangePattern = /^\d{4}~\d{4}$/;
    const yearPattern = /^\d{4}$/;

    return (
      datePattern.test(str) ||
      yearRangePattern.test(str) ||
      yearPattern.test(str)
    );
  }

  if (typeof fieldValue === "string") {
    const domain = scale.domain();

    if (chartType.toLowerCase() === "line" && domain.every(isTimeString)) {
      let maxLabels = minTicks;
      if (isHorizontalorCircular) {
        let avgLabelWidth =
          (domain.reduce((sum, d) => sum + d.toString().length, 0) /
            domain.length) *
          approxCharWidth;
        maxLabels = Math.max(minTicks, Math.floor(size / (avgLabelWidth + 10)));
      } else {
        maxLabels = Math.max(
          minTicks,
          Math.floor(size / (approxCharHeight + 10)),
        );
      }

      if (domain.length <= maxLabels) {
        return domain;
      } else {
        const sampled = [];
        const step = Math.ceil((domain.length - 1) / (maxLabels - 1));

        for (let i = 0; i < domain.length; i += step) {
          sampled.push(domain[i]);
        }
        return sampled;
      }
    } else {
      return Array.from(scale.domain());
    }
  } else {
    let maxDomain = Math.max(...scale.domain());
    if (maxDomain > 10) {
      maxDomain = Math.floor(maxDomain);
    }
    const maxDomainDigits = (maxDomain.toString().length * 4) / 3;
    let minSpaceBetweenTicks = approxTickSize;
    if (isHorizontalorCircular) {
      minSpaceBetweenTicks = Math.max(
        minSpaceBetweenTicks,
        maxDomainDigits * (approxCharWidth + 2),
      );
    } else {
      minSpaceBetweenTicks = Math.max(minSpaceBetweenTicks, approxCharHeight);
    }

    // For circular axes, adjust tick spacing for rotation
    if (orientation === "circular") {
      minSpaceBetweenTicks *= Math.sqrt(2);
    }

    const tickNum = Math.max(
      minTicks,
      Math.min(10, Math.floor(size / minSpaceBetweenTicks)),
    );

    tickValues = scale.ticks(tickNum);
    if (tickValues.length < 2) {
      const [min, max] = scale.domain();
      tickValues = [Math.ceil(min), Math.floor(max)];
    }
    if (tickNum === 2 && tickValues.length > 2) {
      tickValues = [tickValues[0], tickValues[tickValues.length - 1]];
    }

    if (allInteger) {
      const [min, max] = scale.domain();

      if (tickValues.length <= 2) {
        tickValues = [Math.ceil(min), Math.floor(max)];
        if (tickValues[0] >= tickValues[1]) {
          tickValues = [Math.floor(min), Math.ceil(max)];
        }
      } else {
        const range = max - min;
        const idealStep = range / (tickNum - 1);

        let step = Math.max(1, Math.ceil(idealStep));
        const integerTicks = [];
        let start = Math.floor(min);

        while (start > min) start--;
        for (let i = 0; i < tickNum * 2 && start <= max; i++) {
          if (start >= min) {
            integerTicks.push(start);
          }
          start += step;
        }

        if (integerTicks.length > tickNum) {
          const stepSize = Math.ceil(integerTicks.length / tickNum);
          tickValues = integerTicks.filter((_, i) => i % stepSize === 0);

          if (tickValues[tickValues.length - 1] < max - step) {
            tickValues.push(Math.floor(max));
          }
        } else {
          tickValues = integerTicks;
        }
      }
    }
  }

  return tickValues;
}

/**
 * Creates a Cartesian axis with automatic tick handling and label rotation.
 *
 * @param {Object} g - D3 selection of the group element to render the axis.
 * @param {string} pos - Position of axis ("left", "right", "top", "bottom").
 * @param {function} scale - D3 scale function.
 * @param {number} width - The width available for the axis.
 * @param {number} height - The height available for the axis.
 * @param {string} field - The field name to get values from the data ("x" or "y").
 * @param {Object} [options] - Additional options for axis creation.
 * @param {number} [options.minTicks=2] - Minimum number of ticks to show.
 * @param {number} [options.approxTickSize=40] - Approximate size per tick in pixels.
 * @param {string} [options.fontStyle="default"] - The font style for the axis labels.
 * @param {boolean} [options.allInteger=false] - Whether to format ticks as integers.
 * @param {string} [options.fakeAxis="none"] - Whether to calculate ticks only and not render the axis.
 */
export function axisCartesian(
  g,
  pos,
  scale,
  width,
  height,
  field,
  options = {},
) {
  if (pos.includes("_noname")) pos = pos.replace("_noname", "");

  const {
    allInteger = false,
    fakeAxis = "none",
    border = false,
    ...otherOptions
  } = options;

  const isHorizontal =
    pos === "top" || pos === "bottom" || fakeAxis === "horizontal";
  const size = isHorizontal ? width : height;
  const orientation = isHorizontal ? "horizontal" : "vertical";

  // Use the extracted function to calculate tick values
  const tickValues = calculateTickValues(scale, size, orientation, {
    allInteger,
    ...otherOptions,
  });

  if (fakeAxis === "horizontal" || fakeAxis === "vertical") {
    return tickValues;
  }

  const tickFormat = allInteger
    ? (d) => (Number.isInteger(d) ? d.toString() : d.toFixed(0))
    : null;

  // Create axis based on position
  let axis;
  switch (pos) {
    case "left":
      axis = d3.axisLeft(scale);
      break;
    case "right":
      axis = d3.axisRight(scale);
      break;
    case "top":
      axis = d3.axisTop(scale);
      break;
    case "bottom":
      axis = d3.axisBottom(scale);
      break;
  }

  // Apply tick values and format
  axis.tickValues(tickValues);
  if (tickFormat) axis.tickFormat(tickFormat);
  const tickLength = border ? 0 : 5;
  axis.tickSizeInner(tickLength);
  axis.tickSizeOuter(tickLength);

  // Create and transform the axis group
  const axisGroup = g
    .append("g")
    .attr("class", "axis")
    .append("g")
    .attr("class", isHorizontal ? "x-axis" : "y-axis");

  // Apply position-specific transforms
  if (pos === "bottom") axisGroup.attr("transform", `translate(0,${height})`);
  else if (pos === "right")
    axisGroup.attr("transform", `translate(${width},0)`);

  axisGroup.call((axisg) => {
    axisg.call(axis);
    let replaceAxis = false;
    const tickNodes = axisg.selectAll(".tick");
    if (tickNodes.size() > 0) {
      const availableSpace = isHorizontal ? width : height;
      const totalLabelLength = mySum(
        tickValues.map((val) => String(val).length),
      );
      if (
        isHorizontal &&
        availableSpace < totalLabelLength * approxCharWidth &&
        tickValues.every((val) => typeof val === "string")
      ) {
        tickNodes.remove();
        replaceAxis = true;
        if (options?.chartType?.includes("bar")) {
          const n = tickValues.length;
          const p = 0.3; // innerPadding = 0.3, outerPadding = 0
          const gapWidth = (p * width) / (n + (n - 1) * p);
          const barWidth = (width - (n - 1) * gapWidth) / n;
          const axisIcons = options?.icons || null;
          tickValues.forEach((value, i) => {
            const x = i * (barWidth + gapWidth);
            const y = pos === "bottom" ? height : 0;
            const iconUrl = axisIcons ? axisIcons[value] : null;

            if (iconUrl) {
              const shift = border ? 5 : 0;
              const iconSize = Math.max(
                globalSettings.getFontSize("value"),
                Math.min(20, barWidth),
              );
              const iconX = x + barWidth / 2 - iconSize / 2;
              const iconY =
                pos === "bottom" ? 5 + shift : -iconSize - 5 - shift;

              axisGroup
                .append("image")
                .attr("xlink:href", iconUrl)
                .attr("x", iconX)
                .attr("y", iconY)
                .attr("width", iconSize)
                .attr("height", iconSize)
                .attr("preserveAspectRatio", "xMidYMid meet");
              return;
            }

            const textContent = String(value);
            const padding = 5; // Padding around the text
            const bgHeight =
              textContent.length * globalSettings.valueCharWidth + padding * 2; // Estimate text width
            const bgWidth = 18; // Background height

            const labelX = x + 0.5 * (barWidth - bgWidth);
            const shift = border ? 5 : 0;
            const labelY = pos === "bottom" ? 5 + shift : -bgHeight - 5 - shift;

            axisGroup
              .append("rect")
              .attr("class", "bar-label-bg")
              .attr("x", labelX)
              .attr("y", labelY)
              .attr("width", bgWidth)
              .attr("height", bgHeight)
              .attr("fill", globalSettings.textColorDark)
              .attr("opacity", 0.2)
              .attr("rx", 3) // Rounded corners
              .attr("ry", 3);

            axisGroup
              .append("text")
              .attr("class", "bar-label")
              .attr("x", labelX + bgWidth / 2) // Horizontally center text in the rectangle
              .attr("y", labelY + bgHeight / 2) // Vertically center text in the rectangle
              .attr("text-anchor", "middle") // Use centered alignment instead of start
              .attr("dominant-baseline", "middle") // Vertically centered
              .attr(
                "transform",
                `rotate(-90, ${labelX + bgWidth / 2}, ${labelY + bgHeight / 2})`,
              )
              .attr("fill", globalSettings.textColorLight)
              .attr("font-weight", "bold")
              .text(value);
          });
        }
      }
    }
    if (!replaceAxis) {
      const axisColor = options.axisColor || globalSettings.textColorDark;
      axisGroup
        .selectAll(".tick text")
        .attr("font-weight", "bold")
        .attr("fill", globalSettings.textColorDark);
      axisGroup.selectAll(".tick line").attr("stroke", axisColor);
      axisGroup.selectAll(".domain").attr("stroke", axisColor);

      if (border) {
        const shift = 5;
        axisGroup.selectAll(".tick text").attr("transform", function () {
          const currentTransform = d3.select(this).attr("transform") || "";
          let x = 0,
            y = 0;
          if (pos === "bottom") y = shift;
          if (pos === "top") y = -shift;
          if (pos === "left") x = -shift;
          if (pos === "right") x = shift;
          return `${currentTransform} translate(${x}, ${y})`;
        });
      }
    }
  });

  axisGroup.selectAll(".tick line").attr("opacity", opacity);
  axisGroup.selectAll(".domain").attr("opacity", opacity);
  axisGroup.selectAll(".tick text").each(function () {
    globalSettings.setFont(d3.select(this), "value");
  });
  globalSettings.setFont(axisGroup, "value");
  return tickValues;
}

function _addAxisNameCartesian(g, dir, axisName, width, height, margin) {
  if (!axisName) return;
  if (!["top", "bottom", "left", "right"].includes(dir)) return;
  axisName = axisName.charAt(0).toUpperCase() + axisName.slice(1).toLowerCase();
  margin = margin || 20; // Default margin if not provided

  let x, y;
  let transform = null;

  switch (dir) {
    case "top":
      [x, y] = [width / 2, -margin];
      break;
    case "bottom":
      [x, y] = [width / 2, height + margin * 1.2];
      break;
    case "left":
      transform = `rotate(-90) translate(${-height / 2}, ${-margin})`;
      break;
    case "right":
      transform = `rotate(-90) translate(${-height / 2}, ${width + margin * 1.2})`;
      break;
  }

  const text = g
    .append("text")
    .attr("fill", globalSettings.textColorDark)
    .attr("text-anchor", "middle")
    .attr("font-weight", "bold")
    .text(axisName);
  globalSettings.setFont(text, "value");

  if (transform) text.attr("transform", transform);
  else text.attr("x", x).attr("y", y);
}

export function addAxisNameCartesianLink(g, config) {
  g = g.append("g").attr("class", "axis");
  let axes = null;
  if (["top", "bottom"].includes(config.operationPos))
    axes = [config.xAxis, config.xAxis2];
  else axes = [config.yAxis, config.yAxis2];

  for (const axis of axes) {
    _addAxisNameCartesian(
      g,
      axis.display,
      axis.name,
      config.width,
      config.height,
      axis.size,
    );
  }
}

export function addAxisNameCartesian(g, config) {
  g = g.append("g").attr("class", "axis");
  for (const axis of [config.xAxis, config.yAxis]) {
    _addAxisNameCartesian(
      g,
      axis.display,
      axis.name,
      config.width,
      config.height,
      axis.size,
    );
  }
}

function _addAxisNamePolar(
  g,
  dir,
  axisName,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  margin,
) {
  if (!axisName) return;
  const allowedDirList = ["top", "bottom", "left", "right"];
  if (!allowedDirList.includes(dir)) return;
  g = g.append("g").attr("class", "axis-name");
  axisName = axisName.charAt(0).toUpperCase() + axisName.slice(1).toLowerCase();
  const fontSize = globalSettings.getFontSize("value") + 2;
  const fillColor = globalSettings.textColorDark;

  if (dir === "top" || dir === "bottom") {
    let radius =
      dir === "top"
        ? outerRadius + margin + fontSize
        : innerRadius - margin - fontSize;

    const { textPathData, pathId } = generateTextPath(
      radius,
      startAngle,
      endAngle,
      "x",
    );

    g.append("path")
      .attr("d", textPathData)
      .attr("id", pathId)
      .attr("fill", "none")
      .attr("stroke", "none");

    const text = g
      .append("text")
      .attr("fill", fillColor)
      .style("font-weight", "bold");
    globalSettings.setFont(text, "value");

    text
      .append("textPath")
      .attr("xlink:href", `#${pathId}`)
      .attr("startOffset", "50%")
      .attr("text-anchor", "middle")
      .text(axisName);
  } else if (dir === "left" || dir === "right") {
    const radius = outerRadius + margin;
    let textPathData, pathId;

    // Check whether we can use a straight path: startAngle is 0 and dir is left
    if (startAngle === 0 && dir === "left") {
      // Use a straight-line path
      const lineLength = (axisName.length * fontSize * 2) / 3; // Estimate text length
      const startX = -lineLength / 2;
      const startY = -radius;
      const endX = lineLength / 2;
      const endY = -radius;

      textPathData = `M ${startX},${startY} L ${endX},${endY}`;
      pathId = `axis-name-path-${Math.random().toString(36).substring(2, 9)}`;
    } else {
      // Use the original arc path
      const result = generateTextPath(
        radius,
        startAngle,
        endAngle,
        "y",
        axisName,
      );
      textPathData = result.textPathData;
      pathId = result.pathId;
    }
    g.append("path")
      .attr("d", textPathData)
      .attr("id", pathId)
      .attr("fill", "none")
      .attr("stroke", "none");

    const text = g
      .append("text")
      .attr("fill", fillColor)
      .style("font-weight", "bold");
    globalSettings.setFont(text, "value");

    text
      .append("textPath")
      .attr("xlink:href", `#${pathId}`)
      .attr("startOffset", dir === "left" ? "0%" : "100%")
      .attr("text-anchor", dir === "left" ? "start" : "end")
      .text(axisName);
  }
}

export function addAxisNamePolar(g, config) {
  g = g.append("g").attr("class", "axis");
  const axisNameMargin = Math.min(15 * globalSettings.fontRatio, 20);
  _addAxisNamePolar(
    g,
    config.xAxis.display,
    config.xAxis.name,
    config.startAngle,
    config.endAngle,
    config.innerRadius,
    config.outerRadius,
    config.xAxis.size,
  );
  _addAxisNamePolar(
    g,
    config.yAxis.display,
    config.yAxis.name,
    config.startAngle,
    config.endAngle,
    config.innerRadius,
    config.outerRadius,
    axisNameMargin,
  );
}

export function handleAngleAxisTickValues(
  angleTickValues,
  startAngle,
  endAngle,
) {
  if (angleTickValues.length > 1) {
    angleTickValues = angleTickValues.slice(0, -1);
  }
  return angleTickValues;
}

/**
 * Adds a baseline indicator line for Cartesian charts if 0 is within the scale domain.
 * @param {d3.Selection} g - The D3 group element.
 * @param {d3.ScaleLinear} scale - The linear scale for the quantitative axis.
 * @param {number} width - The chart width.
 * @param {number} height - The chart height.
 * @param {string} orientation - 'vertical' or 'horizontal'.
 */
export function addCartesianBaseline(g, scale, width, height, orientation) {
  const [minValue, maxValue] = scale.domain();

  if (minValue <= 0 && maxValue >= 0) {
    const baselinePos = scale(0);

    let x1, y1, x2, y2;
    if (orientation === "vertical") {
      // Ensure the baseline is within the chart height bounds
      if (baselinePos >= 0 && baselinePos <= height) {
        x1 = 0;
        y1 = baselinePos;
        x2 = width;
        y2 = baselinePos;
      } else {
        return; // Baseline outside visible area
      }
    } else {
      // horizontal
      // Ensure the baseline is within the chart width bounds
      if (baselinePos >= 0 && baselinePos <= width) {
        x1 = baselinePos;
        y1 = 0;
        x2 = baselinePos;
        y2 = height;
      } else {
        return; // Baseline outside visible area
      }
    }

    g.append("line")
      .attr("class", "baseline")
      .attr("x1", x1)
      .attr("y1", y1)
      .attr("x2", x2)
      .attr("y2", y2)
      .attr("stroke", globalSettings.helperColor)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "2,2") // Dashed line
      .lower(); // Ensure line is behind other elements
  }
}

/**
 * Adds a baseline indicator arc or radial line for Polar charts if 0 is within the scale domain.
 * @param {d3.Selection} g - The D3 group element.
 * @param {d3.ScaleLinear} scale - The linear scale for the quantitative dimension (radius or angle).
 * @param {number} startAngle - Start angle for the chart segment.
 * @param {number} endAngle - End angle for the chart segment.
 * @param {number} innerRadius - Inner radius for the chart segment.
 * @param {number} outerRadius - Outer radius for the chart segment.
 * @param {string} type - 'radial' (value maps to radius) or 'circular' (value maps to angle).
 */
export function addPolarBaseline(
  g,
  scale,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  type,
) {
  const [minValue, maxValue] = scale.domain();

  if (minValue <= 0 && maxValue >= 0) {
    const baselinePos = scale(0);

    if (type === "radial") {
      // Value maps to radius - Draw an arc at the baseline radius
      const baselineRadius = baselinePos;
      // Ensure the baseline radius is within the visible range
      if (baselineRadius >= innerRadius && baselineRadius <= outerRadius) {
        g.append("path")
          .attr("class", "baseline-arc")
          .attr(
            "d",
            d3.arc()({
              innerRadius: baselineRadius,
              outerRadius: baselineRadius, // Make it a line
              startAngle: startAngle,
              endAngle: endAngle,
            }),
          )
          .attr("stroke", globalSettings.helperColor)
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "2,2")
          .attr("fill", "none")
          .lower();
      }
    } else {
      // circular, value maps to angle - Draw a radial line at the baseline angle
      const baselineAngle = baselinePos;
      // Ensure the baseline angle is within the visible range
      if (
        baselineAngle >= Math.min(startAngle, endAngle) &&
        baselineAngle <= Math.max(startAngle, endAngle)
      ) {
        g.append("line")
          .attr("class", "baseline-radial-line")
          .attr("x1", innerRadius * Math.cos(baselineAngle - Math.PI / 2))
          .attr("y1", innerRadius * Math.sin(baselineAngle - Math.PI / 2))
          .attr("x2", outerRadius * Math.cos(baselineAngle - Math.PI / 2))
          .attr("y2", outerRadius * Math.sin(baselineAngle - Math.PI / 2))
          .attr("stroke", globalSettings.helperColor)
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "2,2")
          .lower();
      }
    }
  }
}

/**
 * Process union axis
 * @param {Object} g - D3 selection object
 * @param {Object} data - Object containing config and data
 * @param {boolean} polar - Whether it is a polar coordinate system
 */
export async function processUnionAxis(g, data, polar) {
  const config = data.config;
  const axisData = data.unionData.data;
  const unionName = data.unionData.name; // Get union axis name
  const configs = data.unionData.configs;
  const order = config.order;
  if (!config.options) config.options = {};
  if (!config.options.icons) config.options.icons = {};
  if (iconMaps[unionName]) {
    config.options.icons[unionName] = iconMaps[unionName];
  }
  let labelPosition = {};
  let pos = null; // Label position parameter, ["left", "right", "top", "bottom"]
  let needLabelPos = false; // Whether we need to record labelPosition
  if (globalSettings.linkInfo.ids?.includes(data.id)) {
    needLabelPos = true;
    globalSettings.linkInfo.nodes.forEach((n) => {
      if (n.id === data.id) pos = n.pos;
    });
  }

  // Sort data and corresponding configs by the specified order
  const sortedIndices = [...axisData.keys()].sort(
    (a, b) => order[axisData[a]] - order[axisData[b]],
  );
  const sortedData = sortedIndices.map((i) => axisData[i]);
  const sortedConfigs = sortedIndices.map((i) => configs[i]);
  const unionAxisPos = config.unionAxis.display;
  const icons = config.options?.icons?.[unionName];
  let drawImageIcons = true;
  if (icons) {
    const hasAnyIcon = Object.values(icons).some((iconUrl) => !!iconUrl);
    if (hasAnyIcon) {
      const groupKey = `image-icons::${String(unionName || "default")}`;
      if (globalSettings.hasImageIconGroup(groupKey)) {
        drawImageIcons = false;
      } else {
        globalSettings.registerImageIconGroup(groupKey);
      }
    }
  }

  // Get color mapping function
  let [colorMap, type] = globalSettings.palette.getColorMap(unionName);
  if (type === "base") colorMap = () => globalSettings.textColorDark; // Default color

  // Axis line style settings
  const axisLineWidth = 3; // Thicker axis line
  const axisLineOpacity = 0.8; // Slightly increase opacity
  const tickLength = 6; // Tick length
  const textMargin = 10; // Text margin
  const linkageOffset = 40; // Offset used to mark labelPosition
  const isLabelAxis =
    globalSettings.palette.getColorMap(unionName)[1] !== "base";
  let axisFontSize = isLabelAxis
    ? globalSettings.getFontSize("label")
    : globalSettings.getFontSize("value");

  // Set axis position
  const dx = polar ? config.cx : config.left;
  const dy = polar ? config.cy : config.top;
  g.attr("transform", `translate(${dx}, ${dy})`);

  const maxCharLen = Math.max(...sortedData.map((d) => d.length));
  const totalCharLen = sortedData.reduce((acc, d) => acc + d.length, 0);
  let availableSpace = 0;

  if (!polar) {
    if (unionAxisPos === "top" || unionAxisPos === "bottom") {
      availableSpace = config.width;
    } else if (unionAxisPos === "left" || unionAxisPos === "right") {
      availableSpace = config.height;
    }
  } else {
    if (unionAxisPos === "top") {
      availableSpace =
        config.outerRadius * (config.endAngle - config.startAngle);
    } else if (unionAxisPos === "bottom") {
      availableSpace =
        config.innerRadius * (config.endAngle - config.startAngle);
    } else if (unionAxisPos === "left" || unionAxisPos === "right") {
      availableSpace = config.outerRadius - config.innerRadius;
    }
  }

  if (unionAxisPos === "top" || unionAxisPos === "bottom") {
    axisFontSize = Math.max(
      Math.min(
        axisFontSize,
        Math.floor((3 * availableSpace) / (totalCharLen * 2)),
      ),
      globalSettings.minFontSize,
    );
  }

  // Process union axis in Cartesian coordinates
  if (!polar) {
    let axisGroup = g.append("g").attr("class", "union-axis");

    // Create an axis segment for each datum
    sortedData.forEach((d, i) => {
      const chartConfig = sortedConfigs[i];
      const color = colorMap(d);
      const iconUrl = drawImageIcons && icons ? icons[d] : null;
      const iconSize = axisFontSize * 1.5;

      if (unionAxisPos === "top" || unionAxisPos === "bottom") {
        // Horizontal axis
        const x1 = chartConfig.left - config.left;
        const x2 = x1 + chartConfig.width;
        const y = unionAxisPos === "top" ? 0 : config.height;
        const midX = (x1 + x2) / 2;

        if (needLabelPos) {
          let yOffset = linkageOffset;
          if (iconUrl) {
            yOffset += iconSize + 5;
          }
          labelPosition[d] = {
            x: midX,
            y: pos === "top" ? 0 - yOffset : config.height + yOffset,
          };
        }

        // Create axis segment
        axisGroup
          .append("line")
          .attr("class", "domain-segment")
          .attr("x1", x1)
          .attr("y1", y)
          .attr("x2", x2)
          .attr("y2", y)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth)
          .attr("stroke-linecap", "round")
          .attr("opacity", axisLineOpacity);

        // Add ticks
        axisGroup
          .append("line")
          .attr("class", "tick")
          .attr("x1", midX)
          .attr("y1", y)
          .attr("x2", midX)
          .attr("y2", unionAxisPos === "top" ? y - tickLength : y + tickLength)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth * 0.8)
          .attr("opacity", axisLineOpacity);

        let textY =
          unionAxisPos === "top"
            ? y - (tickLength + textMargin)
            : y + tickLength + textMargin + axisFontSize / 2;

        if (iconUrl) {
          const shift = iconSize + 5;
          textY = unionAxisPos === "top" ? textY - shift : textY + shift;

          const iconY =
            unionAxisPos === "top"
              ? y - (tickLength + textMargin) - iconSize
              : y + tickLength + textMargin;

          axisGroup
            .append("image")
            .attr("xlink:href", iconUrl)
            .attr("width", iconSize)
            .attr("height", iconSize)
            .attr("x", midX - iconSize / 2)
            .attr("y", iconY);
        }

        // Add tick labels with extra padding
        axisGroup
          .append("text")
          .attr("x", midX)
          .attr("y", textY)
          .attr("text-anchor", "middle")
          .attr("fill", color)
          .attr("font-weight", "bold")
          .text(d);
      } else if (unionAxisPos === "left" || unionAxisPos === "right") {
        // Vertical axis
        const y1 = chartConfig.top - config.top;
        const y2 = y1 + chartConfig.height;
        const x = unionAxisPos === "left" ? 0 : config.width;
        const midY = (y1 + y2) / 2;
        const iconShift = iconUrl ? iconSize + 5 : 0;

        if (needLabelPos) {
          labelPosition[d] = {
            x:
              unionAxisPos === "left"
                ? 0 -
                  linkageOffset -
                  maxCharLen * axisFontSize * 0.5 -
                  iconShift
                : config.width +
                  linkageOffset +
                  maxCharLen * axisFontSize * 0.5 +
                  iconShift,
            y: midY,
          };
        }

        // Create axis segment
        axisGroup
          .append("line")
          .attr("class", "domain-segment")
          .attr("x1", x)
          .attr("y1", y1)
          .attr("x2", x)
          .attr("y2", y2)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth)
          .attr("stroke-linecap", "round")
          .attr("opacity", axisLineOpacity);

        // Add ticks
        axisGroup
          .append("line")
          .attr("class", "tick")
          .attr("x1", x)
          .attr("y1", midY)
          .attr("x2", unionAxisPos === "left" ? x - tickLength : x + tickLength)
          .attr("y2", midY)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth * 0.8)
          .attr("opacity", axisLineOpacity);

        let textX =
          unionAxisPos === "left"
            ? x - (tickLength + textMargin)
            : x + tickLength + textMargin;

        if (iconUrl) {
          textX =
            unionAxisPos === "left" ? textX - iconShift : textX + iconShift;

          const iconX =
            unionAxisPos === "left"
              ? x - (tickLength + textMargin) - iconSize
              : x + tickLength + textMargin;

          axisGroup
            .append("image")
            .attr("xlink:href", iconUrl)
            .attr("width", iconSize)
            .attr("height", iconSize)
            .attr("x", iconX)
            .attr("y", midY - iconSize / 2);
        }

        // Add tick labels with extra padding
        axisGroup
          .append("text")
          .attr("x", textX)
          .attr("y", midY)
          .attr("text-anchor", unionAxisPos === "left" ? "end" : "start")
          .attr("dominant-baseline", "middle")
          .attr("fill", color)
          .attr("font-weight", "bold")
          .text(d);
      }
    });

    if (config.brace) {
      createBrace(g, config.width, config.height, config.brace);
    }
  }
  // Process union axis in polar coordinates
  else {
    let axisGroup = g.append("g").attr("class", "union-axis");

    // Create an axis segment for each datum
    sortedData.forEach((d, i) => {
      const chartConfig = sortedConfigs[i];
      const color = colorMap(d);

      if (unionAxisPos === "top" || unionAxisPos === "bottom") {
        // Circular axis
        const startAngle = chartConfig.startAngle;
        const endAngle = chartConfig.endAngle;
        const midAngle = (startAngle + endAngle) / 2;
        const radius =
          unionAxisPos === "top" ? config.outerRadius : config.innerRadius;

        if (needLabelPos) {
          const linkAxisRadius =
            pos === "top" ? config.outerRadius : config.innerRadius;
          labelPosition[d] = {
            x: linkAxisRadius * Math.sin(midAngle),
            y: -linkAxisRadius * Math.cos(midAngle),
          };
        }

        // Create arc axis segment
        const path = d3.arc()({
          innerRadius: radius,
          outerRadius: radius,
          startAngle: startAngle,
          endAngle: endAngle,
        });

        axisGroup
          .append("path")
          .attr("class", "domain-segment")
          .attr("d", path)
          .attr("stroke", color)
          .attr("fill", "none")
          .attr("stroke-width", axisLineWidth)
          .attr("stroke-linecap", "round")
          .attr("opacity", axisLineOpacity);

        // Add ticks
        const tickX1 = Math.sin(midAngle) * radius;
        const tickY1 = -Math.cos(midAngle) * radius;
        const tickDirection = unionAxisPos === "top" ? 1 : -1;
        const tickX2 =
          Math.sin(midAngle) * (radius + tickLength * tickDirection);
        const tickY2 =
          -Math.cos(midAngle) * (radius + tickLength * tickDirection);

        axisGroup
          .append("line")
          .attr("class", "tick")
          .attr("x1", tickX1)
          .attr("y1", tickY1)
          .attr("x2", tickX2)
          .attr("y2", tickY2)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth * 0.8)
          .attr("opacity", axisLineOpacity);

        // Add text labels (use textPath along the arc)
        const textRadius =
          unionAxisPos === "top"
            ? radius + tickLength + textMargin * 1.5 * globalSettings.fontRatio
            : radius - tickLength - textMargin * 1.5 * globalSettings.fontRatio;

        const { textPathData, pathId } = generateTextPath(
          textRadius,
          startAngle,
          endAngle,
          "union",
          null,
          axisFontSize,
        );

        axisGroup
          .append("path")
          .attr("d", textPathData)
          .attr("id", pathId)
          .attr("fill", "none")
          .attr("stroke", "none");

        const text = axisGroup
          .append("text")
          .attr("fill", color)
          .style("font-weight", "bold")
          .style("font-size", axisFontSize + "px");

        text
          .append("textPath")
          .attr("xlink:href", `#${pathId}`)
          .attr("startOffset", "50%")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "auto")
          .text(d);
      } else if (unionAxisPos === "left" || unionAxisPos === "right") {
        // Radial axis
        const angle =
          unionAxisPos === "left" ? config.startAngle : config.endAngle;
        const innerRadius = chartConfig.innerRadius;
        const outerRadius = chartConfig.outerRadius;
        const midRadius = (innerRadius + outerRadius) / 2;
        const x =
          unionAxisPos === "left"
            ? -data.unionData.margin * Math.cos(angle)
            : data.unionData.margin * Math.cos(angle);
        const y =
          unionAxisPos === "left"
            ? -data.unionData.margin * Math.sin(angle)
            : data.unionData.margin * Math.sin(angle);

        if (needLabelPos) {
          labelPosition[d] = { x: x, y: y };
        }

        // Create radial axis segment
        axisGroup
          .attr("transform", `translate(${x}, ${y})`)
          .append("line")
          .attr("class", "domain-segment")
          .attr("x1", Math.sin(angle) * innerRadius)
          .attr("y1", -Math.cos(angle) * innerRadius)
          .attr("x2", Math.sin(angle) * outerRadius)
          .attr("y2", -Math.cos(angle) * outerRadius)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth)
          .attr("stroke-linecap", "round")
          .attr("opacity", axisLineOpacity);

        // Add ticks
        const tickDirection = unionAxisPos === "left" ? -1 : 1;
        const perpAngle = angle + (Math.PI / 2) * tickDirection;
        const tickX1 = Math.sin(angle) * midRadius;
        const tickY1 = -Math.cos(angle) * midRadius;
        const tickX2 = tickX1 + Math.sin(perpAngle) * tickLength;
        const tickY2 = tickY1 - Math.cos(perpAngle) * tickLength;

        axisGroup
          .append("line")
          .attr("class", "tick")
          .attr("x1", tickX1)
          .attr("y1", tickY1)
          .attr("x2", tickX2)
          .attr("y2", tickY2)
          .attr("stroke", color)
          .attr("stroke-width", axisLineWidth * 0.8)
          .attr("opacity", axisLineOpacity);

        // Add text labels with extra padding
        const labelAngle = angle;
        const sweepFlag =
          labelAngle > Math.PI / 2 && labelAngle < (Math.PI * 3) / 2 ? 1 : 0;
        const labelRadius = sweepFlag
          ? midRadius + axisFontSize / 3
          : midRadius - axisFontSize / 3;
        const rotateAngle = sweepFlag
          ? (labelAngle * 180) / Math.PI + 180
          : (labelAngle * 180) / Math.PI;
        const shiftFlag = (unionAxisPos === "left") ^ sweepFlag;
        axisGroup
          .append("text")
          .attr("text-anchor", shiftFlag ? "end" : "start")
          .attr(
            "transform",
            `rotate(${rotateAngle}), translate(${(tickLength + textMargin) * (shiftFlag ? -1 : 1)}, ${sweepFlag ? labelRadius : -labelRadius})`,
          )
          .attr("fill", color)
          .attr("font-weight", "bold")
          .text(d);
      }
    });
  }

  g.selectAll("text").each(function () {
    const fontType = isLabelAxis ? "label" : "value";
    globalSettings.setFont(d3.select(this), fontType, axisFontSize);
  });

  return [labelPosition, dx, dy];
}

/**
 * Draw ticks and labels for a link chart
 * @param {Object} axisGroup - D3 selection axis group
 * @param {Object} segment - Data for a single axis segment
 * @param {boolean} isHorizontal - Whether the axis is horizontal
 * @param {string} pos - Axis position ("left", "right", "top", "bottom")
 * @param {number} tickLength - Tick length
 * @param {number} axisFontSize - Font size
 * @param {number} textMargin - Text margin
 * @param {boolean} vlabel - Whether to render labels vertically
 * @param {Object} icons - Icon map { value: url }
 */
function drawAxisLabels(
  axisGroup,
  segment,
  isHorizontal,
  pos,
  tickLength,
  axisFontSize,
  textMargin,
  vlabel = false,
  icons = null,
  drawImageIcons = true,
) {
  const text = axisGroup
    .append("text")
    .attr("fill", segment.color)
    .attr("font-weight", "bold");
  globalSettings.setFont(text, "value");

  const iconUrl = drawImageIcons && icons ? icons[segment.value] : null;
  const iconSize = axisFontSize * 1.5; // Icon size

  if (isHorizontal) {
    // Ticks and labels for a horizontal axis
    const x1 = segment.start;
    const x2 = segment.end;
    const y = 0; // Axis line position
    const midX = (x1 + x2) / 2;

    // Add tick label - vertical if vlabel is true
    if (vlabel) {
      // Render label vertically
      // Compute label position so it sits right above/below the tick
      const labelY =
        pos === "top"
          ? y - tickLength - textMargin
          : y + tickLength + textMargin;

      const textAnchor = pos === "top" ? "start" : "end";

      // If there is an icon, shift the text to avoid overlap
      const textOffset = iconUrl ? iconSize + 5 : 0;

      // Create label text
      text
        .attr("x", midX)
        .attr("y", labelY)
        .attr("text-anchor", textAnchor)
        .attr("transform", function () {
          // Use a more precise rotation so the text is exactly above/below the tick
          if (pos === "top") {
            return `rotate(-90, ${midX}, ${labelY}) translate(${textOffset}, 4)`;
          } else {
            return `rotate(-90, ${midX}, ${labelY}) translate(${-textOffset}, 4)`;
          }
        })
        .text(segment.value);

      if (iconUrl) {
        axisGroup
          .append("image")
          .attr("xlink:href", iconUrl)
          .attr("width", iconSize)
          .attr("height", iconSize)
          .attr("x", midX)
          .attr("y", labelY)
          .attr("transform", function () {
            // Rotate icon to match text orientation
            // If top, text extends upward, icon should be above text
            // If bottom, text extends downward, icon should be below text
            if (pos === "top") {
              return `rotate(-90, ${midX}, ${labelY}) translate(0, ${4 - iconSize / 2})`;
            } else {
              return `rotate(-90, ${midX}, ${labelY}) translate(${-iconSize}, ${4 - iconSize / 2})`;
            }
          });
      }
    } else {
      if (iconUrl) {
        const textY =
          pos === "top"
            ? y - (tickLength + textMargin) - iconSize
            : y + tickLength + textMargin;

        axisGroup
          .append("image")
          .attr("xlink:href", iconUrl)
          .attr("width", iconSize)
          .attr("height", iconSize)
          .attr("x", midX - iconSize / 2)
          .attr("y", textY);

        text.remove();
      } else {
        text
          .attr("x", midX)
          .attr(
            "y",
            pos === "top"
              ? y - (tickLength + textMargin)
              : y + tickLength + textMargin + axisFontSize / 2,
          )
          .attr("text-anchor", "middle")
          .text(segment.value);
      }
    }
  } else {
    // Ticks and labels for a vertical axis (keep original logic unchanged)
    const y1 = segment.start;
    const y2 = segment.end;
    const x = 0; // Axis line position
    const midY = (y1 + y2) / 2;

    // Add tick label
    text
      .attr(
        "x",
        pos === "left"
          ? x - (tickLength + textMargin)
          : x + tickLength + textMargin,
      )
      .attr("y", midY)
      .attr("text-anchor", pos === "left" ? "end" : "start")
      .attr("dominant-baseline", "middle")
      .text(segment.value);

    if (iconUrl) {
      const textX =
        pos === "left"
          ? x - (tickLength + textMargin)
          : x + tickLength + textMargin;

      // Place icon between axis and text
      const iconX = pos === "left" ? textX - iconSize : textX;

      // Adjust text position
      text.attr(
        "x",
        pos === "left" ? textX - iconSize - 5 : textX + iconSize + 5,
      );

      axisGroup
        .append("image")
        .attr("xlink:href", iconUrl)
        .attr("width", iconSize)
        .attr("height", iconSize)
        .attr("x", iconX)
        .attr("y", midY - iconSize / 2);
    }
  }
}

/**
 * Process axis for a link chart
 * @param {Object} g - D3 selection object
 * @param {string} pos - Axis position ("left", "right", "top", "bottom")
 * @param {number} width - Available width
 * @param {number} height - Available height
 * @param {Array} segments - Axis segment data array
 * @param {Object} options - Additional options
 */
export function axisCartesianLink(
  g,
  pos,
  width,
  height,
  segments,
  options = {},
) {
  if (pos.includes("_noname")) pos = pos.replace("_noname", "");
  const isHorizontal = pos === "top" || pos === "bottom";

  // Axis line style settings
  const tickLength = 3; // Tick length
  const textMargin = options.border ? 10 : 5; // Text margin
  const axisFontSize = globalSettings.getFontSize("label");
  let drawImageIcons = true;
  if (options.icons) {
    const hasAnyIcon = Object.values(options.icons).some(
      (iconUrl) => !!iconUrl,
    );
    if (hasAnyIcon) {
      const groupName = options.xName || options.labelName || "unknown";
      const groupKey = `image-icons::${String(groupName || "default")}`;
      if (globalSettings.hasImageIconGroup(groupKey)) {
        drawImageIcons = false;
      } else {
        globalSettings.registerImageIconGroup(groupKey);
      }
    }
  }

  // Create axis group
  let axisGroup = g.append("g").attr("class", "axis");

  // Apply transform based on position
  if (pos === "bottom") axisGroup.attr("transform", `translate(0, ${height})`);
  else if (pos === "right")
    axisGroup.attr("transform", `translate(${width}, 0)`);

  // Draw each axis segment - only ticks and labels; segments are handled by link.js
  segments.forEach((segment) => {
    drawAxisLabels(
      axisGroup,
      segment,
      isHorizontal,
      pos,
      tickLength,
      axisFontSize,
      textMargin,
      options.vlabel,
      options.icons, // Pass icons
      drawImageIcons,
    );
  });

  return axisGroup;
}

export function createMirrorAxis(g, data, config) {
  const axisGroup = g.append("g").attr("class", "axis");
  let scale = null;
  let _getPos = null;
  let tickValues = data;

  if (config.scaleType === "band") {
    scale = d3.scaleBand().domain(data).paddingInner(0.3).paddingOuter(0);
    _getPos = (d) => scale(d) + scale.bandwidth() / 2;
  } else if (config.scaleType === "point") {
    scale = d3.scalePoint().domain(data);
    const orientation = config.dir === "h" ? "horizontal" : "vertical";
    const size = config.dir === "h" ? config.height : config.width;
    tickValues = calculateTickValues(scale, size, orientation, {
      chartType: "line",
    });
    _getPos = (d) => scale(d);
  } else {
    throw new Error("Unsupported scale type: " + config.scaleType);
  }

  const positions = {};

  switch (config.dir) {
    case "v": {
      scale.range([0, config.width]);
      tickValues.forEach((d) => {
        positions[d] = {
          x: _getPos(d),
          y: config.height / 2,
        };
      });
      break;
    }
    case "h": {
      scale.range([0, config.height]);
      tickValues.forEach((d) => {
        positions[d] = {
          x: config.width / 2,
          y: _getPos(d),
        };
      });
      break;
    }
    case "c": {
      scale.range([-config.innerRadius, -config.outerRadius]);
      tickValues.forEach((d) => {
        positions[d] = {
          x: 0,
          y: _getPos(d),
        };
      });
      break;
    }
    default:
      throw new Error("Invalid axis direction: " + config.dir);
  }

  // for circular mirror axis, add reference line
  if (config.dir === "c") {
    const lineArc = d3
      .arc()
      .startAngle(config.startAngle)
      .endAngle(config.endAngle);
    tickValues.forEach((d) => {
      const radius = -_getPos(d);
      axisGroup
        .append("path")
        .attr("class", "mirror-refline")
        .attr(
          "d",
          lineArc({
            innerRadius: radius,
            outerRadius: radius + 1,
          }),
        )
        .attr("fill", globalSettings.helperColor);
    });
  }
  tickValues.forEach((d) => {
    const textGroup = axisGroup
      .append("text")
      .attr("class", "axis-label")
      .attr("x", positions[d].x)
      .attr("y", positions[d].y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", globalSettings.textColorDark)
      .attr("font-weight", "bold")
      .text(d);

    if (config.rotate) {
      textGroup.attr(
        "transform",
        `rotate(90, ${positions[d].x}, ${positions[d].y})`,
      );
    }

    globalSettings.setFont(textGroup, "value");
  });
}
