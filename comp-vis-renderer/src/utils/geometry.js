// This file contains utility functions for the geometry of the nodes.

import { traverseAllNodes } from "./node.js";
import { mySum } from "./maths.js";

export function getOuterRadiusForPolar(basicCharts) {
  const maxRadius = Math.max(
    ...basicCharts.map((chart) => chart.config.outerRadius),
  );
  return maxRadius;
}

// given left, top, width, height for a Cartesian chart, update its centroid
export function updateCentroid(config) {
  config.cx = config.left + config.width / 2;
  config.cy = config.top + config.height / 2;
}

// given centroid and outer radius for a polar chart, update its config
export function updatePolarConfig(config) {
  config.top = config.cy - config.outerRadius;
  config.left = config.cx - config.outerRadius;
  config.height = config.outerRadius * 2;
  config.width = config.outerRadius * 2;
}

export function copyConfig(config1, config2) {
  config2.top = config1.top;
  config2.left = config1.left;
  config2.width = config1.width;
  config2.height = config1.height;
  config2.cx = config1.cx;
  config2.cy = config1.cy;
  config2.innerRadius = config1.innerRadius;
  config2.outerRadius = config1.outerRadius;
  config2.startAngle = config1.startAngle;
  config2.endAngle = config1.endAngle;
  if (config1.order) {
    config2.order = config1.order;
  }
}

/**
 * Set bounding box for the whole tree.
 * [arg1, arg2, arg3, arg4] stands for different meanings according to the coordinate system.
 * - for Cartesian coordinate system, the bounding box is determined by [top, left, width, height]
 * - for Polar coordinate system, the bounding box is determined by [innerRadius, outerRadius, startAngle, endAngle]
 */
export function setBoundingBoxForTree(node, arg1, arg2, arg3, arg4) {
  // console.log(`${node.id}, ${arg1}, ${arg2}, ${arg3}, ${arg4}`);
  const coordinateSystem = node.coordinate_system;

  if (coordinateSystem === "cartesian") {
    const config = node.chart.config;
    const oldTop = config.top;
    const oldLeft = config.left;
    const oldWidth = config.width;
    const oldHeight = config.height;

    if (!validateBoundingBox(node)) {
      setBoundingBox(node);
    }

    const scaleX = arg3 / oldWidth;
    const scaleY = arg4 / oldHeight;

    if (scaleX <= 0 || scaleY <= 0) {
      throw new Error("Invalid scale");
    }

    traverseAllNodes(node, (child) => {
      // transform
      const childConfig = child.chart.config;
      childConfig.top = arg1 + (childConfig.top - oldTop) * scaleY;
      childConfig.left = arg2 + (childConfig.left - oldLeft) * scaleX;

      // scale
      childConfig.width *= scaleX;
      childConfig.height *= scaleY;
      updateCentroid(childConfig);
    });
  } else if (coordinateSystem === "polar") {
    const config = node.chart.config;
    const oldR1 = config.innerRadius;
    const oldR2 = config.outerRadius;
    const oldArc1 = config.startAngle;
    const oldArc2 = config.endAngle;

    if (!validateBoundingBox(node)) {
      setBoundingBox(node);
    }

    const scaleArc = (arg4 - arg3) / (oldArc2 - oldArc1);
    const scaleR = (arg2 - arg1) / (oldR2 - oldR1);

    if (scaleArc <= 0 || scaleR <= 0) {
      throw new Error("Invalid scale");
    }

    traverseAllNodes(node, (child) => {
      const childConfig = child.chart.config;
      childConfig.innerRadius =
        arg1 + (childConfig.innerRadius - oldR1) * scaleR;
      childConfig.outerRadius =
        arg1 + (childConfig.outerRadius - oldR1) * scaleR;
      childConfig.startAngle =
        arg3 + (childConfig.startAngle - oldArc1) * scaleArc;
      childConfig.endAngle = arg3 + (childConfig.endAngle - oldArc1) * scaleArc;
      updatePolarConfig(childConfig);
    });
  } else {
    throw new Error(`Unsupported coordinate system: ${coordinateSystem}`);
  }
}

// in the following case will we call this function:
// the bbox of a composite node has been updated,
// but the bboxes of its children are not synchronized.
export function resetBoundingBox(node) {
  if (node.vis_type !== "composite") return;
  const { top, left, width, height } = node.chart.config; // copy the bbox
  setBoundingBox(node); // recover the parent bbox based on its children
  setBoundingBoxForTree(node, top, left, width, height); // transform
}

