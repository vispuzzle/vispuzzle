// This file renders basic **visual elements** like bars, lines and circles, with different styles/variations.

import * as d3 from "d3";
import rough from "roughjs";
import { globalSettings } from "../core/global.js";
import { showTooltip, removeTooltip } from "../utils/tooltip.js";
import { genderIcons as ICONS } from "../utils/iconMap.js";

const format = globalSettings.format;
/**
 * Node object for the A* pathfinding algorithm.
 */
class AStarNode {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.g_cost = 0; // Cost from the start node to the current node
    this.h_cost = 0; // Estimated cost from the current node to the goal (heuristic)
    this.f_cost = 0; // g_cost + h_cost
    this.parent = null; // Parent node
  }
}

/**
 * A* pathfinder.
 */
class AStarFinder {
  constructor(grid) {
    this.grid = grid;
  }

  // Manhattan-distance heuristic function
  heuristic(nodeA, nodeB) {
    return Math.abs(nodeA.x - nodeB.x) + Math.abs(nodeA.y - nodeB.y);
  }

  findPath(startX, startY, endX, endY) {
    const startNode = new AStarNode(startX, startY);
    const endNode = new AStarNode(endX, endY);

    const openSet = [startNode];
    const closedSet = new Set();

    const maxIterations = 80000;
    const maxSetSize = 40000;
    let iterations = 0;

    while (openSet.length > 0) {
      iterations++;

      // Check whether max iterations or set size is exceeded
      if (
        iterations > maxIterations ||
        openSet.length > maxSetSize ||
        closedSet.size > maxSetSize
      ) {
        console.warn(
          `A* exited early: iterations=${iterations}, openSet.length=${openSet.length}, closedSet.size=${closedSet.size}`,
        );
        return null;
      }

      // Find the node with the lowest f_cost in openSet
      let currentNode = openSet[0];
      for (let i = 1; i < openSet.length; i++) {
        if (
          openSet[i].f_cost < currentNode.f_cost ||
          (openSet[i].f_cost === currentNode.f_cost &&
            openSet[i].h_cost < currentNode.h_cost)
        ) {
          currentNode = openSet[i];
        }
      }

      // Move the current node from openSet to closedSet
      const currentIndex = openSet.indexOf(currentNode);
      openSet.splice(currentIndex, 1);
      closedSet.add(`${currentNode.x},${currentNode.y}`);

      // If the goal is reached, backtrack the path
      if (currentNode.x === endNode.x && currentNode.y === endNode.y) {
        const path = [];
        let temp = currentNode;
        while (temp !== null) {
          path.push([temp.x, temp.y]);
          temp = temp.parent;
        }
        return path.reverse();
      }

      // Explore neighbor nodes (up, down, left, right)
      const neighbors = [];
      const directions = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]; // up/down/left/right
      for (const [dx, dy] of directions) {
        const newX = currentNode.x + dx * this.grid.nodeSize;
        const newY = currentNode.y + dy * this.grid.nodeSize;

        if (this.grid.isWalkable(newX, newY)) {
          neighbors.push(new AStarNode(newX, newY));
        }
      }

      for (const neighbor of neighbors) {
        if (closedSet.has(`${neighbor.x},${neighbor.y}`)) {
          continue;
        }

        const newGCost =
          currentNode.g_cost + this.heuristic(currentNode, neighbor);

        const existingNode = openSet.find(
          (node) => node.x === neighbor.x && node.y === neighbor.y,
        );

        if (existingNode === undefined || newGCost < existingNode.g_cost) {
          neighbor.g_cost = newGCost;
          neighbor.h_cost = this.heuristic(neighbor, endNode);
          neighbor.f_cost = neighbor.g_cost + neighbor.h_cost;
          neighbor.parent = currentNode;

          if (existingNode === undefined) {
            openSet.push(neighbor);
          }
        }
      }
    }

    return null; // Path not found
  }
}

/**
 * Define the pathfinding grid.
 */
class Grid {
  constructor(avoidRects, nodeSize = 10) {
    this.avoidRects = avoidRects;
    this.nodeSize = nodeSize; // Grid node size; can be adjusted to balance accuracy and performance
  }

