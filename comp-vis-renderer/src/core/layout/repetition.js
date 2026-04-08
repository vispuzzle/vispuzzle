import * as d3 from "d3";
import * as topojson from "topojson-client";
import { globalSettings } from "../global.js";
import {
  extractChartType,
  extractCondition,
  extractOperation,
  setChildrenOption,
} from "../../utils/node.js";
import {
  getXMinMaxValues,
  getYMinMaxValues,
  getValueField,
  columnAggregate,
} from "../../utils/maths.js";
import {
  setBoundingBox,
  setPolarBoundingBox,
  scaleChartSize,
} from "../../utils/geometry.js";
import { recommendAspectRatio } from "../aspect.js";

const labelHeight = 65;

export async function handleRepetitionMode(root) {
  chartTypeDerivation(root);
  initBasicCharts(root);
  await generateLayout(root);
}

export async function postprocessRepetitionMode(root) {
  setColorsForBasicCharts(root);
  addTextNode(root);
  for (const child of root.children) {
    if (child.chart_type.endsWith("pie")) {
      const config = child.chart.config;
      setPolarBoundingBox(config);
      child.coordinate_system = "polar";
    } else if (child.chart_type === "rwaffle") {
      // TODO: temporary solution for circular-linking, needs to be extended
      const config = child.chart.config;
      child.coordinate_system = "polar";
      config.left = 0;
      config.top = 0;
      config.cx = config.width / 2;
      config.cy = config.height / 2;
    }
  }
  setBoundingBox(root);
}

function chartTypeDerivation(root) {
  if (root.spatial_arrangement !== "circular") {
    for (const child of root.children) {
      if (child.vis_type !== "basic") {
        throw new Error("Handle repetition mode: chart type is not basic");
      }
      child.chart_type = "v" + child.chart_type;
      child.coordinate_system = "cartesian";
    }
    root.coordinate_system = "cartesian";
  } else {
    for (const child of root.children) {
      if (child.vis_type !== "basic") {
        throw new Error("Handle repetition mode: chart type is not basic");
      }
      child.chart_type = "rwaffle"; // overwrite chart type
      child.coordinate_system = "polar";
    }
    root.coordinate_system = "polar";
  }
}

function initBasicCharts(root) {
  const [type, columnName] = extractOperation(root.operation);
  const unionData = {
    data: root.children.map(
      (child) => extractCondition(child.conditions)[columnName],
    ),
    name: columnName,
  };
  root.chart.unionData = unionData;

  let currentTop = 100;
  let currentLeft = 100;

  const [yMin, yMax] = getYMinMaxValues(root);
  const [xMin, xMax] = getXMinMaxValues(root);

  // if children chart_type is line/scatter: register color map
  if (
    root.children[0].chart_type.endsWith("line") ||
    root.children[0].chart_type.endsWith("scatter")
  ) {
    const name = extractOperation(root.operation)[1];
    const values = root.children.map(
      (child) => extractCondition(child.conditions)[name],
    );
    globalSettings.registerColorMap(name, values, false);
  }

  for (const child of root.children) {
    let width = 250;
    let height = 250;
    let order = null;

    // register order map
    if (child.X.data[0].every((x) => typeof x === "string")) {
      if (!globalSettings.orderMaps[child.X.name]) {
        globalSettings.registerOrderMap(
          child.X.name,
          child.X.data[0],
          columnAggregate(child.Y.data),
        );
      }
      order = globalSettings.orderMaps[child.X.name];
      order = Object.keys(order).sort((a, b) => order[a] - order[b]);
    }

    // get aspect ratio
    const [aspectRatio, minAspectRatio, maxAspectRatio] =
      recommendAspectRatio(child);

    if (aspectRatio >= 1) height = width / aspectRatio;
    else width = height * aspectRatio;

    // register color map
    if (
      child.chart_type.endsWith("pie") ||
      child.chart_type.endsWith("bar") ||
      child.chart_type.endsWith("parea") ||
      child.chart_type.endsWith("waffle")
    ) {
      const xName = child.X.name;
      const xValues = child.X.data[0];
      globalSettings.registerColorMap(xName, xValues, false);
    }

    const chart = {
      X: child.X,
      Y: child.Y,
      config: {
        top: currentTop,
        left: currentLeft,
        height: height,
        width: width,
        innerRadius: 0,
        outerRadius: 150,
        startAngle: 0,
        endAngle: 2 * Math.PI,
        order: order,
        color: null,
        xAxis: {
          display: "bottom",
          direction: "default",
          name: child.X.name,
        },
        yAxis: {
          display: "left",
          direction: "default",
          name: child.Y.name,
        },
        label: {
          display: "top",
          value: extractCondition(child.conditions)[columnName],
        },
        yMin: yMin,
        yMax: yMax,
        xMin: xMin,
        xMax: xMax,
        valueField: getValueField(child),
        options: {},
      },
      chartType: child.chart_type,
    };

    if (child.chart_type.endsWith("pie")) {
      chart.config.yAxis.display = "none";
    }

    if (
      child.chart_type.endsWith("bar") ||
      child.chart_type.endsWith("pie") ||
      child.chart_type.endsWith("line")
    ) {
      if (
        root.spatial_arrangement === "circle" &&
        (!chart.config.valueField || chart.config.valueField <= 0)
      ) {
        throw new Error(
          "Circle packing chart requires correct data format and values",
        );
      }
    }

    if (chart.config.label.display === "top") {
      // reserve more space in `height` for label
      chart.config.height += labelHeight;
    }

    child.chart = chart;

    currentTop += Math.max(width, height);
    currentLeft += Math.max(width, height);
  }
}

