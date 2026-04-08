import * as d3 from "d3";
import { globalSettings } from "../global.js";
import {
  traverseAllNodes,
  extractOperation,
  extractChartType,
  extractCondition,
  setChildrenOption,
} from "../../utils/node.js";
import { approxAxisMargin } from "../../utils/adjust.js";
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

const labelHeight = 50;
const numSimulationIterations = 100;

export async function handleNestingMode(root) {
  const numCharts = root.children[1].children.length;
  const estimatedAreaPerChart = 200 * 200;
  const packingDensityFactor = 2;
  let canvasSize = Math.sqrt(
    numCharts * estimatedAreaPerChart * packingDensityFactor,
  );

  // Set min/max caps to prevent extreme sizes.
  canvasSize = Math.max(800, Math.min(canvasSize, 4000));
  chartTypeDerivation(root);
  initBasicCharts(root, canvasSize);
  generateLayout(root, canvasSize);
}

export async function postprocessNestingMode(root) {
  const client = root.children[1];
  processAxisMargin(client);
  setColorsForBasicCharts(client);
  addTextNode(client);
  for (const child of client.children) {
    if (child.chart_type.endsWith("pie")) {
      const config = child.chart.config;
      setPolarBoundingBox(config);
      child.coordinate_system = "polar";
    }
  }
  setBoundingBox(root);
}

function chartTypeDerivation(root) {
  // Check whether the conditions for Nesting are met
  if (root.children.length !== 2) {
    throw new Error(
      "Handle nesting mode: number of children for root is not 2 (server and client)",
    );
  }
  if (root.children[0].chart_type !== "graph") {
    throw new Error("Handle nesting mode: server node is not a graph");
    // TODO: currently only supports the case where the server is a graph
  }
  if (extractOperation(root.children[1].operation)[0] !== "ALL_UNION") {
    throw new Error(
      "Handle nesting mode: client node does not have ALL_UNION operation",
    );
  }

  for (const child of root.children[1].children) {
    if (child.vis_type !== "basic") {
      throw new Error("Handle nesting mode: chart type is not basic");
    }
    child.chart_type = "v" + child.chart_type;
  }

  traverseAllNodes(root, (node) => {
    node.coordinate_system = "cartesian";
  });
}