  // Check whether a point is walkable (i.e., not inside any obstacle)
  isWalkable(x, y) {
    for (const rect of this.avoidRects) {
      // Expand obstacle bounds slightly to avoid paths hugging too closely
      const padding = 20;
      const [x1, y1, x2, y2] = [
        rect[0] - padding,
        rect[1] - padding,
        rect[2] + padding,
        rect[3] + padding,
      ];
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Creates a single Cartesian bar element in a D3 selection.
 *
 * @param {*} g - The D3 selection to append the bar to.
 * @param {*} left - The left position of the bar.
 * @param {*} top - The top position of the bar.
 * @param {*} width - The width of the bar.
 * @param {*} height - The height of the bar.
 * @param {*} color - The color of the bar.
 * @param {*} style - The style of the bar. Choices: ["default", "sketch", "3d", "round", "triangle-up", "triangle-down", "triangle-left", "triangle-right"].
 */
export function createCartesianBar(
  g,
  left,
  top,
  width,
  height,
  color,
  style = "default",
  options = {},
) {
  // TODO: Move some shared settings into options and adjust the logic
  const maxWidth = options.maxWidth || null;
  switch (style) {
    case "background": {
      g.append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", color)
        .attr("opacity", 0.2);
      break;
    }
    case "sketch": {
      const roughSvg = rough.svg(g.node().ownerSVGElement);
      const roughRect = roughSvg.rectangle(left, top, width, height, {
        fill: color,
        stroke: color,
        hachureAngle: 60, // Angle of the fill lines
        hachureGap: 4, // Gap between fill lines
        roughness: 1, // How rough the lines are
        strokeWidth: 2, // Width of the stroke
      });
      g.node().appendChild(roughRect);
      break;
    }
    case "3d": {
      const depth = 6; // Define 3D "depth"

      // Set brighter and darker colors for the top and side to simulate lighting
      const topColor = d3.color(color).brighter(0.7);
      const sideColor = d3.color(color).darker(0.4);

      // Create a group element to combine the 3D parts
      const g3d = g.append("g");

      // 1. Draw the front of the bar (main rectangle)
      g3d
        .append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", color);

      // 2. Draw the top (a parallelogram)
      // Path: top left corner -> top back corner -> bottom back corner -> top right corner
      g3d
        .append("path")
        .attr(
          "d",
          `M${left} ${top} L${left + depth} ${top - depth} L${left + width + depth} ${top - depth} L${left + width} ${top} Z`,
        )
        .attr("fill", topColor);

      // 3. Draw the side (another parallelogram)
      // Path: top right corner -> top back corner -> bottom back corner -> bottom right corner
      g3d
        .append("path")
        .attr(
          "d",
          `M${left + width} ${top} L${left + width + depth} ${top - depth} L${left + width + depth} ${top + height - depth} L${left + width} ${top + height} Z`,
        )
        .attr("fill", sideColor);

      break;
    }
    case "shadow": {
      // Stacked cubes style

      const cubeSize = 20; // Height and width of each cube
      const depth = width / 2; // Cube depth to enhance the 3D effect

      // Calculate how many full cubes are needed
      const numFullCubes = Math.floor(height / cubeSize);
      // Height of the (possibly partial) top cube
      const topCubeHeight = height % cubeSize;

      // Create a group element for the whole stack
      const stackGroup = g.append("g").attr("class", "stacked-cubes");

      // Create a shadow effect
      const shadowOffsetY = height * 0.3;
      const shadowOffsetX = -shadowOffsetY * 0.9;
      const shadowWidth = width * 0.9;
      const shadowColor = d3.color(color).darker(1.5);
      shadowColor.opacity = 0.6;

      // Create a shadow gradient
      const gradientId = `shadow-gradient-${Math.random().toString(36).slice(2, 11)}`;
      const gradient = stackGroup
        .append("defs")
        .append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%")
        .attr("y1", "100%") // Start from the bottom
        .attr("x2", "0%") // End at the top
        .attr("y2", "0%"); // Vertical gradient: darker closer to the bar (top)

      gradient
        .append("stop")
        .attr("offset", "0%") // Farther from the bar (bottom)
        .attr("stop-color", shadowColor.toString())
        .attr("stop-opacity", 0.1); // Lighter opacity

      gradient
        .append("stop")
        .attr("offset", "100%") // Closer to the bar (top)
        .attr("stop-color", shadowColor.toString())
        .attr("stop-opacity", 0.8); // Darker opacity

      // Draw the shadow
      stackGroup
        .append("path")
        .attr(
          "d",
          `
          M${left} ${top + height}
          L${left + shadowOffsetX} ${top + height + shadowOffsetY}
          L${left + shadowWidth + shadowOffsetX} ${top + height + shadowOffsetY}
          L${left + width} ${top + height}
          Z
        `,
        )
        .attr("fill", `url(#${gradientId})`)
        .style("z-index", "-1");

      // Draw each cube
      for (let i = 0; i <= numFullCubes; i++) {
        // Compute the height of the current cube (the top one may be partial)
        const cubeHeight = i === numFullCubes ? topCubeHeight : cubeSize;

        // Compute the top position for the current cube
        const cubeTop =
          top +
          height -
          (i + 1) * cubeSize +
          (i === numFullCubes ? cubeSize - topCubeHeight : 0);

        // Adjust color to enhance the 3D effect: darker at bottom, lighter at top
        const factor = 0.8 + (i / (numFullCubes || 1)) * 0.4; // Brightness factor from 0.8 to 1.2
        const cubeBaseColor = d3.color(color).brighter(factor - 1);

        // Use different face colors to enhance the 3D effect
        const cubeTopColor = d3.color(cubeBaseColor).brighter(0.5);
        const cubeFrontColor = cubeBaseColor;
        const cubeRightColor = d3.color(cubeBaseColor).darker(0.5);

        const cube = stackGroup.append("g").attr("class", "cube");

        // 1. Draw the cube front face
        cube
          .append("rect")
          .attr("x", left)
          .attr("y", cubeTop)
          .attr("width", width)
          .attr("height", cubeHeight)
          .attr("fill", cubeFrontColor);

        // 2. Draw the cube top face (parallelogram)
        if (i === numFullCubes || i === 0) {
          // Only draw the top face for the topmost and bottommost cubes
          cube
            .append("path")
            .attr(
              "d",
              `M${left} ${cubeTop} L${left + depth} ${cubeTop - depth} L${left + width + depth} ${cubeTop - depth} L${left + width} ${cubeTop} Z`,
            )
            .attr("fill", cubeTopColor);
        }

        // 3. Draw the cube right face (parallelogram)
        cube
          .append("path")
          .attr(
            "d",
            `M${left + width} ${cubeTop} L${left + width + depth} ${cubeTop - depth} L${left + width + depth} ${cubeTop + cubeHeight - depth} L${left + width} ${cubeTop + cubeHeight} Z`,
          )
          .attr("fill", cubeRightColor);
      }

      break;
    }
    case "round": {
      // Round bar chart
      const radius = Math.min(width, height) * 0.2;
      g.append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("rx", radius)
        .attr("ry", radius)
        .attr("fill", color);
      break;
    }
    case "round-up": {
      const gradientId = `round-up-gradient-${Math.random().toString(36).slice(2, 11)}`;
      const gradient = g
        .append("defs")
        .append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%")
        .attr("x2", "0%")
        .attr("y1", "0%")
        .attr("y2", "100%");
      gradient
        .append("stop")
        .attr("offset", "30%")
        .attr("stop-color", color)
        .attr("stop-opacity", 1);
      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0.1);

      g.append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", `url(#${gradientId})`);

      const cx = left + width / 2;
      const cy = top + 0.5;
      const radius = width / 2;

      const arcGenerator = d3
        .arc()
        .innerRadius(0)
        .outerRadius(radius)
        .startAngle(-Math.PI / 2)
        .endAngle(Math.PI / 2);

      g.append("path")
        .attr("d", arcGenerator())
        .attr("transform", `translate(${cx}, ${cy})`)
        .attr("fill", color);
      break;
    }
    case "round-down": {
      const gradientId = `round-down-gradient-${Math.random().toString(36).slice(2, 11)}`;
      const gradient = g
        .append("defs")
        .append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%")
        .attr("x2", "0%")
        .attr("y1", "100%")
        .attr("y2", "0%");
      gradient
        .append("stop")
        .attr("offset", "30%")
        .attr("stop-color", color)
        .attr("stop-opacity", 1);
      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0.1);

      g.append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", `url(#${gradientId})`);

      const cx = left + width / 2;
      const cy = top + height - 0.5;
      const radius = width / 2;

      const arcGenerator = d3
        .arc()
        .innerRadius(0)
        .outerRadius(radius)
        .startAngle(Math.PI / 2)
        .endAngle((3 * Math.PI) / 2);

      g.append("path")
        .attr("d", arcGenerator())
        .attr("transform", `translate(${cx}, ${cy})`)
        .attr("fill", color);
      break;
    }
    case "round-left": {
      const gradientId = `round-left-gradient-${Math.random().toString(36).slice(2, 11)}`;
      const gradient = g
        .append("defs")
        .append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%")
        .attr("x2", "100%")
        .attr("y1", "0%")
        .attr("y2", "0%");
      gradient
        .append("stop")
        .attr("offset", "30%")
        .attr("stop-color", color)
        .attr("stop-opacity", 1);
      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0.1);

      g.append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", `url(#${gradientId})`);

      const cx = left + 0.5;
      const cy = top + height / 2;
      const radius = height / 2;

      const arcGenerator = d3
        .arc()
        .innerRadius(0)
        .outerRadius(radius)
        .startAngle(Math.PI)
        .endAngle(Math.PI * 2);

      g.append("path")
        .attr("d", arcGenerator())
        .attr("transform", `translate(${cx}, ${cy})`)
        .attr("fill", color);
      break;
    }
    case "round-right": {
      const gradientId = `round-right-gradient-${Math.random().toString(36).slice(2, 11)}`;
      const gradient = g
        .append("defs")
        .append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "100%")
        .attr("x2", "0%")
        .attr("y1", "0%")
        .attr("y2", "0%");
      gradient
        .append("stop")
        .attr("offset", "30%")
        .attr("stop-color", color)
        .attr("stop-opacity", 1);
      gradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", color)
        .attr("stop-opacity", 0.1);

      g.append("rect")
        .attr("x", left)
        .attr("y", top)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", `url(#${gradientId})`);

      const cx = left + width - 0.5;
      const cy = top + height / 2;
      const radius = height / 2;

      const arcGenerator = d3
        .arc()
        .innerRadius(0)
        .outerRadius(radius)
        .startAngle(0)
        .endAngle(Math.PI);

      g.append("path")
        .attr("d", arcGenerator())
        .attr("transform", `translate(${cx}, ${cy})`)
        .attr("fill", color);
      break;
    }
    case "round-with-sketch-right": {
      const patternId = `diagonal-stripe-${Math.random().toString(36).substr(2, 9)}`;

      let defs = g.select("defs");
      if (defs.empty()) {
        defs = g.append("defs");
      }

      if (defs.select(`#${patternId}`).empty()) {
        const pattern = defs
          .append("pattern")
          .attr("id", patternId)
          .attr("patternUnits", "userSpaceOnUse")
          .attr("width", 4)
          .attr("height", 4)
          .attr("patternTransform", "rotate(45)");

        pattern
          .append("rect")
          .attr("width", 3)
          .attr("height", 4)
          .attr("fill", color)
          .attr("opacity", 0.8);
      }

      const radius = height / 2;
      const straightWidth = Math.max(0, width - radius);
      const arcStartX = left + straightWidth;

      const pathD = `
        M ${left} ${top}
        L ${arcStartX} ${top}
        A ${radius} ${radius} 0 0 1 ${arcStartX} ${top + height}
        L ${left} ${top + height}
        Z
      `;

      g.append("path")
        .attr("d", pathD)
        .attr("fill", `url(#${patternId})`)
        .attr("stroke", color)
        .attr("stroke-width", 2);
      break;
    }
    case "round-solid-right": {
      const radius = height / 2;
      const straightWidth = Math.max(0, width - radius);
      const arcStartX = left + straightWidth;

      const pathD = `
        M ${left} ${top}
        L ${arcStartX} ${top}
        A ${radius} ${radius} 0 0 1 ${arcStartX} ${top + height}
        L ${left} ${top + height}
        Z
      `;

      g.append("path")
        .attr("d", pathD)
        .attr("stroke", "none")
        .attr("fill", color)
        .attr("opacity", 0.7);

      g.append("path")
        .attr("d", pathD)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 2);
      break;
    }
    case "triangle-up": {
      g.append("polygon")
        .attr(
          "points",
          `${left + width / 2},${top} ${left},${top + height} ${left + width},${top + height}`,
        )
        .attr("fill", color);
      break;
    }
    case "triangle-down": {
      g.append("polygon")
        .attr(
          "points",
          `${left + width / 2},${top + height} ${left},${top} ${left + width},${top}`,
        )
        .attr("fill", color);
      break;
    }
    case "triangle-left": {
      g.append("polygon")
        .attr(
          "points",
          `${left},${top + height / 2} ${left + width},${top} ${left + width},${top + height}`,
        )
        .attr("fill", color);
      break;
    }
    case "triangle-right": {
      g.append("polygon")
        .attr(
          "points",
          `${left + width},${top + height / 2} ${left},${top} ${left},${top + height}`,
        )
        .attr("fill", color);
      break;
    }
    default: {
      // other styles that cannot be matched using switch-case
      if (style?.startsWith("isotype")) {
        if (style.startsWith("isotype-horizontal")) {
          // hard-coded for male-female icons for now
          const iconType = style.split("-")[2] || "man";
          const pathData = ICONS[iconType];

          const ORIGIN_W = 70;
          const ORIGIN_H = 190;
          const MIN_PAD = 0.2;

          const paddingY = height * 0.1;
          const targetIconHeight = height - paddingY;
          const scale = targetIconHeight / ORIGIN_H;

          const targetIconWidth = ORIGIN_W * scale;

          let count = Math.floor(maxWidth / targetIconWidth);
          let gap = (maxWidth - count * targetIconWidth) / count;

          if (gap < MIN_PAD * targetIconWidth) {
            count = Math.floor(
              (maxWidth / targetIconWidth - MIN_PAD) / (1 + MIN_PAD),
            );
            gap = (maxWidth - count * targetIconWidth) / count;
          }
          const stepX = targetIconWidth + gap;

          const ratio = Math.min(Math.max(width / maxWidth, 0), 1);

          const totalFilledIcons = count * ratio;
          const fullFilledCount = Math.floor(totalFilledIcons);
          const partialFillRatio = totalFilledIcons - fullFilledCount;

          const clipWidth =
            fullFilledCount * stepX + partialFillRatio * targetIconWidth;

          const _left = left + 2;

          // 1. Draw background icons (gray)
          for (let i = 0; i < count; i++) {
            const xPos = _left + i * stepX;
            const yPos = top + paddingY / 2;

            g.append("path")
              .attr("d", pathData)
              .attr("fill", "#e0e0e0")
              .attr("opacity", 0.6)
              .attr("stroke", "none")
              .attr("transform", `translate(${xPos}, ${yPos}) scale(${scale})`);
          }

          // 2. Draw foreground icons (colored, clipped)
          const clipId = `bar-clip-${Math.random().toString(36).substr(2, 9)}`;

          g.append("defs")
            .append("clipPath")
            .attr("id", clipId)
            .append("rect")
            .attr("x", _left)
            .attr("y", top)
            .attr("width", clipWidth)
            .attr("height", height);

          const iconGroup = g.append("g").attr("clip-path", `url(#${clipId})`);

          for (let i = 0; i < totalFilledIcons; i++) {
            const xPos = _left + i * stepX;
            const yPos = top + paddingY / 2;

            iconGroup
              .append("path")
              .attr("d", pathData)
              .attr("fill", color)
              .attr("opacity", 0.7)
              .attr("stroke", "none")
              .attr("transform", `translate(${xPos}, ${yPos}) scale(${scale})`);

            iconGroup
              .append("path")
              .attr("d", pathData)
              .attr("fill", "none")
              .attr("opacity", 1)
              .attr("stroke", color)
              .attr("stroke-width", 10)
              .attr("transform", `translate(${xPos}, ${yPos}) scale(${scale})`);
          }
        } else {
          // Default fallback to basic style for other isotype types
          g.append("rect")
            .attr("x", left)
            .attr("y", top)
            .attr("width", width)
            .attr("height", height)
            .attr("fill", color);
        }
      } else {
        // Default fallback to basic style
        g.append("rect")
          .attr("x", left)
          .attr("y", top)
          .attr("width", width)
          .attr("height", height)
          .attr("fill", color);
      }
    }
  }
}