function setColorsForBasicCharts(root) {
  for (const child of root.children) {
    const chartType = extractChartType(child.chart_type);
    if (chartType[2] === "line" || chartType[2] === "scatter") {
      const name = extractOperation(root.operation)[1];
      const value = extractCondition(child.conditions)[name];
      const [colorMap, _] = globalSettings.palette.getColorMap(name);
      child.chart.config.color = colorMap(value);
    } else if (
      chartType[2] === "bar" ||
      chartType[2] === "pie" ||
      chartType[2] === "parea" ||
      chartType[2] === "waffle"
    ) {
      // bar/pie/parea/waffle: may have color mapping
      const [colorMap, _] = globalSettings.palette.getColorMap(child.X.name);
      child.chart.config.color = colorMap;
    }
  }
}

function generateRectPackingLayout(root) {
  // --- Stage 1: Preparation (scaling and sorting) ---
  const chartType = root.children[0].chart_type;
  scaleChartSize(root.children);
  const margin = chartType.endsWith("pie") ? 10 : 30; // Pie charts need more margin
  const startX = 0;
  const startY = 0;

  let charts = root.children.map((child) => ({
    width: child.chart.config.width + margin,
    height: child.chart.config.height,
    config: child.chart.config,
  }));
  charts.sort((a, b) => b.width - a.width);

  const totalChartsWidth = charts.reduce(
    (sum, chart) => sum + (chart.width + chart.height) / 2,
    0,
  );
  console.log("Total charts width: ", totalChartsWidth);
  const desiredRowCount = Math.floor(Math.sqrt(charts.length)) - 0.5; // Try to make it close to a square
  const containerWidth = totalChartsWidth / desiredRowCount;

  // --- Stage 2: Grouping (first pass - grouping pass) ---
  // Group charts into different rows
  const allRows = [];
  if (charts.length > 0) {
    let currentRow = [];
    let currentRowWidth = 0;

    for (const chart of charts) {
      // If the current row can't fit it, finish the row and start a new row
      if (
        currentRow.length > 0 &&
        startX + currentRowWidth + chart.width > containerWidth
      ) {
        allRows.push(currentRow); // Save completed row
        currentRow = [chart]; // Start a new row with the current chart
        currentRowWidth = chart.width;
      } else {
        // Otherwise, add the chart to the current row
        currentRow.push(chart);
        currentRowWidth += chart.width;
      }
    }

    // Don't forget to add the last row
    if (currentRow.length > 0) {
      allRows.push(currentRow);
    }
  }

  // --- Stage 3: Positioning (second pass - positioning pass) ---
  // Iterate over all rows and position them centered
  let currentY = startY;

  for (const row of allRows) {
    // 1. Compute the max height of the current row
    const rowMaxHeight = Math.max(...row.map((chart) => chart.height));

    let currentX = startX;

    // 2. Position each chart in the current row
    for (const chart of row) {
      // 3. Compute the vertical offset to center
      const yOffset = chartType.endsWith("pie")
        ? (rowMaxHeight - chart.height) / 2
        : rowMaxHeight - chart.height;

      // Set the final position
      chart.config.left = currentX;
      chart.config.top = currentY + yOffset;

      // Update X for the next chart
      currentX += chart.width;
    }

    // 4. Update Y for the next row
    currentY += rowMaxHeight;
  }
}

