import * as d3 from "d3";
import {
  axisPolar,
  axisCartesian,
  axisRadialInner,
  axisRadialOuter,
} from "./axis.js";
import { sampleScatterData } from "../utils/vis.js";
import { checkAllInteger, enhanceTickValues } from "../utils/maths.js";
import { createAngularRefLine, createRadialRefLine } from "./refline.js";
import { globalSettings } from "../core/global.js";

function calculatePolarArea(innerRadius, outerRadius, startAngle, endAngle) {
  // Area formula: 0.5 * (r2^2 - r1^2) * (theta2 - theta1)
  return (
    0.5 *
    (outerRadius * outerRadius - innerRadius * innerRadius) *
    Math.abs(endAngle - startAngle)
  );
}

function addBorderLine(g, width, height) {
  // left and bottom
  g = g.append("g").attr("class", "axis");
  g.append("line")
    .attr("class", "baseline")
    .attr("x1", 0)
    .attr("y1", height)
    .attr("x2", width)
    .attr("y2", height);

  g.append("line")
    .attr("class", "baseline")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", height);

  g.selectAll("line")
    .attr("stroke", globalSettings.textColorDark)
    .attr("opacity", 0.5);

  const arrowSize = Math.max(4, 6 * globalSettings.fontRatio);

  // x-axis arrow at the right endpoint
  g.append("path")
    .attr(
      "d",
      `M${width + arrowSize},${height + 0.5} L${width},${height - arrowSize / 2 + 0.5} L${width},${height + 0.5} Z`,
    )
    .attr("fill", globalSettings.textColorDark)
    .attr("opacity", 0.5);

  // y-axis arrow at the top endpoint
  g.append("path")
    .attr("d", `M${-0.5},${-arrowSize} L${-0.5},0 L${arrowSize / 2},0 Z`)
    .attr("fill", globalSettings.textColorDark)
    .attr("opacity", 0.5);
}

/**
 * Helper: calculate linear regression
 * @param {Array} data - Array in the form [{x: number, y: number}, ...]
 * @returns {Object|null} Object containing slope, intercept, and rSquared; or null if it cannot be computed
 */