/**
 * Creates a single polar bar element in a D3 selection.
 *
 * @param {*} g - The D3 selection to append the bar to.
 * @param {number} startAngle - The start angle of the bar in radians.
 * @param {number} endAngle - The end angle of the bar in radians.
 * @param {number} innerRadius - The inner radius of the bar.
 * @param {number} outerRadius - The outer radius of the bar.
 * @param {string} color - The color of the bar.
 * @param {string} style - The style of the bar. Choices: ["default", "sketch", "3d", "round"].
 */
export function createPolarBar(
  g,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  color,
  style = "default",
) {
  // D3's arc generator is the polar equivalent of a rectangle.
  const arcGenerator = d3
    .arc()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius)
    .startAngle(startAngle)
    .endAngle(endAngle);

  switch (style) {
    case "background": {
      // background style: add opacity
      g.append("path")
        .attr("d", arcGenerator())
        .attr("fill", color)
        .attr("opacity", 0.2);
      break;
    }
    case "sketch": {
      // For sketch style, we first generate the SVG path data string
      const pathData = arcGenerator();
      const roughSvg = rough.svg(g.node().ownerSVGElement);
      // Then use rough.js to draw that path with a sketchy fill
      const roughArc = roughSvg.path(pathData, {
        fill: color,
        stroke: color,
        hachureAngle: 60,
        hachureGap: 4,
        roughness: 1.5,
        strokeWidth: 2,
      });
      g.node().appendChild(roughArc);
      break;
    }
    case "3d": {
      // For 3D, we create a simple "lifted" effect by drawing a shadow.
      const depth = 4;
      const sideColor = d3.color(color).darker(0.6);

      // 1. Draw the shadow/side path first, slightly offset
      g.append("path")
        .attr("d", arcGenerator())
        .attr("transform", `translate(${depth * 0.7}, ${depth})`) // Offset down and to the side
        .attr("fill", sideColor);

      // 2. Draw the main, top path
      g.append("path").attr("d", arcGenerator()).attr("fill", color);
      break;
    }
    case "round": {
      // For round style, we use the arc generator's cornerRadius feature.
      const cornerRadius = (outerRadius - innerRadius) * 0.5; // Creates a pill shape
      arcGenerator.cornerRadius(cornerRadius);
      g.append("path").attr("d", arcGenerator()).attr("fill", color);
      break;
    }
    case "round-clockwise": {
      const cornerRadius = (outerRadius - innerRadius) * 0.5;
      const clipPathId = `arc-clip-path-${Math.random().toString(36).slice(2, 11)}`;
      const defs = g.append("defs");

      // Define a dedicated generator for the large arc with rounded corners
      const clipArcGen = d3
        .arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius)
        .startAngle(startAngle) // Use the full start/end angles
        .endAngle(endAngle)
        .cornerRadius(cornerRadius); // Apply rounded corners here!

      defs
        .append("clipPath")
        .attr("id", clipPathId)
        .append("path")
        .attr("d", clipArcGen()); // Generate the path with clipArcGen; note we call clipArcGen()

      const numOfSegment = 100;
      const totalAngle = endAngle - startAngle;
      const segmentAngle = totalAngle / numOfSegment;
      const colorInterpolator = d3.interpolateRgb(
        color,
        d3.color(color).copy({ opacity: 0.5 }),
      );
      const segmentsData = [];
      for (let i = 0; i < numOfSegment; i++) {
        segmentsData.push({
          startAngle: startAngle + i * segmentAngle,
          endAngle: startAngle + (i + 1) * segmentAngle,
        });
      }

      // Define an arc generator without rounded corners for segments
      const segmentArcGen = d3
        .arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);

      // Create a new <g> element to hold all segments
      const segmentsGroup = g
        .append("g")
        .attr("class", "polar-bar-segments")
        // Key step: apply clip-path!
        .attr("clip-path", `url(#${clipPathId})`);

      // Draw all segments in this new group
      segmentsGroup
        .selectAll("path")
        .data(segmentsData)
        .enter()
        .append("path")
        .attr("d", segmentArcGen) // Use the generator without rounded corners
        .attr("fill", (d, i) => {
          return colorInterpolator(i / (numOfSegment - 1));
        });
      break;
    }
    case "round-counterclockwise": {
      const cornerRadius = (outerRadius - innerRadius) * 0.5;
      const clipPathId = `arc-clip-path-${Math.random().toString(36).slice(2, 11)}`;
      const defs = g.append("defs");

      // Define a dedicated generator for the large arc with rounded corners
      const clipArcGen = d3
        .arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius)
        .startAngle(startAngle) // Use the full start/end angles
        .endAngle(endAngle)
        .cornerRadius(cornerRadius); // Apply rounded corners here!

      defs
        .append("clipPath")
        .attr("id", clipPathId)
        .append("path")
        .attr("d", clipArcGen()); // Generate the path with clipArcGen; note we call clipArcGen()

      const numOfSegment = 100;
      const totalAngle = endAngle - startAngle;
      const segmentAngle = totalAngle / numOfSegment;
      const colorInterpolator = d3.interpolateRgb(
        d3.color(color).copy({ opacity: 0.5 }),
        color,
      );
      const segmentsData = [];
      for (let i = 0; i < numOfSegment; i++) {
        segmentsData.push({
          startAngle: startAngle + i * segmentAngle,
          endAngle: startAngle + (i + 1) * segmentAngle,
        });
      }

      // Define an arc generator without rounded corners for segments
      const segmentArcGen = d3
        .arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);

      // Create a new <g> element to hold all segments
      const segmentsGroup = g
        .append("g")
        .attr("class", "polar-bar-segments")
        // Key step: apply clip-path!
        .attr("clip-path", `url(#${clipPathId})`);

      // Draw all segments in this new group
      segmentsGroup
        .selectAll("path")
        .data(segmentsData)
        .enter()
        .append("path")
        .attr("d", segmentArcGen) // Use the generator without rounded corners
        .attr("fill", (d, i) => {
          return colorInterpolator(i / (numOfSegment - 1));
        });
      break;
    }
    default: {
      // The "default" style and any other fallback
      g.append("path").attr("d", arcGenerator()).attr("fill", color);
    }
  }
}

