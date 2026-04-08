// This file contains utility functions for adjusting the layout of the nodes.

import { extractChartType, extractOperation } from "./node.js";
import { setBoundingBoxForTree, updatePolarConfig } from "./geometry.js";
import { globalSettings } from "../core/global.js";
import { iconMaps } from "./iconMap.js";

/**
 * Compute the effective width of a string: count CJK characters as 2 and other characters as 1.
 * @param {string} str - The string to measure.
 * @returns {number} - The effective string width.
 */
function getStringWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    // Check whether the character is a CJK character (Unicode range: 0x4e00-0x9fff).
    const charCode = str.charCodeAt(i);
    if (charCode >= 0x4e00 && charCode <= 0x9fff)
      width += 2; // CJK characters count as width 2
    else width += 1; // Other characters count as width 1
  }
  return width;
}

export function approxAxisMargin(
  node,
  axisType,
  linkAxis = false,
  label = false,
) {
  // approximate axis margin accroding to axis display and tick length
  let axisData;
  const isPolar = node.coordinate_system === "polar";
  const defaultCharNum = 3;
  const charWidth = globalSettings.valueCharWidth;
  let unionCharWidth = globalSettings.valueCharWidth;
  const defaultMargin = 25 * globalSettings.fontRatio;
  const axisNameWidth = 15 * globalSettings.fontRatio;
  const unionName = node.chart?.unionData?.name;
  const hasUnionIcons =
    axisType === "union" &&
    !!unionName &&
    (!!node.chart?.config?.options?.icons?.[unionName] ||
      !!iconMaps[unionName]);
  const unionFontType =
    axisType === "union" &&
    !!unionName &&
    globalSettings.palette.getColorMap(unionName)[1] !== "base"
      ? "label"
      : "value";
  const unionIconMargin = hasUnionIcons
    ? globalSettings.getFontSize(unionFontType) * 1.5 + 5
    : 0;

  // If the union axis corresponds to a color encoding, use the h3 font.
  if (
    axisType === "union" &&
    globalSettings.palette.getColorMap(node.chart.unionData.name)[1] !== "base"
  ) {
    unionCharWidth = globalSettings.labelCharWidth;
  }

  if (!isPolar) {
    if (axisType === "x") {
      if (linkAxis) {
        axisData = node.chart.X.data[0];
        if (label) axisData = node.label;
        const totalTickLength = axisData.reduce(
          (acc, cur) => acc + getStringWidth(cur.toString()),
          0,
        );
        const maxTickLength = Math.max(
          ...axisData.map((d) => getStringWidth(d.toString())),
        );
        if (totalTickLength * charWidth <= node.chart.config.width) {
          return defaultMargin;
        } else {
          return Math.max(
            maxTickLength * charWidth + axisNameWidth,
            defaultMargin,
          );
        }
      } else {
        const [orientation, aggregation, basicType] = extractChartType(
          node.chart_type,
        );
        if (orientation === "v" && basicType === "bar") {
          axisData = node.chart.X.data[0];
          let maxTickLength = Math.max(
            ...axisData.map((d) => getStringWidth(d.toString())),
          );
          let totalTickLength = axisData.reduce(
            (acc, cur) => acc + getStringWidth(cur.toString()),
            0,
          );
          if (node.chart.config.width < totalTickLength * charWidth) {
            // If all ticks cannot fit horizontally, rotate them vertically.
            return Math.max(maxTickLength * 10 + 10, defaultMargin);
          } else {
            return defaultMargin;
          }
        } else {
          return defaultMargin;
        }
      }
    } else if (axisType === "y") {
      const orientation = extractChartType(node.chart_type)[0];
      if (orientation === "v") {
        if (node.chart.config.yMax > 1) {
          const maxTickLength = Math.max(
            getStringWidth(parseInt(node.chart.config.yMax).toString()) + 1,
          );
          return Math.max(
            maxTickLength * charWidth + axisNameWidth,
            defaultMargin,
          );
        } else {
          return Math.max(
            defaultCharNum * charWidth + axisNameWidth,
            defaultMargin,
          );
        }
      } else if (orientation === "h") {
        axisData = node.chart.X.data[0];
        if (label) axisData = node.label;
        if (typeof axisData[0] === "number") {
          if (node.chart.config.xMax > 1) {
            const maxTickLength = Math.max(
              getStringWidth(parseInt(node.chart.config.xMax).toString()),
            );
            return Math.max(
              maxTickLength * charWidth + axisNameWidth,
              defaultMargin,
            );
          } else {
            return defaultCharNum * charWidth + axisNameWidth;
          }
        } else if (typeof axisData[0] === "string") {
          const maxTickLength = Math.max(
            ...axisData.map((d) => getStringWidth(d.toString())),
          );
          return Math.max(
            maxTickLength * charWidth + axisNameWidth,
            defaultMargin,
          );
        }
      }
    } else if (axisType === "union") {
      const axis = node.chart.config.unionAxis;
      axisData = node.chart.unionData.data;
      if (axis.display === "top" || axis.display === "bottom") {
        return defaultMargin + unionIconMargin;
      } else if (axis.display === "left" || axis.display === "right") {
        const maxTickLength = Math.max(
          ...axisData.map((d) => d.toString().length),
        );
        return (
          Math.max(
            maxTickLength * unionCharWidth + axisNameWidth,
            defaultMargin,
          ) + unionIconMargin
        );
      }
    }
  } else {
    let axis;
    if (axisType === "x") {
      const orientation = extractChartType(node.chart_type)[0];
      if (orientation === "r") {
        axisData = node.chart.X.data[0];
        axis = node.chart.config.xAxis;
      } else if (orientation === "c") {
        axisData = node.chart.Y.data.flat();
        axis = node.chart.config.yAxis;
      }
    } else if (axisType === "y") {
      const orientation = extractChartType(node.chart_type)[0];
      if (orientation === "r") {
        axisData = node.chart.Y.data.flat();
        axis = node.chart.config.yAxis;
      } else if (orientation === "c") {
        axisData = node.chart.X.data[0];
        axis = node.chart.config.xAxis;
      }
    } else if (axisType === "union") {
      axisData = node.chart.unionData.data;
      axis = node.chart.config.unionAxis;
    }
    let maxTickLength = 0;
    if (typeof axisData[0] === "number") {
      let axisMax = Math.max(...axisData);
      if (axisMax > 10) {
        maxTickLength = Math.max(getStringWidth(parseInt(axisMax).toString()));
      } else {
        maxTickLength = defaultCharNum;
      }
    } else if (typeof axisData[0] === "string") {
      maxTickLength = Math.max(
        ...axisData.map((d) => getStringWidth(d.toString())),
      );
    }

    let _charWidth = unionCharWidth;
    if (axisType === "x") _charWidth = charWidth;

    if (
      axisType === "x" ||
      (axisType === "union" &&
        (axis.display === "top" || axis.display === "bottom"))
    ) {
      return (
        Math.max(maxTickLength * _charWidth + axisNameWidth, defaultMargin) +
        (axisType === "union" ? unionIconMargin : 0)
      );
    } else {
      return (
        Math.max(maxTickLength * _charWidth + axisNameWidth, defaultMargin) +
        (axisType === "union" ? unionIconMargin : 0)
      );
    }
  }
  return defaultMargin;
}

