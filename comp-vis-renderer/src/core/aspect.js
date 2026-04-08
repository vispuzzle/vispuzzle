// This file aims to recommend the aspect ratio of different chart types.

import { extractChartType } from "../utils/node.js";
import { globalSettings } from "./global.js";

// default settings
const minAspectRatio = 0.5;
const maxAspectRatio = 2.0;
const bestAspectRatio = 16 / 9;

// Main function to recommend aspect ratio for Cartesian charts.
// Returns: [best / min / max] aspect ratio, as an array of 3 numbers.
// Note: here we define aspect ratio as [width / height] for Cartesian charts,
// and [arclen / radius] for polar charts.
export function recommendAspectRatio(node) {
  let [bestAR, minAR, maxAR] = [
    bestAspectRatio,
    minAspectRatio,
    maxAspectRatio,
  ];

  const chartType = extractChartType(node.chart_type);
  if (chartType[0] === "r" || chartType[0] === "c") {
    return [1.0, 1.0, 1.0];
    // for polar charts, aspect ratio becomes meaningless.
    // TODO: we need to revisit polar charts to refine the layout.
  }

  // logic: first we consider vertical charts,
  // then take the inverse for horizontal charts in the end.

  if (chartType[2] === "bar") {
    const n = node.X.data[0].length;
    if (n >= 4) {
      bestAR = 0.7 + n / 10;
    } else {
      bestAR = 0.5;
    }
    minAR = bestAR - 0.2;
    maxAR = bestAR + 1.0;
  }

  // for vertical scatter plot
  if (chartType[2] === "scatter") {
    [bestAR, minAR, maxAR] = [16 / 9, 0.125, 8.0];
  }

  // for vertical line chart
  if (chartType[2] === "line") {
    [bestAR, minAR, maxAR] = [4.0, 1.5, 8.0];
  }

  // for vertical link chart
  if (chartType[2] === "link") {
    [bestAR, minAR, maxAR] = [3.0, 2.0, 3.0];
  }

  // for proportional area chart
  if (chartType[2] === "parea") {
    const n = node.X.data[0].length;
    const p = globalSettings.padding;
    bestAR = (n - p) / (1 - p);
    minAR = bestAR - 0.1;
    maxAR = bestAR + 0.1;
  }

  // for pie chart
  if (chartType[2] === "pie") {
    [bestAR, minAR, maxAR] = [1.0, 1.0, 1.0];
    // for pie chart, aspect ratio is not meaningful.
  }

  // for horizontal charts
  if (chartType[0] === "h") {
    [bestAR, minAR, maxAR] = [1 / bestAR, 1 / maxAR, 1 / minAR];
  }

  // check if minAR <= bestAR <= maxAR
  if (!(minAR <= bestAR && bestAR <= maxAR)) {
    throw new Error(
      `Aspect ratio error: ${minAR} <= ${bestAR} <= ${maxAR} is not satisfied.`,
    );
  }

  return [bestAR, minAR, maxAR];
}