/**
 * Creates a single circle element in a D3 selection.
 *
 * @param {*} g - The D3 selection to append the circle to.
 * @param {*} cx - The x-coordinate of the circle's center.
 * @param {*} cy - The y-coordinate of the circle's center.
 * @param {*} r - The radius of the circle.
 * @param {*} color - The color of the circle.
 * @param {*} style - The style of the circle. Choices: ["default", "sketch"].
 */
export function createCircle(g, cx, cy, r, color, style = "default") {
  if (style === "default") {
    g.append("circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", r)
      .attr("fill", color);
  } else if (style === "sketch") {
    const roughSvg = rough.svg(g.node().ownerSVGElement);
    const roughCircle = roughSvg.circle(cx, cy, r, {
      fill: color,
      stroke: color,
      hachureAngle: 60,
      hachureGap: 4,
      roughness: 1,
      strokeWidth: 2,
    });
    g.node().appendChild(roughCircle);
  }
}

/**
 * Creates a single link path element in a D3 selection.
 * (MODIFIED to support Sankey-like links for horizontal/vertical directions)
 *
 * @param {*} g - The D3 selection to append the link to.
 * @param {*} startX - The start X coordinate of the link.
 * @param {*} startY - The start Y coordinate of the link.
 * @param {*} endX - The end X Coordinate of the link.
 * @param {*} endY - The end Y coordinate of the link.
 * @param {*} strokeWidth - The desired thickness of the link.
 * @param {*} color - The color of the link.
 * @param {*} style - The style of the link. Choices: ["default", "sketch", "straight", "arc", "twist"].
 * @param {*} opacity - The opacity of the link.
 * @param {*} direction - The direction of the link. Choices: ["vertical", "horizontal"].
 * @param {*} mark - Whether to add small circle markers at the start and end points.
 * @param {*} avoidRects - An array of rectangles to avoid when drawing the link.
 * @param {*} counts - To track the times of each avoid-rect.
 */
export function createLinkPath(
  g,
  startX,
  startY,
  endX,
  endY,
  strokeWidth,
  color,
  style = "default",
  opacity = 0.65,
  direction = "vertical",
  mark = true, // Whether to add small circle markers at the start and end points
  avoidRects = [],
  counts = [],
) {
  // --- Obstacle-avoidance logic (provided below), kept unchanged ---
  const localAvoidRects = avoidRects.map((rect) => [...rect]);
  let allControlPoints = [];
  let currentidx = 0;
  const checkPointNearRect = (x, y, s) => {
    let nearestRect = null;
    let nearestDistance = Infinity;
    let nearestBoundaryPoint = null;
    let insideRect = false;
    for (const rect of localAvoidRects) {
      const [x1, y1, x2, y2] = rect;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        const distToLeft = x - x1;
        const distToRight = x2 - x;
        const distToTop = y - y1;
        const distToBottom = y2 - y;
        const minDist = Math.min(
          distToLeft,
          distToRight,
          distToTop,
          distToBottom,
        );
        let boundaryPoint;
        if (minDist === distToLeft) {
          boundaryPoint = [x1, y];
        } else if (minDist === distToRight) {
          boundaryPoint = [x2, y];
        } else if (minDist === distToTop) {
          boundaryPoint = [x, y1];
        } else {
          boundaryPoint = [x, y2];
        }
        insideRect = true;
        nearestDistance = 0.0;
        nearestRect = rect;
        nearestBoundaryPoint = boundaryPoint;
        break;
      } else {
        const closestX = Math.max(x1, Math.min(x, x2));
        const closestY = Math.max(y1, Math.min(y, y2));
        const distance = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
        if (distance <= 50 && distance < nearestDistance) {
          nearestDistance = distance;
          nearestRect = rect;
          nearestBoundaryPoint = [closestX, closestY];
        }
      }
    }
    if (nearestBoundaryPoint) {
      const rectIndex = localAvoidRects.indexOf(nearestRect);
      let [dx, dy] = [nearestBoundaryPoint[0] - x, nearestBoundaryPoint[1] - y];
      let p = nearestBoundaryPoint;
      let length = Math.max(30 + counts[rectIndex] * 5 - nearestDistance, 5);
      if (!insideRect) {
        dx = -1 * dx;
        dy = -1 * dy;
        p = [x, y];
      }
      let n_unit = [
        (dx / Math.sqrt(dx * dx + dy * dy)) * length,
        (dy / Math.sqrt(dx * dx + dy * dy)) * length,
      ];
      const newControlPoint = [p[0] + n_unit[0], p[1] + n_unit[1]];
      if (nearestRect) {
        const [x1, y1, x2, y2] = nearestRect;
        const expandedRect = [
          Math.min(x1 - counts[rectIndex] * 5, newControlPoint[0] + 23),
          Math.min(y1 - counts[rectIndex] * 5, newControlPoint[1] + 23),
          Math.max(x2 + counts[rectIndex] * 5, newControlPoint[0] - 23),
          Math.max(y2 + counts[rectIndex] * 5, newControlPoint[1] - 23),
        ];
        if (rectIndex !== -1) {
          localAvoidRects[rectIndex] = expandedRect;
        }
        counts[rectIndex] += 1;
      }
      if (s) {
        allControlPoints.unshift(newControlPoint);
        currentidx++;
      } else {
        allControlPoints.push(newControlPoint);
      }
    }
  };
  checkPointNearRect(startX, startY, true);
  checkPointNearRect(endX, endY, false);
  allControlPoints.unshift([startX, startY]);
  allControlPoints.push([endX, endY]);
  const connectWithPerpendicularSegments = (fromPoint, toPoint, obstacles) => {
    const grid = new Grid(obstacles, 1);
    const finder = new AStarFinder(grid);
    const nodeSize = grid.nodeSize;
    const startXGrid = Math.round(fromPoint[0] / nodeSize) * nodeSize;
    const startYGrid = Math.round(fromPoint[1] / nodeSize) * nodeSize;
    const endXGrid = Math.round(toPoint[0] / nodeSize) * nodeSize;
    const endYGrid = Math.round(toPoint[1] / nodeSize) * nodeSize;
    if (
      !grid.isWalkable(startXGrid, startYGrid) ||
      !grid.isWalkable(endXGrid, endYGrid)
    ) {
      console.warn(
        "Can't find path because start or end point is blocked by an obstacle.",
      );
      return [fromPoint, toPoint];
    }
    const rawPath = finder.findPath(startXGrid, startYGrid, endXGrid, endYGrid);
    if (!rawPath) {
      const error = new Error(
        `Can't find path because start or end point is blocked by an obstacle: (${startXGrid}, ${startYGrid}) -> (${endXGrid}, ${endYGrid})`,
      );
      error.code = "LINK_PATH_NOT_FOUND";
      error.pathContext = {
        fromPoint,
        toPoint,
        startXGrid,
        startYGrid,
        endXGrid,
        endYGrid,
      };
      throw error;
    }
    if (rawPath.length < 3) {
      return rawPath;
    }
    const simplifiedPath = [rawPath[0]];
    for (let i = 1; i < rawPath.length - 1; i++) {
      const prev = rawPath[i - 1];
      const current = rawPath[i];
      const next = rawPath[i + 1];
      if (
        current[0] - prev[0] !== next[0] - current[0] ||
        current[1] - prev[1] !== next[1] - current[1]
      ) {
        simplifiedPath.push(current);
      }
    }
    simplifiedPath.push(rawPath[rawPath.length - 1]);
    return simplifiedPath;
  };
  if (
    allControlPoints.length >= 2 &&
    currentidx < allControlPoints.length - 1
  ) {
    const fromPoint = allControlPoints[currentidx];
    const toPoint = allControlPoints[currentidx + 1];
    const pathSegments = connectWithPerpendicularSegments(
      fromPoint,
      toPoint,
      localAvoidRects,
    );
    allControlPoints.splice(currentidx + 1, 0, ...pathSegments.slice(1, -1));
  }
  // --- End of obstacle-avoidance logic ---

  switch (style) {
    case "straight": {
      g.append("line")
        .attr("x1", startX)
        .attr("y1", startY)
        .attr("x2", endX)
        .attr("y2", endY)
        .attr("stroke", color)
        .attr("stroke-width", strokeWidth)
        .attr("stroke-opacity", opacity);
      break;
    }
    case "arc": {
      const path = d3.path();
      path.moveTo(startX, startY);
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const offset = Math.abs(endX - startX) * 0.3;
      const controlX = midX;
      const controlY = midY - offset;
      path.quadraticCurveTo(controlX, controlY, endX, endY);
      g.append("path")
        .attr("d", path.toString())
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", strokeWidth)
        .attr("stroke-opacity", opacity);
      break;
    }
    case "twist": {
      const path = d3.path();
      if (allControlPoints.length >= 2) {
        path.moveTo(allControlPoints[0][0], allControlPoints[0][1]);
        for (let i = 1; i < allControlPoints.length; i++) {
          path.lineTo(allControlPoints[i][0], allControlPoints[i][1]);
        }
      } else {
        path.moveTo(startX, startY);
        path.lineTo(endX, endY);
      }
      g.append("path")
        .attr("d", path.toString())
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", strokeWidth)
        .attr("stroke-opacity", opacity);
      break;
    }
    case "curve": {
      const points =
        allControlPoints.length >= 2
          ? allControlPoints
          : [
              [startX, startY],
              [endX, endY],
            ];
      const lineGenerator = d3
        .line()
        .curve(d3.curveCatmullRom.alpha(0.5))
        .x((d) => d[0])
        .y((d) => d[1]);
      g.append("path")
        .attr("d", lineGenerator(points))
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", strokeWidth)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("stroke-opacity", opacity);
      break;
    }
    default: {
      // Handle 'vertical' and 'horizontal' directions

      const dy = endY - startY;
      const dx = endX - startX;
      const halfWidth = strokeWidth / 2;

      let controlX1, controlY1, controlX2, controlY2, pathData;

      if (direction === "horizontal") {
        // Adjust the middle width based on Y-axis displacement
        const twistRatio = Math.abs(dy) / Math.abs(dx || 1);
        const widthFactor = 1 + twistRatio ** 2 / 4;
        const midHalfWidth = halfWidth * widthFactor;

        // Horizontal link: control points vary in X direction.
        // The thickness is constant in the Y direction.
        controlX1 = startX + dx * 0.5;
        controlY1 = startY;
        controlX2 = startX + dx * 0.5;
        controlY2 = endY;

        // Path goes forward along the top edge, then backward along the bottom edge.
        pathData = `M ${startX} ${startY - halfWidth}
                    C ${controlX1} ${controlY1 - midHalfWidth}, ${controlX2} ${controlY2 - midHalfWidth}, ${endX} ${endY - halfWidth}
                    L ${endX} ${endY + halfWidth}
                    C ${controlX2} ${controlY2 + midHalfWidth}, ${controlX1} ${controlY1 + midHalfWidth}, ${startX} ${startY + halfWidth}
                    Z`;
      } else {
        // Adjust the middle width based on X-axis displacement
        const twistRatio = Math.abs(dx) / Math.abs(dy || 1);
        const widthFactor = 1 + twistRatio ** 2 / 4;
        const midHalfWidth = halfWidth * widthFactor;

        // Defaulting to "vertical"
        // Vertical link: control points vary in Y direction.
        // The thickness is constant in the X direction.
        controlY1 = startY + dy * 0.4;
        controlX1 = startX;
        controlY2 = startY + dy * 0.6;
        controlX2 = endX;

        // Path goes forward along the left edge, then backward along the right edge.
        pathData = `M ${startX - halfWidth} ${startY}
                    C ${controlX1 - midHalfWidth} ${controlY1}, ${controlX2 - midHalfWidth} ${controlY2}, ${endX - halfWidth} ${endY}
                    L ${endX + halfWidth} ${endY}
                    C ${controlX2 + midHalfWidth} ${controlY2}, ${controlX1 + midHalfWidth} ${controlY1}, ${startX + halfWidth} ${startY}
                    Z`;
      }

      g.append("path")
        .attr("d", pathData)
        .attr("fill", color) // Use fill instead of stroke
        .attr("stroke", "none")
        .attr("opacity", opacity); // Apply opacity to the whole shape
    }
  }

  // Draw a small circle at the start and end points
  // These markers are now drawn on top of the filled path ends.
  if (mark) {
    g.append("circle")
      .attr("cx", startX)
      .attr("cy", startY)
      .attr("r", strokeWidth * 1.5)
      .attr("fill", color)
      .attr("stroke", "none");
    g.append("circle")
      .attr("cx", endX)
      .attr("cy", endY)
      .attr("r", strokeWidth * 1.5)
      .attr("fill", color)
      .attr("stroke", "none");
  }
}

