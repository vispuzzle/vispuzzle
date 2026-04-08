// This file defines the main pipeline for rendering charts.

import { generateConfig } from "../core/layout.js";
import {
  processBasicChart,
  processLinkage,
  generateLegend,
  moveElementLevel,
} from "../core/processor.js";
import { processUnionAxis } from "../components/axis.js";
import { getcompositionMode } from "../utils/node.js";
import {
  saveJsonizedData,
  replaceSvgContent,
  loadNodeModule,
} from "../utils/dataJsonizer.js";
import { createChartTitle } from "../utils/title.js";
import { globalSettings } from "./global.js";

async function getBoundingBox(g, layer) {
  let bbox;
  if (typeof g.node().getBBox === "function") {
    // browser environment
    bbox = g.node().getBBox();
  } else {
    // node.js environment
    try {
      const svgdom = await loadNodeModule("svgdom");
      const svgjs = await loadNodeModule("@svgdotjs/svg.js");

      if (!svgdom || !svgjs) {
        console.warn("Unable to load svgdom or @svgdotjs/svg.js module.");
        bbox = { x: 0, y: 0, width: 1000, height: 800 };
      } else {
        const createSVGWindow = svgdom.createSVGWindow;
        const registerWindow = svgjs.registerWindow;
        const SVG = svgjs.SVG;

        const window = createSVGWindow();
        const document = window.document;
        registerWindow(window, document);

        const draw = SVG(document.documentElement);
        draw.svg(g.node().outerHTML);

        const svgRoot = draw.findOne("g." + layer);
        if (svgRoot) {
          bbox = svgRoot.bbox();
        } else {
          bbox = { x: 0, y: 0, width: 1000, height: 800 };
          console.warn("Error getting bounding box:", error);
        }
      }
    } catch (error) {
      console.warn("Error getting bounding box:", error);
      bbox = { x: 0, y: 0, width: 1000, height: 800 };
    }
  }
  return bbox;
}

function mergeBbox(bbox1, bbox2) {
  return {
    x: Math.min(bbox1.x, bbox2.x),
    y: Math.min(bbox1.y, bbox2.y),
    width:
      Math.max(bbox1.x + bbox1.width, bbox2.x + bbox2.width) -
      Math.min(bbox1.x, bbox2.x),
    height:
      Math.max(bbox1.y + bbox1.height, bbox2.y + bbox2.height) -
      Math.min(bbox1.y, bbox2.y),
  };
}