function generateRectLayout(root) {
  const margin = 30;
  const numCellPerRow = Math.ceil(Math.sqrt(root.children.length));
  const baseConfig = root.children[0].chart.config;
  const width = baseConfig.width;
  const height = baseConfig.height;
  const left = baseConfig.left;
  const top = baseConfig.top;

  for (let i = 1; i < root.children.length; i++) {
    const config = root.children[i].chart.config;
    const x = i % numCellPerRow;
    const y = Math.floor(i / numCellPerRow);
    config.left = left + x * (width + margin);
    config.top = top + y * height;
    config.width = width;
    config.height = height;
  }
}

function generateCirclePackingLayout(root) {
  // --- Step 1: call scaleChartSize first to compute the ideal size for all charts ---
  if (root.spatial_distribution === "proportional") {
    if (root.children[0].chart_type.endsWith("pie")) {
      scaleChartSize(root.children, 200, 400);
    } else {
      scaleChartSize(root.children, 350, 700);
    }
  }

  // --- Step 2: build a D3 hierarchy and use the new sizes as the basis ---
  const hierarchyData = {
    name: "root",
    children: root.children.map((child, i) => ({
      name: `chart-${i}`,
      scaledValue: child.chart.config.width * child.chart.config.height,
      config: child.chart.config,
      chart_type: child.chart_type,
    })),
  };

  const rootNode = d3
    .hierarchy(hierarchyData)
    .sum((d) => d.scaledValue)
    .sort((a, b) => b.value - a.value);

  // --- Step 3: use the scaled sizes to compute the canvas size more accurately ---
  const totalChartsWidth = root.children.reduce(
    (sum, child) =>
      sum + (child.chart.config.width + child.chart.config.height) / 2,
    0,
  );
  const desiredRowCount =
    Math.floor(Math.sqrt(hierarchyData.children.length)) - 0.5;
  const canvasSize = totalChartsWidth / desiredRowCount;
  const packLayout = d3.pack().size([canvasSize, canvasSize]).padding(20);

  // Run the layout algorithm
  packLayout(rootNode);

  let circleInfo = [
    {
      name: "root",
      x: rootNode.x,
      y: rootNode.y,
      r: rootNode.r,
    },
  ];

  // --- Step 4: position charts and place each into its circle ---
  rootNode.leaves().forEach((node) => {
    const config = node.data.config;

    const cx = node.x;
    const cy = node.y;
    const r = node.r;

    // Here, config.width and config.height are the ideal proportions from scaleChartSize
    // We need to scale this rectangle to fit into a circle with radius r
    const aspectRatio = config.width / config.height;

    // Leave some margin between the chart and the circle boundary (do not fill the circle completely).
    const effectiveRadius = r - 20;

    // By the Pythagorean theorem, fit the rectangle into a space with diagonal 2 * effectiveRadius
    let newHeight = (effectiveRadius * 2) / Math.sqrt(1 + aspectRatio ** 2);
    if (node.data.chart_type.endsWith("pie")) {
      newHeight = effectiveRadius * 2;
    }
    const newWidth = newHeight * aspectRatio;

    config.width = newWidth;
    config.height = newHeight;
    config.left = cx - newWidth / 2;
    config.top = cy - newHeight / 2;
    config.rit_r = r; // repetition irregular tessellation radius
    config.rit_cx = cx;
    config.rit_cy = cy;
    circleInfo.push({
      name: node.data.name,
      x: cx,
      y: cy,
      r: r,
    });
  });

  root.chart.config.circleInfo = circleInfo;
  addCirclePackingNode(root, canvasSize);
}