/**
 * Creates a single line path element in a D3 selection.
 *
 * @param {*} g - The D3 selection to append the line to.
 * @param {*} data - The data points for the line.
 * @param {*} xScale - The x scale function.
 * @param {*} yScale - The y scale function.
 * @param {*} color - The color of the line.
 * @param {*} opacity - The opacity of the line.
 * @param {*} orientation - The orientation of the chart. Choices: ["horizontal", "vertical"].
 * @param {*} direction - The direction of the axis. Choices: ["default", "inverse"].
 * @param {*} options - Additional options.
 */
export function createLinePath(
  g,
  data,
  xScale,
  yScale,
  color,
  opacity,
  orientation,
  direction,
  options = {},
) {
  // TODO: lineStyle is not currently passed to createLinePath(); needs to be fixed

  // parse additional options
  const {
    lineWidth = 2.3,
    lineType = "linear",
    showMinMax = true,
    showPoints = true,
    showAvgLine = true,
    showLegend = false,
    // Values: "circle" | "square" | "triangle" | "diamond" or a function (d, i) => shape
    pointShape = "circle",
    sampleLineData = false,
    showShadow = true,
    useGapIndicators = true,
  } = options || {};
  const style = options?.style ?? options?.variation ?? "default";
  const sampledContinuous = sampleLineData === true;

  let curve;
  switch (lineType) {
    case "linear":
      curve = d3.curveLinear;
      break;
    case "step":
      curve = d3.curveStep;
      break;
    case "cardinal":
      curve = d3.curveCardinal;
      break;
    default:
      curve = d3.curveLinear;
  }

  const r = lineWidth * 1.5;

  // Create the line generator
  const line = d3
    .line()
    .x((d) => xScale(d.x))
    .y((d) => yScale(d.y))
    .curve(curve);
  if (!sampledContinuous) {
    line.defined((d) => !d.cancelled);
  }

  const visibleData = sampledContinuous
    ? data
    : data.filter((d) => !d.cancelled);

  if (showShadow) {
    const shadowData = !useGapIndicators ? visibleData : data;
    const areaGenerator = d3.area().curve(curve);
    if (!sampledContinuous && useGapIndicators) {
      areaGenerator.defined((d) => !d.cancelled);
    }

    if (orientation === "vertical") {
      const y0 = yScale.range()[0];
      areaGenerator
        .x((d) => xScale(d.x))
        .y1((d) => yScale(d.y))
        .y0(y0);
    } else {
      const x0 = xScale.range()[0];
      areaGenerator
        .y((d) => yScale(d.y))
        .x1((d) => xScale(d.x))
        .x0(x0);
    }

    g.append("path")
      .datum(shadowData)
      .attr("class", "line-shadow")
      .attr("fill", color)
      .attr("fill-opacity", 0.2) // Light shadow
      .attr("d", areaGenerator)
      .style("pointer-events", "none"); // Don't interfere with interactions
  }

  if (!useGapIndicators) {
    g.append("path")
      .datum(visibleData)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", lineWidth)
      .attr("stroke-opacity", opacity)
      .attr("d", line);
  } else if (style === "sketch") {
    // Generate the line path first
    const pathData = line(data);

    // Use rough.js to draw the path with sketchy style
    const roughSvg = rough.svg(g.node().ownerSVGElement);
    const roughPath = roughSvg.path(pathData, {
      stroke: color,
      strokeWidth: lineWidth,
      roughness: 1.5,
      bowing: 1.5,
      fill: "none",
    });
    g.node().appendChild(roughPath);

    // Set opacity manually since rough.js doesn't handle it
    roughPath.style.opacity = opacity;
  } else {
    // Non-sketch style: draw segment-by-segment based on adjacent points, and use cancelled to decide solid/dashed

    // Base style
    let baseDash = null;
    if (style === "dotted") baseDash = "2,4";
    else if (style === "dashed") baseDash = "8,4";

    if (sampleLineData || data.length < 2) {
      // Fallback: after sampling, connect retained points with a solid line
      const p = g
        .append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", lineWidth)
        .attr("stroke-opacity", opacity)
        .attr("d", line);
    } else {
      // 2) Draw in segments:
      // a. Only connect two non-cancelled points
      // b. If a non-cancelled point is adjacent to a cancelled one, draw a drop line to 0
      // c. Draw dashed baseline segments

      // a. Draw line segments
      for (let i = 0; i < data.length - 1; i++) {
        if (!data[i].cancelled && !data[i + 1].cancelled) {
          const seg = [data[i], data[i + 1]];
          const segPath = g
            .append("path")
            .datum(seg)
            .attr("fill", "none")
            .attr("stroke", color)
            .attr("stroke-width", lineWidth)
            .attr("stroke-opacity", opacity)
            .attr("d", line);

          if (baseDash) segPath.attr("stroke-dasharray", baseDash);
        }
      }

      // b. Draw drop lines
      const dropLinePoints = new Set();
      for (let i = 0; i < data.length; i++) {
        if (data[i].cancelled) continue;

        const leftCancelled = i > 0 && data[i - 1].cancelled;
        const rightCancelled = i < data.length - 1 && data[i + 1].cancelled;

        if (leftCancelled || rightCancelled) {
          dropLinePoints.add(data[i]);
        }
      }

      dropLinePoints.forEach((d) => {
        const cx = xScale(d.x);
        const cy = yScale(d.y);
        let x0, y0;

        if (orientation === "vertical") {
          x0 = cx;
          y0 = yScale(0);
        } else {
          x0 = xScale(0);
          y0 = cy;
        }

        g.append("line")
          .attr("x1", cx)
          .attr("y1", cy)
          .attr("x2", x0)
          .attr("y2", y0)
          .attr("stroke", color)
          .attr("stroke-width", lineWidth)
          .attr("stroke-opacity", opacity)
          .attr("stroke-dasharray", "4,4");
      });

      // c. Draw dashed baseline segments
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i].cancelled || data[i + 1].cancelled) {
          const d1 = data[i];
          const d2 = data[i + 1];

          let x1, y1, x2, y2;
          if (orientation === "vertical") {
            x1 = xScale(d1.x);
            y1 = yScale(0);
            x2 = xScale(d2.x);
            y2 = yScale(0);
          } else {
            x1 = xScale(0);
            y1 = yScale(d1.y);
            x2 = xScale(0);
            y2 = yScale(d2.y);
          }

          g.append("line")
            .attr("x1", x1)
            .attr("y1", y1)
            .attr("x2", x2)
            .attr("y2", y2)
            .attr("stroke", color)
            .attr("stroke-width", lineWidth)
            .attr("stroke-opacity", opacity)
            .attr("stroke-dasharray", "4,4");
        }
      }
    }
  }

  if (showPoints) {
    const symbolSize = Math.PI * r * r; // Area scale consistent with scatter
    data.forEach((d, i) => {
      if (!sampledContinuous && d.cancelled) return;
      const cx = xScale(d.x);
      const cy = yScale(d.y);
      const shape =
        typeof pointShape === "function" ? pointShape(d, i, data) : pointShape;

      let pointElement;
      switch (shape) {
        case "square": {
          pointElement = g
            .append("rect")
            .attr("x", cx - r)
            .attr("y", cy - r)
            .attr("width", 2 * r)
            .attr("height", 2 * r)
            .attr("fill", color)
            .attr("fill-opacity", 1.0)
            .attr("stroke", "white")
            .attr("stroke-width", 0.1);
          break;
        }
        case "triangle": {
          const symbol = d3.symbol().type(d3.symbolTriangle).size(symbolSize)();
          pointElement = g
            .append("path")
            .attr("d", symbol)
            .attr("transform", `translate(${cx}, ${cy})`)
            .attr("fill", color)
            .attr("fill-opacity", 0.9)
            .attr("stroke", "white")
            .attr("stroke-width", 0.1);
          break;
        }
        case "diamond": {
          const symbol = d3.symbol().type(d3.symbolDiamond).size(symbolSize)();
          pointElement = g
            .append("path")
            .attr("d", symbol)
            .attr("transform", `translate(${cx}, ${cy})`)
            .attr("fill", color)
            .attr("fill-opacity", 0.9)
            .attr("stroke", "white")
            .attr("stroke-width", 0.1);
          break;
        }
        case "circle":
        default: {
          pointElement = g
            .append("circle")
            .attr("cx", cx)
            .attr("cy", cy)
            .attr("r", r)
            .attr("fill", color)
            .attr("fill-opacity", 0.9)
            .attr("stroke", "white")
            .attr("stroke-width", 0.1);
        }
      }

      if (pointElement) {
        pointElement
          .on("mouseover", function (event) {
            // Enlarge the point on hover
            d3.select(this).attr("transform", (d) => {
              if (shape === "triangle" || shape === "diamond") {
                return `translate(${cx}, ${cy}) scale(1.5)`;
              }
              return `translate(${cx}, ${cy}) scale(1.5) translate(${-cx}, ${-cy})`;
            });

            const textContent = d.label
              ? `X: ${d.x}, Y: ${d.y}, ${d.label}`
              : `X: ${d.x}, Y: ${d.y}`;
            showTooltip(g, cx, cy - r - 12, {
              text: textContent,
              stroke: color,
            });
          })
          .on("mouseout", function (event) {
            // Restore original size
            d3.select(this).attr("transform", (d) => {
              if (shape === "triangle" || shape === "diamond") {
                return `translate(${cx}, ${cy}) scale(1)`;
              }
              return "scale(1)";
            });
            removeTooltip(g);
          });
      }
    });
  }

  if (showMinMax) {
    let minPoints = [],
      maxPoints = [];
    const mul = (lineWidth * Math.sqrt(2)) / 2.8;
    const minPointOffset = {
      vertical: { x: -8 * mul, y: 13 * mul },
      horizontal: { x: -12 * mul, y: 8 * mul },
    };
    const maxPointOffset = {
      vertical: { x: 8 * mul, y: -12 * mul },
      horizontal: { x: 12 * mul, y: 8 * mul },
    };
    let dir = direction === "default" ? 1 : -1;
    let textAlign = { min: "middle", max: "middle" };
    if (orientation === "horizontal") {
      textAlign =
        direction === "default"
          ? { min: "end", max: "start" }
          : { min: "start", max: "end" };
    }

    if (orientation === "vertical") {
      const validData = sampledContinuous
        ? data
        : data.filter((d) => !d.cancelled);
      if (validData.length === 0) return;
      const minY = Math.min(...validData.map((d) => d.y));
      const maxY = Math.max(...validData.map((d) => d.y));
      minPoints = validData.filter((d) => d.y === minY);
      maxPoints = validData.filter((d) => d.y === maxY);
    } else if (orientation === "horizontal") {
      const validData = sampledContinuous
        ? data
        : data.filter((d) => !d.cancelled);
      if (validData.length === 0) return;
      const minX = Math.min(...validData.map((d) => d.x));
      const maxX = Math.max(...validData.map((d) => d.x));
      minPoints = validData.filter((d) => d.x === minX);
      maxPoints = validData.filter((d) => d.x === maxX);
    }

    // decide whether to show min/max points based on their counts
    const shouldShowMinPoints = true;
    const shouldShowMaxPoints = true;

    if (!shouldShowMinPoints && !shouldShowMaxPoints) {
      return;
    }

    // filter points
    const pointsToShow = [];
    if (shouldShowMinPoints) {
      if (minPoints.length >= 2) {
        pointsToShow.push(minPoints[0], minPoints[minPoints.length - 1]);
      } else {
        pointsToShow.push(...minPoints);
      }
    }
    if (shouldShowMaxPoints) {
      pointsToShow.push(...maxPoints);
    }

    const minText = (d) => {
      if (showLegend) return "Min";
      else return format(orientation === "vertical" ? d.y : d.x);
    };
    const maxText = (d) => {
      if (showLegend) return "Max";
      else return format(orientation === "vertical" ? d.y : d.x);
    };

    if (showLegend) {
      // for legend, only one min / max value
      if (shouldShowMinPoints) {
        minPoints = minPoints.slice(0, 1);
      } else {
        minPoints = [];
      }
      if (shouldShowMaxPoints) {
        maxPoints = maxPoints.slice(0, 1);
      } else {
        maxPoints = [];
      }
    }

    pointsToShow.forEach((d) => {
      g.append("circle")
        .attr("cx", xScale(d.x))
        .attr("cy", yScale(d.y))
        .attr("r", lineWidth * 2.5)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", lineWidth);
    });

    // show values for min/max points (for legend only)
    // if (showLegend) {
    minPoints = minPoints.slice(-1); // hack: only show the last min value
    minPoints.forEach((d) => {
      const txt = minText(d);
      if (txt.length <= 5) {
        // if too long: skip showing value
        g.append("text")
          .attr("class", "line-value")
          .attr("x", xScale(d.x) + dir * minPointOffset[orientation].x)
          .attr("y", yScale(d.y) + dir * minPointOffset[orientation].y)
          .attr("text-anchor", textAlign.min)
          .text(txt);
      }
    });
    maxPoints = maxPoints.slice(-1); // hack: only show the last max value
    maxPoints.forEach((d) => {
      const txt = maxText(d);
      if (txt.length <= 6) {
        g.append("text")
          .attr("class", "line-value")
          .attr("x", xScale(d.x) + dir * maxPointOffset[orientation].x)
          .attr("y", yScale(d.y) + dir * maxPointOffset[orientation].y)
          .attr("text-anchor", textAlign.max)
          .text(txt);
      }
    });
    // }

    g.selectAll(".line-value")
      .attr("fill", color)
      .attr("dominant-baseline", "middle")
      .attr("font-weight", showLegend ? "normal" : "bold");

    g.selectAll(".line-value").each(function () {
      globalSettings.setFont(d3.select(this), showLegend ? "legend" : "value");
    });
  }

  if (showAvgLine) {
    // only compute average based on non-zero values
    const avgValue =
      orientation === "vertical"
        ? d3.mean(
            data.filter((d) => d.y !== 0),
            (d) => d.y,
          )
        : d3.mean(
            data.filter((d) => d.x !== 0),
            (d) => d.x,
          );
    let x1, y1, x2, y2;
    if (orientation === "vertical") {
      const domain = xScale.domain();
      x1 = xScale(domain[0]);
      y1 = yScale(avgValue);
      x2 = xScale(domain[domain.length - 1]);
      y2 = yScale(avgValue);
    } else if (orientation === "horizontal") {
      const domain = yScale.domain();
      x1 = xScale(avgValue);
      y1 = yScale(domain[0]);
      x2 = xScale(avgValue);
      y2 = yScale(domain[domain.length - 1]);
    }
    g.append("line")
      .attr("x1", x1)
      .attr("y1", y1)
      .attr("x2", x2)
      .attr("y2", y2)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", lineWidth * 0.35)
      .attr("stroke-opacity", opacity);

    if (showLegend) {
      const [textX, textY] =
        orientation === "vertical"
          ? [x2 + 3, (y1 + y2) / 2]
          : [(x1 + x2) / 2, y1 - 7];
      const textAnchor = orientation === "vertical" ? "start" : "middle";
      const textGroup = g
        .append("text")
        .attr("class", "avg-line-text")
        .attr("x", textX)
        .attr("y", textY)
        .attr("text-anchor", textAnchor)
        .attr("dominant-baseline", "middle")
        .attr("fill", color)
        .text("Avg");
      globalSettings.setFont(textGroup, "legend");
    }
  }
}