export async function pipeline(
  svg,
  document,
  visTree,
  showGrid = false,
  saveData = false,
) {
  if (Object.keys(visTree).length === 0) {
    return "";
  }
  const [results, visTreeRoot] = await generateConfig(visTree);

  const root = svg.append("g").attr("class", "chart-layer");

  const basicCharts = [];
  const mode = getcompositionMode(visTreeRoot);
  const chartType2Variation = {};
  let allReplacements = true;

  saveData = false;
  if (!saveData) {
    allReplacements = false;
  }
  for (let i = 0; i < results.length; i++) {
    const [charts, polar] = results[i];
    for (const chart of charts[0]) {
      const g = root.append("g").attr("class", chart.chartType + "-layer");
      if (chart.config && chart.config.label && chart.config.label.value) {
        // Encode node label, width, height, and polar flag for reference during interactions like node drag
        g.attr("data-label", chart.config.label.value)
          .attr("data-width", chart.config.width)
          .attr("data-height", chart.config.height)
          .attr(
            "data-polar",
            polar || chart.chartType.endsWith("pie") ? "true" : "false",
          )
          .attr(
            "data-is-text-node",
            chart.config.label.isTextNode ? "true" : "false",
          );
      }
      let [labelPosition, dx, dy] = await processBasicChart(g, chart, polar);
      if (
        saveData &&
        chart.jsonizedData &&
        !polar &&
        chart.chartType !== "map"
      ) {
        let variation = null;
        if (chartType2Variation[chart.chartType]) {
          variation = chartType2Variation[chart.chartType];
        }
        const savedResult = await saveJsonizedData(
          chart.jsonizedData,
          variation,
        );
        if (savedResult.chart_name) {
          chartType2Variation[chart.chartType] = savedResult.chart_name;
        }
        // Track whether replacement succeeded and get label position info
        const svgResult = await replaceSvgContent(
          g,
          savedResult,
          document,
          chart,
        );
        if (!svgResult || svgResult === true) {
          allReplacements = false;
        } else {
          // Destructure returned position and color info
          let labelPositions = null;
          [labelPositions, dx, dy] = svgResult;

          // Set labelPosition for the node with the specified id
          globalSettings.linkInfo.nodes?.forEach((n) => {
            if (n.id === chart.id && labelPositions) {
              // If the node has pos and labelPositions contains that pos, use the value for that pos
              // Otherwise use the value for "default"
              n.labelPosition =
                n.pos && labelPositions[n.pos]
                  ? labelPositions[n.pos]
                  : labelPositions["default"];
              n.transform = { dx: dx, dy: dy };
            }
          });

          if (svgResult.length > 3) {
            // If a label color is returned, handle it as well
            const labelColor = svgResult[3];
            if (labelColor) {
              globalSettings.linkInfo.labelColor = labelColor;
            }
          }
        }
      } else {
        // allReplacements = false; // If replacement is not performed, also treat as not fully successful
        // When no SVG replacement is performed, use the labelPosition returned by processing the basic chart
        globalSettings.linkInfo.nodes?.forEach((n) => {
          if (n.id === chart.id) {
            // If the node has pos and labelPosition contains that pos, use the value for that pos
            // Otherwise use labelPosition directly
            n.labelPosition = labelPosition;
            n.transform = { dx: dx, dy: dy };
          }
        });
      }
    }

    if (mode === "basic" || mode === "linkage") {
      for (const chart of charts[1]) {
        const g = root.append("g").attr("class", chart.chartType + "-layer");
        const [labelPosition, dx, dy] = await processUnionAxis(g, chart, polar);
        globalSettings.linkInfo.nodes?.forEach((n) => {
          if (n.id === chart.id) {
            n.labelPosition = labelPosition;
            n.transform = { dx: dx, dy: dy };
          }
        });
      }
    }

    basicCharts.push(...charts[0]);
  }

  if (["linkage", "annotation"].includes(visTreeRoot.composite_pattern)) {
    const g = root.append("g").attr("class", "linkage-layer");
    await processLinkage(g);
  }

  const rootBbox = await getBoundingBox(root, "chart-layer");
  const legendGroup = svg.append("g").attr("class", "legend-layer");

  const nodeCount = await generateLegend(
    legendGroup,
    globalSettings.palette,
    rootBbox.x + rootBbox.width,
    rootBbox.y,
    results,
    !allReplacements,
    mode,
  );
  const chartLegendGroup = legendGroup.select("g.chart-legend");
  const colorLegendGroup = legendGroup.select("g.color-legend");
  let chartLegendBbox = { x: 0, y: 0, width: 0, height: 0 };
  if (chartLegendGroup.node()) {
    chartLegendBbox = await getBoundingBox(chartLegendGroup, "chart-legend");
  }
  const moveLegend =
    chartLegendBbox.width > 350 * globalSettings.fontRatio &&
    chartLegendBbox.height < 135 * globalSettings.fontRatio;
  if (moveLegend) {
    const translateX = chartLegendBbox.width + 50;
    chartLegendGroup.attr("transform", `translate(0, 0)`);
    colorLegendGroup.attr("transform", `translate(${translateX}, 10)`);
  }
  const legendBbox = await getBoundingBox(legendGroup, "legend-layer");
  const titleGroup = svg.append("g").attr("class", "title-layer");
  const titleWidth = moveLegend
    ? rootBbox.width + 100
    : rootBbox.width + legendBbox.width;
  const titleResult = createChartTitle(titleGroup, visTreeRoot, titleWidth);
  const titleBbox = await getBoundingBox(titleGroup, "title-layer");
  let rootx, rooty, legendx, legendy;
  // Adjust bbox so its left edge aligns with titleBbox; add titleResult.height + 50 space at the top
  if (!moveLegend) {
    rootx = titleBbox.x + 50;
    rooty = titleBbox.y + titleBbox.height + 120;
    legendx = rootx + rootBbox.width + 30;
    legendy = rooty;
  } else {
    rootx = titleBbox.x + 50;
    rooty = titleBbox.y + titleBbox.height + chartLegendBbox.height + 120;
    legendx =
      legendBbox.width < rootBbox.width
        ? rootx + rootBbox.width / 2 - legendBbox.width / 2 - 20
        : rootx;
    legendy = titleBbox.y + titleBbox.height + 90;
  }
  root.attr(
    "transform",
    `translate(${rootx - rootBbox.x}, ${rooty - rootBbox.y})`,
  );
  legendGroup.attr("transform", `translate(${legendx}, ${legendy})`);
  rootBbox.x = rootx;
  rootBbox.y = rooty;
  legendBbox.x = legendx;
  legendBbox.y = legendy;
  let bbox = mergeBbox(rootBbox, legendBbox);
  bbox = mergeBbox(bbox, titleBbox);

  // add background color
  const bcgWidth = bbox.width + 100;
  const bcgHeight = bbox.height + 100;
  const bcgLayer = svg.insert("g", ":first-child").attr("class", "bcg-layer");
  bcgLayer
    .append("rect")
    .attr("class", "background")
    .attr("width", bcgWidth)
    .attr("height", bcgHeight)
    .attr("fill", globalSettings.bcg);

  moveElementLevel(root);

  const baseColorProportion = visTreeRoot.chart.config.baseColorProportion || 0;
  const proximity = visTreeRoot.chart.config.proximity || null;

  return {
    document,
    results,
    width: bcgWidth,
    height: bcgHeight,
    baseColorProportion: baseColorProportion,
    proximity: proximity,
  };
}
