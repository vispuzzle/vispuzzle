// This file contains utility functions for specific visualization settings related with chart types.

import * as d3 from "d3";
import { geoPath } from "d3-geo";
import { geoVanDerGrinten } from "d3-geo-projection";
import { globalSettings } from "../core/global.js";

export function resolveMapProjection(node, worldMap = false) {
  const variationProjection = node?.variation?.projection;
  if (
    typeof variationProjection === "string" &&
    variationProjection.trim().length > 0
  ) {
    return variationProjection.trim();
  }
  return worldMap ? "equalearth" : "mercator";
}

export function resolveMapConfig(node, worldMap = false) {
  const variation = node?.variation || {};
  const config = {
    mapType: resolveMapProjection(node, worldMap),
  };

  if (Array.isArray(variation.center) && variation.center.length >= 2) {
    config.center = variation.center;
  }
  if (Array.isArray(variation.rotate) && variation.rotate.length > 0) {
    config.rotate = variation.rotate;
  }
  if (typeof variation.scale === "number" && !Number.isNaN(variation.scale)) {
    config.scale = variation.scale;
  }

  return config;
}

/**
 * Adjust the scale factor for proportional area chart
 *
 * @param {*} data
 * @param {*} bandScale
 * @param {*} maxLen
 * @param {*} maxValue
 */
export function adjustScaleFactor(data, bandScale, maxLen, maxValue) {
  let scale = maxLen / Math.sqrt(maxValue); // Constraint 1: do not exceed the given max length/width.

  // Constraint 2: the overlap length between any two adjacent circles
  // should not exceed 20% of their spacing.
  const overlapFactor = 0.2;
  for (let i = 0; i < data.length - 1; i++) {
    const x1 = data[i].x;
    const x2 = data[i + 1].x;
    const y1 = data[i].y;
    const y2 = data[i + 1].y;
    const distance = Math.abs(bandScale(x2) - bandScale(x1));
    scale = Math.min(
      scale,
      (distance * (1 + overlapFactor) * 2) / (Math.sqrt(y1) + Math.sqrt(y2)),
    );
  }

  return scale;
}

// Map lineStyle to the stroke-dasharray attribute.
export function getStrokeDasharray(lineStyle) {
  switch (lineStyle) {
    case "dashed":
      return "10,2";
    case "dotted":
      return "4,4";
    case "dashdot":
      return "15,4,3,4";
    case "solid":
    default:
      return "none";
  }
}