/**
 * Creates a single radial line path element in a D3 selection.
 *
 * @param {*} g - The D3 selection to append the line to.
 * @param {*} data - The data points for the line.
 * @param {*} angleScale - The angle scale function.
 * @param {*} radiusScale - The radius scale function.
 * @param {*} color - The color of the line.
 * @param {*} style - The style of the line. Choices: ["default", "sketch", "dotted", "dashed"].
 * @param {*} lineWidth - The width of the line.
 * @param {*} lineType - The type of line curve. Choices: ["linear", "step", "cardinal"].
 * @param {*} opacity - The opacity of the line.
 */
export function createRadialLinePath(
  g,
  data,
  angleScale,
  radiusScale,
  color,
  style = "default",
  lineWidth = 2.3,
  lineType = "linear",
  opacity = 1,
  options = {},
) {
  // parse additional options
  const {
    showPoints = true,
    showMinMax = true,
    showAvgLine = false, // Radial charts do not support average line
    // Same as Cartesian coordinates: support point shapes
    pointShape = "circle",
    showShadow = true,
    showAreaFill = false,
    areaFillOpacity = 0.2,
  } = options || {};
  style = options?.style ?? options?.variation ?? style;

  // Preserve the truly original data and the original angle scale (before any processing)
  const trulyOriginalData = [...data];
  const trulyOriginalAngleScale = angleScale.copy
    ? angleScale.copy()
    : angleScale;
  function _fillMissingValue(data, angleScale) {
    // 1. Get the full year domain
    const fullDomain = angleScale.domain();

    // If the domain is not year-like data, return the original data
    if (!/^\d{4}$/.test(fullDomain[0])) {
      return data;
    }

    // 2. For fast lookup, convert the original data into a Map keyed by year 'x'
    const dataMap = new Map(data.map((d) => [d.x, d]));

    const filledData = [];

    // 3. Iterate over the full year domain
    for (let i = 0; i < fullDomain.length; i++) {
      const year = fullDomain[i];

      // 4. Check whether data exists for the current year
      if (dataMap.has(year)) {
        // If it exists, push the original data point into the new array
        filledData.push(dataMap.get(year));
      } else {
        // If data is missing, run interpolation logic

        // a. Find the interpolation "start point" (scan backward for the nearest valid data point)
        let startPoint = null;
        for (let j = i - 1; j >= 0; j--) {
          if (dataMap.has(fullDomain[j])) {
            startPoint = dataMap.get(fullDomain[j]);
            break;
          }
        }

        // b. Find the interpolation "end point" (scan forward for the nearest valid data point)
        let endPoint = null;
        for (let j = i + 1; j < fullDomain.length; j++) {
          if (dataMap.has(fullDomain[j])) {
            endPoint = dataMap.get(fullDomain[j]);
            break;
          }
        }

        // c. Interpolate only when both startPoint and endPoint exist
        if (startPoint && endPoint) {
          // Convert year strings to numbers for computation
          const startYear = parseInt(startPoint.x, 10);
          const endYear = parseInt(endPoint.x, 10);
          const currentYear = parseInt(year, 10);

          // Compute where the current year lies between start/end years (t)
          const t = (currentYear - startYear) / (endYear - startYear);

          // Linear interpolation: y = y1 * (1 - t) + y2 * t
          const interpolatedY = startPoint.y * (1 - t) + endPoint.y * t;

          // Create and push the new data point
          filledData.push({
            x: year,
            y: interpolatedY,
          });
        }
        // If endPoint is missing (e.g., the last few years are missing), skip these points.
        // If startPoint is missing (e.g., the first few years are missing), interpolation is impossible; skip as well.
      }
    }

    return filledData;
  }

  function _densify(data, angleScale, numInterpolate = 5) {
    // If angleScale's domain is not string-based (i.e., not categorical), or there are fewer than 2 points, no need to densify
    if (typeof angleScale.domain()[0] !== "string" || data.length < 2) {
      return [angleScale, data];
    }

    const originalDomain = angleScale.domain();
    const densifiedData = [];

    // Fill missing values first

    for (let i = 0; i < data.length - 1; i++) {
      const p1 = data[i];
      const p2 = data[i + 1];

      const startAngleIdx = i;
      const endAngleIdx = i + 1;

      const startValue = p1.y;
      const endValue = p2.y;

      // First, add the original point p1 to the result array
      densifiedData.push({
        x: startAngleIdx,
        y: startValue,
      });

      // 2. Interpolate between p1 and p2
      for (let j = 1; j <= numInterpolate; j++) {
        const t = j / (numInterpolate + 1);

        const interpolatedAngle = startAngleIdx * (1 - t) + endAngleIdx * t;
        const interpolatedRadius = startValue * (1 - t) + endValue * t;

        densifiedData.push({
          x: interpolatedAngle,
          y: interpolatedRadius,
        });
      }
    }

    const lastPoint = data[data.length - 1];
    densifiedData.push({
      x: data.length - 1, // Angle index of the last point
      y: lastPoint.y,
    });

    const newAngleScale = d3
      .scaleLinear()
      .domain([0, originalDomain.length - 1])
      .range(angleScale.range());

    return [newAngleScale, densifiedData];
  }

  let curve;
  switch (lineType) {
    case "linear":
      curve = d3.curveLinear;
      break;
    case "step":
      curve = d3.curveStep;
      break;
    case "cardinal":
      curve = d3.curveCardinal;
      break;
    default:
      curve = d3.curveLinear;
  }

  data = _fillMissingValue(data, angleScale);
  [angleScale, data] = _densify(data, angleScale);
  // Create the radial line generator
  const radialLine = d3
    .lineRadial()
    .angle((d) => angleScale(d.x))
    .radius((d) => radiusScale(d.y))
    .curve(curve);

  if (showAreaFill) {
    const areaGenerator = d3
      .areaRadial()
      .curve(curve)
      .angle((d) => angleScale(d.x))
      .outerRadius((d) => radiusScale(d.y))
      .innerRadius(radiusScale.range()[0]);

    g.append("path")
      .datum(data)
      .attr("class", "line-area-fill")
      .attr("fill", color)
      .attr("fill-opacity", areaFillOpacity)
      .attr("d", areaGenerator)
      .style("pointer-events", "none");
  }

  if (showShadow) {
    const areaGenerator = d3
      .areaRadial()
      .curve(curve)
      .angle((d) => angleScale(d.x))
      .outerRadius((d) => radiusScale(d.y))
      .innerRadius(radiusScale.range()[0]);

    g.append("path")
      .datum(data)
      .attr("class", "line-shadow")
      .attr("fill", color)
      .attr("fill-opacity", 0.2)
      .attr("d", areaGenerator)
      .style("pointer-events", "none");
  }

  if (style === "default") {
    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", lineWidth)
      .attr("stroke-opacity", opacity)
      .attr("d", radialLine);
  } else if (style === "sketch") {
    // Generate the radial line path first
    const pathData = radialLine(data);

    // Use rough.js to draw the path with sketchy style
    const roughSvg = rough.svg(g.node().ownerSVGElement);
    const roughPath = roughSvg.path(pathData, {
      stroke: color,
      strokeWidth: lineWidth,
      roughness: 1.5,
      bowing: 2,
      fill: "none",
    });
    g.node().appendChild(roughPath);

    // Set opacity manually since rough.js doesn't handle it
    roughPath.style.opacity = opacity;
  } else if (style === "dotted") {
    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", lineWidth)
      .attr("stroke-opacity", opacity)
      .attr("stroke-dasharray", "2,4")
      .attr("d", radialLine);
  } else if (style === "dashed") {
    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", lineWidth)
      .attr("stroke-opacity", opacity)
      .attr("stroke-dasharray", "8,4")
      .attr("d", radialLine);
  } else {
    // Default fallback
    g.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", lineWidth)
      .attr("stroke-opacity", opacity)
      .attr("d", radialLine);
  }

  // Add data points (only on truly original data points)
  let showPointSpace =
    trulyOriginalData.length * 12 <
    (trulyOriginalAngleScale.range()[1] - trulyOriginalAngleScale.range()[0]) *
      radiusScale.range()[0];
  if (showPoints) {
    const r = lineWidth * 1.5;
    const symbolSize = Math.PI * r * r;
    if (showPointSpace) {
      trulyOriginalData.forEach((d, i) => {
        const angle = trulyOriginalAngleScale(d.x);
        const radius = radiusScale(d.y);
        const x = radius * Math.sin(angle);
        const y = -radius * Math.cos(angle);

        const shape =
          typeof pointShape === "function"
            ? pointShape(d, i, trulyOriginalData)
            : pointShape;

        const cx = x;
        const cy = y;
        let pointElement = null;
        switch (shape) {
          case "square": {
            pointElement = g
              .append("rect")
              .attr("x", x - r)
              .attr("y", y - r)
              .attr("width", 2 * r)
              .attr("height", 2 * r)
              .attr("fill", color)
              .attr("stroke", "none");
            break;
          }
          case "triangle": {
            const symbol = d3
              .symbol()
              .type(d3.symbolTriangle)
              .size(symbolSize)();
            pointElement = g
              .append("path")
              .attr("d", symbol)
              .attr("transform", `translate(${x}, ${y})`)
              .attr("fill", color)
              .attr("stroke", "none");
            break;
          }
          case "diamond": {
            const symbol = d3
              .symbol()
              .type(d3.symbolDiamond)
              .size(symbolSize)();
            pointElement = g
              .append("path")
              .attr("d", symbol)
              .attr("transform", `translate(${x}, ${y})`)
              .attr("fill", color)
              .attr("stroke", "none");
            break;
          }
          case "circle":
          default: {
            pointElement = g
              .append("circle")
              .attr("cx", x)
              .attr("cy", y)
              .attr("r", r)
              .attr("fill", color)
              .attr("stroke", "none");
          }
        }

        if (pointElement) {
          pointElement
            .on("mouseover", function () {
              // Enlarge the point on hover
              d3.select(this).attr("transform", () => {
                if (shape === "triangle" || shape === "diamond") {
                  return `translate(${cx}, ${cy}) scale(1.5)`;
                }
                return `translate(${cx}, ${cy}) scale(1.5) translate(${-cx}, ${-cy})`;
              });

              const textContent = d.label
                ? `X: ${d.x}, Y: ${d.y}, ${d.label}`
                : `X: ${d.x}, Y: ${d.y}`;
              showTooltip(g, cx, cy - r - 12, {
                text: textContent,
                stroke: color,
              });
            })
            .on("mouseout", function () {
              // Restore original size
              d3.select(this).attr("transform", () => {
                if (shape === "triangle" || shape === "diamond") {
                  return `translate(${cx}, ${cy}) scale(1)`;
                }
                return "scale(1)";
              });
              removeTooltip(g);
            });
        }
      });
    }
  }

  // Add min/max markers (based on truly original data)
  if (showMinMax && trulyOriginalData.length > 0 && showPointSpace) {
    const minY = Math.min(...trulyOriginalData.map((d) => d.y));
    const maxY = Math.max(...trulyOriginalData.map((d) => d.y));
    const minPoints = trulyOriginalData.filter((d) => d.y === minY);
    const maxPoints = trulyOriginalData.filter((d) => d.y === maxY);

    // Decide whether to show min/max markers based on point count
    const shouldShowMinPoints = minPoints.length < 4;
    const shouldShowMaxPoints = maxPoints.length < 4;

    // If neither min nor max should be shown, return early
    if (!shouldShowMinPoints && !shouldShowMaxPoints) {
      return;
    }

    // Filter the points to show based on conditions
    const pointsToShow = [];
    if (shouldShowMinPoints) {
      pointsToShow.push(...minPoints);
    }
    if (shouldShowMaxPoints) {
      pointsToShow.push(...maxPoints);
    }

    pointsToShow.forEach((d) => {
      const angle = trulyOriginalAngleScale(d.x);
      const radius = radiusScale(d.y);
      const x = radius * Math.sin(angle);
      const y = -radius * Math.cos(angle);

      g.append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", lineWidth * 2.5)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", lineWidth);
    });

    // Add text labels for min/max points
    pointsToShow.forEach((d) => {
      const angle = trulyOriginalAngleScale(d.x);
      const radius = radiusScale(d.y);
      const x = radius * Math.sin(angle);
      const y = -radius * Math.cos(angle);

      // Compute label position (slightly offset outward)
      const labelRadius = radius + 15;
      const labelX = labelRadius * Math.sin(angle);
      const labelY = -labelRadius * Math.cos(angle);

      const txt = format(d.y);
      if (txt.length <= 5) {
        g.append("text")
          .attr("class", "radial-line-value")
          .attr("x", labelX)
          .attr("y", labelY)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("fill", color)
          .text(txt);
      }
    });
  }
}

