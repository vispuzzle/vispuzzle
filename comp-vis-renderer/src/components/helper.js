// rendering helper elements to facilitate visualization

import * as d3 from "d3";
import { globalSettings } from "../core/global.js";

/**
 * Creates a grid with ticks in the given SVG group.
 *
 * @param {Object} g - The `<g>` element to render the grid in.
 * @param {number} width - The width of the grid area.
 * @param {number} height - The height of the grid area.
 * @param {number} xTicks - Number of ticks on the x-axis.
 * @param {number} yTicks - Number of ticks on the y-axis.
 * @param {string} color - The color of the grid lines.
 * @param {string} backgroundColor - The background color of the grid.
 */
export function createGrid(
  g,
  width,
  height,
  xTicks = 10,
  yTicks = 10,
  color = globalSettings.helperColor,
  backgroundColor = globalSettings.bcg,
) {
  // Add a background rectangle
  g.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", backgroundColor);
  return; // The code below is for debugging only

  const xScale = d3.scaleLinear().domain([0, width]).range([0, width]);
  const yScale = d3.scaleLinear().domain([0, height]).range([0, height]);

  const xAxis = d3
    .axisBottom(xScale)
    .ticks(xTicks)
    .tickSize(-height)
    .tickFormat("");
  const yAxis = d3
    .axisLeft(yScale)
    .ticks(yTicks)
    .tickSize(-width)
    .tickFormat("");

  // Draw the grid lines in the x direction
  g.append("g")
    .attr("class", "grid x-grid")
    .attr("transform", `translate(0, ${height})`)
    .call(xAxis)
    .selectAll("line")
    .attr("stroke", color);

  // Draw the grid lines in the y direction
  g.append("g")
    .attr("class", "grid y-grid")
    .call(yAxis)
    .selectAll("line")
    .attr("stroke", color);

  // Remove the default axis line
  g.selectAll(".domain").remove();
}

export function createCartesianBorder(g, config) {
  const { width, height, options } = config || {};
  const { border } = options || {};

  const margin = 4;
  const paths = [];
  if (border === "horizontal") {
    paths.push([
      [margin, -margin],
      [-margin, -margin],
      [-margin, height + margin],
      [margin, height + margin],
    ]);
    paths.push([
      [width - margin, -margin],
      [width + margin, -margin],
      [width + margin, height + margin],
      [width - margin, height + margin],
    ]);
  } else if (border === "vertical") {
    paths.push([
      [-margin, margin],
      [-margin, -margin],
      [width + margin, -margin],
      [width + margin, margin],
    ]);
    paths.push([
      [-margin, height - margin],
      [-margin, height + margin],
      [width + margin, height + margin],
      [width + margin, height - margin],
    ]);
  }

  paths.forEach((points) => {
    g.append("path")
      .datum(points)
      .attr("d", d3.line())
      .attr("fill", "none")
      .attr("stroke", globalSettings.textColorDark)
      .attr("stroke-width", 2)
      .attr("opacity", 0.7);
  });
}

export function createPolarBorder(g, r1, r2, a1, a2) {
  const arc = d3
    .arc()
    .innerRadius(r1)
    .outerRadius(r2)
    .startAngle(a1)
    .endAngle(a2);

  g.append("path")
    .attr("d", arc)
    .attr("fill", "none")
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-dasharray", "2,4")
    .attr("stroke-width", 1)
    .attr("opacity", 0.7);
}

export function createNormalBorder(g, width, height) {
  g.append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "none")
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-dasharray", "2,8")
    .attr("stroke-width", 1)
    .attr("opacity", 0.7);
}

export function createBrace(g, width, height, direction) {
  // direction === "horizontal" --> draw brace on top
  // direction === "vertical" --> draw brace on right
  const bracePath = d3.path();
  const braceSize = 20;

  if (direction === "horizontal") {
    bracePath.moveTo(0, -braceSize);
    bracePath.lineTo(0, -braceSize * 1.5);
    bracePath.lineTo(width / 2 - braceSize / 2, -braceSize * 1.5);
    bracePath.lineTo(width / 2, -braceSize * 1.5 - braceSize / 2);
    bracePath.lineTo(width / 2 + braceSize / 2, -braceSize * 1.5);
    bracePath.lineTo(width, -braceSize * 1.5);
    bracePath.lineTo(width, -braceSize);
  } else if (direction === "vertical") {
    bracePath.moveTo(width + braceSize, 0);
    bracePath.lineTo(width + braceSize * 1.5, 0);
    bracePath.lineTo(width + braceSize * 1.5, height / 2 - braceSize / 2);
    bracePath.lineTo(width + braceSize * 1.5 + braceSize / 2, height / 2);
    bracePath.lineTo(width + braceSize * 1.5, height / 2 + braceSize / 2);
    bracePath.lineTo(width + braceSize * 1.5, height);
    bracePath.lineTo(width + braceSize, height);
  }

  g.append("path")
    .attr("d", bracePath.toString())
    .attr("fill", "none")
    .attr("stroke", globalSettings.helperColor)
    .attr("stroke-width", 2);
}