function generateCirclePackingLayoutV2(root) {
  // TODO: polish this layout algorithm
  if (!root.children || root.children.length === 0) return;

  // V2 is currently only designed for pie charts.
  // Keep backward compatibility for other chart types.
  if (!root.children[0].chart_type.endsWith("pie")) {
    generateCirclePackingLayout(root);
    return;
  }

  // --- Step 1: compute weights (area ∝ sum(Y)) ---
  const weights = root.children.map((child) => {
    const yValues = Array.isArray(child.Y?.data)
      ? child.Y.data.flat(Infinity)
      : [];
    const sumY = d3.sum(yValues.map((d) => (Number.isFinite(+d) ? +d : 0)));
    // Keep pack stable even when data is missing/zero.
    return Math.max(sumY, 1e-6);
  });

  const isProportional = root.spatial_distribution === "proportional";
  const effectiveWeights = isProportional ? weights : weights.map(() => 1);

  // --- Step 2: convert weights to radii (global scaling keeps proportionality) ---
  const baseRadii = effectiveWeights.map((w) => Math.sqrt(w));
  const meanBaseRadius = d3.mean(baseRadii) || 1;
  const n = baseRadii.length;
  // Heuristic: keep pies readable across different counts.
  const targetMeanRadius = Math.max(60, Math.min(160, 900 / Math.sqrt(n + 1)));
  const scale = targetMeanRadius / meanBaseRadius;
  const radii = baseRadii.map((r) => r * scale);

  // --- Step 3: pack circles (positions only, no outline circles will be rendered) ---
  const padding = 14;
  const packed = radii.map((r, i) => ({
    name: `chart-${i}`,
    r: r + padding,
  }));
  d3.packSiblings(packed);

  // Translate to positive space.
  const minX = d3.min(packed, (d) => d.x - d.r) ?? 0;
  const minY = d3.min(packed, (d) => d.y - d.r) ?? 0;
  const dx = -minX + padding;
  const dy = -minY + padding;

  // --- Step 4: apply layout to each pie chart ---
  packed.forEach((node, i) => {
    const child = root.children[i];
    const config = child.chart.config;
    const pieRadius = radii[i];
    const cx = node.x + dx;
    const cy = node.y + dy;

    // Reserve label space above the pie.
    config.width = pieRadius * 2;
    config.height = pieRadius * 2 + labelHeight;
    config.left = cx - pieRadius;
    config.top = cy - pieRadius - labelHeight;

    // Keep the packed circle info for potential downstream use.
    config.rit_r = node.r; // repetition irregular tessellation radius (includes padding)
    config.rit_cx = cx;
    config.rit_cy = cy;

    config.isDonut = true;

    if (root.chart?.config && root.chart.config.circleInfo) {
      delete root.chart.config.circleInfo;
    }
  });
}