/**
 * Creates a sector element in a D3 selection.
 *
 * @param {*} g - The D3 selection to append the sector to.
 * @param {number} innerRadius - The inner radius of the sector.
 * @param {number} outerRadius - The outer radius of the sector.
 * @param {number} startAngle - The start angle of the sector in radians.
 * @param {number} endAngle - The end angle of the sector in radians.
 * @param {string} color - The color of the sector.
 * @param {string} style - The style of the sector. Choices: ["default", "sketch"]
 */
export function createSector(
  g,
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  color,
  style = "default",
) {
  // Use D3's arc generator to create the sector path
  const arcGenerator = d3
    .arc()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius)
    .startAngle(startAngle)
    .endAngle(endAngle);

  if (style === "sketch") {
    // For sketch style, generate the SVG path data string first
    const pathData = arcGenerator();
    const roughSvg = rough.svg(g.node().ownerSVGElement);
    // Then use rough.js to draw a hand-drawn style path
    const roughSector = roughSvg.path(pathData, {
      fill: color,
      stroke: color,
      hachureAngle: 60, // Angle of hachure lines
      hachureGap: 4, // Gap between hachure lines
      roughness: 1, // Line roughness
      strokeWidth: 2, // Stroke width
    });
    g.node().appendChild(roughSector);
  } else {
    // Default style and other fallback cases
    g.append("path")
      .attr("d", arcGenerator())
      .attr("fill", color)
      .attr("stroke", globalSettings.textColorLight)
      .attr("stroke-width", 2);
  }
}