// Get label positions for each geographic feature on the map.
export function getMapLabelPos(node) {
  const chartConfig = node?.chart?.config || {};
  const chartOptions = chartConfig.options || {};
  const variation = node?.variation || {};

  const mapType = String(
    chartConfig.mapType ||
      chartOptions.mapType ||
      variation.mapType ||
      variation.projection ||
      "mercator",
  ).toLowerCase();

  const center =
    (Array.isArray(chartConfig.center) && chartConfig.center.length >= 2
      ? chartConfig.center
      : null) ||
    (Array.isArray(chartOptions.center) && chartOptions.center.length >= 2
      ? chartOptions.center
      : null) ||
    (Array.isArray(variation.center) && variation.center.length >= 2
      ? variation.center
      : null);

  const rotate =
    (Array.isArray(chartConfig.rotate) && chartConfig.rotate.length > 0
      ? chartConfig.rotate
      : null) ||
    (Array.isArray(chartOptions.rotate) && chartOptions.rotate.length > 0
      ? chartOptions.rotate
      : null) ||
    (Array.isArray(variation.rotate) && variation.rotate.length > 0
      ? variation.rotate
      : null);

  const scale =
    (typeof chartConfig.scale === "number" && !Number.isNaN(chartConfig.scale)
      ? chartConfig.scale
      : null) ||
    (typeof chartOptions.scale === "number" && !Number.isNaN(chartOptions.scale)
      ? chartOptions.scale
      : null) ||
    (typeof variation.scale === "number" && !Number.isNaN(variation.scale)
      ? variation.scale
      : null);

  const width = chartConfig.width;
  const height = chartConfig.height;
  const isOrthographic = mapType === "orthographic";
  let projection;
  switch (mapType) {
    case "equalearth":
      projection = d3.geoEqualEarth().fitExtent(
        [
          [0, 0],
          [width, height],
        ],
        { type: "Sphere" },
      );
      break;
    case "vandergrinten":
      projection = geoVanDerGrinten()
        .rotate([0, 0])
        .center([0, 0])
        .fitExtent(
          [
            [0, 0],
            [width, height],
          ],
          { type: "Sphere" },
        );
      break;
    case "orthographic": {
      const globePadding = Math.min(width, height) * 0.04;
      projection = d3
        .geoOrthographic()
        .fitExtent(
          [
            [globePadding, globePadding],
            [width - globePadding, height - globePadding],
          ],
          { type: "Sphere" },
        )
        .precision(0.1);
      break;
    }
    case "albers":
      projection = d3.geoAlbers();
      break;
    case "mercator":
    default:
      projection = d3.geoMercator();
  }
  if (!isOrthographic) {
    projection.fitSize([width, height], node.X.data);
  }
  if (center) {
    if (isOrthographic) {
      projection.rotate([-center[0], -center[1]]);
    } else {
      projection.center(center);
    }
  }
  if (rotate) {
    projection.rotate(rotate);
  }
  if (scale != null) {
    projection.scale(scale);
  }
  const path = geoPath().projection(projection);
  const labelPosition = {};

  node.X.data.features.forEach((feature) => {
    const name = feature.properties[node.X.name];
    let centroid = path.centroid(feature);
    let numRegions = 1; // Default to one region.
    let regionAreas = [];

    if (feature.geometry && feature.geometry.type === "MultiPolygon") {
      numRegions = feature.geometry.coordinates.length;

      let maxArea = -1;
      let maxAreaIndex = -1;
      let regionCentroids = [];

      feature.geometry.coordinates.forEach((polygon, index) => {
        const singleRegion = {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: polygon,
          },
        };
        const area = d3.geoArea(singleRegion);
        regionAreas.push(area);

        const regionCentroid = path.centroid(singleRegion);
        regionCentroids.push(regionCentroid);

        if (area > maxArea) {
          maxArea = area;
          maxAreaIndex = index;
        }
      });

      if (
        maxAreaIndex >= 0 &&
        regionCentroids[maxAreaIndex] &&
        !isNaN(regionCentroids[maxAreaIndex][0]) &&
        !isNaN(regionCentroids[maxAreaIndex][1])
      ) {
        centroid = regionCentroids[maxAreaIndex];
      }
    } else if (feature.geometry && feature.geometry.type === "Polygon") {
      regionAreas.push(d3.geoArea(feature));
    }

    if (centroid && !isNaN(centroid[0]) && !isNaN(centroid[1])) {
      labelPosition[name] = {
        cx: centroid[0],
        cy: centroid[1],
      };
    }
  });
  if (labelPosition["England"]) {
    labelPosition["UK"] = labelPosition["England"];
  }
  return labelPosition;
}