export function validateBoundingBox(node) {
  if (!node.chart || !node.chart.config) {
    return false;
  }
  if (node.coordinate_system === "cartesian") {
    if (
      node.chart.config.top < 0 ||
      node.chart.config.left < 0 ||
      node.chart.config.width < 0 ||
      node.chart.config.height < 0
    ) {
      return false;
    }
  } else if (node.coordinate_system === "polar") {
    if (
      node.chart.config.innerRadius < 0 ||
      node.chart.config.outerRadius < 0 ||
      node.chart.config.startAngle < 0 ||
      node.chart.config.endAngle < 0
    ) {
      return false;
    }
  } else {
    // invalid coordinate system
    return false;
  }
  return true;
}

export function setBoundingBox(node) {
  if (!node.children || node.children.length === 0) return;
  const coordinateSystem = node.coordinate_system;
  if (coordinateSystem === "cartesian") {
    let top = Number.MAX_VALUE;
    let left = Number.MAX_VALUE;
    let bottom = -Number.MAX_VALUE;
    let right = -Number.MAX_VALUE;

    node.children.forEach((child) => {
      setBoundingBox(child);
      const config = child.chart.config;
      top = Math.min(top, config.top);
      left = Math.min(left, config.left);
      bottom = Math.max(bottom, config.top + config.height);
      right = Math.max(right, config.left + config.width);
    });

    const config = node.chart.config;
    config.top = top;
    config.left = left;
    config.height = bottom - top;
    config.width = right - left;
    updateCentroid(config);
  } else if (coordinateSystem === "polar") {
    let innerRadius = Number.MAX_VALUE;
    let outerRadius = -Number.MAX_VALUE;
    let startAngle = Number.MAX_VALUE;
    let endAngle = -Number.MAX_VALUE;

    node.children.forEach((child) => {
      setBoundingBox(child);
      const config = child.chart.config;
      innerRadius = Math.min(innerRadius, config.innerRadius);
      outerRadius = Math.max(outerRadius, config.outerRadius);
      startAngle = Math.min(startAngle, config.startAngle);
      endAngle = Math.max(endAngle, config.endAngle);
    });

    const config = node.chart.config;
    config.innerRadius = innerRadius;
    config.outerRadius = outerRadius;
    config.startAngle = startAngle;
    config.endAngle = endAngle;

    // in polar case, assume that the center of all the children are the same
    config.cx = node.children[0].chart.config.cx;
    config.cy = node.children[0].chart.config.cy;
    updatePolarConfig(config);

    if (node.chart.config.startAngle >= node.chart.config.endAngle) {
      throw new Error("Invalid angle range");
    }
  }
}

// translate a node and all its children
export function translate(node, dx, dy) {
  traverseAllNodes(node, (child) => {
    const config = child.chart.config;
    if (!config.hasOwnProperty("cx") || !config.hasOwnProperty("cy")) {
      updateCentroid(config);
    }
    config.cx += dx; // update cx
    config.cy += dy; // update cy
    config.left += dx; // move left
    config.top += dy; // move top
  });
}

// for polar charts, given [left, top, width, height], calculate cx, cy, innerRadius(=0), outerRadius,
// cx, cy, and update left, top, width, height accordingly
export function setPolarBoundingBox(config) {
  const radius = Math.min(config.width, config.height) / 2;
  config.innerRadius = config.isDonut ? radius * 0.6 : 0;
  config.outerRadius = radius;
  config.cx = config.left + config.width / 2;
  config.cy = config.top + config.height / 2;
  config.left = config.cx - radius;
  config.top = config.cy - radius;
  config.width = radius * 2;
  config.height = radius * 2;
}