export function moveNormalxAxis(node, display, size, isPolar) {
  if (display.includes("_noname")) display = display.replace("_noname", "");

  const alignDirections = isPolar
    ? {
        top: "circular",
        bottom: "circular",
        left: "radial",
        right: "radial",
      }
    : {
        top: "horizontal",
        bottom: "horizontal",
        left: "vertical",
        right: "vertical",
      };
  moveNodes(node.neighbors[display], display, size, isPolar);
  if (
    node.parent &&
    extractOperation(node.parent.operation)[0] === "ALL_UNION"
  ) {
    if (node.parent.parent) {
      if (
        node.parent.chart.config.height ===
        Math.max(
          ...node.parent.parent.children.map(
            (child) => child.chart.config.height,
          ),
        )
      ) {
        alignNodes(node.parent, alignDirections[display]);
      }
    }
  }
}

export function moveNormalyAxis(node, display, size, isPolar) {
  if (display.includes("_noname")) {
    display = display.replace("_noname", "");
  }
  const alignDirections = isPolar
    ? {
        top: "circular",
        bottom: "circular",
        left: "radial",
        right: "radial",
      }
    : {
        top: "horizontal",
        bottom: "horizontal",
        left: "vertical",
        right: "vertical",
      };
  moveNodes(node.neighbors[display], display, size);

  // temporary fix for polar yaxisname
  if (node.coordinate_system === "polar") {
    if (display === "left" || display === "right") {
      if (
        node.parent &&
        extractOperation(node.parent.operation)[0] === "ALL_UNION"
      ) {
        moveNodes(node.parent.neighbors["top"], "top", 20, true);
      } else {
        moveNodes(node.neighbors["top"], "top", 20, true);
      }
    }
  }

  if (
    node.parent &&
    extractOperation(node.parent.operation)[0] === "ALL_UNION"
  ) {
    if (node.parent.parent) {
      if (
        node.parent.chart.config.width ===
        Math.max(
          ...node.parent.parent.children.map(
            (child) => child.chart.config.width,
          ),
        )
      ) {
        alignNodes(node.parent, alignDirections[display]);
      }
    }
  }
}