export function calculateLinearRegression(data) {
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;
  const n = data.length;

  if (n < 2) {
    return null; // Cannot compute a regression line with fewer than 2 points
  }

  for (const d of data) {
    sumX += d.x;
    sumY += d.y;
    sumXY += d.x * d.y;
    sumX2 += d.x * d.x;
    sumY2 += d.y * d.y;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return null; // Avoid division by zero (happens when all x values are identical)
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const r2_denominator = n * sumY2 - sumY * sumY;
  const rSquared =
    r2_denominator === 0
      ? 1
      : Math.pow(n * sumXY - sumX * sumY, 2) / (denominator * r2_denominator);

  return { slope, intercept, rSquared };
}

/**
 * Calculate confidence interval
 * @param {Array} data - Array in the form [{x: number, y: number}, ...]
 * @param {Object} regression - Object returned by calculateLinearRegression
 * @param {Object} x - D3 x-scale
 * @returns {Array} Boundary points array for drawing the confidence band
 */
export function calculateConfidenceInterval(data, regression, x) {
  const n = data.length;
  if (n < 3) return []; // Confidence interval needs at least 3 points

  const { slope, intercept } = regression;
  const xMean = data.reduce((acc, d) => acc + d.x, 0) / n;

  // Compute sum of squared errors (SSE)
  let sse = 0;
  data.forEach((d) => {
    const predictedY = slope * d.x + intercept;
    sse += Math.pow(d.y - predictedY, 2);
  });

  const stdErrorOfEstimate = Math.sqrt(sse / (n - 2));
  const ssx = data.reduce((acc, d) => acc + Math.pow(d.x - xMean, 2), 0);

  // Critical value: for 95% confidence and medium-to-large datasets, 1.96 is a reasonable approximation
  const criticalValue = 1.96;

  const ciData = [];
  const xDomain = x.domain();
  const step = (xDomain[1] - xDomain[0]) / 20; // Sample 20 points on the x-axis to draw a smooth curve

  for (let i = 0; i <= 20; i++) {
    const currentX = xDomain[0] + i * step;
    const predictedY = slope * currentX + intercept;

    // Compute standard error and confidence interval width at currentX
    const seOfMean =
      stdErrorOfEstimate *
      Math.sqrt(1 / n + Math.pow(currentX - xMean, 2) / ssx);
    const halfWidth = criticalValue * seOfMean;

    ciData.push({
      x: currentX,
      lower: predictedY - halfWidth,
      upper: predictedY + halfWidth,
    });
  }

  return ciData;
}

export function drawShape(
  g,
  points,
  radius,
  shape,
  color,
  area,
  sample = true,
  options = {},
) {
  const { opacity = 0.5 } = options || {};
  if (sample) points = sampleScatterData(points, area, radius, 0.3);
  const symbolTypes = {
    triangle: d3.symbolTriangle,
    diamond: d3.symbolDiamond,
  };

  const group = g.append("g").selectAll(".point").data(points).enter();
  const symbolSize = Math.PI * radius * radius;

  if (shape === "circle") {
    group
      .append("circle")
      .attr("class", "point")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", radius)
      .attr("fill", (d) =>
        typeof color === "function" ? color(d.label) : color,
      )
      .attr("opacity", opacity);
  } else if (shape === "square") {
    group
      .append("rect")
      .attr("class", "point")
      .attr("x", (d) => d.x - radius)
      .attr("y", (d) => d.y - radius)
      .attr("width", radius * 2)
      .attr("height", radius * 2)
      .attr("fill", (d) =>
        typeof color === "function" ? color(d.label) : color,
      )
      .attr("opacity", opacity);
  } else if (shape in symbolTypes) {
    const symbol = d3.symbol().type(symbolTypes[shape]).size(symbolSize)();
    group
      .append("path")
      .attr("class", "point")
      .attr("d", symbol)
      .attr("transform", (d) => `translate(${d.x}, ${d.y})`)
      .attr("fill", (d) =>
        typeof color === "function" ? color(d.label) : color,
      )
      .attr("opacity", opacity);
  } else {
    throw new Error(`Invalid shape: ${shape}`);
  }
}

/**
 * Creates a vertical scatter plot using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x`, `y`, (`label`) properties.
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
 * @param {Object} order - The order of the x axis when it is a categorical variable.
 * @param {function|string} color - The color of the points. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options.
 */
export function createVerticalScatterPlot(
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
  options = {},
) {
  const {
    style = "default",
    shape = "circle",
    radius = 5,
    showRegression = true,
    showCI = true,
  } = options || {};
  g = g.attr("width", width).attr("height", height).append("g");
  addBorderLine(g, width, height);

  // Define scales for x and y axes
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
      .domain([
        xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x), // Use xMin if provided, else use data's x min
        xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x), // Use xMax if provided, else use data's x max
      ])
      .range(xAxisDir === "default" ? [0, width] : [width, 0]);
  }

  const y = d3
    .scaleLinear()
    .domain([
      yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y), // Use yMin if provided, else use data's y min
      yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y), // Use yMax if provided, else use data's y max
    ])
    .range(yAxisDir === "default" ? [height, 0] : [0, height]);

  if (data[0].hasOwnProperty("label")) {
    const labels = Array.from(new Set(data.map((d) => d.label)));
    labels.forEach((label) => {
      const labelData = data
        .filter((d) => d.label === label)
        .map((d) => ({ x: x(d.x), y: y(d.y), label }));
      drawShape(
        g,
        labelData,
        radius,
        shape,
        color(label),
        width * height,
        true,
        options,
      );
    });
  } else {
    const points = data.map((d) => ({ x: x(d.x), y: y(d.y) }));
    drawShape(g, points, radius, shape, color, width * height, true, options);

    if (showRegression && !isString) {
      // Linear regression is only supported for scaleLinear
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

              // Insert a path so it stays beneath points and regression line
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

          // Only when slope is non-zero can it intersect horizontal bounds
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

          // Filter potential duplicates caused by floating point computations
          const uniquePoints = Array.from(
            new Set(intersectionPoints.map((p) => JSON.stringify(p))),
          ).map((s) => JSON.parse(s));

          // If there are at least two intersections, the regression line crosses the plot area; draw it
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
              .style("stroke-dasharray", "3,2"); // Dashed line
          }
        }
      }
    }
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "x", {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "y", {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }
}

/**
 * Creates a horizontal scatter plot using D3.js.
 *
 * @param {Object[]} data - The data to render in the chart. Each object should have `x`, `y`, (`label`) properties.
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
 * @param {Object} order - The order of the x axis when it is a categorical variable.
 * @param {function|string} color - The color of the points. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options.
 */