export function calculatePolarPositions(items, weights, display, options) {
  const { startAngle, endAngle, innerRadius, outerRadius, cx, cy } = options;
  const totalWeight = mySum(weights);

  const positionCalculators = {
    left: () => {
      const dx = Math.sin(startAngle);
      const dy = -Math.cos(startAngle);
      const radiusStep = (outerRadius - innerRadius) / totalWeight;
      return { dx, dy, radiusStep, useRadius: true };
    },
    right: () => {
      const dx = Math.sin(endAngle);
      const dy = -Math.cos(endAngle);
      const radiusStep = (outerRadius - innerRadius) / totalWeight;
      return { dx, dy, radiusStep, useRadius: true };
    },
    top: () => {
      const angleStep = (endAngle - startAngle) / totalWeight;
      return { angleStep, useAngle: true, radius: outerRadius };
    },
    bottom: () => {
      const angleStep = (endAngle - startAngle) / totalWeight;
      return { angleStep, useAngle: true, radius: outerRadius };
    },
  };

  const calculator = positionCalculators[display];
  if (!calculator) {
    throw new Error("Unsupported axis display: " + display);
  }

  const config = calculator();
  let accumulatedWeight = 0;

  return items.map((item, index) => {
    const weight = weights[index];
    let x, y;

    if (config.useRadius) {
      const radius =
        innerRadius + config.radiusStep * (accumulatedWeight + weight / 2);
      x = cx + config.dx * radius;
      y = cy + config.dy * radius;
    } else if (config.useAngle) {
      const angle =
        startAngle + config.angleStep * (accumulatedWeight + weight / 2);
      x = cx + Math.sin(angle) * config.radius;
      y = cy - Math.cos(angle) * config.radius;
    }

    accumulatedWeight += weight;
    return { x, y, item };
  });
}

export function calculateCartesianPositions(items, weights, display, options) {
  const { left, top, width, height } = options;
  const totalWeight = mySum(weights);

  const positionCalculators = {
    left: () => {
      const heightStep = height / totalWeight;
      return {
        step: heightStep,
        getPosition: (accWeight, weight) => ({
          x: left,
          y: top + heightStep * (accWeight + weight / 2),
        }),
      };
    },
    right: () => {
      const heightStep = height / totalWeight;
      return {
        step: heightStep,
        getPosition: (accWeight, weight) => ({
          x: left + width,
          y: top + heightStep * (accWeight + weight / 2),
        }),
      };
    },
    top: () => {
      const widthStep = width / totalWeight;
      return {
        step: widthStep,
        getPosition: (accWeight, weight) => ({
          x: left + widthStep * (accWeight + weight / 2),
          y: top,
        }),
      };
    },
    bottom: () => {
      const widthStep = width / totalWeight;
      return {
        step: widthStep,
        getPosition: (accWeight, weight) => ({
          x: left + widthStep * (accWeight + weight / 2),
          y: top + height,
        }),
      };
    },
  };

  const calculator = positionCalculators[display];
  if (!calculator) {
    throw new Error("Unsupported axis display: " + display);
  }

  const config = calculator();
  let accumulatedWeight = 0;

  return items.map((item, index) => {
    const weight = weights[index];
    const position = config.getPosition(accumulatedWeight, weight);
    accumulatedWeight += weight;
    return { ...position, label: item };
  });
}

/**
 * Compute the shortest distance from a rectangle to a point.
 * @param {Object} rect - Rectangle {left, top, width, height}
 * @param {Object} point - Point {x, y}
 * @returns {number} - Shortest distance
 */
export function calculateRectangleToPointDistance(rect, point) {
  const x1 = rect.left;
  const y1 = rect.top;
  const x2 = rect.left + rect.width;
  const y2 = rect.top + rect.height;

  const px = point.x;
  const py = point.y;

  // If the point is inside the rectangle, the distance is 0.
  if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
    return 0;
  }

  // Compute the shortest distance from the point to the rectangle.
  const dx = Math.max(0, Math.max(x1 - px, px - x2));
  const dy = Math.max(0, Math.max(y1 - py, py - y2));

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the minimum distance and overlap information between two rectangles.
 * @param {Object} rect1 - First rectangle {left, top, width, height}
 * @param {Object} rect2 - Second rectangle {left, top, width, height}
 * @returns {Object} - {distance, overlapX, overlapY, isOverlapping}
 */
