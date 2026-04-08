// Handles reference lines for polar charts.

import * as d3 from "d3";
import { globalSettings } from "../core/global.js";

const numPoints = 50;
const strokeWidth = 0.5;
const strokeOpacity = 0.9;
const strokeDasharray = "";

function getGridStrokeWidth(index, total, edgeWidthMultiplier = 1) {
  const isEdge = index === 0 || index === total - 1;
  return isEdge ? strokeWidth * edgeWidthMultiplier : strokeWidth;
}

export function createVerticalRefLine(g, verticalValues, y1, y2, options = {}) {
  const { edgeWidthMultiplier = 1 } = options;
  g.append("g")
    .attr("class", "grid")
    .append("g")
    .selectAll(".vertical-grid")
    .data(verticalValues)
    .enter()
    .append("line")
    .attr("class", "vertical-grid")
    .attr("x1", (d) => d)
    .attr("y1", y1)
    .attr("x2", (d) => d)
    .attr("y2", y2)
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-width", (_, i) =>
      getGridStrokeWidth(i, verticalValues.length, edgeWidthMultiplier),
    )
    .attr("stroke-opacity", strokeOpacity);
}

export function createHorizontalRefLine(
  g,
  horizontalValues,
  x1,
  x2,
  options = {},
) {
  const { edgeWidthMultiplier = 1 } = options;
  g.append("g")
    .attr("class", "grid")
    .append("g")
    .selectAll(".horizontal-grid")
    .data(horizontalValues)
    .enter()
    .append("line")
    .attr("class", "horizontal-grid")
    .attr("x1", x1)
    .attr("y1", (d) => d)
    .attr("x2", x2)
    .attr("y2", (d) => d)
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-width", (_, i) =>
      getGridStrokeWidth(i, horizontalValues.length, edgeWidthMultiplier),
    )
    .attr("stroke-opacity", strokeOpacity);
}

export function createAngularRefLine(
  g,
  angularValues,
  innerRadius,
  outerRadius,
) {
  g.append("g")
    .attr("class", "grid")
    .append("g")
    .selectAll(".angle-grid")
    .data(angularValues)
    .enter()
    .append("line")
    .attr("class", "angle-grid")
    .attr("x1", (d) => Math.cos(d - Math.PI / 2) * innerRadius)
    .attr("y1", (d) => Math.sin(d - Math.PI / 2) * innerRadius)
    .attr("x2", (d) => Math.cos(d - Math.PI / 2) * outerRadius)
    .attr("y2", (d) => Math.sin(d - Math.PI / 2) * outerRadius)
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-width", strokeWidth)
    .attr("stroke-dasharray", strokeDasharray)
    .attr("stroke-opacity", strokeOpacity);
}

export function createRadialRefLine(g, radialValues, startAngle, endAngle) {
  g.append("g")
    .attr("class", "grid")
    .append("g")
    .selectAll(".radial-grid")
    .data(radialValues)
    .enter()
    .append("path")
    .attr("class", "radial-grid")
    .attr("d", (d) => {
      const arcData = d3.range(numPoints).map((_, i) => {
        const angle =
          startAngle + (endAngle - startAngle) * (i / (numPoints - 1));
        return {
          x: Math.cos(angle - Math.PI / 2) * d,
          y: Math.sin(angle - Math.PI / 2) * d,
        };
      });

      return d3
        .line()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(d3.curveCardinal)(arcData);
    })
    .attr("fill", "none")
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-width", strokeWidth)
    .attr("stroke-dasharray", strokeDasharray)
    .attr("stroke-opacity", strokeOpacity);
}