export function createHorizontalScatterPlot(
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
  options = {},
) {
  const {
    style = "default",
    shape = "circle",
    radius = 5,
    showRegression = true,
    showCI = true,
  } = options || {};
  g = g.attr("width", width).attr("height", height).append("g");
  addBorderLine(g, width, height);

  // Define scales for x and y axes
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
      .domain([
        xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x), // Use xMin if provided, else use data's x min
        xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x), // Use xMax if provided, else use data's x max
      ])
      .range(yAxisDir === "default" ? [height, 0] : [0, height]);
  }

  const x = d3
    .scaleLinear()
    .domain([
      yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y), // Use yMin if provided, else use data's y min
      yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y), // Use yMax if provided, else use data's y max
    ])
    .range(xAxisDir === "default" ? [0, width] : [width, 0]);

  if (data[0].hasOwnProperty("label")) {
    const labels = Array.from(new Set(data.map((d) => d.label)));
    labels.forEach((label) => {
      const labelData = data
        .filter((d) => d.label === label)
        .map((d) => ({ x: x(d.y), y: y(d.x), label }));
      drawShape(
        g,
        labelData,
        radius,
        shape,
        color(label),
        width * height,
        true,
        options,
      );
    });
  } else {
    const points = data.map((d) => ({ x: x(d.y), y: y(d.x) }));
    drawShape(g, points, radius, shape, color, width * height, true, options);

    if (showRegression && !isString) {
      // Linear regression is only supported for scaleLinear
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

              // Insert a path so it stays beneath points and regression line
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

          // Only when slope is non-zero can it intersect horizontal bounds
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

          // Filter potential duplicates caused by floating point computations
          const uniquePoints = Array.from(
            new Set(intersectionPoints.map((p) => JSON.stringify(p))),
          ).map((s) => JSON.parse(s));

          // If there are at least two intersections, the regression line crosses the plot area; draw it
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
              .style("stroke-dasharray", "3,2"); // Dashed line
          }
        }
      }
    }
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  // Add x-axis if needed
  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, x, width, height, "x", {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }

  // Add y-axis if needed
  if (yAxisPos !== "none") {
    axisCartesian(g, yAxisPos, y, width, height, "y", {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
      border: options.border,
    });
  }
}

/**
 * Creates a radial scatter plot using D3.js.
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
 * @param {function|string} color - The color of the points. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options.
 */