export function calculateRectangleDistance(rect1, rect2) {
  const x1 = rect1.left;
  const y1 = rect1.top;
  const x2 = rect1.left + rect1.width;
  const y2 = rect1.top + rect1.height;

  const x3 = rect2.left;
  const y3 = rect2.top;
  const x4 = rect2.left + rect2.width;
  const y4 = rect2.top + rect2.height;

  // Compute centers.
  const centerX1 = (x1 + x2) / 2;
  const centerY1 = (y1 + y2) / 2;
  const centerX2 = (x3 + x4) / 2;
  const centerY2 = (y3 + y4) / 2;

  // Check overlap.
  const isOverlapping = !(x2 <= x3 || x4 <= x1 || y2 <= y3 || y4 <= y1);

  let overlapX = 0;
  let overlapY = 0;
  let distance = 0;

  if (isOverlapping) {
    // Compute overlap amount.
    overlapX = Math.min(x2, x4) - Math.max(x1, x3);
    overlapY = Math.min(y2, y4) - Math.max(y1, y3);
    distance = 0; // Distance is 0 when overlapping
  } else {
    // Compute distance between the nearest edges.
    const dx = Math.max(0, Math.max(x1 - x4, x3 - x2));
    const dy = Math.max(0, Math.max(y1 - y4, y3 - y2));
    distance = Math.sqrt(dx * dx + dy * dy);
  }

  return {
    distance,
    overlapX,
    overlapY,
    isOverlapping,
    centerDistance: Math.sqrt(
      (centerX2 - centerX1) ** 2 + (centerY2 - centerY1) ** 2,
    ),
    dx: centerX2 - centerX1,
    dy: centerY2 - centerY1,
  };
}

// align the center of source node with the center of target node vertically,
// and keep the source node above the target node if `distance` is specified.
export function alignCenterVertical(source, target, distance = null) {
  const sourceCfg = source.chart.config;
  const targetCfg = target.chart.config;

  [sourceCfg, targetCfg].forEach((cfg) => {
    if (!cfg.hasOwnProperty("cx") || !cfg.hasOwnProperty("cy")) {
      updateCentroid(cfg);
    }
  });

  const dx = targetCfg.cx - sourceCfg.cx;
  const dy =
    distance === null
      ? 0
      : targetCfg.top - distance - sourceCfg.height - sourceCfg.top;
  translate(source, dx, dy);
}

// align the center of source node with the center of target node horizontally,
// and keep the source node to the left of the target node if `distance` is specified.
export function alignCenterHorizontal(source, target, distance = null) {
  const sourceCfg = source.chart.config;
  const targetCfg = target.chart.config;

  [sourceCfg, targetCfg].forEach((cfg) => {
    if (!cfg.hasOwnProperty("cx") || !cfg.hasOwnProperty("cy")) {
      updateCentroid(cfg);
    }
  });

  const dx =
    distance === null
      ? 0
      : targetCfg.left - distance - sourceCfg.width - sourceCfg.left;
  const dy = targetCfg.cy - sourceCfg.cy;
  translate(source, dx, dy);
}

export function adjustUnionNodeBBox(unionNode) {
  const defaultAxisNameMargin = 10;
  const display = unionNode.chart.config.unionAxis.display;
  const isPolar = unionNode.coordinate_system === "polar";
  unionNode.chart.unionData.configs = [];
  for (const child of unionNode.children) {
    unionNode.chart.unionData.configs.push(child.chart.config);
  }

  const cfg = unionNode.chart.config;
  const firstChildConfig = unionNode.children[0].chart.config;
  const { xAxis, yAxis } = firstChildConfig;

  if (!isPolar) {
    const axis = ["top", "bottom"].includes(display) ? xAxis : yAxis;

    // Calculate the total margin to be applied
    let totalMargin = defaultAxisNameMargin;
    if (axis.display.includes(display)) {
      totalMargin += axis.size;
    }

    switch (display) {
      case "top":
        cfg.top -= totalMargin;
        cfg.height += totalMargin;
        break;
      case "bottom":
        cfg.height += totalMargin;
        break;
      case "left":
        cfg.left -= totalMargin;
        cfg.width += totalMargin;
        break;
      case "right":
        cfg.width += totalMargin;
        break;
    }
  } else {
    switch (display) {
      case "top":
        let topMargin = defaultAxisNameMargin * 2;
        if (xAxis.display.includes("top")) {
          topMargin += xAxis.size;
        }
        cfg.outerRadius += topMargin;
        break;
      case "bottom":
        let bottomMargin = defaultAxisNameMargin;
        if (xAxis.display.includes("bottom")) {
          bottomMargin += xAxis.size;
        }
        cfg.innerRadius -= bottomMargin;
        break;
      case "left":
      case "right":
        if (yAxis.display.includes(display)) {
          unionNode.chart.unionData.margin = yAxis.size + defaultAxisNameMargin;
        } else {
          unionNode.chart.unionData.margin = defaultAxisNameMargin;
        }
        break;
    }
  }
}