export function moveNodes(node, moveDirection, margin, polar = false) {
  if (!node) return;

  const oppositeDiretions = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
    inner: "outer",
  };
  const fromDirection = oppositeDiretions[moveDirection];

  let queue = [[node, fromDirection]];
  while (queue.length > 0) {
    const [node, fromDirection] = queue.shift();
    if (!node) {
      continue;
    }
    const adjustments = {
      left: {
        field: polar ? ["startAngle", "endAngle"] : ["left"],
        value: -margin,
      },
      right: {
        field: polar ? ["startAngle", "endAngle"] : ["left"],
        value: margin,
      },
      top: {
        field: polar ? ["innerRadius", "outerRadius"] : ["top"],
        value: polar ? margin : -margin,
      },
      bottom: {
        field: polar ? ["innerRadius", "outerRadius"] : ["top"],
        value: polar ? -margin : margin,
      },
    };

    const adjustment = adjustments[moveDirection];
    if (adjustment) {
      adjustment.field.forEach((field) => {
        node.chart.config[field] += adjustment.value;
      });
    }

    for (const direction in node.neighbors) {
      if (direction === "outer") continue;
      const oppositeDirection = oppositeDiretions[direction];
      if (direction === "inner") {
        queue.push([node.neighbors[direction][0], oppositeDirection]);
      } else {
        if (direction !== fromDirection) {
          queue.push([node.neighbors[direction], oppositeDirection]);
        }
      }
    }
  }
}

export function alignNodes(node, alignDirection) {
  if (alignDirection === "vertical") {
    const left = node.chart.config.left;
    const width = node.chart.config.width;
    let currentNode = node.neighbors["top"];
    while (currentNode) {
      const deltaLeft = currentNode.chart.config.left - left;
      const deltaRight =
        left +
        width -
        currentNode.chart.config.left -
        currentNode.chart.config.width;
      moveNodes(currentNode.neighbors["left"], "left", deltaLeft);
      moveNodes(currentNode.neighbors["right"], "right", deltaRight);
      setBoundingBoxForTree(
        currentNode,
        currentNode.chart.config.top,
        left,
        width,
        currentNode.chart.config.height,
      );
      currentNode = currentNode.neighbors["top"];
    }
    currentNode = node.neighbors["bottom"];
    while (currentNode) {
      const deltaLeft = currentNode.chart.config.left - left;
      const deltaRight =
        left +
        width -
        currentNode.chart.config.left -
        currentNode.chart.config.width;
      moveNodes(currentNode.neighbors["left"], "left", deltaLeft);
      moveNodes(currentNode.neighbors["right"], "right", deltaRight);
      setBoundingBoxForTree(
        currentNode,
        currentNode.chart.config.top,
        left,
        width,
        currentNode.chart.config.height,
      );
      currentNode = currentNode.neighbors["bottom"];
    }
  } else if (alignDirection === "horizontal") {
    const top = node.chart.config.top;
    const height = node.chart.config.height;
    let currentNode = node.neighbors["left"];
    while (currentNode) {
      const deltaTop = currentNode.chart.config.top - top;
      const deltaBottom =
        top +
        height -
        currentNode.chart.config.top -
        currentNode.chart.config.height;
      moveNodes(currentNode.neighbors["top"], "top", deltaTop);
      moveNodes(currentNode.neighbors["bottom"], "bottom", deltaBottom);
      setBoundingBoxForTree(
        currentNode,
        top,
        currentNode.chart.config.left,
        currentNode.chart.config.width,
        height,
      );
      currentNode = currentNode.neighbors["left"];
    }
    currentNode = node.neighbors["right"];
    while (currentNode) {
      const deltaTop = currentNode.chart.config.top - top;
      const deltaBottom =
        top +
        height -
        currentNode.chart.config.top -
        currentNode.chart.config.height;
      moveNodes(currentNode.neighbors["top"], "top", deltaTop);
      moveNodes(currentNode.neighbors["bottom"], "bottom", deltaBottom);
      setBoundingBoxForTree(
        currentNode,
        top,
        currentNode.chart.config.left,
        currentNode.chart.config.width,
        height,
      );
      currentNode = currentNode.neighbors["right"];
    }
  }
}

export function adjustCircularAxisForCircularUnionNode(node) {
  if (
    node.operation &&
    extractOperation(node.operation)[0] === "ALL_UNION" &&
    node.spatial_arrangement === "circular"
  ) {
    const startAngle = node.chart.config.startAngle;
    const endAngle = node.chart.config.endAngle;
    const margin =
      node.children[1].chart.config.startAngle -
      node.children[0].chart.config.endAngle;
    const angle =
      (endAngle - startAngle - margin * (node.children.length - 1)) /
      node.children.length;
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childConfig = child.chart.config;
      childConfig.startAngle = startAngle + angle * i + margin * i;
      childConfig.endAngle = startAngle + angle * (i + 1) + margin * i;
      updatePolarConfig(childConfig);
    }
  }
}