async function generateGeoReferencedLayout_V2(root) {
  // --- Step 1: load and process geographic data dynamically ---

  // A. Load high-quality TopoJSON data from the standard `world-atlas` repo
  const world = await d3.json(
    "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
  );

  // B. Convert TopoJSON to GeoJSON that D3 can work with
  // `world.objects.countries` is the country collection defined in the file
  const countries = topojson.feature(world, world.objects.countries);

  // C. Compute the centroid for each country and build a Map
  // We no longer take a parameter; we build it here
  const countryCoordinates = new Map(
    countries.features.map((d) => [
      d.properties.name, // Country name (e.g., "Germany")
      d3.geoCentroid(d), // Centroid of the country's geometry [lon, lat]
    ]),
  );
  countryCoordinates.set(
    "U.S.",
    countryCoordinates.get("United States of America"),
  );
  countryCoordinates.set(
    "USA",
    countryCoordinates.get("United States of America"),
  );
  countryCoordinates.set("England", countryCoordinates.get("United Kingdom"));
  countryCoordinates.set("UK", countryCoordinates.get("United Kingdom"));
  countryCoordinates.set("Czech Republic", countryCoordinates.get("Czechia"));
  console.log(countryCoordinates);
  // --- From here on, the rest of the function is almost identical to the previous version ---

  // Step 2: use scaleChartSize to determine the base size for each chart
  if (root.spatial_distribution === "proportional") {
    if (root.children[0].chart_type.endsWith("pie")) {
      scaleChartSize(root.children, 200, 500);
    } else {
      scaleChartSize(root.children, 350, 700);
    }
  }

  const padding = 10;

  const nodes = root.children.map((child) => {
    const config = child.chart.config;
    return {
      r: config.width / 2 + padding,
      config: config,
      countryName: config.label.value, // Assumes this field exists on config
      chart_type: child.chart_type,
    };
  });

  // --- Map projection and target position computation ---
  const totalChartsWidth = nodes.reduce((sum, node) => sum + node.r * 2, 0);
  const desiredRowCount = Math.floor(Math.sqrt(nodes.length));
  const canvasSize = totalChartsWidth / desiredRowCount;
  const [width, height] = [canvasSize, canvasSize * 0.75];

  const projection = d3
    .geoMercator()
    .fitSize([width, height], { type: "Sphere" });

  // Collect all coordinates first
  const allCoords = [];
  nodes.forEach((node) => {
    const coords = countryCoordinates.get(node.countryName);
    if (coords) {
      const [x, y] = projection(coords);
      allCoords.push([x, y]);
    } else {
      console.warn(`Coordinates not found for: ${node.countryName}`);
      allCoords.push([width / 2, height / 2]);
    }
  });

  // Find min/max for x and y
  const xValues = allCoords.map((coord) => coord[0]);
  const yValues = allCoords.map((coord) => coord[1]);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  // Normalize coordinates and assign them to nodes
  nodes.forEach((node, index) => {
    const [rawX, rawY] = allCoords[index];

    // Normalize to [0, 1], then scale to the canvas size
    const normalizedX = (rawX - xMin) / (xMax - xMin);
    const normalizedY = (rawY - yMin) / (yMax - yMin);

    node.targetX = (normalizedX * width) / 2;
    node.targetY = (normalizedY * height) / 2;
  });

  // Step 3: set up and run the force simulation
  const simulation = d3
    .forceSimulation(nodes)
    // Force 1: pull each node toward its geographic target position
    // Increase strength (e.g. from 0.1 to 0.4+) to tighten the layout
    .force("x", d3.forceX((d) => d.targetX).strength(0.5))
    .force("y", d3.forceY((d) => d.targetY).strength(0.5))

    // Force 2: prevent node overlap (keep as-is or fine-tune)
    .force("collide", d3.forceCollide((d) => d.r).strength(0.9))

    .force("center", d3.forceCenter(width / 2, height / 2))
    .stop();

  for (
    let i = 0,
      n = Math.ceil(
        Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()),
      );
    i < n;
    ++i
  ) {
    simulation.tick();
  }

  // --- New: Step 4: initialize the boundary info array ---
  const boundaryInfo = [];

  // Step 5: apply the computed positions and populate the boundary info array
  nodes.forEach((node) => {
    const config = node.config;
    const cx = node.x;
    const cy = node.y;

    // Compute final chart size (this logic is unchanged)
    const aspectRatio = config.width / config.height;
    // Use collision radius minus padding to compute the available space
    const effectiveRadius = node.r - padding;
    let newHeight =
      (effectiveRadius * 2 * 0.9) / Math.sqrt(1 + aspectRatio ** 2); // 0.9 for extra inner margin
    if (node.chart_type.endsWith("pie")) {
      newHeight = effectiveRadius * 2 - 40; // Subtract 40 to reserve space for the pie chart
    }
    const newWidth = newHeight * aspectRatio;

    config.width = newWidth;
    config.height = newHeight;
    config.left = cx - newWidth / 2;
    config.top = cy - newHeight / 2;

    // --- New: fill in boundary info for this node ---
    boundaryInfo.push({
      type: "circle", // Boundary type
      name: config.name || node.id, // Chart name or ID
      x: cx, // Center X
      y: cy, // Center Y
      r: effectiveRadius, // Effective radius
    });
  });

  // --- New: Step 6: attach the final boundary info to the root object ---
  root.chart.config.circleInfo = boundaryInfo;
  addCirclePackingNode(root, canvasSize);
}