export function createRadialScatterPlot(
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
  color,
  options = {},
) {
  const {
    style = "default",
    shape = "circle",
    radius = 5,
    showGrid = true,
  } = options || {};

  // Define scales for radial and angular (x) axes
  let angleScale = null;

  let xMinVal = xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x);
  let xMaxVal = xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x);
  let yMinVal = yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y);
  let yMaxVal = yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y);

  if (typeof data[0].x === "string") {
    const xDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      xDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    angleScale = d3
      .scalePoint()
      .domain(xDomain)
      .range(
        xAxisDir === "default"
          ? [startAngle, endAngle]
          : [endAngle, startAngle],
      );
  } else {
    angleScale = d3
      .scaleLinear()
      .domain([xMinVal, xMaxVal])
      .range(
        xAxisDir === "default"
          ? [startAngle, endAngle]
          : [endAngle, startAngle],
      ); // Map x values to angles
  }

  const radiusScale = d3
    .scaleLinear()
    .domain([yMinVal, yMaxVal])
    .range(
      yAxisDir === "default"
        ? [innerRadius, outerRadius]
        : [outerRadius, innerRadius],
    ); // Map y values to radial distances

  const area = calculatePolarArea(
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
  );

  // If data contains multiple series with a label
  if (data[0].hasOwnProperty("label")) {
    // Group data by label
    const labels = Array.from(new Set(data.map((d) => d.label)));
    labels.forEach((label) => {
      const labelData = data.filter((d) => d.label === label);
      const points = labelData.map((d) => {
        const angle = angleScale(d.x);
        const radius = radiusScale(d.y);
        d.x = radius * Math.cos(angle - Math.PI / 2);
        d.y = radius * Math.sin(angle - Math.PI / 2);
        return d;
      });
      drawShape(g, points, radius, shape, color(label), area, true, options);
    });
  } else {
    const points = data.map((d) => {
      const angle = angleScale(d.x);
      const radius = radiusScale(d.y);
      d.x = radius * Math.cos(angle - Math.PI / 2);
      d.y = radius * Math.sin(angle - Math.PI / 2);
      return d;
    });
    drawShape(g, points, radius, shape, color, area, true, options);
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  let angularValues = null;
  let radialValues = null;

  // draw x-axis
  if (xAxisPos.includes("bottom")) {
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else if (xAxisPos.includes("top")) {
    const [xAxis, ticks] = axisRadialOuter(angleScale, outerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    g.append("g").attr("class", "axis").append("g").call(xAxis);
    angularValues = ticks.map((val) => angleScale(val));
  } else {
    // If there is no axis, default to tickValues from the inner radial axis
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    angularValues = ticks.map((val) => angleScale(val));
  }

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
    // If there is no axis, default to tickValues from the left polar axis
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
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

    const refGroup = g.append("g").attr("class", "refline-group");
    createAngularRefLine(refGroup, angularValues, innerRadius, outerRadius);
    createRadialRefLine(refGroup, radialValues, startAngle, endAngle);
    // createPolarBorder(refGroup, innerRadius, outerRadius, startAngle, endAngle);
    g.node().insertBefore(refGroup.node(), g.node().firstChild);
  }
}

/**
 * Creates a circular scatter plot using D3.js.
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
 * @param {function|string} color - The color of the points. Either a color scale function or a color string.
 * @param {Object} [options={}] - Additional options.
 */
export function createCircularScatterPlot(
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
  color,
  options = {},
) {
  const {
    style = "default",
    shape = "circle",
    radius = 5,
    showGrid = true,
  } = options || {};

  let radiusScale = null;

  let xMinVal = xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x);
  let xMaxVal = xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x);
  let yMinVal = yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y);
  let yMaxVal = yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y);

  if (typeof data[0].x === "string") {
    const xDomain = Array.from(new Set(data.map((d) => d.x)));
    if (Array.isArray(order)) {
      xDomain.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    radiusScale = d3
      .scalePoint()
      .domain(xDomain)
      .range(
        yAxisDir === "default"
          ? [innerRadius, outerRadius]
          : [outerRadius, innerRadius],
      );
  } else {
    radiusScale = d3
      .scaleLinear()
      .domain([xMinVal, xMaxVal])
      .range(
        yAxisDir === "default"
          ? [innerRadius, outerRadius]
          : [outerRadius, innerRadius],
      );
  }

  const angleScale = d3
    .scaleLinear()
    .domain([yMinVal, yMaxVal])
    .range(
      xAxisDir === "default" ? [startAngle, endAngle] : [endAngle, startAngle],
    );

  const area = calculatePolarArea(
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
  );

  // If data contains multiple series with a label
  if (data[0].hasOwnProperty("label")) {
    // Group data by label
    const labels = Array.from(new Set(data.map((d) => d.label)));
    labels.forEach((label) => {
      const labelData = data.filter((d) => d.label === label);
      const points = labelData.map((d) => {
        const angle = angleScale(d.y);
        const radius = radiusScale(d.x);
        d.x = radius * Math.cos(angle - Math.PI / 2);
        d.y = radius * Math.sin(angle - Math.PI / 2);
        return d;
      });
      drawShape(g, points, radius, shape, color(label), area, true, options);
    });
  } else {
    const points = data.map((d) => {
      const angle = angleScale(d.y);
      const radius = radiusScale(d.x);
      d.x = radius * Math.cos(angle - Math.PI / 2);
      d.y = radius * Math.sin(angle - Math.PI / 2);
      return d;
    });
    drawShape(g, points, radius, shape, color, area, true, options);
  }

  let xAllInteger = checkAllInteger(data, "x");
  let yAllInteger = checkAllInteger(data, "y");
  const fontStyle = style === "sketch" ? "sketch" : "default";

  let angularValues = null;
  let radialValues = null;

  // draw x-axis
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
    // If there is no axis, default to tickValues from the inner radial axis
    const [xAxis, ticks] = axisRadialInner(angleScale, innerRadius, undefined, {
      allInteger: yAllInteger,
      fontStyle: fontStyle,
    });
    angularValues = ticks.map((val) => angleScale(val));
  }

  // draw y-axis
  const axisLayer = g.append("g").attr("class", "axis");
  if (yAxisPos.includes("left")) {
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else if (yAxisPos.includes("right")) {
    const ticks = axisPolar(axisLayer, endAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
      fontStyle: fontStyle,
    });
    radialValues = ticks.map((val) => radiusScale(val));
  } else {
    // If there is no axis, default to tickValues from the left polar axis
    const ticks = axisPolar(axisLayer, startAngle, yAxisPos, radiusScale, {
      allInteger: xAllInteger,
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

    const refGroup = g.append("g").attr("class", "refline-group");
    createAngularRefLine(refGroup, angularValues, innerRadius, outerRadius);
    createRadialRefLine(refGroup, radialValues, startAngle, endAngle);
    // createPolarBorder(refGroup, innerRadius, outerRadius, startAngle, endAngle);
    g.node().insertBefore(refGroup.node(), g.node().firstChild);
  }
}