export function boundingBoxCheck(root, polar) {
  // adjust the bounding box for all nodes and ensure that
  // the parent node's bounding box contains all its children.
  traverseAllNodes(root, (node) => {
    if (!node.parent) return;
    const parentConfig = node.parent.chart.config;
    const childConfig = node.chart.config;

    if (polar) {
      parentConfig.outerRadius = Math.max(
        parentConfig.outerRadius,
        childConfig.outerRadius,
      );
      parentConfig.innerRadius = Math.min(
        parentConfig.innerRadius,
        childConfig.innerRadius,
      );
      parentConfig.startAngle = Math.min(
        parentConfig.startAngle,
        childConfig.startAngle,
      );
      parentConfig.endAngle = Math.max(
        parentConfig.endAngle,
        childConfig.endAngle,
      );
    } else {
      const parentRight = parentConfig.left + parentConfig.width;
      const parentBottom = parentConfig.top + parentConfig.height;
      const childRight = childConfig.left + childConfig.width;
      const childBottom = childConfig.top + childConfig.height;

      const newLeft = Math.min(parentConfig.left, childConfig.left);
      const newTop = Math.min(parentConfig.top, childConfig.top);
      const newRight = Math.max(parentRight, childRight);
      const newBottom = Math.max(parentBottom, childBottom);

      parentConfig.left = newLeft;
      parentConfig.top = newTop;
      parentConfig.width = newRight - newLeft;
      parentConfig.height = newBottom - newTop;
    }
  });
}

export function scaleChartSize(children, minL = 200, maxL = 400) {
  let minValue = Number.MAX_VALUE;
  let maxValue = Number.MIN_VALUE;

  // Find the minimum and maximum values.
  children.forEach((child) => {
    // Use the square root of the value for scaling so the area is proportional to the original value.
    const value = Math.sqrt(child.chart.config.valueField);
    if (value && value > 0) {
      if (value < minValue) {
        minValue = value;
      }
      if (value > maxValue) {
        maxValue = value;
      }
    }
  });

  // Helper: set size based on a new longest side L and the original aspect ratio.
  const setSizeByL = (child, newL) => {
    const config = child.chart.config;
    const aspectRatio = config.width / config.height;

    if (aspectRatio >= 1) {
      config.width = newL;
      config.height = newL / aspectRatio;
    } else {
      config.height = newL;
      config.width = newL * aspectRatio;
    }
  };

  // If all values are the same or invalid, use the default minimum size.
  if (
    minValue === Number.MAX_VALUE ||
    maxValue === Number.MIN_VALUE ||
    minValue === maxValue
  ) {
    children.forEach((child) => {
      setSizeByL(child, minL);
    });
    return;
  }

  // --- Choose a scaling strategy based on the data range ---

  // Only use full-range mapping when max is at least 2.5x min.
  if (maxValue > minValue * 2.5) {
    // **Strategy 1: large value range, perform full mapping**
    // Linearly map [minValue, maxValue] to the longest-side range [minL, maxL].
    const valueRange = maxValue - minValue;
    const lRange = maxL - minL;

    children.forEach((child) => {
      const value = Math.sqrt(child.chart.config.valueField);
      if (value && value > 0) {
        const normalizedValue = (value - minValue) / valueRange;
        const newL = minL + normalizedValue * lRange;
        setSizeByL(child, newL);
      } else {
        setSizeByL(child, minL);
      }
    });
  } else {
    // **Strategy 2: small value range, perform proportional mapping**
    // This avoids tiny data differences causing huge visual size differences.
    children.forEach((child) => {
      const value = Math.sqrt(child.chart.config.valueField);
      if (value && value > 0) {
        // Scale proportionally from the minimum (minL), capped at maxL.
        const newL = Math.min(maxL, minL * (value / minValue));
        setSizeByL(child, newL);
      } else {
        setSizeByL(child, minL);
      }
    });
  }
}

export function getArea(cfg, polar) {
  if (polar) {
    return (
      ((cfg.outerRadius ** 2 - cfg.innerRadius ** 2) *
        (cfg.endAngle - cfg.startAngle)) /
      2
    );
  } else {
    return cfg.width * cfg.height;
  }
}