// Get label positions for each pie slice.
// Caution: this function depends on the processing logic in components/pie.js.
// If you change how the pie component is rendered, update this accordingly.
export function getPieLabelPos(node) {
  const { outerRadius, innerRadius, startAngle, endAngle, order } =
    node.chart.config;
  const style =
    node.chart.config?.options?.style || node.chart.config?.style || "default";
  const minSegmentAngle =
    node.chart.config?.options?.minSegmentAngle || (2 * Math.PI) / 180;
  const segmentGapAngle =
    node.chart.config?.options?.segmentGapAngle || (5 * Math.PI) / 180;
  const endSegmentPaddingAngle =
    node.chart.config?.options?.endSegmentPaddingAngle;
  const fullCircleEndPaddingAngle =
    node.chart.config?.options?.fullCircleEndPaddingAngle;
  let data = d3.zip(node.X.data[0], node.Y.data[0]).map(([x, y]) => ({ x, y }));
  if (Array.isArray(order)) {
    data = data.sort((a, b) => order.indexOf(a.x) - order.indexOf(b.x));
  }

  let pieData;
  const useEqualAngleProgress =
    style === "equal-angle-progress" && (innerRadius || 0) > 0;
  if (useEqualAngleProgress) {
    const segmentCount = data.length;
    const totalAngle = endAngle - startAngle;
    const isFullCircle = Math.abs(totalAngle - 2 * Math.PI) < 1e-6;
    const resolvedTailPadding =
      endSegmentPaddingAngle == null
        ? fullCircleEndPaddingAngle
        : endSegmentPaddingAngle;
    const rawTailPadding =
      resolvedTailPadding == null
        ? Number(segmentGapAngle) || 0
        : Number(resolvedTailPadding) || 0;
    const tailPadding = isFullCircle
      ? Math.max(0, Math.min(rawTailPadding, totalAngle * 0.9))
      : 0;
    const effectiveTotalAngle = Math.max(0, totalAngle - tailPadding);
    const segmentAngle =
      segmentCount > 0 ? effectiveTotalAngle / segmentCount : 0;
    const maxValue =
      d3.max(data, (d) => {
        const value = Number(d.y);
        return Number.isFinite(value) ? Math.max(value, 0) : 0;
      }) || 0;
    const gapAngle = Math.max(
      0,
      Math.min(Number(segmentGapAngle) || 0, segmentAngle * 0.9),
    );

    pieData = data.map((item, index) => {
      const segmentStart = startAngle + index * segmentAngle;
      const bgStart = segmentStart;
      const bgEnd = segmentStart + segmentAngle - gapAngle;
      const availableAngle = Math.max(0, bgEnd - bgStart);
      const minVisibleAngle = Math.max(
        0,
        Math.min(Number(minSegmentAngle) || 0, availableAngle),
      );
      const value = Number.isFinite(Number(item.y))
        ? Math.max(Number(item.y), 0)
        : 0;
      const progress =
        maxValue > 0 ? Math.min(Math.max(value / maxValue, 0), 1) : 0;
      const filledAngle =
        value > 0
          ? Math.min(
              Math.max(availableAngle * progress, minVisibleAngle),
              availableAngle,
            )
          : 0;
      return {
        data: item,
        progressMidAngle:
          filledAngle > 0 ? bgStart + filledAngle / 2 : (bgStart + bgEnd) / 2,
      };
    });
  } else {
    const pie = d3
      .pie()
      .value((d) => d.y)
      .startAngle(startAngle)
      .endAngle(endAngle)
      .sort(null);
    pieData = pie(data);
  }

  const labelPosition = {};
  pieData.forEach((d) => {
    const angle = useEqualAngleProgress
      ? d.progressMidAngle
      : (d.startAngle + d.endAngle) / 2;
    labelPosition[d.data.x] = {
      cx: outerRadius * Math.sin(angle),
      cy: -outerRadius * Math.cos(angle),
    };
  });
  return labelPosition;
}

export function getBarLabelPos(node) {
  const { width, height, order, xAxis } = node.chart.config;
  let data = d3.zip(node.X.data[0], node.Y.data[0]).map(([x, y]) => ({ x, y }));
  if (Array.isArray(order)) {
    data = data.sort((a, b) => order.indexOf(a.x) - order.indexOf(b.x));
  }

  const padding = globalSettings.padding;
  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.x))
    .range(xAxis.direction === "default" ? [0, width] : [width, 0])
    .paddingInner(padding)
    .paddingOuter(0);

  const labelPosition = {};
  data.forEach((d) => {
    labelPosition[d.x] = {
      cx: x(d.x) + x.bandwidth() / 2,
      cy: height,
    };
  });

  return labelPosition;
}