function initBasicCharts(root, canvasSize) {
  let currentTop = 100;
  let currentLeft = 100;

  const server = root.children[0];
  const client = root.children[1];

  const [type, columnName] = extractOperation(client.operation);
  const unionData = {
    data: client.children.map(
      (child) => extractCondition(child.conditions)[columnName],
    ),
    name: columnName,
  };
  client.chart.unionData = unionData;

  const [yMin, yMax] = getYMinMaxValues(client);
  const [xMin, xMax] = getXMinMaxValues(client);

  // init chart config for server
  const serverChart = {
    X: server.X,
    Y: server.Y,
    extraData: server.extra_data,
    config: {
      top: 0,
      left: 0,
      height: canvasSize,
      width: canvasSize,
      innerRadius: 0,
      outerRadius: canvasSize / 2,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      order: null,
      color: null,
      xAxis: {
        display: "none",
      },
      yAxis: {
        display: "none",
      },
      strokeColor: globalSettings.textColorDark,
      fillColor: globalSettings.textColorLight,
      options: {},
    },
    chartType: server.chart_type,
  };
  server.chart = serverChart;

  // init chart config for clients
  for (const child of client.children) {
    let width = 200;
    let height = 200;
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

    const chartType = extractChartType(child.chart_type);
    if (aspectRatio >= 1) height = width / aspectRatio;
    else width = height * aspectRatio;
    // if (chartType[0] === "v") {
    // } else if (chartType[0] === "h") {
    //   width = height * aspectRatio;
    // }

    // register color map
    if (child.chart_type.endsWith("pie") || child.chart_type.endsWith("bar")) {
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
          display: "none",
          direction: "default",
          name: child.X.name,
        },
        yAxis: {
          display: "none",
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

    if (chart.config.label.display === "top") {
      // reserve more space in `height` for label
      chart.config.height += labelHeight;
    }

    child.chart = chart;

    currentTop += Math.max(width, height);
    currentLeft += Math.max(width, height);
  }
}

function generateLayout(root, canvasSize) {
  const server = root.children[0];
  const client = root.children[1];

  const source = server.X.data[0];
  const target = server.Y.data[0];

  if (source.length !== target.length) {
    throw new Error(
      "Handle nesting mode: source and target length in graph not equal",
    );
  }

  const nodes = client.chart.unionData.data.map((data) => ({ id: data }));

  // Step 1: compute the ideal width and height for each child chart
  if (root.spatial_distribution === "proportional") {
    scaleChartSize(client.children, 200, 300);
  }

  const childMap = new Map(
    client.children.map((child) => [child.chart.config.label.value, child]),
  );

  // Step 2: precompute each node's dynamic radius and attach it to the node object
  nodes.forEach((node) => {
    node.child = childMap.get(node.id);
    if (node.child) {
      const config = node.child.chart.config;
      const width = config.width;
      const height = config.height;

      // Compute radius r using the provided formula
      // Math.sqrt(width ** 2 + height ** 2) is the diagonal length
      node.radius = Math.sqrt(width ** 2 + height ** 2) / 2 + 20;
      if (node.child.chart_type.endsWith("pie")) {
        node.radius = Math.max(width, height) / 2 + 20;
      }
    } else {
      // Provide a fallback value, just in case
      node.radius = 150;
    }
  });

  // Create links
  const links = [];
  for (let i = 0; i < source.length; i++) {
    links.push({ source: source[i], target: target[i] });
  }

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance((d) => {
          return d.source.radius + d.target.radius + 125;
        })
        .strength(0.95),
    )
    .force("charge", d3.forceManyBody().strength(-5000))
    .force("center", d3.forceCenter(canvasSize / 2, canvasSize / 2))
    .force(
      "collision",
      d3.forceCollide().radius((d) => d.radius + 50),
    );

  // Run the simulation
  for (let i = 0; i < numSimulationIterations; i++) {
    simulation.tick();
  }

  // Step 4: update server.chart.data using simulation results, including final radius and child chart type
  server.chart.data = nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    // Use the same radius value that we precomputed for the simulation
    r: node.radius,
    chartType: node.child ? node.child.chart_type : undefined,
  }));

  // Step 5: finalize each child chart's position based on the simulation results and chart sizes
  for (const child of client.children) {
    const config = child.chart.config;
    const node = nodes.find((n) => n.id === config.label.value);

    if (!node) {
      throw new Error(
        `Handle nesting mode: Missing position for node ${config.label.value}`,
      );
    }

    // Size has already been set by scaleChartSize
    // Just compute the top-left corner from the simulated center (node.x, node.y)
    config.left = node.x - config.width / 2;
    config.top = node.y - config.height / 2;
  }

  setBoundingBox(root);

  // set chart style
  if (client.children[0].chart_type.endsWith("bar")) {
    setChildrenOption(client, "showBaseline", false);
  }
}

function processAxisMargin(root) {
  for (const node of root.children) {
    if (node.chart.config.xAxis) {
      node.chart.config.xAxis.size = approxAxisMargin(node, "x", false);
    }
    if (node.chart.config.yAxis) {
      node.chart.config.yAxis.size = approxAxisMargin(node, "y", false);
    }
  }
}

function setColorsForBasicCharts(root) {
  for (const child of root.children) {
    const chartType = extractChartType(child.chart_type);
    if (
      chartType[2] === "bar" ||
      chartType[2] === "pie" ||
      chartType[2] === "parea"
    ) {
      // bar/pie/parea: may have color mapping
      const [colorMap, _] = globalSettings.palette.getColorMap(child.X.name);
      child.chart.config.color = colorMap;
    } else if (chartType[2] === "line" || chartType[2] === "scatter") {
      // line/scatter: no need to use color encoding
      const [colorMap, _] = globalSettings.palette.getColorMap("");
      child.chart.config.color = colorMap("");
    }
  }
}

function addTextNode(node) {
  for (const child of node.children) {
    const config = child.chart.config;
    if (config.label) {
      if (config.label.display === "top") {
        const textNode = {
          vis_type: "basic",
          chart_type: "text",
          parent: node,
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
              label: { value: config.label.value, isTextNode: true }, // Added for dragging synchronization
            },
            data: config.label.value,
          },
        };
        node.children.push(textNode);
        // adjust the bbox of the original chart
        config.top += labelHeight;
        config.height -= labelHeight;

        if (child.chart_type.endsWith("bar") && config.yMin >= 0) {
          // For the circle packing algorithm
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