function generateCircularLinkingLayout(root) {
  if (!root.children || root.children.length === 0) return;

  const getChildMagnitude = (child) => {
    const values = (child.chart?.Y?.data ?? child.Y?.data ?? []).flat(Infinity);
    return d3.sum(values, (d) => (Number.isFinite(+d) ? +d : 0));
  };

  // category: the X value corresponding to the max Y; ties broken by lexicographic X.
  const getChildCategoryKey = (child) => {
    const xValues = (child.chart?.X?.data ?? child.X?.data ?? []).flat(
      Infinity,
    );
    const yValues = (child.chart?.Y?.data ?? child.Y?.data ?? []).flat(
      Infinity,
    );
    const len = Math.min(xValues.length, yValues.length);
    if (len <= 0) return "";

    let bestY = -Infinity;
    let bestXKey = "";
    let hasBest = false;

    for (let i = 0; i < len; i++) {
      const y = +yValues[i];
      if (!Number.isFinite(y)) continue;
      const xKey = String(xValues[i]);

      if (
        !hasBest ||
        y > bestY ||
        (y === bestY && xKey.localeCompare(bestXKey) < 0)
      ) {
        bestY = y;
        bestXKey = xKey;
        hasBest = true;
      }
    }

    return hasBest ? bestXKey : "";
  };

  const enriched = root.children.map((child, originalIndex) => ({
    child,
    originalIndex,
    magnitude: getChildMagnitude(child),
    categoryKey: getChildCategoryKey(child),
  }));

  // 1) group by categoryKey, 2) sort categories lexicographically,
  // 3) within each category sort by magnitude desc.
  const groups = new Map();
  for (const item of enriched) {
    const key = item.categoryKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const sortedCategoryKeys = Array.from(groups.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const sortedEnriched = [];
  for (const key of sortedCategoryKeys) {
    const items = groups.get(key);
    items.sort(
      (a, b) => b.magnitude - a.magnitude || a.originalIndex - b.originalIndex,
    );
    sortedEnriched.push(...items);
  }

  root.children = sortedEnriched.map((d) => d.child);

  const n = root.children.length;
  const magnitudes = sortedEnriched.map((d) => d.magnitude);
  const totalMagnitude = d3.sum(magnitudes);

  // set layout parameters
  const TAU = Math.PI * 2;
  const paddingRatio = 0.4;
  const totalPaddingAngle = TAU * paddingRatio;
  const usableAngle = TAU - totalPaddingAngle;

  const normalizedMagnitudes =
    totalMagnitude > 0
      ? magnitudes.map((m) => m / totalMagnitude)
      : Array.from({ length: n }, () => 1 / n);

  // group-aware gaps: intraGroupGap < interGroupGap
  const groupCount = sortedCategoryKeys.length;
  const interGapCount = groupCount; // includes the gap between last and first group
  const intraGapCount = Math.max(0, n - groupCount);
  const intraToInterRatio = 0.5;
  const interGapAngle =
    totalPaddingAngle / (interGapCount + intraToInterRatio * intraGapCount);
  const intraGapAngle = interGapAngle * intraToInterRatio;

  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const child = root.children[i];
    const config = child.chart.config;
    const span = usableAngle * normalizedMagnitudes[i];

    config.options.style = "circular-linking";
    config.startAngle = cursor;
    config.endAngle = cursor + span;
    config.innerRadius = 350;
    config.outerRadius = 500;
    config.options.name = extractCondition(child.conditions)[
      extractOperation(root.operation)[1]
    ];

    const isGroupBoundary =
      i === n - 1 ||
      sortedEnriched[i].categoryKey !== sortedEnriched[i + 1].categoryKey;
    cursor += span + (isGroupBoundary ? interGapAngle : intraGapAngle);
  }
}

async function generateLayout(root) {
  let externalTextTag = true; // whether we need to add external text nodes for labels
  switch (root.spatial_arrangement) {
    case "regular_tessellation": {
      if (root.spatial_distribution === "proportional") {
        generateRectPackingLayout(root);
      } else {
        generateRectLayout(root);
      }
      break;
    }
    case "irregular_tessellation": {
      if (
        extractOperation(root.operation)[1] === "country" ||
        extractOperation(root.operation)[1] === "region"
      ) {
        await generateGeoReferencedLayout_V2(root, root.spatial_distribution);
      } else {
        if (root.children[0].chart_type.endsWith("pie")) {
          generateCirclePackingLayoutV2(root);
          externalTextTag = false;
        } else {
          generateCirclePackingLayout(root);
        }
      }
      break;
    }
    case "circular": {
      generateCircularLinkingLayout(root);
      externalTextTag = false;
      break;
    }
    default: {
      throw new Error(
        `Unknown spatial arrangement: ${root.spatial_arrangement}`,
      );
    }
  }

  root.externalTextTag = externalTextTag;

  // chart settings
  root.children.forEach((child) => {
    child.chart.config.xAxis.display = "none";
    child.chart.config.yAxis.display = "none";
  });

  if (root.children[0].chart_type.endsWith("bar")) {
    setChildrenOption(root, "showBaseline", false);
    setChildrenOption(root, "autoAdjust", false);
    if (root.spatial_arrangement === "regular_tessellation") {
      setChildrenOption(root, "border", "horizontal");
    }
    if (root.spatial_arrangement === "circular") {
      root.children[0].chart.config.options["showLabels"] = true;
    }
  }

  setBoundingBox(root);
}

function addTextNode(root) {
  if (!root.externalTextTag) return;
  for (const child of root.children) {
    const config = child.chart.config;
    if (config.label) {
      if (config.label.display === "top") {
        const textNode = {
          vis_type: "basic",
          chart_type: "text",
          parent: root,
          coordinate_system: "cartesian",
          children: [],
          chart: {
            chartType: "text",
            config: {
              top: config.top,
              left: config.left,
              width: config.width,
              height: labelHeight,
              color: globalSettings.textColorDark,
              size: globalSettings.getFontSize("label"),
              fontType: "label",
              opacity: 1,
            },
            data: config.label.value,
          },
        };
        root.children.push(textNode);
        // adjust the bbox of the original chart
        config.top += labelHeight;
        config.height -= labelHeight;

        if (
          root.spatial_arrangement === "irregular_tessellation" &&
          child.chart_type.endsWith("bar") &&
          config.yMin >= 0
        ) {
          // For the circle-packing algorithm
          // Bring the text closer to the bar chart
          const scale = Math.max(...child.Y.data.flat()) / config.yMax;
          const offset = (config.height * (1 - scale)) / 2;
          config.top += offset;
          config.height *= scale;
          config.yMax = Math.max(...child.Y.data.flat());
          textNode.chart.config.top += offset * 0.5;
        }
      }
    }
  }
}

function addCirclePackingNode(root, canvasSize = 2000) {
  if (root.chart.config.circleInfo) {
    root.children.splice(0, 0, {
      vis_type: "basic",
      chart_type: "circle-packing",
      parent: root,
      coordinate_system: "cartesian",
      children: [],
      chart: {
        chartType: "circle-packing",
        data: root.chart.config.circleInfo,
        config: {
          top: 0,
          left: 0,
          xAxis: {
            display: "none",
          },
          yAxis: {
            display: "none",
          },
          width: canvasSize,
          height: canvasSize,
          fillColor: "none",
          strokeColor: globalSettings.textColorDark,
          rootFillColor: globalSettings.textColorLight,
          options: {},
        },
      },
    });
  }
}