// Unified label-position getter for different chart types.
export function getLabelPos(node) {
  if (node.chart_type.endsWith("map")) {
    return getMapLabelPos(node);
  } else if (node.chart_type.endsWith("pie")) {
    return getPieLabelPos(node);
  } else if (node.chart_type.endsWith("bar")) {
    return getBarLabelPos(node);
  } else {
    throw new Error(
      `Unsupported chart type for label position: ${node.chart_type}`,
    );
  }
}

export function getTextColor(color) {
  const color1 = globalSettings.textColorLight;
  const color2 = globalSettings.textColorDark;
  return getContrastRatio(color, color1) > getContrastRatio(color, color2)
    ? color1
    : color2;
}

/**
 * Compute the contrast ratio between two HEX colors.
 * @param {string} hex1 - Color 1.
 * @param {string} hex2 - Color 2.
 * @returns {number} Contrast ratio (between 1 and 21).
 */
function getContrastRatio(hex1, hex2) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);

  // Compute contrast ratio per the WCAG formula.
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Compute the relative luminance of a color.
 * This is the core part of the WCAG contrast algorithm.
 * @param {number} r - Red (0-255).
 * @param {number} g - Green (0-255).
 * @param {number} b - Blue (0-255).
 * @returns {number} Relative luminance (between 0 and 1).
 */
function getLuminance(r, g, b) {
  const a = [r, g, b].map((v) => {
    v /= 255; // Normalize 0-255 values to 0-1.
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Convert a HEX color string to an RGB object.
 * Supports "#RRGGBB" and "#RGB" formats.
 * @param {string} hex - HEX color string.
 * @returns {{r: number, g: number, b: number}} RGB object.
 */
function hexToRgb(hex) {
  let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Scatter plot sampling: random sampling.
// Given data, area, radius r, and sampling ratio p, return the sampled data.
// If preserveExtreme is true, keep extreme points.
// data format: [{x: ..., y: ...}, ...]
export function sampleScatterData(
  data,
  area,
  r,
  p = 0.2,
  preserveExtreme = true,
) {
  const N = data.length;
  const n = Math.floor((p * area) / (Math.PI * r * r));

  if (n >= N) return data;

  const indicesToKeep = new Set();

  if (preserveExtreme) {
    const minY = d3.min(data, (d) => d.y);
    const maxY = d3.max(data, (d) => d.y);

    data.forEach((d, i) => {
      if (d.y === minY || d.y === maxY) {
        indicesToKeep.add(i);
      }
    });
  }

  const remainingIndices = d3.range(N).filter((i) => !indicesToKeep.has(i));
  const shuffledRemaining = d3.shuffle(remainingIndices);

  const countToSample = Math.min(n, shuffledRemaining.length);
  for (let i = 0; i < countToSample; i++) {
    indicesToKeep.add(shuffledRemaining[i]);
  }

  const sortedIds = Array.from(indicesToKeep).sort((a, b) => a - b);
  return sortedIds.map((id) => data[id]);
}

// Line chart sampling: uniform sampling.
// Given data, length, and minimum spacing minDist, return the sampled data.
// If preserveExtreme is true, keep extreme points.
// data format: [{x: ..., y: ...}, ...]
export function sampleLineData(
  data,
  length,
  minDist = 6,
  preserveExtreme = true,
) {
  const N = data.length;
  if (N * minDist <= length) return data;

  const indicesToKeep = new Set();

  // Keep extreme points.
  if (preserveExtreme) {
    const minY = d3.min(data, (d) => d.y);
    const maxY = d3.max(data, (d) => d.y);

    data.forEach((d, i) => {
      if (d.y === minY || d.y === maxY) {
        indicesToKeep.add(i);
      }
    });
  }

  // Uniform sampling.
  const step = (minDist * 2 * N) / length;
  for (let i = 0; i < N; i++) {
    if (Math.floor(i * step) >= N) break;
    indicesToKeep.add(Math.floor(i * step));
  }

  // Always keep the first and last points.
  indicesToKeep.add(0);
  indicesToKeep.add(N - 1);

  const sortedIds = Array.from(indicesToKeep).sort((a, b) => a - b);
  return sortedIds.map((id) => data[id]);
}
